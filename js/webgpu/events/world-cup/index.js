// World Cup 2026
// ##############
//
// Calendar event module: active June 11 – July 19, 2026.
// Renders a soccer ball sitting in the grass, with full deferred lighting,
// shadow casting, and a subtle idle-bounce animation.

import SHADERS from "wgsl-shaders-bundle.js"
import { EventModule } from "../event-module.js"
import { BallSystem, buildIcosphere } from "./ball-system.js"
import { MRT_TARGETS, DEPTH_WRITE, DEPTH_WRITE_SHADOW } from "../../gpu-pipelines.js"

const UNIFORM_USAGE = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
const VERTEX_USAGE = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
const INDEX_USAGE = GPUBufferUsage.INDEX

export default class WorldCupModule extends EventModule {
  #ballSystem = new BallSystem()
  #mesh = buildIcosphere(2)

  #positionBuffer = null
  #normalBuffer = null
  #indexBuffer = null
  #indexCount = 0
  #objectBuffer = null // model matrix (updated each frame)

  #meshPipeline = null
  #shadowPipeline = null

  #passBindGroup = null // group 1: albedo + roughness
  #objectBindGroup = null // group 3: model matrix
  #emptyBindGroup = null

  async init(gpu, renderAPI) {
    const device = gpu.device
    const { frameBindGroupLayout, objectBindGroupLayout, emptyBindGroupLayout } = renderAPI
    const mesh = this.#mesh

    this.#emptyBindGroup = device.createBindGroup({ layout: emptyBindGroupLayout, entries: [] })

    this.#positionBuffer = gpu.createBuffer(mesh.positions.byteLength, VERTEX_USAGE)
    gpu.queue.writeBuffer(this.#positionBuffer, 0, mesh.positions)

    this.#normalBuffer = gpu.createBuffer(mesh.normals.byteLength, VERTEX_USAGE)
    gpu.queue.writeBuffer(this.#normalBuffer, 0, mesh.normals)

    this.#indexBuffer = gpu.createBuffer(mesh.indices.byteLength, INDEX_USAGE | GPUBufferUsage.COPY_DST)
    gpu.queue.writeBuffer(this.#indexBuffer, 0, mesh.indices)
    this.#indexCount = mesh.indexCount

    // Model matrix buffer — written each frame for the idle bob
    this.#objectBuffer = gpu.createBuffer(64, UNIFORM_USAGE)

    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    const meshPassLayout = device.createBindGroupLayout({
      label: "soccer ball mesh pass",
      entries: [{ binding: 0, visibility: VF, buffer: { type: "uniform" } }],
    })

    // Soccer ball material: off-white base colour, medium roughness
    const ballColor = new Float32Array([0.92, 0.9, 0.88, 0.65]) // albedo RGB + roughness
    const meshUniformBuffer = gpu.createBuffer(ballColor.byteLength, UNIFORM_USAGE)
    gpu.queue.writeBuffer(meshUniformBuffer, 0, ballColor)

    this.#passBindGroup = device.createBindGroup({
      layout: meshPassLayout,
      label: "soccer ball pass",
      entries: [{ binding: 0, resource: { buffer: meshUniformBuffer } }],
    })
    this.#objectBindGroup = device.createBindGroup({
      layout: objectBindGroupLayout,
      label: "soccer ball object",
      entries: [{ binding: 0, resource: { buffer: this.#objectBuffer } }],
    })

    const pLayout = (...groups) => device.createPipelineLayout({ bindGroupLayouts: groups })
    const mod = name => device.createShaderModule({ label: name, code: SHADERS[name] })

    const MESH_VERTEX_BUFFERS = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
    ]

    this.#meshPipeline = device.createRenderPipeline({
      label: "soccer-ball-gbuffer",
      layout: pLayout(frameBindGroupLayout, meshPassLayout, emptyBindGroupLayout, objectBindGroupLayout),
      vertex: { module: mod("event-mesh.wgsl"), entryPoint: "vertexMain", buffers: MESH_VERTEX_BUFFERS },
      fragment: { module: mod("event-mesh.wgsl"), entryPoint: "fragmentMain", targets: MRT_TARGETS },
      depthStencil: DEPTH_WRITE,
      primitive: { topology: "triangle-list", cullMode: "back" },
    })

    this.#shadowPipeline = device.createRenderPipeline({
      label: "soccer-ball-shadow",
      layout: pLayout(frameBindGroupLayout, emptyBindGroupLayout, emptyBindGroupLayout, objectBindGroupLayout),
      vertex: {
        module: mod("event-shadow.wgsl"),
        entryPoint: "vertexMain",
        buffers: [MESH_VERTEX_BUFFERS[0]],
      },
      fragment: { module: mod("event-shadow.wgsl"), entryPoint: "fragmentMain", targets: [] },
      depthStencil: DEPTH_WRITE_SHADOW,
      primitive: { topology: "triangle-list", cullMode: "back" },
    })

    // Write initial model matrix
    gpu.queue.writeBuffer(this.#objectBuffer, 0, this.#ballSystem.buildModelMatrix())
  }

  update(deltaTimeS, ctx, timeInfo) {
    this.#ballSystem.update(deltaTimeS)
    ctx.queue.writeBuffer(this.#objectBuffer, 0, this.#ballSystem.buildModelMatrix())
  }

  renderShadow(pass, ctx) {
    if (!this.#shadowPipeline) return
    pass.setPipeline(this.#shadowPipeline)
    pass.setBindGroup(1, this.#emptyBindGroup)
    pass.setBindGroup(2, this.#emptyBindGroup)
    pass.setBindGroup(3, this.#objectBindGroup)
    pass.setVertexBuffer(0, this.#positionBuffer)
    pass.setIndexBuffer(this.#indexBuffer, "uint16")
    pass.drawIndexed(this.#indexCount)
  }

  renderGBuffer(pass, ctx) {
    if (!this.#meshPipeline) return
    pass.setPipeline(this.#meshPipeline)
    pass.setBindGroup(1, this.#passBindGroup)
    pass.setBindGroup(2, this.#emptyBindGroup)
    pass.setBindGroup(3, this.#objectBindGroup)
    pass.setVertexBuffer(0, this.#positionBuffer)
    pass.setVertexBuffer(1, this.#normalBuffer)
    pass.setIndexBuffer(this.#indexBuffer, "uint16")
    pass.drawIndexed(this.#indexCount)
  }

  dispose() {
    this.#positionBuffer?.destroy()
    this.#normalBuffer?.destroy()
    this.#indexBuffer?.destroy()
    this.#objectBuffer?.destroy()
  }
}
