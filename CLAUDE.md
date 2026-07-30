# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite + Hugo dev servers concurrently (HMR, no manual build needed)
npm run build     # vite build && hugo --minify → outputs to dist/
npm run lint      # Check Prettier formatting
npm run format    # Auto-fix formatting
npm start         # Preview dist/ with vite preview (after build)
```

**Visual iteration (do not guess at colors/lighting):** `node scripts/shot.mjs <hour[,hour...]> [width] [height]` boots the renderer in headless Chrome (via the placeholder harness, quality pinned, rain forced off) and writes one small PNG per hour to the scratchpad so changes can be _seen_. Example: `node scripts/shot.mjs 6,12,18,20 512 340`. Always verify sky/lighting/color changes across several hours (dawn, midday, golden hour, dusk) before declaring them done — a fix that looks right at noon often breaks golden hour.

## CSS

Styles are authored in `css/style.css` using Tailwind CSS v4 via the `@tailwindcss/vite` plugin.

- Use `@apply` inside `@layer components` for Tailwind utilities.
- Custom properties and non-Tailwind rules go in the same layer as plain CSS.
- Design tokens (colors, radii, gradients) live in `:root` at the top of `css/style.css`.
- Do not use z-index when possible

## Code Style

- **Always** follow the _Art of Readable Code_
  - Code should be self explanatory and self documenting
  - Use abbreviations only for names that do not travel far
  - Reduce boilerplate comments; comment only the non-obvious aspects
  - Always add a unit suffix (`angleRad` vs `angle`)
  - Prefer elegance where possible
- Do not try to be clever / over-complicate; keep code simple and concise
- **Always** use advanced algorithms for performance benefits
  - When possible, add a comment that references a paper or implementation detail (example: "We use a De Bruijn sequence for perfect hashing")
- Use ES6 class syntax throughout
  - `#privateField` declarations at the top of the class body
  - `get prop()` getters for computed read-only properties
  - Private methods use `#methodName()` syntax
  - Prefer `#private` over `_underscore` conventions.
- Never use `_underscore` in any context.
- Prettier enforces: no semicolons, double quotes, 2-space indent, 120-char line width, ES6 trailing commas.

## WGSL Shaders (WebGPU)

- **Never use `textureSample` or `textureSampleCompare` inside non-uniform control flow.** WGSL requires these in uniform control flow only. Use `textureLoad` (integer coordinate fetch) instead, with manual coordinate computation via `textureDimensions()`. For 3D noise textures, this means manual trilinear interpolation with 8 `textureLoad` calls + smoothstep blending. For shadow maps, use `textureLoad` + manual depth comparison.
- **`textureSampleLevel` is allowed in non-uniform control flow** (explicit LOD bypasses the restriction). Use it for vertex shader texture reads and cases where you control the LOD.
- **WGSL struct alignment:** `vec3f` aligns to 16 bytes but has size 12. A `f32` field after a `vec3f` packs into the 4 remaining bytes at offset 12, not at offset 16. `vec2f` aligns to 8 bytes. Always verify byte offsets against the WGSL spec when writing uniform buffers from JS.
- **`smoothstep(edge0, edge1, x)` with `edge0 > edge1` is indeterminate** (Dawn returns 0, so the whole sprite/mask goes transparent and silently discards). Never write a "reversed" falloff like `smoothstep(1.0, 0.55, r)` for an opaque-center dot — use `1.0 - smoothstep(0.55, 1.0, r)`.
- **Every bind group slot declared in the pipeline layout must be set** at draw time, even if the group is empty. Bind the renderer's `empty` bind group for unused slots.
- **FrameUniforms (group 0)** is a single 640-byte uniform buffer shared by all passes. The `lightSpaceMatrix` lives at float offset 112 (byte 448). All passes bind the same frame bind group at group 0.

## Color & Tonemapping Pipeline (gotchas)

Two non-obvious traps cost a long "why is the sky purple / sun washed out" debug. Read these before touching sky, tonemap, bloom, or keyframe colors:

