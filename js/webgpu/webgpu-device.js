// WebGPU Device
// #############
//
// Adapter/device request, canvas configuration, shared sampler creation,
// and feature detection. init() returns { device, queue, canvasCtx, presentationFormat }.

import { installErrorReporting } from "./webgpu-errors.js"

export class WebGPUDevice {
  /** @type {GPUAdapter} */ adapter = null
  /** @type {GPUDevice} */ device = null
  /** @type {GPUQueue} */ queue = null
  /** @type {GPUCanvasContext} */ canvasCtx = null
  /** @type {GPUTextureFormat} */ presentationFormat = "bgra8unorm"
  /** @type {GPUSampler} */ linearClamp = null
  /** @type {GPUSampler} */ linearRepeat = null
  /** @type {GPUSampler} */ nearestClamp = null
  /** @type {GPUSampler} */ depthSampler = null

  /** @type {GPUAdapterInfo|null} */ adapterInfo = null
  /** @type {GPUSupportedFeatures} */ features = null
  /** @type {GPUSupportedLimits} */ limits = null

  async init(canvas) {
    if (!navigator.gpu) throw new Error("WebGPU is not supported in this browser")

    this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })
    if (!this.adapter) throw new Error("Failed to obtain WebGPU adapter")

    this.adapterInfo = this.adapter.info
    this.features = this.adapter.features
    this.limits = this.adapter.limits

    this.device = await this.adapter.requestDevice()

    installErrorReporting(this.device)

    this.device.lost.then(info => {
      console.error("WebGPU device lost:", info.message)
      if (info.reason !== "destroyed") {
        this.init(canvas)
      }
    })

    this.queue = this.device.queue

    this.canvasCtx = canvas.getContext("webgpu")
    if (!this.canvasCtx) {
      throw new Error("Failed to get WebGPU canvas context")
    }

    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat()
    this.canvasCtx.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: "opaque",
    })

    this.#createSamplers()

    return this
  }

  #createSamplers() {
    const d = this.device
    const samp = (filter, addr) =>
      d.createSampler({
        magFilter: filter,
        minFilter: filter,
        addressModeU: addr,
        addressModeV: addr,
        addressModeW: addr,
      })
    this.linearClamp = samp("linear", "clamp-to-edge")
    this.linearRepeat = samp("linear", "repeat")
    this.nearestClamp = samp("nearest", "clamp-to-edge")
    this.depthSampler = d.createSampler({ magFilter: "linear", minFilter: "linear", compare: "less" })
  }

  #tex2d(width, height, format, extraUsage = 0) {
    return this.device.createTexture({
      size: [width, height],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extraUsage,
    })
  }

  createDepthTexture(width, height, format = "depth24plus") {
    return this.#tex2d(width, height, format)
  }

  createRenderTarget(width, height, format = "rgba8unorm") {
    return this.#tex2d(width, height, format)
  }

  createBuffer(dataOrSize, usage) {
    const isData = typeof dataOrSize !== "number"
    const size = isData ? dataOrSize.byteLength : dataOrSize
    const alignedSize = Math.ceil(size / 4) * 4

    const buffer = this.device.createBuffer({
      size: alignedSize,
      usage,
      mappedAtCreation: isData,
    })

    if (isData) {
      const ArrayType = dataOrSize.constructor
      new ArrayType(buffer.getMappedRange()).set(dataOrSize)
      buffer.unmap()
    }

    return buffer
  }

  createTexture2D(width, height, format, usage, data) {
    const texture = this.device.createTexture({
      size: [width, height],
      format,
      usage,
    })
    if (data) {
      const bytesPerPixel = bytesPerPixelForFormat(format)
      this.queue.writeTexture({ texture }, data, { bytesPerRow: width * bytesPerPixel, rowsPerImage: height }, [
        width,
        height,
      ])
    }
    return texture
  }

  createTexture3D(width, height, depth, format, usage, data) {
    const texture = this.device.createTexture({
      size: [width, height, depth],
      dimension: "3d",
      format,
      usage,
    })
    if (data) {
      const bytesPerPixel = bytesPerPixelForFormat(format)
      this.queue.writeTexture({ texture }, data, { bytesPerRow: width * bytesPerPixel, rowsPerImage: height }, [
        width,
        height,
        depth,
      ])
    }
    return texture
  }

  createReadableRenderTarget(width, height, format = "rgba8unorm") {
    return this.#tex2d(width, height, format, GPUTextureUsage.COPY_SRC)
  }

  destroy() {
    this.device?.destroy()
    this.device = null
    this.queue = null
    this.canvasCtx = null
  }
}

const BPP = {
  r8unorm: 1,
  rg8unorm: 2,
  rgba8unorm: 4,
  bgra8unorm: 4,
  rgba8snorm: 4,
  depth32float: 4,
  r32float: 4,
  rgba16float: 8,
  rgba32float: 16,
}
const bytesPerPixelForFormat = format => BPP[format] ?? 4
