// Cloud Noise Worker
// ##################
//
// Computes the tileable 3D noise texture used for cloud/fog rendering and
// transfers it back zero-copy. Four rgba8 channels, all periodic across the
// tile so every octave baked here (integer frequencies, lacunarity 2) wraps
// seamlessly:
//
//   R — value noise, PX/PY/PZ features per tile. Consumed by fog, mountain
//       materials, stars — the pre-existing single-channel noise, unchanged.
//   G — cloud base shape: 4-octave Perlin fbm dilated by inverted-Worley fbm
//       (Perlin–Worley, Schneider "Real-Time Volumetric Cloudscapes of
//       Horizon: Zero Dawn", SIGGRAPH 2015). Billowy connected masses instead
//       of the smoky blobs value noise gives.
//   B — cloud edge erosion: 3-octave Worley fbm. Carving with cellular noise
//       rounds edges into cauliflower billows; subtracting value noise mushes.
//   A — weather/wobble field: 3-octave value fbm, sampled by the shader at
//       very low frequency for mesoscale coverage clumping and slab wobble.
//
// Baking whole fbm stacks into single channels is what lets cloudDensity()
// run on ~4 texture fetches instead of ~18.

import { smoothstep } from "../shared/math-utils.js"

const CHANNELS = 4

const fract = n => n - Math.floor(n)
const hash3 = (x, y, z, seed) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 53.63) * 43758.5453)

// 12 cube-edge gradient directions (Perlin, "Improving Noise", 2002)
const GRAD = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1,
  -1,
])

const fade = t => t * t * t * (t * (t * 6 - 15) + 10)

// Periodic Perlin octave with freq cells per tile, evaluated over the whole
// out grid and accumulated with amp. Gradients are pre-hashed into a padded
// (freq+1)³ lattice — the +1 border repeats the wrap so the texel loop needs
// no modulo and no hashing, only indexed dot products.
function addPerlinOctave(acc, W, H, D, freq, amp, seed) {
  const L = freq + 1
  const grads = new Int32Array(L * L * L)
  for (let iz = 0; iz < L; iz++) {
    for (let iy = 0; iy < L; iy++) {
      for (let ix = 0; ix < L; ix++) {
        grads[(iz * L + iy) * L + ix] = ((hash3(ix % freq, iy % freq, iz % freq, seed) * 12) | 0) * 3
      }
    }
  }
  const cell = new Int32Array(W)
  const frac = new Float32Array(W)
  const eased = new Float32Array(W)
  for (let t = 0; t < W; t++) {
    const x = ((t + 0.5) / W) * freq
    cell[t] = Math.floor(x)
    frac[t] = x - cell[t]
    eased[t] = fade(frac[t])
  }
  let i = 0
  for (let tz = 0; tz < D; tz++) {
    const iz = cell[tz],
      fz = frac[tz],
      ez = eased[tz]
    for (let ty = 0; ty < H; ty++) {
      const iy = cell[ty],
        fy = frac[ty],
        ey = eased[ty]
      const row00 = (iz * L + iy) * L
      const row10 = (iz * L + iy + 1) * L
      const row01 = ((iz + 1) * L + iy) * L
      const row11 = ((iz + 1) * L + iy + 1) * L
      for (let tx = 0; tx < W; tx++, i++) {
        const ix = cell[tx],
          fx = frac[tx],
          ex = eased[tx]
        const fx1 = fx - 1,
          fy1 = fy - 1,
          fz1 = fz - 1
        let g = grads[row00 + ix]
        const n000 = GRAD[g] * fx + GRAD[g + 1] * fy + GRAD[g + 2] * fz
        g = grads[row00 + ix + 1]
        const n100 = GRAD[g] * fx1 + GRAD[g + 1] * fy + GRAD[g + 2] * fz
        g = grads[row10 + ix]
        const n010 = GRAD[g] * fx + GRAD[g + 1] * fy1 + GRAD[g + 2] * fz
        g = grads[row10 + ix + 1]
        const n110 = GRAD[g] * fx1 + GRAD[g + 1] * fy1 + GRAD[g + 2] * fz
        g = grads[row01 + ix]
        const n001 = GRAD[g] * fx + GRAD[g + 1] * fy + GRAD[g + 2] * fz1
        g = grads[row01 + ix + 1]
        const n101 = GRAD[g] * fx1 + GRAD[g + 1] * fy + GRAD[g + 2] * fz1
        g = grads[row11 + ix]
        const n011 = GRAD[g] * fx + GRAD[g + 1] * fy1 + GRAD[g + 2] * fz1
        g = grads[row11 + ix + 1]
        const n111 = GRAD[g] * fx1 + GRAD[g + 1] * fy1 + GRAD[g + 2] * fz1
        const nx00 = n000 + ex * (n100 - n000)
        const nx10 = n010 + ex * (n110 - n010)
        const nx01 = n001 + ex * (n101 - n001)
        const nx11 = n011 + ex * (n111 - n011)
        const nxy0 = nx00 + ey * (nx10 - nx00)
        const nxy1 = nx01 + ey * (nx11 - nx01)
        acc[i] += (nxy0 + ez * (nxy1 - nxy0)) * amp
      }
    }
  }
}

