// Grass
// #####
//
// Instanced grass blades with Bezier curve wind animation, outputs to G-buffer.

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
  @location(7) @interpolate(flat) bladeSeed: f32,
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

  // Per-blade width character. A shared (1 - t*t) taper on every blade is the
  // clone tell; instead each blade hashes its rotation into an overall width
  // scale (thin & wiry ↔ broad & strappy), a taper-shape exponent, and a gentle
  // longitudinal wobble so no two share a silhouette. Squaring the scale hash
  // skews the population toward slimmer blades, with occasional broad ones.
  let wSeed = fract(sin(input.grassRotation * 91.7) * 43758.5453);
  let widthScale = mix(0.6, 1.55, wSeed * wSeed);
  let taperPow = mix(0.65, 2.1, fract(wSeed * 7.3));
  let widthWobble = 1.0 + (vnoise1(t * 4.0 + wSeed * 20.0) - 0.5) * 0.30;
  let width = grassBaseWidth * pow(1.0 - t * t, taperPow) * widthScale * widthWobble * 2.5;
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

  // Distant blades are sub-pixel wide, so their true cross-product normals
  // alias into per-blade sparkle. Fading toward the up vector with the same
  // distance ramp that widens the blades lets the far meadow shade as one calm,
  // coherent surface; the near field keeps full per-blade normal character.
  let trueNormal = normalize(cross(tangent, rotatedPerp));
  let normal = normalize(mix(trueNormal, vec3f(0.0, 1.0, 0.0), distFactor * 0.7));

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

  // Per-blade random seed. grassRotation is a uniform per-blade random; hashing
  // it together with the blade's world position decorrelates it from the
  // clump-level tuft seed so individual blades vary independently.
  let bladeSeed = fract(sin(input.grassRotation * 12.9898 + dot(grassPosition.xz, vec2f(78.233, 37.719))) * 43758.5453);

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * worldPos,
    input.texCoord,
    t,
    windAmount,
    worldPos.xyz,
    normal,
    input.tuftIn,
    input.noiseAdjustIn,
    bladeSeed,
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
  @location(7) @interpolate(flat) bladeSeed: f32,
}

// 1D value noise used to carve ragged silhouettes into the blade quad.
fn h11(x: f32) -> f32 {
  return fract(sin(x * 127.1) * 43758.5453);
}

fn vnoise1(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(h11(i), h11(i + 1.0), u);
}

