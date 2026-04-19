// WebGPU Renderer
// ###############
//
// Main render loop: device init, per-frame updates, and all GPU passes.
// Pass order: cloud shadow bake → shadow → G-buffer → scene (deferred + sky +
// rain + particles + fireflies) → SSAO + blur → bloom → god rays → post-process.

import { WebGPUDevice } from "./webgpu-device.js"
import { GPUContext } from "./gpu-context.js"
import { withErrorScopes, reportError, hasError } from "./webgpu-errors.js"
import { TimeSystem } from "../shared/time-system.js"
import { WindSystem } from "../shared/wind-system.js"
import { Camera } from "../shared/camera.js"
import { BoidsSystem } from "../shared/boids-system.js"
import { EffectsSystem } from "../shared/effects.js"
import { AdaptiveQuality } from "../shared/adaptive-quality.js"
import { CameraAnimator, PATH } from "../shared/camera-animator.js"
import { computeAtmosphereSkyColor, preethamPrecomputeArray as preethamPrecompute } from "../shared/atmo.js"
export { PATH }
import {
  perspectiveMatrixWebGPU,
  invertMatrix4,
  normalize,
  smoothstep,
  lookAtMatrix,
  orthographicMatrixWebGPU,
  multiplyMM,
  multiplyMV,
} from "../shared/math-utils.js"
import S from "../shared/settings.js"
import moonPhase from "../shared/moon.js"
import {
  AREA_SIZE,
  BLOOM_LEVELS,
  SHADOWMAP_SIZE,
  TILE_SIZE,
  initFullscreenQuad,
  initNoiseTextureAsync,
  initWindNoiseTexture,
  initGrassBuffers,
  initGroundBuffers,
  initBirdBuffers,
  initTextBuffers,
  initRainBuffers,
  initParticleBuffers,
  initFireflyBuffers,
  createMountainHeightmap,
  createGroundHeightmap,
  createCloudShadowTexture,
  createShadowMap,
  createFrameUniformBuffer,
  createRenderTargets,
} from "./gpu-buffers.js"
import { GPUHeightmap, GrassTileWorker, writeFrameUniforms, updateBirdInstances } from "./gpu-updates.js"
import {
  createAllPipelines,
  createPassBindGroups,
  createEmptyBindGroup,
  createFrameBindGroup,
  createObjectBindGroup,
} from "./gpu-pipelines.js"
import {
  bakeMountainHeightmap,
  bakeGroundHeightmap,
  createCloudShadowUniformBuffer,
  writeCloudShadowUniforms,
  recordCloudShadowBake,
  computeSunVisibility,
  computeCloudLightOcclusion,
} from "./gpu-bake.js"
import { isDark } from "../components/theme-toggle.js"

// Constants
// #########

const FOV_FULL_DEG = S.isMobile ? 111 : 90
const FOV_COMPACT_DEG = 55
const DEG_TO_RAD = Math.PI / 180
const NEAR = 0.01
const FAR = 1000
const MS_TO_SEC = 0.001
const SHADOW_DISTANCE_WU = 40
const SUN_PROJECTION_WU = 1000
const CLOUD_SHADOW_INTERVAL = S.isMobile ? 11 : 7
const LIGHTING_INTERVAL = S.isMobile ? 13 : 4
const FIREFLY_SLOTS = 32

const UNIFORM_USAGE = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
const CLEAR_TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 })
const CLEAR_BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 })
const CLEAR_WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 })

const COMPACT_OVERRIDES = Object.freeze({
  rain: 0,
  cloudSteps: 0,
  cloudCoverage: 1,
  godRaySteps: 16,
  chromaticAberration: 0.002,
  grassWidthFactor: 0.8,
  overcast: 0,
  turbidity: 2.5 + 0.5 * (Math.random() - 0.5),
})

// NDC frustum corners (x, y, z) where z∈{0,1} selects near/far — expanded per-frame
// into view-space at the shadow near/far distances to fit the orthographic bounds.
const FRUSTUM_CORNERS_NDC = Object.freeze([
  [-1, -1, 0],
  [1, -1, 0],
  [-1, 1, 0],
  [1, 1, 0],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
])

// Module helpers
// ##############

// Host-side uniform stage: one ArrayBuffer exposed as both Float32Array (`f`)
// and DataView (`dv`) so f32 slots and explicit u32/int slots can coexist in
// one struct, submitted in a single writeBuffer call.
const stage = size => {
  const buf = new ArrayBuffer(size)
  return { buf, f: new Float32Array(buf), dv: new DataView(buf) }
}

const parseDebugMode = () => {
  if (typeof window === "undefined") return 0
  return parseInt(new URLSearchParams(window.location.search).get("dbg") ?? "0", 10) || 0
}

// Firefly visibility in [0,1] scaled by fireflyIntensity.
// Fades in at 18:00→18:30, full overnight, fades out at 6:00→6:30.
const computeFireflyFactor = timeInfo => {
  const t = timeInfo.timeOfDay
  let f = 0
  if (t >= 18.5 || t < 6.0) f = 1
  else if (t >= 18.0) f = smoothstep((t - 18.0) * 2.0)
  else if (t < 6.5) f = smoothstep(1 - (t - 6.0) * 2.0)
  return f * timeInfo.fireflyIntensity
}

const isNight = timeInfo => {
  const t = timeInfo.timeOfDay ?? 12
  return t >= 18.5 || t < 6
}

const isActive = (v, threshold = 0.01) => (v ?? 0) >= threshold

const compactHourForDark = dark => (dark ? 4.0 : 15.5)

const clearRT = (encoder, view, clearValue) => {
  encoder.beginRenderPass({ colorAttachments: [{ view, clearValue, loadOp: "clear", storeOp: "store" }] }).end()
}

export class Renderer {
  // Core state
  // ##########
  #mode
  #ctx = new GPUContext()
  #gpu = new WebGPUDevice()
  #visible = true
  #mouseNDC = [0, 0]
  #renderCB = () => this.#render()
  #gpuFramePending = false
  #capturePending = false
  #debugMode = parseDebugMode()

  // Pipelines & bind-group layouts
  // ##############################
  #pipelines = null
  #passLayouts = null
  #fullscreenQuad = null
  #emptyBindGroup = null

  // Geometry buffers
  // ################
  #grassBuffers = null
  #groundBuffers = null
  #birdBuffers = null
  #textBuffers = null
  #rainBuffers = null
  #particleBuffers = null
  #fireflyBuffers = null

  // Textures & render targets
  // #########################
  #mountainHeightmap = new GPUHeightmap(S.isMobile ? 1024 : 2048, 20000)
  #groundHeightmap = new GPUHeightmap(512, 80)
  #mountainHeightmapTexture = null
  #groundHeightmapTexture = null
  #noiseTexture = null
  #noiseData = null
  #windNoiseTexture = null
  #shadowMapTexture = null
  #shadowMapView = null
  #cloudShadowTexture = null
  #cloudShadowTextureView = null
  #renderTargets = null
  #rtViews = null
  #bloomUpTargets = null

  // GPU uniform buffers
  // ###################
  #frameUniformBuffer = null
  #shadowUniformBuffer = null
  #textObjectUniformBuffer = null
  #grassUniformBuffer = null
  #birdUniformBuffer = null
  #deferredLightingBuffer = null
  #fireflyUniformBuffer = null
  #ssaoUniformBuffer = null
  #bloomExtractUniformBuffer = null
  #bloomDownUniformBuffers = null
  #bloomUpUniformBuffers = null
  #skyUniformBuffer = null
  #rainUniformBuffer = null
  #godRayUniformBuffer = null
  #fogUniformBuffer = null
  #particleUniformBuffer = null
  #fireflySpriteUniformBuffer = null
  #postprocessUniformBuffer = null
  #cloudShadowUniformBuffer = null

  // Bind groups
  // ###########
  #frameBindGroup = null
  #shadowPassBindGroup = null
  #textObjectBindGroup = null
  #cloudShadowBindGroup = null
  #passBindGroups = null
  #ssaoBgs = null
  #ssaoBlurBgs = null
  #bloomExtractBg = null
  #bloomDownBgs = null
  #bloomUpBgs = null
  #godRayBg = null
  #particleBg = null
  #fireflySpriteBg = null
  #postprocessBg = null

