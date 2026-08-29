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
import { FLOWER_COUNT, FLOWER_STRIDE } from "../shared/flower-field.js"
import { smoothstep } from "../shared/math-utils.js"
import { loadGLB, loadGLBMerged } from "../shared/glb-loader.js"
import S from "../shared/settings.js"

// Constants (mirrored from WebGL renderer)
// ########################################

export const AREA_SIZE = 40.0
export const BLADE_COUNT = S.lowSpecTBDR ? 400000 : 1000000
export const BLADE_HEIGHT = 0.3
export const BLADE_WIDTH = 0.015
export const BLADE_SEGMENTS = S.lowSpec ? 6 : 8
// Blade mesh LODs. Distant-field blades are widened 2× and stand a few pixels
// tall, and the shadow map resolves silhouettes even less — neither can show a
// full-segment Bézier curve, so coarser strips halve their vertex + curve work.
export const SPARSE_SEGMENTS = S.lowSpec ? 3 : 4
export const SHADOW_SEGMENTS = S.lowSpec ? 2 : 3
export const TILE_SIZE = 2.0
export const TILES_X = Math.ceil((2 * AREA_SIZE) / TILE_SIZE)
export const NUM_TILES = TILES_X * TILES_X
export const DENSE_X = 11
export const DENSE_TILES = DENSE_X * DENSE_X
export const BLADES_SPARSE = S.lowSpecTBDR ? 200 : 400
export const BLADES_DENSE = Math.round((BLADE_COUNT - NUM_TILES * BLADES_SPARSE) / DENSE_TILES)
export const SHADOWMAP_SIZE = S.lowSpec ? 1024 : 2048
export const GROUND_N = 256
export const BLOOM_LEVELS = S.lowSpec ? 1 : 4
// Sentinel for tile slots the grass worker has not populated yet.
export const TILE_UNSET = 0x7fffffff
export const NOISE_TEX_WIDTH = S.lowSpec ? 32 : 64
export const NOISE_TEX_HEIGHT = S.lowSpec ? 32 : 64
export const NOISE_TEX_DEPTH = S.lowSpec ? 32 : 64
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

// One instanced grass field: a ring of gridSize² tiles around the camera, each
// holding bladesPerTile contiguous instances. `seed` decorrelates the two fields'
// blade placement in the voronoi worker — it is a hash input, not an index.
// `distant` marks the field whose blades are sub-texel in the shadow map, so
// adaptive quality may thin it there.
function buildGrassLayer(gpu, { seed, gridSize, bladesPerTile, distant = false }) {
  const bladeCount = gridSize * gridSize * bladesPerTile
  const V = GPUBufferUsage.VERTEX
  const CD = GPUBufferUsage.COPY_DST
  return {
    seed,
    gridSize,
    bladesPerTile,
    bladeCount,
    distant,
    // Interleaved dynamic: [posX,posY,posZ, groundY,roll,lean] stride 24 — updated per tile scroll
    dynamic: gpu.createBuffer(bladeCount * 6 * 4, V | CD),
    // Interleaved static attribs: [height, baseWidth, rotation] stride 12 — set once at init
    attribs: gpu.createBuffer(buildBladeAttribs(bladeCount), V),
    // Per-blade noise: [tuftDist, tuftSeed, noiseX, noiseY, noiseZ] stride 20
    noise: gpu.createBuffer(bladeCount * 5 * 4, V | CD),
    dynamicCPU: new Float32Array(bladeCount * 6),
    noiseCPU: new Float32Array(bladeCount * 5),
    tileCoords: new Int32Array(gridSize * gridSize * 2).fill(TILE_UNSET),
  }
}

// One blade mesh at the given segment count: a vertical quad strip whose vertex
// t ∈ [0, 1] drives the Bézier curve in the vertex shader. All LODs share the
// same vertex layout, so every grass pipeline accepts any of them.
function buildBladeMesh(gpu, segments) {
  const vertCount = (segments + 1) * 2
  const vertices = new Float32Array(vertCount * 3)
  const texCoords = new Float32Array(vertCount * 2)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const b = i * 2
    vertices.set([0, t, 0, 1, t, 0], b * 3)
    texCoords.set([0, t, 1, t], b * 2)
  }
  const indices = new Uint16Array(segments * 6)
  for (let i = 0; i < segments; i++) {
    const b = i * 2
    indices.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 6)
  }
  return {
    vertices: gpu.createBuffer(vertices, GPUBufferUsage.VERTEX),
    texCoords: gpu.createBuffer(texCoords, GPUBufferUsage.VERTEX),
    indices: gpu.createBuffer(indices, GPUBufferUsage.INDEX),
    indexCount: indices.length,
  }
}

