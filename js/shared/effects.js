// Effects System
// ##############
//
// CPU simulation for rain drops, pollen particles, fireflies, flies, and bees.
// Manages position/lifetime arrays uploaded each frame to the GPU.
//
// Flies and bees swarm via the Thomas cyclically-symmetric attractor
// (dx/dt = sin(y) - b*x, and cyclic permutations). It is bounded, symmetric,
// and chaotic at b ≈ 0.208, so integrating it per-insect from slightly
// different seeds yields sensitive-dependence divergence — a lively, non-
// repeating swarm around an anchor with none of the O(N²) cost of boids.

import S from "./settings.js"

// Thomas attractor: dissipation constant. Chaotic in ~[0.19, 0.21]; bounded
// state stays within roughly ±4.5 on each axis.
const THOMAS_B = 0.208

// Flies gather in tight columns above a handful of shared anchor points.
// Anchors sit on a ring around the camera so no swarm lands right on the lens
// (a close swarm would balloon across the whole sky).
const FLY_ANCHORS = 8
const FLY_PER_ANCHOR = 7
const FLY_SPREAD = 16
const FLY_SWARM_RADIUS = 0.9
const FLY_RATE = 1.7
const FLY_FLOOR_Y = 0.35

// Bees fly erratically: a velocity integrator with continuous random jitter plus
// occasional strong "dart" impulses, held near a slowly drifting home by a spring.
// Unlike the flies' attractor, this is stochastic every frame — never periodic.
const BEE_COUNT = 12
const BEE_SPREAD = 13
const BEE_ROAM_RADIUS = 3.5 // how far the home wanders across the meadow
const BEE_JITTER = 40 // continuous random acceleration (wu/s²)
const BEE_DART_RATE = 3.0 // expected dart impulses per second
const BEE_DART_SPEED = 7.5 // dart impulse magnitude (wu/s)
const BEE_HOME_PULL = 3.6 // spring stiffness back toward home
const BEE_DRAG = 2.6 // velocity damping rate
const BEE_FLOOR_Y = 0.3

// The header camera sits back and frames the text/meadow around the world origin,
// so swarm anchors scatter in a box centred on origin (matching how fireflies are
// placed). Writes into out at index i3.
function scatterAnchor(out, i3, spread, minY, spanY) {
  out[i3] = (Math.random() - 0.5) * spread
  out[i3 + 1] = minY + Math.random() * spanY
  out[i3 + 2] = (Math.random() - 0.5) * spread
}

export class EffectsSystem {
  // GPU-facing (read by gpu-updates.js each frame or gpu-buffers.js at init)
  particleCount = 0
  particlePositions = null
  particleSizes = null
  particleLives = null
  particlePhases = null
  fireflyCount = 0
  fireflyPositions = null
  fireflyBrightness = null
  flyCount = 0
  flyPositions = null
  flySizes = null
  flyPhases = null
  beeCount = 0
  beePositions = null
  beeSizes = null
  beePhases = null
  rainCount = 0
  rainPositions = null

  // Simulation internals
  #particleSpeeds = null
  #fireflyBasePositions = null
  #fireflyPhases = null
  #fireflyDriftX = null
  #fireflyDriftZ = null
  #fireflyTime = 0
  #flyState = null
  #flyAnchors = null
  #beeVel = null
  #beeAnchors = null
  #beeRoamPhase = null
  #insectTime = 0

  constructor() {
    // Pollen particles are disabled on mobile: the additive sprite pass forces the
    // forward render pass to run every frame (extra TBDR tile flush), and the visual
    // contribution is barely perceptible on small screens.
    // Flies and bees run an additive forward sprite pass; like pollen it is
    // skipped on mobile to avoid the extra TBDR tile flush.
    if (!S.lowSpec) {
      this.#initParticles(1000)
      this.#initFlies()
      this.#initBees()
    }
    this.#initRain(15000)
    this.#initFireflies(32)
  }

