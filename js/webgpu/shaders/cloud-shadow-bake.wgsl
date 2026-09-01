// Cloud Shadow Bake
// #################
//
// Per-frame cloud shadow bake pass. Fullscreen quad renders shadow intensity.

struct CloudShadowBakeUniforms {
  sunDirection: vec3f,
  cloudBase: f32,
  cloudCoverage: f32,
  windStrength: f32,
  windDirection: vec2f,
  time: f32,
  cloudClumping: f32,
  cloudClumpScale: f32,
  pad: f32,
}

@group(0) @binding(0) var<uniform> u: CloudShadowBakeUniforms;

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

fn cHash(n: f32) -> f32 {
  return fract(sin(n) * 753.5453123);
}

fn cNoise3(pIn: vec3f) -> f32 {
  var p = pIn;
  p.x += u.time * 0.0001;
  p.z += u.time * 0.00011;
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n = i.x + i.y * 157.0 + i.z * 113.0;
  return mix(
    mix(
      mix(cHash(n + 0.0), cHash(n + 1.0), f.x),
      mix(cHash(n + 157.0), cHash(n + 158.0), f.x),
      f.y,
    ),
    mix(
      mix(cHash(n + 113.0), cHash(n + 114.0), f.x),
      mix(cHash(n + 270.0), cHash(n + 271.0), f.x),
      f.y,
    ),
    f.z,
  );
}

fn cFbm(pIn: vec3f) -> f32 {
  var p = pIn;
  var f = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 3; i++) {
    f += cNoise3(p) * amp;
    p = p * 2.02 + vec3f(5.1, 1.3, 3.7);
    amp *= 0.5;
  }
  return f;
}

// Coarse mirror of weatherField() in sky.wgsl. This pass uses its own inline
// hash noise rather than the 3D texture, so it cannot match the sky exactly —
// but it must carry the same clumping, or the ground keeps an even shadow
// stipple under a clumped sky.
fn cWeather(qXZ: vec2f) -> f32 {
  let cellsPerQ = 45.0 / u.cloudClumpScale;
  let boil = u.time * 0.0001;
  var p = vec3f(qXZ.x + boil, 21.7, qXZ.y + boil * 1.1) * cellsPerQ;
  var f = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 3; i++) {
    f += cNoise3(p) * amp;
    p = p * 2.03 + vec3f(3.3, 7.1, 1.9);
    amp *= 0.5;
  }
  return smoothstep(0.30, 0.70, f / 0.875);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let worldXZ = (input.texCoord - 0.5) * 80.0;
  let lightDir = normalize(u.sunDirection);
  var shadow = 1.0;

  if (lightDir.y > 0.001) {
    let t = u.cloudBase / lightDir.y;
    let cloudXZ = worldXZ + lightDir.xz * t;

    let scroll = u.windDirection * (u.windStrength * u.time * 8e-4);
    let qXZ = cloudXZ / 45.0 + scroll;
    let q = vec3f(qXZ.x, 0.0, qXZ.y);

    let coverage = clamp(u.cloudCoverage - (cWeather(qXZ) - 0.5) * u.cloudClumping, 0.02, 0.98);
    let base = cFbm(q);
    let density = smoothstep(coverage, coverage + 0.15, base);
    shadow = mix(1.0, 0.25, density);
  }

  return vec4f(vec3f(shadow), 1.0);
}
