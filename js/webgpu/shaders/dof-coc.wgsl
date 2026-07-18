// DoF — Downsample + Circle of Confusion
// ######################################
//
// First half-resolution DoF pass. Downsamples the full-res scene colour (2×2
// box) and computes a *signed* circle of confusion per half-res texel:
//   coc < 0  foreground (near blur), coc > 0  background (far blur), 0 = focus.
// Working at half-res is what makes the gather in dof-blur.wgsl both cheap and
// well-sampled, and the box-downsample pre-blends the thin alpha-tested grass so
// the blur can't smear it into vertical streaks (the full-res gather's failure).

#include "gbuffer.inc.wgsl"

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
@group(1) @binding(1) var sceneTex: texture_2d<f32>;
@group(1) @binding(2) var depthTex: texture_depth_2d;
@group(1) @binding(3) var ssaoTex: texture_2d<f32>;
@group(1) @binding(4) var ssaoSampler: sampler;
@group(1) @binding(5) var gAlbedoTex: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return VertexOutput(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}

fn lineariseDepth(raw: f32) -> f32 {
  return dof.near * dof.far / (dof.far - raw * (dof.far - dof.near));
}

fn signedCoc(zView: f32) -> f32 {
  let nearBlur = 1.0 - smoothstep(dof.dofBlurNear, dof.dofFocusNear, zView);
  let farBlur = smoothstep(dof.dofFocusFar, dof.dofBlurFar, zView);
  return (farBlur - nearBlur) * dof.depthOfField;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let half = vec2i(input.position.xy); // half-res pixel
  let base = half * 2;                  // top-left of the full-res 2×2 block

  var col = vec3f(0.0);
  var nearestRaw = 1.0;
  for (var dy = 0; dy < 2; dy++) {
    for (var dx = 0; dx < 2; dx++) {
      let c = base + vec2i(dx, dy);
      col += textureLoad(sceneTex, c, 0).rgb;
      // Birds (matID 3) are a stylistic sharp flock — exclude them from the CoC
      // so they never defocus into opaque bokeh blobs. Treat as far (raw 1.0).
      let isBird = decodeMatID(textureLoad(gAlbedoTex, c, 0).a) == MAT_BIRD;
      nearestRaw = min(nearestRaw, select(textureLoad(depthTex, c, 0), 1.0, isBird));
    }
  }
  col *= 0.25;

  // Bake ambient occlusion into the colour *before* the blur, so the AO is
  // blurred together with the scene. Applying it full-res in postprocess (after
  // the DoF composite) left sharp AO sitting on top of blurred grass.
  let ao = mix(1.0, textureSampleLevel(ssaoTex, ssaoSampler, input.texCoord, 0.0).r, dof.ssaoIntensity);
  col *= ao;

  // Foreground-biased CoC: take the nearest of the four depths so a near edge
  // inside the block wins, which is what should spill outward.
  let coc = signedCoc(lineariseDepth(nearestRaw));
  return vec4f(col, coc);
}