  // Host-side staging — pre-allocated to avoid per-frame GC pressure. Seeded
  // with static slot values where applicable.
  #frameUniformData = new Float32Array(160)
  #deferredLightingData = new Float32Array(16)
  #rainData = new Float32Array(8)
  #postprocessData = new Float32Array(32)
  #ssaoData = new Float32Array([16.0, 0.05, 1.0, 0.0]) // radius, bias, tempAlpha, pad
  #bloomExtractData = new Float32Array(4)
  #particleData = new Float32Array(8)
  #fireflySpriteData = new Float32Array(8)
  #grassData = new Float32Array([1.0, 1.0, 0.3, 0.0])
  #birdData = new Float32Array([0.05, 0.05, 0.07, 0.6, 3.0, 0.4, 0.0, 0.0])
  #sky = stage(176)
  #godRay = stage(48)
  #fog = stage(576)
  #fireflyLights = stage(528)
  #sunScreenRaw = [0, 0]
  #sunScreenPos = [0, 0]
  #prevViewProjection = null

  // Temporal / throttling state
  // ###########################
  #lightingFrame = 0
  #ssaoFrame = 0
  #cloudShadowFrame = 0
  #cloudShadowThisFrame = false
  #cloudSunOcclusion = 1.0
  #textModelMatrix = null
  #tileBaseX = Number.NaN
  #tileBaseZ = Number.NaN
  #grassTileWorker = new GrassTileWorker()

  // Public-ish systems
  // ##################
  canvas
  timeSystem = new TimeSystem()
  windSystem = new WindSystem()
  effectsSystem = null
  boidsSystem = new BoidsSystem()
  adaptiveQuality = new AdaptiveQuality()
  camera
  cameraAnimator = null
  animationFrameId = null
  controlsUI

  get ctx() {
    return this.#ctx
  }

  constructor(canvas, mode = "full", opts = null) {
    if (opts) {
      this.timeSystem = opts.timeSystem ?? this.timeSystem
      this.adaptiveQuality = opts.adaptiveQuality ?? this.adaptiveQuality
      this.boidsSystem = opts.boidsSystem ?? this.boidsSystem
      this.controlsUI = opts.controlsUI ?? this.controlsUI
    }
    this.#mode = mode
    this.canvas = canvas
    this.camera = new Camera(canvas)
    this.#ctx.camera = this.camera

    if (mode !== "full") this.#installCompactModeHooks()

    const init = this.cameraTarget()
    this.camera.lookAt(init)
    this.#ctx.lookAt[0] = init.x
    this.#ctx.lookAt[1] = init.y
    this.#ctx.lookAt[2] = init.z

    canvas.addEventListener(
      "mousemove",
      event => {
        const rect = canvas.getBoundingClientRect()
        this.#mouseNDC[0] = ((event.clientX - rect.left) / rect.width) * 2 - 1
        this.#mouseNDC[1] = 1 - ((event.clientY - rect.top) / rect.height) * 2
      },
      { passive: true }
    )

    if (S.mouseWheelScrubsTime) {
      window.addEventListener(
        "wheel",
        event => {
          if (document.querySelector("header")?.classList.contains("canvas-expanded")) return
          const scale = event.deltaMode === 1 ? 1 : S.mouseWheelHoursPerNotch / 100
          const hours = this.timeSystem.timeInfo.timeOfDay + event.deltaY * scale
          this.timeSystem.setOverrideTime(hours)
        },
        { passive: true }
      )
    }
  }

