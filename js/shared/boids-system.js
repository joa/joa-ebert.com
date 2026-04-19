// Boids System
// ############
//
// CPU flocking simulation for the bird flock. 500 (mobile) / 1000 (desktop) birds.
// Forces: separation, alignment, cohesion, lemniscate orbit seek, mouse-ray repulsion.
// Exported constants (BIRD_COUNT, BIRD_ORBIT_RADIUS, etc.) are used by shaders and controls.
import S from "./settings"

export const BIRD_COUNT = S.isMobile ? 500 : 1000
export const BIRD_ORBIT_RADIUS = 20 // lemniscate parameter `a` in world units
export const BIRD_ORBIT_DISTANCE = 60 // wu ahead of camera's look-at along forward dir
export const BIRD_ORBIT_SPEED = 1.08 // radians / second
export const BIRD_ORBIT_TILT = 1.35 * Math.PI // radians: tilts the figure-8 plane off horizontal
export const BIRD_MIN_ALTITUDE = 20 // hard floor

export class BoidsSystem {
  positions = new Float32Array(BIRD_COUNT * 3)
  velocities = new Float32Array(BIRD_COUNT * 3)
  wingPhases = new Float32Array(BIRD_COUNT)
  beatSpeeds = new Float32Array(BIRD_COUNT)
  #newVel = new Float32Array(BIRD_COUNT * 3)
  #orbitT = 0

  constructor() {
    this.#init()
  }

