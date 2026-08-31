// Post-Process
// ############
//
// Final composite: FXAA, hex-bokeh DoF, chromatic aberration, SSAO, bloom,
// god rays, fog, aerial perspective, rainbow, vignette, filmic tonemap,
// contrast, saturation, lift, lens flare, film grain.

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

struct PostProcessUniforms {
  fogColor: vec3f,
  depthOfField: f32,
  cgLift: vec3f,
  enableFXAA: f32,
  sunScreenPos: vec2f,
  dofFocusNear: f32,
  dofFocusFar: f32,
  dofBlurNear: f32,
  dofBlurFar: f32,
  bloomIntensity: f32,
  godRayIntensity: f32,
  ssaoIntensity: f32,
  chromaticAberration: f32,
  cgExposure: f32,
  cgContrast: f32,
  cgSaturation: f32,
  lensFlareIntensity: f32,
  grainStrength: f32,
  vignetteStrength: f32,
  rainIntensity: f32,
  rainbowIntensity: f32,
  bikeParams: vec4f,        // x = light count, y = glow intensity, z = flare intensity
  bikePos: array<vec4f, 2>, // xyz = world position of each bike lamp
  bikeColor: array<vec4f, 2>, // rgb = radiant colour of each lamp
}

struct FogUniforms {
  fogColor: vec3f,
  fogDensity: f32,
  fogHeightFalloff: f32,
  fogIntensity: f32,
  fogQuality: f32,
  fogSteps: u32,
  fogWindDir: vec2f,
  fogWindStrength: f32,
  fireflyCount: u32,
  fireflyFactor: f32,
  fireflyLightRadius: f32,
  fogPad: vec2f,
  fireflyData: array<vec4f, 32>,
  bikePos: vec4f,   // xyz = headlight world pos, w = reach (0 = off)
  bikeColor: vec4f, // rgb = beam colour, w = fog scatter intensity
  bikeDir: vec4f,   // xyz = world beam axis (normalised), w = cos(cone half-angle)
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> pp: PostProcessUniforms;
@group(1) @binding(1) var sceneTex: texture_2d<f32>;
@group(1) @binding(2) var sceneSampler: sampler;
@group(1) @binding(3) var depthTex: texture_depth_2d;
@group(1) @binding(4) var depthSampler: sampler;
@group(1) @binding(5) var bloomTex: texture_2d<f32>;
@group(1) @binding(6) var bloomSampler: sampler;
@group(1) @binding(7) var godRayTex: texture_2d<f32>;
@group(1) @binding(8) var godRaySampler: sampler;
@group(1) @binding(9) var ssaoTex: texture_2d<f32>;
@group(1) @binding(10) var ssaoSampler: sampler;
@group(1) @binding(11) var gAlbedoTex: texture_2d<f32>;
@group(1) @binding(12) var gAlbedoSampler: sampler;
@group(1) @binding(13) var<uniform> fog: FogUniforms;
@group(1) @binding(14) var ppNoiseTex: texture_3d<f32>;
@group(1) @binding(15) var ppNoiseSampler: sampler;
@group(1) @binding(16) var dofBlurTex: texture_2d<f32>;

struct FullscreenVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return FullscreenVertexOutput(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}

// Filmic tonemap

fn hue2rgb(h: f32) -> vec3f {
  let hp = h / 60.0;
  let xc = 1.0 - abs((hp - floor(hp / 2.0) * 2.0) - 1.0);
  if (hp < 1.0) { return vec3f(1.0, xc, 0.0); }
  else if (hp < 2.0) { return vec3f(xc, 1.0, 0.0); }
  else if (hp < 3.0) { return vec3f(0.0, 1.0, xc); }
  else if (hp < 4.0) { return vec3f(0.0, xc, 1.0); }
  else if (hp < 5.0) { return vec3f(xc, 0.0, 1.0); }
  else { return vec3f(1.0, 0.0, xc); }
}

// AgX tonemap (Troy Sobotka's AgX; minimal polynomial fit as used by
// three.js / Filament). Consumes linear HDR. AgX's sigmoid bakes in a ~2.2
// display gamma, but this pipeline applies no OETF (non-sRGB swapchain, all
// downstream grading tuned in a roughly-linear domain), so we linearize the
// result with pow(2.2) to land in the same domain the previous Hable curve
// produced. AgX desaturates highlights the way film and camera sensors do,
// which is the main reason it reads as photographic rather than game-like.
fn agxContrastApprox(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
       - 40.14 * x4 * x
       + 31.96 * x4
       - 6.868 * x2 * x
       + 0.4298 * x2
       + 0.1191 * x
       - 0.00232;
}

fn filmicTonemap(colorIn: vec3f) -> vec3f {
  // Rec.709 → AgX working space (inset) and back (outset).
  let inset = mat3x3f(
    vec3f(0.856627153315983, 0.0951212405381588, 0.0482516061458583),
    vec3f(0.137318972929847, 0.761241990602591, 0.101439036467562),
    vec3f(0.11189821299995, 0.0767994186031903, 0.811302368396859),
  );
  let outset = mat3x3f(
    vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405),
  );
  const minEv: f32 = -12.47393;
  const maxEv: f32 = 4.026069;

