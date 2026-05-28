// Fourth of July
// ##############
//
// Calendar event module: active July 1–7.
// Renders a waving US flag (cloth simulation) with its pole, and burst
// fireworks during night hours.

import SHADERS from "wgsl-shaders-bundle.js"
import { EventModule } from "../event-module.js"
import { FlagSystem, buildPoleMesh, FLAG_POS } from "./flag-system.js"
import { FireworksSystem } from "./fireworks-system.js"
import { MRT_TARGETS, DEPTH_WRITE, DEPTH_WRITE_SHADOW, ADDITIVE_BLEND, DEPTH_TEST_ONLY } from "../../gpu-pipelines.js"

const UNIFORM_USAGE = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
const VERTEX_USAGE = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
const INDEX_USAGE = GPUBufferUsage.INDEX

export default class FourthOfJulyModule extends EventModule {
  #flagSystem = new FlagSystem()
  #fireworksSystem = new FireworksSystem()

  // GPU buffers — flag cloth
  #flagVertexBuffer = null
  #flagIndexBuffer = null
  #flagIndexCount = 0

  // GPU buffers — flag pole
  #polePositionBuffer = null
  #poleNormalBuffer = null
  #poleIndexBuffer = null
  #poleIndexCount = 0
  #poleObjectBuffer = null // model matrix (identity)

  // GPU buffers — fireworks sparkles
  #sparklePositionBuffer = null
  #sparkleColorBuffer = null

  // Pipelines
  #flagGBufferPipeline = null
  #flagShadowPipeline = null
  #poleMeshPipeline = null
  #poleShadowPipeline = null
  #fireworksPipeline = null

  // Bind groups
  #polePassBindGroup = null // group 1: mesh uniforms (albedo, roughness)
  #poleObjectBindGroup = null // group 3: model matrix
  #emptyBindGroup = null

