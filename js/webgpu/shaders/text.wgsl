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

@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let flatN_raw = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
  let flatN = select(-flatN_raw, flatN_raw, dot(flatN_raw, input.normal) >= 0.0);
  let albedo = vec3f(1.0, 0.98, 0.95) * 0.75;
  return GBufferOutput(
    vec4f(albedo, 2.0 / 3.0),
    vec4f(flatN * 0.5 + 0.5, 0.0),
    vec4f(80.0 / 256.0, 0.5, 0.5, 0.9),
  );
}