const BAYER = array<i32, 16>(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

@fragment
fn fragmentMain(input: FragmentInput) -> GBufferOutput {
  let h = input.height;

  let tDist = input.tuft.x;
  let cellSeed = input.tuft.y;

  let isDry = smoothstep(0.80, 0.93, cellSeed);
  let isDark = smoothstep(0.10, 0.25, cellSeed) * (1.0 - isDry);
  let isLush = smoothstep(0.40, 0.58, cellSeed) * (1.0 - isDry) * (1.0 - isDark);

  // Fresh-lawn greens. Green channel stays high (so it never greys out under the
  // bright midday fill) but red is pulled down: the old tip (148,185,78) had an
  // r:g ratio of ~0.8 — a chartreuse/hay yellow. Real grass sits near 0.6.
  var baseCol = vec3f(60.0 / 255.0, 101.0 / 255.0, 49.0 / 255.0);
  var midCol = vec3f(74.0 / 255.0, 119.0 / 255.0, 56.0 / 255.0);
  var tipCol = vec3f(116.0 / 255.0, 175.0 / 255.0, 84.0 / 255.0);

  // Dry clumps read as muted straw/tan (green pulled down), not bright neon
  // yellow — real dead grass is desaturated, not luminous.
  let dryShift = vec3f(0.05, -0.05, -0.08);
  let lushShift = vec3f(-0.02, 0.04, 0.00);
  let darkDim = 1.0 - isDark * 0.18;
  // Per-blade random seeds, decorrelated from one another and from the clump
  // seed so individual blades vary independently of their tuft.
  let bSeed = input.bladeSeed;
  let bHue = fract(bSeed * 7.13);
  let bBright = fract(bSeed * 3.71);
  let bDry = fract(bSeed * 13.37);

  // Hue drift breaks up the single uniform tint that reads as fake grass. Two
  // scales stacked: a broad clump-level drift (warm yellow-green ↔ cool
  // blue-green) plus a stronger per-blade jitter so neighbouring blades in the
  // same tuft no longer read as clones.
  let hueVar = (cellSeed - 0.5) + (bHue - 0.5) * 1.4;
  let hueShift = vec3f(hueVar * 0.05, hueVar * 0.012, -hueVar * 0.045);
  let shift = dryShift * isDry + lushShift * isLush + hueShift;
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

  // Imperfections — the small blemishes that separate a living meadow from a
  // field of shaded clones. All keyed to the per-blade seed so they scatter
  // across individual blades rather than whole clumps.

  // Senescent tips: roughly the drier half of blades brown off from the tip
  // down, further on the driest. Straw-brown and desaturated, not neon yellow.
  let tipBrownAmt = smoothstep(0.5, 1.0, bDry);
  let brownStart = mix(0.9, 0.4, tipBrownAmt);
  let brownTip = smoothstep(brownStart, 1.0, h) * tipBrownAmt;
  grassColor = mix(grassColor, vec3f(0.52, 0.43, 0.21), brownTip * 0.7);

  // Chlorosis: the occasional wholly pale/yellowed blade (nutrient-starved).
  let chlorosis = smoothstep(0.93, 0.99, bDry);
  grassColor = mix(grassColor, vec3f(0.66, 0.70, 0.34), chlorosis * 0.55);

  // Insect/blight flecks: sparse dark specks banded along the blade. Stable in
  // blade space, so they ride the blade as it sways instead of shimmering.
  let fleckN = fract(sin(h * 27.0 + bSeed * 53.0) * 43758.5453);
  let fleck = smoothstep(0.94, 0.99, fleckN) * step(0.35, bSeed);
  grassColor *= 1.0 - fleck * 0.35;

  // Per-blade exposure: some blades simply catch more or less light than their
  // neighbours (canopy shading above, age differences), a strong cue for depth.
  grassColor *= mix(0.84, 1.14, bBright);

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

  // Mesh-silhouette imperfections. The blade is a flat quad in (u, h) space, so
  // carving its coverage reshapes the true outline that the alpha-test resolves.
  // These read only on the silhouette — against the sky and inter-blade gaps —
  // because in a dense sward an interior hole just reveals identical grass
  // behind it. So the emphasis is on fine edge serration + deep marginal notches,
  // not interior pinholes. All keyed to the per-blade seed (flat).
  let seed = bSeed;

  // Torn margins: high-frequency serration (fine teeth — this is what reads as
  // "torn"; a slow wander only bows the edge) plus an occasional deep gnaw. Each
  // side runs an independent profile. Serration frequency is high in h.
  let serrL = vnoise1(h * 55.0 + seed * 31.0);
  let serrR = vnoise1(h * 55.0 + seed * 71.0 + 5.0);
  let gnawL = vnoise1(h * 5.0 + seed * 13.0);
  let gnawR = vnoise1(h * 5.0 + seed * 53.0 + 9.0);
  let eatL = serrL * 0.08 + gnawL * gnawL * gnawL * 0.30;
  let eatR = serrR * 0.08 + gnawR * gnawR * gnawR * 0.30;
  let edgeDist = min(u - eatL, (1.0 - eatR) - u);
  var cover = smoothstep(0.0, 0.035, edgeDist);

  // Jagged / broken tip: the top edge is roughened per blade, and a subset of
  // blades are snapped off well below full height (grazed or wind-broken).
  let tipJag = (vnoise1(u * 9.0 + seed * 23.0) - 0.5) * 0.08;
  let tipCut = mix(0.55, 1.0, smoothstep(0.0, 0.55, fract(seed * 5.1)));
  cover *= 1.0 - smoothstep(tipCut - 0.05 + tipJag, tipCut + tipJag, h);

  // Insect bite: a deep rounded notch chewed from one margin of ~40% of blades.
  if (fract(seed * 13.9) > 0.6) {
    let biteSide = step(0.5, fract(seed * 57.3));
    let biteU = mix(-0.05, 1.05, biteSide);
    let biteH = 0.2 + 0.6 * fract(seed * 91.7);
    let dBite = length(vec2f((u - biteU) * 0.5, h - biteH));
    cover *= smoothstep(0.16, 0.21, dBite);
  }

  let alpha = cover;

  let bx = i32(input.fragCoord.x) % 4;
  let by = i32(input.fragCoord.y) % 4;
  let dither = f32(BAYER[by * 4 + bx]) / 16.0;
  if (alpha < max(grass.alphaThreshold * 0.3, dither)) {
    discard;
  }

  return encodeGBuffer(grassColor, MAT_GRASS, input.normal, vec2f(h, 0.0), input.fragCoord.z);
}
