// GPU Updates
// ###########
//
// Per-frame buffer writes and GPU→CPU readback. Grass tile streaming via
// GrassTileWorker (async, main thread never blocked), bird instance transforms
// (updateBirdInstances), and the main frame uniform write (writeFrameUniforms).

import { smoothstep } from "../shared/math-utils.js"
import { BIRD_COUNT } from "../shared/boids-system.js"
import { TILE_SIZE, TILES_X, BLADES_SPARSE, DENSE_X, BLADES_DENSE } from "./gpu-buffers.js"

// Grass Tile Worker
// #################
//
// Dispatches per-tile blade computation to a web worker so the main thread is
// never blocked by voronoi/noise math. tileCoords are marked immediately on
// dispatch so the same tile isn't re-queued; the computed slices arrive async
// and are flushed to the GPU each frame via flush().

export class GrassTileWorker {
  #workers = []
  #pending = []
  #index = 0

  constructor() {
    this.#workers = Array.from({ length: 4 }, () => {
      const w = new Worker(new URL("../worker/voronoi.js", import.meta.url), { type: "module" })
      w.onmessage = ({ data }) => this.#pending.push(data)
      return w
    })
  }

  setHeightmap(data, size, wuSize) {
    for (const w of this.#workers) {
      const copy = data.slice()
      w.postMessage({ type: "heightmap", data: copy, size, wuSize }, [copy.buffer])
    }
  }

  #dispatchLayer(coords, camX, camZ, gridSize, bladeCount, layer) {
    const half = (gridSize / 2) | 0
    const anchorTX = (Math.floor(camX / TILE_SIZE) - half) | 0
    const anchorTZ = (Math.floor(camZ / TILE_SIZE) - half) | 0
    for (let dz = 0; dz < gridSize; dz++) {
      for (let dx = 0; dx < gridSize; dx++) {
        const tx = (anchorTX + dx) | 0
        const tz = (anchorTZ + dz) | 0
        const slotX = ((tx % gridSize) + gridSize) % gridSize
        const slotZ = ((tz % gridSize) + gridSize) % gridSize
        const slot = slotZ * gridSize + slotX
        if (coords[slot * 2] === tx && coords[slot * 2 + 1] === tz) continue
        coords[slot * 2] = tx
        coords[slot * 2 + 1] = tz
        this.#workers[this.#index++].postMessage({
          type: "compute",
          tx,
          tz,
          bladeStart: slot * bladeCount,
          bladeCount,
          layer,
        })
        if (this.#index === this.#workers.length) this.#index = 0
      }
    }
  }

  dispatch(grass, cameraPosition) {
    const [camX, , camZ] = cameraPosition
    this.#dispatchLayer(grass.tileCoords, camX, camZ, TILES_X, BLADES_SPARSE, 0)
    this.#dispatchLayer(grass.denseTileCoords, camX, camZ, DENSE_X, BLADES_DENSE, 1)
  }

  invalidate(grass, cameraPosition) {
    grass.tileCoords.fill(0x7fffffff)
    grass.denseTileCoords.fill(0x7fffffff)
    this.dispatch(grass, cameraPosition)
  }

  flush(queue, grass) {
    if (!this.#pending.length) return
    const ext = [
      { min: Infinity, max: -Infinity, nMin: Infinity, nMax: -Infinity },
      { min: Infinity, max: -Infinity, nMin: Infinity, nMax: -Infinity },
    ]
    const cpuDyn = [grass.sparseDynamicCPU, grass.denseDynamicCPU]
    const cpuNoise = [grass.sparseNoiseCPU, grass.denseNoiseCPU]
    for (const { bladeStart, layer, dynArr, noiseArr } of this.#pending) {
      const e = ext[layer]
      cpuDyn[layer].set(dynArr, bladeStart * 6)
      cpuNoise[layer].set(noiseArr, bladeStart * 5)
      const b = bladeStart * 24,
        nb = bladeStart * 20
      if (b < e.min) e.min = b
      if (b + dynArr.byteLength > e.max) e.max = b + dynArr.byteLength
      if (nb < e.nMin) e.nMin = nb
      if (nb + noiseArr.byteLength > e.nMax) e.nMax = nb + noiseArr.byteLength
    }
    this.#pending.length = 0
    const gpuDyn = [grass.sparseDynamic, grass.denseDynamic]
    const gpuNoise = [grass.sparseNoise, grass.denseNoise]
    for (let l = 0; l < 2; l++) {
      const e = ext[l]
      if (e.min < e.max) {
        queue.writeBuffer(gpuDyn[l], e.min, cpuDyn[l].buffer, e.min, e.max - e.min)
        queue.writeBuffer(gpuNoise[l], e.nMin, cpuNoise[l].buffer, e.nMin, e.nMax - e.nMin)
      }
    }
  }
}

