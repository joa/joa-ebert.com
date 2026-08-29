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
import { computeAtmosphereSkyColorInto, preethamPrecomputeInto } from "../shared/atmo.js"
export { PATH }
import {
  perspectiveMatrixWebGPU,
  invertMatrix4,
  invertMatrix4Into,
  normalizeInto,
  smoothstep,
  lookAtMatrixInto,
  orthographicMatrixWebGPUInto,
  multiplyMM,
  multiplyMMInto,
  multiplyMV,
  multiplyMVInto,
} from "../shared/math-utils.js"
import S from "../shared/settings.js"
import moonPhase from "../shared/moon.js"
import {
  AREA_SIZE,
  BLOOM_LEVELS,
  SHADOWMAP_SIZE,
  TILE_SIZE,
  UniformBuffer,
  initFullscreenQuad,
  initNoiseTextureAsync,
  initWindNoiseTexture,
  initGrassBuffers,
  initFlowerBuffers,
  initGroundBuffers,
  initBirdBuffers,
  initTextBuffers,
  initBikeBuffers,
  initRainBuffers,
  initParticleBuffers,
  initFireflyBuffers,
  initFlyBuffers,
  initBeeBuffers,
  createMountainHeightmap,
  createGroundHeightmap,
  createCloudShadowTexture,
  createShadowMap,
  createRenderTargets,
  destroyRenderTargets,
} from "./gpu-buffers.js"
import { GPUHeightmap, GrassTileWorker, writeFrameUniforms, updateBirdInstances } from "./gpu-updates.js"
import { UNIFORM_BYTES, BLOOM_MIP_UNIFORM_BYTES } from "./uniform-catalog.js"
import { GpuProfiler } from "./gpu-profiler.js"
import { GrassCuller } from "./grass-culler.js"
import { FlowerField } from "../shared/flower-field.js"
import { createAllPipelines, createBindGroup } from "./gpu-pipelines.js"
import { loadActiveModules } from "./events/event-manager.js"
import {
  bakeOnce,
  recordBake,
  writeCloudShadowUniforms,
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
// Extends the shadow frustum's near-to-light bound so overhead casters (the bird
// flock, up to ~35 wu altitude) fall inside the ortho volume instead of being
// clipped by the near plane. A flat world-unit margin is a safe upper bound: the
// actual light-space offset of a caster at height h is h * sun.y ≤ h.
const OVERHEAD_CASTER_WU = 40
const SUN_PROJECTION_WU = 1000
const CLOUD_SHADOW_INTERVAL = S.lowSpec ? 15 : 7
const LIGHTING_INTERVAL = S.lowSpec ? 13 : 4
// Upper bound on how fast the CPU sim systems (wind, boids, effects) may run
// when the day is fast-forwarded. The intro compresses ~24h into ~10s, so the
// raw time scale peaks in the thousands — feeding that into the explicit-Euler
// integrators would step positions kilometres per frame and blow them up. This
// cap keeps a single step stable while still reading as a visibly racing flock.
const MAX_SIM_TIME_SCALE = 20
const FIREFLY_SLOTS = 32

const CLEAR_TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 })
const CLEAR_BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 })
const CLEAR_FAR_DEPTH = Object.freeze({ r: 1, g: 0, b: 0, a: 0 })
const CLEAR_WHITE = Object.freeze({ r: 1, g: 1, b: 1, a: 1 })

// Uniform slots that never change after init. Sizes and byte layouts live in
// uniform-catalog.js.
const UNIFORM_SEED = {
  shadow: [0.3], // alphaThreshold
  grass: [1.0, 1.0, 0.3], // heightFactor, widthFactor, alphaThreshold
  flower: [0.6, 0.5, 1.0], // sway, alphaThreshold, heightFactor
  bird: [0.05, 0.05, 0.07, 0.6, 3.0, 0.4], // colour, then wing amplitude/beat/scale defaults
  ssao: [16.0, 0.05, 1.0], // radius, bias, temporalAlpha
  bloomExtract: [0.8], // threshold
  // colour.rgb, opacity, sizeScale, kind, ambient, baseOpacity. Opacity and
  // ambient are written per frame; the trailing slot keeps the base opacity
  // (the shader ignores it — it maps to struct padding).
  fly: [0.06, 0.05, 0.05, 0.85, 95.0, 0.0, 1.0, 0.85],
  bee: [0.85, 0.6, 0.14, 0.95, 110.0, 1.0, 1.0, 0.95],
}

