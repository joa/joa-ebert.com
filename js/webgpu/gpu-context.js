// GPU Context
// ###########
//
// Shared per-frame state passed to all subsystems. Holds the GPUDevice, queue,
// canvas context, shared textures/samplers, and per-frame state (matrices, time,
// camera, lighting). Subsystems receive this instead of a raw WebGPU device.

const MS_TO_SEC = 0.001

export class GPUContext {
  // WebGPU device & canvas
  // ######################
  /** @type {GPUDevice} */ device = null
  /** @type {GPUQueue} */ queue = null
  /** @type {GPUCanvasContext} */ canvasCtx = null
  /** @type {GPUTextureFormat} */ presentationFormat = "bgra8unorm"

  // Shared GPU resources (created once, recreated on resize)
  // ########################################################
  /** @type {GPUTexture} */ depthTexture = null
  /** @type {GPUTextureView} */ depthView = null
  /** @type {GPUTextureView} */ depthSampleView = null
  /** @type {GPUSampler} */ linearClamp = null
  /** @type {GPUSampler} */ linearRepeat = null
  /** @type {GPUSampler} */ nearestClamp = null
  /** @type {GPUBuffer} */ frameUniformBuffer = null

  // Camera & matrices (Float32Array[16])
  // #####################################
  camera = null
  lookAt = [0, 0, 0]
  projectionMatrix = null
  invProjectionMatrix = null
  viewMatrix = null
  invViewMatrix = null
  viewProjectionMatrix = null
  invViewProjectionMatrix = null
  lightSpaceMatrix = null

  get cameraPosition() {
    return this.camera?.position ?? [0, 0, 0]
  }

  // Sun / moon / lighting
  // #####################
  timeInfo = null
  get sunPosition() {
    return this.timeInfo?.sunPosition ?? { x: 0, y: 1, z: 0 }
  }
  sunScreenSpace = { x: 0, y: 0 }
  sunDirection = [0, 0, 0]
  primaryLightDir = { x: 0, y: 0, z: 0 }
  primaryLightStrength = 1.0
  sunBlend = 1.0
  mountainVisibility = 1.0
  cloudLightOcclusion = 1.0
  skyColor = { r: 0.4, g: 0.6, b: 0.9 }

  // Timing
  // ######
  currentTime = 0
  deltaTime = 0
  now = performance.now()
  get nowSec() {
    return this.now * MS_TO_SEC
  }

  // Viewport & cursor
  // #################
  width = 0
  height = 0
  aspect = 1.0
  fov = Math.PI
  cursorWorldPos = [0, 0, 0]
  cursorActive = 0
}
