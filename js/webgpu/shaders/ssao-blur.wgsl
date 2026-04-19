// SSAO Blur
// #########
//
// Bilinear upscale from half-res to full-res. WebGPU depth textures cannot be
// bilinearly sampled, so the depth-weighted bilateral is replaced with hardware
// bilinear on the SSAO texture itself. In smooth-depth scenes (grass, ground)
// the bilateral's depth weights are ≈1.0 everywhere, making it equivalent.

struct FullscreenVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@group(1) @binding(0) var ssaoTex: texture_2d<f32>;
@group(1) @binding(1) var ssaoSampler: sampler;
@group(1) @binding(2) var depthTex: texture_depth_2d;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return FullscreenVertexOutput(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}

@fragment
fn fragmentMain(input: FullscreenVertexOutput) -> @location(0) vec4f {
  let depthDims = textureDimensions(depthTex);
  let depthCoord = vec2i(vec2f(depthDims) * input.texCoord);
  if (textureLoad(depthTex, depthCoord, 0) >= 0.9999) {
    return vec4f(1.0);
  }
  let ao = textureSampleLevel(ssaoTex, ssaoSampler, input.texCoord, 0.0).r;
  return vec4f(vec3f(ao), 1.0);
}
