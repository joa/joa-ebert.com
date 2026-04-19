// Particles
// #########
//
// Dust particles rendered as instanced billboard quads.
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

struct ParticleUniforms {
  ambientIntensity: f32,
  pad: vec3f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> particle: ParticleUniforms;

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
  @location(0) particlePosition: vec3f,
  @location(1) particleSize: f32,
  @location(2) particleLife: f32,
  @location(3) particlePhase: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) color: vec3f,
  @location(2) @interpolate(linear) quadUV: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let quadPos = QUAD_POS[input.vertexIndex];

  let t = frame.windTime * 0.25 + input.particlePhase;
  let windScale = frame.windStrength * 0.3;
  let drift = vec3f(
    sin(t * 0.7) * windScale * frame.windDirection.x,
    0.0,
    cos(t * 0.5) * windScale * frame.windDirection.y,
  );
  let pos = input.particlePosition + drift;

  let alpha = smoothstep(0.0, 0.2, input.particleLife) * smoothstep(1.0, 0.8, input.particleLife) * 0.55;

  let viewPos = frame.viewMatrix * vec4f(pos, 1.0);
  let dist = max(length(viewPos.xyz), 0.001);
  let pointSize = clamp(input.particleSize * 280.0 / dist, 1.0, 10.0);

  let right = vec3f(frame.viewMatrix[0][0], frame.viewMatrix[1][0], frame.viewMatrix[2][0]);
  let up = vec3f(frame.viewMatrix[0][1], frame.viewMatrix[1][1], frame.viewMatrix[2][1]);
  let pixelSize = pointSize / frame.resolution.y;
  let worldOffset = (right * quadPos.x + up * quadPos.y) * pixelSize * dist;

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * vec4f(pos + worldOffset, 1.0),
    alpha,
    vec3f(0.92, 0.82, 0.55),
    QUAD_UV[input.vertexIndex],
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let r = length(input.quadUV - 0.5) * 2.0;
  let alpha = exp(-r * r * 4.5) * input.alpha * (particle.ambientIntensity * 0.8 + 0.2);
  if (alpha < 0.005) {
    discard;
  }
  return vec4f(input.color * alpha, alpha);
}
