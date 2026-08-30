// Sky
// ###
//
// Preetham atmosphere, volumetric clouds, stars, moon, mountains, chemtrails.
//
// NOTE: There is a CPU version of renderClouds and cloudDensity in gpu-bake.js.
//       You MUST always keep it in sync when updating sky.wgsl.
//       The authority is always sky.wgsl.
#include "sky-common.inc.wgsl"

@group(1) @binding(5) var mountainPanoTex: texture_2d<f32>;
@group(1) @binding(6) var mountainPanoSampler: sampler;

const TIME_SCALE: f32 = 0.0001;
const MOON_RADIUS: f32 = 0.03162;
const CLOUD_OVERSHOOT: f32 = 0.2; // clouds spill this fraction of slab height past the base/top planes so the boundary isn't a flat wall
// Output ceiling for the HDR scene buffer. AgX in postprocess maps up to EV +4
// (2^4.026 ≈ 16.3), so 16 lets the ~14× sun disc reach the tonemapper as intended
// while still guarding against runaway values. Must stay ≥ the sun disc drive.
const HDR_CEIL: f32 = 16.0;

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

// Cloud volume

fn cloudDensity(p: vec3f) -> f32 {
  // Wobble the slab's base/top per column with slow, low-frequency noise so cloud
  // bottoms undulate past the nominal cloudBase plane instead of shearing flat.
  let margin = (sky.cloudTop - sky.cloudBase) * CLOUD_OVERSHOOT;
  let wobble = (fbm5(p * (1.0 / 260.0) + vec3f(8.3, 0.0, 2.1)) - 0.47) * margin;
  let slabBase = sky.cloudBase + wobble;
  let slabTop = sky.cloudTop + wobble;

  if (p.y < slabBase || p.y > slabTop) {
    return 0.0;
  }
  let relH = (p.y - slabBase) / (slabTop - slabBase);
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

  let slabMargin = (sky.cloudTop - sky.cloudBase) * CLOUD_OVERSHOOT;
  let tBot = (sky.cloudBase - slabMargin - rayOrigin.y) / rd.y;
  let tTop = (sky.cloudTop + slabMargin - rayOrigin.y) / rd.y;
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

  // Dual-lobe Henyey–Greenstein (Wrenninge / Schneider): a strong forward lobe
  // gives the sunward silver lining, a weak back lobe keeps anti-solar cloud
  // faces softly filled instead of flat.
  let cosTheta = dot(rd, normalize(sunDir));
  let hgBoost = mix(henyeyGreenstein(cosTheta, -0.2), henyeyGreenstein(cosTheta, 0.5), 0.7) * 4.0 * PI;

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
    // Beer–powder (Schneider, "Real-Time Volumetric Cloudscapes of Horizon:
    // Zero Dawn"): light in optically thin regions has not yet in-scattered, so
    // lit cloud edges darken into the cauliflower look. Floored at 0.4 so thin
    // wisps dim rather than go black.
    let powder = mix(0.4, 1.0, 1.0 - exp(-2.0 * od * sky.cloudSigmaE));

    let relH = clamp((pos.y - sky.cloudBase) / (sky.cloudTop - sky.cloudBase), 0.0, 1.0);
    let topSoften = 1.0 - 0.22 * pow(relH * shadowAtt, 2.5);

    let litScale = select(0.4 * sin(clamp(-lightY / 0.15, 0.0, 1.0) * PI), lightY, lightY >= 0.0);

    let Ldirect = lightCol * litScale
                * shadowAtt * powder
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

// Mountains — sampled from the panorama that mountain-pano-bake.wgsl
// re-renders only when sun, camera, or atmosphere move. One bilinear fetch
// replaces the per-pixel heightfield march (renderMountains, now in
// sky-common.inc.wgsl).

fn sampleMountainPano(dir: vec3f) -> vec4f {
  if (dir.y < PANO_Y_MIN || dir.y > PANO_Y_MAX) {
    return vec4f(0.0);
  }
  let u = atan2(dir.x, dir.z) / (2.0 * PI) + 0.5;
  let v = 1.0 - (dir.y - PANO_Y_MIN) / (PANO_Y_MAX - PANO_Y_MIN);
  let s = textureSampleLevel(mountainPanoTex, mountainPanoSampler, vec2f(u, v), 0.0);
  // Sharpen the bilinear hit mask so the ridgeline stays crisp (and gains the
  // antialiasing the hard per-pixel march never had); un-premultiply so edge
  // texels keep the mountain colour instead of dimming toward black.
  let a = smoothstep(0.35, 0.65, s.a);
  return vec4f(s.rgb / max(s.a, 1e-3), a);
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

  // Mountains come from the baked panorama — one sample instead of a 64-step
  // march. Interior pixels (a ≈ 1) still return early so they skip the stars,
  // chemtrails, and the far more expensive cloud march; only the thin
  // antialiased silhouette band pays for the full sky and blends at the end.
  let mountains = sampleMountainPano(dir);
  if (mountains.a >= 0.999) {
    return vec4f(clamp(mountains.rgb, vec3f(0.0), vec3f(HDR_CEIL)), 1.0);
  }

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

  // Sun disc + warm glow. The scene buffer is HDR (rgba16float), so the disc is
  // driven far above 1.0 — near the top of the AgX tonemap's EV range (~16×) — so
  // it survives tonemapping as a blinding white body and blooms hard, reading as
  // the brightest source in frame. Warm (never pink) core. Composited before the
  // clouds below so overcast can occlude it.
  let sunDirN = normalize(frame.sunDirection);
  let sunUpGate = smoothstep(-0.02, 0.10, sunDirN.y);
  if (sunUpGate > 0.0 && dir.y > -0.05) {
    let sd = max(dot(dir, sunDirN), 0.0);
    // Real-sun angular size (~0.5°): a tight, bright disc that blooms round.
    // A broad aureole here would only feed a soft blob, so it is intentionally
    // omitted — the glare comes from bloom + god rays, not a fat glow term.
    // A defined solar body: a round disc with a crisp limb (clips the ceiling so
    // it stays a solid white body through the bloom) rather than only a soft
    // radial falloff, which reads as a gradient smudge. Slightly larger than the
    // true 0.5° so the body survives at web resolution; glare still comes from
    // bloom + god rays, not a fat glow term.
    let disc = smoothstep(0.99982, 0.99991, sd); // ~1.0° disc with a sharp limb
    let core = pow(sd, 3000.0);                   // intense pinpoint core
    let glow = pow(sd, 800.0);                    // tight warm halo
    let coreCol = vec3f(1.0, 0.99, 0.95);
    let warmCol = vec3f(1.0, 0.86, 0.60);
    let sunCol = coreCol * (disc * 14.0 + core * 7.0) + warmCol * glow * 1.0;
    color += sunCol * sunUpGate;
  }

  // Chemtrails
  color += renderChemtrails(dir, sunUp);

  // Volumetric clouds
  let clouds = renderClouds(frame.cameraPosition, dir, frame.sunDirection, frame.sunDirection.y, input.texCoord);
  color = mix(color, clouds.rgb, clouds.a);

  // Mountain silhouette band (0 < a < 1): mountains occlude sky and clouds,
  // matching the interior pixels' early return.
  color = mix(color, mountains.rgb, mountains.a);

  return vec4f(clamp(color, vec3f(0.0), vec3f(HDR_CEIL)), 1.0);
}
