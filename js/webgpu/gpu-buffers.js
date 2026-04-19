// GPU Buffers
// ###########
//
// Geometry, texture, and render target creation. Each init function takes a
// WebGPUDevice and returns the created GPU resources.
//
// - Grass: sparse + dense instanced blades with per-blade voronoi noise
// - Ground, fullscreen quad, 3D noise, wind noise, shadow map, cloud shadow
// - Rain, particles, fireflies, bird geometry, SSAO kernel
// - Render targets: G-buffer MRT, HDR scene, SSAO ping-pong, bloom mips, god ray

import { BIRD_COUNT } from "../shared/boids-system.js"
import { smoothstep } from "../shared/math-utils.js"
import { loadGLB } from "../shared/glb-loader.js"
import S from "../shared/settings.js"

// Constants (mirrored from WebGL renderer)
// ########################################

export const AREA_SIZE = 40.0
export const BLADE_COUNT = S.isMobile ? 400000 : 1000000
export const BLADE_HEIGHT = 0.3
export const BLADE_WIDTH = 0.015
export const BLADE_SEGMENTS = S.isMobile ? 6 : 8
export const TILE_SIZE = 2.0
export const TILES_X = Math.ceil((2 * AREA_SIZE) / TILE_SIZE)
export const NUM_TILES = TILES_X * TILES_X
export const DENSE_R = S.isMobile ? 5 : 5
export const DENSE_X = 2 * DENSE_R + 1
export const DENSE_TILES = DENSE_X * DENSE_X
export const BLADES_SPARSE = S.isMobile ? 200 : 400
export const BLADES_DENSE = Math.round((BLADE_COUNT - NUM_TILES * BLADES_SPARSE) / DENSE_TILES)
export const SHADOWMAP_SIZE = S.isMobile ? 1024 : 2048
export const GROUND_N = 256
export const PARTICLE_COUNT = 1000
export const FIREFLY_COUNT = 32
export const RAIN_DROP_COUNT = 15000
export const BLOOM_LEVELS = S.isMobile ? 2 : 4
export const NOISE_TEX_WIDTH = S.isMobile ? 32 : 64
export const NOISE_TEX_HEIGHT = S.isMobile ? 32 : 64
export const NOISE_TEX_DEPTH = S.isMobile ? 32 : 64
export const NOISE_TEX_PERIOD_X = NOISE_TEX_WIDTH * 0.5
export const NOISE_TEX_PERIOD_Y = NOISE_TEX_HEIGHT * 0.5
export const NOISE_TEX_PERIOD_Z = NOISE_TEX_DEPTH * 0.5

export { BIRD_COUNT }

// Grass Buffers
// #############

// [height, baseWidth, rotation] stride 12 — static per-blade attribs
function buildBladeAttribs(count) {
  const attribs = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    attribs[i * 3] =
      Math.random() > 0.95
        ? BLADE_HEIGHT * 0.75 + (Math.random() + Math.random()) * 0.5 * BLADE_HEIGHT * 1.5
        : BLADE_HEIGHT * 0.75 + (Math.random() - 0.5) * BLADE_HEIGHT * 0.25 + Math.random() * BLADE_HEIGHT * 0.5
    attribs[i * 3 + 1] = BLADE_WIDTH * 0.75 + (Math.random() - 0.5) * BLADE_WIDTH * 0.25
    attribs[i * 3 + 2] = Math.random() * Math.PI * 2
  }
  return attribs
}