  var c = inset * max(colorIn, vec3f(0.0));
  c = clamp(log2(max(c, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  c = (c - minEv) / (maxEv - minEv);
  c = agxContrastApprox(c);
  c = outset * c;
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  // Linearize back into the pipeline's no-OETF output domain.
  return pow(c, vec3f(2.2));
}

fn contrastCurve(c_in: vec3f, contrast: f32) -> vec3f {
  let c = clamp(c_in, vec3f(0.0), vec3f(1.0));
  return vec3f(0.5) + (c - vec3f(0.5)) * contrast;
}

// FXAA
//
// The scene is pre-tonemap HDR, so raw luma from a 14× sun pixel would dominate
// the local-contrast heuristics and un-antialias every edge near a bright
// source. fxaaLuma therefore range-compresses (y / (1 + y), monotonic — every
// comparison is preserved, only the absolute thresholds see bounded values).
// Colours themselves stay linear: blending taps in compressed space biases the
// result toward the darker side and smears grass colour into the sky.

fn fxaaLuma(c: vec3f) -> f32 {
  let y = dot(c, vec3f(0.299, 0.587, 0.114));
  return y / (1.0 + y);
}

fn fxaaLoadRGB(uv: vec2f) -> vec3f {
  return textureSampleLevel(sceneTex, sceneSampler, uv, 0.0).rgb;
}

fn fxaa(uv: vec2f, resolution: vec2f) -> vec4f {
  let rcpFrame = 1.0 / resolution;

  let rgbM = fxaaLoadRGB(uv);
  let rgbNW = fxaaLoadRGB(uv + vec2f(-1.0, -1.0) * rcpFrame);
  let rgbNE = fxaaLoadRGB(uv + vec2f(1.0, -1.0) * rcpFrame);
  let rgbSW = fxaaLoadRGB(uv + vec2f(-1.0, 1.0) * rcpFrame);
  let rgbSE = fxaaLoadRGB(uv + vec2f(1.0, 1.0) * rcpFrame);

  let lumaNW = fxaaLuma(rgbNW);
  let lumaNE = fxaaLuma(rgbNE);
  let lumaSW = fxaaLuma(rgbSW);
  let lumaSE = fxaaLuma(rgbSE);
  let lumaM = fxaaLuma(rgbM);

  let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  if (lumaMax - lumaMin < max(0.0312, lumaMax * 0.125)) {
    return vec4f(rgbM, 1.0);
  }

  var dir: vec2f;
  dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));

  let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2f(-8.0), vec2f(8.0)) * rcpFrame;

  let rgbA = 0.5 * (fxaaLoadRGB(uv + dir * (1.0 / 3.0 - 0.5)) +
                     fxaaLoadRGB(uv + dir * (2.0 / 3.0 - 0.5)));
  let rgbB = 0.5 * rgbA + 0.25 * (fxaaLoadRGB(uv + dir * -0.5) +
                                    fxaaLoadRGB(uv + dir * 0.5));

