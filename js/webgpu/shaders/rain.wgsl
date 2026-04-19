// Rain
// ####
//
// Instanced rain streaks (lines). Forward pass with alpha blending.

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

struct RainUniforms {
  rainIntensity: f32,
  pad: vec3f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> rain: RainUniforms;

// GLSL-style mod: x - floor(x/y)*y
fn fmod(x: f32, y: f32) -> f32 {
  return x - floor(x / y) * y;
}

struct VertexInput {
  @location(0) lineOffset: f32,  // 0 for head, 1 for tail
  @location(1) rainPos: vec3f,   // Instance random position [0, 1]
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let size = 30.0;
  let halfSize = size * 0.5;

  var pos = input.rainPos;

  let speed = 1.2;
  pos.y = fract(pos.y - frame.time * speed);

  var localPos = (pos - 0.5) * size;

  let windSlant = frame.windStrength * 5.0;
  localPos.x += frame.windDirection.x * windSlant * (1.0 - pos.y);
  localPos.z += frame.windDirection.y * windSlant * (1.0 - pos.y);

  let tailLength = 0.4;
  let windLateral = frame.windDirection * frame.windStrength * 0.5;
  let dropDir = normalize(vec3f(windLateral.x, -1.0, windLateral.y));
  localPos += dropDir * (input.lineOffset * tailLength);

  var worldPos = frame.cameraPosition + localPos;
  worldPos.x = frame.cameraPosition.x + fmod(worldPos.x - frame.cameraPosition.x + halfSize, size) - halfSize;
  worldPos.y = frame.cameraPosition.y + fmod(worldPos.y - frame.cameraPosition.y + halfSize, size) - halfSize;
  worldPos.z = frame.cameraPosition.z + fmod(worldPos.z - frame.cameraPosition.z + halfSize, size) - halfSize;

  let dist = length(worldPos - frame.cameraPosition);
  let alpha = smoothstep(halfSize, halfSize * 0.7, dist) * rain.rainIntensity;

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * vec4f(worldPos, 1.0),
    alpha,
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (input.alpha <= 0.0) {
    discard;
  }
  return vec4f(0.85, 0.9, 1.0, input.alpha * 0.5);
}
