import S from "./settings.js"
import { lerp, smoothstep } from "./math-utils.js"
import { solarElevationAzimuth, solarDirection, dateForLocalHour } from "./solar.js"
import { Prng } from "./prng.js"

const seed = ((d) => d.getFullYear() + (d.getMonth() + 1) * 31 + d.getDate())(S.date)
const rng = new Prng(seed)

const PERIOD_NIGHT = "night"
const PERIOD_DAWN = "dawn"
const PERIOD_GOLDEN = "golden"
const PERIOD_DAY = "day"

const RAINY_DAY = rng.next() > 0.65
const CLOUDY_DAY = rng.next() <= 0.5

const pickCloudParameters = () => {
  if (!RAINY_DAY && CLOUDY_DAY) {
    const cloudTop = 130.0 + (rng.next() - 0.5) * 10.0
    return {
      cloudBase: cloudTop - (30.0 + rng.next() * 50.0),
      cloudTop,
      cloudCoverage: 0.39 + (rng.next() - 0.5) * 0.1,
      cloudSigmaE: 0.09 + (rng.next() - 0.5) * 0.005,
    }
  }

  return {
    cloudBase: 65.0 - rng.next() * 15.0,
    cloudTop:89.0 + rng.next() * 11.0,
    cloudCoverage: 0.55 + (rng.next() - 0.5) * 0.1,
    cloudSigmaE: 0.01 + rng.next() * 0.05,
  }
}

const fogQuality = S.lowSpec ? 0.0 : 1.0
const rain = RAINY_DAY ? 0.3 + rng.next() * 0.7 : 0.0
const {cloudBase, cloudTop, cloudCoverage, cloudSigmaE} = pickCloudParameters()
const cloudSteps = S.lowSpec ? 12 : 16
const cloudShadowSteps = S.lowSpec ? 2 : 3
const overcast = 0.01
const depthOfField = 1.2
const dofFocusNear = 1.0
const dofFocusFar = 10000
const dofBlurNear = 0.5
const dofBlurFar = 10001
const rainbowIntensity = 0.43
const grassHeightFactor = 1.0
const grassWidthFactor = 1.0
const flowerSway = 0.6
const flowerAlpha = 0.77
const respiratoryRate = 12
const heartRate = 50

const HOUR_00 = {
  hour: 0,
  overcast: 0.2,
  zenithColor: { r: 0.06, g: 0.06, b: 0.24 },
  horizonColor: { r: 0.05, g: 0.05, b: 0.14 },
  ambientIntensity: 0.16,
  fogDensity: 0.17,
  fogHeightFalloff: 0.5,
  fogIntensity: 0.8,
  fogQuality,
  colorTemperature: -0.6,
  bloomIntensity: 0.04,
  bloomThreshold: 0.92,
  godRayIntensity: 0.0,
  godRayDecay: 0.8,
  ssaoIntensity: 0.27,
  chromaticAberration: 0.008,
  cgExposure: 0.9,
  cgContrast: 1.28,
  cgSaturation: 0.98,
  cgLift: [0.02, 0.04, 0.1],
  windStrength: 0.12,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage: cloudCoverage * Math.max(1.0, Math.min(1.25 - rain, 1.25)),
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.0,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity: 0,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
}

const HOUR_04 = {
  hour: 4,
  overcast: 0.1,
  zenithColor: { r: 0.0, g: 0.08, b: 0.24 },
  horizonColor: { r: 0.14, g: 0.19, b: 0.28 },
  ambientIntensity: 0.48,
  fogDensity: 0.17,
  fogHeightFalloff: 0.6,
  fogIntensity: 0.8,
  fogQuality,
  colorTemperature: -0.5,
  bloomIntensity: 0.05,
  bloomThreshold: 0.96,
  godRayIntensity: 0.0,
  godRayDecay: 0.8,
  ssaoIntensity: 0.23,
  chromaticAberration: 0.008,
  cgExposure: 1.0,
  cgContrast: 1.25,
  cgSaturation: 0.93,
  cgLift: [0.02, 0.04, 0.09],
  windStrength: 0.13,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage: cloudCoverage * Math.max(1.0, Math.min(1.125 - rain, 1.125)),
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.1,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity: 0,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
}

