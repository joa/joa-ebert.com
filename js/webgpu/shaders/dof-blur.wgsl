// DoF — Half-res Near + Far Blur
// ##############################
//
// Second half-resolution DoF pass. Gathers a hexagonal kernel over the
// downsampled colour + signed-CoC target from dof-coc.wgsl (coc<0 near, coc>0
// far). Two fields, each physically distinct:
//   NEAR (foreground): a *dilated* gather — each pair's reach uses the larger of
//     the tap's and the centre's near-radius, so a blurred blade both smears past
//     its silhouette and goes translucent (it composites OVER the background).
//   FAR (background): a plain gather within the centre's own far-radius, skipping
//     nearer taps so a sharp foreground edge doesn't bleed into the blur. The
//     pixel replaces itself with its blurred self (composited UNDER the near).
// Far blur is off by default (dofFocusFar past the far plane) but fully supported
// for artistic use — just lower the DoF Focus Far / Blur Far controls.
// Working half-res (box-averaged input) keeps thin grass from streaking.
//
// Output: rgb = blurred colour, a = how strongly DoF replaces the sharp scene
// here (near coverage ∪ far amount); in-focus pixels output a≈0 and stay crisp.

struct DofUniforms {
  near: f32,
  far: f32,
  depthOfField: f32,
  dofFocusNear: f32,
  dofFocusFar: f32,
  dofBlurNear: f32,
  dofBlurFar: f32,
  ssaoIntensity: f32,
}

@group(1) @binding(0) var<uniform> dof: DofUniforms;
@group(1) @binding(1) var dofTex: texture_2d<f32>;
@group(1) @binding(2) var dofSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return VertexOutput(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}

// Unit pointy-top hexagon corners (the aperture shape).
const HEX_CORNERS = array<vec2f, 6>(
  vec2f( 0.8660254,  0.5),
  vec2f( 0.0,        1.0),
  vec2f(-0.8660254,  0.5),
  vec2f(-0.8660254, -0.5),
  vec2f( 0.0,       -1.0),
  vec2f( 0.8660254, -0.5),
);
// Half-res blur pixels per unit of CoC, as a fraction of frame height (so the
// blur is resolution-independent). CoC = nearBlur·depthOfField, so the radius
// scales with the DoF-strength control: at strength 8 a fully-near blade blurs
// by ~0.08·halfH px. Ring count adapts to the radius so the disc stays filled.
const COC_TO_PX_FRAC: f32 = 0.01;
const MAX_RINGS: i32 = 6;

