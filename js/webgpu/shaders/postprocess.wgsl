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
  pad: vec3f,
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

fn habler(x: vec3f) -> vec3f {
  const A: f32 = 0.15;
  const B: f32 = 0.50;
  const C: f32 = 0.10;
  const D: f32 = 0.20;
  const E: f32 = 0.02;
  const F: f32 = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

fn filmicTonemap(x: vec3f) -> vec3f {
  const W: f32 = 1.6;
  return habler(x) / habler(vec3f(W));
}

fn contrastCurve(c_in: vec3f, contrast: f32) -> vec3f {
  let c = clamp(c_in, vec3f(0.0), vec3f(1.0));
  return vec3f(0.5) + (c - vec3f(0.5)) * contrast;
}

// FXAA

fn fxaaLuma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
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

fn hexBokeh(uv: vec2f, resolution: vec2f, sharpColor: vec3f) -> vec3f {
  let raw = ppLoadDepth(uv);
  if (raw >= 0.9999) { return sharpColor; }
  if (i32(round(ppLoadAlbedo(uv).a * 3.0)) == 3) { return sharpColor; }
  let zCenter = lineariseDepth(raw);
  let coc = cocFromDepth(zCenter);
  if (coc < 0.005) { return sharpColor; }

  let pixelSize = 1.0 / resolution;
  let radius = coc * 8.0;
  let dir0 = vec2f(1.0, 0.0);
  let dir1 = vec2f(0.5, 0.866);
  let dir2 = vec2f(-0.5, 0.866);

  var col = vec3f(0.0);
  var total: f32 = 0.0;
  let depthTol = max(zCenter * 0.3, 0.5);

  for (var r: f32 = 1.0; r <= 8.0; r += 1.0) {
    let off = pixelSize * radius * (r / 8.0);
    var taps: array<vec2f, 6>;
    taps[0] = uv + dir0 * off;
    taps[1] = uv - dir0 * off;
    taps[2] = uv + dir1 * off;
    taps[3] = uv - dir1 * off;
    taps[4] = uv + dir2 * off;
    taps[5] = uv - dir2 * off;
    for (var j: i32 = 0; j < 6; j++) {
      let tapRaw = ppLoadDepth(taps[j]);
      let tapZ = select(lineariseDepth(tapRaw), frame.far, tapRaw >= 0.9999);
      let tapCoC = cocFromDepth(tapZ);
      let scatter = smoothstep(0.0, 1.0, tapCoC * 8.0 / max(r, 1.0));
      let depthW = select(1.0, scatter, tapZ < zCenter - depthTol);
      let w = depthW / r;
      col += ppLoadScene(taps[j]).rgb * w;
      total += w;
    }
  }
  col /= max(total, 0.001);
  return mix(sharpColor, col, min(coc * 3.0, 1.0));
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
  let d0 = length(vec2f(dx, dy));
  var result = vec3f(0.0);

  // Central glow
  result += vec3f(1.0, 0.96, 0.88) * exp(-d0 * d0 * 90.0) * 0.5;

  // Eyelash diffraction streaks
  let strX0 = exp(-dx * dx * 2.5);
  result += vec3f(1.0, 0.92, 0.72) * exp(-dy * dy * 600.0) * strX0 * 0.30;
  result += vec3f(0.95, 0.86, 0.65) * exp(-(dy + 0.020) * (dy + 0.020) * 1000.0) * exp(-dx * dx * 5.0) * 0.14;
  result += vec3f(0.92, 0.84, 0.63) * exp(-(dy - 0.016) * (dy - 0.016) * 1100.0) * exp(-dx * dx * 5.5) * 0.13;
  result += vec3f(0.88, 0.78, 0.58) * exp(-(dy + 0.042) * (dy + 0.042) * 1400.0) * exp(-dx * dx * 7.5) * 0.08;
  result += vec3f(0.86, 0.76, 0.56) * exp(-(dy - 0.038) * (dy - 0.038) * 1300.0) * exp(-dx * dx * 8.0) * 0.07;

  return result * baseI;
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
      if (fog.fireflyCount > 0u && fog.fireflyFactor > 0.0) {
        let invRadius = 1.0 / max(fog.fireflyLightRadius, 0.001);
        for (var fi: i32 = 0; fi < i32(fog.fireflyCount); fi++) {
          let ffPos = fog.fireflyData[fi].xyz;
          let ffBright = fog.fireflyData[fi].w;
          let d = length(ffPos - pos);
          if (d >= fog.fireflyLightRadius) { continue; }
          let atten = 1.0 - d * invRadius;
          inScattered += transmittance * fireflyColor
                       * (atten * atten) * ffBright
                       * fog.fireflyFactor * sigma * stepSize;
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

  // 2. DoF + chromatic aberration
  var color: vec3f;
  if (pp.depthOfField > 0.0) {
    if (pp.chromaticAberration > 0.0 && !isBird) {
      let dist = uv - 0.5;
      let amount = pp.chromaticAberration * dot(dist, dist);
      var sharpR: vec4f;
      var sharpB: vec4f;
      if (doFXAA) {
        sharpR = fxaa(uv + vec2f(amount, 0.0), frame.resolution);
        sharpB = fxaa(uv - vec2f(amount, 0.0), frame.resolution);
      } else {
        sharpR = ppLoadScene(uv + vec2f(amount, 0.0));
        sharpB = ppLoadScene(uv - vec2f(amount, 0.0));
      }
      color = hexBokeh(uv, frame.resolution, sharp.rgb);
      color.r = hexBokeh(uv + vec2f(amount, 0.0), frame.resolution, sharpR.rgb).r;
      color.b = hexBokeh(uv - vec2f(amount, 0.0), frame.resolution, sharpB.rgb).b;
    } else {
      color = hexBokeh(uv, frame.resolution, sharp.rgb);
    }
  } else {
    color = sharp.rgb;
    if (pp.chromaticAberration > 0.0 && !isBird) {
      let dist = uv - 0.5;
      let amount = pp.chromaticAberration * dot(dist, dist);
      if (doFXAA) {
        color.r = fxaa(uv + vec2f(amount, 0.0), frame.resolution).r;
        color.b = fxaa(uv - vec2f(amount, 0.0), frame.resolution).b;
      } else {
        color.r = ppLoadScene(uv + vec2f(amount, 0.0)).r;
        color.b = ppLoadScene(uv - vec2f(amount, 0.0)).b;
      }
    }
  }

  // 3. SSAO
  color *= mix(1.0, textureSampleLevel(ssaoTex, ssaoSampler, uv, 0.0).r, pp.ssaoIntensity);

  // 4. Bloom
  color += textureSampleLevel(bloomTex, bloomSampler, uv, 0.0).rgb * pp.bloomIntensity;

  // 5. God rays
  color += textureSampleLevel(godRayTex, godRaySampler, uv, 0.0).rgb * pp.godRayIntensity;

  // 6. Fog
  if (fog.fogIntensity > 0.0) {
    var fogVal: vec4f;
    if (fog.fogQuality > 0.5) {
      let depthForWorld = select(rawDepthMain, 0.9998, isSky);
      fogVal = ppRayMarchFog(frame.cameraPosition, worldPosFromDepth(uv, depthForWorld), isSky, uv);
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
    let aerialColor = mix(vec3f(0.62, 0.74, 0.94), pp.fogColor, 0.30);
    color = mix(color, aerialColor, haze * mix(0.06, 0.65, clamp(frame.sunAboveHorizon * 2.5, 0.0, 1.0)));
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
  var vigUV = uv;
  vigUV *= 1.0 - vigUV.yx;
  color *= mix(1.0, pow(vigUV.x * vigUV.y * 18.0, 0.14), pp.vignetteStrength);

  // 9. Color grading
  color *= pp.cgExposure;
  color = filmicTonemap(color);
  color = contrastCurve(color, pp.cgContrast);
  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luma), color, pp.cgSaturation);
  color += pp.cgLift * (1.0 - color);

  // Lens flare + film grain
  color += lensFlare(uv);
  color += (ppRand(uv + fract(frame.time * 1.618)) - 0.5) * pp.grainStrength * (1.0 - luma * 0.5);

  return vec4f(color, 1.0);
}