const HOUR_05_30 = {
  hour: 5.5,
  overcast: 0.02,
  turbidity: 2.02,
  dewAmount: 0.72,
  zenithColor: { r: 0.12, g: 0.1, b: 0.28 },
  horizonColor: { r: 0.38, g: 0.22, b: 0.22 },
  ambientIntensity: 0.68,
  fogDensity: 0.17,
  fogHeightFalloff: 0.9,
  fogIntensity: 0.6,
  fogQuality,
  colorTemperature: 0.1,
  bloomIntensity: 0.1,
  bloomThreshold: 0.91,
  godRayIntensity: 3.2,
  godRayDecay: 0.99,
  ssaoIntensity: 0.2,
  chromaticAberration: 0.006,
  cgExposure: 1.0,
  cgContrast: 1.15,
  cgSaturation: 0.9,
  cgLift: [0.03, 0.02, 0.02],
  windStrength: 0.16,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage,
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.2,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
}

const HOUR_06_30 = {
  hour: 6.5,
  overcast: 0.22,
  turbidity: 2.44,
  dewAmount: 0.55,
  zenithColor: { r: 0.18, g: 0.22, b: 0.48 },
  horizonColor: { r: 0.78, g: 0.46, b: 0.24 },
  ambientIntensity: 0.78,
  fogDensity: 0.05,
  fogHeightFalloff: 2.5,
  fogIntensity: 0.5,
  fogQuality,
  colorTemperature: 0.55,
  bloomIntensity: 0.1,
  bloomThreshold: 0.91,
  godRayIntensity: 3.9,
  godRayDecay: 0.99,
  ssaoIntensity: 0.1,
  chromaticAberration: 0.004,
  cgExposure: 1.0,
  cgContrast: 1.12,
  cgSaturation: 0.98,
  cgLift: [0.04, 0.03, 0.01],
  windStrength: 0.18,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage,
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.42,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
}

const HOUR_08 = {
  hour: 8,
  overcast,
  turbidity: 2.33,
  dewAmount: 0.4,
  zenithColor: { r: 0.24, g: 0.42, b: 0.78 },
  horizonColor: { r: 0.76, g: 0.72, b: 0.62 },
  ambientIntensity: 0.82,
  fogDensity: 0.0282,
  fogHeightFalloff: 3.05,
  fogIntensity: 1.0,
  fogQuality,
  colorTemperature: 0.3,
  bloomIntensity: 0.17,
  bloomThreshold: 0.96,
  godRayIntensity: 1.45,
  godRayDecay: 0.72,
  ssaoIntensity: 0.2,
  chromaticAberration: 0.0035,
  cgExposure: 1.0,
  cgContrast: 1.08,
  cgSaturation: 1.12,
  cgLift: [0.01, 0.01, 0.01],
  windStrength: 0.12,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage,
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.7,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
  bikeLightCast: 0.5,
}

const HOUR_10 = {
  hour: 10,
  overcast: 0.2,
  turbidity: 2.4,
  zenithColor: { r: 0.18, g: 0.4, b: 0.86 },
  horizonColor: { r: 0.68, g: 0.82, b: 0.98 },
  ambientIntensity: 0.88,
  fogDensity: 0.014,
  fogHeightFalloff: 0.2,
  fogIntensity: 1.0,
  fogQuality,
  colorTemperature: 0.06,
  bloomIntensity: 0.1,
  bloomThreshold: 0.99,
  godRayIntensity: 1.1,
  godRayDecay: 0.75,
  ssaoIntensity: 0.2,
  chromaticAberration: 0.003,
  cgExposure: 1.1,
  cgContrast: 1.06,
  cgSaturation: 1.15,
  cgLift: [0.0, 0.01, 0.01],
  windStrength: 0.2,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage,
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 1.0,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
  bikeLightCast: 0.2,
}

