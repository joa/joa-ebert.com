// GPU Pipelines
// #############
//
// Every GPURenderPipeline and bind group layout, declared as data. Binding
// indices come from array position, vertex attribute offsets from declaration
// order — both are always sequential and tightly packed in this renderer.

import SHADERS from "wgsl-shaders-bundle.js"
import { bloomChainFormat, GDEPTH_FORMAT, MOUNTAIN_PANO_FORMAT, SCENE_FORMAT } from "./gpu-buffers.js"

// Re-exported so event modules (which draw into the scene pass) can match it.
export { SCENE_FORMAT }

const V = GPUShaderStage.VERTEX
const F = GPUShaderStage.FRAGMENT
const VF = V | F

// Bind group layout entries
// #########################

const uniform = visibility => ({ visibility, buffer: { type: "uniform" } })
const tex2d = (visibility, sampleType = "float") => ({ visibility, texture: { sampleType, viewDimension: "2d" } })
const tex3d = visibility => ({ visibility, texture: { sampleType: "float", viewDimension: "3d" } })
const texDepth = visibility => tex2d(visibility, "depth")
// gDepth is r32float, which is never filterable. Readers only textureLoad it.
const texGDepth = visibility => tex2d(visibility, "unfilterable-float")
const samp = (visibility, type = "filtering") => ({ visibility, sampler: { type } })
const sampNearest = visibility => samp(visibility, "non-filtering")
const sampCompare = visibility => samp(visibility, "comparison")

// Shared entry lists — one layout object is created per pass name, but passes
// with identical shapes describe them once here.
const WIND_READER = [uniform(VF), tex2d(V), samp(V)]
const GBUFFER_LIGHT = [uniform(F), tex2d(F), sampNearest(F), tex2d(F), sampNearest(F), texGDepth(F), sampNearest(F)]
const BLOOM_STEP = [uniform(F), samp(F), tex2d(F)]
const UNIFORM_ONLY = [uniform(VF)]

const PASS_ENTRIES = {
  grass: WIND_READER,
  flower: WIND_READER,
  shadow: WIND_READER,
  ground: [tex2d(V), samp(V)],
  bird: UNIFORM_ONLY,
  rain: UNIFORM_ONLY,
  particle: UNIFORM_ONLY,
  fireflySprite: UNIFORM_ONLY,
  insect: UNIFORM_ONLY,
  cloudShadowBake: [uniform(F)],
  // albedo, normal, gDepth, shadow map, cloud shadow
  deferredLighting: [uniform(F), tex2d(F), tex2d(F), texGDepth(F), texDepth(F), tex2d(F), sampCompare(F)],
  fireflyLights: GBUFFER_LIGHT,
  bikeLights: GBUFFER_LIGHT,
  // sky uniforms, mountain heightmap, noise, mountain panorama
  sky: [uniform(VF), tex2d(F), samp(F), tex3d(F), samp(F), tex2d(F), samp(F)],
  // The pano bake shares the sky's resources minus the panorama itself (it is
  // the attachment there, and an attachment cannot also be bound for sampling).
  mountainPano: [uniform(VF), tex2d(F), samp(F), tex3d(F), samp(F)],
  // uniform, depth, gAlbedo, previous frame's AO
  ssao: [uniform(F), texDepth(F), sampNearest(F), tex2d(F), sampNearest(F), tex2d(F), samp(F)],
  ssaoBlur: [tex2d(F), samp(F), texDepth(F)],
  bloomExtract: BLOOM_STEP,
  bloomDown: BLOOM_STEP,
  bloomUp: BLOOM_STEP,
  // uniform, scene, depth, shadow map, cloud shadow
  godrays: [uniform(F), tex2d(F), texDepth(F), texDepth(F), tex2d(F), samp(F), sampCompare(F)],
  dofCoc: [uniform(F), tex2d(F), texDepth(F), tex2d(F), samp(F), tex2d(F)],
  dofBlur: [uniform(F), tex2d(F), samp(F)],
  // scene, depth, bloom, god rays, ao, gAlbedo, fog uniform, noise, dof
  postprocess: [
    uniform(F),
    tex2d(F),
    samp(F),
    texDepth(F),
    sampNearest(F),
    tex2d(F),
    samp(F),
    tex2d(F),
    samp(F),
    tex2d(F),
    samp(F),
    tex2d(F),
    sampNearest(F),
    uniform(F),
    tex3d(F),
    samp(F),
    tex2d(F),
  ],
}