  let lumaB = fxaaLuma(rgbB);
  if (lumaB < lumaMin || lumaB > lumaMax) {
    return vec4f(rgbA, 1.0);
  }
  return vec4f(rgbB, 1.0);
}

// Depth of Field

fn lineariseDepth(raw: f32) -> f32 {
  return frame.near * frame.far / (frame.far - raw * (frame.far - frame.near));
}

fn cocFromDepth(zView: f32) -> f32 {
  let nearBlur = 1.0 - smoothstep(pp.dofBlurNear, pp.dofFocusNear, zView);
  let farBlur = smoothstep(pp.dofFocusFar, pp.dofBlurFar, zView);
  return max(nearBlur, farBlur) * pp.depthOfField;
}

fn ppLoadDepth(uv: vec2f) -> f32 {
  return textureSampleLevel(depthTex, depthSampler, uv, 0);
}

fn ppLoadScene(uv: vec2f) -> vec4f {
  return textureSampleLevel(sceneTex, sceneSampler, uv, 0.0);
}

fn ppLoadAlbedo(uv: vec2f) -> vec4f {
  return textureSampleLevel(gAlbedoTex, gAlbedoSampler, uv, 0.0);
}

// Utility

fn ppRand(co: vec2f) -> f32 {
  return fract(sin(dot(co, vec2f(12.9898, 78.2333))) * 43758.5453);
}

fn worldPosFromDepth(uv: vec2f, rawDepth: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, rawDepth, 1.0);
  let wp = frame.invViewProjectionMatrix * ndc;
  return wp.xyz / wp.w;
}

// Lens Flare

fn lensFlare(uv: vec2f) -> vec3f {
  let sun = pp.sunScreenPos;
  if (sun.x < -0.3 || sun.x > 1.3 || sun.y < -0.3 || sun.y > 1.3 || frame.sunAboveHorizon < 0.02) {
    return vec3f(0.0);
  }

  var sunVis: f32 = 0.0;
  if (sun.x >= 0.0 && sun.x <= 1.0 && sun.y >= 0.0 && sun.y <= 1.0) {
    let px = 5.0 / frame.resolution;
    for (var sx: i32 = -1; sx <= 1; sx++) {
      for (var sy: i32 = -1; sy <= 1; sy++) {
        let depth = ppLoadDepth(sun + vec2f(f32(sx), f32(sy)) * px);
        if (depth >= 0.9999) { sunVis += 1.0; }
      }
    }
    sunVis /= 9.0;
    let edgeDist = min(sun, 1.0 - sun);
    sunVis *= smoothstep(0.0, 0.07, min(edgeDist.x, edgeDist.y));
  }
  if (sunVis < 0.001) {
    return vec3f(0.0);
  }

  let aspect = frame.resolution.x / frame.resolution.y;
  let baseI = sunVis * clamp(frame.sunAboveHorizon * 3.0, 0.0, 1.0) * pp.lensFlareIntensity;

  let dx = (uv.x - sun.x) * aspect;
  let dy = uv.y - sun.y;
  let r = length(vec2f(dx, dy));
  var result = vec3f(0.0);

  // Warm veiling glow — light scattering through wet, squinted lashes. Kept
  // faint; the visible sun disc and bloom already supply most of the core.
  result += vec3f(1.0, 0.96, 0.88) * exp(-r * r * 140.0) * 0.16; // tight core
  result += vec3f(1.0, 0.90, 0.76) * exp(-r * 11.0) * 0.04;      // broad soft halo

  // Eyelash diffraction: faint, irregular streaks smeared vertically from the
  // sun. Upper and lower lashes form a comb of near-vertical fibers; diffraction
  // spreads light into fine rays that hug the vertical axis (a strong pow() bias
  // kills the horizontal, so this reads as squinting rather than a star). Each
  // lash differs in spacing and brightness, so per-ray amplitude is hashed, and
  // two overlapping combs give an organic, uneven fringe.
  let angle = atan2(dy, dx);
  let vertical = pow(abs(sin(angle)), 5.0);    // concentrate onto up/down only
  let flutter = sin(frame.time * 1.3) * 0.015; // subtle blink shimmer
  var lashes: f32 = 0.0;
  for (var oct: i32 = 0; oct < 2; oct++) {
    let freq = select(15.0, 31.0, oct == 1);
    let idx = (angle + flutter) * freq;
    let cell = floor(idx);
    let f = fract(idx) - 0.5;
    let amp = 0.35 + 0.65 * ppRand(vec2f(cell, f32(oct))); // per-lash brightness
    lashes += amp * exp(-f * f * 30.0) * select(1.0, 0.55, oct == 1);
  }
  // Rays stay short and dissolve into the core glow near the center.
  let rayFalloff = exp(-r * 11.0) * smoothstep(0.0, 0.025, r);
  result += vec3f(1.0, 0.93, 0.74) * lashes * vertical * rayFalloff * 0.13;

  return result * baseI;
}

