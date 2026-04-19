// GPU Pipelines
// #############
//
// Creates all GPURenderPipeline objects for the WebGPU renderer. Each pipeline
// specifies vertex layout, render targets, depth/blend state, and bind group layouts.
// Bind groups that reference screen-size textures are recreated on resize.

import SHADERS from "wgsl-shaders-bundle.js"
import S from "../shared/settings.js"

// Visibility shorthand
// ####################

const V = GPUShaderStage.VERTEX
const F = GPUShaderStage.FRAGMENT
const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT

// Common render target formats
// ############################

const MRT_TARGETS = [{ format: "rgba8unorm" }, { format: "rgba8unorm" }, { format: "rgba8unorm" }]

const ADDITIVE_BLEND = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
}

const ALPHA_BLEND = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
}

// Common depth/stencil states
// ###########################

const DEPTH_WRITE = {
  format: "depth24plus",
  depthWriteEnabled: true,
  depthCompare: "less",
}

const DEPTH_WRITE_SHADOW = {
  format: "depth32float",
  depthWriteEnabled: true,
  depthCompare: "less",
  depthBias: 2,
  depthBiasSlopeScale: 2.0,
  depthBiasClamp: 0.01,
}

const DEPTH_TEST_ONLY = {
  format: "depth24plus",
  depthWriteEnabled: false,
  depthCompare: "less",
}

const DEPTH_TEST_LEQUAL = {
  format: "depth24plus",
  depthWriteEnabled: false,
  depthCompare: "less-equal",
}

// Vertex buffer layouts
// #####################

const FULLSCREEN_VERTEX_BUFFERS = [
  {
    arrayStride: 8,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  },
  {
    arrayStride: 8,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
  },
]

const GRASS_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
  {
    arrayStride: 8,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
  },
  // Single interleaved buffer: grassPosition (loc 2) + grassStatic (loc 6), stride 24
  {
    arrayStride: 24,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 2, offset: 0, format: "float32x3" },
      { shaderLocation: 6, offset: 12, format: "float32x3" },
    ],
  },
  // Single interleaved buffer: grassHeight (loc 3) + grassBaseWidth (loc 4) + grassRotation (loc 5), stride 12
  {
    arrayStride: 12,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 3, offset: 0, format: "float32" },
      { shaderLocation: 4, offset: 4, format: "float32" },
      { shaderLocation: 5, offset: 8, format: "float32" },
    ],
  },
]

// Grass G-buffer pass adds slot 4: per-blade noise [tuftDist, tuftSeed, noiseX, noiseY, noiseZ]
const GRASS_GPASS_VERTEX_BUFFERS = [
  ...GRASS_VERTEX_BUFFERS,
  {
    arrayStride: 20,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 7, offset: 0, format: "float32x2" },
      { shaderLocation: 8, offset: 8, format: "float32x3" },
    ],
  },
]

const GROUND_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
  {
    arrayStride: 8,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
  },
]

const TEXT_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
  {
    arrayStride: 12,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
  },
]

const SHADOW_TEXT_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
]

const BIRD_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
  {
    arrayStride: 4,
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32" }],
  },
  {
    arrayStride: 48,
    stepMode: "instance",
    attributes: [
      { shaderLocation: 2, offset: 0, format: "float32x4" },
      { shaderLocation: 3, offset: 16, format: "float32x4" },
      { shaderLocation: 4, offset: 32, format: "float32x4" },
    ],
  },
]

const RAIN_VERTEX_BUFFERS = [
  {
    arrayStride: 4,
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32" }],
  },
  {
    arrayStride: 12,
    stepMode: "instance",
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }],
  },
]

const PARTICLE_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    stepMode: "instance",
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
  {
    arrayStride: 4,
    stepMode: "instance",
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32" }],
  },
  {
    arrayStride: 4,
    stepMode: "instance",
    attributes: [{ shaderLocation: 2, offset: 0, format: "float32" }],
  },
  {
    arrayStride: 4,
    stepMode: "instance",
    attributes: [{ shaderLocation: 3, offset: 0, format: "float32" }],
  },
]

