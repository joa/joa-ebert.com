// Cloud Noise Worker
// ##################
//
// Computes the tileable 3D value-noise texture data used for cloud/fog rendering.
// Receives dimension config via a single "compute" message and transfers the
// resulting Uint8Array back zero-copy so the main thread can upload it to the GPU.

import { smoothstep } from "../shared/math-utils.js"

self.onmessage = ({ data }) => {
  const { W, H, D, PX, PY, PZ } = data
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
  const out = new Uint8Array(W * H * D)
  for (let tz = 0; tz < D; tz++) {
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const px = ((tx + 0.5) / W) * PX
        const py = ((ty + 0.5) / H) * PY
        const pz = ((tz + 0.5) / D) * PZ
        const ix = Math.floor(px)
        const iy = Math.floor(py)
        const iz = Math.floor(pz)
        const fx = smoothstep(px - ix)
        const fy = smoothstep(py - iy)
        const fz = smoothstep(pz - iz)
        const v =
          l(ix, iy, iz) * (1 - fx) * (1 - fy) * (1 - fz) +
          l(ix + 1, iy, iz) * fx * (1 - fy) * (1 - fz) +
          l(ix, iy + 1, iz) * (1 - fx) * fy * (1 - fz) +
          l(ix + 1, iy + 1, iz) * fx * fy * (1 - fz) +
          l(ix, iy, iz + 1) * (1 - fx) * (1 - fy) * fz +
          l(ix + 1, iy, iz + 1) * fx * (1 - fy) * fz +
          l(ix, iy + 1, iz + 1) * (1 - fx) * fy * fz +
          l(ix + 1, iy + 1, iz + 1) * fx * fy * fz
        out[(tz * H + ty) * W + tx] = Math.round(v * 0xff)
      }
    }
  }
  self.postMessage({ data: out }, [out.buffer])
}