// Periodic inverted-Worley octave: 1 − distance to the nearest jittered
// feature point (one per cell), so cell centres read 1 and cell walls fall
// toward 0 — the billow profile. The point grid is padded by one wrapped cell
// on every side, with positions pre-offset into the padded frame, so the
// 27-neighbour search is straight indexed reads with no modulo.
function addWorleyOctave(acc, W, H, D, freq, amp, seed) {
  const P = freq + 2
  const points = new Float32Array(P * P * P * 3)
  for (let pz = -1; pz <= freq; pz++) {
    const wz = ((pz % freq) + freq) % freq
    for (let py = -1; py <= freq; py++) {
      const wy = ((py % freq) + freq) % freq
      for (let px = -1; px <= freq; px++) {
        const wx = ((px % freq) + freq) % freq
        const p = (((pz + 1) * P + py + 1) * P + px + 1) * 3
        points[p] = px + hash3(wx, wy, wz, seed + 1.7)
        points[p + 1] = py + hash3(wx, wy, wz, seed + 4.2)
        points[p + 2] = pz + hash3(wx, wy, wz, seed + 8.9)
      }
    }
  }
  const cell = new Int32Array(W)
  const pos = new Float32Array(W)
  for (let t = 0; t < W; t++) {
    pos[t] = ((t + 0.5) / W) * freq
    cell[t] = Math.floor(pos[t])
  }
  let i = 0
  for (let tz = 0; tz < D; tz++) {
    const z = pos[tz]
    const czBase = cell[tz] // padded index of the dz=-1 plane
    for (let ty = 0; ty < H; ty++) {
      const y = pos[ty]
      const cyBase = cell[ty]
      for (let tx = 0; tx < W; tx++, i++) {
        const x = pos[tx]
        const cxBase = cell[tx]
        let best = 4.0
        for (let dz = 0; dz < 3; dz++) {
          const planeRow = (czBase + dz) * P
          for (let dy = 0; dy < 3; dy++) {
            let p = ((planeRow + cyBase + dy) * P + cxBase) * 3
            for (let dx = 0; dx < 3; dx++, p += 3) {
              const ex = points[p] - x
              const ey = points[p + 1] - y
              const ez = points[p + 2] - z
              const d2 = ex * ex + ey * ey + ez * ez
              if (d2 < best) best = d2
            }
          }
        }
        acc[i] += (1 - Math.min(Math.sqrt(best), 1)) * amp
      }
    }
  }
}

