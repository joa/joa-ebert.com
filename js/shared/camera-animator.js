// Camera Animator
// ###############
//
// Keyframe-driven camera path playback. Supports LINEAR_POS, LINEAR_LOOKAT,
// ORBIT, STATIC, and BEZIER_LOOKAT segment types, each with smoothstep ease-in/out.
// Deceleration on stop() prevents abrupt cuts when pointer lock is acquired.
// Segments may include timeOverrides to lerp time-system parameters alongside the path.

import { lerp, smoothstep, smoothstep2, easeInOutQuad } from "./math-utils.js"

export const PATH = {
  LINEAR_POS: 1,
  LINEAR_LOOKAT: 2,
  ORBIT: 3,
  STATIC: 4,
  BEZIER_LOOKAT: 5,
  LINEAR_QUAT: 6,
}

const EASE_OUT_DURATION = 0.5

function lerpValue(a, b, t) {
  if (typeof a === "number") return lerp(a, b, t)
  if (Array.isArray(a)) return a.map((value, index) => lerp(value, b[index], t))
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) }
}

function cubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return [
    mt2 * mt * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t2 * t * p3[0],
    mt2 * mt * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t2 * t * p3[1],
    mt2 * mt * p0[2] + 3 * mt2 * t * p1[2] + 3 * mt * t2 * p2[2] + t2 * t * p3[2],
  ]
}

export class CameraAnimator {
  #camera
  #onGrassRegen
  #heightAt
  #timeSystem
  #segments = []
  #segIndex = 0
  #segElapsed = 0
  #active = false
  #stopping = false
  #stopElapsed = 0
  #stopSegElapsed = 0
  #stopSeg = null

  constructor(camera, onGrassRegen, heightAt, timeSystem = null) {
    this.#camera = camera
    this.#onGrassRegen = onGrassRegen
    this.#heightAt = heightAt
    this.#timeSystem = timeSystem
  }

  get isActive() {
    return this.#active || this.#stopping
  }

  play(segments) {
    if (!segments || segments.length === 0) return

    this.#segments = segments
    this.#active = true
    this.#stopping = false
    this.#stopElapsed = 0

    this.#startSegment(0)
    this.#onGrassRegen()
  }

