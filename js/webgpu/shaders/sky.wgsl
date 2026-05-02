// Sky
// ###
//
// Preetham atmosphere, volumetric clouds, stars, moon, mountains, chemtrails.
//
// NOTE: There is a CPU version of renderClouds and cloudDensity in gpu-bake.js.
//       You MUST always keep it in sync when updating sky.wgsl.
//       The authority is always sky.wgsl.
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

struct SkyUniforms {
  zenithColor: vec3f,
  sunIntensity: f32,
  horizonColor: vec3f,
  cloudBase: f32,
  cloudTop: f32,
  cloudCoverage: f32,
  cloudSigmaE: f32,
  cloudSteps: u32,
  cloudShadowSteps: u32,
  moonPhase: f32,
  chemtrailCount: u32,
  chemtrailOpacity: f32,
  chemtrailWidth: f32,
  turbidity: f32,
  overcast: f32,
  pad: f32,
  // Preetham per-frame constants precomputed on CPU (bytes 80–167):
  pYz: f32, pXz: f32, pYzc: f32,
  pFY0: f32, pFx0: f32, pFy0: f32,
  pAY: f32, pBY: f32, pCY: f32, pDY: f32, pEY: f32,
  pAx: f32, pBx: f32, pCx: f32, pDx: f32, pEx: f32,
  pAy: f32, pBy: f32, pCy: f32, pDy: f32, pEy: f32,
  pad2: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> sky: SkyUniforms;
@group(1) @binding(1) var mountainHeightmap: texture_2d<f32>;
@group(1) @binding(2) var mountainSampler: sampler;
@group(1) @binding(3) var noiseTex: texture_3d<f32>;
@group(1) @binding(4) var noiseSampler: sampler;

const PI: f32 = 3.14159265;
const TIME_SCALE: f32 = 0.0001;
const MOON_RADIUS: f32 = 0.03162;
const NOISE_WRAP: f32 = 32.0;
const NOISE_WRAP_SCALE: vec3f = vec3f(NOISE_WRAP, NOISE_WRAP, NOISE_WRAP); // note: allows us to stretch clouds visually

struct SkyVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
  @location(1) rayDir: vec3f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> SkyVertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  let pos = uv * 2.0 - 1.0;
  let viewDir = vec4f((frame.invProjectionMatrix * vec4f(pos, 0.0, 1.0)).xy, -1.0, 0.0);
  return SkyVertexOutput(
    vec4f(pos, 0.9999, 1.0),
    vec2f(uv.x, 1.0 - uv.y),
    (frame.invViewMatrix * viewDir).xyz,
  );
}

// Noise primitives

fn noise3(p: vec3f) -> f32 {
  let uv = vec3f(p.x + frame.time * 0.1, p.y, p.z + frame.time * 0.11) / NOISE_WRAP_SCALE;
  return textureSampleLevel(noiseTex, noiseSampler, uv, 0.0).r;
}

fn fbm5(p_in: vec3f) -> f32 {
  var f: f32 = 0.0;
  var amp: f32 = 0.5;
  var p = p_in;
  for (var i: i32 = 0; i < 4; i++) {
    f += noise3(p) * amp;
    p = p * 2.02 + vec3f(5.1, 1.3, 3.7);
    amp *= 0.5;
  }
  return f;
}

fn fbmDetail(p_in: vec3f) -> f32 {
  var f: f32 = 0.0;
  var amp: f32 = 0.5;
  var p = p_in;
  for (var i: i32 = 0; i < 3; i++) {
    f += noise3(p) * amp;
    p = p * 2.05 + vec3f(1.7, 9.2, 5.3);
    amp *= 0.5;
  }
  return f;
}

// Cloud volume

