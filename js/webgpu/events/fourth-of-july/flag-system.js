// Flag System
// ###########
//
// CPU Verlet cloth simulation for the US flag, streamed to the GPU each frame.
// The flag mesh is 20×14 grid in world space.  The left column is pinned to
// the pole; wind + gravity drive the cloth movement.

export const FLAG_POS = Object.freeze({ x: -15, y: 0, z: -3 }) // pole base world position
const FLAG_WIDTH = 1.9 // wu
const FLAG_HEIGHT = 1.0 // wu (10:19 ratio)
const POLE_HEIGHT = 4.0 // wu
const FLAG_ATTACH_Y = POLE_HEIGHT * 0.92 // where left edge attaches

const COLS = 20 * 2
const ROWS = 14 * 2
const VERT_COUNT = COLS * ROWS
const FLOATS_PER_VERT = 8 // x y z nx ny nz u v
const STRIDE_BYTES = FLOATS_PER_VERT * 4

const REST_DX = FLAG_WIDTH / (COLS - 1)
const REST_DY = FLAG_HEIGHT / (ROWS - 1)

// Spring stiffness / iteration count
const STIFFNESS_STRUCTURAL = 0.9
const STIFFNESS_SHEAR = 0.2 // low: lets the flag bend freely in Z
const STIFFNESS_BEND = 0.1
const CONSTRAINT_ITERS = 4
const GRAVITY = -1.8
const DAMPING = 0.985
// Wind surface-pressure constants.  The flag lies in the XY plane, so wind
// pushes it in Z.  WIND_FORCE scales windStrength → wu/s² at the free end.
const WIND_FORCE = 64
const TURB_FREQ_T = 2.8 // temporal turbulence frequency (rad/s)
const TURB_FREQ_C = 0.7 // spatial turbulence frequency along columns

export class FlagSystem {
  // Interleaved vertex data written to GPU each frame
  verts = new Float32Array(VERT_COUNT * FLOATS_PER_VERT)

  // Physics state (world positions)
  #pos = new Float32Array(VERT_COUNT * 3)
  #prev = new Float32Array(VERT_COUNT * 3)
  #time = 0

  #indexCount = 0
  indices = null // Uint16Array — built once

  constructor() {
    this.#buildMesh()
  }

