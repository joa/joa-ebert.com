// Bike
// ####
//
// Deferred-shading pass for the road bike GLB. Like the generic event mesh, but
// albedo and material (roughness / metalness) are baked per-vertex from the
// model's glTF materials rather than supplied as a single uniform.

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
  @location(2) color: vec3f,
  @location(3) material: vec2f, // roughness, metalness
  @location(4) emissive: f32,   // self-illumination strength (head/tail lights)
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldNormal: vec3f,
  @location(1) color: vec3f,
  @location(2) material: vec2f,
  @location(3) emissive: f32,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let worldPos = object.modelMatrix * vec4f(input.position, 1.0);
  let worldNormal = normalize((object.modelMatrix * vec4f(input.normal, 0.0)).xyz);
  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * worldPos,
    worldNormal,
    input.color,
    input.material,
    input.emissive,
  );
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}

@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let n = normalize(input.worldNormal);
  let roughness = clamp(input.material.x, 0.15, 1.0);
  let metalness = input.material.y;

  // Phong exponent from roughness (inverse of the deferred pass' mapping
  // roughness = sqrt(2 / (shininess + 2))). Rough surfaces land near 0 and the
  // lighting pass gates specular off entirely.
  let shininess = clamp(2.0 / (roughness * roughness) - 2.0, 0.0, 255.0);
  let specScale = mix(0.25, 0.9, metalness);

  // Emissive strength rides in the normal target's alpha (extraData). The bike
  // shares the text material ID, and text writes 0 there, so the deferred pass
  // reads any non-zero value as self-illumination for the head/tail lights.
  return GBufferOutput(
    vec4f(input.color, 2.0 / 3.0),
    vec4f(n * 0.5 + 0.5, input.emissive),
    vec4f(shininess / 256.0, 0.1, 0.0, specScale),
  );
}