// Vertex buffer layouts
// #####################

const FORMAT_BYTES = { float32: 4, float32x2: 8, float32x3: 12, float32x4: 16 }

const packed = (stepMode, attribs) => {
  let offset = 0
  const attributes = attribs.map(([shaderLocation, format]) => {
    const attribute = { shaderLocation, offset, format }
    offset += FORMAT_BYTES[format]
    return attribute
  })
  return { arrayStride: offset, stepMode, attributes }
}

const perVertex = (...attribs) => packed("vertex", attribs)
const perInstance = (...attribs) => packed("instance", attribs)

const FULLSCREEN_VB = [perVertex([0, "float32x2"]), perVertex([1, "float32x2"])]

const GRASS_VB = [
  perVertex([0, "float32x3"]),
  perVertex([1, "float32x2"]),
  perInstance([2, "float32x3"], [6, "float32x3"]), // position + static
  perInstance([3, "float32"], [4, "float32"], [5, "float32"]), // height, baseWidth, rotation
]

// The G-buffer pass adds per-blade noise: [tuftDist, tuftSeed] + [noiseX, noiseY, noiseZ]
const GRASS_GBUFFER_VB = [...GRASS_VB, perInstance([7, "float32x2"], [8, "float32x3"])]

// Two crossed cards: position, uv, and the card's outward XZ normal; per instance
// a position plus [rotation, scale, kind, seed].
const FLOWER_VB = [
  perVertex([0, "float32x3"], [1, "float32x2"], [2, "float32x2"]),
  perInstance([3, "float32x3"], [4, "float32x4"]),
]

const GROUND_VB = [perVertex([0, "float32x3"]), perVertex([1, "float32x2"])]
const TEXT_VB = [perVertex([0, "float32x3"]), perVertex([1, "float32x3"])]
const SHADOW_TEXT_VB = [perVertex([0, "float32x3"])]

// position, normal, colour, [roughness, metalness], emissive
const BIKE_VB = [
  perVertex([0, "float32x3"]),
  perVertex([1, "float32x3"]),
  perVertex([2, "float32x3"]),
  perVertex([3, "float32x2"]),
  perVertex([4, "float32"]),
]

// position + wing flex, and a per-bird 3×vec4 transform
const BIRD_VB = [
  perVertex([0, "float32x3"]),
  perVertex([1, "float32"]),
  perInstance([2, "float32x4"], [3, "float32x4"], [4, "float32x4"]),
]

const RAIN_VB = [perVertex([0, "float32"]), perInstance([1, "float32x3"])]

const SPRITE_VB = [perInstance([0, "float32x3"]), perInstance([1, "float32"])]
const INSECT_VB = [...SPRITE_VB, perInstance([2, "float32"])]
const PARTICLE_VB = [...INSECT_VB, perInstance([3, "float32"])]

// Render target and depth state
// #############################

// G-buffer MRT: gAlbedo, gNormal, gDepth. See gbuffer.inc.wgsl for the layout.
const MRT_TARGETS = [{ format: "rgba8unorm" }, { format: "rgba8unorm" }, { format: GDEPTH_FORMAT }]

const ADDITIVE_BLEND = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
}

const ALPHA_BLEND = {
  color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
}

const DEPTH_WRITE = { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }

const DEPTH_WRITE_SHADOW = {
  format: "depth32float",
  depthWriteEnabled: true,
  depthCompare: "less",
  depthBias: 2,
  depthBiasSlopeScale: 2.0,
  depthBiasClamp: 0.01,
}