// Periodic value-noise octave (trilinear lattice interpolation, smoothstepped).
function addValueOctave(acc, W, H, D, freq, amp, seed) {
  const L = freq + 1
  const lattice = new Float32Array(L * L * L)
  for (let iz = 0; iz < L; iz++) {
    for (let iy = 0; iy < L; iy++) {
      for (let ix = 0; ix < L; ix++) {
        lattice[(iz * L + iy) * L + ix] = hash3(ix % freq, iy % freq, iz % freq, seed)
      }
    }
  }
  const cell = new Int32Array(W)
  const eased = new Float32Array(W)
  for (let t = 0; t < W; t++) {
    const x = ((t + 0.5) / W) * freq
    cell[t] = Math.floor(x)
    eased[t] = smoothstep(x - cell[t])
  }
  let i = 0
  for (let tz = 0; tz < D; tz++) {
    const iz = cell[tz],
      ez = eased[tz]
    for (let ty = 0; ty < H; ty++) {
      const iy = cell[ty],
        ey = eased[ty]
      const row0 = (iz * L + iy) * L
      const row1 = (iz * L + iy + 1) * L
      const row2 = ((iz + 1) * L + iy) * L
      const row3 = ((iz + 1) * L + iy + 1) * L
      for (let tx = 0; tx < W; tx++, i++) {
        const ix = cell[tx],
          ex = eased[tx]
        const v00 = lattice[row0 + ix] + ex * (lattice[row0 + ix + 1] - lattice[row0 + ix])
        const v10 = lattice[row1 + ix] + ex * (lattice[row1 + ix + 1] - lattice[row1 + ix])
        const v01 = lattice[row2 + ix] + ex * (lattice[row2 + ix + 1] - lattice[row2 + ix])
        const v11 = lattice[row3 + ix] + ex * (lattice[row3 + ix + 1] - lattice[row3 + ix])
        const v0 = v00 + ey * (v10 - v00)
        const v1 = v01 + ey * (v11 - v01)
        acc[i] += (v0 + ez * (v1 - v0)) * amp
      }
    }
  }
}

// The pre-existing R-channel value noise: PX/PY/PZ features per tile on the
// legacy sin-hash lattice, bit-identical to the old single-channel texture.
function legacyValueNoise(W, H, D, PX, PY, PZ) {
  const LX = PX + 1,
    LY = PY + 1,
    LZ = PZ + 1
  const lattice = new Float32Array(LX * LY * LZ)
  for (let iz = 0; iz < LZ; iz++) {
    for (let iy = 0; iy < LY; iy++) {
      for (let ix = 0; ix < LX; ix++) {
        const n = Math.sin((ix % PX) * 127.1 + (iy % PY) * 311.7 + (iz % PZ) * 74.7) * 43758.5453
        lattice[(iz * LY + iy) * LX + ix] = n - Math.floor(n)
      }
    }
  }
  const l = (ix, iy, iz) => lattice[(iz * LY + iy) * LX + ix]
  const out = new Float32Array(W * H * D)
  let i = 0
  for (let tz = 0; tz < D; tz++) {
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++, i++) {
        const px = ((tx + 0.5) / W) * PX
        const py = ((ty + 0.5) / H) * PY
        const pz = ((tz + 0.5) / D) * PZ
        const ix = Math.floor(px)
        const iy = Math.floor(py)
        const iz = Math.floor(pz)
        const fx = smoothstep(px - ix)
        const fy = smoothstep(py - iy)
        const fz = smoothstep(pz - iz)
        out[i] =
          l(ix, iy, iz) * (1 - fx) * (1 - fy) * (1 - fz) +
          l(ix + 1, iy, iz) * fx * (1 - fy) * (1 - fz) +
          l(ix, iy + 1, iz) * (1 - fx) * fy * (1 - fz) +
          l(ix + 1, iy + 1, iz) * fx * fy * (1 - fz) +
          l(ix, iy, iz + 1) * (1 - fx) * (1 - fy) * fz +
          l(ix + 1, iy, iz + 1) * fx * (1 - fy) * fz +
          l(ix, iy + 1, iz + 1) * (1 - fx) * fy * fz +
          l(ix + 1, iy + 1, iz + 1) * fx * fy * fz
      }
    }
  }
  return out
}

const remap01 = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)))

