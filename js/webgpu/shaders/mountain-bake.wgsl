// Mountain Heightmap Bake
// #######################
//
// One-time GPU bake for mountain heightmap.
// Outputs: R = height/420, G = normal.x packed [0,1], B = normal.z packed [0,1], A = 1.
//
// Gradient noise (Perlin-style, quintic C2) with two-level domain warping and an 8-octave
// ridged multifractal produces sharp ridgelines and eroded valley detail.

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

// Gradient noise — maps each grid point to a unit-length pseudo-random gradient.
fn gHash(p: vec2f) -> vec2f {
  let k = fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
  let a = k * 6.28318530;
  return vec2f(cos(a), sin(a));
}

// Gradient noise with quintic C2 smoothstep — output in [0, 1].
fn gNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let v00 = dot(gHash(i                    ), f                    );
  let v10 = dot(gHash(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0));
  let v01 = dot(gHash(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0));
  let v11 = dot(gHash(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0));
  return 0.5 + 0.70 * mix(mix(v00, v10, u.x), mix(v01, v11, u.x), u.y);
}

// 3-octave FBM for domain warping (cheap, value-range [0,1]).
fn warpFbm(p_in: vec2f) -> f32 {
  var p = p_in;
  var h = 0.0;
  var amp = 0.5;
  for (var i = 0; i < 3; i++) {
    h += gNoise(p) * amp;
    p = p * 2.10 + vec2f(3.7 + f32(i) * 1.13, 7.3 + f32(i) * 2.27);
    amp *= 0.5;
  }
  return h;
}

fn mountainHeight(p: vec2f) -> f32 {
  // Slight rotation breaks axis-aligned ridge bias.
  let CA = 0.9563;
  let SA = 0.2924;
  var q = vec2f(p.x * CA - p.y * SA, p.x * SA + p.y * CA) * 0.00130;

  // Level-1 domain warp — large-scale curvature and valley shaping.
  let w1 = vec2f(
    warpFbm(q * 0.70 + vec2f(1.7, 9.2)),
    warpFbm(q * 0.70 + vec2f(8.3, 2.8)),
  ) * 2.0 - 1.0;
  let q1 = q + w1 * 0.55;

  // Level-2 domain warp — ridge erosion and small-scale irregularity.
  let w2 = vec2f(
    warpFbm(q1 * 1.50 + vec2f(3.1, 5.7)),
    warpFbm(q1 * 1.50 + vec2f(7.2, 1.4)),
  ) * 2.0 - 1.0;
  let q2 = q1 + w2 * 0.20;

  // 8-octave ridged multifractal (IQ-style): inverted noise peak → sharp ridgelines.
  var h = 0.0;
  var amp = 0.5;
  var qr = q2;
  for (var i = 0; i < 8; i++) {
    h += (1.0 - abs(gNoise(qr) * 2.0 - 1.0)) * amp;
    qr = qr * 2.12 + vec2f(5.2 + f32(i) * 1.83, 3.7 + f32(i) * 2.51);
    amp *= 0.46;
  }

  let dist = length(p);
  let heightScale = mix(0.0, 1.0, smoothstep(500.0, 4000.0, dist));
  return pow(max(0.0, h - 0.18), 1.65) * 420.0 * heightScale;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let worldXZ = (input.texCoord - 0.5) * 20000.0;
  let h = mountainHeight(worldXZ);

  // EPS ≈ 1 texel at 2048px resolution (10 wu/texel), captures ridge-scale normals.
  let EPS = 8.0;
  let hL = mountainHeight(worldXZ + vec2f(-EPS, 0.0));
  let hR = mountainHeight(worldXZ + vec2f( EPS, 0.0));
  let hD = mountainHeight(worldXZ + vec2f(0.0, -EPS));
  let hU = mountainHeight(worldXZ + vec2f(0.0,  EPS));
  let n = normalize(vec3f(hL - hR, 2.0 * EPS, hD - hU));

  let nPacked = n * 0.5 + 0.5;
  return vec4f(h / 420.0, nPacked.x, nPacked.z, 1.0);
}