fn cloudDensity(p: vec3f) -> f32 {
  if (p.y < sky.cloudBase || p.y > sky.cloudTop) {
    return 0.0;
  }
  let relH = (p.y - sky.cloudBase) / (sky.cloudTop - sky.cloudBase);
  let vEnv = smoothstep(0.0, 0.15, relH) * smoothstep(1.0, 0.40, relH);

  var q = p * (1.0 / 45.0);
  let windDrift = frame.windDirection * (frame.windStrength * frame.time * TIME_SCALE * 8.0);
  q += vec3f(windDrift.x, 0.0, windDrift.y);
  let base = fbm5(q);

  let detail = fbm5(q * 3.0 + vec3f(0.5, 1.7, 3.1));
  let detail2 = fbmDetail(q * 6.5 + vec3f(2.3, 0.8, 4.1)) * 0.5;
  let erode = (detail * 0.7 + detail2 * 0.3) * 0.25
            * (1.0 - smoothstep(sky.cloudCoverage, sky.cloudCoverage + 0.15, base));
  let shaped = base - erode;

  let density = smoothstep(sky.cloudCoverage, sky.cloudCoverage + 0.08, shaped) * vEnv;
  return density;
}

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

fn shadowOD(pos: vec3f, sunDir: vec3f) -> f32 {
  let SH_DIST: f32 = 24.0;
  let stepSize = SH_DIST / f32(sky.cloudShadowSteps);
  var od: f32 = 0.0;
  for (var i: i32 = 0; i < i32(sky.cloudShadowSteps); i++) {
    let sp = pos + sunDir * (f32(i) + 0.5) * stepSize;
    od += cloudDensity(sp) * stepSize;
  }
  return od;
}

fn skyRand(co: vec2f) -> f32 {
  return fract(sin(dot(co, vec2f(12.9898, 78.2333))) * 43758.5453);
}

fn renderClouds(rayOrigin: vec3f, rayDir: vec3f, sunDir: vec3f, sunY: f32, noiseUV: vec2f) -> vec4f {
  let rd = normalize(rayDir);
  if (rd.y <= 0.0) {
    return vec4f(0.0);
  }

  let tBot = (sky.cloudBase - rayOrigin.y) / rd.y;
  let tTop = (sky.cloudTop - rayOrigin.y) / rd.y;
  if (tBot < 0.0 && tTop < 0.0) {
    return vec4f(0.0);
  }
  let tMin_raw = max(min(tBot, tTop), 0.0);
  let tMax = max(tBot, tTop);
  let stepSize = (tMax - tMin_raw) / f32(sky.cloudSteps);

  let jitter = skyRand(noiseUV + fract(frame.time * 17.37));
  let tMin = tMin_raw + jitter * stepSize;

  let warmth = smoothstep(0.0, 0.45, sunY);
  let sunCol = mix(sky.horizonColor * 1.5, vec3f(1.02, 1.00, 0.97), warmth);

  let cosTheta = dot(rd, normalize(sunDir));
  let hgBoost = henyeyGreenstein(cosTheta, 0.5) * 4.0 * PI;

  let moonBlend = smoothstep(0.0, -0.2, sunY);
  let moonDir = normalize(vec3f(-sunDir.x, -sunDir.y + 0.1, sunDir.z));
  let lightDir = normalize(mix(sunDir, moonDir, moonBlend));
  let lightY = mix(sunY, moonDir.y, moonBlend) - 0.2;
  let lightCol = mix(sunCol, vec3f(0.72, 0.78, 1.0) * 0.12, moonBlend);

  let slopeFactor = clamp(abs(lightDir.y) * 10.0, 0.0, 1.0);
  let signLY = select(1.0, -1.0, lightDir.y + 0.001 < 0.0);
  let shadowDir = normalize(mix(vec3f(0.0, signLY, 0.0), lightDir, slopeFactor));

  var radiance = vec3f(0.0);
  var transmittance: f32 = 1.0;

  for (var i: i32 = 0; i < i32(sky.cloudSteps); i++) {
    let t = tMin + (f32(i) + 0.5) * stepSize;
    let pos = rayOrigin + rd * t;
    let rho = cloudDensity(pos);
    if (rho < 0.001) {
      continue;
    }

    let od = shadowOD(pos, shadowDir);
    let shadowAtt = exp(-od * sky.cloudSigmaE);

    let relH = clamp((pos.y - sky.cloudBase) / (sky.cloudTop - sky.cloudBase), 0.0, 1.0);
    let topSoften = 1.0 - 0.22 * pow(relH * shadowAtt, 2.5);

    let litScale = select(0.4 * sin(clamp(-lightY / 0.15, 0.0, 1.0) * PI), lightY, lightY >= 0.0);

    let Ldirect = lightCol * litScale
                * shadowAtt
                * (0.72 + 0.28 * hgBoost) * 1.05
                * topSoften;

    let Lambient = sky.zenithColor * (0.12 + 0.28 * relH)
                 + sky.horizonColor * (0.15 + 0.18 * (1.0 - relH));

    let Lsample = Ldirect + Lambient;
    let extinction = rho * sky.cloudSigmaE * stepSize;
    let stepTrans = exp(-extinction);
    let contrib = transmittance * (1.0 - stepTrans);

    radiance += contrib * Lsample;
    transmittance *= stepTrans;

    if (transmittance < 0.01) {
      break;
    }
  }

  var alpha = clamp(1.0 - transmittance, 0.0, 0.95);
  if (alpha < 0.004) {
    return vec4f(0.0);
  }

  let horizFade = smoothstep(0.01, 0.1, rd.y);
  alpha *= horizFade;
  radiance *= horizFade;

  return vec4f(radiance, alpha);
}

