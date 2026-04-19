// Ground Heightmap Bake
// #####################
//
// One-time procedural bake, no uniforms.
// Outputs: R = height [0,1], G = normal.x packed [0,1], B = normal.z packed [0,1], A = 1.

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) texCoord: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  return VertexOutput(vec4f(input.position, 0.0, 1.0), input.texCoord);
}

fn ghHash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = ghHash(i);
  let b = ghHash(i + vec2f(1.0, 0.0));
  let c = ghHash(i + vec2f(0.0, 1.0));
  let d = ghHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn heightMap(xz: vec2f) -> f32 {
  return valueNoise(xz * 0.08) * 0.60
       + valueNoise(xz * 0.20) * 0.25
       + valueNoise(xz * 0.50) * 0.10
       + valueNoise(xz * 1.20) * 0.05;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let xz = (input.texCoord - 0.5) * 80.0;
  let h = heightMap(xz);

  let eps = 0.16;
  let hL = heightMap(xz + vec2f(-eps, 0.0));
  let hR = heightMap(xz + vec2f(eps, 0.0));
  let hD = heightMap(xz + vec2f(0.0, -eps));
  let hU = heightMap(xz + vec2f(0.0, eps));
  let normal = normalize(vec3f(hL - hR, 2.0 * eps, hD - hU));

  let n = normal * 0.5 + 0.5;
  return vec4f(h, n.x, n.z, 1.0);
}
