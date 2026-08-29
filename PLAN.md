# Visual Fidelity & Performance Plan

Findings and roadmap from a full read of the WebGPU render path (renderer, shaders, buffers,
pipelines, adaptive quality, cullers, bake passes). Every fidelity change must be verified with
`node scripts/shot.mjs 6,12,17.5,20` (dawn / noon / golden hour / dusk); every performance change
with the `?perf` GPU profiler, before/after.

## Part 1 — Fidelity

### 1.1 Sky output clamp caps the HDR sun at 1.5 — DONE

`sky.wgsl` ended with `clamp(color, 0, 1.5)` (and the mountain early-out likewise), while the sun
disc a few lines above is deliberately driven to ~14× so it lands near AgX's EV +4 ceiling and
survives tonemapping as a blinding white body. The clamp threw almost all of that away — post-AgX,
a 1.5 sun and a 14 sun look very different, and bloom energy scales with what is left. Fixed by
raising the ceiling to 16 (2^4.026 ≈ 16.3, AgX's EV +4), keeping it as a runaway-value guard.
The god-ray pass was tuned against the 1.5-clamped scene (and accumulates into an rgba8unorm
target), so its scene tap is capped at the old 1.5 to keep shaft energy stable.

### 1.2 Deferred lighting clamps to 1.0 — the geometry pass was secretly LDR — DONE

`deferred-lighting.wgsl` clamped its final color to [0, 1]. The whole point of the `rgba16float`
scene buffer is that bright sources exceed 1.0 — with the clamp, sun glints on the text/bike/dew
could never meaningfully cross `bloomThreshold` (0.91–0.99 in the keyframes), golden-hour rim
light could not over-range, and AgX's highlight desaturation never engaged on geometry. The
emissive `MAT_BIKE_LAMP` path already returned unclamped HDR, so lamps were "real" and lit
surfaces were not — exactly the inconsistency that reads as CG. Fixed with the same 16 ceiling;
the GGX `min(…, 8.0)` cap remains the specular firefly guard.

Verify: shots at 12:00 and 17.5. If sun bloom now overpowers, raise the daytime `bloomThreshold`
keyframes slightly (stay above pale-sky luminance ≈ 0.78 per CLAUDE.md) before touching intensity.

### 1.3 Ground material was a flat color — DONE

`ground.wgsl`'s full layered material (patch noise, blade-layer bump normal, dry patches, soil
seams, crevice AO feeding the payload the lighting pass already reads) had been commented out
since repo init; the live path returned constant soil with payload 1.0. Restored the detail path.
Wherever ground shows through (under sparse grass, DoF-blurred foreground) it now has structure.
If `?perf` shows a real G-buffer cost on mobile, gate `bumpGrad` (the expensive term) on
`S.lowSpec` rather than reverting.

### 1.4 Bloom is disabled at night — when the emissive sources are

`renderer.js` skips the bloom pass whenever `isNight()`. But night is when the scene is full of
genuine HDR emitters: moon, bike lamps (which get a hand-painted screen-space glow in
`postprocess.wgsl` as a workaround), fireflies, stars. Enable bloom at night — the threshold
already excludes the dark sky, cost is quarter-res — and dial the painted glow down. Keep the
painted lens flare; that is a lens effect, not scattering.

### 1.5 Anti-aliasing: the grass field's shimmer ceiling is FXAA

Alpha-tested grass with a screen-anchored 4×4 Bayer dither + FXAA shimmers by construction, and
FXAA runs on pre-tonemap HDR luma where a 14× sun pixel wrecks its local-contrast heuristics.

- Cheap first step: run FXAA on tonemapped luma (Karis-style `c / (1 + luma)` on the taps, or
  restructure to post-tonemap).
- Structural (biggest single visual upgrade available): TAA. `prevViewProjectionMatrix` is already
  in FrameUniforms and SSAO already does depth-rejected reprojection, so the machinery is proven
  in-repo. TAA resolves the grass dither into smooth coverage, kills blade shimmer and specular
  crawl, supersedes FXAA, and makes every stochastic technique here (shadow rotation, SSAO,
  god-ray jitter) nearly free to soften. Risks: ghosting on swaying blades (no motion vectors —
  needs neighborhood color clamping) and ordering vs. DoF. Prototype behind a `?taa` flag.

### 1.6 Shadows: soften cheaply, then contact-harden

- Rotate the Poisson disk per frame as well as per pixel (one uniform) so temporal accumulation
  averages 16 taps into an effective 64.
- PCSS-lite for solids: a 4-tap blocker-distance search scaling the PCF radius, so the text's
  shadow is sharp at the base and soft at the tip instead of uniformly radius-12 mushy.

### 1.7 Clouds: two cheap terms away from "real"

Both must be mirrored in `gpu-bake.js` per the sync rule:

- Powder/Beer dual term (`1 − exp(−2·od)` into the direct light): dark cauliflower edges on lit
  sides — the signature of real cumulus.
- Dual-lobe HG (blend `HG(0.5)` with a small `HG(−0.2)` back lobe): silver lining sunward and soft
  fill away from the sun, instead of one forward lobe.
- Optionally fade the `fbmDetail` octaves with ray distance — both aerial softness and a perf win.

### 1.8 Grass lighting: distance-fade the per-blade normal

Distant blades keep their true cross-product normals, so the far field sparkles with normal
variance at sub-pixel blade widths. Blend the normal toward up with the `distFactor` the vertex
shader already computes — the far meadow reads as a calm, coherent surface. One `mix()`.

### 1.9 Smaller polish

