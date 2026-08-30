// Shared sky foundation — uniform structs, sky bindings 0–4, Preetham
// atmosphere, and the mountain heightfield march. Included by sky.wgsl (the
// per-pixel sky) and mountain-pano-bake.wgsl (which renders the mountains into
// a lat-long panorama so the sky pass can replace the march with one sample).

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
  mountainSteps: u32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> sky: SkyUniforms;
@group(1) @binding(1) var mountainHeightmap: texture_2d<f32>;
@group(1) @binding(2) var mountainSampler: sampler;
@group(1) @binding(3) var noiseTex: texture_3d<f32>;
@group(1) @binding(4) var noiseSampler: sampler;

const PI: f32 = 3.14159265;
const NOISE_WRAP: f32 = 32.0;
const NOISE_WRAP_SCALE: vec3f = vec3f(NOISE_WRAP, NOISE_WRAP, NOISE_WRAP); // note: allows us to stretch clouds visually

// Mountain panorama band: mountains occupy dir.y ∈ (−0.01, 0.42] (terrain sits
// 500+ wu out and no higher than 420 wu; renderMountains clips above 0.42), so
// the strip only spans this slice with a small margin. Bake writes it, the sky
// pass samples it — both must agree.
const PANO_Y_MIN: f32 = -0.05;
const PANO_Y_MAX: f32 = 0.45;

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
  // Two problems make the physical sky read purple: Preetham chromaticity trends
  // magenta, and the near-white keyframe horizon color rotates toward violet
  // under AgX. So build a clean blue gradient here — a rich zenith easing to a
  // cyan-leaning (AgX-safe) horizon — and anchor the physical sky strongly to it.
  let horizonBlue = vec3f(0.42, 0.58, 0.78);
  let refSky = mix(horizonBlue, sky.zenithColor, pow(elevation, 0.6));
  // Anchor hard toward blue when the sun is high (where Preetham reads purple),
  // but release it near the horizon so golden-hour warmth survives.
  let highSun = smoothstep(0.12, 0.35, sunElev);
  // Preetham is brightest and most purple right at the horizon; when the sun is
  // high, push the anchor to near-full there to erase the residual purple strip
  // along the mountain line. Gated by highSun so low-sun warmth is untouched.
  let horizonExtra = (1.0 - smoothstep(0.0, 0.15, elevation)) * highSun * 0.06;
  let anchorStr = min(mix(0.2, 0.92, highSun) + horizonExtra, 0.98);
  let corrected = mix(daySky, refSky, anchorStr);
  let blend = smoothstep(-0.1, 0.15, sunElev);
  return mix(nightSky, corrected, blend);
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
  let STEPS: i32 = i32(sky.mountainSteps);
  // Exponential step distribution — dense near T_NEAR, coarse near T_FAR.
  // stepMult = (T_FAR / T_NEAR) ^ (1 / STEPS) ≈ 1.044 at the default 64 steps.
  // The 8-iteration binary refinement below keeps the hit surface accurate even
  // at coarse step counts; only thin-ridge silhouettes degrade.
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
  let hazeDir = normalize(vec3f(rd.x, 0.08, rd.z));
  col = mix(atmosphere(hazeDir), col, haze);

  return vec4f(col * vec3f(0.9, 0.9, 1.0), 1.0);
}
