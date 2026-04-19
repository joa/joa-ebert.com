// Adaptive Quality
// ################
//
// FPS-based quality scaler. Uses exponential moving average FPS tracking with
// a P-controller to drive cloud step count, SSAO, god-ray, and fog quality.

import S from "./settings"

const TARGET_FPS = S.isMobile ? 30 : 59
const FPS_TAU = 1.5
const FPS_ALPHA = 1 - Math.exp(-1 / (TARGET_FPS * FPS_TAU))
const KP = 0.9
const DEAD_BAND = 0.15
const RATE_DOWN = 0.15
const RATE_UP = 0.03
const RATE_PROBE = 0.05
const WARMUP = 2.5

// Q value at which phase 1 ends and phase 2 (to the max) begins.
const PHASE_SPLIT = 0.6

// Integer quality params scaled through two-phase lerp.
// Priority order: cloud → shadow → fog/god rays (lowest).
const QUALITY_PARAMS = [
  { key: "godRaySteps", min: 32, target: 48, targetAt: PHASE_SPLIT, max: 64 },
  { key: "cloudSteps", min: 6, target: 12, targetAt: 0.35, max: 32 },
  { key: "cloudShadowSteps", min: 2, target: 3, targetAt: PHASE_SPLIT, max: 3 },
]

// Fog: analytical mode below FOG_VOL_MIN steps; hysteresis band prevents flickering.
const FOG_VOL_MIN = 12
const FOG_TARGET = 24
const FOG_TARGET_AT = PHASE_SPLIT
const FOG_VOL_MAX = 32
const FOG_HYSTERESIS = 6

export class AdaptiveQuality {
  #q = S.isMobile ? 0.25 : 0.5
  #fps = TARGET_FPS
  #elapsed = 0
  #prevNow = null
  #fogEnabled = true
  #enabled = true

  tick(nowMs) {
    if (!this.#enabled) return
    if (this.#prevNow === null) {
      this.#prevNow = nowMs
      return
    }

    const rawDt = (nowMs - this.#prevNow) * 0.001
    this.#prevNow = nowMs

    if (rawDt > 0.5) {
      this.#fps = TARGET_FPS
      return
    }

    const dt = Math.min(rawDt, 0.1)
    this.#elapsed += dt
    this.#fps += (Math.min(1 / rawDt, 250) - this.#fps) * FPS_ALPHA

    if (this.#elapsed < WARMUP) return

    const err = (this.#fps - TARGET_FPS) / TARGET_FPS
    if (err > 0.0) {
      this.#q = Math.min(1, this.#q + RATE_UP * dt)
    } else if (err > -DEAD_BAND) {
      this.#q = Math.min(1, this.#q + RATE_PROBE * dt)
    } else {
      this.#q = Math.max(0, this.#q + Math.max(-RATE_DOWN * dt, KP * err * dt))
    }
  }

  // Two-phase interpolation:
  //   q in [0, targetAt]     → lerp(min, target)
  //   q in [targetAt, SPLIT] → hold at target
  //   q in [SPLIT, 1]        → lerp(target, max)
  #scaleParam(q, min, target, targetAt, max) {
    if (q <= targetAt) return min + (target - min) * (q / targetAt)
    if (q <= PHASE_SPLIT) return target
    return target + (max - target) * ((q - PHASE_SPLIT) / (1 - PHASE_SPLIT))
  }

  apply(timeInfo) {
    if (!this.#enabled) return timeInfo

    const q = this.#q
    const out = Object.assign({}, timeInfo)

    for (const { key, min, target, targetAt, max } of QUALITY_PARAMS) {
      if ((timeInfo[key] ?? 0) === 0) { out[key] = 0; continue }
      out[key] = Math.max(min, Math.round(this.#scaleParam(q, min, target, targetAt, max)))
    }

    const fogRaw = q < 0.5 ? 0 : Math.round(this.#scaleParam(q, 0, FOG_TARGET, FOG_TARGET_AT, FOG_VOL_MAX))
    if (fogRaw < FOG_VOL_MIN) this.#fogEnabled = false
    else if (fogRaw >= FOG_VOL_MIN + FOG_HYSTERESIS) this.#fogEnabled = true

    const fogDisabled = (timeInfo.fogSteps ?? 0) === 0
    out.fogSteps = fogDisabled ? 0 : this.#fogEnabled ? Math.max(FOG_VOL_MIN, fogRaw) : FOG_VOL_MIN
    out.fogQuality = fogDisabled || !this.#fogEnabled ? 0 : timeInfo.fogQuality
    out.depthOfField = timeInfo.depthOfField * q
    out.cloudTop = Math.max(
      Math.min(timeInfo.cloudBase + 4, timeInfo.cloudTop),
      timeInfo.cloudBase + q * Math.max(0, timeInfo.cloudTop - timeInfo.cloudBase)
    )

    return out
  }

  get enabled() {
    return this.#enabled
  }

  set enabled(value) {
    this.#enabled = value
  }

  get quality() {
    return this.#q
  }

  get fps() {
    return this.#fps
  }
}