- **AgX rotates bright, near-white blues toward violet.** `filmicTonemap()` in `postprocess.wgsl` is AgX. A saturated/darker blue like `zenithColor` (0.16, 0.42, 0.9) survives and reads blue, but a pale near-white blue like the keyframe `horizonColor` (0.66, 0.8, 0.98) renders as **mauve**. Any sky gradient that eases toward that horizon color smears purple across the dome. `sky.wgsl atmosphere()` therefore builds its horizon reference from a cyan-leaning, AgX-safe blue (`vec3f(0.42, 0.58, 0.78)`) — **not** the keyframe horizon — and anchors the physical (Preetham) sky toward that blue gradient. Anchor strength is scaled by sun elevation (`mix(0.2, 0.85, smoothstep(0.15, 0.5, sunElev))`) so golden-hour/dawn warmth survives while midday stays blue. The CPU mirror is `atmo.js computeAtmosphereSkyColorInto` — keep it in sync.
- **`sceneTexture` is HDR (`rgba16float`) — bright sources are written well above 1.0.** The format is `SCENE_FORMAT` in `gpu-buffers.js` (`rgba16float`, or `rgba8unorm` on `S.lowSpec` to save TBDR bandwidth — highlights clip there, as they used to everywhere). **Every pipeline that draws into `sceneTexture` must use `SCENE_FORMAT`** (all the scene-pass pipelines in `gpu-pipelines.js` plus the fireworks pass); a mismatch is a validation error. Because the buffer holds pre-tonemap HDR, the sun disc (`sky.wgsl`, driven to ~14×), emissive bike lamps, etc. survive to postprocess, where `filmicTonemap()` (AgX, EV range up to +4 ≈ 16×) rolls them off into hot highlights instead of a flat clipped white. Bloom still adds glare (`bloom-extract.wgsl` ramps from `threshold` over `threshold * 0.15`), but it no longer does _all_ the brightness work — a bright source now reads bright on its own. Keep daytime `bloomThreshold` ~0.85–0.92 (above pale-sky luminance ≈ 0.78) so only the sun/lamps bloom, not the whole sky. If you ever make the sun/lights look washed out again, first check that `sceneTexture` (and the pipelines writing it) are still float, not `rgba8unorm`.
- **Debug method that works:** hardcode `atmosphere()` to return a known constant (green, then `sky.zenithColor`, then `sky.horizonColor`) and screenshot with `scripts/shot.mjs` — this isolates whether a cast lives in the sky content or in postprocess.

## Architecture

**Entry point:** `js/main.js` instantiates the `App` class which wires together the main subsystems. Custom elements (`ExtLink`, `LifeSpanRatio`) are registered from `js/components/`.

**WebGPU graphics engine** (`js/webgpu/`) — Renders instanced grass blades with time-based lighting, wind animation, shadows, SSAO, bloom, god rays, volumetric fog, and post-processing. The goal is a realistic rendering that does not look game-like.

| Module               | Purpose                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `renderer.js`        | Main render loop, resource init, per-frame updates, all render passes                                                                |
| `webgpu-device.js`   | Device/adapter init, canvas config, shared samplers, helper factories                                                                |
| `webgpu-errors.js`   | `withErrorScopes()` / `reportError()` / `hasError()` — wraps GPU error scope push/pop                                                |
| `gpu-context.js`     | `GPUContext` — shared per-frame state (matrices, timing, camera, lighting)                                                           |
| `gpu-pipelines.js`   | Pipelines, bind group layouts and vertex layouts, declared as data tables; `createBindGroup()` helper                                |
| `gpu-buffers.js`     | Geometry buffers (grass, ground, text, birds, rain, particles, fireflies), render targets, noise textures, `UniformBuffer`           |
| `gpu-updates.js`     | Per-frame uniform writes (`writeFrameUniforms`), grass tile updates, `GPUHeightmap` readback                                         |
| `gpu-bake.js`        | One-time bake passes (mountain/ground heightmap), periodic bakes (cloud shadow), CPU helpers (sun visibility, cloud light occlusion) |
| `uniform-catalog.js` | WGSL struct layouts, byte offsets and allocated sizes (`UNIFORM_BYTES`) for every uniform buffer                                     |

WGSL shaders live in `js/webgpu/shaders/` and are bundled via the `wgslShaderBundlePlugin` in `vite.config.js` (injected as a virtual JS module, no minification).

**Shared modules** (`js/shared/`) used by the renderer:

