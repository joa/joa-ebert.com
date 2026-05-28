// Ball System
// ###########
//
// Soccer ball placed in the grass scene.  Uses a procedural icosphere (≈320
// triangles) so no external GLB asset is required.  Gentle sine-wave bounce
// animation drives the Y component of the model matrix each frame.

// World position of the ball (bottom of sphere)
export const BALL_POS = Object.freeze({ x: -15, y: 1, z: -3 })//{ x: 3.5, y: 0, z: -6 })

const BALL_RADIUS = 0.25 // wu

const PHI = (1 + Math.sqrt(5)) / 2

function norm3(v) {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

function midpoint(a, b, cache, verts) {
  const key = Math.min(a, b) * 65536 + Math.max(a, b)
  if (cache.has(key)) return cache.get(key)
  const va = verts[a],
    vb = verts[b]
  const m = norm3([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])
  verts.push(m)
  const idx = verts.length - 1
  cache.set(key, idx)
  return idx
}

// Builds an icosphere centered at origin with radius BALL_RADIUS.
// Positions and normals are in local (object) space — the model matrix
// places the ball in the world.
export function buildIcosphere(subdivisions = 2) {
  const t = 1 / Math.sqrt(1 + PHI * PHI)
  const p = PHI * t
  const rawVerts = [
    [-t, p, 0],
    [t, p, 0],
    [-t, -p, 0],
    [t, -p, 0],
    [0, -t, p],
    [0, t, p],
    [0, -t, -p],
    [0, t, -p],
    [p, 0, -t],
    [p, 0, t],
    [-p, 0, -t],
    [-p, 0, t],
  ]
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ]

  const cache = new Map()
  for (let s = 0; s < subdivisions; s++) {
    const next = []
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b, cache, rawVerts)
      const bc = midpoint(b, c, cache, rawVerts)
      const ca = midpoint(c, a, cache, rawVerts)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }

  const vertCount = rawVerts.length
  const positions = new Float32Array(vertCount * 3)
  const normals = new Float32Array(vertCount * 3)

  for (let i = 0; i < vertCount; i++) {
    const [x, y, z] = rawVerts[i]
    // Local space: centered at origin, radius BALL_RADIUS
    positions[i * 3] = x * BALL_RADIUS
    positions[i * 3 + 1] = y * BALL_RADIUS
    positions[i * 3 + 2] = z * BALL_RADIUS
    // Normal == normalized position for a perfect sphere
    normals[i * 3] = x
    normals[i * 3 + 1] = y
    normals[i * 3 + 2] = z
  }

  const indices = new Uint16Array(faces.length * 3)
  let k = 0
  for (const [a, b, c] of faces) {
    indices[k++] = a
    indices[k++] = b
    indices[k++] = c
  }

  return { positions, normals, indices, indexCount: k, vertCount }
}

export class BallSystem {
  #time = 0

  update(dtS) {
    this.#time += dtS
  }

  // Column-major 4×4 model matrix: places the ball at BALL_POS with idle bob.
  buildModelMatrix() {
    const m = new Float32Array(16)
    const bob = Math.sin(this.#time * 0.008) * 0.05
    // Scale = identity, translation includes ball radius so sphere sits on ground
    m[0] = 1
    m[5] = 1
    m[10] = 1
    m[15] = 1
    m[12] = BALL_POS.x
    m[13] = BALL_POS.y + BALL_RADIUS + bob
    m[14] = BALL_POS.z
    return m
  }
}