// Bike Lamp Glow + Lens Flare
//
// The head/tail lamps are point sources at known world positions. Project each
// to screen space, test whether the lamp itself is un-occluded (its own emissive
// surface writes depth, so a depth read at the lamp's screen point that is nearer
// than the lamp means something is in front of it), then paint a soft volumetric
// halo (glow) and a classic ghost/streak lens flare. Both are added after the
// tonemap so the sources stay punchy against a dark night sky.

fn bikeLampScreen(i: i32) -> vec3f {
  // Returns (screenUV.xy, rawDepth). z < 0 signals "behind camera / off screen".
  let clip = frame.viewProjectionMatrix * vec4f(pp.bikePos[i].xyz, 1.0);
  if (clip.w <= 0.0) {
    return vec3f(0.0, 0.0, -1.0);
  }
  let ndc = clip.xyz / clip.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}

fn bikeLampVisible(spos: vec2f, lampDepth: f32) -> f32 {
  let occDepth = ppLoadDepth(clamp(spos, vec2f(0.0), vec2f(1.0)));
  // Visible if nothing sits in front of the lamp (or the sample is open sky).
  return select(0.0, 1.0, occDepth >= lampDepth - 0.0015 || occDepth >= 0.9999);
}

fn bikeLightGlow(uv: vec2f) -> vec3f {
  let count = i32(pp.bikeParams.x);
  if (count == 0 || pp.bikeParams.y <= 0.0) {
    return vec3f(0.0);
  }
  let aspect = frame.resolution.x / frame.resolution.y;
  var glow = vec3f(0.0);
  for (var i = 0; i < count; i++) {
    let s = bikeLampScreen(i);
    if (s.z < 0.0) { continue; }
    let vis = bikeLampVisible(s.xy, s.z);
    // Scattered light lingers faintly even when the lamp edges behind geometry.
    let atten = mix(0.15, 1.0, vis);
    let d = (uv - s.xy) * vec2f(aspect, 1.0);
    let r = length(d);
    let core = exp(-r * r / (0.010 * 0.010)) * 0.6; // tight bright centre
    let halo = exp(-r / 0.045) * 0.14;              // soft falloff
    glow += pp.bikeColor[i].rgb * (core + halo) * atten;
  }
  return glow * pp.bikeParams.y;
}