| Module                | Purpose                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `camera.js`           | Quaternion-based camera with yaw/pitch/roll and touch support                                                 |
| `camera-animator.js`  | Keyframe-driven camera animation (`CameraAnimator`, `PATH`)                                                   |
| `time-system.js`      | Day/night cycle, keyframe lerp, per-property overrides, scroll-wheel scrub                                    |
| `wind-system.js`      | Wind direction/strength animation, uniform data for shaders                                                   |
| `effects.js`          | CPU-side rain, particle, and firefly simulation (`EffectsSystem`)                                             |
| `boids-system.js`     | CPU flocking simulation for the bird flock (separation, alignment, cohesion, orbit seek, mouse repulsion)     |
| `atmo.js`             | CPU-side Preetham sky model (`preethamPrecompute`, `computeAtmosphereSkyColor`) — mirrors sky.frag atmosphere |
| `moon.js`             | Real synodic moon phase calculation (returns [0,1) for current date)                                          |
| `voronoi.js`          | Voronoi cell lookup used for grass tuft placement (CPU side mirrors GPU grass.wgsl)                           |
| `adaptive-quality.js` | FPS-based quality scaling of cloud steps, SSAO, god rays, etc.                                                |
| `controls-ui.js`      | Debug panel driven by `PARAMS` array                                                                          |
| `settings.js`         | Static device/feature detection (`S.isMobile`, `S.model`, etc.)                                               |
| `math-utils.js`       | Matrix math, quaternion ops, `smoothstep`, `normalize`, etc.                                                  |
| `glb-loader.js`       | Minimal GLB/glTF mesh loader (positions, normals, indices)                                                    |
| `intro.js`            | `buildIntro()` — constructs the opening camera animation keyframes                                            |

**Content (blog, pages)** is managed by Hugo (`content/`, `layouts/`). The dev server runs Hugo and Vite concurrently; the production build runs `vite build && hugo --minify`.

**No test framework** is currently configured.

## Camera (`js/shared/camera.js`)

Quaternion orientation (canonical source of truth). `#yaw`, `#pitch`, `#roll` Euler angles kept in sync for input clamping and re-use. Roll decays exponentially each frame and is added by mouse-X movement. `getViewMatrix()` derives the up vector from the orientation quaternion; never hardcode `[0,1,0]` as up, or roll has no effect. `lookAtLerp()` bakes the current roll into the target quaternion before slerping so roll is preserved across programmatic orientation changes.

## Time System (`js/shared/time-system.js`)

Keyframe lerp in `#lerpKeyframe()`. For optional per-keyframe properties, use `kA.prop ?? fallback` in the lerp call — no need to add the field to every keyframe. `setOverrideTime()` wraps with a while-loop to handle floating-point edge cases. `lerpTime()` uses shortest-arc delta (if delta > 12 subtract 24, if < -12 add 24) to interpolate correctly through midnight. Scroll wheel scrubs time via passive listener; disabled when `header.classList.contains("canvas-expanded")`.

## Controls UI (`js/shared/controls-ui.js`)

`PARAMS` array drives the panel — add an object with `{ key, label, min, max, step }` (or `type: "color"` / `type: "select"`) and the control appears automatically. The `key` must match a property in `timeSystem.timeInfo`. Reset button calls `timeSystem.clearOverride(key)`. Values are read back from `timeInfo` every frame in `animate()`.

**Every parameter added to the rendering pipeline MUST be added as a control.**

## Boids System (`js/shared/boids-system.js`)

CPU-side flock simulation. 500 (mobile) / 1000 (desktop) birds. Each frame: separation + alignment + cohesion forces, orbit-seek toward a lemniscate attractor ahead of the camera, mouse-ray repulsion (6 wu radius). Birds are clamped above `BIRD_MIN_ALTITUDE`. Constants (`BIRD_COUNT`, `BIRD_ORBIT_RADIUS`, etc.) are exported so shaders and controls can reference them. `BoidsSystem.update()` is called every frame from `renderer.js`.

## Atmosphere (`js/shared/atmo.js`)

`preethamPrecompute(turbidity, sunDirY)` returns the 21 Preetham distribution coefficients (zenith XYZ, fRef XYZ, and five-term A–E coefficients for Y, x, y channels) used by the sky shader. `computeAtmosphereSkyColor(timeInfo)` evaluates the model at a representative zenith direction and returns an RGB sky tint for CPU-side surface lighting. Both mirror the GPU `atmosphere()` function in `sky.frag`.

## WebGPU Renderer Architecture

**Pipeline & bind group conventions:**

- **Group 0** — frame uniforms (640 bytes, shared by every pass). Created once, updated every frame via `writeFrameUniforms()`.
- **Group 1** — per-pass resources (textures, samplers, pass-specific uniforms). Each pass has its own bind group layout defined in `gpu-pipelines.js`.
- **Group 3** — per-object uniforms (e.g. text model matrix). Groups 1–2 may be empty bind groups to pad to group 3.
- All pipelines are created once at init in `createAllPipelines()`, from the `PASS_ENTRIES` / pipeline spec tables — a new pass is a table row, not new code. Bind groups live in the renderer's `#bg` map: `#createStaticBindGroups()` runs once, `#createScreenBindGroups()` re-runs on every resize (it references screen-size render targets).