export function initGrassBuffers(gpu) {
  const vertCount = (BLADE_SEGMENTS + 1) * 2
  const bladeVertices = new Float32Array(vertCount * 3)
  const bladeTexCoords = new Float32Array(vertCount * 2)
  for (let i = 0; i <= BLADE_SEGMENTS; i++) {
    const t = i / BLADE_SEGMENTS
    const b = i * 2
    bladeVertices.set([0, t, 0, 1, t, 0], b * 3)
    bladeTexCoords.set([0, t, 1, t], b * 2)
  }
  const bladeIndices = new Uint16Array(BLADE_SEGMENTS * 6)
  for (let i = 0; i < BLADE_SEGMENTS; i++) {
    const b = i * 2
    bladeIndices.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6)
  }

  const grassCount = NUM_TILES * BLADES_SPARSE
  const denseGrassCount = DENSE_TILES * BLADES_DENSE

  const V = GPUBufferUsage.VERTEX
  const CD = GPUBufferUsage.COPY_DST
  const IX = GPUBufferUsage.INDEX

  return {
    bladeVertices: gpu.createBuffer(bladeVertices, V),
    bladeTexCoords: gpu.createBuffer(bladeTexCoords, V),
    bladeIndices: gpu.createBuffer(bladeIndices, IX),
    bladeIndexCount: bladeIndices.length,
    grassCount,
    denseGrassCount,
    // Interleaved dynamic: [posX,posY,posZ, groundY,roll,lean] stride 24 — updated per tile scroll
    sparseDynamic: gpu.createBuffer(grassCount * 6 * 4, V | CD),
    // Interleaved static attribs: [height, baseWidth, rotation] stride 12 — set once at init
    sparseAttribs: gpu.createBuffer(buildBladeAttribs(grassCount), V),
    denseDynamic: gpu.createBuffer(denseGrassCount * 6 * 4, V | CD),
    denseAttribs: gpu.createBuffer(buildBladeAttribs(denseGrassCount), V),
    // CPU mirrors for tile updates — 6 floats per blade (interleaved pos+static)
    sparseDynamicCPU: new Float32Array(grassCount * 6),
    denseDynamicCPU: new Float32Array(denseGrassCount * 6),
    // Per-blade noise: [tuftDist, tuftSeed, noiseX, noiseY, noiseZ] — 5 floats, stride 20
    sparseNoise: gpu.createBuffer(grassCount * 5 * 4, V | CD),
    denseNoise: gpu.createBuffer(denseGrassCount * 5 * 4, V | CD),
    sparseNoiseCPU: new Float32Array(grassCount * 5),
    denseNoiseCPU: new Float32Array(denseGrassCount * 5),
    tileCoords: new Int32Array(NUM_TILES * 2).fill(0x7fffffff),
    denseTileCoords: new Int32Array(DENSE_TILES * 2).fill(0x7fffffff),
  }
}

// Ground Buffers
// ##############

export function initGroundBuffers(gpu) {
  const N = GROUND_N
  const SIZE = AREA_SIZE * 2.0
  const positions = new Float32Array((N + 1) * (N + 1) * 3)
  const texCoords = new Float32Array((N + 1) * (N + 1) * 2)
  const indices = new Uint32Array(N * N * 6)
  let pi = 0
  let ti = 0
  for (let z = 0; z <= N; z++) {
    for (let x = 0; x <= N; x++) {
      positions[pi++] = (x / N - 0.5) * SIZE * 2
      positions[pi++] = 0.0
      positions[pi++] = (z / N - 0.5) * SIZE * 2
      texCoords[ti++] = x / N
      texCoords[ti++] = z / N
    }
  }
  let ii = 0
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const tl = z * (N + 1) + x
      const tr = tl + 1
      const bl = tl + (N + 1)
      const br = bl + 1
      indices[ii++] = tl
      indices[ii++] = bl
      indices[ii++] = tr
      indices[ii++] = tr
      indices[ii++] = bl
      indices[ii++] = br
    }
  }
  return {
    vertices: gpu.createBuffer(positions, GPUBufferUsage.VERTEX),
    texCoords: gpu.createBuffer(texCoords, GPUBufferUsage.VERTEX),
    indices: gpu.createBuffer(indices, GPUBufferUsage.INDEX),
    indexCount: indices.length,
  }
}

// 3D Noise Texture (128x128x128 R8, ~2 MiB)
// ##############################

export function initNoiseTextureAsync(gpu) {
  const W = NOISE_TEX_WIDTH,
    H = NOISE_TEX_HEIGHT,
    D = NOISE_TEX_DEPTH
  const PX = NOISE_TEX_PERIOD_X,
    PY = NOISE_TEX_PERIOD_Y,
    PZ = NOISE_TEX_PERIOD_Z
  return new Promise(resolve => {
    const worker = new Worker(new URL("../worker/cloud-noise.js", import.meta.url), { type: "module" })
    worker.onmessage = ({ data: { data } }) => {
      worker.terminate()
      const texture = gpu.createTexture3D(
        W,
        H,
        D,
        "r8unorm",
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        data
      )
      resolve({ texture, data })
    }
    worker.postMessage({ W, H, D, PX, PY, PZ })
  })
}

// Wind Noise Texture (256x256 R8)
// ###############################