  stop() {
    if (!this.#active) return

    this.#stopping = true
    this.#active = false
    this.#stopElapsed = 0
    this.#stopSeg = this.#segments[this.#segIndex]
    this.#stopSegElapsed = this.#segElapsed
  }

  update(dt) {
    if (!this.#active && !this.#stopping) return

    if (this.#stopping) {
      this.#stopElapsed += dt
      const frac = Math.min(this.#stopElapsed / EASE_OUT_DURATION, 1)
      if (frac >= 1) {
        this.#stopping = false
        return
      }
      const rate = (1 - frac) * (1 - frac)
      this.#stopSegElapsed += dt * rate
      const seg = this.#stopSeg
      const rawT = Math.min(this.#stopSegElapsed / seg.duration, 1)
      this.#applySegment(seg, seg.rawT ? rawT : easeInOutQuad(smoothstep(rawT)), rawT)
      return
    }

    if (this.#camera.locked) {
      this.stop()
      return
    }

    this.#segElapsed += dt
    const seg = this.#segments[this.#segIndex]
    const rawT = Math.min(this.#segElapsed / seg.duration, 1)
    this.#applySegment(seg, seg.rawT ? rawT : easeInOutQuad(smoothstep(rawT)), rawT)

    if (this.#segElapsed >= seg.duration) {
      const next = this.#segIndex + 1

      if (next < this.#segments.length) {
        this.#startSegment(next)
      } else {
        this.#active = false
        this.#timeSystem.clearAllOverrides()
      }
    }
  }

  #startSegment(idx) {
    const [p0x, p0y, p0z] = this.#camera.position

    this.#segIndex = idx
    this.#segElapsed = 0
    this.#applySegment(this.#segments[idx], 0, 0)

    const [p1x, p1y, p1z] = this.#camera.position
    if (p0x !== p1x || p0y !== p1y || p0z !== p1z) {
      this.#applySegment(this.#segments[idx], 0.5, 0.5)
      this.#onGrassRegen()
      this.#applySegment(this.#segments[idx], 0, 0)
    }
  }

  #moveLinear(from, to, t) {
    this.#camera.position[0] = lerp(from[0], to[0], t)
    this.#camera.position[1] = lerp(from[1], to[1], t)
    this.#camera.position[2] = lerp(from[2], to[2], t)
  }

  #applySegment(seg, t, rawT) {
    const cam = this.#camera
    switch (seg.type) {
      case PATH.LINEAR_POS: {
        this.#moveLinear(seg.from, seg.to, t)
        if (t === 0 && seg.lookAt) this.#lookAt(seg.lookAt)
        break
      }
      case PATH.LINEAR_LOOKAT: {
        this.#moveLinear(seg.from, seg.to, t)
        const lookAt = seg.startLookAt && seg.endLookAt ? lerpValue(seg.startLookAt, seg.endLookAt, t) : seg.lookAt
        this.#lookAt(lookAt)
        break
      }
      case PATH.ORBIT: {
        const theta = lerp(seg.startAngle, seg.endAngle, t)
        const startElev = seg.startElevation ?? seg.elevation ?? 0.2
        const endElev = seg.endElevation ?? startElev
        const startDist = seg.startDistance ?? seg.distance ?? 5
        const endDist = seg.endDistance ?? startDist
        cam.orbit(seg.center, lerp(startDist, endDist, t), theta, lerp(startElev, endElev, t))
        break
      }
      case PATH.STATIC: {
        cam.position[0] = seg.at[0]
        cam.position[1] = seg.at[1]
        cam.position[2] = seg.at[2]
        if (seg.lookAt) this.#lookAt(seg.lookAt)
        break
      }
      case PATH.BEZIER_LOOKAT: {
        const pos = cubicBezier(seg.from, seg.cp1, seg.cp2, seg.to, t)
        cam.position[0] = pos[0]
        cam.position[1] = pos[1]
        cam.position[2] = pos[2]
        this.#lookAt(seg.lookAt)
        break
      }
      case PATH.LINEAR_QUAT: {
        this.#moveLinear(seg.from, seg.to, t)
        cam.ypr(lerp(seg.from[3], seg.to[3], t), lerp(seg.from[4], seg.to[4], t), lerp(seg.from[5], seg.to[5], t))
        break
      }
    }

    if (!seg.fixedHeight) {
      cam.position[1] += this.#heightAt(cam.position[0], cam.position[2])
    }

    this.#applyTimeOverrides(seg, t)

    const f = 0.1
    const expFade = (seg.fadeIn ? smoothstep2(0, f, rawT) : 1.0) - (seg.fadeOut ? smoothstep2(1.0 - f, 1.0, rawT) : 0.0)
    const exp = expFade * this.#timeSystem.rawParam("cgExposure")
    this.#timeSystem.setOverride("cgExposure", exp)
  }

  #applyTimeOverrides(seg, t) {
    if (!seg.timeOverrides || !this.#timeSystem) return

    if (seg.timeOverrides === "reset") {
      this.#timeSystem.setOverrideTime(null)
      this.#timeSystem.clearAllOverrides()
      return
    }

    for (const key of Object.keys(seg.timeOverrides)) {
      const value = seg.timeOverrides[key]
      if (value === null) {
        if (key === "timeOfDay") {
          this.#timeSystem.setOverrideTime(null)
        } else {
          this.#timeSystem.clearOverride(key)
        }
        continue
      }

      const { from, to } = value

      if (key === "timeOfDay") {
        let delta = (to - from) % 24
        if (delta < 0) delta += 24

        let value = from + delta * t
        while (value < 0) value += 24
        while (value >= 24) value -= 24

        this.#timeSystem.setOverrideTime(value)
      } else {
        this.#timeSystem.setOverride(key, lerpValue(from, to, t))
      }
    }
  }

  #lookAt(target) {
    this.#camera.lookAt({ x: target[0], y: target[1], z: target[2] })
  }
}
