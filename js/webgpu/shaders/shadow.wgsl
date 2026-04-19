// Shadow
// ######
//
// Shadow pass for instanced grass blades. Alpha-tested depth-only.

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

struct ShadowUniforms {
  alphaThreshold: f32,
  pad: vec3f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> shadow: ShadowUniforms;
@group(1) @binding(1) var windNoiseTex: texture_2d<f32>;
@group(1) @binding(2) var windNoiseSampler: sampler;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) texCoord: vec2f,
  @location(2) grassPosition: vec3f,
  @location(3) grassHeight: f32,
  @location(4) grassBaseWidth: f32,
  @location(5) grassRotation: f32,
  @location(6) grassStatic: vec3f, // .x=groundY .y=roll .z=leanVar
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
  @location(1) height: f32,
}

fn cubicBezier(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let mt = 1.0 - t;
  return mt * mt * mt * p0
       + 3.0 * mt * mt * t * p1
       + 3.0 * mt * t * t * p2
       + t * t * t * p3;
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var grassHeight = select(input.grassHeight, 1.0, input.grassHeight <= 0.0);
  var grassBaseWidth = select(input.grassBaseWidth, 0.04, input.grassBaseWidth <= 0.0);

  let xzDist = length(input.grassPosition - frame.cameraPosition);
  let distFact = smoothstep(0.0, 15.0, xzDist);
  grassHeight *= mix(0.6, 1.0, distFact);
  grassBaseWidth = max(grassBaseWidth, 0.06);

  let wt = frame.windTime * 0.05;
  let noiseX1 = textureSampleLevel(windNoiseTex, windNoiseSampler,
    (input.grassPosition.xz * 0.33 + vec2f(wt, 0.0)) * 0.03125, 0.0).r;
  let noiseZ1 = textureSampleLevel(windNoiseTex, windNoiseSampler,
    (input.grassPosition.xz * 0.33 + vec2f(0.0, wt * 0.85)) * 0.03125, 0.0).r;
  let gustNoise = textureSampleLevel(windNoiseTex, windNoiseSampler,
    (input.grassPosition.xz * 0.18 + vec2f(wt * 0.4, 0.0)) * 0.03125, 0.0).r;

  let wx = noiseX1 * 2.0 - 1.0;
  let wz = noiseZ1 * 2.0 - 1.0;
  let gustScale = 0.6 + gustNoise * 0.8;

  let rawWind = vec2f(wx, wz) + frame.windDirection * 0.3;
  let rawWindLen = length(rawWind);
  let windMagnitude = select(0.0, abs(wx + wz) * 0.5, rawWindLen > 0.001) * gustScale;
  let nWind = select(vec2f(1.0, 0.0), rawWind / rawWindLen, rawWindLen > 0.001);

  let t = input.position.y;
  let windAmount = windMagnitude * frame.windStrength * t * t * 1.4;

  let p0 = vec3f(0.0, 0.0, 0.0);
  let p1 = vec3f(0.0, grassHeight * 0.3, 0.0);
  let p2 = vec3f(
    windAmount * 0.35 * nWind.x,
    grassHeight * 0.7,
    windAmount * 0.35 * nWind.y,
  );
  let p3 = vec3f(
    windAmount * nWind.x,
    grassHeight,
    windAmount * nWind.y
  );
  let curvePos = cubicBezier(p0, p1, p2, p3, t);

  let width = grassBaseWidth * (1.0 - t * t) * 1.5;
  let xOffset = (input.position.x - 0.5) * width;
  let cosR = cos(input.grassRotation);
  let sinR = sin(input.grassRotation);
  var rotatedPerp = vec3f(cosR, 0.0, sinR);
  let roll = input.grassStatic.y;
  rotatedPerp = normalize(rotatedPerp + vec3f(0.0, roll, 0.0));

  let toCamera = normalize(frame.cameraPosition - vec3f(input.grassPosition.x, 0.0, input.grassPosition.z));
  let lean = vec3f(-toCamera.x, 0.0, -toCamera.z) * input.grassStatic.z * (1.0 - t);

  let heightCurve = t * t;
  var cursorPush = vec3f(0.0);
  if (frame.cursorRadius > 0.0) {
    let toGrass = input.grassPosition.xz - frame.cursorWorldPos.xz;
    let dist = length(toGrass);
    let pushFactor = 1.0 - smoothstep(0.0, frame.cursorRadius, dist);
    let pushDir = select(normalize(toGrass), vec2f(1.0, 0.0), dist < 0.001);
    let pushStrength = pushFactor * pushFactor * heightCurve * 0.7;
    cursorPush = vec3f(pushDir.x * pushStrength, -pushStrength * 0.3, pushDir.y * pushStrength);
  }

  let finalPos = curvePos + rotatedPerp * xOffset + lean + cursorPush;
  let groundY = input.grassStatic.x;
  let worldPos = vec4f(
    input.grassPosition.x + finalPos.x,
    groundY + finalPos.y,
    input.grassPosition.z + finalPos.z,
    1.0
  );

  return VertexOutput(frame.lightSpaceMatrix * worldPos, input.texCoord, t);
}

@fragment
fn fragmentMain(input: VertexOutput) {
  let edgeDist = min(input.texCoord.x, 1.0 - input.texCoord.x);
  let edgeFade = smoothstep(0.0, 0.32, edgeDist);
  let tipFade = 1.0 - smoothstep(0.84, 1.0, input.height);
  if (edgeFade * tipFade < shadow.alphaThreshold) {
    discard;
  }
}