fn bikeLensFlare(uv: vec2f) -> vec3f {
  let count = i32(pp.bikeParams.x);
  if (count == 0 || pp.bikeParams.z <= 0.0) {
    return vec3f(0.0);
  }
  let aspect = frame.resolution.x / frame.resolution.y;
  let auv = (uv - 0.5) * vec2f(aspect, 1.0);
  var flare = vec3f(0.0);
  for (var i = 0; i < count; i++) {
    let s = bikeLampScreen(i);
    if (s.z < 0.0 || s.x < -0.2 || s.x > 1.2 || s.y < -0.2 || s.y > 1.2) { continue; }
    if (bikeLampVisible(s.xy, s.z) < 0.5) { continue; }
    let col = pp.bikeColor[i].rgb;
    let apos = (s.xy - 0.5) * vec2f(aspect, 1.0);
    let toCenter = -apos; // lamp → screen centre; ghosts march along this axis

    // Ghosts: inter-element reflections spaced along the light-centre axis, each
    // a small coloured disc with a per-ghost hue rotation.
    for (var k = 1; k <= 4; k++) {
      let gpos = apos + toCenter * (f32(k) * 0.55);
      let gd = length(auv - gpos);
      let gcol = mix(col, col.bgr, f32(k) / 4.0);
      flare += gcol * exp(-gd * gd * 700.0) * (0.10 / f32(k));
    }

    // Faint halo ring around the point opposite the lamp (through screen centre).
    let haloPos = apos + toCenter * 2.0;
    let hr = length(auv - haloPos);
    flare += col * exp(-pow((hr - 0.16) * 26.0, 2.0)) * 0.04;

    // Anamorphic horizontal streak lancing through the lamp itself.
    let streak = exp(-pow((uv.y - s.y) * aspect, 2.0) * 4000.0) * exp(-abs(uv.x - s.x) * 9.0);
    flare += col * streak * 0.18;
  }
  return flare * pp.bikeParams.z;
}

// Fog (inlined from fog pass)

fn fogNoise3(p: vec3f) -> f32 {
  return textureSampleLevel(ppNoiseTex, ppNoiseSampler, p / 32.0, 0.0).r;
}

fn fogFbm3(p_in: vec3f) -> f32 {
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  var p = p_in;
  for (var i: i32 = 0; i < 2; i++) {
    v += a * fogNoise3(p);
    p = p * 2.1 + vec3f(1.7, 9.2, 3.4);
    a *= 0.5;
  }
  return v;
}

fn fogDensityAt(pos: vec3f) -> f32 {
  let y = pos.y;
  let ceilH = 1.0 + fog.fogHeightFalloff * 1.33;
  let topFade = ceilH * 0.75;
  let heightFactor = smoothstep(-0.3, 0.4, y) * (1.0 - smoothstep(topFade, ceilH, y));
  if (heightFactor < 0.005) {
    return 0.0;
  }
  let windDrift = vec3f(fog.fogWindDir.x, 0.0, fog.fogWindDir.y)
                * fog.fogWindStrength * frame.time * 0.8;
  let np = pos * 0.35 + windDrift;
  var n = fogFbm3(np);
  n = smoothstep(0.15, 0.85, n);
  return fog.fogDensity * fog.fogIntensity * heightFactor * n * 0.35;
}

fn fogOpticalDepth(camPos: vec3f, fragPos: vec3f) -> f32 {
  let D = fog.fogDensity * fog.fogIntensity;
  let ceilH = 1.0 + fog.fogHeightFalloff * 1.33;
  let k = 1.0 / ceilH;
  let dist = length(fragPos - camPos);
  let camY = max(camPos.y, 0.0);
  let fragY = max(fragPos.y, 0.0);
  let dy = abs(fragY - camY);
  var optical: f32;
  if (k < 0.001) {
    optical = D * dist;
  } else {
    let camDens = exp(-k * camY);
    let fragDens = exp(-k * fragY);
    optical = D * abs(camDens - fragDens) * dist / (k * max(dy, 0.001));
  }
  return optical * 0.08;
}

