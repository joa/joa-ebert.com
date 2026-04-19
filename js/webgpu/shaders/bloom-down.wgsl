// Bloom Downsample
// ################
//
// Bloom downsample pass (4-corner + center box filter).

struct BloomDownUniforms {
  halfTexel: vec2f,
  pad: vec2f,
}

@group(1) @binding(0) var<uniform> params: BloomDownUniforms;
@group(1) @binding(1) var sourceSampler: sampler;
@group(1) @binding(2) var sourceTexture: texture_2d<f32>;

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

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.texCoord;
  let ht = params.halfTexel;

  var sum = textureSample(sourceTexture, sourceSampler, uv).rgb * 4.0;
  sum += textureSample(sourceTexture, sourceSampler, uv + vec2f(-ht.x, -ht.y)).rgb;
  sum += textureSample(sourceTexture, sourceSampler, uv + vec2f( ht.x, -ht.y)).rgb;
  sum += textureSample(sourceTexture, sourceSampler, uv + vec2f(-ht.x,  ht.y)).rgb;
  sum += textureSample(sourceTexture, sourceSampler, uv + vec2f( ht.x,  ht.y)).rgb;

  return vec4f(sum * 0.125, 1.0);
}
