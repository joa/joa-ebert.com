// Text
// ####
//
// Text mesh rendering to G-buffer (MRT). Vertex + fragment combined.

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

struct ObjectUniforms {
  modelMatrix: mat4x4f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(3) @binding(0) var<uniform> object: ObjectUniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let worldPos = object.modelMatrix * vec4f(input.position, 1.0);
  let worldNormal = normalize((object.modelMatrix * vec4f(input.normal, 0.0)).xyz); // ok for uniform scale
  return VertexOutput(frame.projectionMatrix * frame.viewMatrix * worldPos, worldPos.xyz, worldNormal);
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}

// Value noise (hashed integer lattice, trilinearly interpolated). Cheap enough
// to run a handful of taps per text pixel; used to break up the flat cast-stone
// surface with mottling and a bump-mapped micro-relief.
fn hash13(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

fn valueNoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let c000 = hash13(i + vec3f(0.0, 0.0, 0.0));
  let c100 = hash13(i + vec3f(1.0, 0.0, 0.0));
  let c010 = hash13(i + vec3f(0.0, 1.0, 0.0));
  let c110 = hash13(i + vec3f(1.0, 1.0, 0.0));
  let c001 = hash13(i + vec3f(0.0, 0.0, 1.0));
  let c101 = hash13(i + vec3f(1.0, 0.0, 1.0));
  let c011 = hash13(i + vec3f(0.0, 1.0, 1.0));
  let c111 = hash13(i + vec3f(1.0, 1.0, 1.0));
  let x00 = mix(c000, c100, u.x);
  let x10 = mix(c010, c110, u.x);
  let x01 = mix(c001, c101, u.x);
  let x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn fbm(p: vec3f) -> f32 {
  return valueNoise(p) * 0.6 + valueNoise(p * 2.7 + 11.3) * 0.3 + valueNoise(p * 6.1 + 41.7) * 0.1;
}

@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let flatN_raw = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
  var flatN = select(-flatN_raw, flatN_raw, dot(flatN_raw, input.normal) >= 0.0);

  let wp = input.worldPos;

  // Cast-stone mottling: a coarse blotch pattern plus fine grain. Real cast
  // concrete/limestone is never a single flat tone — pigment pools and the
  // aggregate shows through as light/dark drift across the surface.
  let mottle = fbm(wp * 2.3);
  let grain = valueNoise(wp * 18.0);

  var albedo = vec3f(1.0, 0.98, 0.95) * 0.74;
  // Broad tonal drift, then a cooler/warmer pull so patches read as different
  // pours of stone rather than a printed gradient.
  albedo *= 0.84 + 0.16 * mottle;
  albedo = mix(albedo, albedo * vec3f(0.94, 0.92, 0.86), (1.0 - mottle) * 0.5);
  albedo += (grain - 0.5) * 0.03;

  // Base grime + contact occlusion. The letters are bedded in the meadow; dirt
  // and moss climb the lowest band and the ground plane ambient-occludes the
  // stone where it meets the soil — this is the contact shadow the SSAO pass
  // deliberately skips for text (grass is excluded from occluding letters).
  let baseAmt = 1.0 - smoothstep(0.1, 1.35, wp.y);
  let grimeTone = mix(vec3f(0.36, 0.40, 0.30), vec3f(0.22, 0.26, 0.20), mottle); // mossy soil
  albedo = mix(albedo, grimeTone, baseAmt * (0.35 + 0.25 * mottle));
  // Contact occlusion: a tight, hard darkening in the lowest band where the
  // stone beds into the sward — the ambient-occlusion crease the SSAO pass
  // deliberately skips for text (grass is excluded from occluding letters).
  let contact = 1.0 - smoothstep(0.08, 0.5, wp.y);
  albedo *= 1.0 - contact * 0.45;
  // Downward-facing stone (letter undersides, insets) collects the most dirt and
  // sees the least sky — darken it so the geometry reads as occluded, not flat.
  let downAO = 1.0 - max(-flatN.y, 0.0) * 0.30;
  albedo *= downAO;

  // Micro-relief bump: perturb the flat face normal along the noise gradient so
  // grazing sunlight rakes across surface imperfections instead of a mirror-flat
  // slab. Forward differences on the same fbm field.
  let e = 0.04;
  let n0 = fbm(wp * 12.0);
  let gx = fbm(wp * 12.0 + vec3f(e, 0.0, 0.0)) - n0;
  let gy = fbm(wp * 12.0 + vec3f(0.0, e, 0.0)) - n0;
  let gz = fbm(wp * 12.0 + vec3f(0.0, 0.0, e)) - n0;
  flatN = normalize(flatN - vec3f(gx, gy, gz) * 2.2);

  // Roughness varies with grain (weathered patches are rougher). Encoded as the
  // legacy Phong exponent in material.r; higher exponent = smoother.
  let shininess = mix(55.0, 105.0, mottle) * mix(1.0, 0.7, baseAmt);

  return GBufferOutput(
    vec4f(albedo, 2.0 / 3.0),
    vec4f(flatN * 0.5 + 0.5, 0.0),
    vec4f(shininess / 256.0, 0.5, 0.5, 0.9),
  );
}