// Bird Instance Updates
// #####################

export function updateBirdInstances(queue, birds, boids) {
  const { positions, velocities, wingPhases, beatSpeeds } = boids
  const data = birds.instanceData
  for (let i = 0; i < BIRD_COUNT; i++) {
    const i3 = i * 3,
      i12 = i * 12
    data[i12] = positions[i3]
    data[i12 + 1] = positions[i3 + 1]
    data[i12 + 2] = positions[i3 + 2]
    data[i12 + 3] = wingPhases[i]
    const vx = velocities[i3],
      vy = velocities[i3 + 1],
      vz = velocities[i3 + 2]
    const vlen = Math.sqrt(vx * vx + vy * vy + vz * vz)
    const ok = vlen > 0.001,
      inv = ok ? 1 / vlen : 0
    const fx = vx * inv,
      fy = vy * inv,
      fz = ok ? vz * inv : 1
    data[i12 + 4] = fx
    data[i12 + 5] = fy
    data[i12 + 6] = fz
    data[i12 + 7] = beatSpeeds[i] * smoothstep((fy + 1) / 2)
    // Right vector: cross(forward, up=[0,1,0]) = [-fz, 0, fx], normalized in XZ plane
    const rlen = Math.sqrt(fz * fz + fx * fx)
    const rx = rlen < 0.001 ? 1 : -fz / rlen
    const rz = rlen < 0.001 ? 0 : fx / rlen
    data[i12 + 8] = -rz * fy
    data[i12 + 9] = rz * fx - rx * fz
    data[i12 + 10] = rx * fy
    data[i12 + 11] = 0
  }
  queue.writeBuffer(birds.instanceBuffer, 0, data)
}

// Per-frame Uniform Buffer Update
// ###############################