export function initWindNoiseTexture(gpu) {
  const SIZE = 256
  const PERIOD = 32
  const data = new Uint8Array(SIZE * SIZE)
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return n - Math.floor(n)
  }
  for (let ty = 0; ty < SIZE; ty++) {
    for (let tx = 0; tx < SIZE; tx++) {
      const px = ((tx + 0.5) / SIZE) * PERIOD
      const py = ((ty + 0.5) / SIZE) * PERIOD
      const ix = Math.floor(px)
      const iy = Math.floor(py)
      const fx = smoothstep(px - ix)
      const fy = smoothstep(py - iy)
      const a = hash(ix % PERIOD, iy % PERIOD)
      const b = hash((ix + 1) % PERIOD, iy % PERIOD)
      const c = hash(ix % PERIOD, (iy + 1) % PERIOD)
      const d = hash((ix + 1) % PERIOD, (iy + 1) % PERIOD)
      const v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
      data[ty * SIZE + tx] = Math.round(v * 255)
    }
  }
  return gpu.createTexture2D(SIZE, SIZE, "r8unorm", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, data)
}

// Rain Buffers
// ############

export function initRainBuffers(gpu, effectsSystem) {
  if (!effectsSystem.rainPositions) return null
  return {
    lineOffsets: gpu.createBuffer(new Float32Array([0.0, 1.0]), GPUBufferUsage.VERTEX),
    positions: gpu.createBuffer(effectsSystem.rainPositions, GPUBufferUsage.VERTEX),
    count: effectsSystem.rainCount,
  }
}

// Particle Buffers
// ################

export function initParticleBuffers(gpu, effectsSystem) {
  if (!effectsSystem.particlePositions) return null
  const V = GPUBufferUsage.VERTEX
  const CD = GPUBufferUsage.COPY_DST
  return {
    positions: gpu.createBuffer(effectsSystem.particlePositions, V | CD),
    sizes: gpu.createBuffer(effectsSystem.particleSizes, V),
    lives: gpu.createBuffer(effectsSystem.particleLives, V | CD),
    phases: gpu.createBuffer(effectsSystem.particlePhases, V),
    count: effectsSystem.particleCount,
  }
}

// Firefly Buffers
// ###############

export function initFireflyBuffers(gpu, effectsSystem) {
  if (!effectsSystem.fireflyPositions) return null
  const V = GPUBufferUsage.VERTEX
  const CD = GPUBufferUsage.COPY_DST
  return {
    positions: gpu.createBuffer(effectsSystem.fireflyPositions, V | CD),
    brightness: gpu.createBuffer(effectsSystem.fireflyBrightness, V | CD),
    count: effectsSystem.fireflyCount,
  }
}

// Text (GLB) Buffers
// ##################

export async function initTextBuffers(gpu) {
  const meshes = await loadGLB(S.model)
  if (meshes.length === 0) return null
  const mesh = meshes[0]
  const normals = mesh.normals ? mesh.normals.data : new Float32Array(mesh.positions.data.length)
  return {
    positions: gpu.createBuffer(mesh.positions.data, GPUBufferUsage.VERTEX),
    normals: gpu.createBuffer(normals, GPUBufferUsage.VERTEX),
    indices: gpu.createBuffer(mesh.indices.data, GPUBufferUsage.INDEX),
    indexCount: mesh.indices.count,
    indexFormat: mesh.indices.data instanceof Uint32Array ? "uint32" : "uint16",
  }
}

// Bird Buffers
// ############

function buildBirdGeometry() {
  const nose = [0, 0, 0.18]
  const body = [0, 0, -0.1]
  const lRF = [-0.12, 0, 0.12]
  const lRR = [-0.12, 0, -0.08]
  const lMF = [-0.55, 0, 0.05]
  const lMR = [-0.55, 0, -0.2]
  const lTip = [-0.95, 0, -0.08]
  const rRF = [0.12, 0, 0.12]
  const rRR = [0.12, 0, -0.08]
  const rMF = [0.55, 0, 0.05]
  const rMR = [0.55, 0, -0.2]
  const rTip = [0.95, 0, -0.08]
  const tLC = [-0.04, 0, -0.26]
  const tLT = [-0.1, 0, -0.42]
  const tRC = [0.04, 0, -0.26]
  const tRT = [0.1, 0, -0.42]
  const F0 = 0.0,
    F1 = 0.15,
    F2 = 0.55,
    F3 = 1.0,
    FT = 0.05
  const vf = [
    nose,
    F0,
    lRF,
    F1,
    body,
    F0,
    body,
    F0,
    lRF,
    F1,
    lRR,
    F1,
    lRF,
    F1,
    lMF,
    F2,
    lRR,
    F1,
    lRR,
    F1,
    lMF,
    F2,
    lMR,
    F2,
    lMF,
    F2,
    lTip,
    F3,
    lMR,
    F2,
    nose,
    F0,
    body,
    F0,
    rRF,
    F1,
    body,
    F0,
    rRR,
    F1,
    rRF,
    F1,
    rRF,
    F1,
    rRR,
    F1,
    rMF,
    F2,
    rRR,
    F1,
    rMR,
    F2,
    rMF,
    F2,
    rMF,
    F2,
    rMR,
    F2,
    rTip,
    F3,
    body,
    F0,
    tLC,
    FT,
    tLT,
    FT,
    body,
    F0,
    tRT,
    FT,
    tRC,
    FT,
  ]
  const count = 36
  const positions = new Float32Array(count * 3)
  const flex = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const vtx = vf[i * 2]
    positions[i * 3] = vtx[0]
    positions[i * 3 + 1] = vtx[1]
    positions[i * 3 + 2] = vtx[2]
    flex[i] = vf[i * 2 + 1]
  }
  return { positions, flex, count }
}

