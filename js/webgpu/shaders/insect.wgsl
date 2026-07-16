// Insects
// #######
//
// Flies and bees rendered as instanced billboard quads. One pipeline drives
// both; the per-pass uniform switches body colour, size, banding, and opacity.
// Kind 0 = fly (small dark speck), kind 1 = bee (banded amber body + wing haze).

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

struct InsectUniforms {
  color: vec3f,
  opacity: f32,
  sizeScale: f32,
  kind: f32,
  ambient: f32,
  pad: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> insect: InsectUniforms;

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
  @location(1) size: f32,
  @location(2) phase: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(linear) quadUV: vec2f,
  @location(1) wing: f32,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let quadPos = QUAD_POS[input.vertexIndex];

  let viewPos = frame.viewMatrix * vec4f(input.instancePosition, 1.0);
  let dist = max(length(viewPos.xyz), 0.001);
  // Flies read as a ~1px speck, bees as a ~3px banded body — both far too small
  // to ever look like a facing card. Sizes are authored against a 900px
  // reference height and scaled by the viewport so they occupy a constant
  // fraction of the frame — otherwise a fixed pixel size looks oversized on the
  // small compact-mode canvas.
  let resScale = frame.resolution.y / 900.0;
  let minPx = select(0.6, 2.2, insect.kind > 0.5);
  let maxPx = select(1.3, 3.6, insect.kind > 0.5);
  let pointSize = clamp(input.size * insect.sizeScale / dist, minPx, maxPx) * resScale;

  let right = vec3f(frame.viewMatrix[0][0], frame.viewMatrix[1][0], frame.viewMatrix[2][0]);
  let up = vec3f(frame.viewMatrix[0][1], frame.viewMatrix[1][1], frame.viewMatrix[2][1]);
  let pixelSize = pointSize / frame.resolution.y;
  let worldOffset = (right * quadPos.x + up * quadPos.y) * pixelSize * dist;
  let billboardPos = input.instancePosition + worldOffset;

  // Wing-beat flicker widens the sprite slightly; also fed to the fragment for wing haze.
  let wing = 0.5 + 0.5 * sin(frame.time * 40.0 + input.phase);

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * vec4f(billboardPos, 1.0),
    QUAD_UV[input.vertexIndex],
    wing,
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let p = (input.quadUV - 0.5) * 2.0;
  let isBee = insect.kind > 0.5;

  // Elongated body: bees read longer along X, flies stay near-round.
  let stretch = select(1.0, 1.7, isBee);
  let body = vec2f(p.x / stretch, p.y);
  let r = length(body);
  let bodyMask = 1.0 - smoothstep(0.55, 1.0, r);

  var color = insect.color;
  var alpha = bodyMask;

  if (isBee) {
    // Soft two-tone banding — at a few px this is a hint of stripe, not a barcode.
    let bands = smoothstep(0.3, 0.95, abs(sin(p.x * 3.0)));
    color = mix(color, color * 0.45, bands * bodyMask);
    // Faint wing haze flaring above/below the body, pulsing with the wing beat.
    let wingHaze = (1.0 - smoothstep(0.6, 1.4, length(vec2f(body.x * 0.7, body.y * 2.2)))) - bodyMask;
    alpha = max(alpha, clamp(wingHaze, 0.0, 1.0) * (0.12 + 0.1 * input.wing));
  }

  alpha *= insect.opacity;
  color *= insect.ambient;
  if (alpha < 0.006) {
    discard;
  }
  return vec4f(color, alpha);
}
