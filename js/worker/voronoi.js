// Voronoi Worker
// ##############
//
// Web worker for async grass tile blade computation. Receives heightmap data once
// via a "heightmap" message, then computes blade positions and Voronoi noise for
// individual tiles on demand. Results are transferred (zero-copy) back to the main
// thread as per-tile Float32Array slices.

import { voronoiCell } from "../shared/voronoi.js"

const TILE_SIZE = 2.0

let hmData = null,
  hmSize = 0,
  hmWuSize = 0

function sampleHeight(x, z) {
  if (!hmData) return 0.0
  const size = hmSize
  const u = x / hmWuSize + 0.5
  const v = z / hmWuSize + 0.5
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0.0
  const px = Math.max(0, Math.min(size - 1.001, u * size - 0.5))
  const pz = Math.max(0, Math.min(size - 1.001, v * size - 0.5))
  const ix0 = Math.floor(px),
    iz0 = Math.floor(pz)
  const ix1 = Math.min(size - 1, ix0 + 1)
  const iz1 = Math.min(size - 1, iz0 + 1)
  const fx = px - ix0,
    fz = pz - iz0
  const h00 = hmData[(iz0 * size + ix0) << 2] / 0xff
  const h10 = hmData[(iz0 * size + ix1) << 2] / 0xff
  const h01 = hmData[(iz1 * size + ix0) << 2] / 0xff
  const h11 = hmData[(iz1 * size + ix1) << 2] / 0xff
  return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
}

function grassHash(px, pz) {
  const n = Math.sin(px * 127.1 + pz * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function grassValueNoise(px, pz) {
  const ix = Math.floor(px),
    iz = Math.floor(pz)
  const fx = px - ix,
    fz = pz - iz
  const ux = fx * fx * (3.0 - 2.0 * fx),
    uz = fz * fz * (3.0 - 2.0 * fz)
  const a = grassHash(ix, iz),
    b = grassHash(ix + 1, iz)
  const c = grassHash(ix, iz + 1),
    d = grassHash(ix + 1, iz + 1)
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz
}

function tileHash(tx, tz, idx, layer) {
  const n = Math.sin(tx * 127.1 + tz * 311.7 + idx * 74.7 + layer * 1731.3) * 43758.5453
  return n - Math.floor(n)
}

function cpuHash(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function computeTileBlades(tx, tz, bladeStart, bladeCount, layer) {
  const dynArr = new Float32Array(bladeCount * 6)
  const noiseArr = new Float32Array(bladeCount * 5)
  const worldX = tx * TILE_SIZE
  const worldZ = tz * TILE_SIZE
  for (let b = 0; b < bladeCount; b++) {
    const x = worldX + tileHash(tx, tz, b * 2, layer) * TILE_SIZE
    const z = worldZ + tileHash(tx, tz, b * 2 + 1, layer) * TILE_SIZE
    const groundY = sampleHeight(x, z)
    const rollH = cpuHash(x * 17.31 + 0.5, z * 41.77 + 0.5)
    const base = b * 6
    dynArr[base] = x
    dynArr[base + 1] = 0
    dynArr[base + 2] = z
    dynArr[base + 3] = groundY
    dynArr[base + 4] = (rollH * 2.0 - 1.0) * 0.65
    dynArr[base + 5] = 0.05 + cpuHash(x * 3.71 + 0.3, z * 11.37 + 0.3) * 0.11
    const [tuftDist, tuftSeed] = voronoiCell(x * 7.0, z * 7.0)
    const nb = b * 5
    noiseArr[nb] = tuftDist
    noiseArr[nb + 1] = tuftSeed
    noiseArr[nb + 2] = grassValueNoise(x * 0.5, z * 0.5) * 0.3 - 0.15
    noiseArr[nb + 3] = grassValueNoise(x * 2.0, z * 2.0) * 0.1 - 0.05
    noiseArr[nb + 4] = grassValueNoise(x * 4.0, z * 4.0) * 0.3 - 0.15
  }
  return { dynArr, noiseArr }
}

self.onmessage = ({ data }) => {
  if (data.type === "heightmap") {
    hmData = data.data
    hmSize = data.size
    hmWuSize = data.wuSize
    return
  }
  if (data.type === "compute") {
    const { tx, tz, bladeStart, bladeCount, layer } = data
    const { dynArr, noiseArr } = computeTileBlades(tx, tz, bladeStart, bladeCount, layer)
    self.postMessage({ bladeStart, layer, dynArr, noiseArr }, [dynArr.buffer, noiseArr.buffer])
  }
}
