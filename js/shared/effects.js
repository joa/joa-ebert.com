// Effects System
// ##############
//
// CPU simulation for rain drops, pollen particles, and fireflies.
// Manages position/lifetime arrays uploaded each frame to the GPU.

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
  rainCount = 0
  rainPositions = null

  // Simulation internals
  #particleSpeeds = null
  #fireflyBasePositions = null
  #fireflyPhases = null
  #fireflyDriftX = null
  #fireflyDriftZ = null
  #fireflyTime = 0

  constructor() {
    this.#initParticles(1000)
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
  }
}