const FIREFLY_VERTEX_BUFFERS = [
  {
    arrayStride: 12,
    stepMode: "instance",
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
  },
  {
    arrayStride: 4,
    stepMode: "instance",
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32" }],
  },
]

// Bind group layout helpers
// #########################

function uniform(binding, visibility) {
  return { binding, visibility, buffer: { type: "uniform" } }
}

function tex2d(binding, visibility, sampleType = "float") {
  return { binding, visibility, texture: { sampleType, viewDimension: "2d" } }
}

function tex3d(binding, visibility, sampleType = "float") {
  return { binding, visibility, texture: { sampleType, viewDimension: "3d" } }
}

function texDepth(binding, visibility) {
  return { binding, visibility, texture: { sampleType: "depth", viewDimension: "2d" } }
}

function samp(binding, visibility) {
  return { binding, visibility, sampler: { type: "filtering" } }
}

function sampNonFiltering(binding, visibility) {
  return { binding, visibility, sampler: { type: "non-filtering" } }
}

function sampComparison(binding, visibility) {
  return { binding, visibility, sampler: { type: "comparison" } }
}

// Main pipeline creation
// ######################

export function createAllPipelines(device, presentationFormat) {
  const modules = {}
  for (const [name, code] of Object.entries(SHADERS)) {
    modules[name] = device.createShaderModule({ label: name, code })
  }

  const frameLayout = device.createBindGroupLayout({
    label: "frame (group 0)",
    entries: [uniform(0, VF)],
  })

  const objectLayout = device.createBindGroupLayout({
    label: "object (group 3)",
    entries: [uniform(0, V)],
  })

  const emptyLayout = device.createBindGroupLayout({
    label: "empty",
    entries: [],
  })

  const passLayouts = {}
  const pipelines = {}

  const pLayout = (...groups) => device.createPipelineLayout({ bindGroupLayouts: groups })
  const mod = name => modules[name]
  const vs = (wgsl, buffers = []) => ({ module: mod(wgsl), entryPoint: "vertexMain", buffers })
  const fs = (wgsl, targets) => ({ module: mod(wgsl), entryPoint: "fragmentMain", targets })

  // Grass
  // #####

  passLayouts.grass = device.createBindGroupLayout({
    label: "grass pass",
    entries: [uniform(0, VF), tex2d(1, V), samp(2, V)],
  })

  pipelines.grass = device.createRenderPipeline({
    label: "grass",
    layout: pLayout(frameLayout, passLayouts.grass),
    vertex: vs("grass.wgsl", GRASS_GPASS_VERTEX_BUFFERS),
    fragment: fs("grass.wgsl", MRT_TARGETS),
    depthStencil: DEPTH_WRITE,
    primitive: { topology: "triangle-list", cullMode: "none" },
  })

  // grassDense uses the same pipeline — different buffers at draw time

  // Shadow (grass)
  // ##############

  passLayouts.shadow = device.createBindGroupLayout({
    label: "shadow pass",
    entries: [uniform(0, VF), tex2d(1, V), samp(2, V)],
  })

  pipelines.shadow = device.createRenderPipeline({
    label: "shadow-grass",
    layout: pLayout(frameLayout, passLayouts.shadow),
    vertex: vs("shadow.wgsl", GRASS_VERTEX_BUFFERS),
    fragment: fs("shadow.wgsl", []),
    depthStencil: DEPTH_WRITE_SHADOW,
    primitive: { topology: "triangle-list", cullMode: "none" },
  })

  // Shadow (text)
  // #############

  pipelines.shadowText = device.createRenderPipeline({
    label: "shadow-text",
    layout: pLayout(frameLayout, emptyLayout, emptyLayout, objectLayout),
    vertex: vs("shadow-text.wgsl", SHADOW_TEXT_VERTEX_BUFFERS),
    fragment: fs("shadow-text.wgsl", []),
    depthStencil: DEPTH_WRITE_SHADOW,
    primitive: { topology: "triangle-list" },
  })

  // Ground
  // ######

  passLayouts.ground = device.createBindGroupLayout({
    label: "ground pass",
    entries: [tex2d(0, V), samp(1, V)],
  })

  pipelines.ground = device.createRenderPipeline({
    label: "ground",
    layout: pLayout(frameLayout, passLayouts.ground),
    vertex: vs("ground.wgsl", GROUND_VERTEX_BUFFERS),
    fragment: fs("ground.wgsl", MRT_TARGETS),
    depthStencil: DEPTH_WRITE,
    primitive: { topology: "triangle-list" },
  })

  // Text
  // ####

  pipelines.text = device.createRenderPipeline({
    label: "text",
    layout: pLayout(frameLayout, emptyLayout, emptyLayout, objectLayout),
    vertex: vs("text.wgsl", TEXT_VERTEX_BUFFERS),
    fragment: fs("text.wgsl", MRT_TARGETS),
    depthStencil: DEPTH_WRITE,
    primitive: { topology: "triangle-list" },
  })

  // Bird
  // ####

  passLayouts.bird = device.createBindGroupLayout({
    label: "bird pass",
    entries: [uniform(0, VF)],
  })

  pipelines.bird = device.createRenderPipeline({
    label: "bird",
    layout: pLayout(frameLayout, passLayouts.bird),
    vertex: vs("bird.wgsl", BIRD_VERTEX_BUFFERS),
    fragment: fs("bird.wgsl", MRT_TARGETS),
    depthStencil: DEPTH_WRITE,
    primitive: { topology: "triangle-list" },
  })

  // Deferred Lighting
  // #################

  passLayouts.deferredLighting = device.createBindGroupLayout({
    label: "deferred lighting pass",
    entries: [
      uniform(0, F),
      tex2d(1, F),
      tex2d(2, F),
      tex2d(3, F),
      texDepth(4, F),
      texDepth(5, F),
      tex2d(6, F),
      samp(7, F),
      sampComparison(8, F),
    ],
  })

  // Deferred lighting runs in a pass WITHOUT a depth attachment — the depth
  // texture is bound as a sampler resource instead.  depthReadOnly: true would
  // allow merging deferred + forward into one pass, but iOS Safari WebGPU
  // silently fails to load the previous depth content, causing sky to
  // overwrite all geometry.  No depthStencil on this pipeline.
  pipelines.deferredLighting = device.createRenderPipeline({
    label: "deferred-lighting",
    layout: pLayout(frameLayout, passLayouts.deferredLighting),
    vertex: vs("deferred-lighting.wgsl"),
    fragment: fs("deferred-lighting.wgsl", [{ format: "rgba8unorm" }]),
    primitive: { topology: "triangle-list" },
  })

  // Firefly Lights (deferred additive)
  // ##################################

  passLayouts.fireflyLights = device.createBindGroupLayout({
    label: "firefly lights pass",
    entries: [
      uniform(0, F),
      tex2d(1, F),
      sampNonFiltering(2, F),
      tex2d(3, F),
      sampNonFiltering(4, F),
      texDepth(5, F),
      sampNonFiltering(6, F),
    ],
  })

  pipelines.fireflyLights = device.createRenderPipeline({
    label: "firefly-lights",
    layout: pLayout(frameLayout, passLayouts.fireflyLights),
    vertex: vs("firefly-lights.wgsl"),
    fragment: fs("firefly-lights.wgsl", [{ format: "rgba8unorm", blend: ADDITIVE_BLEND }]),
    primitive: { topology: "triangle-list" },
  })

  // Sky
  // ###

  passLayouts.sky = device.createBindGroupLayout({
    label: "sky pass",
    entries: [uniform(0, VF), tex2d(1, F), samp(2, F), tex3d(3, F), samp(4, F)],
  })

  pipelines.sky = device.createRenderPipeline({
    label: "sky",
    layout: pLayout(frameLayout, passLayouts.sky),
    vertex: vs("sky.wgsl"),
    fragment: fs("sky.wgsl", [{ format: "rgba8unorm" }]),
    depthStencil: DEPTH_TEST_LEQUAL,
    primitive: { topology: "triangle-list" },
  })

  // Rain
  // ####

  passLayouts.rain = device.createBindGroupLayout({
    label: "rain pass",
    entries: [uniform(0, VF)],
  })

  pipelines.rain = device.createRenderPipeline({
    label: "rain",
    layout: pLayout(frameLayout, passLayouts.rain),
    vertex: vs("rain.wgsl", RAIN_VERTEX_BUFFERS),
    fragment: fs("rain.wgsl", [{ format: "rgba8unorm", blend: ALPHA_BLEND }]),
    depthStencil: DEPTH_TEST_ONLY,
    primitive: { topology: "line-list" },
  })

  // Particle
  // ########

  passLayouts.particle = device.createBindGroupLayout({
    label: "particle pass",
    entries: [uniform(0, VF)],
  })

  pipelines.particle = device.createRenderPipeline({
    label: "particle",
    layout: pLayout(frameLayout, passLayouts.particle),
    vertex: vs("particle.wgsl", PARTICLE_VERTEX_BUFFERS),
    fragment: fs("particle.wgsl", [{ format: "rgba8unorm", blend: ADDITIVE_BLEND }]),
    depthStencil: DEPTH_TEST_ONLY,
    primitive: { topology: "triangle-strip", stripIndexFormat: "uint32" },
  })

  // Firefly Sprites
  // ###############

  passLayouts.fireflySprite = device.createBindGroupLayout({
    label: "firefly sprite pass",
    entries: [uniform(0, VF)],
  })

  pipelines.fireflySprite = device.createRenderPipeline({
    label: "firefly-sprite",
    layout: pLayout(frameLayout, passLayouts.fireflySprite),
    vertex: vs("firefly.wgsl", FIREFLY_VERTEX_BUFFERS),
    fragment: fs("firefly.wgsl", [{ format: "rgba8unorm", blend: ADDITIVE_BLEND }]),
    depthStencil: DEPTH_TEST_ONLY,
    primitive: { topology: "triangle-strip", stripIndexFormat: "uint32" },
  })

  // SSAO
  // ####

  passLayouts.ssao = device.createBindGroupLayout({
    label: "ssao pass",
    entries: [
      uniform(0, F),
      texDepth(1, F),
      sampNonFiltering(2, F),
      tex2d(3, F),
      sampNonFiltering(4, F),
      tex2d(5, F),
      samp(6, F),
    ],
  })

  pipelines.ssao = device.createRenderPipeline({
    label: "ssao",
    layout: pLayout(frameLayout, passLayouts.ssao),
    vertex: vs("ssao.wgsl"),
    fragment: fs("ssao.wgsl", [{ format: "rgba8unorm" }]),
    primitive: { topology: "triangle-list" },
  })

  // SSAO Blur
  // #########

  passLayouts.ssaoBlur = device.createBindGroupLayout({
    label: "ssao blur pass",
    entries: [tex2d(0, F), samp(1, F), texDepth(2, F)],
  })

  pipelines.ssaoBlur = device.createRenderPipeline({
    label: "ssao-blur",
    layout: pLayout(frameLayout, passLayouts.ssaoBlur),
    vertex: vs("ssao-blur.wgsl"),
    fragment: fs("ssao-blur.wgsl", [{ format: "rgba8unorm" }]),
    primitive: { topology: "triangle-list" },
  })

  // Bloom Extract
  // #############

  const bloomFormat = S.isMobile ? "rgba8unorm" : "rgba16float"

  passLayouts.bloomExtract = device.createBindGroupLayout({
    label: "bloom extract pass",
    entries: [uniform(0, F), samp(1, F), tex2d(2, F)],
  })

  pipelines.bloomExtract = device.createRenderPipeline({
    label: "bloom-extract",
    layout: pLayout(emptyLayout, passLayouts.bloomExtract),
    vertex: vs("bloom-extract.wgsl"),
    fragment: fs("bloom-extract.wgsl", [{ format: bloomFormat }]),
    primitive: { topology: "triangle-list" },
  })

  // Bloom Down
  // ##########

  passLayouts.bloomDown = device.createBindGroupLayout({
    label: "bloom down pass",
    entries: [uniform(0, F), samp(1, F), tex2d(2, F)],
  })

  pipelines.bloomDown = device.createRenderPipeline({
    label: "bloom-down",
    layout: pLayout(emptyLayout, passLayouts.bloomDown),
    vertex: vs("bloom-down.wgsl"),
    fragment: fs("bloom-down.wgsl", [{ format: bloomFormat }]),
    primitive: { topology: "triangle-list" },
  })

  // Bloom Up
  // ########

  passLayouts.bloomUp = device.createBindGroupLayout({
    label: "bloom up pass",
    entries: [uniform(0, F), samp(1, F), tex2d(2, F)],
  })

  pipelines.bloomUp = device.createRenderPipeline({
    label: "bloom-up",
    layout: pLayout(emptyLayout, passLayouts.bloomUp),
    vertex: vs("bloom-up.wgsl"),
    fragment: fs("bloom-up.wgsl", [{ format: bloomFormat, blend: ADDITIVE_BLEND }]),
    primitive: { topology: "triangle-list" },
  })

  // God Rays
  // ########

  passLayouts.godrays = device.createBindGroupLayout({
    label: "godrays pass",
    entries: [
      uniform(0, F),
      tex2d(1, F),
      texDepth(2, F),
      texDepth(3, F),
      tex2d(4, F),
      samp(5, F),
      sampComparison(6, F),
    ],
  })

  pipelines.godrays = device.createRenderPipeline({
    label: "godrays",
    layout: pLayout(frameLayout, passLayouts.godrays),
    vertex: vs("godrays.wgsl"),
    fragment: fs("godrays.wgsl", [{ format: "rgba8unorm" }]),
    primitive: { topology: "triangle-list" },
  })

  // Post-Process
  // ############

  passLayouts.postprocess = device.createBindGroupLayout({
    label: "postprocess pass",
    entries: [
      uniform(0, F),
      tex2d(1, F),
      samp(2, F),
      texDepth(3, F),
      sampNonFiltering(4, F),
      tex2d(5, F),
      samp(6, F),
      tex2d(7, F),
      samp(8, F),
      tex2d(9, F),
      samp(10, F),
      tex2d(11, F),
      sampNonFiltering(12, F),
      uniform(13, F),
      tex3d(14, F),
      samp(15, F),
    ],
  })

  pipelines.postprocess = device.createRenderPipeline({
    label: "postprocess",
    layout: pLayout(frameLayout, passLayouts.postprocess),
    vertex: vs("postprocess.wgsl"),
    fragment: fs("postprocess.wgsl", [{ format: presentationFormat }]),
    primitive: { topology: "triangle-list" },
  })

  // Mountain Bake
  // #############

  pipelines.mountainBake = device.createRenderPipeline({
    label: "mountain-bake",
    layout: pLayout(emptyLayout),
    vertex: vs("mountain-bake.wgsl", FULLSCREEN_VERTEX_BUFFERS),
    fragment: fs("mountain-bake.wgsl", [{ format: "rgba8unorm" }]),
    primitive: { topology: "triangle-strip", stripIndexFormat: "uint32" },
  })

  // Ground Heightmap Bake
  // #####################

  pipelines.groundBake = device.createRenderPipeline({
    label: "ground-bake",
    layout: pLayout(emptyLayout),
    vertex: vs("ground-heightmap-bake.wgsl", FULLSCREEN_VERTEX_BUFFERS),
    fragment: fs("ground-heightmap-bake.wgsl", [{ format: "rgba8unorm" }]),
    primitive: { topology: "triangle-strip", stripIndexFormat: "uint32" },
  })

  // Cloud Shadow Bake
  // #################

  passLayouts.cloudShadowBake = device.createBindGroupLayout({
    label: "cloud shadow bake (group 0)",
    entries: [uniform(0, F)],
  })

  pipelines.cloudShadowBake = device.createRenderPipeline({
    label: "cloud-shadow-bake",
    layout: pLayout(passLayouts.cloudShadowBake),
    vertex: vs("cloud-shadow-bake.wgsl", FULLSCREEN_VERTEX_BUFFERS),
    fragment: fs("cloud-shadow-bake.wgsl", [{ format: "r8unorm" }]),
    primitive: { topology: "triangle-strip", stripIndexFormat: "uint32" },
  })

  return {
    modules,
    pipelines,
    frameLayout,
    objectLayout,
    emptyLayout,
    passLayouts,
  }
}