export function initGrassBuffers(gpu) {
  const sparse = buildGrassLayer(gpu, {
    seed: 0,
    gridSize: TILES_X,
    bladesPerTile: BLADES_SPARSE,
    distant: true,
  })
  const dense = buildGrassLayer(gpu, { seed: 1, gridSize: DENSE_X, bladesPerTile: BLADES_DENSE })

  return {
    meshFull: buildBladeMesh(gpu, BLADE_SEGMENTS),
    meshSparse: buildBladeMesh(gpu, SPARSE_SEGMENTS),
    meshShadow: buildBladeMesh(gpu, SHADOW_SEGMENTS),
    // Dense first: it covers the near field, so it primes depth for the sparse draw.
    layers: [dense, sparse],
  }
}

// Flower Buffers
// ##############
//
// Two crossed vertical cards form the impostor. Per vertex: position (vec3f),
// uv (vec2f), and the card's outward normal in the local XZ plane (vec2f) so the
// vertex shader can rotate it into world space. Stride 28 bytes.

export function initFlowerBuffers(gpu) {
  // prettier-ignore
  const verts = new Float32Array([
    // card A — faces +Z: x in [-.5,.5], y in [0,1], z = 0
    -0.5, 0.0, 0.0,  0.0, 0.0,  0.0, 1.0,
     0.5, 0.0, 0.0,  1.0, 0.0,  0.0, 1.0,
    -0.5, 1.0, 0.0,  0.0, 1.0,  0.0, 1.0,
     0.5, 1.0, 0.0,  1.0, 1.0,  0.0, 1.0,
    // card B — faces +X: z in [-.5,.5], y in [0,1], x = 0
     0.0, 0.0, -0.5, 0.0, 0.0,  1.0, 0.0,
     0.0, 0.0,  0.5, 1.0, 0.0,  1.0, 0.0,
     0.0, 1.0, -0.5, 0.0, 1.0,  1.0, 0.0,
     0.0, 1.0,  0.5, 1.0, 1.0,  1.0, 0.0,
  ])
  const indices = new Uint16Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7])
  const V = GPUBufferUsage.VERTEX
  // Interleaved instances: [posX,posY,posZ, rotation,scale,kind,seed] — updated on tile scroll
  const instances = gpu.createBuffer(FLOWER_COUNT * FLOWER_STRIDE * 4, V | GPUBufferUsage.COPY_DST)
  return {
    instances,
    streams: [gpu.createBuffer(verts, V), instances],
    indices: gpu.createBuffer(indices, GPUBufferUsage.INDEX),
    indexFormat: "uint16",
    indexCount: indices.length,
    instanceCount: FLOWER_COUNT,
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
    streams: [gpu.createBuffer(positions, GPUBufferUsage.VERTEX), gpu.createBuffer(texCoords, GPUBufferUsage.VERTEX)],
    indices: gpu.createBuffer(indices, GPUBufferUsage.INDEX),
    indexFormat: "uint32",
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

export function initRainBuffers(gpu, eff) {
  if (!eff.rainPositions) return null
  const V = GPUBufferUsage.VERTEX
  return {
    streams: [gpu.createBuffer(new Float32Array([0.0, 1.0]), V), gpu.createBuffer(eff.rainPositions, V)],
    count: eff.rainCount,
  }
}

// Sprite Buffers (particles, fireflies, flies, bees)
// #################################################
//
// All four are point sprites: an instance position stream that is rewritten
// every frame, plus static per-instance attributes.

function initSpriteBuffers(gpu, positions, attribs, count) {
  if (!positions) return null
  const V = GPUBufferUsage.VERTEX
  const positionBuffer = gpu.createBuffer(positions, V | GPUBufferUsage.COPY_DST)
  return {
    positions: positionBuffer,
    streams: [positionBuffer, ...attribs.map(a => gpu.createBuffer(a, V))],
    count,
  }
}

export function initParticleBuffers(gpu, eff) {
  const buffers = initSpriteBuffers(gpu, eff.particlePositions, [eff.particleSizes], eff.particleCount)
  if (!buffers) return null
  // Lives are simulated on the CPU, so they stream alongside the positions.
  buffers.lives = gpu.createBuffer(eff.particleLives, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)
  buffers.streams.push(buffers.lives, gpu.createBuffer(eff.particlePhases, GPUBufferUsage.VERTEX))
  return buffers
}

export function initFireflyBuffers(gpu, eff) {
  if (!eff.fireflyPositions) return null
  const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  const positions = gpu.createBuffer(eff.fireflyPositions, usage)
  const brightness = gpu.createBuffer(eff.fireflyBrightness, usage)
  return { positions, brightness, streams: [positions, brightness], count: eff.fireflyCount }
}

export function initFlyBuffers(gpu, eff) {
  return initSpriteBuffers(gpu, eff.flyPositions, [eff.flySizes, eff.flyPhases], eff.flyCount)
}

export function initBeeBuffers(gpu, eff) {
  return initSpriteBuffers(gpu, eff.beePositions, [eff.beeSizes, eff.beePhases], eff.beeCount)
}

// Text (GLB) Buffers
// ##################

export async function initTextBuffers(gpu) {
  const meshes = await loadGLB(S.model)
  if (meshes.length === 0) return null
  const mesh = meshes[0]
  const normals = mesh.normals ? mesh.normals.data : new Float32Array(mesh.positions.data.length)
  const V = GPUBufferUsage.VERTEX
  const positions = gpu.createBuffer(mesh.positions.data, V)
  return {
    // The shadow pass needs positions only; the G-buffer pass also needs normals.
    shadowStreams: [positions],
    streams: [positions, gpu.createBuffer(normals, V)],
    indices: gpu.createBuffer(mesh.indices.data, GPUBufferUsage.INDEX),
    indexCount: mesh.indices.count,
    indexFormat: mesh.indices.data instanceof Uint32Array ? "uint32" : "uint16",
  }
}

// Bike Buffers
// ##################

const BIKE_URL = "/assets/roadbike.glb"

function isSceneProp(nodeName) {
  return nodeName.startsWith("alights") || nodeName === "Plane" || nodeName === "Circle.007"
}

function bikeLightEmission(nodeName) {
  return nodeName === "front" || nodeName === "back" ? 1.0 : 0.0
}

export async function initBikeBuffers(gpu) {
  const bike = await loadGLBMerged(BIKE_URL, {
    skipNode: isSceneProp,
    mirrorHalvesAcrossX: false,
    emissiveNode: bikeLightEmission,
  })
  if (!bike) return null
  const V = GPUBufferUsage.VERTEX
  const positions = gpu.createBuffer(bike.positions, V)
  return {
    shadowStreams: [positions],
    streams: [
      positions,
      gpu.createBuffer(bike.normals, V),
      gpu.createBuffer(bike.colors, V),
      gpu.createBuffer(bike.material, V),
      gpu.createBuffer(bike.emissive, V),
    ],
    indices: gpu.createBuffer(bike.indices, GPUBufferUsage.INDEX),
    indexFormat: "uint32",
    indexCount: bike.indexCount,
    bbox: bike.bbox,
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
  const instanceBuffer = gpu.createBuffer(BIRD_COUNT * 12 * 4, V | GPUBufferUsage.COPY_DST)
  return {
    instanceBuffer,
    streams: [gpu.createBuffer(geo.positions, V), gpu.createBuffer(geo.flex, V), instanceBuffer],
    instanceData: new Float32Array(BIRD_COUNT * 12),
    vertexCount: geo.count,
    instanceCount: BIRD_COUNT,
  }
}

// Fullscreen Quad
// ###############

export function initFullscreenQuad(gpu) {
  const V = GPUBufferUsage.VERTEX
  return {
    streams: [
      gpu.createBuffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), V),
      // WebGPU textures: y=0 at top. NDC y=-1 (bottom) must sample UV y=1, not y=0.
      gpu.createBuffer(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), V),
    ],
    vertexCount: 4,
  }
}

