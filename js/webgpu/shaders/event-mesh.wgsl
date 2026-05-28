// Event Mesh
// ##########
//
// Generic deferred-shading mesh for calendar event modules (flag pole, soccer
// ball, etc.).  Writes albedo / normal / material to the G-buffer so the object
// receives the full PBR deferred-lighting pass including shadows.
//
// Group 1 uniform layout (16 bytes):
//   albedo    vec3f  — base colour
//   roughness f32
// Group 3: model matrix (ObjectUniforms, 64 bytes)

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

struct MeshUniforms {
  albedo: vec3f,
  roughness: f32,
}

struct ObjectUniforms {
  modelMatrix: mat4x4f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
@group(3) @binding(0) var<uniform> object: ObjectUniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let worldPos = object.modelMatrix * vec4f(input.position, 1.0);
  let worldNormal = normalize((object.modelMatrix * vec4f(input.normal, 0.0)).xyz);
  return VertexOutput(frame.projectionMatrix * frame.viewMatrix * worldPos, worldPos.xyz, worldNormal);
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}

@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let n = normalize(input.worldNormal);
  let shinN = 1.0 - mesh.roughness; // smooth surfaces get higher shininess + specular
  return GBufferOutput(
    vec4f(mesh.albedo, 2.0 / 3.0),
    vec4f(n * 0.5 + 0.5, 0.0),
    vec4f(shinN, 0.05, 0.0, shinN * 0.7),
  );
}
