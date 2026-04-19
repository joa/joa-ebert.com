// Wind System
// ###########
//
// Animates wind direction and strength over time. Provides uniform data
// (windTime, windStrength, windDirection) for grass and particle shaders.

// slower time progression for calm wind.
// at 60fps, dt is roughly 16ms; we make the wind time
// progress 100x slower then real time.
const TIME_DAMPING_FACTOR = 0.01

export class WindSystem {
  #uniforms = {
    windTime: 0.0,
    windStrength: 0.5,
    windDirection: [1.0, 0.0],
  }

  update(dt, timeInfo) {
    const u = this.#uniforms
    u.windTime += dt * TIME_DAMPING_FACTOR

    // slow changes in wind direction with smaller variation
    const angle = Math.sin(u.windTime * 0.001) * 0.2

    u.windStrength = timeInfo.windStrength
    u.windDirection[0] = Math.cos(angle)
    u.windDirection[1] = Math.sin(angle)
  }

  get uniforms() {
    return this.#uniforms
  }
}