// Render Targets
// ##############

// Bloom accumulates >1.0 in its additive up-chain, so it needs a float format.
// rg11b10ufloat (when renderable) halves bandwidth vs rgba16float across the
// whole extract/down/up chain; bloom never uses alpha or negative values.
export function bloomChainFormat(device) {
  if (S.lowSpec) return "rgba8unorm"
  return device.features.has("rg11b10ufloat-renderable") ? "rg11b10ufloat" : "rgba16float"
}

// The scene colour buffer holds *pre-tonemap HDR*: the sun disc and bright forward
// lights are written well above 1.0 so the AgX tonemap (which maps up to EV +4)
// can roll them off into hot highlights instead of clipping everything to a flat
// white. rgba16float keeps an alpha channel for the forward alpha/additive blends.
// Low-spec stays rgba8unorm — highlights clip there as before — to spare bandwidth
// on TBDR GPUs. Every pipeline drawing into sceneTexture must use this format.
export const SCENE_FORMAT = S.lowSpec ? "rgba8unorm" : "rgba16float"

// gDepth carries a copy of the NDC depth each G-buffer fragment already computed,
// so the lighting pass can reconstruct world position without sampling the depth
// texture — which is what lets it share a render pass with the sky and forward
// effects (see gbuffer.inc.wgsl). r32float matches depth24plus' precision where it
// matters; r16float would band visibly in SSAO and world-position reconstruction.
export const GDEPTH_FORMAT = "r32float"

