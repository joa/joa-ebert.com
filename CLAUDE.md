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
- **Every bind group slot declared in the pipeline layout must be set** at draw time, even if the group is empty. Use `createEmptyBindGroup()` for unused slots.
- **FrameUniforms (group 0)** is a single 640-byte uniform buffer shared by all passes. The `lightSpaceMatrix` lives at float offset 112 (byte 448). All passes bind the same frame bind group at group 0.

## Architecture

**Entry point:** `js/main.js` instantiates the `App` class which wires together the main subsystems. Custom elements (`ExtLink`, `LifeSpanRatio`) are registered from `js/components/`.

**WebGPU graphics engine** (`js/webgpu/`) — Renders instanced grass blades with time-based lighting, wind animation, shadows, SSAO, bloom, god rays, volumetric fog, and post-processing. The goal is a realistic rendering that does not look game-like.

| Module               | Purpose                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `renderer.js`        | Main render loop, resource init, per-frame updates, all render passes                                                                |
| `webgpu-device.js`   | Device/adapter init, canvas config, shared samplers, helper factories                                                                |
| `webgpu-errors.js`   | `withErrorScopes()` / `reportError()` / `hasError()` — wraps GPU error scope push/pop                                                |
| `gpu-context.js`     | `GPUContext` — shared per-frame state (matrices, timing, camera, lighting)                                                           |
| `gpu-pipelines.js`   | All `GPURenderPipeline` objects, bind group layouts, bind group creation                                                             |
| `gpu-buffers.js`     | Geometry buffers (grass, ground, text, birds, rain, particles, fireflies), fullscreen quad, render target textures, noise textures   |
| `gpu-updates.js`     | Per-frame uniform writes (`writeFrameUniforms`), grass tile updates, `GPUHeightmap` readback                                         |
| `gpu-bake.js`        | One-time bake passes (mountain/ground heightmap), periodic bakes (cloud shadow), CPU helpers (sun visibility, cloud light occlusion) |
| `uniform-catalog.js` | WGSL struct layouts and byte offsets for all uniform buffers                                                                         |

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
- All pipelines are created once at init in `createAllPipelines()`. Bind groups that reference screen-size textures must be recreated on resize via `createPassBindGroups()`.

**Shadow pass:**

- Depth-only render pass into a 1024×1024 (mobile) / 2048×2048 (desktop) `depth32float` texture.
- `depthBias: 2`, `depthBiasSlopeScale: 2.0`, `depthBiasClamp: 0.01` on both shadow pipelines.
- Draws dense grass (instanced), sparse grass (instanced), then text. Same vertex buffer layout as the G-buffer grass pipeline.
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
14. **GPU encode:** cloud shadow bake → shadow pass → G-buffer pass → scene pass (deferred lighting + sky + rain + particles + fireflies) → SSAO + blur → bloom (extract → down → up) → god rays → post-process composite → submit

**Render targets (created by `createRenderTargets`):**

- `gAlbedo`, `gNormal`, `gMaterial` — G-buffer MRT outputs (full-res)
- `sceneTexture` — HDR scene color (deferred + forward merged, full-res)
- `ssao`, `ssaoPrev`, `ssaoBlur` — temporal SSAO ping-pong (full-res)
- `bloomExtract` — bloom bright-pass extract (half/quarter-res)
- `bloomMips[0..N-1]` — bloom downsample/upsample pyramid
- `godRay` — volumetric god ray march (half/quarter-res)

**iOS / mobile throttling:**

- `queue.onSubmittedWorkDone()` is used as a back-pressure gate: `#gpuFramePending` blocks new frame submission until the GPU drains the previous frame. This prevents command buffer queue growth on TBDR GPUs.
- Post-process targets are cleared once at init/resize (not per-frame) to avoid extra TBDR flushes.
