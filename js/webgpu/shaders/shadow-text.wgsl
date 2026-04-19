// Shadow (Text)
// #############
//
// Depth-only shadow pass for text mesh.

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
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  return VertexOutput(frame.lightSpaceMatrix * object.modelMatrix * vec4f(input.position, 1.0));
}

@fragment
fn fragmentMain() {
}