export function createRenderTargets(gpu, width, height) {
  const divisor = S.lowSpec ? 4 : 2
  const hw = Math.max(1, Math.floor(width / divisor))
  const hh = Math.max(1, Math.floor(height / divisor))
  // Mobile renders SSAO at half-res; temporal accumulation + linear upsample in
  // postprocess hide the resolution drop. Skip the blur target entirely (the blur
  // pass is also skipped on mobile — see Renderer#renderSSAOPass).
  // Desktop stays at full-res: half-res SSAO + temporal history accumulates
  // into horizontal scanlines (tried 2026-07-07, reverted — and the whole pass
  // is only ~0.1 ms, so there is nothing worth saving here).
  const ssaoW = S.lowSpec ? Math.max(1, Math.floor(width / 2)) : width
  const ssaoH = S.lowSpec ? Math.max(1, Math.floor(height / 2)) : height
  // DoF is half-res everywhere — dof-coc.wgsl box-downsamples a fixed full-res 2×2
  // block per texel, so it cannot follow the bloom/god-ray divisor down to quarter.
  const dofW = Math.max(1, Math.floor(width / 2))
  const dofH = Math.max(1, Math.floor(height / 2))
  const bloomFormat = bloomChainFormat(gpu.device)
  const makeRT = (w, h, fmt) => {
    const texture = gpu.createRenderTarget(w, h, fmt)
    return { texture, view: texture.createView(), width: w, height: h }
  }

  const bloomMips = []
  let mw = hw,
    mh = hh
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    mw = Math.max(1, Math.floor(mw / 2))
    mh = Math.max(1, Math.floor(mh / 2))
    bloomMips.push(makeRT(mw, mh, bloomFormat))
  }
  return {
    gAlbedo: makeRT(width, height),
    gNormal: makeRT(width, height),
    gDepth: makeRT(width, height, GDEPTH_FORMAT),
    sceneTexture: makeRT(width, height, SCENE_FORMAT),
    bloomExtract: makeRT(hw, hh, bloomFormat),
    bloomMips,
    godRay: makeRT(hw, hh),
    // Half-res DoF: signed-CoC downsample → bokeh gather. rgba16float holds the
    // signed CoC (and unclamped colour) without banding.
    dofDown: makeRT(dofW, dofH, "rgba16float"),
    dofBlur: makeRT(dofW, dofH, "rgba16float"),
    ssao: makeRT(ssaoW, ssaoH),
    ssaoPrev: makeRT(ssaoW, ssaoH),
    ssaoBlur: S.lowSpec ? null : makeRT(width, height),
  }
}

export function destroyRenderTargets(targets) {
  for (const target of Object.values(targets)) {
    for (const rt of Array.isArray(target) ? target : [target]) rt?.texture.destroy()
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
  const size = S.lowSpec ? 1024 : 2048
  return gpu.createReadableRenderTarget(size, size)
}

// Ground Heightmap (512x512, GPU-baked, CPU-readable)
// ###################################################

export function createGroundHeightmap(gpu) {
  return gpu.createReadableRenderTarget(512, 512)
}

// Uniform Buffers
// ###############
//
// A GPU uniform buffer plus its host-side staging, pre-allocated so the render
// loop never allocates. The staging is exposed as both a Float32Array (`f`) and
// a DataView (`dv`) so f32 slots and explicit u32 slots share one struct and
// submit in a single writeBuffer call.

export class UniformBuffer {
  #queue
  buffer
  data
  f
  dv

  constructor(gpu, label, byteSize) {
    this.#queue = gpu.queue
    this.buffer = gpu.device.createBuffer({
      label,
      size: byteSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.data = new ArrayBuffer(byteSize)
    this.f = new Float32Array(this.data)
    this.dv = new DataView(this.data)
  }

  set(values) {
    this.f.set(values)
    return this
  }

  write(byteOffset = 0, byteLength = this.data.byteLength - byteOffset) {
    this.#queue.writeBuffer(this.buffer, byteOffset, this.data, byteOffset, byteLength)
  }
}
