// Fireworks
// #########
//
// Additive forward-pass billboard quads for firework sparkles.
// Each instance: position (vec3f) + color-alpha (vec4f, alpha encodes life [0,1]).
//
// Vertex buffer layout (two instance-stepped buffers):
//   buffer 0: sparklePosition  vec3f  (stride 12, stepMode instance)
//   buffer 1: sparkleColor     vec4f  (stride 16, stepMode instance — alpha = life)

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

const QUAD_POS = array<vec2f, 4>(
  vec2f(-0.5, -0.5),
  vec2f( 0.5, -0.5),
  vec2f(-0.5,  0.5),
  vec2f( 0.5,  0.5),
);

const SPARKLE_SIZE_WU = 0.12;

struct VertexInput {
  @builtin(vertex_index)   vertexIndex: u32,
  @location(0) sparklePosition: vec3f,
  @location(1) sparkleColor:    vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0)       color:    vec3f,
  @location(1)       alpha:    f32,
  @location(2)       quadUV:   vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let life  = input.sparkleColor.a;
  let alpha = smoothstep(0.0, 0.15, life) * smoothstep(0.0, 0.3, life) * life;

  let right = vec3f(frame.viewMatrix[0][0], frame.viewMatrix[1][0], frame.viewMatrix[2][0]);
  let up    = vec3f(frame.viewMatrix[0][1], frame.viewMatrix[1][1], frame.viewMatrix[2][1]);
  let q     = QUAD_POS[input.vertexIndex];
  let world = input.sparklePosition + (right * q.x + up * q.y) * SPARKLE_SIZE_WU;

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * vec4f(world, 1.0),
    input.sparkleColor.rgb,
    alpha,
    (QUAD_POS[input.vertexIndex] + 0.5),
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let r = length(input.quadUV - 0.5) * 2.0;
  let shape = exp(-r * r * 5.0);
  let a = shape * input.alpha;
  if (a < 0.004) { discard; }
  return vec4f(input.color * a, a);
}