const DEPTH_TEST_ONLY = { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" }
const DEPTH_TEST_LEQUAL = { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" }

// For fullscreen passes that share a render pass with depth-tested draws: the
// attachment is declared so the pipeline is compatible, but never read or written.
const DEPTH_IGNORE = { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" }

const primitiveState = (topology = "triangle-list") =>
  topology.endsWith("strip") ? { topology, stripIndexFormat: "uint32" } : { topology }

// Pipeline creation
// #################

export function createAllPipelines(device, presentationFormat) {
  const bindGroupLayout = (label, entries) =>
    device.createBindGroupLayout({ label, entries: entries.map((entry, binding) => ({ binding, ...entry })) })

  const layouts = {
    frame: bindGroupLayout("frame (group 0)", [uniform(VF)]),
    object: bindGroupLayout("object (group 3)", [uniform(V)]),
    empty: bindGroupLayout("empty", []),
  }
  for (const [name, entries] of Object.entries(PASS_ENTRIES)) {
    layouts[name] = bindGroupLayout(`${name} pass`, entries)
  }

  const target = (format, blend) => [{ format, blend }]
  const scene = target(SCENE_FORMAT)
  const sceneAdditive = target(SCENE_FORMAT, ADDITIVE_BLEND)
  const sceneAlpha = target(SCENE_FORMAT, ALPHA_BLEND)
  const bloom = target(bloomChainFormat(device))
  const ao = target("rgba8unorm")
  const dof = target("rgba16float")
  const OBJECT_GROUPS = ["frame", "empty", "empty", "object"]

  // shader → the pipeline's WGSL module (one module serves both entry points).
  // groups → bind group layout names, in group order.
  const specs = {
    grass: { shader: "grass.wgsl", groups: ["frame", "grass"], vb: GRASS_GBUFFER_VB, targets: MRT_TARGETS, depth: DEPTH_WRITE }, // prettier-ignore
    flower: { shader: "flower.wgsl", groups: ["frame", "flower"], vb: FLOWER_VB, targets: MRT_TARGETS, depth: DEPTH_WRITE }, // prettier-ignore
    ground: { shader: "ground.wgsl", groups: ["frame", "ground"], vb: GROUND_VB, targets: MRT_TARGETS, depth: DEPTH_WRITE }, // prettier-ignore
    text: { shader: "text.wgsl", groups: OBJECT_GROUPS, vb: TEXT_VB, targets: MRT_TARGETS, depth: DEPTH_WRITE },
    bike: { shader: "bike.wgsl", groups: OBJECT_GROUPS, vb: BIKE_VB, targets: MRT_TARGETS, depth: DEPTH_WRITE },
    bird: { shader: "bird.wgsl", groups: ["frame", "bird"], vb: BIRD_VB, targets: MRT_TARGETS, depth: DEPTH_WRITE },

    shadow: { shader: "shadow.wgsl", groups: ["frame", "shadow"], vb: GRASS_VB, depth: DEPTH_WRITE_SHADOW },
    shadowText: { shader: "shadow-text.wgsl", groups: OBJECT_GROUPS, vb: SHADOW_TEXT_VB, depth: DEPTH_WRITE_SHADOW }, // prettier-ignore
    birdShadow: { shader: "bird-shadow.wgsl", groups: ["frame", "bird"], vb: BIRD_VB, depth: DEPTH_WRITE_SHADOW },

    // Scene pass. Depth is attached but neither tested nor written by the
    // fullscreen lighting draws: they must cover every pixel, and world position
    // comes from gDepth rather than the depth texture. Attaching it (instead of
    // sampling it) is what lets this pass also hold the sky and the forward
    // effects — see Renderer#renderScenePass.
    deferredLighting: { shader: "deferred-lighting.wgsl", groups: ["frame", "deferredLighting"], targets: scene, depth: DEPTH_IGNORE }, // prettier-ignore
    fireflyLights: { shader: "firefly-lights.wgsl", groups: ["frame", "fireflyLights"], targets: sceneAdditive, depth: DEPTH_IGNORE }, // prettier-ignore
    bikeLights: { shader: "bike-lights.wgsl", groups: ["frame", "bikeLights"], targets: sceneAdditive, depth: DEPTH_IGNORE }, // prettier-ignore
    sky: { shader: "sky.wgsl", groups: ["frame", "sky"], targets: scene, depth: DEPTH_TEST_LEQUAL },
    rain: { shader: "rain.wgsl", groups: ["frame", "rain"], vb: RAIN_VB, targets: sceneAlpha, depth: DEPTH_TEST_ONLY, topology: "line-list" }, // prettier-ignore
    particle: { shader: "particle.wgsl", groups: ["frame", "particle"], vb: PARTICLE_VB, targets: sceneAdditive, depth: DEPTH_TEST_ONLY, topology: "triangle-strip" }, // prettier-ignore
    fireflySprite: { shader: "firefly.wgsl", groups: ["frame", "fireflySprite"], vb: SPRITE_VB, targets: sceneAdditive, depth: DEPTH_TEST_ONLY, topology: "triangle-strip" }, // prettier-ignore
    insect: { shader: "insect.wgsl", groups: ["frame", "insect"], vb: INSECT_VB, targets: sceneAlpha, depth: DEPTH_TEST_ONLY, topology: "triangle-strip" }, // prettier-ignore

    ssao: { shader: "ssao.wgsl", groups: ["frame", "ssao"], targets: ao },
    ssaoBlur: { shader: "ssao-blur.wgsl", groups: ["frame", "ssaoBlur"], targets: ao },
    bloomExtract: { shader: "bloom-extract.wgsl", groups: ["empty", "bloomExtract"], targets: bloom },
    bloomDown: { shader: "bloom-down.wgsl", groups: ["empty", "bloomDown"], targets: bloom },
    bloomUp: { shader: "bloom-up.wgsl", groups: ["empty", "bloomUp"], targets: target(bloom[0].format, ADDITIVE_BLEND) }, // prettier-ignore
    godrays: { shader: "godrays.wgsl", groups: ["frame", "godrays"], targets: ao },
    dofCoc: { shader: "dof-coc.wgsl", groups: ["empty", "dofCoc"], targets: dof },
    dofBlur: { shader: "dof-blur.wgsl", groups: ["empty", "dofBlur"], targets: dof },
    postprocess: { shader: "postprocess.wgsl", groups: ["frame", "postprocess"], targets: target(presentationFormat) }, // prettier-ignore

    mountainBake: { shader: "mountain-bake.wgsl", groups: ["empty"], vb: FULLSCREEN_VB, targets: ao, topology: "triangle-strip" }, // prettier-ignore
    mountainPanoBake: { shader: "mountain-pano-bake.wgsl", groups: ["frame", "mountainPano"], targets: target(MOUNTAIN_PANO_FORMAT) }, // prettier-ignore
    groundBake: { shader: "ground-heightmap-bake.wgsl", groups: ["empty"], vb: FULLSCREEN_VB, targets: ao, topology: "triangle-strip" }, // prettier-ignore
    cloudShadowBake: { shader: "cloud-shadow-bake.wgsl", groups: ["cloudShadowBake"], vb: FULLSCREEN_VB, targets: target("r8unorm"), topology: "triangle-strip" }, // prettier-ignore
  }

  const modules = new Map()
  const shaderModule = name => {
    if (!modules.has(name)) modules.set(name, device.createShaderModule({ label: name, code: SHADERS[name] }))
    return modules.get(name)
  }

  const pipelines = {}
  for (const [name, spec] of Object.entries(specs)) {
    const module = shaderModule(spec.shader)
    pipelines[name] = device.createRenderPipeline({
      label: name,
      layout: device.createPipelineLayout({ bindGroupLayouts: spec.groups.map(group => layouts[group]) }),
      vertex: { module, entryPoint: "vertexMain", buffers: spec.vb ?? [] },
      fragment: { module, entryPoint: "fragmentMain", targets: spec.targets ?? [] },
      depthStencil: spec.depth,
      primitive: primitiveState(spec.topology),
    })
  }

  return { pipelines, layouts }
}

// Bind groups
// ###########
//
// Resources are listed in binding order; the index in the array is the binding.

export function createBindGroup(device, layout, label, resources = []) {
  return device.createBindGroup({
    label,
    layout,
    entries: resources.map((resource, binding) => ({ binding, resource })),
  })
}

// Exported pipeline building blocks for event modules
export { MRT_TARGETS, DEPTH_WRITE, DEPTH_WRITE_SHADOW, DEPTH_TEST_ONLY, ADDITIVE_BLEND }
