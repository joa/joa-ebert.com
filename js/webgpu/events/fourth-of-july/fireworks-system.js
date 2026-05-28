// Fireworks System
// ################
//
// CPU burst-particle simulation for fireworks.
// Active only during the in-game night hours (timeOfDay > 20 or < 5).

import { FLAG_POS } from "./flag-system.js"

const MAX_ROCKETS = 6
const MAX_SPARKLES = 600 // 100 per explosion
const SPARKLES_PER_BURST = 100

const GRAVITY = -4.8 // wu/s²
const ROCKET_SPEED_MIN = 6.0
const ROCKET_SPEED_MAX = 9.0
const SPARKLE_LIFETIME = 1.8
const LAUNCH_INTERVAL_MIN = 0.6
const LAUNCH_INTERVAL_MAX = 1.4
const BURST_HEIGHT_MIN = 4
const BURST_HEIGHT_MAX = 7
const SPREAD_XZ = 5

// Red / white / blue / gold
const COLORS = [
  [1.0, 0.15, 0.1],
  [1.0, 1.0, 1.0],
  [0.15, 0.45, 1.0],
  [1.0, 0.8, 0.15],
]

export class FireworksSystem {
  sparklePositions = new Float32Array(MAX_SPARKLES * 3)
  sparkleColors = new Float32Array(MAX_SPARKLES * 4) // RGB + life [0,1] as alpha
  sparkleCount = 0

  #rockets = Array.from({ length: MAX_ROCKETS }, () => ({
    active: false,
    px: 0,
    py: 0,
    pz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    fuse: 0,
  }))

  // Velocity for each sparkle slot (separate from position for clarity)
  #vels = new Float32Array(MAX_SPARKLES * 3)
  // Ring-buffer cursor for sparkle pool
  #sparkleHead = 0
  #nextLaunchIn = 0.3

  update(dtS, timeInfo) {
    const dt = Math.min(dtS, 0.033)
    const isNight = timeInfo.timeOfDay > 20 || timeInfo.timeOfDay < 5

    this.#updateRockets(dt)
    this.#updateSparkles(dt)

    if (isNight) {
      this.#nextLaunchIn -= dt
      if (this.#nextLaunchIn <= 0) {
        this.#tryLaunch()
        this.#nextLaunchIn = LAUNCH_INTERVAL_MIN + Math.random() * (LAUNCH_INTERVAL_MAX - LAUNCH_INTERVAL_MIN)
      }
    }
  }

  #updateRockets(dt) {
    for (const r of this.#rockets) {
      if (!r.active) continue
      r.fuse -= dt
      r.px += r.vx * dt
      r.py += r.vy * dt
      r.pz += r.vz * dt
      r.vy += GRAVITY * dt * 0.25 // slight gravity on ascent

      if (r.fuse <= 0) {
        this.#burst(r)
        r.active = false
      }
    }
  }

  #updateSparkles(dt) {
    let live = 0
    for (let i = 0; i < MAX_SPARKLES; i++) {
      const life = this.sparkleColors[i * 4 + 3]
      if (life <= 0) continue
      live++

      this.sparkleColors[i * 4 + 3] = Math.max(0, life - dt / SPARKLE_LIFETIME)

      this.sparklePositions[i * 3] += this.#vels[i * 3] * dt
      this.sparklePositions[i * 3 + 1] += this.#vels[i * 3 + 1] * dt
      this.sparklePositions[i * 3 + 2] += this.#vels[i * 3 + 2] * dt

      this.#vels[i * 3 + 1] += GRAVITY * dt
      const drag = 1 - 1.5 * dt
      this.#vels[i * 3] *= drag
      this.#vels[i * 3 + 1] *= drag
      this.#vels[i * 3 + 2] *= drag
    }
    this.sparkleCount = live
  }

  #tryLaunch() {
    for (const r of this.#rockets) {
      if (r.active) continue
      const speed = ROCKET_SPEED_MIN + Math.random() * (ROCKET_SPEED_MAX - ROCKET_SPEED_MIN)
      const height = BURST_HEIGHT_MIN + Math.random() * (BURST_HEIGHT_MAX - BURST_HEIGHT_MIN)
      r.active = true
      r.px = FLAG_POS.x + (Math.random() - 0.5) * SPREAD_XZ
      r.py = FLAG_POS.y + 0.5
      r.pz = FLAG_POS.z + (Math.random() - 0.5) * SPREAD_XZ
      r.vx = (Math.random() - 0.5) * 0.4
      r.vy = speed
      r.vz = (Math.random() - 0.5) * 0.4
      r.fuse = height / r.vy
      break
    }
  }

  #burst(rocket) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    for (let k = 0; k < SPARKLES_PER_BURST; k++) {
      const i = this.#sparkleHead % MAX_SPARKLES
      this.#sparkleHead++

      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speed = 1.5 + Math.random() * 3.0
      this.#vels[i * 3] = Math.sin(phi) * Math.cos(theta) * speed
      this.#vels[i * 3 + 1] = Math.abs(Math.sin(phi) * Math.sin(theta)) * speed * 0.5 + speed * 0.5
      this.#vels[i * 3 + 2] = Math.cos(phi) * speed

      this.sparklePositions[i * 3] = rocket.px
      this.sparklePositions[i * 3 + 1] = rocket.py
      this.sparklePositions[i * 3 + 2] = rocket.pz

      this.sparkleColors[i * 4] = color[0]
      this.sparkleColors[i * 4 + 1] = color[1]
      this.sparkleColors[i * 4 + 2] = color[2]
      this.sparkleColors[i * 4 + 3] = 1.0
    }
  }
}