  #init() {
    for (let i = 0; i < BIRD_COUNT; i++) {
      const i3 = i * 3
      this.positions[i3] = (Math.random() - 0.5) * 40
      this.positions[i3 + 1] = BIRD_MIN_ALTITUDE + Math.random() * 10
      this.positions[i3 + 2] = 40 + Math.random() * 40
      this.velocities[i3] = (Math.random() - 0.5) * 6
      this.velocities[i3 + 1] = (Math.random() - 0.5) * 2
      this.velocities[i3 + 2] = (Math.random() - 0.5) * 6
      this.wingPhases[i] = Math.random() * Math.PI * 2
      this.beatSpeeds[i] = 0.85 + Math.random() * 0.15
    }
  }

  #lemniscate(t) {
    const sinT = Math.sin(t)
    const cosT = Math.cos(t)
    const denom = 1 + sinT * sinT
    return [(BIRD_ORBIT_RADIUS * cosT) / denom, BIRD_MIN_ALTITUDE + (BIRD_ORBIT_RADIUS * sinT * cosT) / denom]
  }

  update(dt, cameraPos, lookAt, timeInfo, mouseRay = null) {
    const dtSec = dt * 0.001
    this.#orbitT += BIRD_ORBIT_SPEED * dtSec
    const lx = lookAt[0] - cameraPos[0]
    const ly = lookAt[1] - cameraPos[1]
    const lz = lookAt[2] - cameraPos[2]
    const ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1
    const cx = cameraPos[0] + (lx / ll) * BIRD_ORBIT_DISTANCE
    const cy = cameraPos[1] + (ly / ll) * BIRD_ORBIT_DISTANCE
    const cz = cameraPos[2] + (lz / ll) * BIRD_ORBIT_DISTANCE
    const [ox, oy] = this.#lemniscate(this.#orbitT)
    const tilt = BIRD_ORBIT_TILT
    const targetX = cx + ox
    const targetY = cy - oy * Math.sin(tilt)
    const targetZ = cz + oy * Math.cos(tilt)
    const maxSpeed = timeInfo.birdMaxSpeed ?? 8.0
    const maxForce = timeInfo.birdMaxForce ?? 3.0
    const sepR2 = (timeInfo.birdSeparationRadius ?? 3.5) ** 2
    const aliR2 = (timeInfo.birdAlignmentRadius ?? 6.0) ** 2
    const cohR2 = (timeInfo.birdCohesionRadius ?? 5.0) ** 2
    const sepW = timeInfo.birdSeparationWeight ?? 1.5
    const aliW = timeInfo.birdAlignmentWeight ?? 1.0
    const cohW = timeInfo.birdCohesionWeight ?? 0.8
    const seekW = timeInfo.birdSeekWeight ?? 0.6
    const altitude = timeInfo.birdAltitude ?? 15.0
    const pos = this.positions
    const vel = this.velocities
    const newVel = this.#newVel

    for (let i = 0; i < BIRD_COUNT; i++) {
      const i3 = i * 3
      const px = pos[i3],
        py = pos[i3 + 1],
        pz = pos[i3 + 2]
      const vx = vel[i3],
        vy = vel[i3 + 1],
        vz = vel[i3 + 2]
      let sepX = 0,
        sepY = 0,
        sepZ = 0,
        sepCount = 0
      let aliX = 0,
        aliY = 0,
        aliZ = 0,
        aliCount = 0
      let cohX = 0,
        cohY = 0,
        cohZ = 0,
        cohCount = 0
      for (let j = 0; j < BIRD_COUNT; j++) {
        if (i === j) continue
        const j3 = j * 3
        const dx = px - pos[j3],
          dy = py - pos[j3 + 1],
          dz = pz - pos[j3 + 2]
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < 0.0001) continue
        const inSep = d2 < sepR2,
          inAli = d2 < aliR2,
          inCoh = d2 < cohR2
        if (!inSep && !inAli && !inCoh) continue
        const inv = 1 / Math.sqrt(d2)
        if (inSep) {
          sepX += dx * inv
          sepY += dy * inv
          sepZ += dz * inv
          sepCount++
        }
        if (inAli) {
          aliX += vel[j3]
          aliY += vel[j3 + 1]
          aliZ += vel[j3 + 2]
          aliCount++
        }
        if (inCoh) {
          cohX += pos[j3]
          cohY += pos[j3 + 1]
          cohZ += pos[j3 + 2]
          cohCount++
        }
      }

      let forceX = 0,
        forceY = 0,
        forceZ = 0

      if (sepCount > 0) {
        const len = Math.sqrt(sepX * sepX + sepY * sepY + sepZ * sepZ)
        if (len > 0) {
          const s = (maxSpeed * sepW) / len
          forceX += sepX * s
          forceY += sepY * s
          forceZ += sepZ * s
        }
      }

      if (aliCount > 0) {
        const ax = aliX / aliCount,
          ay = aliY / aliCount,
          az = aliZ / aliCount
        const len = Math.sqrt(ax * ax + ay * ay + az * az)
        if (len > 0) {
          const s = maxSpeed / len
          forceX += (ax * s - vx) * aliW
          forceY += (ay * s - vy) * aliW
          forceZ += (az * s - vz) * aliW
        }
      }

      if (cohCount > 0) {
        const dx2 = cohX / cohCount - px,
          dy2 = cohY / cohCount - py,
          dz2 = cohZ / cohCount - pz
        const len = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2)
        if (len > 0) {
          const s = maxSpeed / len
          forceX += (dx2 * s - vx) * cohW
          forceY += (dy2 * s - vy) * cohW
          forceZ += (dz2 * s - vz) * cohW
        }
      }

      const sdx = targetX - px,
        sdy = targetY - py,
        sdz = targetZ - pz
      const slen = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz)
      if (slen > 0) {
        const s = maxSpeed / slen
        forceX += (sdx * s - vx) * seekW
        forceY += (sdy * s - vy) * seekW
        forceZ += (sdz * s - vz) * seekW
      }

      if (mouseRay) {
        const { ox, oy, oz, dx, dy, dz } = mouseRay
        const tpx = px - ox,
          tpy = py - oy,
          tpz = pz - oz
        const tProj = tpx * dx + tpy * dy + tpz * dz
        const cpx = tpx - tProj * dx,
          cpy = tpy - tProj * dy,
          cpz = tpz - tProj * dz
        const dist2 = cpx * cpx + cpy * cpy + cpz * cpz
        const MOUSE_RADIUS = 6.0
        if (dist2 < MOUSE_RADIUS * MOUSE_RADIUS && dist2 > 0.0001) {
          const dist = Math.sqrt(dist2)
          const strength = maxSpeed * 1000.0 * (1.0 - dist / MOUSE_RADIUS)
          forceX += (cpx / dist) * strength
          forceY += (cpy / dist) * strength
          forceZ += (cpz / dist) * strength
        }
      }

      forceY += (altitude - py) * 0.2

      const flen = Math.sqrt(forceX * forceX + forceY * forceY + forceZ * forceZ)
      if (flen > maxForce) {
        const inv2 = maxForce / flen
        forceX *= inv2
        forceY *= inv2
        forceZ *= inv2
      }

      let nvx = vx + forceX * dtSec,
        nvy = vy + forceY * dtSec,
        nvz = vz + forceZ * dtSec

      const speed = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz)

      if (speed > maxSpeed) {
        const inv3 = maxSpeed / speed
        nvx *= inv3
        nvy *= inv3
        nvz *= inv3
      }

      newVel[i3] = nvx
      newVel[i3 + 1] = nvy
      newVel[i3 + 2] = nvz
    }

    for (let i = 0; i < BIRD_COUNT; i++) {
      const i3 = i * 3

      vel[i3] = newVel[i3]
      vel[i3 + 1] = newVel[i3 + 1]
      vel[i3 + 2] = newVel[i3 + 2]
      pos[i3] += vel[i3] * dtSec
      pos[i3 + 1] += vel[i3 + 1] * dtSec
      pos[i3 + 2] += vel[i3 + 2] * dtSec
      if (pos[i3 + 1] < BIRD_MIN_ALTITUDE) {
        pos[i3 + 1] = BIRD_MIN_ALTITUDE
        if (vel[i3 + 1] < 0) vel[i3 + 1] = 0
      }
    }
  }
}
