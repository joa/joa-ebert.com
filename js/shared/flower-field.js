// Flower Field
// ############
//
// CPU-side scatter of meadow flowers (clover, dandelion blooms & seed puffs)
// across a square ring of tiles that follows the camera. Placement is a pure
// function of world-tile coordinates, so re-anchoring when the camera crosses a
// tile boundary leaves every still-visible flower exactly where it was — only
// the tiles entering/leaving the far edge of the ring change, and those are far
// enough away that the swap is invisible. Instances are written to a single
// interleaved buffer consumed by flower.wgsl.

import S from "./settings.js"

export const FLOWER_TILE = 4.0 // wu covered by one scatter tile
export const FLOWER_GRID = S.isMobile ? 9 : 13 // scatter tiles across the ring
export const FLOWERS_PER_TILE = S.isMobile ? 3 : 4
export const FLOWER_COUNT = FLOWER_GRID * FLOWER_GRID * FLOWERS_PER_TILE

// Instance stride: position (vec3f) + data (vec4f: rotationRad, scale, kind, seed)
export const FLOWER_STRIDE = 7

export const FLOWER_CLOVER = 0
export const FLOWER_BLOOM = 1
export const FLOWER_PUFF = 2

function hash(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export class FlowerField {
  #data = new Float32Array(FLOWER_COUNT * FLOWER_STRIDE)
  #sampleGround
  #anchorTX = 0x7fffffff
  #anchorTZ = 0x7fffffff
  #half = (FLOWER_GRID / 2) | 0

  constructor(sampleGround) {
    this.#sampleGround = sampleGround
  }

  get data() {
    return this.#data
  }

  // Recompute placement when the camera crosses into a new anchor tile. Returns
  // true when the instance buffer changed and needs re-uploading.
  update(camX, camZ) {
    const anchorTX = Math.floor(camX / FLOWER_TILE) - this.#half
    const anchorTZ = Math.floor(camZ / FLOWER_TILE) - this.#half
    if (anchorTX === this.#anchorTX && anchorTZ === this.#anchorTZ) return false
    this.#anchorTX = anchorTX
    this.#anchorTZ = anchorTZ

    const d = this.#data
    let o = 0
    for (let dz = 0; dz < FLOWER_GRID; dz++) {
      for (let dx = 0; dx < FLOWER_GRID; dx++) {
        const tx = anchorTX + dx
        const tz = anchorTZ + dz
        for (let f = 0; f < FLOWERS_PER_TILE; f++) {
          const x = (tx + hash(tx * 12.9 + f * 3.3, tz * 78.2 + f * 7.7)) * FLOWER_TILE
          const z = (tz + hash(tx * 39.4 + f * 5.1, tz * 27.1 + f * 9.3)) * FLOWER_TILE
          const r = hash(tx * 4.7 + f * 1.9, tz * 8.3 + f * 2.6)
          const kind = r < 0.55 ? FLOWER_CLOVER : r < 0.8 ? FLOWER_BLOOM : FLOWER_PUFF
          const sizeH = hash(tx * 2.1 + f * 6.4, tz * 5.9 + f * 3.1)
          const scale = kind === FLOWER_CLOVER ? 0.13 + sizeH * 0.07 : 0.28 + sizeH * 0.16
          d[o] = x
          d[o + 1] = this.#sampleGround(x, z)
          d[o + 2] = z
          d[o + 3] = hash(tx * 1.3 + f * 4.4, tz * 9.7 + f * 8.1) * Math.PI * 2
          d[o + 4] = scale
          d[o + 5] = kind
          d[o + 6] = hash(tx * 6.6 + f * 2.2, tz * 3.8 + f * 5.5)
          o += FLOWER_STRIDE
        }
      }
    }
    return true
  }
}