// Bind Group Creation
// ###################

/**
 * Create the per-frame bind group (group 0) shared by most passes.
 */
export function createFrameBindGroup(device, layout, frameUniformBuffer) {
  return device.createBindGroup({
    label: "frame uniforms",
    layout,
    entries: [{ binding: 0, resource: { buffer: frameUniformBuffer } }],
  })
}

/**
 * Create the per-object bind group (group 3) for text and shadow-text.
 */
export function createObjectBindGroup(device, layout, objectUniformBuffer) {
  return device.createBindGroup({
    label: "object uniforms",
    layout,
    entries: [{ binding: 0, resource: { buffer: objectUniformBuffer } }],
  })
}

/**
 * Create an empty bind group for unused group slots.
 */
export function createEmptyBindGroup(device, layout) {
  return device.createBindGroup({ label: "empty", layout, entries: [] })
}

// Per-Pass Bind Groups
// ####################
// These reference textures and samplers, and must be recreated when
// screen-size textures are rebuilt on resize.

function bg(device, layout, label, entries) {
  return device.createBindGroup({
    label,
    layout,
    entries: entries.map(([binding, resource]) => ({ binding, resource })),
  })
}

function buf(buffer) {
  return { buffer }
}

function view(texture) {
  return texture.createView()
}

export function createPassBindGroups(device, layouts, textures, views, samplers, uniformBuffers) {
  const groups = {}

  if (layouts.grass && uniformBuffers.grass) {
    groups.grass = bg(device, layouts.grass, "grass pass", [
      [0, buf(uniformBuffers.grass)],
      [1, view(textures.windNoise)],
      [2, samplers.linearRepeat],
    ])
  }

  if (layouts.shadow && uniformBuffers.shadow) {
    groups.shadow = bg(device, layouts.shadow, "shadow pass", [
      [0, buf(uniformBuffers.shadow)],
      [1, view(textures.windNoise)],
      [2, samplers.linearRepeat],
    ])
  }

  if (layouts.ground) {
    groups.ground = bg(device, layouts.ground, "ground pass", [
      [0, view(textures.groundHeightmap)],
      [1, samplers.linearClamp],
    ])
  }

  if (layouts.bird && uniformBuffers.bird) {
    groups.bird = bg(device, layouts.bird, "bird pass", [[0, buf(uniformBuffers.bird)]])
  }

  // Inside the merged scene pass, the depth texture is simultaneously the
  // pass attachment (depthReadOnly: true) AND a texture_depth_2d binding here.
  // Apple's Metal-backed WebGPU rejects this when the binding reuses the same
  // view object as the attachment, so use an explicit aspect: "depth-only" view.
  const depthSampleView = views.depthSampleView ?? views.depthView

  if (layouts.deferredLighting && uniformBuffers.deferredLighting) {
    groups.deferredLighting = bg(device, layouts.deferredLighting, "deferred lighting pass", [
      [0, buf(uniformBuffers.deferredLighting)],
      [1, view(textures.gAlbedo)],
      [2, view(textures.gNormal)],
      [3, view(textures.gMaterial)],
      [4, depthSampleView],
      [5, views.shadowMapView ?? view(textures.shadowMap)],
      [6, views.cloudShadowView ?? view(textures.cloudShadow)],
      [7, samplers.linearClamp],
      [8, samplers.depthSampler],
    ])
  }

  if (layouts.fireflyLights && uniformBuffers.fireflyLights) {
    groups.fireflyLights = bg(device, layouts.fireflyLights, "firefly lights pass", [
      [0, buf(uniformBuffers.fireflyLights)],
      [1, view(textures.gAlbedo)],
      [2, samplers.nearestClamp],
      [3, view(textures.gNormal)],
      [4, samplers.nearestClamp],
      [5, depthSampleView],
      [6, samplers.nearestClamp],
    ])
  }

  if (layouts.sky && uniformBuffers.sky) {
    groups.sky = bg(device, layouts.sky, "sky pass", [
      [0, buf(uniformBuffers.sky)],
      [1, view(textures.mountainHeightmap)],
      [2, samplers.linearClamp],
      [3, view(textures.noiseTex)],
      [4, samplers.linearRepeat],
    ])
  }

  if (layouts.rain && uniformBuffers.rain) {
    groups.rain = bg(device, layouts.rain, "rain pass", [[0, buf(uniformBuffers.rain)]])
  }

  if (layouts.particle && uniformBuffers.particle) {
    groups.particle = bg(device, layouts.particle, "particle pass", [[0, buf(uniformBuffers.particle)]])
  }

  if (layouts.fireflySprite && uniformBuffers.fireflySprite) {
    groups.fireflySprite = bg(device, layouts.fireflySprite, "firefly sprite pass", [
      [0, buf(uniformBuffers.fireflySprite)],
    ])
  }

  if (layouts.ssao && uniformBuffers.ssao) {
    groups.ssao = bg(device, layouts.ssao, "ssao pass", [
      [0, buf(uniformBuffers.ssao)],
      [1, views.depthView],
      [2, samplers.nearestClamp],
      [3, view(textures.gAlbedo)],
      [4, samplers.nearestClamp],
      [5, view(textures.ssaoPrev)],
      [6, samplers.nearestClamp],
    ])
  }

  if (layouts.ssaoBlur) {
    groups.ssaoBlur = bg(device, layouts.ssaoBlur, "ssao blur pass", [
      [0, view(textures.ssao)],
      [1, views.depthView],
      [2, samplers.nearestClamp],
    ])
  }

  if (layouts.bloomExtract && uniformBuffers.bloomExtract) {
    groups.bloomExtract = bg(device, layouts.bloomExtract, "bloom extract pass", [
      [0, buf(uniformBuffers.bloomExtract)],
      [1, samplers.linearClamp],
      [2, view(textures.sceneTexture)],
    ])
  }

  if (layouts.godrays && uniformBuffers.godrays) {
    groups.godrays = bg(device, layouts.godrays, "godrays pass", [
      [0, buf(uniformBuffers.godrays)],
      [1, view(textures.sceneTexture)],
      [2, views.depthView],
      [3, view(textures.shadowMap)],
      [4, view(textures.cloudShadow)],
      [5, samplers.linearClamp],
      [6, samplers.depthSampler],
    ])
  }

  if (layouts.cloudShadowBake && uniformBuffers.cloudShadowBake) {
    groups.cloudShadowBake = bg(device, layouts.cloudShadowBake, "cloud shadow bake", [
      [0, buf(uniformBuffers.cloudShadowBake)],
    ])
  }

  return groups
}

/**
 * Create a bloom mip bind group for down/up passes.
 * Called per-mip at draw time since the source texture changes each step.
 */
export function createBloomMipBindGroup(device, layout, uniformBuffer, sampler, sourceTexture) {
  return bg(device, layout, "bloom mip", [
    [0, buf(uniformBuffer)],
    [1, sampler],
    [2, view(sourceTexture)],
  ])
}
