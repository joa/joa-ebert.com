// Grass Culler
// ############
//
// Per-tile frustum culling for the instanced grass fields. Instance buffers
// are tile-contiguous (bladeStart = slot * bladeCount, see GrassTileWorker),
// so visibility reduces to merged ranged draws with firstInstance offsets —
// no buffer reorganization and no GPU compute pass.
//
// The same culler works for the camera's perspective view-projection and the
// shadow light's orthographic view-projection: both define a clip volume whose
// planes are extracted directly from the matrix.

import { TILE_SIZE, NUM_TILES, DENSE_TILES, BLADE_HEIGHT } from "./gpu-buffers.js"

// Worst-case blade length from buildBladeAttribs: 0.75·H + 2·0.5·H·1.5 = 2.25·H,
// scaled per frame by timeInfo.grassHeightFactor.
const MAX_BLADE_WU = 2.25 * BLADE_HEIGHT
// Ground heightmap stores heights in [0,1] wu; padded for safety.
const GROUND_MAX_WU = 1.5
// Sentinel for tile slots the worker has not populated yet — kept visible.
const TILE_UNSET = 0x7fffffff

function aabbVisible(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  // p-vertex test: check the corner farthest along each plane normal.
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3]
    const px = a > 0 ? maxX : minX
    const py = b > 0 ? maxY : minY
    const pz = c > 0 ? maxZ : minZ
    if (a * px + b * py + c * pz + d < 0) return false
  }
  return true
}

export class GrassCuller {
  // 6 world-space planes as (a, b, c, d) with inside ⇔ a·x + b·y + c·z + d ≥ 0.
  #planes = new Float32Array(24)

  // Merged visible-slot runs per layer, as [firstSlot, slotCount] pairs.
  sparseRanges = new Int32Array(NUM_TILES * 2)
  denseRanges = new Int32Array(DENSE_TILES * 2)
  sparseRangeCount = 0
  denseRangeCount = 0

  // Gribb & Hartmann 2001, "Fast Extraction of Viewing Frustum Planes from the
  // World-View-Projection Matrix". WebGPU clip z ∈ [0,1], so the near plane is
  // row 3 alone. Matrices are column-major: row i = (m[i], m[i+4], m[i+8], m[i+12]).
  #extractPlanes(m) {
    const p = this.#planes
    const r1x = m[0],
      r1y = m[4],
      r1z = m[8],
      r1w = m[12]
    const r2x = m[1],
      r2y = m[5],
      r2z = m[9],
      r2w = m[13]
    const r3x = m[2],
      r3y = m[6],
      r3z = m[10],
      r3w = m[14]
    const r4x = m[3],
      r4y = m[7],
      r4z = m[11],
      r4w = m[15]
    // left, right, bottom, top, near, far
    p[0] = r4x + r1x
    p[1] = r4y + r1y
    p[2] = r4z + r1z
    p[3] = r4w + r1w
    p[4] = r4x - r1x
    p[5] = r4y - r1y
    p[6] = r4z - r1z
    p[7] = r4w - r1w
    p[8] = r4x + r2x
    p[9] = r4y + r2y
    p[10] = r4z + r2z
    p[11] = r4w + r2w
    p[12] = r4x - r2x
    p[13] = r4y - r2y
    p[14] = r4z - r2z
    p[15] = r4w - r2w
    p[16] = r3x
    p[17] = r3y
    p[18] = r3z
    p[19] = r3w
    p[20] = r4x - r3x
    p[21] = r4y - r3y
    p[22] = r4z - r3z
    p[23] = r4w - r3w
  }

  #cullLayer(coords, slotCount, inflateWu, maxYWu, out) {
    const planes = this.#planes
    let rangeCount = 0
    let runStart = -1
    for (let s = 0; s < slotCount; s++) {
      const tx = coords[s * 2]
      let visible = true
      if (tx !== TILE_UNSET) {
        const tz = coords[s * 2 + 1]
        const minX = tx * TILE_SIZE - inflateWu
        const minZ = tz * TILE_SIZE - inflateWu
        visible = aabbVisible(
          planes,
          minX,
          -0.5,
          minZ,
          minX + TILE_SIZE + 2 * inflateWu,
          maxYWu,
          minZ + TILE_SIZE + 2 * inflateWu
        )
      }
      if (visible) {
        if (runStart < 0) runStart = s
      } else if (runStart >= 0) {
        out[rangeCount * 2] = runStart
        out[rangeCount * 2 + 1] = s - runStart
        rangeCount++
        runStart = -1
      }
    }
    if (runStart >= 0) {
      out[rangeCount * 2] = runStart
      out[rangeCount * 2 + 1] = slotCount - runStart
      rangeCount++
    }
    return rangeCount
  }

  // Cull both grass layers against the clip volume of `viewProjection`.
  // Tile AABBs are inflated for wind sway, cursor push, and blade lean, with
  // the height bound derived from the live grassHeightFactor (controls max 8).
  cull(viewProjection, grass, grassHeightFactor) {
    this.#extractPlanes(viewProjection)
    const bladeMaxWu = MAX_BLADE_WU * Math.max(1, grassHeightFactor)
    const maxYWu = GROUND_MAX_WU + bladeMaxWu
    const inflateWu = 1.0 + 0.5 * bladeMaxWu
    this.sparseRangeCount = this.#cullLayer(grass.tileCoords, NUM_TILES, inflateWu, maxYWu, this.sparseRanges)
    this.denseRangeCount = this.#cullLayer(grass.denseTileCoords, DENSE_TILES, inflateWu, maxYWu, this.denseRanges)
  }
}