// Stars / moon

fn hash2(p_in: vec2f) -> f32 {
  var p = fract(p_in * vec2f(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

fn stars(dir: vec3f) -> f32 {
  let d = normalize(dir);
  if (d.y < 0.0) {
    return 0.0;
  }
  let ad = abs(d);
  var uv: vec2f;
  var faceKey: f32;
  if (ad.x >= ad.y && ad.x >= ad.z) {
    uv = d.yz / ad.x;
    if (d.x > 0.0) { faceKey = 37.1; } else { faceKey = 73.4; }
  } else if (ad.y >= ad.z) {
    uv = d.xz / ad.y;
    faceKey = 113.7;
  } else {
    uv = d.xy / ad.z;
    if (d.z > 0.0) { faceKey = 157.2; } else { faceKey = 211.9; }
  }
  let CELL: f32 = 0.004;
  let cell = floor(uv / CELL);
  let fr = fract(uv / CELL) - 0.5;
  let h = hash2(cell + faceKey);
  if (h < 0.997) {
    return 0.0;
  }
  let magUV = fract((d * 0.28 + vec3f(5.7, 2.1, 8.3)) / NOISE_WRAP_SCALE);
  let mag = textureSampleLevel(noiseTex, noiseSampler, magUV, 0.0).r;
  let spot = smoothstep(0.35, 0.05, length(fr));
  return spot * (0.5 + 0.5 * mag) * (0.9 + 0.1 * sin(frame.time * TIME_SCALE * 8.0 + h * 100.0));
}

// Moon

fn moonValueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn moonRender(dir: vec3f, moonDir: vec3f) -> vec4f {
  let mDir = normalize(moonDir);
  let dotD = dot(normalize(dir), mDir);

  let illumination = (1.0 - cos(2.0 * PI * sky.moonPhase)) / 2.0;

  let discAlpha_raw = smoothstep(0.9991, 0.9995, dotD);
  let coronaAlpha = smoothstep(0.986, 0.999, dotD) * 0.25 * illumination;
  if (discAlpha_raw + coronaAlpha <= 0.0) {
    return vec4f(0.0);
  }

  let worldUp = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(mDir.y) >= 0.99);
  let mRight = normalize(cross(mDir, worldUp));
  let mUpOrtho = cross(mDir, mRight);

  let perp = normalize(dir) - dotD * mDir;
  let mu = dot(perp, mRight) / MOON_RADIUS;
  let mv = dot(perp, mUpOrtho) / MOON_RADIUS;
  let muv = vec2f(mu, mv);

  let termCoef = cos(2.0 * PI * sky.moonPhase);
  let sinAlpha = sqrt(max(0.0, 1.0 - termCoef * termCoef));
  let sunLocal = vec3f(sinAlpha, 0.0, -termCoef);

  let sphereNorm = vec3f(muv.x, muv.y, sqrt(max(0.0, 1.0 - dot(muv, muv))));
  let diffuse = max(0.0, dot(sphereNorm, sunLocal));

  let warp = vec2f(
    moonValueNoise(muv * 2.0 + vec2f(7.31, 3.17)),
    moonValueNoise(muv * 2.0 + vec2f(1.93, 8.42))
  ) * 0.35;
  let wuv = muv + warp;

  let n1 = moonValueNoise(wuv * 1.3 + vec2f(4.73, 1.21));
  let n2 = moonValueNoise(wuv * 2.8 + vec2f(8.14, 5.62));
  let n3 = moonValueNoise(wuv * 5.5 + vec2f(2.91, 7.43));
  let n4 = moonValueNoise(muv * 9.0 + vec2f(5.29, 1.87));
  let n5 = moonValueNoise(muv * 16.0 + vec2f(2.47, 6.13));
  let maria = 0.36 * n1 + 0.27 * n2 + 0.19 * n3 + 0.11 * n4 + 0.07 * n5;

  let deepMare = smoothstep(0.35, 0.52, maria);
  let midMare = smoothstep(0.28, 0.48, maria) * 0.6;
  let lightMare = smoothstep(0.20, 0.42, maria) * 0.3;
  let mariaMask = clamp(deepMare + midMare + lightMare, 0.0, 1.0);

  let highlands = vec3f(0.84, 0.82, 0.78);
  let mariaWarm = vec3f(0.52, 0.51, 0.48);
  let mariaCool = vec3f(0.48, 0.50, 0.53);
  let coolMix = moonValueNoise(muv * 1.6 + vec2f(9.12, 4.56));
  let mariaColor = mix(mariaWarm, mariaCool, coolMix);
  var surf = mix(highlands, mariaColor, mariaMask * 0.58);

  let craterN = moonValueNoise(muv * 11.0 + vec2f(3.71, 7.29));
  let craterN2 = moonValueNoise(muv * 18.0 + vec2f(6.45, 2.18));
  surf += smoothstep(0.85, 0.95, craterN) * 0.12
        + smoothstep(0.88, 0.96, craterN2) * 0.08;

  surf *= 0.95 + 0.05 * n4 + 0.02 * n5;

  let r2 = clamp(dot(muv, muv), 0.0, 1.0);
  surf *= (1.0 - 0.25 * r2);

  surf *= mix(0.06, 1.0, diffuse);
  surf *= vec3f(0.90, 0.92, 1.02);

  let discAlpha = discAlpha_raw * mix(0.15, 1.0, diffuse);

  let moonCol = surf * discAlpha
              + vec3f(0.78, 0.82, 1.0) * coronaAlpha * (1.0 - discAlpha);
  return vec4f(moonCol, max(discAlpha, coronaAlpha));
}

// Preetham 1999 atmospheric scattering

fn perez(cosTheta: f32, gamma: f32, cosGamma: f32,
         A: f32, B: f32, C: f32, D: f32, E: f32) -> f32 {
  return max(0.0, 1.0 + A * exp(B / max(cosTheta, 0.035)))
       * (1.0 + C * exp(D * gamma) + E * cosGamma * cosGamma);
}

fn xyYToRgb(x: f32, y: f32, Y: f32) -> vec3f {
  let yInv = Y / max(y, 0.001);
  let X = yInv * x;
  let Z = yInv * (1.0 - x - y);
  return max(vec3f(
     3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
     0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ), vec3f(0.0)) * 0.0625;
}

fn preethamSky(dir: vec3f, sunDir: vec3f) -> vec3f {
  let cosTheta = max(dir.y, 0.01);
  let cosGamma = clamp(dot(dir, sunDir), -1.0, 1.0);
  let gamma = acos(cosGamma);

  let fY = perez(cosTheta, gamma, cosGamma, sky.pAY, sky.pBY, sky.pCY, sky.pDY, sky.pEY);
  let fx = perez(cosTheta, gamma, cosGamma, sky.pAx, sky.pBx, sky.pCx, sky.pDx, sky.pEx);
  let fy = perez(cosTheta, gamma, cosGamma, sky.pAy, sky.pBy, sky.pCy, sky.pDy, sky.pEy);

  let Y = sky.pYz * fY / max(sky.pFY0, 0.001);
  let x = sky.pXz * fx / max(sky.pFx0, 0.001);
  let y = sky.pYzc * fy / max(sky.pFy0, 0.001);
  let clear = xyYToRgb(x, y, Y);
  let overcastY = sky.pYz * ((1.0 + 2.0 * cosTheta) / 3.0);
  let oc = xyYToRgb(sky.pXz, sky.pYzc, overcastY);
  return mix(clear, oc, clamp(sky.overcast, 0.0, 1.0));
}

fn atmosphere(dir: vec3f) -> vec3f {
  let sunDir = normalize(frame.sunDirection);
  let sunElev = sunDir.y;
  let elevation = clamp(dir.y, 0.0, 1.0);
  let nightSky = mix(sky.horizonColor, sky.zenithColor, pow(elevation, 0.5));
  if (sunElev <= -0.1) {
    return nightSky;
  }
  let daySky = preethamSky(dir, sunDir);
  let blend = smoothstep(-0.1, 0.15, sunElev);
  return mix(nightSky, daySky, blend);
}

// Mountains

fn sampleMtnHeight(xz: vec2f) -> f32 {
  let uv = clamp(xz / 20000.0 + 0.5, vec2f(0.0), vec2f(1.0));
  return textureSampleLevel(mountainHeightmap, mountainSampler, uv, 0.0).r * 420.0;
}

fn sampleMtnNormal(xz: vec2f) -> vec3f {
  let uv = clamp(xz / 20000.0 + 0.5, vec2f(0.0), vec2f(1.0));
  let s = textureSampleLevel(mountainHeightmap, mountainSampler, uv, 0.0);
  return normalize(vec3f(s.g * 2.0 - 1.0, 1.0, s.b * 2.0 - 1.0));
}

// Multi-layer surface albedo: height stratification, slope-aware snow, geological strata.
fn mtnMaterial(pos: vec3f, normal: vec3f) -> vec3f {
  let relH = clamp(pos.y / 420.0, 0.0, 1.0);
  let slope = 1.0 - normal.y;  // 0 = flat, 1 = vertical

  // Height-stratified rock palette (warm lower → cool upper)
  let lowRock   = vec3f(0.23, 0.20, 0.16);
  let midRock   = vec3f(0.19, 0.20, 0.22);
  let highRock  = vec3f(0.16, 0.18, 0.24);
  let cliffRock = vec3f(0.09, 0.10, 0.12);

  var rock = mix(lowRock, midRock, smoothstep(0.12, 0.42, relH));
  rock = mix(rock, highRock, smoothstep(0.52, 0.82, relH));

  // Geological strata: subtle sinusoidal height bands
  let strata = sin(pos.y * 0.48) * 0.012 + sin(pos.y * 1.25) * 0.006;
  rock += vec3f(strata * 0.80, strata * 0.65, strata * 0.45);

  // Micro surface variation from 3D noise
  let detailUV = fract(vec3f(pos.x * 0.007, pos.z * 0.007, 0.37) / NOISE_WRAP_SCALE);
  let detail = textureSampleLevel(noiseTex, noiseSampler, detailUV, 0.0).r;
  rock *= 0.85 + 0.30 * detail;

  // Steep face darkening (vertical cliffs and shadowed crevices)
  rock = mix(rock, cliffRock, smoothstep(0.38, 0.78, slope));

  // Distant vegetation hint at base (seen as subtle green from far away)
  let vegBand = smoothstep(0.04, 0.18, relH) * (1.0 - smoothstep(0.18, 0.33, relH));
  let vegFlat = 1.0 - smoothstep(0.0, 0.42, slope);
  rock = mix(rock, vec3f(0.14, 0.20, 0.09), vegBand * vegFlat * 0.50);

  // Snow: height threshold + slope gate (no snow on cliffs)
  let snowUV = fract(vec3f(pos.x * 0.010, pos.z * 0.010, 0.13) / NOISE_WRAP_SCALE);
  let snowNoise = textureSampleLevel(noiseTex, noiseSampler, snowUV, 0.0).r;
  let snowLine = 110.0 + snowNoise * 60.0;
  let snowFlat = smoothstep(0.50, 0.78, normal.y);
  let snowFactor = smoothstep(snowLine, snowLine + 28.0, pos.y) * snowFlat;
  rock = mix(rock, vec3f(0.92, 0.95, 1.00), snowFactor);

  return rock;
}

fn renderMountains(ro: vec3f, rd: vec3f, sunDir: vec3f) -> vec4f {
  if (rd.y > 0.42) {
    return vec4f(0.0);
  }

  let T_NEAR: f32 = 500.0;
  let T_FAR: f32 = 8000.0;
  let STEPS: i32 = 64;
  // Exponential step distribution — dense near T_NEAR, coarse near T_FAR.
  // stepMult = (T_FAR / T_NEAR) ^ (1 / STEPS) ≈ 1.044
  let stepMult = pow(T_FAR / T_NEAR, 1.0 / f32(STEPS));

  var t: f32 = T_NEAR;
  var prevT: f32 = T_NEAR;
  var hit: bool = false;

  for (var i: i32 = 0; i < STEPS; i++) {
    let pos = ro + rd * t;
    if (pos.y < sampleMtnHeight(pos.xz)) {
      hit = true;
      break;
    }
    prevT = t;
    t *= stepMult;
  }

  if (!hit) {
    return vec4f(0.0);
  }

  // Binary search refinement for precise surface intersection
  var lo: f32 = prevT;
  var hi: f32 = t;
  for (var j: i32 = 0; j < 8; j++) {
    let mid = 0.5 * (lo + hi);
    let midPos = ro + rd * mid;
    if (midPos.y < sampleMtnHeight(midPos.xz)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  t = 0.5 * (lo + hi);
  let pos = ro + rd * t;

  let normal = sampleMtnNormal(pos.xz);
  let rockCol = mtnMaterial(pos, normal);

  let sunUp = max(sunDir.y, 0.0);
  let diffuse = max(dot(normal, normalize(sunDir)), 0.0);

  // Hemisphere ambient: sky tint from above, faint ground bounce from below
  let skyAmbient = mix(sky.horizonColor, sky.zenithColor, normal.y * 0.5 + 0.5) * 0.20;
  let groundBounce = vec3f(0.06, 0.07, 0.05) * max(0.0, 0.2 - normal.y);
  let ambient = skyAmbient + groundBounce;

  var col = rockCol * (diffuse * sunUp + ambient);

  // Night: moon lighting
  if (sunDir.y < 0.1) {
    let nightFactor = smoothstep(0.1, -0.2, sunDir.y);
    let moonDir = normalize(vec3f(-sunDir.x, -sunDir.y + 0.10, sunDir.z));
    let moonDiffuse = max(dot(normal, moonDir), 0.0);
    col += rockCol * moonDiffuse * 0.15 * nightFactor;
    col = mix(col, col * vec3f(0.50, 0.60, 1.0), nightFactor * 0.5);
  }

  // Atmospheric haze matching sky color
  let haze = exp(-t * 0.00045);
  let hazeDir = normalize(vec3f(rd.x, 0.02, rd.z));
  col = mix(atmosphere(hazeDir), col, haze);

  return vec4f(col * vec3f(0.9, 0.9, 1.0), 1.0);
}

// Chemtrails

fn chemtrailSample(rayDir: vec3f, idx: i32) -> f32 {
  let fi = f32(idx);
  let ra = fract(sin(fi * 127.1) * 43758.5453);
  let rb = fract(sin(fi * 311.7) * 43758.5453);
  let rc = fract(sin(fi * 74.7) * 43758.5453);
  let rd_hash = fract(sin(fi * 246.1) * 43758.5453);
  let re = fract(sin(fi * 183.7) * 43758.5453);
  let rf = fract(sin(fi * 419.2) * 43758.5453);

  let az = ra * 6.28318 + frame.time * TIME_SCALE * 0.05 * (rc * 2.0 - 1.0);
  let T_dir = vec3f(sin(az), 0.0, cos(az));

  let altitude = 1200.0 + rd_hash * 800.0;
  let posAz = rb * 6.28318;
  let posR = 600.0 + re * 2200.0;
  let P = vec3f(frame.cameraPosition.x + sin(posAz) * posR,
                altitude,
                frame.cameraPosition.z + cos(posAz) * posR);

  let w = frame.cameraPosition - P;
  let b = dot(rayDir, T_dir);
  let fd = dot(rayDir, w);
  let ed = dot(T_dir, w);
  let den = max(1.0 - b * b, 5e-4);
  let s = (ed - fd * b) / den;
  let tr = s * b - fd;

  if (tr < 10.0) {
    return 0.0;
  }

  let halfLen = 2000.0 + rf * 2000.0;
  let endFade = 1.0 - smoothstep(halfLen - 600.0, halfLen, abs(s));
  if (endFade < 0.001) {
    return 0.0;
  }

  let cr = frame.cameraPosition + rayDir * tr;
  let ct = P + T_dir * s;
  let dist3D = length(cr - ct);
  let angDist = dist3D / tr;
  let wAng = sky.chemtrailWidth * (1.0 + rd_hash * 1.2);
  if (angDist > wAng * 4.0) {
    return 0.0;
  }
  let profile = exp(-angDist * angDist / (wAng * wAng));

  return profile * endFade;
}

fn renderChemtrails(dir: vec3f, sunUp: f32) -> vec3f {
  if (sky.chemtrailCount == 0u) {
    return vec3f(0.0);
  }
  let dayFade = smoothstep(0.0, 0.08, sunUp);
  if (dayFade < 0.001) {
    return vec3f(0.0);
  }
  var result = vec3f(0.0);
  for (var i: i32 = 0; i < i32(sky.chemtrailCount); i++) {
    let fi = f32(i);
    let rd_hash = fract(sin(fi * 246.1) * 43758.5453);
    let alpha = chemtrailSample(dir, i);
    let opacity = sky.chemtrailOpacity * (1.0 - rd_hash * 0.5) * dayFade;
    let sunward = dot(dir, normalize(frame.sunDirection)) * 0.5 + 0.5;
    let col = mix(vec3f(0.95, 0.97, 1.00), vec3f(1.00, 0.99, 0.95), sunward);
    result += col * alpha * opacity;
  }
  return result;
}

@fragment
fn fragmentMain(input: SkyVertexOutput) -> @location(0) vec4f {
  let dir = normalize(input.rayDir);
  var color = atmosphere(dir);

  let sunUp = max(frame.sunDirection.y, 0.0);

  // Dawn/dusk band
  let sunEl = frame.sunDirection.y;
  let dawnBandW = smoothstep(-0.20, 0.30, sunEl) * (1.0 - smoothstep(0.30, 0.60, sunEl));
  let dawnBand = smoothstep(-0.08, 0.22, dir.y) * (1.0 - smoothstep(0.22, 0.55, dir.y));
  let dawnColor = mix(vec3f(1.0, 0.40, 0.10), vec3f(1.0, 0.65, 0.30), sky.sunIntensity);
  color = mix(color, dawnColor, dawnBand * 0.65 * dawnBandW * 0.5);

  // Stars + moon
  if (frame.sunDirection.y < 0.05) {
    let nightBlend = smoothstep(0.05, -0.20, frame.sunDirection.y);
    let moonDir = normalize(vec3f(-frame.sunDirection.x, -frame.sunDirection.y + 0.10, frame.sunDirection.z));
    let moonDisc = smoothstep(0.9991, 0.9995, dot(normalize(dir), normalize(moonDir)));
    color += vec3f(stars(dir)) * 0.85 * nightBlend * (1.0 - moonDisc);
    if (dir.y > -0.05) {
      let moon = moonRender(dir, moonDir);
      color += moon.rgb * moon.a * nightBlend;
    }
  }

  // Chemtrails
  color += renderChemtrails(dir, sunUp);

  // Volumetric clouds
  let clouds = renderClouds(frame.cameraPosition, dir, frame.sunDirection, frame.sunDirection.y, input.texCoord);
  color = mix(color, clouds.rgb, clouds.a);

  // Mountains
  let mountains = renderMountains(frame.cameraPosition, dir, frame.sunDirection);
  color = mix(color, mountains.rgb, mountains.a);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.5)), 1.0);
}
