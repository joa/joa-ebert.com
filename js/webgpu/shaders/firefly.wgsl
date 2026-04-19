// Firefly
// #######
//
// Firefly sprites rendered as instanced billboard quads.
// Replaces gl_PointSize/gl_PointCoord with explicit quad geometry.

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

struct FireflySpriteUniforms {
  fireflyFactor: f32,
  pad: vec3f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> firefly: FireflySpriteUniforms;

const QUAD_POS = array<vec2f, 4>(
  vec2f(-0.5, -0.5),
  vec2f( 0.5, -0.5),
  vec2f(-0.5,  0.5),
  vec2f( 0.5,  0.5),
);

const QUAD_UV = array<vec2f, 4>(
  vec2f(0.0, 1.0),
  vec2f(1.0, 1.0),
  vec2f(0.0, 0.0),
  vec2f(1.0, 0.0),
);

struct VertexInput {
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) instancePosition: vec3f,
  @location(1) brightness: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) vBrightness: f32,
  @location(1) @interpolate(linear) quadUV: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let quadPos = QUAD_POS[input.vertexIndex];
  let quadUV = QUAD_UV[input.vertexIndex];
  let viewPos = frame.viewMatrix * vec4f(input.instancePosition, 1.0);
  let dist = max(length(viewPos.xyz), 0.001);
  let pointSize = clamp(200.0 / dist, 2.0, 28.0);
  let right = vec3f(frame.viewMatrix[0][0], frame.viewMatrix[1][0], frame.viewMatrix[2][0]);
  let up = vec3f(frame.viewMatrix[0][1], frame.viewMatrix[1][1], frame.viewMatrix[2][1]);
  let pixelSize = pointSize / frame.resolution.y;
  let worldOffset = (right * quadPos.x + up * quadPos.y) * pixelSize * dist;
  let billboardPos = input.instancePosition + worldOffset;
  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * vec4f(billboardPos, 1.0),
    input.brightness * firefly.fireflyFactor,
    quadUV,
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let r = length(input.quadUV - 0.5) * 2.0;
  let core = exp(-r * r * 14.0);
  let halo = exp(-r * r * 2.2);
  let alpha = (core * 0.8 + halo * 0.2) * input.vBrightness;
  if (alpha < 0.004) {
    discard;
  }
  let color = vec3f(0.72, 1.0, 0.35);
  return vec4f(color * alpha, alpha);
}