const HOUR_12 = {
  hour: 12,
  overcast: 0.14,
  turbidity: 2.72,
  zenithColor: { r: 0.16, g: 0.42, b: 0.9 },
  horizonColor: { r: 0.66, g: 0.8, b: 0.98 },
  ambientIntensity: 1.0,
  fogDensity: 0.012,
  fogHeightFalloff: 0.15,
  fogIntensity: 1.0,
  fogQuality,
  colorTemperature: 0.0,
  bloomIntensity: 0.18,
  bloomThreshold: 0.92,
  godRayIntensity: 1.08,
  godRayDecay: 0.75,
  ssaoIntensity: 0.1,
  chromaticAberration: 0.003,
  cgExposure: 1.2,
  cgContrast: 1.09,
  cgSaturation: 1.4,
  cgLift: [0.0, 0.0, 0.01],
  windStrength: 0.2,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage: cloudCoverage * 0.9,
  cloudSigmaE: cloudSigmaE * 0.75,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 1.2,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity: 0,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
  bikeLightCast: 0.2,
}

const HOUR_16 = {
  hour: 16,
  overcast: 0.32,
  turbidity: 2.39,
  zenithColor: { r: 0.2, g: 0.44, b: 0.86 },
  horizonColor: { r: 0.66, g: 0.8, b: 0.97 },
  ambientIntensity: 0.9,
  fogDensity: 0.014,
  fogHeightFalloff: 0.2,
  fogIntensity: 1.0,
  fogQuality,
  colorTemperature: 0.28,
  bloomIntensity: 0.2,
  bloomThreshold: 0.92,
  godRayIntensity: 1.18,
  godRayDecay: 0.74,
  ssaoIntensity: 0.2,
  chromaticAberration: 0.003,
  cgExposure: 1.1,
  cgContrast: 1.09,
  cgSaturation: 1.28,
  cgLift: [0.0, 0.0, 0.01],
  windStrength: 0.22,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage,
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.8,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
  bikeLightCast: 0.75,
}

const HOUR_18 = {
  hour: 18,
  overcast: 0.69,
  turbidity: 2.7,
  zenithColor: { r: 0.28, g: 0.42, b: 0.72 },
  horizonColor: { r: 0.82, g: 0.55, b: 0.32 },
  ambientIntensity: 0.68,
  fogDensity: 0.016,
  fogHeightFalloff: 0.5,
  fogIntensity: 0.15,
  fogQuality,
  colorTemperature: 0.65,
  bloomIntensity: 0.17,
  bloomThreshold: 0.96,
  godRayIntensity: 3.9,
  godRayDecay: 0.955,
  ssaoIntensity: 0.2,
  chromaticAberration: 0.007,
  cgExposure: 1.0,
  cgContrast: 1.1,
  cgSaturation: 1.15,
  cgLift: [0.04, 0.03, 0.01],
  windStrength: 0.25,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage,
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.42,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
  bikeLightCast: 1.0,
}

const HOUR_19_30 = {
  hour: 19.5,
  overcast: 0.53,
  turbidity: 2.0,
  zenithColor: { r: 0.29, g: 0.45, b: 0.82 },
  horizonColor: { r: 0.72, g: 0.66, b: 0.58 },
  ambientIntensity: 0.58,
  fogDensity: 0.0535,
  fogHeightFalloff: 0.2,
  fogIntensity: 0.2,
  fogQuality,
  colorTemperature: 0.45,
  bloomIntensity: 0.14,
  bloomThreshold: 0.91,
  godRayIntensity: 3.3,
  godRayDecay: 1.0,
  ssaoIntensity: 0.16,
  chromaticAberration: 0.007,
  cgExposure: 1.0,
  cgContrast: 1.14,
  cgSaturation: 0.8,
  cgLift: [0.03, 0.02, 0.02],
  windStrength: 0.18,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage: cloudCoverage * Math.max(1.0, Math.min(1.05 - rain, 1.05)),
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.2,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
}