fn ppRayMarchFog(camPos: vec3f, fragPos: vec3f, isSkyFog: bool, noiseUV: vec2f) -> vec4f {
  let MAX_DIST: f32 = 80.0;
  var rayDir: vec3f;
  var totalDist: f32;
  if (isSkyFog) {
    rayDir = normalize(fragPos - camPos);
    totalDist = MAX_DIST;
  } else {
    rayDir = fragPos - camPos;
    totalDist = min(length(rayDir), MAX_DIST);
    rayDir = normalize(rayDir);
  }
  let stepSize = totalDist / f32(fog.fogSteps);
  let jitter = ppRand(noiseUV + fract(frame.time * 17.37)) * stepSize;
  let cosTheta = dot(rayDir, normalize(frame.sunDirection));
  let sunGlow = pow(max(cosTheta, 0.0), 6.0);
  let sunColor = vec3f(1.0, 0.84, 0.50);
  // Ambient fog warms toward amber when the sun is low — scattered sunlight tints the whole fog mass
  let sunLow = (1.0 - smoothstep(0.0, 0.35, frame.sunDirection.y)) * frame.sunAboveHorizon;
  let warmAmbient = mix(vec3f(0.93, 0.95, 0.97), vec3f(1.0, 0.88, 0.62), sunLow * 0.55);
  let ambientFog = mix(warmAmbient, fog.fogColor, 0.25);
  let phaseColor = mix(ambientFog, sunColor,
                       clamp(sunGlow * 0.65 * frame.sunAboveHorizon, 0.0, 1.0));
  // Prefilter fireflies to those whose light sphere the ray actually passes
  // through — one closest-approach test per firefly, instead of a distance test
  // per firefly per march step (32 × 32 in the worst case). The list holds all
  // 32 slots, so the march output is bit-identical to testing every firefly:
  // a capped list would drop whole light spheres for angular sectors of rays,
  // which reads as hard-edged wedges in the fog.
  var nearIdx: array<u32, 32>;
  var nearCount = 0u;
  if (fog.fireflyCount > 0u && fog.fireflyFactor > 0.0) {
    let r = max(fog.fireflyLightRadius, 0.001);
    for (var fi = 0u; fi < min(fog.fireflyCount, 32u); fi++) {
      if (fog.fireflyData[fi].w <= 0.001) { continue; }
      let toF = fog.fireflyData[fi].xyz - camPos;
      let tc = dot(toF, rayDir);
      if (tc < -r || tc > totalDist + r) { continue; }
      let d2 = dot(toF, toF) - tc * tc;
      if (d2 >= r * r) { continue; }
      nearIdx[nearCount] = fi;
      nearCount++;
    }
  }
  var transmittance: f32 = 1.0;
  var inScattered = vec3f(0.0);
  let fireflyColor = vec3f(0.55, 1.0, 0.25);
  for (var i: i32 = 0; i < i32(fog.fogSteps); i++) {
    let t = jitter + f32(i) * stepSize;
    let pos = camPos + rayDir * t;
    let sigma = fogDensityAt(pos);
    if (sigma > 0.0005) {
      let stepT = exp(-sigma * stepSize);
      inScattered += transmittance * phaseColor * sigma * stepSize;
      let invRadius = 1.0 / max(fog.fireflyLightRadius, 0.001);
      for (var ni = 0u; ni < nearCount; ni++) {
        let ffPos = fog.fireflyData[nearIdx[ni]].xyz;
        let ffBright = fog.fireflyData[nearIdx[ni]].w;
        let d = length(ffPos - pos);
        if (d >= fog.fireflyLightRadius) { continue; }
        let atten = 1.0 - d * invRadius;
        inScattered += transmittance * fireflyColor
                     * (atten * atten) * ffBright
                     * fog.fireflyFactor * sigma * stepSize;
      }
      // Headlight beam: a cone of scattered halogen light carving through the fog.
      let bikeReach = fog.bikePos.w;
      if (bikeReach > 0.0) {
        let toL = fog.bikePos.xyz - pos;
        let d = length(toL);
        if (d < bikeReach) {
          let Ld = toL / max(d, 1e-4);
          let cd = dot(-Ld, fog.bikeDir.xyz);
          let coneCos = fog.bikeDir.w;
          let inner = mix(coneCos, 1.0, 0.35);
          let spot = smoothstep(coneCos, inner, cd);
          let atten = 1.0 - d / bikeReach;
          inScattered += transmittance * fog.bikeColor.rgb
                       * (atten * atten) * spot
                       * fog.bikeColor.w * sigma * stepSize;
        }
      }
      transmittance *= stepT;
      if (transmittance < 0.005) { break; }
    }
  }
  return vec4f(inScattered, transmittance);
}