  #idx(col, row) {
    return row * COLS + col
  }

  #buildMesh() {
    const px = FLAG_POS.x
    const py = FLAG_ATTACH_Y
    const pz = FLAG_POS.z

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = this.#idx(col, row)
        const x = px + col * REST_DX
        const y = py - row * REST_DY
        const z = pz

        this.#pos[i * 3] = x
        this.#pos[i * 3 + 1] = y
        this.#pos[i * 3 + 2] = z

        this.#prev[i * 3] = x
        this.#prev[i * 3 + 1] = y
        this.#prev[i * 3 + 2] = z

        const base = i * FLOATS_PER_VERT
        this.verts[base] = x
        this.verts[base + 1] = y
        this.verts[base + 2] = z
        this.verts[base + 3] = 0
        this.verts[base + 4] = 0
        this.verts[base + 5] = 1 // normal pointing toward +Z
        this.verts[base + 6] = col / (COLS - 1)
        this.verts[base + 7] = row / (ROWS - 1)
      }
    }

    // Triangle indices
    const triCount = (COLS - 1) * (ROWS - 1) * 2
    this.indices = new Uint16Array(triCount * 3)
    this.#indexCount = triCount * 3
    let k = 0
    for (let row = 0; row < ROWS - 1; row++) {
      for (let col = 0; col < COLS - 1; col++) {
        const a = this.#idx(col, row)
        const b = this.#idx(col + 1, row)
        const c = this.#idx(col, row + 1)
        const d = this.#idx(col + 1, row + 1)
        this.indices[k++] = a
        this.indices[k++] = b
        this.indices[k++] = c
        this.indices[k++] = b
        this.indices[k++] = d
        this.indices[k++] = c
      }
    }
  }

  get indexCount() {
    return this.#indexCount
  }

  get strideBytesGPU() {
    return STRIDE_BYTES
  }

  #applyConstraint(iA, iB, restLen, stiffness) {
    const ax = this.#pos[iA * 3]
    const ay = this.#pos[iA * 3 + 1]
    const az = this.#pos[iA * 3 + 2]
    const bx = this.#pos[iB * 3]
    const by = this.#pos[iB * 3 + 1]
    const bz = this.#pos[iB * 3 + 2]
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-8
    const delta = ((len - restLen) / len) * 0.5 * stiffness
    const cx = dx * delta
    const cy = dy * delta
    const cz = dz * delta

    const pinnedA = iA % COLS === 0
    const pinnedB = iB % COLS === 0

    if (!pinnedA) {
      this.#pos[iA * 3] += cx
      this.#pos[iA * 3 + 1] += cy
      this.#pos[iA * 3 + 2] += cz
    }
    if (!pinnedB) {
      this.#pos[iB * 3] -= cx
      this.#pos[iB * 3 + 1] -= cy
      this.#pos[iB * 3 + 2] -= cz
    }
  }

  // windDirZ: Z component of the normalised wind direction vector (from WindSystem.uniforms.windDirection[1]).
  // Positive means wind blows toward +Z (into the flag face); negative means away.
  update(dtS, windStrength, windDirZ) {
    const dt = Math.min(dtS, 0.033)
    this.#time += dt

    for (let i = 0; i < VERT_COUNT; i++) {
      if (i % COLS === 0) continue // pinned

      const col = i % COLS
      const row = Math.floor(i / COLS)

      const vx = (this.#pos[i * 3] - this.#prev[i * 3]) * DAMPING
      const vy = (this.#pos[i * 3 + 1] - this.#prev[i * 3 + 1]) * DAMPING
      const vz = (this.#pos[i * 3 + 2] - this.#prev[i * 3 + 2]) * DAMPING

      const nx = this.#pos[i * 3]
      const ny = this.#pos[i * 3 + 1]
      const nz = this.#pos[i * 3 + 2]

      this.#prev[i * 3] = this.#pos[i * 3]
      this.#prev[i * 3 + 1] = this.#pos[i * 3 + 1]
      this.#prev[i * 3 + 2] = this.#pos[i * 3 + 2]

      // Wind acts perpendicular to the flag face (Z direction).
      // windDirZ scales by how directly the wind hits the face; a small bias
      // keeps the flag alive when wind is nearly parallel to it.
      const windFactor = col / (COLS - 1)
      const turbulence =
        Math.sin(this.#time * TURB_FREQ_T + col * TURB_FREQ_C) * 0.45 +
        Math.sin(this.#time * TURB_FREQ_T * 0.6 + row * 1.3 + col * 0.4) * 0.25
      const effectiveDirZ = windDirZ * 0.85 + Math.sign(windDirZ || 1) * 0.15
      const windAccelZ = windStrength * WIND_FORCE * effectiveDirZ * windFactor * (1 + turbulence)

      this.#pos[i * 3] = nx + vx
      this.#pos[i * 3 + 1] = ny + vy + GRAVITY * dt * dt
      this.#pos[i * 3 + 2] = nz + vz + windAccelZ * dt * dt
    }

    // Constraint relaxation
    const diagLen = Math.sqrt(REST_DX * REST_DX + REST_DY * REST_DY)
    const bendDX = REST_DX * 2
    const bendDY = REST_DY * 2

    for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const i = this.#idx(col, row)
          // Structural: right
          if (col < COLS - 1) this.#applyConstraint(i, this.#idx(col + 1, row), REST_DX, STIFFNESS_STRUCTURAL)
          // Structural: down
          if (row < ROWS - 1) this.#applyConstraint(i, this.#idx(col, row + 1), REST_DY, STIFFNESS_STRUCTURAL)
          // Shear: diagonal ↘
          if (col < COLS - 1 && row < ROWS - 1)
            this.#applyConstraint(i, this.#idx(col + 1, row + 1), diagLen, STIFFNESS_SHEAR)
          // Shear: diagonal ↗
          if (col > 0 && row < ROWS - 1) this.#applyConstraint(i, this.#idx(col - 1, row + 1), diagLen, STIFFNESS_SHEAR)
          // Bend: skip-1 right
          if (col < COLS - 2) this.#applyConstraint(i, this.#idx(col + 2, row), bendDX, STIFFNESS_BEND)
          // Bend: skip-1 down
          if (row < ROWS - 2) this.#applyConstraint(i, this.#idx(col, row + 2), bendDY, STIFFNESS_BEND)
        }
      }
    }

    // Write final positions + recompute normals
    for (let i = 0; i < VERT_COUNT; i++) {
      const base = i * FLOATS_PER_VERT
      this.verts[base] = this.#pos[i * 3]
      this.verts[base + 1] = this.#pos[i * 3 + 1]
      this.verts[base + 2] = this.#pos[i * 3 + 2]
    }
    this.#recomputeNormals()
  }

  #recomputeNormals() {
    // Zero accumulators
    const norm = new Float32Array(VERT_COUNT * 3)

    for (let row = 0; row < ROWS - 1; row++) {
      for (let col = 0; col < COLS - 1; col++) {
        const a = this.#idx(col, row)
        const b = this.#idx(col + 1, row)
        const c = this.#idx(col, row + 1)
        const d = this.#idx(col + 1, row + 1)

        const [nx1, ny1, nz1] = this.#triNormal(a, b, c)
        const [nx2, ny2, nz2] = this.#triNormal(b, d, c)

        for (const i of [a, b, c]) {
          norm[i * 3] += nx1
          norm[i * 3 + 1] += ny1
          norm[i * 3 + 2] += nz1
        }
        for (const i of [b, d, c]) {
          norm[i * 3] += nx2
          norm[i * 3 + 1] += ny2
          norm[i * 3 + 2] += nz2
        }
      }
    }

    for (let i = 0; i < VERT_COUNT; i++) {
      const len = Math.hypot(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]) || 1
      const base = i * FLOATS_PER_VERT
      this.verts[base + 3] = norm[i * 3] / len
      this.verts[base + 4] = norm[i * 3 + 1] / len
      this.verts[base + 5] = norm[i * 3 + 2] / len
    }
  }

  #triNormal(a, b, c) {
    const ax = this.#pos[a * 3],
      ay = this.#pos[a * 3 + 1],
      az = this.#pos[a * 3 + 2]
    const bx = this.#pos[b * 3],
      by = this.#pos[b * 3 + 1],
      bz = this.#pos[b * 3 + 2]
    const cx = this.#pos[c * 3],
      cy = this.#pos[c * 3 + 1],
      cz = this.#pos[c * 3 + 2]
    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az
    const fx = cx - ax,
      fy = cy - ay,
      fz = cz - az
    return [ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx]
  }
}

