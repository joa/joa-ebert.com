// Bird Renderer
// #############
//
// Instanced bird with wing beat animation. Outputs to G-buffer (MRT).

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

struct BirdUniforms {
  birdColor: vec3f,
  wingAmplitude: f32,
  wingBeat: f32,
  birdScale: f32,
  pad: vec2f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> bird: BirdUniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) flex: f32,
  @location(2) inst0: vec4f, // xyz = bird world pos, w = wingPhase
  @location(3) inst1: vec4f, // xyz = forward dir,   w = beatSpeed
  @location(4) inst2: vec4f, // xyz = up dir,        w = unused
}

struct VertexOutput {
  @builtin(position) position: vec4f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let birdPos = input.inst0.xyz;
  let wingPhase = input.inst0.w;
  let forward = normalize(input.inst1.xyz);
  let beatSpeed = input.inst1.w;
  var up = normalize(input.inst2.xyz);
  let right = normalize(cross(forward, up));
  up = normalize(cross(right, forward));

  let beat = sin(frame.time * beatSpeed * bird.wingBeat + wingPhase);
  var localPos = input.position;
  localPos.y += input.flex * beat * bird.wingAmplitude;

  let worldPos = birdPos
    + right   * (localPos.x * bird.birdScale)
    + up      * (localPos.y * bird.birdScale)
    + forward * (localPos.z * bird.birdScale);

  return VertexOutput(frame.projectionMatrix * frame.viewMatrix * vec4f(worldPos, 1.0));
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}

@fragment
fn fragmentMain() -> GBufferOutput {
  return GBufferOutput(
    vec4f(bird.birdColor, 1.0),
    vec4f(0.5, 1.0, 0.5, 0.0),
    vec4f(0.0),
  );
}
