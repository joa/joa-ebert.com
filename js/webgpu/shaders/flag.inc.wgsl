// Flag
// ####
//
// Cloth mesh for a national flag, writing to the G-buffer.
// Vertex positions and normals are computed each frame by the CPU cloth sim
// and streamed via a dynamic vertex buffer.
//
// Include-only chunk: every flag-*.wgsl defines `flagAlbedo(uv: vec2f) -> vec3f`
// (uv.x = 0 at the hoist, uv.y = 0 at the top edge) and includes this file.
//
// Vertex layout (stride 32 bytes):
//   location 0: position  vec3f (bytes 0–11)
//   location 1: normal    vec3f (bytes 12–23)
//   location 2: uv        vec2f (bytes 24–31)

#include "gbuffer.inc.wgsl"

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

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let clip = frame.projectionMatrix * frame.viewMatrix * vec4f(input.position, 1.0);
  return VertexOutput(clip, input.position, input.normal, input.uv);
}

@fragment
fn fragmentMain(input: VertexOutput) -> GBufferOutput {
  let n = normalize(input.normal);
  // Double-sided: flip normal toward camera so back face still shades
  let toCamera = normalize(frame.cameraPosition - input.worldPos);
  let facingN = select(-n, n, dot(n, toCamera) >= 0.0);

  let albedo = flagAlbedo(input.uv);
  return encodeGBuffer(albedo, MAT_FLAG, facingN, NO_PAYLOAD, input.position.z);
}