// Builds a simple 8-sided cylinder for the pole.
// Returns { positions: Float32Array, normals: Float32Array, indices: Uint16Array }
export function buildPoleMesh() {
  const SIDES = 8
  const RADIUS = 0.04
  const BOTTOM_Y = FLAG_POS.y
  const TOP_Y = POLE_HEIGHT + FLAG_POS.y
  const cx = FLAG_POS.x
  const cz = FLAG_POS.z

  const ringVerts = SIDES + 1 // +1 to close the seam
  const totalVerts = ringVerts * 2
  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const indices = new Uint16Array(SIDES * 6)

  for (let s = 0; s <= SIDES; s++) {
    const theta = (s / SIDES) * Math.PI * 2
    const nx = Math.cos(theta)
    const nz = Math.sin(theta)
    const px = cx + nx * RADIUS
    const pz = cz + nz * RADIUS

    const bot = s
    const top = s + ringVerts

    positions[bot * 3] = px
    positions[bot * 3 + 1] = BOTTOM_Y
    positions[bot * 3 + 2] = pz
    normals[bot * 3] = nx
    normals[bot * 3 + 1] = 0
    normals[bot * 3 + 2] = nz

    positions[top * 3] = px
    positions[top * 3 + 1] = TOP_Y
    positions[top * 3 + 2] = pz
    normals[top * 3] = nx
    normals[top * 3 + 1] = 0
    normals[top * 3 + 2] = nz
  }

  let k = 0
  for (let s = 0; s < SIDES; s++) {
    const b0 = s,
      b1 = s + 1
    const t0 = s + ringVerts,
      t1 = s + 1 + ringVerts
    indices[k++] = b0
    indices[k++] = b1
    indices[k++] = t0
    indices[k++] = b1
    indices[k++] = t1
    indices[k++] = t0
  }

  return { positions, normals, indices, indexCount: k }
}