const HOUR_21 = {
  hour: 21,
  overcast: 0.0,
  turbidity: 2.84,
  zenithColor: { r: 0.15, g: 0.29, b: 0.35 },
  horizonColor: { r: 0.04, g: 0.013, b: 0.29 },
  ambientIntensity: 0.43,
  fogDensity: 0.0941,
  fogHeightFalloff: 0.3,
  fogIntensity: 0.3,
  fogQuality,
  colorTemperature: -0.3,
  bloomIntensity: 0.01,
  bloomThreshold: 0.91,
  godRayIntensity: 0.0,
  godRayDecay: 0.8,
  ssaoIntensity: 0.1,
  chromaticAberration: 0.006,
  cgExposure: 1.0,
  cgContrast: 1.24,
  cgSaturation: 0.92,
  cgLift: [0.02, 0.04, 0.09],
  windStrength: 0.14,
  depthOfField,
  dofFocusNear,
  dofFocusFar,
  dofBlurNear,
  dofBlurFar,
  cloudBase,
  cloudTop,
  cloudCoverage: cloudCoverage * Math.max(1.0, Math.min(1.125 - rain, 1.215)),
  cloudSigmaE,
  cloudSteps,
  cloudShadowSteps,
  rain,
  lensFlareIntensity: 0.0,
  grainStrength: 0.072,
  vignetteStrength: 1.0,
  rainbowIntensity: 0,
  grassHeightFactor,
  grassWidthFactor,
  respiratoryRate,
  heartRate,
}

const KEYFRAMES = [
  HOUR_00,
  HOUR_04,
  HOUR_05_30,
  HOUR_06_30,
  HOUR_08,
  HOUR_10,
  HOUR_12,
  HOUR_16,
  HOUR_18,
  HOUR_19_30,
  HOUR_21,
  { ...HOUR_00, hour: 24 },
]

function currentHour() {
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60.0 + d.getSeconds() / 3600.0
}

export class TimeSystem {
  #overrideTime = null
  #actualTime = currentHour()
  #overrides = {}

  // How fast the scene clock is advancing relative to real time this frame.
  // 1 during normal playback (the clock follows the wall clock); larger while
  // the day is fast-forwarded (intro, scroll scrub). dt-integrating systems
  // (wind, birds, insects) multiply their dt by this so they keep pace with the
  // racing sun instead of crawling. See #updateTimeScale.
  #timeScale = 1
  // #actualTime sampled at the previous frame's scale update. The scale is a
  // frame-over-frame diff of the scene clock, NOT a within-call before/after:
  // setOverrideTime(forceActualTime) advances #actualTime mid-frame, so a
  // before/after diff inside rawTime/lerpTime would always read zero.
  #scaleAnchorHour = this.#actualTime

  // timeInfo is rebuilt into this single object every frame — every key is
  // rewritten each call, so consumers must not hold it across frames. The color
  // sub-objects are owned scratch (reassigned, never mutated through #info, so
  // override color objects are never corrupted).
  #info = {}
  #zenithColor = { r: 0, g: 0, b: 0 }
  #horizonColor = { r: 0, g: 0, b: 0 }
  #fogColor = { r: 0, g: 0, b: 0 }
  #cgLift = [0, 0, 0]
  #moonPosition = { x: 0, y: 0, z: 0 }

  setOverrideTime(timeOfDay, forceActualTime = true) {
    if (timeOfDay === null) {
      this.#overrideTime = null
      return
    }

    let t = timeOfDay
    while (t < 0) t += 24
    while (t >= 24) t -= 24
    this.#overrideTime = t

    if (forceActualTime) this.#actualTime = t
  }

  clearOverrideTime() {
    this.#overrideTime = null
  }

  setOverride(key, value) {
    this.#overrides[key] = value
  }

  clearOverride(key) {
    delete this.#overrides[key]
  }

  clearAllOverrides() {
    this.#overrides = {}
    this.#overrideTime = null
  }