  #initParticles(count) {
    this.particleCount = count
    this.particlePositions = new Float32Array(count * 3)
    this.particleLives = new Float32Array(count)
    this.particleSizes = new Float32Array(count)
    this.particlePhases = new Float32Array(count)
    this.#particleSpeeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.particlePositions[i * 3] = (Math.random() - 0.5) * 20.0
      this.particlePositions[i * 3 + 1] = 0.15 + Math.random() * 1.5
      this.particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 20.0
      this.particleSizes[i] = 0.025 + Math.random() * 0.035
      this.particleLives[i] = Math.random()
      this.particlePhases[i] = Math.random() * Math.PI * 2
      this.#particleSpeeds[i] = 0.04 + Math.random() * 0.08
    }
  }

  #initFireflies(count) {
    this.fireflyCount = count
    this.#fireflyBasePositions = new Float32Array(count * 3)
    this.fireflyPositions = new Float32Array(count * 3)
    this.fireflyBrightness = new Float32Array(count)
    this.#fireflyPhases = new Float32Array(count)
    this.#fireflyDriftX = new Float32Array(count)
    this.#fireflyDriftZ = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      this.#fireflyBasePositions[i * 3] = -10 + (Math.random() - 0.5) * 30
      this.#fireflyBasePositions[i * 3 + 1] = 0.5 + Math.random() * 0.85
      this.#fireflyBasePositions[i * 3 + 2] = 10 + (Math.random() - 0.5) * 30
      this.#fireflyPhases[i] = Math.random() * Math.PI * 2
      this.#fireflyDriftX[i] = Math.random() * Math.PI * 2
      this.#fireflyDriftZ[i] = Math.random() * Math.PI * 2
    }
    this.fireflyPositions.set(this.#fireflyBasePositions)
    this.#fireflyTime = 0
  }

  #initFlies() {
    const count = FLY_ANCHORS * FLY_PER_ANCHOR
    this.flyCount = count
    this.flyPositions = new Float32Array(count * 3)
    this.flySizes = new Float32Array(count)
    this.flyPhases = new Float32Array(count)
    this.#flyState = new Float32Array(count * 3)
    this.#flyAnchors = new Float32Array(FLY_ANCHORS * 3)
    for (let a = 0; a < FLY_ANCHORS; a++) {
      // Hover the swarms head-height so they read as dancing dots against the sky.
      scatterAnchor(this.#flyAnchors, a * 3, FLY_SPREAD, 1.4, 1.2)
    }
    for (let i = 0; i < count; i++) {
      // Seed each fly on the attractor's basin; chaos keeps them bounded and drifting apart.
      this.#flyState[i * 3] = (Math.random() - 0.5) * 8
      this.#flyState[i * 3 + 1] = (Math.random() - 0.5) * 8
      this.#flyState[i * 3 + 2] = (Math.random() - 0.5) * 8
      this.flySizes[i] = 0.6 + Math.random() * 0.5
      this.flyPhases[i] = Math.random() * Math.PI * 2
    }
  }

  #initBees() {
    this.beeCount = BEE_COUNT
    this.beePositions = new Float32Array(BEE_COUNT * 3)
    this.beeSizes = new Float32Array(BEE_COUNT)
    this.beePhases = new Float32Array(BEE_COUNT)
    this.#beeVel = new Float32Array(BEE_COUNT * 3)
    this.#beeAnchors = new Float32Array(BEE_COUNT * 3)
    this.#beeRoamPhase = new Float32Array(BEE_COUNT * 2)
    for (let i = 0; i < BEE_COUNT; i++) {
      // Lifted just above the grass tops so bees read against sky, not lost in blades.
      scatterAnchor(this.#beeAnchors, i * 3, BEE_SPREAD, 0.75, 1.1)
      // Start each bee at its home; velocity begins at rest.
      this.beePositions[i * 3] = this.#beeAnchors[i * 3]
      this.beePositions[i * 3 + 1] = this.#beeAnchors[i * 3 + 1]
      this.beePositions[i * 3 + 2] = this.#beeAnchors[i * 3 + 2]
      this.#beeRoamPhase[i * 2] = Math.random() * Math.PI * 2
      this.#beeRoamPhase[i * 2 + 1] = Math.random() * Math.PI * 2
      this.beeSizes[i] = 0.8 + Math.random() * 0.4
      this.beePhases[i] = Math.random() * Math.PI * 2
    }
  }

  #initRain(count) {
    this.rainCount = count
    this.rainPositions = new Float32Array(count * 3)
    for (let i = 0; i < count * 3; i++) {
      this.rainPositions[i] = Math.random()
    }
  }

  update(deltaTime, [cx, , cz]) {
    const dt = deltaTime * 0.001
    this.#fireflyTime += dt
    this.#insectTime += dt
    const t = this.#fireflyTime

    for (let i = 0; i < this.fireflyCount; i++) {
      const phase = this.#fireflyPhases[i]
      this.fireflyPositions[i * 3] =
        this.#fireflyBasePositions[i * 3] + Math.sin(t * 0.28 + this.#fireflyDriftX[i]) * 0.9
      this.fireflyPositions[i * 3 + 1] = this.#fireflyBasePositions[i * 3 + 1] + Math.sin(t * 0.52 + phase) * 0.22
      this.fireflyPositions[i * 3 + 2] =
        this.#fireflyBasePositions[i * 3 + 2] + Math.cos(t * 0.22 + this.#fireflyDriftZ[i]) * 0.9
      this.fireflyBrightness[i] = 0.45 + 0.55 * Math.pow(Math.max(0.0, Math.sin(t * 1.7 + phase * 3.1)), 2.0)
    }

    for (let i = 0; i < this.particleCount; i++) {
      this.particleLives[i] += dt * this.#particleSpeeds[i]
      if (this.particleLives[i] > 1.0) {
        this.particleLives[i] = 0.0
        this.particlePositions[i * 3] = cx + (Math.random() - 0.5) * 20.0
        this.particlePositions[i * 3 + 1] = 0.1 + Math.random() * 0.4
        this.particlePositions[i * 3 + 2] = cz + (Math.random() - 0.5) * 20.0
      }
      this.particlePositions[i * 3 + 1] += dt * 0.06
      if (this.particlePositions[i * 3 + 1] > 2.8) {
        this.particlePositions[i * 3 + 1] = 0.1
      }
    }

    this.#updateFlies(dt)
    this.#updateBees(dt)
  }

  // Advance the Thomas attractor one Euler step and return the new axis value.
  #thomasStep(v, driver, step) {
    return v + step * (Math.sin(driver) - THOMAS_B * v)
  }

  #updateFlies(dt) {
    const step = dt * FLY_RATE
    const anchors = this.#flyAnchors
    const state = this.#flyState
    for (let i = 0; i < this.flyCount; i++) {
      const j = i * 3
      const x = state[j]
      const y = state[j + 1]
      const z = state[j + 2]
      const nx = this.#thomasStep(x, y, step)
      const ny = this.#thomasStep(y, z, step)
      const nz = this.#thomasStep(z, x, step)
      state[j] = nx
      state[j + 1] = ny
      state[j + 2] = nz
      const a = ((i / FLY_PER_ANCHOR) | 0) * 3
      const s = FLY_SWARM_RADIUS * 0.22
      this.flyPositions[j] = anchors[a] + nx * s
      // Slight vertical squash so swarms dance in a loose column rather than a ball.
      this.flyPositions[j + 1] = Math.max(FLY_FLOOR_Y, anchors[a + 1] + ny * s * 0.85)
      this.flyPositions[j + 2] = anchors[a + 2] + nz * s
    }
  }

  #updateBees(dt) {
    const anchors = this.#beeAnchors
    const vel = this.#beeVel
    const pos = this.beePositions
    const tm = this.#insectTime
    const drag = Math.exp(-BEE_DRAG * dt)
    const jitter = BEE_JITTER * dt
    const dartChance = BEE_DART_RATE * dt
    const pull = BEE_HOME_PULL * dt
    for (let i = 0; i < this.beeCount; i++) {
      const j = i * 3
      // Home slowly wanders the meadow between flowers.
      const rx = this.#beeRoamPhase[i * 2]
      const rz = this.#beeRoamPhase[i * 2 + 1]
      const homeX = anchors[j] + Math.sin(tm * 0.13 + rx) * BEE_ROAM_RADIUS
      const homeY = anchors[j + 1]
      const homeZ = anchors[j + 2] + Math.cos(tm * 0.11 + rz) * BEE_ROAM_RADIUS

      // Continuous random jitter — the restless, unpredictable hover.
      vel[j] += (Math.random() - 0.5) * jitter
      vel[j + 1] += (Math.random() - 0.5) * jitter * 0.6
      vel[j + 2] += (Math.random() - 0.5) * jitter
      // Occasional sharp dart to a random heading.
      if (Math.random() < dartChance) {
        vel[j] += (Math.random() - 0.5) * BEE_DART_SPEED
        vel[j + 1] += (Math.random() - 0.5) * BEE_DART_SPEED * 0.6
        vel[j + 2] += (Math.random() - 0.5) * BEE_DART_SPEED
      }
      // Spring back toward home so bees stay in their patch, then damp.
      vel[j] = (vel[j] + (homeX - pos[j]) * pull) * drag
      vel[j + 1] = (vel[j + 1] + (homeY - pos[j + 1]) * pull) * drag
      vel[j + 2] = (vel[j + 2] + (homeZ - pos[j + 2]) * pull) * drag

      pos[j] += vel[j] * dt
      pos[j + 1] = Math.max(BEE_FLOOR_Y, pos[j + 1] + vel[j + 1] * dt)
      pos[j + 2] += vel[j + 2] * dt
    }
  }
}