export function initBirdBuffers(gpu) {
  const geo = buildBirdGeometry()
  const V = GPUBufferUsage.VERTEX
  const CD = GPUBufferUsage.COPY_DST
  return {
    positions: gpu.createBuffer(geo.positions, V),
    flex: gpu.createBuffer(geo.flex, V),
    instanceBuffer: gpu.createBuffer(BIRD_COUNT * 12 * 4, V | CD),
    instanceData: new Float32Array(BIRD_COUNT * 12),
    vertexCount: geo.count,
    instanceCount: BIRD_COUNT,
  }
}

// Fullscreen Quad
// ###############

export function initFullscreenQuad(gpu) {
  return {
    vertices: gpu.createBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), GPUBufferUsage.VERTEX),
    // WebGPU textures: y=0 at top. NDC y=-1 (bottom) must sample UV y=1, not y=0.
    uvs: gpu.createBuffer(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), GPUBufferUsage.VERTEX),
    vertexCount: 4,
  }
}

// SSAO Kernel
// ###########

export function generateSSAOKernel(sampleCount) {
  const kernel = new Float32Array(sampleCount * 4)
  for (let i = 0; i < sampleCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.random()
    const t = i / sampleCount
    const scale = 0.1 + t * t * 0.9
    kernel[i * 4] = Math.cos(angle) * radius * scale
    kernel[i * 4 + 1] = Math.sin(angle) * radius * scale
    kernel[i * 4 + 2] = (0.1 + Math.random() * 0.9) * scale
    kernel[i * 4 + 3] = 0
  }
  return kernel
}

// Render Targets
// ##############

export function createRenderTargets(gpu, width, height) {
  const divisor = S.isMobile ? 4 : 2
  const hw = Math.max(1, Math.floor(width / divisor))
  const hh = Math.max(1, Math.floor(height / divisor))
  // Keep mobile bloom in 8-bit to reduce bandwidth across the extract/down/up chain.
  const bloomFormat = S.isMobile ? "rgba8unorm" : "rgba16float"
  const makeRT = (w, h, fmt) => ({ texture: gpu.createRenderTarget(w, h, fmt), width: w, height: h })

  const bloomMips = []
  let mw = hw,
    mh = hh
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    mw = Math.max(1, Math.floor(mw / 2))
    mh = Math.max(1, Math.floor(mh / 2))
    bloomMips.push(makeRT(mw, mh, bloomFormat))
  }
  return {
    gAlbedo: gpu.createRenderTarget(width, height),
    gNormal: gpu.createRenderTarget(width, height),
    gMaterial: gpu.createRenderTarget(width, height),
    sceneTexture: gpu.createRenderTarget(width, height),
    bloomExtract: makeRT(hw, hh, bloomFormat),
    bloomMips,
    godRay: makeRT(hw, hh),
    ssao: makeRT(width, height),
    ssaoPrev: makeRT(width, height),
    ssaoBlur: makeRT(width, height),
    bloomHalfW: hw,
    bloomHalfH: hh,
  }
}

// Shadow Map
// ##########

export function createShadowMap(gpu) {
  return gpu.createDepthTexture(SHADOWMAP_SIZE, SHADOWMAP_SIZE, "depth32float")
}

// Cloud Shadow Texture
// ####################

export function createCloudShadowTexture(gpu) {
  return gpu.createRenderTarget(256, 256, "r8unorm")
}

// Mountain Heightmap (1024x1024, GPU-baked, CPU-readable)
// #######################################################

export function createMountainHeightmap(gpu) {
  const size = S.isMobile ? 1024 : 2048
  return gpu.createReadableRenderTarget(size, size)
}

// Ground Heightmap (512x512, GPU-baked, CPU-readable)
// ###################################################

export function createGroundHeightmap(gpu) {
  return gpu.createReadableRenderTarget(512, 512)
}

// Per-frame Uniform Buffer (640 bytes)
// ####################################

export function createFrameUniformBuffer(gpu) {
  return gpu.createBuffer(640, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
}