- Stars pop on/off per cell (`hash < 0.997` gate) — use a magnitude falloff, add a Milky-Way band
  from the existing 3D noise.
- Mountain haze uses a fixed `hazeDir`; using the actual ray direction in the `atmosphere()` call
  gives sun-azimuth-dependent golden-hour haze.

## Part 2 — Performance

### 2.1 Grass vertex work: LOD the blade mesh per layer (biggest win, low risk) — DONE

1M blades × 8 segments, drawn twice (G-buffer + shadow). Both layers share one blade mesh, but the
sparse layer is by definition the distant field (blades widened 2×, a few pixels tall).

- Second blade mesh with 3–4 segments for the sparse layer (and a 2-segment one for the shadow
  pass); select per layer in `#drawGrass`. Halves vertex + Bézier work for ~60% of blades.
- Distance-density prefix draws: `#drawGrassRanges` already draws per-tile prefixes (the
  `density < 1` path used by `shadowGrassDensity`). Extend the camera pass with per-tile density
  from tile distance (1.0 inside 15 wu → ~0.4 at 40 wu), compensating with the existing
  distance width scale-up.
- Skip sparse-layer tiles fully under the dense layer's 11×11 footprint (double-drawn today).

### 2.2 Shadow pass diet — DONE (segment LOD part)

Coarse blade mesh for grass shadows (a 2048² map does not resolve 8 segments); consider letting
adaptive quality thin dense-layer shadow density once segment LOD is in (still open).

Implementation notes for 2.1/2.2: blade meshes are now per-LOD (`meshFull`/`meshSparse`/
`meshShadow`, 8/4/3 segments desktop, 6/3/2 low-spec); the culler splits the distant layer's
visible tiles at `grassLodDistance` (default 18 wu) into near/far run lists and far tiles draw a
`grassDistantDensity` prefix (default 0.65); distant-layer tiles covered by a streamed-in dense
tile are dropped in both camera and shadow passes (`grassDedup`). All three are live controls for
A/B toggling in the debug panel.

### 2.3 Render-scale as an adaptive-quality lever (biggest mobile/4K win)

`AdaptiveQuality` scales step counts but never resolution; the canvas runs at full
`devicePixelRatio`. Add a `renderScale` param (floor ~0.7): size the internal targets at
`scale × canvas` and let postprocess write to the full-res swapchain. The resize/bind-group
rebuild machinery already exists. Ship as the last rung below current minimums so desktop never
sees it but a struggling phone drops resolution before dropping clouds to 6 steps.

### 2.4 Bake the mountains to a panorama

`renderMountains` marches up to 64 heightmap samples + 8 refinements per horizon-band pixel every
frame, but its inputs (camera ~static, sun slow) barely change. Bake color + alpha + a depth proxy
into a ~1024×256 lat-long strip re-baked when sun elevation moves > ε (same amortization pattern
as the existing cloud-shadow bake); the sky pass then does one texture sample.

### 2.5 Fog × fireflies inner loop

`ppRayMarchFog` runs up to 32 steps × 32 firefly distance tests per pixel at night-with-fog.
Compute each firefly's closest-approach to the ray once, keep a small fixed list of intersecting
ones, and march only those. Worst case drops ~4×, typical far more.

### 2.6 Cloud march micro-cuts

Early-out `shadowOD` for near-zero `rho`; distance-fade detail octaves (shared with §1.7). Each
`cloudDensity` call is ~10 3D-texture samples; the sky-pixel worst case is ~1200 samples.

### 2.7 Verified non-issues — do not unwind

Boids already use spatial hashing. The single-pass deferred+sky+forward merge, TBDR back-pressure
gate, clear-once postprocess targets, tile-contiguous ranged grass draws, and `rg11b10ufloat`
bloom chain are already best-practice. Desktop full-res SSAO is documented at ~0.1 ms with a known
half-res failure mode (scanlines, 2026-07-07) — leave it; render-scale shrinks it anyway.

## Part 3 — Order

| Step | Item                                                             | Effort | Type     | Status |
| ---- | ---------------------------------------------------------------- | ------ | -------- | ------ |
| 1    | HDR clamp fixes (§1.1, §1.2) + god-ray guard                     | XS     | fidelity | done   |
| 2    | Ground material restore (§1.3)                                   | S      | fidelity | done   |
| 3    | Grass segment LOD + distance density + sparse-under-dense (§2.1) | M      | perf     | done   |
| 4    | Night bloom (§1.4), distant grass normal fade (§1.8)             | S      | fidelity |        |
| 5    | Tonemap-aware FXAA, per-frame Poisson rotation (§1.5, §1.6)      | S      | fidelity |        |
| 6    | Render-scale lever (§2.3), fog firefly culling (§2.5)            | M      | perf     |        |
| 7    | Cloud powder + dual-lobe HG (§1.7) with `gpu-bake.js` mirror     | S      | fidelity |        |
| 8    | Mountain panorama bake (§2.4)                                    | M      | perf     |        |
| 9    | TAA prototype behind a flag (§1.5)                               | L      | both     |        |
| 10   | PCSS-lite on solids, night-sky polish (§1.6, §1.9)               | M      | fidelity |        |

Every new tunable must land in `PARAMS` in `controls-ui.js` per the repo rule.

Open flags for visual verification (steps 1–2 were landed without screenshots — no WebGPU adapter
in the dev container): (a) if noon looks wrong without the 1.5 sky clamp, the right shape is a
higher-ceiling guard tuned down, not restoring 1.5; (b) AgX behavior at golden hour is where past
regressions hid — check 17.5 first.