  async init(gpu, renderAPI) {
    const device = gpu.device
    const flag = this.#flagSystem
    const { frameBindGroupLayout, objectBindGroupLayout, emptyBindGroupLayout } = renderAPI

    this.#emptyBindGroup = device.createBindGroup({ layout: emptyBindGroupLayout, entries: [] })

    // Flag cloth buffers
    this.#flagVertexBuffer = gpu.createBuffer(flag.verts.byteLength, VERTEX_USAGE)
    gpu.queue.writeBuffer(this.#flagVertexBuffer, 0, flag.verts)

    this.#flagIndexBuffer = gpu.createBuffer(flag.indices.byteLength, INDEX_USAGE | GPUBufferUsage.COPY_DST)
    gpu.queue.writeBuffer(this.#flagIndexBuffer, 0, flag.indices)
    this.#flagIndexCount = flag.indexCount

    // Pole buffers
    const pole = buildPoleMesh()
    this.#polePositionBuffer = gpu.createBuffer(pole.positions.byteLength, VERTEX_USAGE)
    gpu.queue.writeBuffer(this.#polePositionBuffer, 0, pole.positions)
    this.#poleNormalBuffer = gpu.createBuffer(pole.normals.byteLength, VERTEX_USAGE)
    gpu.queue.writeBuffer(this.#poleNormalBuffer, 0, pole.normals)
    this.#poleIndexBuffer = gpu.createBuffer(pole.indices.byteLength, INDEX_USAGE | GPUBufferUsage.COPY_DST)
    gpu.queue.writeBuffer(this.#poleIndexBuffer, 0, pole.indices)
    this.#poleIndexCount = pole.indexCount

    // Pole model matrix (identity — pole is in world space already)
    this.#poleObjectBuffer = gpu.createBuffer(64, UNIFORM_USAGE)
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    gpu.queue.writeBuffer(this.#poleObjectBuffer, 0, identity)

    // Fireworks particle buffers
    const fw = this.#fireworksSystem
    this.#sparklePositionBuffer = gpu.createBuffer(fw.sparklePositions.byteLength, VERTEX_USAGE)
    this.#sparkleColorBuffer = gpu.createBuffer(fw.sparkleColors.byteLength, VERTEX_USAGE)

    // Bind group layouts
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    const meshPassLayout = device.createBindGroupLayout({
      label: "event mesh pass",
      entries: [{ binding: 0, visibility: VF, buffer: { type: "uniform" } }],
    })

    // Pole albedo + roughness uniform (vec3f albedo + f32 roughness = 16 bytes)
    const poleColor = new Float32Array([0.45, 0.42, 0.38, 0.55]) // gray metal, roughness 0.55
    const poleMeshBuffer = gpu.createBuffer(poleColor.byteLength, UNIFORM_USAGE)
    gpu.queue.writeBuffer(poleMeshBuffer, 0, poleColor)

    this.#polePassBindGroup = device.createBindGroup({
      layout: meshPassLayout,
      label: "pole mesh",
      entries: [{ binding: 0, resource: { buffer: poleMeshBuffer } }],
    })
    this.#poleObjectBindGroup = device.createBindGroup({
      layout: objectBindGroupLayout,
      label: "pole object",
      entries: [{ binding: 0, resource: { buffer: this.#poleObjectBuffer } }],
    })

    const pLayout = (...groups) => device.createPipelineLayout({ bindGroupLayouts: groups })
    const mod = name => device.createShaderModule({ label: name, code: SHADERS[name] })

    // Interleaved flag vertex buffer: [x,y,z,nx,ny,nz,u,v] stride 32
    const FLAG_VERTEX_BUFFERS = [
      {
        arrayStride: 32,
        stepMode: "vertex",
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
          { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
          { shaderLocation: 2, offset: 24, format: "float32x2" }, // uv
        ],
      },
    ]

    // Flag shadow: only position needed (same interleaved stride)
    const FLAG_SHADOW_VERTEX_BUFFERS = [
      {
        arrayStride: 32,
        stepMode: "vertex",
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
      },
    ]

    const EVENT_MESH_VERTEX_BUFFERS = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
    ]

    // Fireworks: two instance-stepped buffers
    const FIREWORKS_VERTEX_BUFFERS = [
      {
        arrayStride: 12,
        stepMode: "instance",
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }], // sparklePosition
      },
      {
        arrayStride: 16,
        stepMode: "instance",
        attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }], // sparkleColor (RGB + life)
      },
    ]

    this.#flagGBufferPipeline = device.createRenderPipeline({
      label: "flag-gbuffer",
      layout: pLayout(frameBindGroupLayout),
      vertex: { module: mod("flag.wgsl"), entryPoint: "vertexMain", buffers: FLAG_VERTEX_BUFFERS },
      fragment: { module: mod("flag.wgsl"), entryPoint: "fragmentMain", targets: MRT_TARGETS },
      depthStencil: DEPTH_WRITE,
      primitive: { topology: "triangle-list", cullMode: "none" },
    })

    this.#flagShadowPipeline = device.createRenderPipeline({
      label: "flag-shadow",
      layout: pLayout(frameBindGroupLayout),
      vertex: { module: mod("flag-shadow.wgsl"), entryPoint: "vertexMain", buffers: FLAG_SHADOW_VERTEX_BUFFERS },
      fragment: { module: mod("flag-shadow.wgsl"), entryPoint: "fragmentMain", targets: [] },
      depthStencil: DEPTH_WRITE_SHADOW,
      primitive: { topology: "triangle-list", cullMode: "none" },
    })

    this.#poleMeshPipeline = device.createRenderPipeline({
      label: "pole-gbuffer",
      layout: pLayout(frameBindGroupLayout, meshPassLayout, emptyBindGroupLayout, objectBindGroupLayout),
      vertex: { module: mod("event-mesh.wgsl"), entryPoint: "vertexMain", buffers: EVENT_MESH_VERTEX_BUFFERS },
      fragment: { module: mod("event-mesh.wgsl"), entryPoint: "fragmentMain", targets: MRT_TARGETS },
      depthStencil: DEPTH_WRITE,
      primitive: { topology: "triangle-list", cullMode: "back" },
    })

    this.#poleShadowPipeline = device.createRenderPipeline({
      label: "pole-shadow",
      layout: pLayout(frameBindGroupLayout, emptyBindGroupLayout, emptyBindGroupLayout, objectBindGroupLayout),
      vertex: { module: mod("event-shadow.wgsl"), entryPoint: "vertexMain", buffers: [EVENT_MESH_VERTEX_BUFFERS[0]] },
      fragment: { module: mod("event-shadow.wgsl"), entryPoint: "fragmentMain", targets: [] },
      depthStencil: DEPTH_WRITE_SHADOW,
      primitive: { topology: "triangle-list", cullMode: "back" },
    })

    this.#fireworksPipeline = device.createRenderPipeline({
      label: "fireworks",
      layout: pLayout(frameBindGroupLayout),
      vertex: { module: mod("fireworks.wgsl"), entryPoint: "vertexMain", buffers: FIREWORKS_VERTEX_BUFFERS },
      fragment: {
        module: mod("fireworks.wgsl"),
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm", blend: ADDITIVE_BLEND }],
      },
      depthStencil: DEPTH_TEST_ONLY,
      primitive: { topology: "triangle-strip" },
    })
  }

  update(deltaTimeS, ctx, timeInfo, windUniforms) {
    const windStrength = timeInfo.windStrength ?? 0.5
    // windDirection[1] is the Z component in world space — how directly wind hits the flag face
    const windDirZ = windUniforms?.windDirection?.[1] ?? 1
    this.#flagSystem.update(deltaTimeS, windStrength, windDirZ)
    this.#fireworksSystem.update(deltaTimeS, timeInfo)

    const q = ctx.queue
    q.writeBuffer(this.#flagVertexBuffer, 0, this.#flagSystem.verts)

    const fw = this.#fireworksSystem
    if (fw.sparkleCount > 0) {
      q.writeBuffer(this.#sparklePositionBuffer, 0, fw.sparklePositions)
      q.writeBuffer(this.#sparkleColorBuffer, 0, fw.sparkleColors)
    }
  }

  renderShadow(pass, ctx) {
    if (!this.#flagShadowPipeline) return

    // Flag cloth — depth-only, no bind groups beyond group 0 (already set)
    pass.setPipeline(this.#flagShadowPipeline)
    pass.setBindGroup(1, this.#emptyBindGroup)
    pass.setVertexBuffer(0, this.#flagVertexBuffer)
    pass.setIndexBuffer(this.#flagIndexBuffer, "uint16")
    pass.drawIndexed(this.#flagIndexCount)

    // Pole
    pass.setPipeline(this.#poleShadowPipeline)
    pass.setBindGroup(1, this.#emptyBindGroup)
    pass.setBindGroup(2, this.#emptyBindGroup)
    pass.setBindGroup(3, this.#poleObjectBindGroup)
    pass.setVertexBuffer(0, this.#polePositionBuffer)
    pass.setIndexBuffer(this.#poleIndexBuffer, "uint16")
    pass.drawIndexed(this.#poleIndexCount)
  }

  renderGBuffer(pass, ctx) {
    if (!this.#flagGBufferPipeline) return

    // Flag cloth
    pass.setPipeline(this.#flagGBufferPipeline)
    pass.setVertexBuffer(0, this.#flagVertexBuffer)
    pass.setIndexBuffer(this.#flagIndexBuffer, "uint16")
    pass.drawIndexed(this.#flagIndexCount)

    // Pole
    pass.setPipeline(this.#poleMeshPipeline)
    pass.setBindGroup(1, this.#polePassBindGroup)
    pass.setBindGroup(2, this.#emptyBindGroup)
    pass.setBindGroup(3, this.#poleObjectBindGroup)
    pass.setVertexBuffer(0, this.#polePositionBuffer)
    pass.setVertexBuffer(1, this.#poleNormalBuffer)
    pass.setIndexBuffer(this.#poleIndexBuffer, "uint16")
    pass.drawIndexed(this.#poleIndexCount)
  }

  renderForward(pass, ctx) {
    const fw = this.#fireworksSystem
    if (!this.#fireworksPipeline || fw.sparkleCount === 0) return

    pass.setPipeline(this.#fireworksPipeline)
    // Group 0 already bound by renderer.  No other groups needed.
    pass.setVertexBuffer(0, this.#sparklePositionBuffer)
    pass.setVertexBuffer(1, this.#sparkleColorBuffer)
    pass.draw(4, fw.sparkleCount)
  }

  dispose() {
    this.#flagVertexBuffer?.destroy()
    this.#flagIndexBuffer?.destroy()
    this.#polePositionBuffer?.destroy()
    this.#poleNormalBuffer?.destroy()
    this.#poleIndexBuffer?.destroy()
    this.#poleObjectBuffer?.destroy()
    this.#sparklePositionBuffer?.destroy()
    this.#sparkleColorBuffer?.destroy()
  }
}