fn hash12(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.2333))) * 43758.5453);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(dofTex));
  let uv = input.texCoord;
  let center = textureSampleLevel(dofTex, dofSampler, uv, 0.0);
  let centerCoc = center.a;

  // Blur radius scales with CoC (= nearBlur·depthOfField), so the DoF-strength
  // control actually controls the amount of blur.
  let cocToPx = COC_TO_PX_FRAC * dims.y;
  let maxRadiusPx = dof.depthOfField * cocToPx;
  if (maxRadiusPx < 1.0) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }
  let centerNearPx = max(-centerCoc, 0.0) * cocToPx;
  let centerFarPx = max(centerCoc, 0.0) * cocToPx;

  // Ring count tracks the radius so the disc stays filled; per-pixel rotation
  // turns residual under-sampling into noise, not banding.
  let rings = clamp(i32(ceil(maxRadiusPx / 5.0)), 3, MAX_RINGS);
  let ang = hash12(input.position.xy) * 6.2831853;
  let cs = cos(ang);
  let sn = sin(ang);

  // Three accumulators:
  //   near — foreground samples (coc<0) that dilate-reach this texel (a blade)
  //   bg   — an estimate of what's behind the near geometry, from far/focus taps
  //          (a thin blade → low near coverage → this sky estimate shows through)
  //   far  — the centre's own far blur: taps inside its far-radius that are not
  //          nearer than it, so a sharp foreground edge stays crisp against it.
  let cocRef = max(dof.depthOfField * 0.4, 0.05);
  let centerNear = clamp(-centerCoc / cocRef, 0.0, 1.0);
  let centerFar = clamp(centerCoc / cocRef, 0.0, 1.0);
  var nearCol = center.rgb * centerNear;
  var nearW = centerNear;
  var bgCol = center.rgb * (1.0 - centerNear);
  var bgW = 1.0 - centerNear;
  var farCol = center.rgb;
  var farW = 1.0;
  var tapTotal = 1.0;

  for (var k = 1; k <= rings; k++) {
    let ringPx = maxRadiusPx * f32(k) / f32(rings);
    for (var s = 0; s < 6; s++) {
      let c0 = HEX_CORNERS[s];
      let c1 = HEX_CORNERS[(s + 1) % 6];
      for (var t = 0; t < k; t++) {
        let q = mix(c0, c1, f32(t) / f32(k)) * ringPx;
        let posPx = vec2f(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
        let d = length(posPx);
        let tap = textureSampleLevel(dofTex, dofSampler, uv + posPx / dims, 0.0);
        let tapNear = clamp(-tap.a / cocRef, 0.0, 1.0);
        let reach = smoothstep(d - 1.0, d + 1.0, max(max(-tap.a, 0.0) * cocToPx, centerNearPx));
        nearCol += tap.rgb * tapNear * reach;
        nearW += tapNear * reach;
        bgCol += tap.rgb * (1.0 - tapNear); // far/sky samples estimate the background
        bgW += 1.0 - tapNear;
        tapTotal += 1.0;
        // Far gather: taps inside the centre's far-radius, fading out any that are
        // nearer than the centre (foreground must not bleed into a far blur).
        let reachFar = smoothstep(centerFarPx + 1.0, centerFarPx - 1.0, d)
                     * smoothstep(centerCoc - cocRef, centerCoc, tap.a);
        farCol += tap.rgb * reachFar;
        farW += reachFar;
      }
    }
  }

  // Coverage = how much near geometry fills the aperture, scaled so a blade is
  // translucent-but-visible: ~20% aperture fill already reads as solid, so a thin
  // blade (a few taps) stays faintly present rather than vanishing, a clump is
  // opaque, and the sparse smear halo is see-through.
  let coverage = clamp(nearW / (tapTotal * 0.2), 0.0, 1.0);
  let fg = nearCol / max(nearW, 0.0001);
  let bgEstimate = select(center.rgb, bgCol / max(bgW, 0.0001), bgW > 0.0001);
  let farBlurred = farCol / max(farW, 0.0001);
  // What sits behind the near geometry: the sky/far estimate, replaced by the
  // centre's own far blur where the centre itself is a far (background) pixel.
  let behind = mix(bgEstimate, farBlurred, centerFar);
  let composited = mix(behind, fg, coverage);
  // Blend weight (sharp → blur) that postprocess composites with. Track the CoC
  // magnitude directly (`|coc|/depthOfField` = the smoothstep in signedCoc: 0 at
  // the focus plane, easing to 1 at full blur) rather than saturating at a small
  // fraction of the CoC. The old `(nearW+centerNear)*2` with an amplified centerNear
  // hit a=1 by blur≈0.2 — the blur snapped fully on within the first fifth of the
  // focus→blur range, reading as a hard "wall" across the ground plane. This applies
  // to BOTH fields: near (foreground) and far (background) ease in symmetrically.
  // The neighbourhood reach (`smearW`) still forces the blur on where a nearer blade
  // spills over an in-focus/sky pixel, so foreground smears past its silhouette.
  // centerNear/centerFar stay the colour-accumulation weights only.
  let centerBlur = clamp(abs(centerCoc) / max(dof.depthOfField, 1e-4), 0.0, 1.0);
  let smearW = clamp(nearW - centerNear, 0.0, 1.0);
  let a = max(centerBlur, smearW);
  return vec4f(composited, a);
}