// Periodic trilinear upsample from a half-resolution working grid. The
// low-frequency dilation field doesn't need full-resolution evaluation — this
// halves its generation cost 8×.
function upsamplePeriodic(src, sw, sh, sd, W, H, D) {
  const out = new Float32Array(W * H * D)
  const cell = new Int32Array(W)
  const frac = new Float32Array(W)
  for (let t = 0; t < W; t++) {
    const x = ((t + 0.5) / W) * sw - 0.5
    const ix = Math.floor(x)
    cell[t] = ((ix % sw) + sw) % sw
    frac[t] = x - ix
  }
  const wrap = (c, n) => (c + 1 === n ? 0 : c + 1)
  let i = 0
  for (let tz = 0; tz < D; tz++) {
    const iz = cell[tz],
      fz = frac[tz],
      jz = wrap(iz, sd)
    for (let ty = 0; ty < H; ty++) {
      const iy = cell[ty],
        fy = frac[ty],
        jy = wrap(iy, sh)
      const r00 = (iz * sh + iy) * sw
      const r10 = (iz * sh + jy) * sw
      const r01 = (jz * sh + iy) * sw
      const r11 = (jz * sh + jy) * sw
      for (let tx = 0; tx < W; tx++, i++) {
        const ix = cell[tx],
          fx = frac[tx],
          jx = wrap(ix, sw)
        const v00 = src[r00 + ix] + fx * (src[r00 + jx] - src[r00 + ix])
        const v10 = src[r10 + ix] + fx * (src[r10 + jx] - src[r10 + ix])
        const v01 = src[r01 + ix] + fx * (src[r01 + jx] - src[r01 + ix])
        const v11 = src[r11 + ix] + fx * (src[r11 + jx] - src[r11 + ix])
        const v0 = v00 + fy * (v10 - v00)
        const v1 = v01 + fy * (v11 - v01)
        out[i] = v0 + fz * (v1 - v0)
      }
    }
  }
  return out
}

self.onmessage = ({ data }) => {
  const { W, H, D, PX, PY, PZ } = data
  const texels = W * H * D

  const value = legacyValueNoise(W, H, D, PX, PY, PZ)

  // G — Perlin fbm [-~1, ~1] dilated by inverted-Worley fbm.
  const perlin = new Float32Array(texels)
  addPerlinOctave(perlin, W, H, D, 4, 0.5, 0.0)
  addPerlinOctave(perlin, W, H, D, 8, 0.25, 11.3)
  addPerlinOctave(perlin, W, H, D, 16, 0.125, 23.9)
  addPerlinOctave(perlin, W, H, D, 32, 0.0625, 31.4)
  const hw = W >> 1,
    hh = H >> 1,
    hd = D >> 1
  const dilateHalf = new Float32Array(hw * hh * hd)
  addWorleyOctave(dilateHalf, hw, hh, hd, 6, 0.625, 3.1)
  addWorleyOctave(dilateHalf, hw, hh, hd, 12, 0.25, 7.7)
  addWorleyOctave(dilateHalf, hw, hh, hd, 24, 0.125, 13.2)
  const dilate = upsamplePeriodic(dilateHalf, hw, hh, hd, W, H, D)

  // B — Worley fbm for edge erosion.
  const detail = new Float32Array(texels)
  addWorleyOctave(detail, W, H, D, 8, 0.625, 41.6)
  addWorleyOctave(detail, W, H, D, 16, 0.25, 47.1)
  addWorleyOctave(detail, W, H, D, 32, 0.125, 53.8)

  // A — low-frequency value fbm (weather/wobble), normalized to [0, 1].
  const weather = new Float32Array(texels)
  addValueOctave(weather, W, H, D, 4, 0.5 / 0.875, 61.7)
  addValueOctave(weather, W, H, D, 8, 0.25 / 0.875, 67.3)
  addValueOctave(weather, W, H, D, 16, 0.125 / 0.875, 71.9)

  // The dilation remap compresses the base field into a narrow high band;
  // this affine (constants measured from the generated distribution) restores
  // mean 0.5 with a wide spread so shader coverage thresholds bite cleanly.
  const BASE_MEAN = 0.669
  const BASE_GAIN = 2.1

  const out = new Uint8Array(texels * CHANNELS)
  for (let i = 0; i < texels; i++) {
    // Perlin fbm sum (max amp 0.9375, gradients reach ~0.7) → roughly [0, 1].
    const pn = 0.5 + perlin[i] * 0.65
    // Schneider's dilation: remap the Perlin field so the worley fbm floor
    // becomes 0 — connected masses gain billowy cellular boundaries.
    const baseShape = remap01(pn, dilate[i] - 1, 1)
    const base = Math.min(1, Math.max(0, 0.5 + (baseShape - BASE_MEAN) * BASE_GAIN))
    const o = i * CHANNELS
    out[o] = Math.round(value[i] * 0xff)
    out[o + 1] = Math.round(base * 0xff)
    out[o + 2] = Math.round(Math.min(1, detail[i]) * 0xff)
    out[o + 3] = Math.round(Math.min(1, weather[i]) * 0xff)
  }
  self.postMessage({ data: out }, [out.buffer])
}