const COMPACT_OVERRIDES = Object.freeze({
  rain: 0,
  cloudSteps: 0,
  cloudShadowSteps: 0,
  cloudCoverage: 1,
  godRaySteps: 16,
  chromaticAberration: 0.002,
  grassWidthFactor: 0.8,
  overcast: 0,
  turbidity: 2.5 + 0.5 * (Math.random() - 0.5),
  fogSteps: 0,
  fogDensity: 0,
  fogHeightFalloff: 0,
  fogIntensity: 0,
  fogQuality: 0,
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

const parseDebugMode = () => {
  if (typeof window === "undefined") return 0
  return parseInt(new URLSearchParams(window.location.search).get("dbg") ?? "0", 10) || 0
}

// Night presence in [0,1]: full from 18:30 to 06:00 with 30-minute fades either
// side. Fireflies follow it; daytime insects follow its complement (smoothstep
// is symmetric about (0.5, 0.5), so the two always sum to 1).
const nightFactor = timeOfDay => {
  if (timeOfDay >= 18.5 || timeOfDay < 6.0) return 1
  if (timeOfDay >= 18.0) return smoothstep((timeOfDay - 18.0) * 2.0)
  if (timeOfDay < 6.5) return smoothstep(1 - (timeOfDay - 6.0) * 2.0)
  return 0
}

const isNight = timeInfo => {
  const t = timeInfo.timeOfDay ?? 12
  return t >= 18.5 || t < 6
}

const isActive = (value, threshold = 0.01) => (value ?? 0) >= threshold

const compactHourForDark = dark => (dark ? 3 : 9.5)

const withView = texture => ({ texture, view: texture.createView() })

const colorAttachment = (view, clearValue = CLEAR_BLACK, loadOp = "clear") => ({
  view,
  clearValue,
  loadOp,
  storeOp: "store",
})

const clearedDepth = view => ({ view, depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" })

const setStreams = (pass, streams) => {
  for (let slot = 0; slot < streams.length; slot++) pass.setVertexBuffer(slot, streams[slot])
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
  #profiler = null

  // GPU resources — all keyed by name
  // ################################
  #pipelines = null
  #layouts = null
  #uniforms = {} // name → UniformBuffer (bloomDown/bloomUp hold arrays)
  #bg = {} // name → GPUBindGroup (SSAO ping-pong and bloom chains hold arrays)
  #geo = {} // name → geometry buffers ({ streams, indices, … })
  #tex = {} // name → { texture, view }
  #renderTargets = null
  #bloomUpTargets = null
  #fullscreenQuad = null

  // Host-side scratch — the render loop must not allocate.
  // ####################################################
  #sunScreenRaw = [0, 0]
  #sunScreenPos = [0, 0]
  #prevViewProjection = null
  #invView = new Float32Array(16)
  #viewProj = new Float32Array(16)
  #invViewProj = new Float32Array(16)
  #lightView = new Float32Array(16)
  #lightOrtho = new Float32Array(16)
  #lightSpace = new Float32Array(16)
  #cornerView = new Float32Array(4)
  #cornerLight = new Float32Array(4)
  #rayView = new Float32Array(4)
  #rayWorld = new Float32Array(4)
  #sunClip = new Float32Array(4)
  #primaryDir = new Float32Array(3)
  #mouseRay = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 }

  // Temporal / throttling state
  // ###########################
  #lightingFrame = 0
  #ssaoFrame = 0
  #cloudShadowFrame = 0
  #cloudShadowThisFrame = false
  #cloudSunOcclusion = 1.0
  #textModelMatrix = null
  // World-space head/tail light sources, derived once from the bike transform.
  // Each entry: { pos, color, dir, cone, reachScale, intensity }.
  #bikeLights = []
  #tileBaseX = Number.NaN
  #tileBaseZ = Number.NaN
  #grassTileWorker = new GrassTileWorker()
  #flowerField = null
  #mountainHeightmap = new GPUHeightmap(S.lowSpec ? 1024 : 2048, 20000)
  #groundHeightmap = new GPUHeightmap(512, 80)
  #noiseData = null

  // Grass frustum culling — one culler per clip volume (camera and shadow light)
  #viewCuller = new GrassCuller()
  #shadowCuller = new GrassCuller()
  #grassCullingEnabled = false
  // Reused cull refinement options — the render loop must not allocate. The
  // shadow volume gets no LOD split (lodDistanceWu 0), only the dedup flag.
  #viewCullOpts = { camX: 0, camZ: 0, lodDistanceWu: 0, dedup: true }
  #shadowCullOpts = { camX: 0, camZ: 0, lodDistanceWu: 0, dedup: true }

  // Calendar event modules — populated in init(), empty outside active date ranges
  #eventModules = []

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
    for (const [key, value] of Object.entries(COMPACT_OVERRIDES)) this.timeSystem.setOverride(key, value)
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

  // Initialization
  // ##############

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

    const noisePromise = initNoiseTextureAsync(gpu)
    const textPromise = initTextBuffers(gpu)
    const bikePromise = initBikeBuffers(gpu)

    if (S.perfHud) this.#profiler = new GpuProfiler(gpu.device)

    this.#resize()
    let resizeTimer = null
    new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => this.#resize(), 150)
    }).observe(this.canvas)

    const { pipelines, layouts } = createAllPipelines(gpu.device, gpu.presentationFormat)
    this.#pipelines = pipelines
    this.#layouts = layouts

    this.#fullscreenQuad = initFullscreenQuad(gpu)
    this.#createUniforms()

    const noise = await noisePromise
    this.#noiseData = noise.data
    this.#tex.noise = withView(noise.texture)
    this.#tex.windNoise = withView(initWindNoiseTexture(gpu))
    this.#tex.shadowMap = withView(createShadowMap(gpu))
    this.#tex.cloudShadow = withView(createCloudShadowTexture(gpu))
    this.#tex.mountainHeightmap = withView(createMountainHeightmap(gpu))
    this.#tex.groundHeightmap = withView(createGroundHeightmap(gpu))

    this.#geo.grass = initGrassBuffers(gpu)
    this.#geo.flower = initFlowerBuffers(gpu)
    this.#geo.ground = initGroundBuffers(gpu)
    this.#geo.bird = initBirdBuffers(gpu)

    this.#createStaticBindGroups()

    // One-time heightmap bakes + CPU readback (async — samples available after await)
    bakeOnce(gpu.device, pipelines.mountainBake, this.#tex.mountainHeightmap.texture, this.#fullscreenQuad, this.#bg.empty) // prettier-ignore
    bakeOnce(gpu.device, pipelines.groundBake, this.#tex.groundHeightmap.texture, this.#fullscreenQuad, this.#bg.empty)
    await Promise.all([
      this.#mountainHeightmap.readback(gpu.device, this.#tex.mountainHeightmap.texture),
      this.#groundHeightmap.readback(gpu.device, this.#tex.groundHeightmap.texture),
    ])
    this.#grassTileWorker.setHeightmap(this.#groundHeightmap.data, 512, 80)

    this.#flowerField = new FlowerField((x, z) => this.#sampleGround(x, z))
    this.#flowerField.update(ctx.cameraPosition[0], ctx.cameraPosition[2])
    gpu.queue.writeBuffer(this.#geo.flower.instances, 0, this.#flowerField.data)

    this.#textModelMatrix = this.#computeTextModelMatrix()
    textPromise
      .then(mesh => {
        if (!mesh) return
        mesh.modelMatrix = this.#textModelMatrix
        this.#geo.text = mesh
        this.#uniforms.textObject.set(mesh.modelMatrix).write()
      })
      .catch(error => reportError("text-load", error))
    bikePromise
      .then(mesh => {
        if (!mesh) return
        this.#geo.bike = mesh
        mesh.modelMatrix = this.#computeBikeModelMatrix()
        if (!mesh.modelMatrix) return
        this.#uniforms.bikeObject.set(mesh.modelMatrix).write()
        this.#bikeLights = this.#computeBikeLights(mesh.modelMatrix)
      })
      .catch(error => reportError("bike-load", error))

    this.effectsSystem = new EffectsSystem()
    this.#geo.rain = initRainBuffers(gpu, this.effectsSystem)
    this.#geo.particle = initParticleBuffers(gpu, this.effectsSystem)
    this.#geo.firefly = initFireflyBuffers(gpu, this.effectsSystem)
    this.#geo.fly = initFlyBuffers(gpu, this.effectsSystem)
    this.#geo.bee = initBeeBuffers(gpu, this.effectsSystem)

    this.#renderTargets = createRenderTargets(gpu, ctx.width, ctx.height)
    this.#createScreenBindGroups()
    this.#clearPostProcessTargets()

    this.#eventModules = await loadActiveModules(gpu, {
      device: gpu.device,
      frameBindGroupLayout: layouts.frame,
      objectBindGroupLayout: layouts.object,
      emptyBindGroupLayout: layouts.empty,
      gBufferFormats: ["rgba8unorm", "rgba8unorm", "rgba8unorm"],
      depthFormat: "depth24plus",
      shadowDepthFormat: "depth32float",
    })

    this.cameraAnimator = new CameraAnimator(
      this.camera,
      () => this.#grassTileWorker.dispatch(this.#geo.grass, ctx.cameraPosition),
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

  #createUniforms() {
    const gpu = this.#gpu
    for (const [name, byteSize] of Object.entries(UNIFORM_BYTES)) {
      const uniforms = new UniformBuffer(gpu, name, byteSize)
      const seed = UNIFORM_SEED[name]
      if (seed) uniforms.set(seed).write()
      this.#uniforms[name] = uniforms
    }
    // Bloom mips each need their own half-texel size, so they get one buffer per level.
    const mipUniforms = () => Array.from({ length: BLOOM_LEVELS }, (unused, i) => new UniformBuffer(gpu, `bloom${i}`, BLOOM_MIP_UNIFORM_BYTES)) // prettier-ignore
    this.#uniforms.bloomDown = mipUniforms()
    this.#uniforms.bloomUp = mipUniforms()
  }

  // Binds a named bind group, defaulting to the pass layout of the same name.
  // Resources are listed in binding order.
  #binder() {
    return (name, resources, layout = name) =>
      (this.#bg[name] = createBindGroup(this.#gpu.device, this.#layouts[layout], name, resources))
  }

  #uniform(name) {
    return { buffer: this.#uniforms[name].buffer }
  }

  // Bind groups that only reference resources living for the whole session.
  #createStaticBindGroups() {
    const gpu = this.#gpu
    const uniform = name => this.#uniform(name)
    const bind = this.#binder()

    bind("empty", [])
    bind("frame", [uniform("frame")])
    bind("textObject", [uniform("textObject")], "object")
    bind("bikeObject", [uniform("bikeObject")], "object")
    bind("cloudShadowBake", [uniform("cloudShadow")])
    for (const name of ["grass", "flower", "shadow"]) {
      bind(name, [uniform(name), this.#tex.windNoise.view, gpu.linearRepeat])
    }
    bind("ground", [this.#tex.groundHeightmap.view, gpu.linearClamp])
    bind("sky", [uniform("sky"), this.#tex.mountainHeightmap.view, gpu.linearClamp, this.#tex.noise.view, gpu.linearRepeat]) // prettier-ignore
    for (const name of ["bird", "rain", "particle", "fireflySprite"]) bind(name, [uniform(name)])
    bind("fly", [uniform("fly")], "insect")
    bind("bee", [uniform("bee")], "insect")
  }

  // Bind groups that reference screen-size render targets — rebuilt on resize.
  #createScreenBindGroups() {
    const gpu = this.#gpu
    const ctx = this.#ctx
    const rt = this.#renderTargets
    if (!rt || !ctx.depthView) return

    const uniform = name => this.#uniform(name)
    const bind = this.#binder()
    const linear = gpu.linearClamp
    const nearest = gpu.nearestClamp
    const gBuffer = [rt.gAlbedo.view, nearest, rt.gNormal.view, nearest, rt.gDepth.view, nearest]

    bind("deferredLighting", [
      uniform("deferredLighting"),
      rt.gAlbedo.view,
      rt.gNormal.view,
      rt.gDepth.view,
      this.#tex.shadowMap.view,
      this.#tex.cloudShadow.view,
      gpu.depthSampler,
    ])
    bind("fireflyLights", [uniform("fireflyLights"), ...gBuffer])
    bind("bikeLights", [uniform("bikeLights"), ...gBuffer])

    // SSAO ping-pong: index 0 reads ssaoPrev → writes ssao; index 1 the reverse.
    this.#bg.ssao = [rt.ssaoPrev, rt.ssao].map(history =>
      createBindGroup(gpu.device, this.#layouts.ssao, "ssao", [
        uniform("ssao"),
        ctx.depthView,
        nearest,
        rt.gAlbedo.view,
        nearest,
        history.view,
        linear,
      ])
    )
    this.#bg.ssaoBlur = rt.ssaoBlur
      ? [rt.ssao, rt.ssaoPrev].map(source =>
          createBindGroup(gpu.device, this.#layouts.ssaoBlur, "ssao blur", [source.view, linear, ctx.depthView])
        )
      : null

    // Bloom: extract from the scene, downsample the mip chain, then additively
    // upsample back through it. Each step's half-texel depends on its source mip.
    const bloomStep = (layout, uniforms, source) => {
      uniforms.f[0] = 0.5 / source.width
      uniforms.f[1] = 0.5 / source.height
      uniforms.write()
      return createBindGroup(gpu.device, layout, "bloom", [{ buffer: uniforms.buffer }, linear, source.view])
    }
    bind("bloomExtract", [uniform("bloomExtract"), linear, rt.sceneTexture.view])
    const downSources = [rt.bloomExtract, ...rt.bloomMips.slice(0, BLOOM_LEVELS - 1)]
    const upSources = rt.bloomMips.slice(0, BLOOM_LEVELS).reverse()
    this.#bg.bloomDown = downSources.map((src, i) => bloomStep(this.#layouts.bloomDown, this.#uniforms.bloomDown[i], src)) // prettier-ignore
    this.#bg.bloomUp = upSources.map((src, i) => bloomStep(this.#layouts.bloomUp, this.#uniforms.bloomUp[i], src))
    this.#bloomUpTargets = [...rt.bloomMips.slice(0, BLOOM_LEVELS - 1).reverse(), rt.bloomExtract]

    bind("godrays", [
      uniform("godRay"),
      rt.sceneTexture.view,
      ctx.depthView,
      this.#tex.shadowMap.view,
      this.#tex.cloudShadow.view,
      linear,
      gpu.depthSampler,
    ])

    // DoF: the CoC pass reads the full-res scene + depth into dofDown, the blur
    // pass gathers dofDown into dofBlur. Both bind the shared dof uniform.
    const ao = S.lowSpec ? rt.ssao : rt.ssaoBlur
    bind("dofCoc", [uniform("dof"), rt.sceneTexture.view, ctx.depthSampleView, ao.view, linear, rt.gAlbedo.view])
    bind("dofBlur", [uniform("dof"), rt.dofDown.view, linear])

    bind("postprocess", [
      uniform("postprocess"),
      rt.sceneTexture.view,
      linear,
      ctx.depthView,
      nearest,
      rt.bloomExtract.view,
      linear,
      rt.godRay.view,
      linear,
      ao.view,
      linear,
      rt.gAlbedo.view,
      nearest,
      uniform("fog"),
      this.#tex.noise.view,
      gpu.linearRepeat,
      rt.dofBlur.view,
    ])
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
      destroyRenderTargets(this.#renderTargets)
      this.#renderTargets = createRenderTargets(this.#gpu, width, height)
      this.#createScreenBindGroups()
      this.#clearPostProcessTargets()
    }
  }

  // Clear post-process input textures once at init/resize so sampling reads a
  // known value before the first real write. Eliminates per-frame clear-only
  // passes — each pass boundary flushes tile memory on TBDR GPUs.
  #clearPostProcessTargets() {
    const rt = this.#renderTargets
    if (!rt) return
    const encoder = this.#ctx.device.createCommandEncoder()
    const clear = (target, clearValue) => {
      if (target) encoder.beginRenderPass({ colorAttachments: [colorAttachment(target.view, clearValue)] }).end()
    }
    clear(rt.ssao, CLEAR_WHITE)
    clear(rt.ssaoPrev, CLEAR_WHITE)
    clear(rt.ssaoBlur, CLEAR_WHITE)
    clear(rt.bloomExtract, CLEAR_BLACK)
    clear(rt.godRay, CLEAR_BLACK)
    // a=0 so a stale DoF read composites as fully-sharp before the first write.
    clear(rt.dofBlur, CLEAR_TRANSPARENT)
    this.#ctx.device.queue.submit([encoder.finish()])
    this.#ssaoFrame = 0
  }

  // Scene transforms
  // ################

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

  // Transforms a point in the text mesh's local space to world space through the
  // (column-major) text model matrix.
  #textLocalToWorld(x, y, z) {
    const m = this.#textModelMatrix
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]
  }

  #computeBikeModelMatrix() {
    if (!this.#geo.bike || !this.#textModelMatrix) return null
    const BIKE_HEIGHT_WU = 2.0
    const BIKE_LEAN_RAD = 0.16
    const BIKE_YAW_RAD = -0.4 * Math.PI
    const TEXT_X = 5.0 - 3.5
    const TEXT_Z = 0

    const { min, max } = this.#geo.bike.bbox
    const cx = (min[0] + max[0]) * 0.5 - 1.0
    const cz = (min[2] + max[2]) * 0.5
    const s = BIKE_HEIGHT_WU / (max[1] - min[1])

    const anchor = this.#textLocalToWorld(TEXT_X, 0, TEXT_Z)
    const groundY = this.#sampleGround(anchor[0], anchor[2]) - 0.2

    const cl = Math.cos(BIKE_LEAN_RAD),
      sl = Math.sin(BIKE_LEAN_RAD)
    const cyw = Math.cos(BIKE_YAW_RAD),
      syw = Math.sin(BIKE_YAW_RAD)
    const centre = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, -min[1], -cz, 1]
    const scale = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]
    const lean = [cl, sl, 0, 0, -sl, cl, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] // about +Z
    const yaw = [cyw, 0, syw, 0, 0, 1, 0, 0, -syw, 0, cyw, 0, 0, 0, 0, 1] // about +Y
    const place = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, anchor[0], groundY, anchor[2], 1]

    const oriented = multiplyMM(yaw, multiplyMM(lean, multiplyMM(scale, centre)))
    return new Float32Array(multiplyMM(place, oriented))
  }

  #computeBikeLights(modelMatrix) {
    const OMNI = 2.0
    const coneCos = deg => Math.cos((deg * Math.PI) / 180)
    const LAMPS = [
      {
        local: [0.1155, 0.714, -0.8935],
        dirLocal: [0.0, -0.42, -1.0],
        color: [0.833, 0.833, 1.0],
        cone: coneCos(32),
        reachScale: 2.75,
        intensity: 5.5,
      },
      {
        local: [0.0, 0.6045, 0.5715],
        dirLocal: null,
        color: [1.0, 0.05, 0.02],
        cone: OMNI,
        reachScale: 1.0,
        intensity: 1.0,
      },
    ]
    return LAMPS.map(({ local, dirLocal, ...lamp }) => {
      const world = multiplyMV(modelMatrix, [...local, 1])
      let dir = [0, 0, 0]
      if (dirLocal) {
        const d = multiplyMV(modelMatrix, [...dirLocal, 0]) // rotate the beam axis into world space (w=0)
        const len = Math.hypot(d[0], d[1], d[2]) || 1
        dir = [d[0] / len, d[1] / len, d[2] / len]
      }
      return { ...lamp, pos: [world[0], world[1], world[2]], dir }
    })
  }

  // Per-frame CPU updates
  // #####################

  // Orthographic frustum fitted to the camera's near-side frustum corners
  // projected into light space, texel-snapped to prevent shadow shimmer.
  // Returns null when the sun is below the horizon (no shadows at night).
  #computeLightSpaceMatrix(ctx) {
    const sun = ctx.sunDirection
    if (sun[1] <= 0.05) return null
    const [cx, cy, cz] = ctx.cameraPosition
    const lightDist = 80
    const nearVertical = Math.abs(sun[1]) > 0.98
    const lightView = lookAtMatrixInto(
      this.#lightView,
      cx + sun[0] * lightDist,
      cy + sun[1] * lightDist,
      cz + sun[2] * lightDist,
      cx,
      0,
      cz,
      nearVertical ? 1 : 0,
      nearVertical ? 0 : 1,
      0
    )

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
      const cv = multiplyMVInto(this.#cornerView, ctx.invViewMatrix, sX * w, sY * h, -z, 1)
      const lc = multiplyMVInto(this.#cornerLight, lightView, cv[0], cv[1], cv[2], cv[3])
      if (lc[0] < minX) minX = lc[0]
      if (lc[0] > maxX) maxX = lc[0]
      if (lc[1] < minY) minY = lc[1]
      if (lc[1] > maxY) maxY = lc[1]
      if (lc[2] < minZ) minZ = lc[2]
      if (lc[2] > maxZ) maxZ = lc[2]
    }
    maxZ += OVERHEAD_CASTER_WU
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
    return multiplyMMInto(
      this.#lightSpace,
      orthographicMatrixWebGPUInto(this.#lightOrtho, minX, maxX, minY, maxY, near, far),
      lightView
    )
  }

  #sampleGround(x, z) {
    return this.#groundHeightmap.ready ? this.#groundHeightmap.sampleBilinear(x, z, 1) : 0
  }

  // Mouse ray in world space (reused object), or null if view matrices aren't ready.
  #computeMouseRay(ctx) {
    if (!ctx.invProjectionMatrix || !ctx.invViewMatrix) return null
    const [ndcX, ndcY] = this.#mouseNDC
    const farView = multiplyMVInto(this.#rayView, ctx.invProjectionMatrix, ndcX, ndcY, 1, 1)
    const invW = 1 / farView[3]
    const farWorld = multiplyMVInto(
      this.#rayWorld,
      ctx.invViewMatrix,
      farView[0] * invW,
      farView[1] * invW,
      farView[2] * invW,
      1
    )
    const [ox, oy, oz] = ctx.cameraPosition
    const dx = farWorld[0] - ox,
      dy = farWorld[1] - oy,
      dz = farWorld[2] - oz
    const invLen = 1 / (Math.hypot(dx, dy, dz) || 1)
    const ray = this.#mouseRay
    ray.ox = ox
    ray.oy = oy
    ray.oz = oz
    ray.dx = dx * invLen
    ray.dy = dy * invLen
    ray.dz = dz * invLen
    return ray
  }

  // Project the sun into screen space. sunScreenRaw is used by god rays (no
  // behind-camera guard, matching prior behavior). sunScreenPos uses sentinel
  // (2, 2) when the sun is behind the camera so post-process can reject it.
  #updateSunProjection(ctx) {
    const [ex, ey, ez] = ctx.cameraPosition
    const [sx, sy, sz] = ctx.sunDirection
    const d = SUN_PROJECTION_WU
    const clip = multiplyMVInto(this.#sunClip, ctx.viewProjectionMatrix, ex + sx * d, ey + sy * d, ez + sz * d, 1)
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

  // Grass fields re-tile when the camera crosses a tile boundary. Both layers'
  // anchors derive from the base tile coordinate, so tracking it is enough.
  #updateGrassTileAnchors(ctx) {
    const cp = ctx.cameraPosition
    const baseX = Math.floor(cp[0] / TILE_SIZE)
    const baseZ = Math.floor(cp[2] / TILE_SIZE)
    if (baseX === this.#tileBaseX && baseZ === this.#tileBaseZ) return
    this.#tileBaseX = baseX
    this.#tileBaseZ = baseZ
    this.#grassTileWorker.dispatch(this.#geo.grass, cp)
  }

  // Uniform writers — each fills its staging buffer and submits it
  // #############################################################

  #writeGrassUniforms(timeInfo) {
    const { f } = this.#uniforms.grass
    f[0] = timeInfo.grassHeightFactor ?? 1.0
    f[1] = timeInfo.grassWidthFactor ?? 1.0
    f[3] = timeInfo.dewAmount ?? 0.0
    this.#uniforms.grass.write()
  }

  #writeFlowerUniforms(timeInfo) {
    const { f } = this.#uniforms.flower
    f[0] = timeInfo.flowerSway ?? 0.6
    f[1] = timeInfo.flowerAlpha ?? 0.5
    f[2] = timeInfo.grassHeightFactor ?? 1.0
    this.#uniforms.flower.write()
  }

  #writeBirdUniforms(timeInfo) {
    const { f } = this.#uniforms.bird
    f[3] = timeInfo.birdWingAmplitude ?? 0.41
    f[4] = timeInfo.birdWingBeat ?? 0.09
    f[5] = timeInfo.birdScale ?? 0.6
    this.#uniforms.bird.write()
  }

  #writeDeferredLightingUniforms(ctx, timeInfo) {
    const sunElev = Math.max(0, Math.min(1, timeInfo.sunPosition.y / 0.1))
    const moonElev = Math.max(0, Math.min(1, timeInfo.moonPosition.y / 0.15)) * (1 - sunElev)
    const sky = ctx.skyColor
    const { f } = this.#uniforms.deferredLighting
    f[0] = sky.r
    f[1] = sky.g
    f[2] = sky.b
    f[3] = timeInfo.ambientIntensity
    f[4] = timeInfo.colorTemperature
    f[5] = ctx.lightSpaceMatrix ? 1 : 0
    f[6] = ctx.mountainVisibility
    f[7] = moonElev
    f[8] = timeInfo.sparkleEnabled ?? 1
    f[9] = timeInfo.sparkleIntensity ?? 1
    f[10] = timeInfo.sparkleDensity ?? 8
    f[11] = timeInfo.sparkleSharpness ?? 2
    f[12] = timeInfo.sparkleSpeed ?? 1
    f[13] = ctx.cloudLightOcclusion
    f[14] = this.controlsUI?.debugMode ?? this.#debugMode
    f[15] = timeInfo.emissiveIntensity ?? 2.5
    this.#uniforms.deferredLighting.write()
  }

  // Pack 32 × vec4f (xyz + brightness·factor) into `f` starting at floatBase.
  #packFireflyArray(f, floatBase, factor) {
    const eff = this.effectsSystem
    const pos = eff?.fireflyPositions
    const brightness = eff?.fireflyBrightness
    for (let i = 0; i < FIREFLY_SLOTS; i++) {
      const o = floatBase + i * 4
      const p = i * 3
      f[o] = pos ? pos[p] : 0
      f[o + 1] = pos ? pos[p + 1] : 0
      f[o + 2] = pos ? pos[p + 2] : 0
      f[o + 3] = brightness ? brightness[i] * factor : 0
    }
  }

  #writeFireflyUniforms(ctx, timeInfo) {
    const eff = this.effectsSystem
    if (!eff) return
    const factor = ctx.fireflyFactor
    const uniforms = this.#uniforms.fireflyLights
    const { f, dv } = uniforms
    dv.setUint32(0, factor > 0 ? (eff.fireflyCount ?? 0) : 0, true)
    f[1] = factor
    f[2] = timeInfo.fireflyLightRadius
    f[3] = 0
    this.#packFireflyArray(f, 4, factor)
    uniforms.write()
  }

  #writeBikeLightUniforms(timeInfo) {
    const uniforms = this.#uniforms.bikeLights
    const { f, dv } = uniforms
    const master = timeInfo.bikeLightCast ?? 1.0
    const radius = timeInfo.bikeLightCastRadius ?? 4.0
    dv.setUint32(0, master > 0 ? this.#bikeLights.length : 0, true)
    f[1] = master // master multiplier; reach and colour intensity are per-lamp
    f[2] = 0
    f[3] = 0
    for (let i = 0; i < this.#bikeLights.length; i++) {
      const { pos, color, dir, cone, reachScale, intensity } = this.#bikeLights[i]
      const p = 4 + i * 4
      f[p] = pos[0]
      f[p + 1] = pos[1]
      f[p + 2] = pos[2]
      f[p + 3] = radius * reachScale
      const c = 12 + i * 4
      f[c] = color[0]
      f[c + 1] = color[1]
      f[c + 2] = color[2]
      f[c + 3] = intensity
      const d = 20 + i * 4
      f[d] = dir[0]
      f[d + 1] = dir[1]
      f[d + 2] = dir[2]
      f[d + 3] = cone // cos(cone half-angle); > 1 = omnidirectional
    }
    uniforms.write()
  }

  #writeSkyUniforms(ctx, timeInfo) {
    const rain = timeInfo.rain
    const dim = 1 - rain * 0.25
    const { r: zr, g: zg, b: zb } = timeInfo.zenithColor
    const { r: hr, g: hg, b: hb } = timeInfo.horizonColor
    const uniforms = this.#uniforms.sky
    const { f, dv } = uniforms
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
    preethamPrecomputeInto(f, 20, f[17], ctx.sunDirection ? ctx.sunDirection[1] : 0.5)
    // mountainSteps at byte 164 (float offset 41, after the 21 Preetham floats)
    dv.setUint32(164, Math.round(timeInfo.mountainSteps ?? 64), true)
    uniforms.write()
  }

  #writeRainUniforms(timeInfo) {
    this.#uniforms.rain.f[0] = timeInfo.rain
    this.#uniforms.rain.write()
  }

  #writeGodRayUniforms(ctx, timeInfo) {
    const uniforms = this.#uniforms.godRay
    const { f, dv } = uniforms
    f[0] = this.#sunScreenRaw[0]
    f[1] = this.#sunScreenRaw[1]
    f[2] = timeInfo.godRayDecay * (ctx.mountainVisibility ?? 1) + timeInfo.rain
    f[3] = timeInfo.sunAboveHorizon ? 1 : 0
    dv.setUint32(16, Math.round(timeInfo.godRaySteps), true)
    // Low-spec disables dynamic shadow-map sampling in god rays.
    f[5] = S.lowSpec ? 0 : 1
    uniforms.write()
  }

  #writeDofUniforms(timeInfo) {
    const { f } = this.#uniforms.dof
    f[0] = NEAR
    f[1] = FAR
    f[2] = timeInfo.depthOfField
    f[3] = timeInfo.dofFocusNear
    f[4] = timeInfo.dofFocusFar
    f[5] = timeInfo.dofBlurNear
    f[6] = timeInfo.dofBlurFar
    f[7] = timeInfo.ssaoIntensity
    this.#uniforms.dof.write()
  }

  #writeFogUniforms(ctx, timeInfo) {
    const eff = this.effectsSystem
    const rain = timeInfo.rain
    const wind = this.windSystem.uniforms
    const factor = ctx.fireflyFactor
    const { r: fr, g: fg, b: fb } = timeInfo.fogColor
    const uniforms = this.#uniforms.fog
    const { f, dv } = uniforms
    f[0] = fr
    f[1] = fg
    f[2] = fb
    f[3] = timeInfo.fogDensity + rain * 0.1
    f[4] = timeInfo.fogHeightFalloff + rain * 0.1
    f[5] = timeInfo.fogIntensity + rain * 0.5
    f[6] = timeInfo.fogQuality
    dv.setUint32(28, Math.round(timeInfo.fogSteps), true)
    f[8] = wind.windDirection[0]
    f[9] = wind.windDirection[1]
    f[10] = wind.windStrength
    dv.setUint32(44, factor > 0 && eff ? (eff.fireflyCount ?? 0) : 0, true)
    f[12] = factor
    f[13] = timeInfo.fireflyLightRadius

    const head = this.#bikeLights[0]
    const beam = (timeInfo.bikeLightBeam ?? 1.0) * (timeInfo.bikeLightCast ?? 1.0)
    if (head && beam > 0) {
      f[144] = head.pos[0]
      f[145] = head.pos[1]
      f[146] = head.pos[2]
      f[147] = (timeInfo.bikeLightCastRadius ?? 4.0) * head.reachScale
      f[148] = head.color[0]
      f[149] = head.color[1]
      f[150] = head.color[2]
      f[151] = beam * 5.0 // base scatter strength; the control tunes around it
      f[152] = head.dir[0]
      f[153] = head.dir[1]
      f[154] = head.dir[2]
      f[155] = head.cone
    } else {
      f[147] = 0 // reach = 0 disables the beam in the shader
    }

    // The 32 firefly lights sit between the two blocks; skip them when unlit.
    if (factor > 0) {
      this.#packFireflyArray(f, 16, factor)
      uniforms.write()
    } else {
      uniforms.write(0, 64)
      uniforms.write(576, 48)
    }
  }

  #writePostProcessUniforms(ctx, timeInfo) {
    const rain = timeInfo.rain
    const [sunX, sunY] = this.#sunScreenPos
    const { r: fr, g: fg, b: fb } = timeInfo.fogColor
    const [lr, lg, lb] = timeInfo.cgLift
    const skipBloom = !isActive(timeInfo.bloomIntensity) || isNight(timeInfo)
    const { f } = this.#uniforms.postprocess
    f[0] = fr
    f[1] = fg
    f[2] = fb
    f[3] = timeInfo.depthOfField
    f[4] = lr
    f[5] = lg
    f[6] = lb
    f[7] = S.lowSpec ? 0 : 1
    f[8] = sunX
    f[9] = sunY
    f[10] = timeInfo.dofFocusNear
    f[11] = timeInfo.dofFocusFar
    f[12] = timeInfo.dofBlurNear
    f[13] = timeInfo.dofBlurFar
    // Zero intensity for skipped passes so post-process doesn't sample stale texels.
    f[14] = skipBloom ? 0 : timeInfo.bloomIntensity
    f[15] = isActive(timeInfo.godRayIntensity) ? timeInfo.godRayIntensity + rain * 0.5 : 0
    f[16] = isActive(timeInfo.ssaoIntensity) ? timeInfo.ssaoIntensity : 0
    f[17] = timeInfo.chromaticAberration
    f[18] = timeInfo.cgExposure - rain * 0.25
    f[19] = timeInfo.cgContrast - rain * 0.125
    f[20] = timeInfo.cgSaturation - rain * 0.4
    f[21] = (timeInfo.lensFlareIntensity ?? 0.6) * (ctx.cloudLightOcclusion ?? 1) * (ctx.mountainVisibility ?? 1)
    f[22] = timeInfo.grainStrength
    f[23] = timeInfo.vignetteStrength
    f[24] = rain
    f[25] = timeInfo.rainbowIntensity
    f[28] = this.#bikeLights.length
    f[29] = timeInfo.bikeLightGlow ?? 1.0
    f[30] = timeInfo.bikeLightFlare ?? 1.0
    for (let i = 0; i < this.#bikeLights.length; i++) {
      const { pos, color } = this.#bikeLights[i]
      const p = 32 + i * 4
      f[p] = pos[0]
      f[p + 1] = pos[1]
      f[p + 2] = pos[2]
      const c = 40 + i * 4
      f[c] = color[0]
      f[c + 1] = color[1]
      f[c + 2] = color[2]
    }
    this.#uniforms.postprocess.write()
  }

  #writeFrameUniforms(ctx, timeInfo) {
    this.#profiler?.cpuBegin("uniforms")
    this.#writeGrassUniforms(timeInfo)
    this.#writeFlowerUniforms(timeInfo)
    if (this.boidsSystem && this.#geo.bird) this.#writeBirdUniforms(timeInfo)
    this.#writeDeferredLightingUniforms(ctx, timeInfo)
    this.#writeBikeLightUniforms(timeInfo)
    this.#writeFireflyUniforms(ctx, timeInfo)
    this.#writeSkyUniforms(ctx, timeInfo)
    this.#writeRainUniforms(timeInfo)
    this.#writeGodRayUniforms(ctx, timeInfo)
    this.#writeDofUniforms(timeInfo)
    this.#writeFogUniforms(ctx, timeInfo)
    this.#writePostProcessUniforms(ctx, timeInfo)
    this.#profiler?.cpuEnd("uniforms")
  }

  // Draw helpers
  // ############

  // Instance buffers are tile-contiguous, so a run of visible tile slots maps to
  // one ranged drawIndexed via firstInstance. density < 1 draws a prefix of each
  // tile's blades — blades are randomly attributed within a tile, so a per-tile
  // prefix is an unbiased density cut (a per-run prefix would empty trailing tiles).
  #drawGrassRanges(pass, indexCount, bladesPerTile, ranges, rangeCount, density) {
    if (density >= 1) {
      for (let r = 0; r < rangeCount; r++) {
        pass.drawIndexed(indexCount, ranges[r * 2 + 1] * bladesPerTile, 0, 0, ranges[r * 2] * bladesPerTile)
      }
      return
    }
    const bladesDrawn = Math.max(1, Math.round(bladesPerTile * density))
    for (let r = 0; r < rangeCount; r++) {
      const firstSlot = ranges[r * 2]
      const slotRun = ranges[r * 2 + 1]
      for (let t = 0; t < slotRun; t++) {
        pass.drawIndexed(indexCount, bladesDrawn, 0, 0, (firstSlot + t) * bladesPerTile)
      }
    }
  }

  // Both grass fields. Each draw picks a blade mesh LOD: the dense near field
  // keeps the full-segment curve, while the distant layer and the shadow pass
  // use coarser strips their on-screen (or in-map) size cannot distinguish.
  // `withNoise` adds the per-blade noise stream the G-buffer pass needs; the
  // shadow pass omits it. `farDensity` further thins the distant layer's
  // beyond-LOD-distance tiles (the culler's farRanges, camera pass only).
  #drawGrass(pass, culler, withNoise, distantDensity = 1, farDensity = 1) {
    const grass = this.#geo.grass
    for (let i = 0; i < grass.layers.length; i++) {
      const layer = grass.layers[i]
      const mesh = withNoise ? (layer.distant ? grass.meshSparse : grass.meshFull) : grass.meshShadow
      pass.setVertexBuffer(0, mesh.vertices)
      pass.setVertexBuffer(1, mesh.texCoords)
      pass.setIndexBuffer(mesh.indices, "uint16")
      pass.setVertexBuffer(2, layer.dynamic)
      pass.setVertexBuffer(3, layer.attribs)
      if (withNoise) pass.setVertexBuffer(4, layer.noise)
      if (!culler) {
        pass.drawIndexed(mesh.indexCount, layer.bladeCount)
        continue
      }
      // Distant blades are sub-texel in the shadow map — adaptive quality thins
      // them via shadowGrassDensity without visible shadow change.
      const density = layer.distant ? distantDensity : 1
      const count = culler.rangeCounts[i]
      this.#drawGrassRanges(pass, mesh.indexCount, layer.bladesPerTile, culler.ranges[i], count, density)
      const farCount = culler.farRangeCounts[i]
      if (farCount > 0) {
        this.#drawGrassRanges(pass, mesh.indexCount, layer.bladesPerTile, culler.farRanges[i], farCount, density * farDensity) // prettier-ignore
      }
    }
  }

  #activeCuller(culler) {
    return this.#grassCullingEnabled ? culler : null
  }

  #drawIndexed(pass, mesh, instanceCount = 1, streams = mesh.streams) {
    setStreams(pass, streams)
    pass.setIndexBuffer(mesh.indices, mesh.indexFormat)
    pass.drawIndexed(mesh.indexCount, instanceCount)
  }

  // Text and bike: a model matrix in group 3, with groups 1–2 padded out.
  #drawObject(pass, pipeline, bindGroup, mesh, streams) {
    if (!mesh?.modelMatrix) return
    pass.setPipeline(pipeline)
    pass.setBindGroup(1, this.#bg.empty)
    pass.setBindGroup(2, this.#bg.empty)
    pass.setBindGroup(3, bindGroup)
    this.#drawIndexed(pass, mesh, 1, streams)
  }

  #drawInstanced(pass, pipeline, bindGroup, mesh, vertexCount, instanceCount) {
    pass.setPipeline(pipeline)
    pass.setBindGroup(1, bindGroup)
    setStreams(pass, mesh.streams)
    pass.draw(vertexCount, instanceCount)
  }

  // Render passes
  // #############

  #renderShadowPass(encoder, ctx) {
    if (!ctx.lightSpaceMatrix || !this.#geo.grass) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: clearedDepth(this.#tex.shadowMap.view),
      timestampWrites: this.#profiler?.pass("shadow"),
    })
    pass.setViewport(0, 0, SHADOWMAP_SIZE, SHADOWMAP_SIZE, 0, 1)
    pass.setPipeline(this.#pipelines.shadow)
    pass.setBindGroup(0, this.#bg.frame)
    pass.setBindGroup(1, this.#bg.shadow)
    this.#drawGrass(pass, this.#activeCuller(this.#shadowCuller), false, ctx.timeInfo?.shadowGrassDensity ?? 1)

    const shadowText = this.#pipelines.shadowText
    this.#drawObject(pass, shadowText, this.#bg.textObject, this.#geo.text, this.#geo.text?.shadowStreams)
    this.#drawObject(pass, shadowText, this.#bg.bikeObject, this.#geo.bike, this.#geo.bike?.shadowStreams)

    const birds = this.#geo.bird
    if (birds) this.#drawInstanced(pass, this.#pipelines.birdShadow, this.#bg.bird, birds, birds.vertexCount, birds.instanceCount) // prettier-ignore

    for (const mod of this.#eventModules) mod.renderShadow(pass, ctx)
    pass.end()
  }

  #renderGBufferPass(encoder, ctx) {
    if (!this.#renderTargets) return
    const rt = this.#renderTargets
    const pass = encoder.beginRenderPass({
      // gDepth clears to the far plane to match the depth attachment: readers
      // test it against 0.9999 to detect background.
      colorAttachments: [
        colorAttachment(rt.gAlbedo.view, CLEAR_TRANSPARENT),
        colorAttachment(rt.gNormal.view, CLEAR_TRANSPARENT),
        colorAttachment(rt.gDepth.view, CLEAR_FAR_DEPTH),
      ],
      depthStencilAttachment: clearedDepth(ctx.depthView),
      timestampWrites: this.#profiler?.pass("gbuffer"),
    })
    pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1)
    pass.setBindGroup(0, this.#bg.frame)

    if (this.#geo.grass) {
      pass.setPipeline(this.#pipelines.grass)
      pass.setBindGroup(1, this.#bg.grass)
      this.#drawGrass(pass, this.#activeCuller(this.#viewCuller), true, 1, ctx.timeInfo?.grassDistantDensity ?? 1)
    }

    const flowers = this.#geo.flower
    if (flowers) {
      pass.setPipeline(this.#pipelines.flower)
      pass.setBindGroup(1, this.#bg.flower)
      this.#drawIndexed(pass, flowers, flowers.instanceCount)
    }

    const ground = this.#geo.ground
    if (ground) {
      pass.setPipeline(this.#pipelines.ground)
      pass.setBindGroup(1, this.#bg.ground)
      this.#drawIndexed(pass, ground)
    }

    this.#drawObject(pass, this.#pipelines.text, this.#bg.textObject, this.#geo.text)
    this.#drawObject(pass, this.#pipelines.bike, this.#bg.bikeObject, this.#geo.bike)

    const birds = this.#geo.bird
    if (birds) this.#drawInstanced(pass, this.#pipelines.bird, this.#bg.bird, birds, birds.vertexCount, birds.instanceCount) // prettier-ignore

    for (const mod of this.#eventModules) mod.renderGBuffer(pass, ctx)
    pass.end()
  }

  // Deferred lighting, sky and the forward effects share one render pass. They
  // used to be two, because the lighting shader sampled the depth texture and so
  // could not have it attached for the sky's less-equal test (and iOS Safari
  // breaks on depthReadOnly: true). Reconstructing world position from gDepth
  // instead removed that conflict — worth doing because splitting the pass cost a
  // store and reload of the full-res HDR scene target every frame, which on a
  // TBDR GPU is the most expensive thing in the frame after the grass itself.
  #renderScenePass(encoder, ctx, timeInfo) {
    if (!this.#renderTargets) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment(this.#renderTargets.sceneTexture.view)],
      // SSAO, god rays and DoF all sample depth after this pass, so it must persist.
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: "load", depthStoreOp: "store" },
      timestampWrites: this.#profiler?.pass("scene"),
    })
    pass.setViewport(0, 0, ctx.width, ctx.height, 0, 1)
    pass.setBindGroup(0, this.#bg.frame)
    this.#drawDeferred(pass, ctx)
    this.#drawForward(pass, ctx, timeInfo)
    pass.end()
  }

  #drawDeferred(pass, ctx) {
    const fullscreen = (pipeline, bindGroup) => {
      pass.setPipeline(pipeline)
      pass.setBindGroup(1, bindGroup)
      pass.draw(3)
    }
    // Deferred lighting (depthCompare: always). Background pixels are left black
    // for the sky, which draws over them later in this same pass.
    fullscreen(this.#pipelines.deferredLighting, this.#bg.deferredLighting)
    // Firefly lights, then the bike's head/tail lamps — both fullscreen additive.
    const eff = this.effectsSystem
    if ((eff?.fireflyCount ?? 0) > 0 && ctx.fireflyFactor > 0) {
      fullscreen(this.#pipelines.fireflyLights, this.#bg.fireflyLights)
    }
    if (this.#bikeLights.length > 0) fullscreen(this.#pipelines.bikeLights, this.#bg.bikeLights)
  }

  #drawForward(pass, ctx, timeInfo) {
    // Sky (depthCompare: less-equal — only shades the background pixels the
    // deferred draw left black).
    pass.setPipeline(this.#pipelines.sky)
    pass.setBindGroup(1, this.#bg.sky)
    pass.draw(3)

    const eff = this.effectsSystem
    if (timeInfo.rain > 0 && this.#geo.rain) {
      this.#drawInstanced(pass, this.#pipelines.rain, this.#bg.rain, this.#geo.rain, 2, this.#geo.rain.count)
    }
    if (this.#geo.particle && eff?.particleCount) {
      this.#uniforms.particle.f[0] = timeInfo.ambientIntensity
      this.#uniforms.particle.write()
      this.#drawInstanced(pass, this.#pipelines.particle, this.#bg.particle, this.#geo.particle, 4, eff.particleCount)
    }
    if (this.#geo.firefly && eff?.fireflyCount && ctx.fireflyFactor > 0) {
      this.#uniforms.fireflySprite.f[0] = ctx.fireflyFactor
      this.#uniforms.fireflySprite.write()
      this.#drawInstanced(pass, this.#pipelines.fireflySprite, this.#bg.fireflySprite, this.#geo.firefly, 4, eff.fireflyCount) // prettier-ignore
    }
    // Flies and bees share the insect pipeline, differing only in their per-pass
    // uniform (colour, size, kind) and instance buffers.
    this.#drawInsects(pass, timeInfo, "fly", ctx.flyFactor)
    this.#drawInsects(pass, timeInfo, "bee", ctx.beeFactor)

    for (const mod of this.#eventModules) mod.renderForward(pass, ctx)
  }

  #drawInsects(pass, timeInfo, name, factor) {
    const mesh = this.#geo[name]
    if (!mesh?.count || factor <= 0) return
    const uniforms = this.#uniforms[name]
    uniforms.f[3] = uniforms.f[7] * factor // opacity = baseOpacity × visibility
    uniforms.f[6] = timeInfo.ambientIntensity
    uniforms.write()
    this.#drawInstanced(pass, this.#pipelines.insect, this.#bg[name], mesh, 4, mesh.count)
  }

  // Fullscreen draw into a wrapped render target ({ view, width, height }).
  #blit(encoder, target, pipeline, bg0, bg1, { clearValue = CLEAR_BLACK, loadOp = "clear", timestampWrites } = {}) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment(target.view, clearValue, loadOp)],
      timestampWrites,
    })
    pass.setViewport(0, 0, target.width, target.height, 0, 1)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bg0)
    pass.setBindGroup(1, bg1)
    pass.draw(3)
    pass.end()
  }

  // Temporal SSAO — stable per-pixel kernel rotation, only temporalAlpha changes.
  // On mobile the blur pass is skipped and temporal is disabled (alpha=1 always):
  // running half-res with no history avoids needing to rebuild the postprocess
  // bind group every frame to track the ping-pong target, and the per-pixel jitter
  // plus linear upsample in postprocess keeps noise acceptable.
  // Desktop runs FULL-res with temporal history — do not move this to half-res;
  // half-res + reprojected history produces horizontal scanlines (2026-07-07).
  #renderSSAOPass(encoder) {
    const rt = this.#renderTargets
    if (!rt || !this.#bg.ssao) return
    const index = S.lowSpec ? 0 : this.#ssaoFrame % 2
    this.#uniforms.ssao.f[2] = S.lowSpec || this.#ssaoFrame === 0 ? 1 : 0.1
    this.#uniforms.ssao.write()

    const hasBlur = !S.lowSpec
    const target = index === 0 ? rt.ssao : rt.ssaoPrev
    this.#blit(encoder, target, this.#pipelines.ssao, this.#bg.frame, this.#bg.ssao[index], {
      clearValue: CLEAR_WHITE,
      timestampWrites: hasBlur ? this.#profiler?.spanBegin("ssao") : this.#profiler?.pass("ssao"),
    })
    if (hasBlur) {
      this.#blit(encoder, rt.ssaoBlur, this.#pipelines.ssaoBlur, this.#bg.frame, this.#bg.ssaoBlur[index], {
        clearValue: CLEAR_WHITE,
        timestampWrites: this.#profiler?.spanEnd("ssao"),
      })
    }
    this.#ssaoFrame++
  }

  // Bloom: extract highlights → downsample pyramid → additive upsample → bloomExtract.
  #renderBloomPass(encoder, timeInfo) {
    const rt = this.#renderTargets
    if (!rt || !this.#bg.bloomExtract) return
    const empty = this.#bg.empty

    this.#uniforms.bloomExtract.f[0] = timeInfo.bloomThreshold
    this.#uniforms.bloomExtract.write()

    this.#blit(encoder, rt.bloomExtract, this.#pipelines.bloomExtract, empty, this.#bg.bloomExtract, {
      timestampWrites: this.#profiler?.spanBegin("bloom"),
    })
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.#blit(encoder, rt.bloomMips[i], this.#pipelines.bloomDown, empty, this.#bg.bloomDown[i])
    }
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.#blit(encoder, this.#bloomUpTargets[i], this.#pipelines.bloomUp, empty, this.#bg.bloomUp[i], {
        loadOp: "load",
        timestampWrites: i === BLOOM_LEVELS - 1 ? this.#profiler?.spanEnd("bloom") : undefined,
      })
    }
  }

  #renderGodRaysPass(encoder, timeInfo) {
    const rt = this.#renderTargets
    if (!rt || !this.#bg.godrays || timeInfo.godRaySteps < 1) return
    this.#blit(encoder, rt.godRay, this.#pipelines.godrays, this.#bg.frame, this.#bg.godrays, {
      timestampWrites: this.#profiler?.pass("godrays"),
    })
  }

  // Half-res depth of field: signed-CoC downsample → hexagonal bokeh gather.
  // Composited against the sharp scene in postprocess by the gather's blend alpha.
  #renderDofPass(encoder) {
    const rt = this.#renderTargets
    if (!rt || !this.#bg.dofCoc) return
    const empty = this.#bg.empty
    this.#blit(encoder, rt.dofDown, this.#pipelines.dofCoc, empty, this.#bg.dofCoc, {
      timestampWrites: this.#profiler?.spanBegin("dof"),
    })
    this.#blit(encoder, rt.dofBlur, this.#pipelines.dofBlur, empty, this.#bg.dofBlur, {
      clearValue: CLEAR_TRANSPARENT,
      timestampWrites: this.#profiler?.spanEnd("dof"),
    })
  }

  #renderPostProcessPass(encoder, canvasView) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment(canvasView)],
      timestampWrites: this.#profiler?.pass("postprocess"),
    })
    pass.setPipeline(this.#pipelines.postprocess)
    pass.setBindGroup(0, this.#bg.frame)
    pass.setBindGroup(1, this.#bg.postprocess)
    pass.draw(3)
    pass.end()
  }

  // Main render loop
  // ################

  #scheduleNextFrame() {
    this.animationFrameId = this.#visible && !hasError() ? requestAnimationFrame(this.#renderCB) : null
  }

  #render() {
    // iOS TBDR back-pressure gate: don't queue another frame until the GPU
    // drains the previous one, or the command queue grows unbounded.
    if (this.#gpuFramePending) return this.#scheduleNextFrame()

    const ctx = this.#ctx
    const timeInfo = this.#advanceClock(ctx)
    this.#updateLighting(ctx, timeInfo)
    this.#updateCamera(ctx, timeInfo)
    const mouseRay = this.#updateWorld(ctx, timeInfo)
    this.#updateSimulations(ctx, timeInfo, mouseRay)
    this.#writeFrameUniforms(ctx, timeInfo)

    // Acquire canvas texture. On iOS presentation can transiently fail — bail and retry.
    let canvasTexture
    try {
      canvasTexture = ctx.canvasCtx.getCurrentTexture()
    } catch {
      return this.#scheduleNextFrame()
    }

    if (this.#geo.grass) this.#grassTileWorker.flush(ctx.queue, this.#geo.grass)

    this.#profiler?.cpuBegin("encode")
    withErrorScopes(ctx.device, "frame", () => this.#encodeFrame(ctx, timeInfo, canvasTexture))
    this.#profiler?.cpuEnd("encode")

    if (S.isTBDR && ctx.queue.onSubmittedWorkDone) {
      this.#gpuFramePending = true
      ctx.queue.onSubmittedWorkDone().finally(() => {
        this.#gpuFramePending = false
      })
    }
    if (this.#capturePending) {
      this.#capturePending = false
      ctx.queue.onSubmittedWorkDone().then(() => this.#doCapture())
    }

    this.#scheduleNextFrame()
  }

  // Advances the scene clock and returns the (adaptive-quality adjusted) timeInfo.
  #advanceClock(ctx) {
    const now = performance.now()
    ctx.deltaTime = now - ctx.now
    ctx.now = now

    const animating = this.cameraAnimator?.isActive
    if (animating) this.timeSystem.rawTime(ctx.deltaTime)
    else this.timeSystem.lerpTime(ctx.deltaTime)
    // When the day is fast-forwarded the scene clock outruns real time; the CPU
    // sim systems integrate against this scaled delta so they keep pace with the
    // sun instead of crawling. Capped for integrator stability (MAX_SIM_TIME_SCALE).
    ctx.simDeltaTime = ctx.deltaTime * Math.min(this.timeSystem.timeScale, MAX_SIM_TIME_SCALE)

    let timeInfo = this.timeSystem.timeInfo
    if (!animating) {
      this.adaptiveQuality.tick(now)
      timeInfo = this.adaptiveQuality.apply(timeInfo)
    }
    ctx.timeInfo = timeInfo
    return timeInfo
  }

  // Sun / moon / primary light blend — all written into stable ctx slots.
  #updateLighting(ctx, timeInfo) {
    computeAtmosphereSkyColorInto(ctx.skyColor, timeInfo)
    const sun = timeInfo.sunPosition
    const moon = timeInfo.moonPosition
    normalizeInto(ctx.sunDirection, sun.x, sun.y, sun.z)
    const blend = smoothstep(Math.max(0, Math.min(1, sun.y / 0.05)))
    const inv = 1 - blend
    const dir = normalizeInto(
      this.#primaryDir,
      sun.x * blend + moon.x * inv,
      sun.y * blend + moon.y * inv,
      sun.z * blend + moon.z * inv
    )
    ctx.sunBlend = blend
    ctx.primaryLightDir.x = dir[0]
    ctx.primaryLightDir.y = dir[1]
    ctx.primaryLightDir.z = dir[2]
    ctx.primaryLightStrength = blend + inv * 0.15

    const night = nightFactor(timeInfo.timeOfDay)
    ctx.fireflyFactor = night * timeInfo.fireflyIntensity
    ctx.flyFactor = (1 - night) * timeInfo.flyIntensity
    ctx.beeFactor = (1 - night) * timeInfo.beeIntensity
  }

  #updateCamera(ctx, timeInfo) {
    // Idle drift back toward the initial pose when not user-controlled.
    if (!this.camera.locked && !this.camera.isTouching && !this.cameraAnimator?.isActive) {
      const target = this.cameraTarget()
      const lookAt = ctx.lookAt
      lookAt[0] += (target.x - lookAt[0]) * 0.025
      lookAt[1] += (target.y - lookAt[1]) * 0.05
      lookAt[2] += (target.z - lookAt[2]) * 0.025
      const pos = this.camera.position
      const k = S.timeInertia
      pos[0] += (S.initPos[0] - pos[0]) * k
      pos[1] += (S.initPos[1] - pos[1]) * k
      pos[2] += (S.initPos[2] - pos[2]) * k
      pos[1] += (this.#sampleGround(pos[0], pos[2]) + S.idleY - pos[1]) * k
      this.camera.lookAtLerp(lookAt, k)
    }

    this.camera.update(ctx.deltaTime)
    this.cameraAnimator?.update(ctx.deltaTime * MS_TO_SEC)

    this.#profiler?.cpuBegin("matrices")
    ctx.viewMatrix = this.camera.getViewMatrix(timeInfo)
    ctx.invViewMatrix = invertMatrix4Into(this.#invView, ctx.viewMatrix)
    ctx.viewProjectionMatrix = multiplyMMInto(this.#viewProj, ctx.projectionMatrix, ctx.viewMatrix)
    ctx.invViewProjectionMatrix = multiplyMMInto(this.#invViewProj, ctx.invViewMatrix, ctx.invProjectionMatrix)
    ctx.lightSpaceMatrix = this.#computeLightSpaceMatrix(ctx)
    this.#profiler?.cpuEnd("matrices")
  }

  // Wind, streamed geometry, culling and cursor picking. Returns the mouse ray.
  #updateWorld(ctx, timeInfo) {
    this.windSystem.update(ctx.simDeltaTime, timeInfo)
    this.#updateGrassTileAnchors(ctx)
    if (this.#flowerField?.update(ctx.cameraPosition[0], ctx.cameraPosition[2])) {
      ctx.queue.writeBuffer(this.#geo.flower.instances, 0, this.#flowerField.data)
    }

    // Per-tile grass frustum culling → merged instance ranges for the draws.
    this.#grassCullingEnabled = (timeInfo.grassCulling ?? 1) > 0.5 && !!this.#geo.grass
    if (this.#grassCullingEnabled) {
      const heightFactor = timeInfo.grassHeightFactor ?? 1
      const cp = ctx.cameraPosition
      const view = this.#viewCullOpts
      view.camX = cp[0]
      view.camZ = cp[2]
      view.lodDistanceWu = timeInfo.grassLodDistance ?? 18
      view.dedup = (timeInfo.grassDedup ?? 1) > 0.5
      this.#shadowCullOpts.dedup = view.dedup
      this.#viewCuller.cull(ctx.viewProjectionMatrix, this.#geo.grass, heightFactor, view)
      if (ctx.lightSpaceMatrix) {
        this.#shadowCuller.cull(ctx.lightSpaceMatrix, this.#geo.grass, heightFactor, this.#shadowCullOpts)
      }
    }

    const mouseRay = this.#computeMouseRay(ctx)
    this.#updateCursorWorldPos(ctx, mouseRay)
    this.#updateSunProjection(ctx)

    // The previous view-projection feeds TAA-style reprojection, so cache the
    // current one for the next frame after the write.
    writeFrameUniforms(this.#uniforms.frame, ctx, this.windSystem.uniforms, this.#prevViewProjection)
    if (ctx.viewProjectionMatrix) {
      this.#prevViewProjection ??= new Float32Array(16)
      this.#prevViewProjection.set(ctx.viewProjectionMatrix)
    }
    return mouseRay
  }

  // CPU simulations and the streamed instance buffers they feed.
  #updateSimulations(ctx, timeInfo, mouseRay) {
    this.#cloudShadowThisFrame = this.#cloudShadowFrame++ % CLOUD_SHADOW_INTERVAL === 0 && !!this.#tex.cloudShadow
    if (this.#cloudShadowThisFrame) {
      writeCloudShadowUniforms(this.#uniforms.cloudShadow, ctx, this.windSystem.uniforms)
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

    if (this.boidsSystem && this.#geo.bird) {
      this.#profiler?.cpuBegin("boids")
      this.boidsSystem.update(ctx.simDeltaTime, ctx.cameraPosition, ctx.lookAt, timeInfo, mouseRay)
      updateBirdInstances(ctx.queue, this.#geo.bird, this.boidsSystem)
      this.#profiler?.cpuEnd("boids")
    }

    const eff = this.effectsSystem
    if (eff) {
      eff.update(ctx.simDeltaTime, ctx.cameraPosition)
      const stream = (mesh, source) => mesh && source && ctx.queue.writeBuffer(mesh.positions, 0, source)
      stream(this.#geo.particle, eff.particlePositions)
      if (this.#geo.particle && eff.particleLives) {
        ctx.queue.writeBuffer(this.#geo.particle.lives, 0, eff.particleLives)
      }
      if (this.#geo.firefly && eff.fireflyPositions) {
        ctx.queue.writeBuffer(this.#geo.firefly.positions, 0, eff.fireflyPositions)
        ctx.queue.writeBuffer(this.#geo.firefly.brightness, 0, eff.fireflyBrightness)
      }
      if (ctx.flyFactor > 0) stream(this.#geo.fly, eff.flyPositions)
      if (ctx.beeFactor > 0) stream(this.#geo.bee, eff.beePositions)
    }

    for (const mod of this.#eventModules) mod.update(ctx.simDeltaTime, ctx, timeInfo, this.windSystem.uniforms)
  }

  #encodeFrame(ctx, timeInfo, canvasTexture) {
    this.#profiler?.beginFrame()
    const encoder = ctx.device.createCommandEncoder()
    const scoped = (name, record) => withErrorScopes(ctx.device, name, record)

    if (this.#cloudShadowThisFrame) {
      recordBake(
        encoder,
        this.#pipelines.cloudShadowBake,
        this.#tex.cloudShadow.view,
        this.#fullscreenQuad,
        this.#bg.cloudShadowBake
      )
    }

    scoped("shadow", () => this.#renderShadowPass(encoder, ctx))
    scoped("gbuffer", () => this.#renderGBufferPass(encoder, ctx))
    scoped("scene", () => this.#renderScenePass(encoder, ctx, timeInfo))

    if (isActive(timeInfo.ssaoIntensity)) scoped("ssao", () => this.#renderSSAOPass(encoder))
    if (isActive(timeInfo.bloomIntensity) && !isNight(timeInfo)) {
      scoped("bloom", () => this.#renderBloomPass(encoder, timeInfo))
    }
    if (isActive(timeInfo.godRayIntensity)) scoped("godrays", () => this.#renderGodRaysPass(encoder, timeInfo))
    if (timeInfo.depthOfField > 0) scoped("dof", () => this.#renderDofPass(encoder))

    if (this.#renderTargets && this.#bg.postprocess) {
      scoped("postprocess", () => this.#renderPostProcessPass(encoder, canvasTexture.createView()))
    } else {
      // Fallback: clear to a sky-tinted color if post-process isn't ready.
      const sunY = Math.max(0, timeInfo.sunPosition.y)
      const sky = { r: 0.15 + sunY * 0.35, g: 0.2 + sunY * 0.4, b: 0.3 + sunY * 0.55, a: 1 }
      encoder.beginRenderPass({ colorAttachments: [colorAttachment(canvasTexture.createView(), sky)] }).end()
    }

    this.#profiler?.endFrame(encoder)
    try {
      ctx.queue.submit([encoder.finish()])
      this.#profiler?.readback()
    } catch (error) {
      reportError("submit", error)
    }
  }

  // Capture & teardown
  // ##################

  requestCapture() {
    this.#capturePending = true
  }

  #doCapture() {
    this.canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")
      link.href = url
      link.download = `je2050-${stamp}.png`
      link.click()
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
