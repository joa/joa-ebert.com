// Bloom Extract
// #############
//
// Bloom bright pixel extraction pass.

struct BloomExtractUniforms {
  threshold: f32,
  pad: vec3f,
}

@group(1) @binding(0) var<uniform> params: BloomExtractUniforms;
@group(1) @binding(1) var sceneSampler: sampler;
@group(1) @binding(2) var sceneTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return VertexOutput(
    vec4f(uv * 2.0 - 1.0, 0.0, 1.0),
    vec2f(uv.x, 1.0 - uv.y),
  );
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(sceneTexture, sceneSampler, input.texCoord).rgb;
  let lum = luminance(color);

  let knee = params.threshold * 0.5;
  let w = clamp((lum - knee) / (2.0 * knee), 0.0, 1.0);

  return vec4f(color * w, 1.0);
}