export function writeFrameUniforms(queue, buffer, ctx, windSystem, prevViewProjectionMatrix, data) {
  if (!data) data = new Float32Array(640 / 4)
  data.set(ctx.projectionMatrix, 0)
  data.set(ctx.viewMatrix, 16)
  data.set(ctx.invProjectionMatrix, 32)
  data.set(ctx.invViewMatrix, 48)
  data.set(ctx.viewProjectionMatrix, 64)
  data.set(ctx.invViewProjectionMatrix, 80)
  if (prevViewProjectionMatrix) {
    data.set(prevViewProjectionMatrix, 96)
  } else {
    data.set(ctx.viewProjectionMatrix, 96)
  }
  if (ctx.lightSpaceMatrix) {
    data.set(ctx.lightSpaceMatrix, 112)
  }
  // Byte offsets (WGSL alignment: vec3f align=16, vec2f align=8, f32 align=4):
  //   512: cameraPosition (vec3f)  → float[128..130]
  //   524: time (f32)              → float[131]
  //   528: sunDirection (vec3f)    → float[132..134]
  //   540: windTime (f32)          → float[135]
  //   544: moonDirection (vec3f)   → float[136..138]
  //   556: windStrength (f32)      → float[139]
  //   560: windDirection (vec2f)   → float[140..141]
  //   568: resolution (vec2f)      → float[142..143]
  //   576: sunAboveHorizon (f32)   → float[144]
  //   580: near (f32)              → float[145]
  //   584: far (f32)               → float[146]
  //   588: deltaTime (f32)         → float[147]
  //   592: cursorWorldPos (vec3f)  → float[148..150]
  //   604: cursorRadius (f32)      → float[151]
  const cam = ctx.cameraPosition
  data[128] = cam[0]
  data[129] = cam[1]
  data[130] = cam[2]
  data[131] = ctx.nowSec
  const sun = ctx.sunDirection
  data[132] = sun[0]
  data[133] = sun[1]
  data[134] = sun[2]
  data[135] = windSystem.windTime
  const moon = ctx.timeInfo?.moonPosition ?? { x: 0, y: 0, z: 0 }
  data[136] = moon.x
  data[137] = moon.y
  data[138] = moon.z
  data[139] = windSystem.windStrength
  const wd = windSystem.windDirection
  data[140] = wd[0]
  data[141] = wd[1]
  data[142] = ctx.width
  data[143] = ctx.height
  data[144] = Math.max(0, ctx.timeInfo?.sunPosition?.y ?? 0)
  data[145] = 0.01
  data[146] = 1000.0
  data[147] = ctx.deltaTime
  const cursor = ctx.cursorWorldPos
  data[148] = cursor[0]
  data[149] = cursor[1]
  data[150] = cursor[2]
  data[151] = ctx.cursorActive
  queue.writeBuffer(buffer, 0, data)
}

// Heightmap GPU→CPU Readback
// ##########################

export async function readbackTexture(device, texture, width, height) {
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  const bufferSize = bytesPerRow * height
  const readBuffer = device.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture }, { buffer: readBuffer, bytesPerRow, rowsPerImage: height }, { width, height })
  device.queue.submit([encoder.finish()])
  await readBuffer.mapAsync(GPUMapMode.READ)
  const mapped = new Uint8Array(readBuffer.getMappedRange())
  const result = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const srcOffset = row * bytesPerRow
    const dstOffset = row * width * 4
    result.set(mapped.subarray(srcOffset, srcOffset + width * 4), dstOffset)
  }
  readBuffer.unmap()
  readBuffer.destroy()
  return result
}

export class GPUHeightmap {
  #size
  #wuSize
  #data = null
  texture = null

  constructor(size, wuSize) {
    this.#size = size
    this.#wuSize = wuSize
  }

  get ready() {
    return this.#data != null
  }

  get data() {
    return this.#data
  }

  async readback(device, texture) {
    this.texture = texture
    this.#data = await readbackTexture(device, texture, this.#size, this.#size)
  }

  sample(x, z, scale = 1.0) {
    return (this.#data[(z * this.#size + x) << 2] / 0xff) * scale
  }

  sampleBilinear(x, z, scale = 1.0) {
    const size = this.#size
    const u = x / this.#wuSize + 0.5
    const v = z / this.#wuSize + 0.5
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0.0
    const px = Math.max(0, Math.min(size - 1.001, u * size - 0.5))
    const pz = Math.max(0, Math.min(size - 1.001, v * size - 0.5))
    const ix0 = Math.floor(px)
    const iz0 = Math.floor(pz)
    const ix1 = Math.min(size - 1, ix0 + 1)
    const iz1 = Math.min(size - 1, iz0 + 1)
    const fx = px - ix0
    const fz = pz - iz0
    const data = this.#data
    const h00 = data[(iz0 * size + ix0) << 2] / 0xff
    const h10 = data[(iz0 * size + ix1) << 2] / 0xff
    const h01 = data[(iz1 * size + ix0) << 2] / 0xff
    const h11 = data[(iz1 * size + ix1) << 2] / 0xff
    return (h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz) * scale
  }
}