@fragment
fn fragmentMain(input: FullscreenVertexOutput) -> @location(0) vec4f {
  let uv = input.texCoord;
  let isBird = i32(round(ppLoadAlbedo(uv).a * 3.0)) == 3;
  let rawDepthMain = ppLoadDepth(uv);
  let isSky = rawDepthMain >= 0.9999;
  let doFXAA = pp.enableFXAA > 0.5 && !isSky;

  // 1. Sharp base
  var sharp: vec4f;
  if (doFXAA && !isBird) {
    sharp = fxaa(uv, frame.resolution);
  } else {
    sharp = ppLoadScene(uv);
  }

  // 2. DoF composite + chromatic aberration
  // The half-res DoF pass (dof-coc → dof-blur) produced a blurred colour and a
  // blend alpha (own blur ∪ foreground bleed). Composite it over the sharp scene;
  // birds stay crisp. Bilinear upsample of the half-res target is smooth.
  // SSAO is baked into the DoF blur (dof-coc), so apply it to the sharp path
  // here and composite; a naive full-res multiply after DoF put sharp AO on top
  // of blurred grass.
  let ao = mix(1.0, textureSampleLevel(ssaoTex, ssaoSampler, uv, 0.0).r, pp.ssaoIntensity);
  let sharpAO = sharp.rgb * ao;
  var color = sharpAO;
  var dofBlurAmt = 0.0;
  if (pp.depthOfField > 0.0) {
    // Half-res DoF: dof.rgb is the near-field blur, dof.a is how much near blur
    // covers this pixel. Applied to birds too — they're excluded from the CoC so
    // an isolated bird has dof.a = 0 (stays sharp), but a bird *behind* near grass
    // must be covered by the grass smear rather than punching through it.
    let dof = textureSampleLevel(dofBlurTex, sceneSampler, uv, 0.0);
    color = mix(sharpAO, dof.rgb, dof.a);
    dofBlurAmt = dof.a;
  }
  // Lateral chromatic aberration: shift R/B toward the frame edge. Suppressed
  // where the DoF blur is active — the foreground smear lands on sky-depth pixels
  // (coc ≈ 0), so without the (1 − dofBlurAmt) gate CA fringes the smeared blade
  // edges cyan/magenta. It only belongs on the sharp, in-focus parts of the frame.
  if (pp.chromaticAberration > 0.0 && !isBird) {
    let dist = uv - 0.5;
    let amount = pp.chromaticAberration * dot(dist, dist);
    let caW = clamp(1.0 - cocFromDepth(lineariseDepth(rawDepthMain)) * 2.0, 0.0, 1.0) * (1.0 - dofBlurAmt);
    color.r = mix(color.r, ppLoadScene(uv + vec2f(amount, 0.0)).r * ao, caW);
    color.b = mix(color.b, ppLoadScene(uv - vec2f(amount, 0.0)).b * ao, caW);
  }

  // SSAO already applied above (baked into the DoF blur; multiplied onto the
  // sharp path before compositing).

  // Geometry the DoF has blurred away (birds, text, grass) has a composited colour
  // that no longer matches its stored sharp depth. Aerial perspective keys off that
  // sharp depth, so on a blurred blob it tints only the finite-depth core — not the
  // sky around it — redrawing the sharp silhouette on top of the smooth blur.
  // `dofOverride` ramps 0→1 as the blur takes over (past half coverage); aerial
  // fades its contribution out by it. When DoF is off, dofBlurAmt = 0 → override 0
  // and the default look is unchanged. (Fog stays on the true sharp depth: grass and
  // low text sit *inside* the fog layer, so pushing their blurred depth to the far
  // plane over-fogged them into bright banding + dark streaks; birds fly above the
  // fog ceiling where fogDensityAt ≈ 0, so they need no sky-override there.)
  let dofOverride = smoothstep(0.5, 1.0, dofBlurAmt);

  // 4. Bloom
  color += textureSampleLevel(bloomTex, bloomSampler, uv, 0.0).rgb * pp.bloomIntensity;

  // 5. God rays
  color += textureSampleLevel(godRayTex, godRaySampler, uv, 0.0).rgb * pp.godRayIntensity;

  // 6. Fog
  if (fog.fogIntensity > 0.0) {
    var fogVal: vec4f;
    if (fog.fogQuality > 0.5) {
      fogVal = ppRayMarchFog(frame.cameraPosition, worldPosFromDepth(uv, rawDepthMain), isSky, uv);
    } else {
      let worldPos = worldPosFromDepth(uv, rawDepthMain);
      let transmission = exp(-fogOpticalDepth(frame.cameraPosition, worldPos));
      let rayDir = normalize(worldPos - frame.cameraPosition);
      let sunGlow = pow(max(dot(rayDir, normalize(frame.sunDirection)), 0.0), 6.0);
      let sunLowA = (1.0 - smoothstep(0.0, 0.35, frame.sunDirection.y)) * frame.sunAboveHorizon;
      let fogBase = mix(fog.fogColor, vec3f(1.0, 0.88, 0.62), sunLowA * 0.3);
      let inScatter = mix(fogBase, vec3f(1.0, 0.84, 0.50),
                          clamp(sunGlow * 0.65 * frame.sunAboveHorizon, 0.0, 1.0));
      fogVal = vec4f(inScatter * (1.0 - transmission), transmission);
    }
    color = color * fogVal.a + fogVal.rgb;
  }

  // 7. Aerial perspective
  if (rawDepthMain < 0.9999) {
    let haze = 1.0 - exp(-max(lineariseDepth(rawDepthMain) - 8.0, 0.0) * 0.022);
    // AgX-safe cyan-blue base (pale near-white blues rotate to mauve under AgX);
    // fogColor kept at a low weight so time-of-day tint survives without purpling.
    let aerialColor = mix(vec3f(0.42, 0.58, 0.78), pp.fogColor, 0.15);
    let strength = haze * mix(0.06, 0.65, clamp(frame.sunAboveHorizon * 2.5, 0.0, 1.0));
    // Fade out on blurred pixels so the sharp silhouette isn't re-imposed.
    color = mix(color, aerialColor, strength * (1.0 - dofOverride));
  }

  // 7.5. Rainbow
  if (rawDepthMain >= 0.9999) {
    let rayDir = normalize(worldPosFromDepth(uv, 1.0) - frame.cameraPosition);
    let angle = acos(clamp(dot(rayDir, -normalize(frame.sunDirection)), -1.0, 1.0));
    let RAD = radians(1.0);
    let sunGate = smoothstep(0.0, 0.05, frame.sunAboveHorizon)
                * (1.0 - smoothstep(0.65, 0.75, frame.sunAboveHorizon));
    let vis = smoothstep(0.5, 0.8, pp.rainIntensity) * sunGate * pp.rainbowIntensity;
    if (vis > 0.001) {
      let tP = (angle - 41.25 * RAD) / (3.5 * RAD);
      color += hue2rgb((1.0 - clamp(tP * 0.5 + 0.5, 0.0, 1.0)) * 270.0) * (exp(-tP * tP * 1.8) * 0.28 * vis);
      let tS = (angle - 52.5 * RAD) / (2.5 * RAD);
      color += hue2rgb(clamp(tS * 0.5 + 0.5, 0.0, 1.0) * 270.0) * (exp(-tS * tS * 1.8) * 0.11 * vis);
    }
  }

  // 8. Vignette
  // Gentle cos^4-style optical falloff that only touches the far corners. The
  // old pow()-based curve crushed the corners to pure black abruptly — a classic
  // "hide the render edges" tell. This eases in smoothly and never fully darkens.
  let vd = uv - vec2f(0.5);
  let vig = 1.0 - smoothstep(0.20, 0.55, dot(vd, vd)) * 0.30;
  color *= mix(1.0, vig, pp.vignetteStrength);

  // 9. Color grading
  color *= pp.cgExposure;
  color = filmicTonemap(color);
  color = contrastCurve(color, pp.cgContrast);
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luma), color, pp.cgSaturation);
  color += pp.cgLift * (1.0 - color);

  // Lens flare + film grain
  color += lensFlare(uv);
  color += bikeLightGlow(uv);
  color += bikeLensFlare(uv);
  color += (ppRand(uv + fract(frame.time * 1.618)) - 0.5) * pp.grainStrength * (1.0 - luma * 0.5);

  return vec4f(color, 1.0);
}
