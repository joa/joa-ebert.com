// Ground
// ######
//
// Ground plane with heightmap displacement, outputs to G-buffer.

struct FrameUniforms {
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  invProjectionMatrix: mat4x4f,
  invViewMatrix: mat4x4f,
  viewProjectionMatrix: mat4x4f,
  invViewProjectionMatrix: mat4x4f,
  prevViewProjectionMatrix: mat4x4f,
  lightSpaceMatrix: mat4x4f,
  cameraPosition: vec3f,
  time: f32,
  sunDirection: vec3f,
  windTime: f32,
  moonDirection: vec3f,
  windStrength: f32,
  windDirection: vec2f,
  resolution: vec2f,
  sunAboveHorizon: f32,
  near: f32,
  far: f32,
  deltaTime: f32,
  cursorWorldPos: vec3f,
  cursorRadius: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var groundHeightmap: texture_2d<f32>;
@group(1) @binding(1) var groundHeightmapSampler: sampler;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) texCoord: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
  @location(1) worldPos: vec3f,
  @location(2) normal: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let hmUV = input.position.xz / 80.0 + 0.5;
  let hmData = textureSampleLevel(groundHeightmap, groundHeightmapSampler, hmUV, 0.0);
  let h = hmData.r;
  let nx = hmData.g * 2.0 - 1.0;
  let nz = hmData.b * 2.0 - 1.0;
  let ny = sqrt(max(0.0, 1.0 - nx * nx - nz * nz));
  let worldPos = vec4f(input.position.x, h, input.position.z, 1.0);
  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * worldPos,
    input.texCoord,
    worldPos.xyz,
    normalize(vec3f(nx, ny, nz)),
  );
}

fn hash2d(p: vec2f) -> f32 {
  var q = fract(p * vec2f(0.1031, 0.1030));
  q += dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2d(i);
  let b = hash2d(i + vec2f(1.0, 0.0));
  let c = hash2d(i + vec2f(0.0, 1.0));
  let d = hash2d(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn rot2(p: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn leafNoise(p: vec2f, angle: f32) -> f32 {
  let q = rot2(p, angle);
  return valueNoise(q * vec2f(8.0, 1.0));
}

fn bladeLayer(p: vec2f) -> f32 {
  return leafNoise(p, 0.00) * 0.38
       + leafNoise(p, 1.05) * 0.34
       + leafNoise(p, -0.87) * 0.28;
}

fn patchNoise(p: vec2f) -> f32 {
  return valueNoise(p * 0.30) * 0.55
       + valueNoise(p * 0.92) * 0.30
       + valueNoise(p * 2.70) * 0.15;
}

fn bumpGrad(p: vec2f) -> vec2f {
  let e = 0.05;
  let h0 = bladeLayer(p * 11.0) + valueNoise(p * 6.0) * 0.35;
  let hR = bladeLayer((p + vec2f(e, 0.0)) * 11.0) + valueNoise((p + vec2f(e, 0.0)) * 6.0) * 0.35;
  let hU = bladeLayer((p + vec2f(0.0, e)) * 11.0) + valueNoise((p + vec2f(0.0, e)) * 6.0) * 0.35;
  return vec2f(h0 - hR, h0 - hU) * (1.0 / e * 0.60);
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}

/*@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let xz = input.worldPos.xz;

  let soil = mix(vec3f(0.11, 0.19, 0.07), vec3f(0.18, 0.13, 0.07), 0.2);
  let darkLeaf = vec3f(0.11, 0.19, 0.07);
  let midLeaf = vec3f(0.22, 0.35, 0.13);
  let litLeaf = vec3f(0.34, 0.48, 0.20);
  let dry = vec3f(0.34, 0.32, 0.14);

  let pn = patchNoise(xz);
  var base = mix(soil, darkLeaf, smoothstep(0.18, 0.50, pn));
  base = mix(base, midLeaf, smoothstep(0.40, 0.70, pn));
  base = mix(base, litLeaf, smoothstep(0.68, 0.88, pn) * 0.40);

  let bl = bladeLayer(xz * 12.0);
  base *= 0.80 + bl * 0.32;

  let blFine = bladeLayer(xz * 26.0);
  base *= 0.88 + blFine * 0.18;

  let dryN = valueNoise(xz * 4.6 + vec2f(3.17, 1.89));
  base = mix(base, dry, smoothstep(0.70, 0.88, dryN) * 0.28);

  let seam = valueNoise(xz * 1.9 + vec2f(7.1, 2.3)) * valueNoise(xz * 3.6 + vec2f(1.5, 4.7));
  let soilMask = smoothstep(0.06, 0.09, seam);
  base = mix(base, soil, soilMask);

  let bg = bumpGrad(xz);
  let bumpN = normalize(input.normal + vec3f(-bg.x * 0.55, 0.0, -bg.y * 0.55));
  let creviceAO = mix(0.76, 1.0, soilMask);

  return GBufferOutput(
    vec4f(base, 1.0 / 3.0),
    vec4f(bumpN * 0.5 + 0.5, creviceAO),
    vec4f(20.0 / 256.0, 0.0, 0.0, 0.09),
  );
}*/


@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let soil = mix(vec3f(0.11, 0.19, 0.07), vec3f(0.18, 0.13, 0.07), 0.2);
  return GBufferOutput(
    vec4f(soil, 1.0 / 3.0),
    vec4f(input.normal, 1.0),
    vec4f(20.0 / 256.0, 0.0, 0.0, 0.09),
  );
}