**Shadow pass:**

- Depth-only render pass into a 1024×1024 (mobile) / 2048×2048 (desktop) `depth32float` texture.
- `depthBias: 2`, `depthBiasSlopeScale: 2.0`, `depthBiasClamp: 0.01` on both shadow pipelines.
- Draws both grass layers (`grass.layers`, dense first), then text, bike and birds. Same vertex buffer layout as the G-buffer grass pipeline, minus the per-blade noise stream.
- Light space matrix: orthographic frustum fitted to camera frustum corners (clamped to 40 wu shadow distance), texel-snapped to prevent shimmer, field-clamped to ±60 wu. Returns `null` when sun elevation ≤ 0.05 (no shadows at night).
- The shadow map is a separate texture from the scene depth — no render/sample conflict.

**Bake passes:**

- Mountain heightmap (1024×1024 RGBA8) and ground heightmap (512×512 RGBA8) are baked once at startup via fullscreen quad draw calls, then CPU-readback via `GPUHeightmap.readback()` (async `mapAsync`).
- Cloud shadow (256×256 R8) is re-baked every 3 frames into a separate texture.
- CPU-side `computeSunVisibility()` (16-step ray march) and `computeCloudLightOcclusion()` (cloud density march) use the readback data. Both are throttled to run every 4 frames.

**Per-frame update order in `#render()`:**

1. Time system (`lerpTime` / `rawTime` during animation) + adaptive quality
2. Sky color + sun direction + sun/moon blending → `ctx.primaryLightDir`
3. Camera idle lerp (ground height snapping, look-at drift)
4. Camera update + view matrix computation
5. Light space matrix computation
6. Wind system update
7. Grass tile position updates (`updateGrassTiles`, runs only when tile anchor shifts)
8. Mouse ray → cursor world position
9. Frame uniform buffer write (`writeFrameUniforms`)
10. Cloud shadow uniform write (every 3rd frame)
11. CPU sun visibility + cloud light occlusion (every 4th frame)
12. Grass/bird/effects uniform writes
13. Sky, rain, god ray, fog, post-process uniform writes
14. **GPU encode:** cloud shadow bake → shadow pass → G-buffer pass → scene pass (deferred lighting + firefly/bike lights + sky + rain + particles + fireflies, all in **one** render pass) → SSAO + blur → bloom (extract → down → up) → god rays → post-process composite → submit

**Uniform buffers:** every one is a `UniformBuffer` (GPU buffer + host staging exposed as `.f` / `.dv`, submitted by `.write()`), allocated from the `UNIFORM_BYTES` table in `uniform-catalog.js` — which documents the matching WGSL struct and byte offsets right above it — and seeded from `UNIFORM_SEED` in `renderer.js`. Adding a uniform means documenting the struct, adding its size, and writing a writer.

**Render targets (created by `createRenderTargets`, each `{ texture, view, width, height }`):**

- `gAlbedo`, `gNormal`, `gDepth` — G-buffer MRT outputs (full-res). Layout, material IDs and the octahedral normal encoding are defined once in `shaders/gbuffer.inc.wgsl`, which every writer and reader `#include`s — change it there, not per shader.
- `sceneTexture` — HDR scene color (deferred + forward merged, full-res)
- `ssao`, `ssaoPrev`, `ssaoBlur` — temporal SSAO ping-pong (full-res)
- `bloomExtract` — bloom bright-pass extract (half/quarter-res)
- `bloomMips[0..N-1]` — bloom downsample/upsample pyramid
- `godRay` — volumetric god ray march (half/quarter-res)

**iOS / mobile throttling:**

- `queue.onSubmittedWorkDone()` is used as a back-pressure gate: `#gpuFramePending` blocks new frame submission until the GPU drains the previous frame. This prevents command buffer queue growth on TBDR GPUs.
- Post-process targets are cleared once at init/resize (not per-frame) to avoid extra TBDR flushes.
- **Splitting a render pass costs a full store + reload of every attachment**, which is why deferred/sky/forward share one pass. Sampling a texture that is also attached forces such a split, so the deferred pass reads world position from `gDepth` rather than the depth texture (`depthReadOnly: true` would avoid the split too, but Safari/Metal silently fails to load previous depth content). Adding a pass, or sampling depth mid-scene, gives that cost straight back.
- Prefer `loadOp: "clear"` over `"load"` on attachments the pass fully overwrites — `"load"` pulls the old contents into tile memory for nothing.
