// Grass
// #####
//
// Instanced grass blades with Bezier curve wind animation, outputs to G-buffer.

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

struct GrassUniforms {
  grassHeightFactor: f32,
  grassWidthFactor: f32,
  alphaThreshold: f32,
  dewAmount: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> grass: GrassUniforms;
@group(1) @binding(1) var windNoiseTex: texture_2d<f32>;
@group(1) @binding(2) var windNoiseSampler: sampler;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) texCoord: vec2f,
  @location(2) grassPosition: vec3f,
  @location(3) grassHeight: f32,
  @location(4) grassBaseWidth: f32,
  @location(5) grassRotation: f32,
  @location(6) grassStatic: vec3f,
  @location(7) tuftIn: vec2f,
  @location(8) noiseAdjustIn: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
  @location(1) height: f32,
  @location(2) windOffset: f32,
  @location(3) worldPos: vec3f,
  @location(4) normal: vec3f,
  @location(5) @interpolate(flat) tuft: vec2f,
  @location(6) @interpolate(flat) noiseAdjust: vec3f,
}

fn cubicBezier(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let t2 = t * t;
  let t3 = t2 * t;
  let mt = 1.0 - t;
  let mt2 = mt * mt;
  let mt3 = mt2 * mt;
  return mt3 * p0 + 3.0 * mt2 * t * p1 + 3.0 * mt * t2 * p2 + t3 * p3;
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var grassHeight = select(input.grassHeight * grass.grassHeightFactor, 1.0, input.grassHeight <= 0.0);
  var grassBaseWidth = select(input.grassBaseWidth * grass.grassWidthFactor, 0.04, input.grassBaseWidth <= 0.0);
  let grassPosition = input.grassPosition;

  let xzDist = length(grassPosition - frame.cameraPosition);
  let distFactor = smoothstep(0.0, 15.0, xzDist);
  grassHeight *= mix(1.0, 1.4, distFactor);
  grassBaseWidth *= mix(1.0, 2.0, smoothstep(0.25, 5.0, xzDist));

  let wt = frame.windTime * 0.05;
  let noiseX1 = textureSampleLevel(windNoiseTex, windNoiseSampler, (grassPosition.xz * 0.33 + vec2f(wt, 0.0)) * 0.03125, 0.0).r;
  let noiseZ1 = textureSampleLevel(windNoiseTex, windNoiseSampler, (grassPosition.xz * 0.33 + vec2f(0.0, wt * 0.85)) * 0.03125, 0.0).r;
  let gustNoise = textureSampleLevel(windNoiseTex, windNoiseSampler, (grassPosition.xz * 0.18 + vec2f(wt * 0.4, 0.0)) * 0.03125, 0.0).r;

  let wx = noiseX1 * 2.0 - 1.0;
  let wz = noiseZ1 * 2.0 - 1.0;
  let gustScale = 0.6 + gustNoise * 0.8;

  let rawWind = vec2f(wx, wz) + frame.windDirection * 0.3;
  let rawWindLen = length(rawWind);
  let windMagnitude = select(0.0, abs(wx + wz) * 0.5, rawWindLen > 0.001) * gustScale;
  let normalizedWind = select(vec2f(1.0, 0.0), rawWind / rawWindLen, rawWindLen > 0.001);
  let t = input.position.y;

  let heightCurve = t * t;
  let windAmount = windMagnitude * frame.windStrength * heightCurve * 1.4;

  let p0 = vec3f(0.0, 0.0, 0.0);
  let p1 = vec3f(0.0, grassHeight * 0.3, 0.0);
  let midWind = windAmount * 0.5;
  let p2 = vec3f(
    midWind * normalizedWind.x * 0.7,
    grassHeight * 0.7,
    midWind * normalizedWind.y * 0.7,
  );
  let p3 = vec3f(
    windAmount * normalizedWind.x,
    grassHeight,
    windAmount * normalizedWind.y,
  );

  let curvePos = cubicBezier(p0, p1, p2, p3, t);

  let width = grassBaseWidth * (1.0 - t * t) * 2.5;
  let xOffset = (input.position.x - 0.5) * width;

  let t2 = t * t;
  let mt = 1.0 - t;
  let mt2 = mt * mt;
  let tangent = 3.0 * mt2 * (p1 - p0) + 6.0 * mt * t * (p2 - p1) + 3.0 * t2 * (p3 - p2);

  let cosR = cos(input.grassRotation);
  let sinR = sin(input.grassRotation);
  var rotatedPerp = vec3f(cosR, 0.0, sinR);

  let roll = input.grassStatic.y;
  rotatedPerp = normalize(rotatedPerp + vec3f(0.0, roll, 0.0));

  let normal = normalize(cross(tangent, rotatedPerp));

  let toCamera = normalize(frame.cameraPosition - vec3f(grassPosition.x, 0.0, grassPosition.z));
  let leanVar = input.grassStatic.z;
  let lean = vec3f(-toCamera.x, 0.0, -toCamera.z) * leanVar * (1.0 - t);

  var cursorPush = vec3f(0.0);
  if (frame.cursorRadius > 0.0) {
    let toGrass = grassPosition.xz - frame.cursorWorldPos.xz;
    let dist = length(toGrass);
    let pushFactor = 1.0 - smoothstep(0.0, frame.cursorRadius, dist);
    let pushDir = select(normalize(toGrass), vec2f(1.0, 0.0), dist < 0.001);
    let pushStrength = pushFactor * pushFactor * heightCurve * 0.1;
    cursorPush = vec3f(pushDir.x * pushStrength, -pushStrength * 0.3, pushDir.y * pushStrength);
  }

  let finalPos = curvePos + rotatedPerp * xOffset + lean + cursorPush;

  let groundY = input.grassStatic.x;
  let worldPos = vec4f(
    grassPosition.x + finalPos.x,
    groundY + finalPos.y,
    grassPosition.z + finalPos.z,
    1.0,
  );

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * worldPos,
    input.texCoord,
    t,
    windAmount,
    worldPos.xyz,
    normal,
    input.tuftIn,
    input.noiseAdjustIn,
  );
}