  #installCompactModeHooks() {
    for (const [k, v] of Object.entries(COMPACT_OVERRIDES)) this.timeSystem.setOverride(k, v)
    this.timeSystem.setOverrideTime(compactHourForDark(isDark()))
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => {
      this.timeSystem.setOverrideTime(compactHourForDark(event.matches), false)
    })
    window.addEventListener(
      "themeoverride",
      ({ detail }) => this.timeSystem.setOverrideTime(compactHourForDark(detail.dark), false),
      { passive: true }
    )
  }

  cameraTarget() {
    const [x, y, z] = S.initLookAt
    return { x, y, z }
  }

  async init() {
    await this.#gpu.init(this.canvas)
    const gpu = this.#gpu
    const ctx = this.#ctx
    ctx.device = gpu.device
    ctx.queue = gpu.queue
    ctx.canvasCtx = gpu.canvasCtx
    ctx.presentationFormat = gpu.presentationFormat
    ctx.linearClamp = gpu.linearClamp
    ctx.linearRepeat = gpu.linearRepeat
    ctx.nearestClamp = gpu.nearestClamp

    this.#resize()
    let resizeTimer = null
    new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => this.#resize(), 150)
    }).observe(this.canvas)

    const { pipelines, passLayouts, frameLayout, objectLayout, emptyLayout } = createAllPipelines(
      gpu.device,
      gpu.presentationFormat
    )
    this.#pipelines = pipelines
    this.#passLayouts = passLayouts

    this.#fullscreenQuad = initFullscreenQuad(gpu)

    const noise = await initNoiseTextureAsync(gpu)
    this.#noiseData = noise.data
    this.#noiseTexture = noise.texture
    this.#windNoiseTexture = initWindNoiseTexture(gpu)

    this.#grassBuffers = initGrassBuffers(gpu)
    this.#groundBuffers = initGroundBuffers(gpu)
    this.#birdBuffers = initBirdBuffers(gpu)
    this.#textBuffers = await initTextBuffers(gpu)

    this.#shadowMapTexture = createShadowMap(gpu)
    this.#shadowMapView = this.#shadowMapTexture.createView()

    // Frame uniforms (group 0, shared by every pass)
    this.#frameUniformBuffer = createFrameUniformBuffer(gpu)
    ctx.frameUniformBuffer = this.#frameUniformBuffer
    this.#frameBindGroup = createFrameBindGroup(gpu.device, frameLayout, this.#frameUniformBuffer)
    this.#emptyBindGroup = createEmptyBindGroup(gpu.device, emptyLayout)

    // Shadow pass uniforms (alphaThreshold + pad)
    this.#shadowUniformBuffer = gpu.createBuffer(32, UNIFORM_USAGE)
    gpu.queue.writeBuffer(this.#shadowUniformBuffer, 0, new Float32Array([0.3, 0, 0, 0, 0, 0, 0, 0]))
    this.#shadowPassBindGroup = gpu.device.createBindGroup({
      label: "shadow pass",
      layout: passLayouts.shadow,
      entries: [
        { binding: 0, resource: { buffer: this.#shadowUniformBuffer } },
        { binding: 1, resource: this.#windNoiseTexture.createView() },
        { binding: 2, resource: gpu.linearRepeat },
      ],
    })

    // Text object uniform (mat4x4f)
    this.#textObjectUniformBuffer = gpu.createBuffer(64, UNIFORM_USAGE)
    this.#textObjectBindGroup = createObjectBindGroup(gpu.device, objectLayout, this.#textObjectUniformBuffer)

    // Per-pass uniform buffers — seeded with static values where applicable
    this.#grassUniformBuffer = gpu.createBuffer(16, UNIFORM_USAGE)
    gpu.queue.writeBuffer(this.#grassUniformBuffer, 0, this.#grassData)
    this.#birdUniformBuffer = gpu.createBuffer(32, UNIFORM_USAGE)
    gpu.queue.writeBuffer(this.#birdUniformBuffer, 0, this.#birdData)
    this.#deferredLightingBuffer = gpu.createBuffer(64, UNIFORM_USAGE)
    this.#fireflyUniformBuffer = gpu.createBuffer(528, UNIFORM_USAGE)
    this.#ssaoUniformBuffer = gpu.createBuffer(16, UNIFORM_USAGE)
    gpu.queue.writeBuffer(this.#ssaoUniformBuffer, 0, this.#ssaoData)
    this.#bloomExtractUniformBuffer = gpu.createBuffer(32, UNIFORM_USAGE)
    this.#bloomDownUniformBuffers = Array.from({ length: BLOOM_LEVELS }, () => gpu.createBuffer(16, UNIFORM_USAGE))
    this.#bloomUpUniformBuffers = Array.from({ length: BLOOM_LEVELS }, () => gpu.createBuffer(16, UNIFORM_USAGE))
    this.#skyUniformBuffer = gpu.createBuffer(178, UNIFORM_USAGE)
    this.#rainUniformBuffer = gpu.createBuffer(32, UNIFORM_USAGE)
    this.#godRayUniformBuffer = gpu.createBuffer(48, UNIFORM_USAGE)
    this.#fogUniformBuffer = gpu.createBuffer(576, UNIFORM_USAGE)
    this.#particleUniformBuffer = gpu.createBuffer(32, UNIFORM_USAGE)
    this.#fireflySpriteUniformBuffer = gpu.createBuffer(32, UNIFORM_USAGE)
    this.#postprocessUniformBuffer = gpu.createBuffer(128, UNIFORM_USAGE)

    // Bake targets
    this.#mountainHeightmapTexture = createMountainHeightmap(gpu)
    this.#groundHeightmapTexture = createGroundHeightmap(gpu)
    this.#cloudShadowTexture = createCloudShadowTexture(gpu)
    this.#cloudShadowTextureView = this.#cloudShadowTexture.createView()

    this.#cloudShadowUniformBuffer = createCloudShadowUniformBuffer(gpu.device)
    this.#cloudShadowBindGroup = gpu.device.createBindGroup({
      label: "cloud shadow bake",
      layout: passLayouts.cloudShadowBake,
      entries: [{ binding: 0, resource: { buffer: this.#cloudShadowUniformBuffer } }],
    })

    // One-time heightmap bakes + CPU readback (async — samples available after await)
    bakeMountainHeightmap(
      gpu.device,
      pipelines.mountainBake,
      this.#mountainHeightmapTexture,
      this.#fullscreenQuad,
      this.#emptyBindGroup
    )
    bakeGroundHeightmap(
      gpu.device,
      pipelines.groundBake,
      this.#groundHeightmapTexture,
      this.#fullscreenQuad,
      this.#emptyBindGroup
    )
    await Promise.all([
      this.#mountainHeightmap.readback(gpu.device, this.#mountainHeightmapTexture),
      this.#groundHeightmap.readback(gpu.device, this.#groundHeightmapTexture),
    ])
    this.#grassTileWorker.setHeightmap(this.#groundHeightmap.data, 512, 80)

    this.#textModelMatrix = this.#computeTextModelMatrix()
    if (this.#textModelMatrix) gpu.queue.writeBuffer(this.#textObjectUniformBuffer, 0, this.#textModelMatrix)

    this.#renderTargets = createRenderTargets(gpu, ctx.width, ctx.height)
    this.effectsSystem = new EffectsSystem()
    this.#rainBuffers = initRainBuffers(gpu, this.effectsSystem)
    this.#particleBuffers = initParticleBuffers(gpu, this.effectsSystem)
    this.#fireflyBuffers = initFireflyBuffers(gpu, this.effectsSystem)

    // Bind groups that don't depend on screen-size resources
    this.#particleBg = gpu.device.createBindGroup({
      layout: passLayouts.particle,
      entries: [{ binding: 0, resource: { buffer: this.#particleUniformBuffer } }],
    })
    this.#fireflySpriteBg = gpu.device.createBindGroup({
      layout: passLayouts.fireflySprite,
      entries: [{ binding: 0, resource: { buffer: this.#fireflySpriteUniformBuffer } }],
    })

    this.#rebuildPassBindGroups()
    this.#clearPostProcessTargets()

    this.cameraAnimator = new CameraAnimator(
      this.camera,
      () => this.#grassTileWorker.dispatch(this.#grassBuffers, ctx.cameraPosition),
      (x, z) => this.#sampleGround(x, z),
      this.timeSystem
    )
    this.controlsUI?.addAnimator(this.cameraAnimator)

    new IntersectionObserver(entries => {
      this.#visible = entries[0].isIntersecting
      if (this.#visible && !this.animationFrameId) {
        this.#ctx.now = performance.now()
        this.animationFrameId = requestAnimationFrame(this.#renderCB)
      }
    }).observe(this.canvas)

    gpu.queue.submit([])
    this.#render()
  }

  // Rebuild all bind groups that reference screen-size render targets. Called at
  // init and after every resize (render target textures are recreated).
  #rebuildPassBindGroups() {
    const gpu = this.#gpu
    const ctx = this.#ctx
    const rt = this.#renderTargets
    if (!rt || !ctx.depthView) return

    const device = gpu.device
    const lay = this.#passLayouts
    const lin = gpu.linearClamp
    const near = gpu.nearestClamp

    this.#rtViews = {
      gAlbedo: rt.gAlbedo.createView(),
      gNormal: rt.gNormal.createView(),
      gMaterial: rt.gMaterial.createView(),
      sceneTexture: rt.sceneTexture.createView(),
    }
    for (const t of [rt.ssao, rt.ssaoPrev, rt.ssaoBlur, rt.bloomExtract, rt.godRay, ...rt.bloomMips]) {
      t.view = t.texture.createView()
    }
    this.#bloomUpTargets = [...rt.bloomMips.slice(0, BLOOM_LEVELS - 1).reverse(), rt.bloomExtract]

    this.#passBindGroups = createPassBindGroups(
      device,
      {
        grass: lay.grass,
        shadow: lay.shadow,
        ground: lay.ground,
        bird: lay.bird,
        deferredLighting: lay.deferredLighting,
        fireflyLights: lay.fireflyLights,
        sky: lay.sky,
        rain: lay.rain,
      },
      {
        windNoise: this.#windNoiseTexture,
        groundHeightmap: this.#groundHeightmapTexture,
        mountainHeightmap: this.#mountainHeightmapTexture,
        noiseTex: this.#noiseTexture,
        gAlbedo: rt.gAlbedo,
        gNormal: rt.gNormal,
        gMaterial: rt.gMaterial,
        shadowMap: this.#shadowMapTexture,
        cloudShadow: this.#cloudShadowTexture,
      },
      {
        depthView: ctx.depthView,
        depthSampleView: ctx.depthSampleView,
        shadowMapView: this.#shadowMapView,
        cloudShadowView: this.#cloudShadowTextureView,
      },
      { linearClamp: lin, linearRepeat: gpu.linearRepeat, nearestClamp: near, depthSampler: gpu.depthSampler },
      {
        grass: this.#grassUniformBuffer,
        shadow: this.#shadowUniformBuffer,
        bird: this.#birdUniformBuffer,
        deferredLighting: this.#deferredLightingBuffer,
        fireflyLights: this.#fireflyUniformBuffer,
        sky: this.#skyUniformBuffer,
        rain: this.#rainUniformBuffer,
      }
    )

    // SSAO ping-pong: idx 0 reads ssaoPrev→writes ssao; idx 1 reads ssao→writes ssaoPrev.
    const ssaoEntries = prev => [
      { binding: 0, resource: { buffer: this.#ssaoUniformBuffer } },
      { binding: 1, resource: ctx.depthView },
      { binding: 2, resource: near },
      { binding: 3, resource: this.#rtViews.gAlbedo },
      { binding: 4, resource: near },
      { binding: 5, resource: prev.view },
      { binding: 6, resource: lin },
    ]
    const ssaoBlurEntries = src => [
      { binding: 0, resource: src.view },
      { binding: 1, resource: lin },
      { binding: 2, resource: ctx.depthView },
    ]
    this.#ssaoBgs = [
      device.createBindGroup({ layout: lay.ssao, entries: ssaoEntries(rt.ssaoPrev) }),
      device.createBindGroup({ layout: lay.ssao, entries: ssaoEntries(rt.ssao) }),
    ]
    this.#ssaoBlurBgs = [
      device.createBindGroup({ layout: lay.ssaoBlur, entries: ssaoBlurEntries(rt.ssao) }),
      device.createBindGroup({ layout: lay.ssaoBlur, entries: ssaoBlurEntries(rt.ssaoPrev) }),
    ]

    // Bloom: extract threshold is fixed; halfTexel uniforms depend on source mip size.
    gpu.queue.writeBuffer(this.#bloomExtractUniformBuffer, 0, new Float32Array([0.8, 0, 0, 0, 0, 0, 0, 0]))
    const bloomBg = (layout, uniformBuf, srcView) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: uniformBuf } },
          { binding: 1, resource: lin },
          { binding: 2, resource: srcView },
        ],
      })
    const writeHalfTexel = (buf, w, h) => gpu.queue.writeBuffer(buf, 0, new Float32Array([0.5 / w, 0.5 / h, 0, 0]))

    this.#bloomExtractBg = bloomBg(lay.bloomExtract, this.#bloomExtractUniformBuffer, this.#rtViews.sceneTexture)
    const downSources = [rt.bloomExtract, ...rt.bloomMips.slice(0, BLOOM_LEVELS - 1)]
    this.#bloomDownBgs = downSources.map((src, i) => {
      writeHalfTexel(this.#bloomDownUniformBuffers[i], src.width, src.height)
      return bloomBg(lay.bloomDown, this.#bloomDownUniformBuffers[i], src.view)
    })
    const upSources = rt.bloomMips.slice(0, BLOOM_LEVELS).reverse()
    this.#bloomUpBgs = upSources.map((src, i) => {
      writeHalfTexel(this.#bloomUpUniformBuffers[i], src.width, src.height)
      return bloomBg(lay.bloomUp, this.#bloomUpUniformBuffers[i], src.view)
    })

    this.#godRayBg = device.createBindGroup({
      layout: lay.godrays,
      entries: [
        { binding: 0, resource: { buffer: this.#godRayUniformBuffer } },
        { binding: 1, resource: this.#rtViews.sceneTexture },
        { binding: 2, resource: ctx.depthView },
        { binding: 3, resource: this.#shadowMapView },
        { binding: 4, resource: this.#cloudShadowTextureView },
        { binding: 5, resource: lin },
        { binding: 6, resource: gpu.depthSampler },
      ],
    })

    this.#postprocessBg = device.createBindGroup({
      layout: lay.postprocess,
      entries: [
        { binding: 0, resource: { buffer: this.#postprocessUniformBuffer } },
        { binding: 1, resource: this.#rtViews.sceneTexture },
        { binding: 2, resource: lin },
        { binding: 3, resource: ctx.depthView },
        { binding: 4, resource: near },
        { binding: 5, resource: rt.bloomExtract.view },
        { binding: 6, resource: lin },
        { binding: 7, resource: rt.godRay.view },
        { binding: 8, resource: lin },
        { binding: 9, resource: rt.ssaoBlur.view },
        { binding: 10, resource: lin },
        { binding: 11, resource: this.#rtViews.gAlbedo },
        { binding: 12, resource: near },
        { binding: 13, resource: { buffer: this.#fogUniformBuffer } },
        { binding: 14, resource: this.#noiseTexture.createView() },
        { binding: 15, resource: gpu.linearRepeat },
      ],
    })
  }

  #resize() {
    const dpr = window.devicePixelRatio ?? 1.0
    const canvas = this.canvas
    const width = Math.round(canvas.offsetWidth * dpr)
    const height = Math.round(canvas.offsetHeight * dpr)
    if (width === canvas.width && height === canvas.height) return
    canvas.width = width
    canvas.height = height

    const ctx = this.#ctx
    ctx.width = width
    ctx.height = height
    const fovRad = (this.#mode === "full" ? FOV_FULL_DEG : FOV_COMPACT_DEG) * DEG_TO_RAD
    ctx.fov = fovRad
    ctx.aspect = width / height
    ctx.projectionMatrix = perspectiveMatrixWebGPU(fovRad, ctx.aspect, NEAR, FAR)
    ctx.invProjectionMatrix = invertMatrix4(ctx.projectionMatrix)

    ctx.depthTexture?.destroy()
    ctx.depthTexture = this.#gpu.createDepthTexture(width, height, "depth24plus")
    ctx.depthView = ctx.depthTexture.createView({ label: "depth attachment view" })
    ctx.depthSampleView = ctx.depthTexture.createView({ label: "depth sample view", aspect: "depth-only" })

    if (this.#renderTargets) {
      const rt = this.#renderTargets
      for (const k of ["gAlbedo", "gNormal", "gMaterial", "sceneTexture"]) rt[k]?.destroy()
      for (const k of ["ssao", "ssaoPrev", "ssaoBlur", "bloomExtract", "godRay"]) rt[k]?.texture.destroy()
      for (const m of rt.bloomMips) m.texture.destroy()
      this.#renderTargets = createRenderTargets(this.#gpu, width, height)
      this.#rebuildPassBindGroups()
      this.#clearPostProcessTargets()
    }
  }

  // Clear post-process input textures once at init/resize so sampling reads a
  // known value before the first real write. Eliminates per-frame clear-only
  // passes — each pass boundary flushes tile memory on TBDR GPUs.
  #clearPostProcessTargets() {
    const rt = this.#renderTargets
    if (!rt) return
    const enc = this.#ctx.device.createCommandEncoder()
    clearRT(enc, rt.ssao.view, CLEAR_WHITE)
    clearRT(enc, rt.ssaoPrev.view, CLEAR_WHITE)
    clearRT(enc, rt.ssaoBlur.view, CLEAR_WHITE)
    clearRT(enc, rt.bloomExtract.view, CLEAR_BLACK)
    clearRT(enc, rt.godRay.view, CLEAR_BLACK)
    this.#ctx.device.queue.submit([enc.finish()])
    this.#ssaoFrame = 0
  }

  // Static text transform: scale 4×, rotX −90°, rotY 198°, translate (0, 0.6, 10).
  #computeTextModelMatrix() {
    const s = 4.0
    const cx = Math.cos(-0.5 * Math.PI),
      sx = Math.sin(-0.5 * Math.PI)
    const cy = Math.cos(Math.PI * 1.1),
      sy = Math.sin(Math.PI * 1.1)
    const rotX = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1]
    const rotY = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1]
    const scaleTrans = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0.0, 0.6, 10.0, 1]
    return new Float32Array(multiplyMM(scaleTrans, multiplyMM(rotY, rotX)))
  }

  // Orthographic frustum fitted to the camera's near-side frustum corners
  // projected into light space, texel-snapped to prevent shadow shimmer.
  // Returns null when the sun is below the horizon (no shadows at night).
  #computeLightSpaceMatrix(ctx) {
    const sun = ctx.sunDirection
    if (sun[1] <= 0.05) return null
    const [cx, cy, cz] = ctx.cameraPosition
    const lightDist = 80
    const eye = [cx + sun[0] * lightDist, cy + sun[1] * lightDist, cz + sun[2] * lightDist]
    const target = [cx, 0, cz]
    const up = Math.abs(sun[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0]
    const lightView = lookAtMatrix(eye, target, up)

    const tanH = Math.tan(ctx.fov / 2)
    const aspect = ctx.aspect
    const nZ = 0.1,
      fZ = SHADOW_DISTANCE_WU
    let minX = Infinity,
      maxX = -Infinity
    let minY = Infinity,
      maxY = -Infinity
    let minZ = Infinity,
      maxZ = -Infinity
    for (const [sX, sY, depth] of FRUSTUM_CORNERS_NDC) {
      const z = depth === 0 ? nZ : fZ
      const h = z * tanH
      const w = h * aspect
      const lc = multiplyMV(lightView, multiplyMV(ctx.invViewMatrix, [sX * w, sY * h, -z, 1]))
      if (lc[0] < minX) minX = lc[0]
      if (lc[0] > maxX) maxX = lc[0]
      if (lc[1] < minY) minY = lc[1]
      if (lc[1] > maxY) maxY = lc[1]
      if (lc[2] < minZ) minZ = lc[2]
      if (lc[2] > maxZ) maxZ = lc[2]
    }
    maxZ += 3.0
    const field = AREA_SIZE * 1.5
    minX = Math.max(minX, -field)
    maxX = Math.min(maxX, field)
    minY = Math.max(minY, -field)
    maxY = Math.min(maxY, field)

    // Texel snap — prevents sub-texel jitter from producing shimmering edges.
    const texelW = (maxX - minX) / SHADOWMAP_SIZE
    const texelH = (maxY - minY) / SHADOWMAP_SIZE
    minX = Math.floor(minX / texelW) * texelW
    maxX = minX + Math.ceil((maxX - minX) / texelW) * texelW
    minY = Math.floor(minY / texelH) * texelH
    maxY = minY + Math.ceil((maxY - minY) / texelH) * texelH

    const near = Math.max(-maxZ, 0.1)
    const far = Math.max(-minZ + 5.0, near + 1.0)
    return multiplyMM(orthographicMatrixWebGPU(minX, maxX, minY, maxY, near, far), lightView)
  }

  #sampleGround(x, z) {
    return this.#groundHeightmap.ready ? this.#groundHeightmap.sampleBilinear(x, z, 1) : 0
  }

  // Mouse ray in world space, or null if view matrices aren't ready.
  #computeMouseRay(ctx) {
    if (!ctx.invProjectionMatrix || !ctx.invViewMatrix) return null
    const [ndcX, ndcY] = this.#mouseNDC
    const farView = multiplyMV(ctx.invProjectionMatrix, [ndcX, ndcY, 1, 1])
    const invW = 1 / farView[3]
    const farWorld = multiplyMV(ctx.invViewMatrix, [farView[0] * invW, farView[1] * invW, farView[2] * invW, 1])
    const [ox, oy, oz] = ctx.cameraPosition
    const dx = farWorld[0] - ox,
      dy = farWorld[1] - oy,
      dz = farWorld[2] - oz
    const invLen = 1 / (Math.hypot(dx, dy, dz) || 1)
    return { ox, oy, oz, dx: dx * invLen, dy: dy * invLen, dz: dz * invLen }
  }

  // Project the sun into screen space. sunScreenRaw is used by god rays (no
  // behind-camera guard, matching prior behavior). sunScreenPos uses sentinel
  // (2, 2) when the sun is behind the camera so post-process can reject it.
  #updateSunProjection(ctx) {
    const [ex, ey, ez] = ctx.cameraPosition
    const [sx, sy, sz] = ctx.sunDirection
    const d = SUN_PROJECTION_WU
    const clip = multiplyMV(ctx.viewProjectionMatrix, [ex + sx * d, ey + sy * d, ez + sz * d, 1])
    const w = clip[3]
    const x = (clip[0] / w) * 0.5 + 0.5
    const y = 0.5 - (clip[1] / w) * 0.5
    this.#sunScreenRaw[0] = x
    this.#sunScreenRaw[1] = y
    const onScreen = w > 0
    this.#sunScreenPos[0] = onScreen ? x : 2
    this.#sunScreenPos[1] = onScreen ? y : 2
  }

  #updateCursorWorldPos(ctx, ray) {
    if (ray && Math.abs(ray.dy) > 0.001) {
      const t0 = -ray.oy / ray.dy
      if (t0 > 0 && t0 < 50) {
        const x0 = ray.ox + ray.dx * t0
        const z0 = ray.oz + ray.dz * t0
        const groundY = this.#sampleGround(x0, z0)
        const t = (groundY - ray.oy) / ray.dy
        ctx.cursorWorldPos[0] = ray.ox + ray.dx * t
        ctx.cursorWorldPos[1] = groundY
        ctx.cursorWorldPos[2] = ray.oz + ray.dz * t
        ctx.cursorActive = 1.5
        return
      }
    }
    ctx.cursorActive = 0
  }

  // Grass fields re-tile when the camera crosses a tile boundary. The dense and
  // sparse anchor offsets are derived from baseX/baseZ by fixed constants, so
  // tracking just the base tile coordinate is sufficient.
  #updateGrassTileAnchors(ctx) {
    const cp = ctx.cameraPosition
    const baseX = Math.floor(cp[0] / TILE_SIZE)
    const baseZ = Math.floor(cp[2] / TILE_SIZE)
    if (baseX === this.#tileBaseX && baseZ === this.#tileBaseZ) return
    this.#tileBaseX = baseX
    this.#tileBaseZ = baseZ
    this.#grassTileWorker.dispatch(this.#grassBuffers, cp)
  }

  // Uniform writers — each submits one host-side buffer to its GPU uniform
  // #############################################################################

  #writeGrassUniforms(ctx, timeInfo) {
    const d = this.#grassData
    d[0] = timeInfo.grassHeightFactor ?? 1.0
    d[1] = timeInfo.grassWidthFactor ?? 1.0
    d[3] = timeInfo.dewAmount ?? 0.0
    ctx.queue.writeBuffer(this.#grassUniformBuffer, 0, d)
  }

  #writeBirdUniforms(ctx, timeInfo) {
    const d = this.#birdData
    d[3] = timeInfo.birdWingAmplitude ?? 0.41
    d[4] = timeInfo.birdWingBeat ?? 0.09
    d[5] = timeInfo.birdScale ?? 0.6
    ctx.queue.writeBuffer(this.#birdUniformBuffer, 0, d)
  }

  #writeDeferredLightingUniforms(ctx, timeInfo) {
    const sunElev = Math.max(0, Math.min(1, timeInfo.sunPosition.y / 0.1))
    const moonElev = Math.max(0, Math.min(1, timeInfo.moonPosition.y / 0.15)) * (1 - sunElev)
    const sky = ctx.skyColor
    const d = this.#deferredLightingData
    d[0] = sky.r
    d[1] = sky.g
    d[2] = sky.b
    d[3] = timeInfo.ambientIntensity
    d[4] = timeInfo.colorTemperature
    d[5] = ctx.lightSpaceMatrix ? 1 : 0
    d[6] = ctx.mountainVisibility
    d[7] = moonElev
    d[8] = timeInfo.sparkleEnabled ?? 1
    d[9] = timeInfo.sparkleIntensity ?? 1
    d[10] = timeInfo.sparkleDensity ?? 8
    d[11] = timeInfo.sparkleSharpness ?? 2
    d[12] = timeInfo.sparkleSpeed ?? 1
    d[13] = ctx.cloudLightOcclusion
    d[14] = this.controlsUI?.debugMode ?? this.#debugMode
    d[15] = 0
    ctx.queue.writeBuffer(this.#deferredLightingBuffer, 0, d)
  }

  // Pack 32 × vec4f (xyz + brightness·factor) into `f` starting at floatBase.
  #packFireflyArray(f, floatBase, factor) {
    const eff = this.effectsSystem
    const pos = eff?.fireflyPositions
    const br = eff?.fireflyBrightness
    for (let i = 0; i < FIREFLY_SLOTS; i++) {
      const o = floatBase + i * 4
      const p = i * 3
      f[o] = pos ? pos[p] : 0
      f[o + 1] = pos ? pos[p + 1] : 0
      f[o + 2] = pos ? pos[p + 2] : 0
      f[o + 3] = br ? br[i] * factor : 0
    }
  }

  #writeFireflyUniforms(ctx, timeInfo) {
    const eff = this.effectsSystem
    if (!eff) return
    const factor = ctx.fireflyFactor
    const { f, dv, buf } = this.#fireflyLights
    dv.setUint32(0, factor > 0 ? (eff.fireflyCount ?? 0) : 0, true)
    f[1] = factor
    f[2] = timeInfo.fireflyLightRadius
    f[3] = 0
    this.#packFireflyArray(f, 4, factor)
    ctx.queue.writeBuffer(this.#fireflyUniformBuffer, 0, buf)
  }

  #writeSkyUniforms(ctx, timeInfo) {
    const rain = timeInfo.rain
    const dim = 1 - rain * 0.25
    const { r: zr, g: zg, b: zb } = timeInfo.zenithColor
    const { r: hr, g: hg, b: hb } = timeInfo.horizonColor
    const { f, dv, buf } = this.#sky
    f[0] = zr * dim
    f[1] = zg * dim
    f[2] = zb * dim
    f[3] = Math.max(0, timeInfo.sunPosition.y)
    f[4] = hr
    f[5] = hg
    f[6] = hb
    f[7] = timeInfo.cloudBase
    f[8] = timeInfo.cloudTop + rain * 10
    f[9] = timeInfo.cloudCoverage - rain * 0.1
    f[10] = timeInfo.cloudSigmaE + rain * 0.04
    dv.setUint32(44, Math.round(timeInfo.cloudSteps), true)
    dv.setUint32(48, Math.round(timeInfo.cloudShadowSteps), true)
    f[13] = moonPhase()
    dv.setUint32(56, Math.round(timeInfo.chemtrailCount), true)
    f[15] = timeInfo.chemtrailOpacity
    f[16] = timeInfo.chemtrailWidth
    f[17] = timeInfo.turbidity + rain * 0.5
    f[18] = timeInfo.overcast + rain * 0.5
    // Preetham coefficients at float offset 20 (byte 80)
    const sunDirY = ctx.sunDirection ? ctx.sunDirection[1] : 0.5
    f.set(preethamPrecompute(f[17], sunDirY), 20)
    ctx.queue.writeBuffer(this.#skyUniformBuffer, 0, buf)
  }

  #writeRainUniforms(ctx, timeInfo) {
    this.#rainData[0] = timeInfo.rain
    ctx.queue.writeBuffer(this.#rainUniformBuffer, 0, this.#rainData)
  }

  #writeGodRayUniforms(ctx, timeInfo) {
    const { f, dv, buf } = this.#godRay
    f[0] = this.#sunScreenRaw[0]
    f[1] = this.#sunScreenRaw[1]
    f[2] = timeInfo.godRayDecay * (ctx.mountainVisibility ?? 1) + timeInfo.rain
    f[3] = timeInfo.sunAboveHorizon ? 1 : 0
    dv.setUint32(16, Math.round(timeInfo.godRaySteps), true)
    // shadowEnabled — mobile disables dynamic shadow-map sampling in god rays.
    f[5] = S.isMobile ? 0 : 1
    ctx.queue.writeBuffer(this.#godRayUniformBuffer, 0, buf)
  }

  #writeFogUniforms(ctx, timeInfo) {
    const eff = this.effectsSystem
    const rain = timeInfo.rain
    const wu = this.windSystem.uniforms
    const factor = ctx.fireflyFactor
    const fireflyCount = factor > 0 && eff ? (eff.fireflyCount ?? 0) : 0
    const { r: fr, g: fg, b: fb } = timeInfo.fogColor
    const { f, dv, buf } = this.#fog
    f[0] = fr
    f[1] = fg
    f[2] = fb
    f[3] = timeInfo.fogDensity + rain * 0.1
    f[4] = timeInfo.fogHeightFalloff + rain * 0.1
    f[5] = timeInfo.fogIntensity + rain * 0.5
    f[6] = timeInfo.fogQuality
    dv.setUint32(28, Math.round(timeInfo.fogSteps), true)
    f[8] = wu.windDirection[0]
    f[9] = wu.windDirection[1]
    f[10] = wu.windStrength
    dv.setUint32(44, fireflyCount, true)
    f[12] = factor
    f[13] = timeInfo.fireflyLightRadius
    if (factor > 0) {
      this.#packFireflyArray(f, 16, factor)
      ctx.queue.writeBuffer(this.#fogUniformBuffer, 0, buf)
    } else {
      // Skip the 512-byte firefly array — only header fields are live.
      ctx.queue.writeBuffer(this.#fogUniformBuffer, 0, buf, 0, 64)
    }
  }

  #writePostProcessUniforms(ctx, timeInfo) {
    const rain = timeInfo.rain
    const [sx, sy] = this.#sunScreenPos
    const { r: fr, g: fg, b: fb } = timeInfo.fogColor
    const [lr, lg, lb] = timeInfo.cgLift
    const night = isNight(timeInfo)
    const skipBloom = !isActive(timeInfo.bloomIntensity) || night
    const skipGodRays = !isActive(timeInfo.godRayIntensity)
    const skipSSAO = !isActive(timeInfo.ssaoIntensity)
    const f = this.#postprocessData
    f[0] = fr
    f[1] = fg
    f[2] = fb
    f[3] = timeInfo.depthOfField
    f[4] = lr
    f[5] = lg
    f[6] = lb
    f[7] = S.isMobile ? 0 : 1
    f[8] = sx
    f[9] = sy
    f[10] = timeInfo.dofFocusNear
    f[11] = timeInfo.dofFocusFar
    f[12] = timeInfo.dofBlurNear
    f[13] = timeInfo.dofBlurFar
    // Zero intensity for skipped passes so post-process doesn't sample stale texels.
    f[14] = skipBloom ? 0 : timeInfo.bloomIntensity
    f[15] = skipGodRays ? 0 : timeInfo.godRayIntensity + rain * 0.5
    f[16] = skipSSAO ? 0 : timeInfo.ssaoIntensity
    f[17] = timeInfo.chromaticAberration
    f[18] = timeInfo.cgExposure - rain * 0.25
    f[19] = timeInfo.cgContrast - rain * 0.125
    f[20] = timeInfo.cgSaturation - rain * 0.4
    f[21] = (timeInfo.lensFlareIntensity ?? 0.6) * (ctx.cloudLightOcclusion ?? 1) * (ctx.mountainVisibility ?? 1)
    f[22] = timeInfo.grainStrength
    f[23] = timeInfo.vignetteStrength
    f[24] = rain
    f[25] = timeInfo.rainbowIntensity
    ctx.queue.writeBuffer(this.#postprocessUniformBuffer, 0, f)
  }

  // Fullscreen draw into a wrapped render target (.texture, .width, .height, .view).
  #fullscreenTarget(encoder, target, pipeline, bg0, bg1, clearValue = CLEAR_BLACK, loadOp = "clear") {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.view, clearValue, loadOp, storeOp: "store" }],
    })
    pass.setViewport(0, 0, target.width, target.height, 0, 1)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bg0)
    pass.setBindGroup(1, bg1)
    pass.draw(3)
    pass.end()
  }

  // Render passes
  // #############

  #renderShadowPass(encoder, ctx) {
    if (!ctx.lightSpaceMatrix) return
    const grass = this.#grassBuffers
    if (!grass) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.#shadowMapView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    })
    pass.setViewport(0, 0, SHADOWMAP_SIZE, SHADOWMAP_SIZE, 0, 1)
    pass.setPipeline(this.#pipelines.shadow)
    pass.setBindGroup(0, this.#frameBindGroup)
    pass.setBindGroup(1, this.#shadowPassBindGroup)
    pass.setVertexBuffer(0, grass.bladeVertices)
    pass.setVertexBuffer(1, grass.bladeTexCoords)
    pass.setIndexBuffer(grass.bladeIndices, "uint16")
    pass.setVertexBuffer(2, grass.denseDynamic)
    pass.setVertexBuffer(3, grass.denseAttribs)
    pass.drawIndexed(grass.bladeIndexCount, grass.denseGrassCount)
    pass.setVertexBuffer(2, grass.sparseDynamic)
    pass.setVertexBuffer(3, grass.sparseAttribs)
    pass.drawIndexed(grass.bladeIndexCount, grass.grassCount)
    if (this.#textBuffers && this.#textModelMatrix) {
      pass.setPipeline(this.#pipelines.shadowText)
      pass.setBindGroup(1, this.#emptyBindGroup)
      pass.setBindGroup(2, this.#emptyBindGroup)
      pass.setBindGroup(3, this.#textObjectBindGroup)
      pass.setVertexBuffer(0, this.#textBuffers.positions)
      pass.setIndexBuffer(this.#textBuffers.indices, this.#textBuffers.indexFormat)
      pass.drawIndexed(this.#textBuffers.indexCount)
    }
    pass.end()
  }

  #renderGBufferPass(encoder, ctx) {
    if (!this.#renderTargets) return
    const rtv = this.#rtViews
    const mrt = view => ({ view, clearValue: CLEAR_TRANSPARENT, loadOp: "clear", storeOp: "store" })
    const pass = encoder.beginRenderPass({
      colorAttachments: [mrt(rtv.gAlbedo), mrt(rtv.gNormal), mrt(rtv.gMaterial)],
      depthStencilAttachment: {
        view: ctx.depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    })
    pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1)

    const grass = this.#grassBuffers
    if (grass && this.#passBindGroups.grass) {
      pass.setPipeline(this.#pipelines.grass)
      pass.setBindGroup(0, this.#frameBindGroup)
      pass.setBindGroup(1, this.#passBindGroups.grass)
      pass.setVertexBuffer(0, grass.bladeVertices)
      pass.setVertexBuffer(1, grass.bladeTexCoords)
      pass.setIndexBuffer(grass.bladeIndices, "uint16")
      pass.setVertexBuffer(2, grass.denseDynamic)
      pass.setVertexBuffer(3, grass.denseAttribs)
      pass.setVertexBuffer(4, grass.denseNoise)
      pass.drawIndexed(grass.bladeIndexCount, grass.denseGrassCount)
      pass.setVertexBuffer(2, grass.sparseDynamic)
      pass.setVertexBuffer(3, grass.sparseAttribs)
      pass.setVertexBuffer(4, grass.sparseNoise)
      pass.drawIndexed(grass.bladeIndexCount, grass.grassCount)
    }

    const ground = this.#groundBuffers
    if (ground && this.#passBindGroups.ground) {
      pass.setPipeline(this.#pipelines.ground)
      pass.setBindGroup(0, this.#frameBindGroup)
      pass.setBindGroup(1, this.#passBindGroups.ground)
      pass.setVertexBuffer(0, ground.vertices)
      pass.setVertexBuffer(1, ground.texCoords)
      pass.setIndexBuffer(ground.indices, "uint32")
      pass.drawIndexed(ground.indexCount)
    }

    if (this.#textBuffers && this.#textModelMatrix) {
      pass.setPipeline(this.#pipelines.text)
      pass.setBindGroup(0, this.#frameBindGroup)
      pass.setBindGroup(1, this.#emptyBindGroup)
      pass.setBindGroup(2, this.#emptyBindGroup)
      pass.setBindGroup(3, this.#textObjectBindGroup)
      pass.setVertexBuffer(0, this.#textBuffers.positions)
      pass.setVertexBuffer(1, this.#textBuffers.normals)
      pass.setIndexBuffer(this.#textBuffers.indices, this.#textBuffers.indexFormat)
      pass.drawIndexed(this.#textBuffers.indexCount)
    }

    const birds = this.#birdBuffers
    if (birds && this.#passBindGroups.bird) {
      pass.setPipeline(this.#pipelines.bird)
      pass.setBindGroup(0, this.#frameBindGroup)
      pass.setBindGroup(1, this.#passBindGroups.bird)
      pass.setVertexBuffer(0, birds.positions)
      pass.setVertexBuffer(1, birds.flex)
      pass.setVertexBuffer(2, birds.instanceBuffer)
      pass.draw(birds.vertexCount, birds.instanceCount)
    }
    pass.end()
  }

  // Scene pass splits into deferred (no depth attachment — depth bound as a
  // texture for world-pos reconstruction) and forward (loads depth for the sky's
  // less-equal test). iOS Safari does not support merging via depthReadOnly: true.
  #renderScenePass(encoder, ctx, timeInfo) {
    if (!this.#renderTargets) return
    const sceneView = this.#rtViews.sceneTexture

    const deferred = encoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, clearValue: CLEAR_BLACK, loadOp: "clear", storeOp: "store" }],
    })
    deferred.setViewport(0, 0, ctx.width, ctx.height, 0, 1)
    deferred.setBindGroup(0, this.#frameBindGroup)
    this.#drawDeferred(deferred, ctx)
    deferred.end()

    const forward = encoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: "load", depthStoreOp: "store" },
    })
    forward.setViewport(0, 0, ctx.width, ctx.height, 0, 1)
    forward.setBindGroup(0, this.#frameBindGroup)
    this.#drawForward(forward, ctx, timeInfo)
    forward.end()
  }

  #drawDeferred(pass, ctx) {
    // Deferred lighting (fullscreen, depthCompare: always — depth read via sampler).
    pass.setPipeline(this.#pipelines.deferredLighting)
    pass.setBindGroup(1, this.#passBindGroups.deferredLighting)
    pass.draw(3)
    // Firefly lights (fullscreen additive). Skip when no fireflies are visible.
    const eff = this.effectsSystem
    if (this.#passBindGroups.fireflyLights && eff && (eff.fireflyCount ?? 0) > 0 && ctx.fireflyFactor > 0) {
      pass.setPipeline(this.#pipelines.fireflyLights)
      pass.setBindGroup(1, this.#passBindGroups.fireflyLights)
      pass.draw(3)
    }
  }

  #drawForward(pass, ctx, timeInfo) {
    // Sky (depthCompare: less-equal — only writes background pixels).
    if (this.#passBindGroups.sky) {
      pass.setPipeline(this.#pipelines.sky)
      pass.setBindGroup(1, this.#passBindGroups.sky)
      pass.draw(3)
    }
    // Rain (depthCompare: less, alpha blend).
    if (timeInfo.rain > 0 && this.#rainBuffers && this.#passBindGroups.rain) {
      pass.setPipeline(this.#pipelines.rain)
      pass.setBindGroup(1, this.#passBindGroups.rain)
      pass.setVertexBuffer(0, this.#rainBuffers.lineOffsets)
      pass.setVertexBuffer(1, this.#rainBuffers.positions)
      pass.draw(2, this.#rainBuffers.count)
    }
    const eff = this.effectsSystem
    // Particles (depthCompare: less, additive).
    if (this.#particleBuffers && eff?.particleCount) {
      this.#particleData[0] = timeInfo.ambientIntensity
      ctx.queue.writeBuffer(this.#particleUniformBuffer, 0, this.#particleData)
      pass.setPipeline(this.#pipelines.particle)
      pass.setBindGroup(1, this.#particleBg)
      pass.setVertexBuffer(0, this.#particleBuffers.positions)
      pass.setVertexBuffer(1, this.#particleBuffers.sizes)
      pass.setVertexBuffer(2, this.#particleBuffers.lives)
      pass.setVertexBuffer(3, this.#particleBuffers.phases)
      pass.draw(4, eff.particleCount)
    }
    // Firefly sprites (depthCompare: less, additive).
    const factor = ctx.fireflyFactor
    if (this.#fireflyBuffers && eff?.fireflyCount && factor > 0) {
      this.#fireflySpriteData[0] = factor
      ctx.queue.writeBuffer(this.#fireflySpriteUniformBuffer, 0, this.#fireflySpriteData)
      pass.setPipeline(this.#pipelines.fireflySprite)
      pass.setBindGroup(1, this.#fireflySpriteBg)
      pass.setVertexBuffer(0, this.#fireflyBuffers.positions)
      pass.setVertexBuffer(1, this.#fireflyBuffers.brightness)
      pass.draw(4, eff.fireflyCount)
    }
  }

  // Temporal SSAO — stable per-pixel kernel rotation, only temporalAlpha changes.
  #renderSSAOPass(encoder, ctx) {
    const rt = this.#renderTargets
    if (!rt || !this.#ssaoBgs) return
    const idx = this.#ssaoFrame % 2
    this.#ssaoData[2] = this.#ssaoFrame === 0 ? 1 : 0.1
    ctx.queue.writeBuffer(this.#ssaoUniformBuffer, 0, this.#ssaoData)

    const ssaoTarget = idx === 0 ? rt.ssao : rt.ssaoPrev
    this.#fullscreenTarget(
      encoder,
      ssaoTarget,
      this.#pipelines.ssao,
      this.#frameBindGroup,
      this.#ssaoBgs[idx],
      CLEAR_WHITE
    )
    this.#fullscreenTarget(
      encoder,
      rt.ssaoBlur,
      this.#pipelines.ssaoBlur,
      this.#frameBindGroup,
      this.#ssaoBlurBgs[idx],
      CLEAR_WHITE
    )
    this.#ssaoFrame++
  }

  // Bloom: extract highlights → downsample pyramid → additive upsample → bloomExtract.
  #renderBloomPass(encoder, ctx, timeInfo) {
    const rt = this.#renderTargets
    if (!rt || !this.#bloomExtractBg) return
    const empty = this.#emptyBindGroup

    this.#bloomExtractData[0] = timeInfo.bloomThreshold
    ctx.queue.writeBuffer(this.#bloomExtractUniformBuffer, 0, this.#bloomExtractData)

    this.#fullscreenTarget(encoder, rt.bloomExtract, this.#pipelines.bloomExtract, empty, this.#bloomExtractBg)
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.#fullscreenTarget(encoder, rt.bloomMips[i], this.#pipelines.bloomDown, empty, this.#bloomDownBgs[i])
    }
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.#fullscreenTarget(
        encoder,
        this.#bloomUpTargets[i],
        this.#pipelines.bloomUp,
        empty,
        this.#bloomUpBgs[i],
        CLEAR_BLACK,
        "load"
      )
    }
  }

  #renderGodRaysPass(encoder, ctx, timeInfo) {
    const rt = this.#renderTargets
    if (!rt || !this.#godRayBg || timeInfo.godRaySteps < 1) return
    this.#fullscreenTarget(encoder, rt.godRay, this.#pipelines.godrays, this.#frameBindGroup, this.#godRayBg)
  }

  #renderPostProcessPass(encoder, canvasView) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: canvasView, clearValue: CLEAR_BLACK, loadOp: "clear", storeOp: "store" }],
    })
    pass.setPipeline(this.#pipelines.postprocess)
    pass.setBindGroup(0, this.#frameBindGroup)
    pass.setBindGroup(1, this.#postprocessBg)
    pass.draw(3)
    pass.end()
  }

  // Main render loop
  // ################

  #render() {
    // iOS TBDR back-pressure gate: don't queue another frame until the GPU
    // drains the previous one, or the command queue grows unbounded.
    if (this.#gpuFramePending) {
      this.animationFrameId = this.#visible ? requestAnimationFrame(this.#renderCB) : null
      return
    }

    const ctx = this.#ctx
    const now = performance.now()
    ctx.deltaTime = now - ctx.now
    ctx.now = now
    ctx.currentTime = now

    // Time + adaptive quality
    if (this.cameraAnimator?.isActive) this.timeSystem.rawTime()
    else this.timeSystem.lerpTime()
    let timeInfo = this.timeSystem.timeInfo
    if (!this.cameraAnimator?.isActive) {
      this.adaptiveQuality.tick(now)
      timeInfo = this.adaptiveQuality.apply(timeInfo)
    }
    ctx.timeInfo = timeInfo

    // Sun / moon / primary light blend
    ctx.skyColor = computeAtmosphereSkyColor(timeInfo)
    ctx.sunDirection = normalize([timeInfo.sunPosition.x, timeInfo.sunPosition.y, timeInfo.sunPosition.z])
    const blend = smoothstep(Math.max(0, Math.min(1, timeInfo.sunPosition.y / 0.05)))
    const inv = 1 - blend
    const sp = timeInfo.sunPosition
    const mp = timeInfo.moonPosition
    const [px, py, pz] = normalize([sp.x * blend + mp.x * inv, sp.y * blend + mp.y * inv, sp.z * blend + mp.z * inv])
    ctx.sunBlend = blend
    ctx.primaryLightDir = { x: px, y: py, z: pz }
    ctx.primaryLightStrength = blend + inv * 0.15
    ctx.fireflyFactor = computeFireflyFactor(timeInfo)

    // Idle camera drift toward init pose when not user-controlled
    if (!this.camera.locked && !this.camera.isTouching && !this.cameraAnimator?.isActive) {
      const tgt = this.cameraTarget()
      const la = ctx.lookAt
      la[0] += (tgt.x - la[0]) * 0.025
      la[1] += (tgt.y - la[1]) * 0.05
      la[2] += (tgt.z - la[2]) * 0.025
      const cp = this.camera.position
      const k = S.timeInertia
      cp[0] += (S.initPos[0] - cp[0]) * k
      cp[1] += (S.initPos[1] - cp[1]) * k
      cp[2] += (S.initPos[2] - cp[2]) * k
      cp[1] += (this.#sampleGround(cp[0], cp[2]) + S.idleY - cp[1]) * k
      this.camera.lookAtLerp(la, k)
    }

    this.camera.update(ctx.deltaTime)
    this.cameraAnimator?.update(ctx.deltaTime * MS_TO_SEC)

    // View matrices + derivatives
    ctx.viewMatrix = this.camera.getViewMatrix(timeInfo)
    ctx.invViewMatrix = invertMatrix4(ctx.viewMatrix)
    ctx.viewProjectionMatrix = multiplyMM(ctx.projectionMatrix, ctx.viewMatrix)
    ctx.invViewProjectionMatrix = multiplyMM(ctx.invViewMatrix, ctx.invProjectionMatrix)
    ctx.lightSpaceMatrix = this.#computeLightSpaceMatrix(ctx)

    this.windSystem.update(ctx.deltaTime, timeInfo)
    this.#updateGrassTileAnchors(ctx)

    const mouseRay = this.#computeMouseRay(ctx)
    this.#updateCursorWorldPos(ctx, mouseRay)
    this.#updateSunProjection(ctx)

    // Frame uniforms (group 0, shared by every pass) — the previous VP feeds
    // TAA-style reprojection, so cache the current VP for next frame.
    writeFrameUniforms(
      ctx.queue,
      this.#frameUniformBuffer,
      ctx,
      this.windSystem.uniforms,
      this.#prevViewProjection,
      this.#frameUniformData
    )
    if (ctx.viewProjectionMatrix) {
      this.#prevViewProjection ??= new Float32Array(16)
      this.#prevViewProjection.set(ctx.viewProjectionMatrix)
    }

    // Cloud shadow is re-baked every N frames.
    this.#cloudShadowThisFrame = this.#cloudShadowFrame++ % CLOUD_SHADOW_INTERVAL === 0 && !!this.#cloudShadowTexture
    if (this.#cloudShadowThisFrame) {
      writeCloudShadowUniforms(ctx.device, this.#cloudShadowUniformBuffer, ctx, this.windSystem.uniforms)
    }

    // Expensive CPU ray marches — throttled.
    if (this.#lightingFrame++ % LIGHTING_INTERVAL === 0) {
      const visibility = computeSunVisibility(ctx.primaryLightDir, ctx.cameraPosition, this.#mountainHeightmap)
      const yFade = Math.max(0, Math.min(1, ctx.primaryLightDir.y / 0.1))
      ctx.mountainVisibility = visibility * yFade * ctx.primaryLightStrength
      this.#cloudSunOcclusion = computeCloudLightOcclusion(
        ctx,
        this.#noiseData,
        this.windSystem.uniforms,
        this.#cloudSunOcclusion
      )
      ctx.cloudLightOcclusion = this.#cloudSunOcclusion
    }

    // Per-subsystem uniform writes
    this.#writeGrassUniforms(ctx, timeInfo)
    if (this.boidsSystem && this.#birdBuffers) {
      this.boidsSystem.update(ctx.deltaTime, ctx.cameraPosition, ctx.lookAt, timeInfo, mouseRay)
      updateBirdInstances(ctx.queue, this.#birdBuffers, this.boidsSystem)
      this.#writeBirdUniforms(ctx, timeInfo)
    }
    this.#writeDeferredLightingUniforms(ctx, timeInfo)
    this.#updateEffects(ctx, timeInfo)
    this.#writeSkyUniforms(ctx, timeInfo)
    this.#writeRainUniforms(ctx, timeInfo)
    this.#writeGodRayUniforms(ctx, timeInfo)
    this.#writeFogUniforms(ctx, timeInfo)
    this.#writePostProcessUniforms(ctx, timeInfo)

    // Acquire canvas texture. On iOS presentation can transiently fail — bail and retry.
    let canvasTexture
    try {
      canvasTexture = ctx.canvasCtx.getCurrentTexture()
    } catch {
      if (this.#visible) this.animationFrameId = requestAnimationFrame(this.#renderCB)
      return
    }

    if (this.#grassBuffers) this.#grassTileWorker.flush(ctx.queue, this.#grassBuffers)

    withErrorScopes(ctx.device, "frame", () => this.#encodeFrame(ctx, timeInfo, canvasTexture))

    if (S.isMobile && ctx.queue.onSubmittedWorkDone) {
      this.#gpuFramePending = true
      ctx.queue.onSubmittedWorkDone().finally(() => {
        this.#gpuFramePending = false
      })
    }
    if (this.#capturePending) {
      this.#capturePending = false
      ctx.queue.onSubmittedWorkDone().then(() => this.#doCapture())
    }

    this.animationFrameId = this.#visible && !hasError() ? requestAnimationFrame(this.#renderCB) : null
  }

  #updateEffects(ctx, timeInfo) {
    const eff = this.effectsSystem
    if (!eff) return
    eff.update(ctx.deltaTime, ctx.cameraPosition)
    this.#writeFireflyUniforms(ctx, timeInfo)
    if (this.#particleBuffers && eff.particlePositions) {
      ctx.queue.writeBuffer(this.#particleBuffers.positions, 0, eff.particlePositions)
      ctx.queue.writeBuffer(this.#particleBuffers.lives, 0, eff.particleLives)
    }
    if (this.#fireflyBuffers && eff.fireflyPositions) {
      ctx.queue.writeBuffer(this.#fireflyBuffers.positions, 0, eff.fireflyPositions)
      ctx.queue.writeBuffer(this.#fireflyBuffers.brightness, 0, eff.fireflyBrightness)
    }
  }

  #encodeFrame(ctx, timeInfo, canvasTexture) {
    const encoder = ctx.device.createCommandEncoder()

    if (this.#cloudShadowThisFrame) {
      recordCloudShadowBake(
        encoder,
        this.#pipelines.cloudShadowBake,
        this.#fullscreenQuad,
        this.#cloudShadowBindGroup,
        this.#cloudShadowTextureView
      )
    }

    withErrorScopes(ctx.device, "shadow", () => this.#renderShadowPass(encoder, ctx))
    withErrorScopes(ctx.device, "gbuffer", () => this.#renderGBufferPass(encoder, ctx))
    withErrorScopes(ctx.device, "scene", () => this.#renderScenePass(encoder, ctx, timeInfo))

    if (isActive(timeInfo.ssaoIntensity)) {
      withErrorScopes(ctx.device, "ssao", () => this.#renderSSAOPass(encoder, ctx))
    }
    if (isActive(timeInfo.bloomIntensity) && !isNight(timeInfo)) {
      withErrorScopes(ctx.device, "bloom", () => this.#renderBloomPass(encoder, ctx, timeInfo))
    }
    if (isActive(timeInfo.godRayIntensity)) {
      withErrorScopes(ctx.device, "godrays", () => this.#renderGodRaysPass(encoder, ctx, timeInfo))
    }

    if (this.#renderTargets && this.#postprocessBg) {
      withErrorScopes(ctx.device, "postprocess", () => this.#renderPostProcessPass(encoder, canvasTexture.createView()))
    } else {
      // Fallback: clear to a sky-tinted color if post-process isn't ready.
      const sunY = Math.max(0, timeInfo.sunPosition.y)
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: canvasTexture.createView(),
              clearValue: { r: 0.15 + sunY * 0.35, g: 0.2 + sunY * 0.4, b: 0.3 + sunY * 0.55, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        })
        .end()
    }

    try {
      ctx.queue.submit([encoder.finish()])
    } catch (error) {
      reportError("submit", error)
    }
  }

  requestCapture() {
    this.#capturePending = true
  }

  #doCapture() {
    this.canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")
      a.href = url
      a.download = `je2050-${ts}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, "image/png")
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.camera.destroy()
    this.#gpu.destroy()
  }
}