  #lerpColorInto(out, ca, cb, t) {
    out.r = lerp(ca.r, cb.r, t)
    out.g = lerp(ca.g, cb.g, t)
    out.b = lerp(ca.b, cb.b, t)
    return out
  }

  #lerpKeyframe(timeOfDay) {
    let kA = KEYFRAMES[0]
    let kB = KEYFRAMES[KEYFRAMES.length - 1]
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (timeOfDay >= KEYFRAMES[i].hour && timeOfDay < KEYFRAMES[i + 1].hour) {
        kA = KEYFRAMES[i]
        kB = KEYFRAMES[i + 1]
        break
      }
    }

    const span = kB.hour - kA.hour
    const raw = span > 0 ? (timeOfDay - kA.hour) / span : 0
    const ts = smoothstep(raw)
    const L = (a, b, fallback) => lerp(a ?? fallback, b ?? fallback, ts)

    // Written into the reused #info object — no per-frame allocation.
    const p = this.#info
    p.overcast = L(kA.overcast, kB.overcast, overcast)
    p.turbidity = L(kA.turbidity, kB.turbidity, 2.5)
    p.zenithColor = this.#lerpColorInto(this.#zenithColor, kA.zenithColor, kB.zenithColor, ts)
    p.horizonColor = this.#lerpColorInto(this.#horizonColor, kA.horizonColor, kB.horizonColor, ts)
    p.fogColor = this.#lerpColorInto(this.#fogColor, kA.fogColor ?? kA.horizonColor, kB.fogColor ?? kB.horizonColor, ts)
    p.ambientIntensity = L(kA.ambientIntensity, kB.ambientIntensity)
    p.fogDensity = L(kA.fogDensity, kB.fogDensity)
    p.fogHeightFalloff = L(kA.fogHeightFalloff, kB.fogHeightFalloff)
    p.fogIntensity = L(kA.fogIntensity, kB.fogIntensity)
    p.fogQuality = L(kA.fogQuality, kB.fogQuality, fogQuality)
    p.fogSteps = L(kA.fogSteps, kB.fogSteps, 16)
    p.colorTemperature = L(kA.colorTemperature, kB.colorTemperature)
    p.bloomIntensity = L(kA.bloomIntensity, kB.bloomIntensity)
    p.bloomThreshold = L(kA.bloomThreshold, kB.bloomThreshold)
    p.godRayIntensity = L(kA.godRayIntensity, kB.godRayIntensity)
    p.godRayDecay = L(kA.godRayDecay, kB.godRayDecay)
    p.godRaySteps = L(kA.godRaySteps, kB.godRaySteps, 64)
    p.ssaoIntensity = L(kA.ssaoIntensity, kB.ssaoIntensity)
    p.chromaticAberration = L(kA.chromaticAberration, kB.chromaticAberration)
    p.cgExposure = L(kA.cgExposure, kB.cgExposure)
    p.cgContrast = L(kA.cgContrast, kB.cgContrast)
    p.cgSaturation = L(kA.cgSaturation, kB.cgSaturation)
    const cgLift = this.#cgLift
    cgLift[0] = L(kA.cgLift[0], kB.cgLift[0])
    cgLift[1] = L(kA.cgLift[1], kB.cgLift[1])
    cgLift[2] = L(kA.cgLift[2], kB.cgLift[2])
    p.cgLift = cgLift
    p.windStrength = L(kA.windStrength, kB.windStrength)
    p.depthOfField = L(kA.depthOfField, kB.depthOfField, depthOfField)
    p.dofFocusNear = L(kA.dofFocusNear, kB.dofFocusNear, dofFocusNear)
    p.dofFocusFar = L(kA.dofFocusFar, kB.dofFocusFar, dofFocusFar)
    p.dofBlurNear = L(kA.dofBlurNear, kB.dofBlurNear, dofBlurNear)
    p.dofBlurFar = L(kA.dofBlurFar, kB.dofBlurFar, dofBlurFar)
    p.cloudBase = L(kA.cloudBase, kB.cloudBase, cloudBase)
    p.cloudTop = L(kA.cloudTop, kB.cloudTop, cloudTop)
    p.cloudCoverage = L(kA.cloudCoverage, kB.cloudCoverage, cloudCoverage)
    p.cloudSigmaE = L(kA.cloudSigmaE, kB.cloudSigmaE, cloudSigmaE)
    p.cloudSteps = L(kA.cloudSteps, kB.cloudSteps, cloudSteps)
    p.cloudShadowSteps = L(kA.cloudShadowSteps, kB.cloudShadowSteps, cloudShadowSteps)
    p.mountainSteps = L(kA.mountainSteps, kB.mountainSteps, 64)
    p.rain = L(kA.rain, kB.rain, rain)
    p.lensFlareIntensity = L(kA.lensFlareIntensity, kB.lensFlareIntensity, 0.26)
    p.grainStrength = L(kA.grainStrength, kB.grainStrength, 0.072)
    p.vignetteStrength = L(kA.vignetteStrength, kB.vignetteStrength, 1.0)
    p.rainbowIntensity = L(kA.rainbowIntensity, kB.rainbowIntensity, rainbowIntensity)
    p.grassHeightFactor = L(kA.grassHeightFactor, kB.grassHeightFactor, grassHeightFactor)
    p.grassWidthFactor = L(kA.grassWidthFactor, kB.grassWidthFactor, grassWidthFactor)
    p.flowerSway = L(kA.flowerSway, kB.flowerSway, flowerSway)
    p.flowerAlpha = L(kA.flowerAlpha, kB.flowerAlpha, flowerAlpha)
    p.grassCulling = L(kA.grassCulling, kB.grassCulling, 1.0)
    p.shadowGrassDensity = L(kA.shadowGrassDensity, kB.shadowGrassDensity, 1.0)
    p.grassLodDistance = L(kA.grassLodDistance, kB.grassLodDistance, 18.0)
    p.grassDistantDensity = L(kA.grassDistantDensity, kB.grassDistantDensity, 0.65)
    p.grassDedup = L(kA.grassDedup, kB.grassDedup, 1.0)
    p.dewAmount = L(kA.dewAmount, kB.dewAmount, 0.0)
    p.respiratoryRate = L(kA.respiratoryRate, kB.respiratoryRate, respiratoryRate)
    p.heartRate = L(kA.heartRate, kB.heartRate, heartRate)
    p.birdSeparationRadius = L(kA.birdSeparationRadius, kB.birdSeparationRadius, 3.5)
    p.birdAlignmentRadius = L(kA.birdAlignmentRadius, kB.birdAlignmentRadius, 4.0)
    p.birdCohesionRadius = L(kA.birdCohesionRadius, kB.birdCohesionRadius, 3.0)
    p.birdSeparationWeight = L(kA.birdSeparationWeight, kB.birdSeparationWeight, 1.35)
    p.birdAlignmentWeight = L(kA.birdAlignmentWeight, kB.birdAlignmentWeight, 0.85)
    p.birdCohesionWeight = L(kA.birdCohesionWeight, kB.birdCohesionWeight, 0.55)
    p.birdSeekWeight = L(kA.birdSeekWeight, kB.birdSeekWeight, 0.85)
    p.birdMaxSpeed = L(kA.birdMaxSpeed, kB.birdMaxSpeed, 8.0)
    p.birdMaxForce = L(kA.birdMaxForce, kB.birdMaxForce, 3.0)
    p.birdWingBeat = L(kA.birdWingBeat, kB.birdWingBeat, 0.09)
    p.birdWingAmplitude = L(kA.birdWingAmplitude, kB.birdWingAmplitude, 0.41)
    p.birdAltitude = L(kA.birdAltitude, kB.birdAltitude, 38.0)
    p.birdScale = L(kA.birdScale, kB.birdScale, 0.6)
    p.fireflyIntensity = L(kA.fireflyIntensity, kB.fireflyIntensity, 1.0)
    p.fireflyLightRadius = L(kA.fireflyLightRadius, kB.fireflyLightRadius, 4.0)
    p.flyIntensity = L(kA.flyIntensity, kB.flyIntensity, 1.0)
    p.beeIntensity = L(kA.beeIntensity, kB.beeIntensity, 1.0)
    p.chemtrailCount = L(kA.chemtrailCount, kB.chemtrailCount, 3)
    p.chemtrailOpacity = L(kA.chemtrailOpacity, kB.chemtrailOpacity, 0.055)
    p.chemtrailWidth = L(kA.chemtrailWidth, kB.chemtrailWidth, 0.005)
    p.sparkleEnabled = L(kA.sparkleEnabled, kB.sparkleEnabled, 1.0)
    p.sparkleIntensity = L(kA.sparkleIntensity, kB.sparkleIntensity, 0.3)
    p.sparkleDensity = L(kA.sparkleDensity, kB.sparkleDensity, 20.0)
    p.sparkleSharpness = L(kA.sparkleSharpness, kB.sparkleSharpness, 0.4)
    p.sparkleSpeed = L(kA.sparkleSpeed, kB.sparkleSpeed, 2.12)
    p.emissiveIntensity = L(kA.emissiveIntensity, kB.emissiveIntensity, 10.0)
    p.bikeLightCast = L(kA.bikeLightCast, kB.bikeLightCast, 1.0)
    p.bikeLightCastRadius = L(kA.bikeLightCastRadius, kB.bikeLightCastRadius, 4.0)
    p.bikeLightGlow = L(kA.bikeLightGlow, kB.bikeLightGlow, 0.45)
    p.bikeLightFlare = L(kA.bikeLightFlare, kB.bikeLightFlare, 0.3)
    p.bikeLightBeam = L(kA.bikeLightBeam, kB.bikeLightBeam, 1.0)
    return p
  }

  get timeScale() {
    return this.#timeScale
  }

  // Scene-time advance since the last frame ÷ real-time advance, floored at 1.
  // Only the driven modes (override set) can exceed 1: when the wall clock is the
  // source the ratio is pinned to 1 so its 1s quantization can't cause a spike. A
  // held static override advances 0 scene-seconds, so the floor keeps systems
  // running at real speed. The anchor is refreshed every call so a fast segment
  // starting after a quiet period measures a single frame's advance, not a jump.
  // dtMs is the real frame delta.
  #updateTimeScale(dtMs) {
    let deltaHours = this.#actualTime - this.#scaleAnchorHour
    if (deltaHours > 12) deltaHours -= 24
    if (deltaHours < -12) deltaHours += 24
    this.#scaleAnchorHour = this.#actualTime

    if (this.#overrideTime === null || dtMs <= 0) {
      this.#timeScale = 1
      return
    }
    const sceneSec = Math.abs(deltaHours) * 3600
    this.#timeScale = Math.max(1, sceneSec / (dtMs * 0.001))
  }

  rawTime(dtMs = 0) {
    this.#actualTime = this.#overrideTime !== null ? this.#overrideTime : currentHour()
    this.#updateTimeScale(dtMs)
  }

  lerpTime(dtMs = 0) {
    const target = this.#overrideTime !== null ? this.#overrideTime : currentHour()

    let delta = target - this.#actualTime
    if (delta > 12) delta -= 24
    if (delta < -12) delta += 24

    let t = this.#actualTime + delta * S.timeInertia
    if (t < 0) t += 24
    if (t >= 24) t -= 24

    this.#actualTime = t
    this.#updateTimeScale(dtMs)
  }

  get timeInfo() {
    const timeOfDay = this.#actualTime
    let period

    if (timeOfDay >= 21 || timeOfDay < 5.5) period = PERIOD_NIGHT
    else if (timeOfDay < 8) period = PERIOD_DAWN
    else if (timeOfDay < 10 || (timeOfDay >= 18 && timeOfDay < 20)) period = PERIOD_GOLDEN
    else period = PERIOD_DAY

    const solarDate = this.#overrideTime !== null ? dateForLocalHour(timeOfDay) : new Date()
    const { elevationDeg, azimuthDeg } = solarElevationAzimuth(solarDate)
    // sunPosition stays a fresh object — buildIntro() captures it across frames.
    const sunPosition = solarDirection(elevationDeg, azimuthDeg)
    const mx = -sunPosition.x
    const my = -sunPosition.y + 0.1
    const mz = sunPosition.z
    const mlen = Math.sqrt(mx * mx + my * my + mz * mz)
    const moonPosition = this.#moonPosition
    moonPosition.x = mx / mlen
    moonPosition.y = my / mlen
    moonPosition.z = mz / mlen

    // #lerpKeyframe rewrites every keyframed key of #info; derived fields and
    // overrides are layered on top afterwards.
    const result = this.#lerpKeyframe(timeOfDay)
    result.period = period
    result.timeOfDay = timeOfDay
    result.sunPosition = sunPosition
    result.moonPosition = moonPosition
    result.sunAboveHorizon = sunPosition.y > 0
    result.hasStars = period === PERIOD_NIGHT
    result.hasGodRays = period === PERIOD_GOLDEN || period === PERIOD_DAY

    for (const key in this.#overrides) result[key] = this.#overrides[key]

    return result
  }

  // Pure keyframe value for one parameter, without overrides. #lerpKeyframe
  // rewrites the shared timeInfo object, so the overrides must be re-layered
  // afterwards — the camera animator calls this mid-frame while consumers are
  // still holding the current frame's timeInfo.
  rawParam(k) {
    const raw = this.#lerpKeyframe(this.#actualTime)[k]
    for (const key in this.#overrides) this.#info[key] = this.#overrides[key]
    return raw
  }
}