struct FragmentInput {
  @builtin(position) fragCoord: vec4f,
  @location(0) texCoord: vec2f,
  @location(1) height: f32,
  @location(2) windOffset: f32,
  @location(3) worldPos: vec3f,
  @location(4) normal: vec3f,
  @location(5) @interpolate(flat) tuft: vec2f,
  @location(6) @interpolate(flat) noiseAdjust: vec3f,
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}


const BAYER = array<i32, 16>(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

@fragment
fn fragmentMain(input: FragmentInput) -> GBufferOutput {
  let h = input.height;

  let tDist = input.tuft.x;
  let cellSeed = input.tuft.y;

  let isDry = smoothstep(0.68, 0.78, cellSeed);
  let isDark = smoothstep(0.10, 0.25, cellSeed) * (1.0 - isDry);
  let isLush = smoothstep(0.40, 0.58, cellSeed) * (1.0 - isDry) * (1.0 - isDark);

  var baseCol = vec3f(72.0 / 255.0, 105.0 / 255.0, 52.0 / 255.0);
  var midCol = vec3f(88.0 / 255.0, 122.0 / 255.0, 58.0 / 255.0);
  var tipCol = vec3f(148.0 / 255.0, 185.0 / 255.0, 78.0 / 255.0);

  let dryShift = vec3f(0.08, 0.04, -0.09);
  let lushShift = vec3f(-0.02, 0.04, 0.00);
  let darkDim = 1.0 - isDark * 0.18;
  let shift = dryShift * isDry + lushShift * isLush;
  baseCol = (baseCol + shift) * darkDim;
  midCol = (midCol + shift) * darkDim;
  tipCol = (tipCol + shift) * darkDim;

  var grassColor: vec3f;
  if (h < 0.5) {
    grassColor = mix(baseCol, midCol, h * 2.0);
  } else {
    grassColor = mix(midCol, tipCol, (h - 0.5) * 2.0);
  }

  grassColor *= 1.0 - smoothstep(0.05, 0.62, tDist) * 0.17;

  grassColor += input.noiseAdjust * vec3f(0.25, 0.5, 0.125);

  grassColor *= 0.98;

  // Morning dew: blueish-white tint concentrated at blade tips
  let dewTip = smoothstep(0.3, 1.0, h) * grass.dewAmount;
  let dewColor = vec3f(0.72, 0.82, 0.96);
  grassColor = mix(grassColor, dewColor, dewTip * 0.48);
  grassColor += dewTip * 0.06;

  let u = input.texCoord.x;
  let ribDist = abs(u - 0.5) * 2.0;
  let ribDark = 1.0 - smoothstep(0.0, 0.4, ribDist) * 0.30;
  grassColor = mix(baseCol, grassColor, ribDark);

  let edgeDist = min(input.texCoord.x, 1.0 - input.texCoord.x);
  let edgeFade = smoothstep(0.0, 0.32, edgeDist);
  let tipFade = 1.0 - smoothstep(0.84, 1.0, h);
  let alpha = edgeFade * tipFade;

  let bx = i32(input.fragCoord.x) % 4;
  let by = i32(input.fragCoord.y) % 4;
  let dither = f32(BAYER[by * 4 + bx]) / 16.0;
  if (alpha < max(grass.alphaThreshold * 0.3, dither)) {
    discard;
  }

  return GBufferOutput(
    vec4f(grassColor, 0.0),
    vec4f(normalize(input.normal) * 0.5 + 0.5, h),
    vec4f(24.0 / 256.0, 0.0, 0.55, 0.28),
  );
}
