import { smoothstep } from "../shared/math-utils.js"
import { NOISE_TEX_DEPTH, NOISE_TEX_HEIGHT, NOISE_TEX_WIDTH } from "./gpu-buffers.js"

function recordBakePass(encoder, pipeline, view, fullscreenQuad, bindGroup) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
  })
  pass.setPipeline(pipeline)
  if (bindGroup) pass.setBindGroup(0, bindGroup)
  pass.setVertexBuffer(0, fullscreenQuad.vertices)
  pass.setVertexBuffer(1, fullscreenQuad.uvs)
  pass.draw(fullscreenQuad.vertexCount)
  pass.end()
}

function runBakePass(device, pipeline, colorTexture, fullscreenQuad, bindGroup, cachedView) {
  const encoder = device.createCommandEncoder()
  recordBakePass(encoder, pipeline, cachedView ?? colorTexture.createView(), fullscreenQuad, bindGroup)
  device.queue.submit([encoder.finish()])
}

export function bakeMountainHeightmap(device, pipeline, texture, fullscreenQuad, bindGroup) {
  runBakePass(device, pipeline, texture, fullscreenQuad, bindGroup)
}

export function bakeGroundHeightmap(device, pipeline, texture, fullscreenQuad, bindGroup) {
  runBakePass(device, pipeline, texture, fullscreenQuad, bindGroup)
}

const CLOUD_SHADOW_UNIFORM_SIZE = 64
const _cloudShadowData = new Float32Array(CLOUD_SHADOW_UNIFORM_SIZE / 4)

export function createCloudShadowUniformBuffer(device) {
  return device.createBuffer({
    size: CLOUD_SHADOW_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
}

export function writeCloudShadowUniforms(device, uniformBuffer, ctx, windUniforms) {
  // struct CloudShadowBakeUniforms: sunDir(vec3f@0), cloudBase(f32@12),
  //   cloudCoverage(f32@16), windStrength(f32@20), windDir(vec2f@24), time(f32@32)
  const d = _cloudShadowData
  d[0] = ctx.primaryLightDir.x
  d[1] = ctx.primaryLightDir.y
  d[2] = ctx.primaryLightDir.z
  d[3] = ctx.timeInfo.cloudBase
  d[4] = ctx.timeInfo.cloudCoverage
  d[5] = windUniforms.windStrength
  d[6] = windUniforms.windDirection[0]
  d[7] = windUniforms.windDirection[1]
  d[8] = ctx.nowSec
  device.queue.writeBuffer(uniformBuffer, 0, d)
}

export function bakeCloudShadow(device, pipeline, texture, fullscreenQuad, bindGroup, cachedView) {
  runBakePass(device, pipeline, texture, fullscreenQuad, bindGroup, cachedView)
}

export function recordCloudShadowBake(encoder, pipeline, fullscreenQuad, bindGroup, cachedView) {
  recordBakePass(encoder, pipeline, cachedView, fullscreenQuad, bindGroup)
}

export function computeSunVisibility(sunDir, origin, mountainHeightmap) {
  if (!mountainHeightmap.ready) return 1.0
  if (sunDir.y <= 0.0) return 0.0
  const T_NEAR = 400,
    T_FAR = 7000,
    STEPS = 16
  const dt = (T_FAR - T_NEAR) / STEPS
  const [ox, oy, oz] = origin
  const { x: sx, y: sy, z: sz } = sunDir
  let min = Infinity
  for (let i = 0; i < STEPS; i++) {
    const t = T_NEAR + (i + 0.5) * dt
    const c = oy + sy * t - mountainHeightmap.sampleBilinear(ox + sx * t, oz + sz * t, 420)
    if (c < min) min = c
  }
  return smoothstep((min + 20.0) / 80.0)
}

// NOTE: This is a CPU version of sky.wgsl's renderClouds and cloudDensity.
//       You MUST always keep this in sync when updating sky.wgsl.
//       The authority is always sky.wgsl.
const NOISE_WRAP_SCALE = 32
const NOISE_SIZE_X = NOISE_TEX_WIDTH
const NOISE_SIZE_Y = NOISE_TEX_HEIGHT
const NOISE_SIZE_Z = NOISE_TEX_DEPTH

function sampleNoise3D(data, u, v, w) {
  u = ((u % 1) + 1) % 1
  v = ((v % 1) + 1) % 1
  w = ((w % 1) + 1) % 1
  const fx = u * NOISE_SIZE_X - 0.5,
    fy = v * NOISE_SIZE_Y - 0.5,
    fz = w * NOISE_SIZE_Z - 0.5
  const ix = Math.floor(fx),
    iy = Math.floor(fy),
    iz = Math.floor(fz)
  const dx = fx - ix,
    dy = fy - iy,
    dz = fz - iz
  const wrapX = c => ((c % NOISE_SIZE_X) + NOISE_SIZE_X) % NOISE_SIZE_X
  const wrapY = c => ((c % NOISE_SIZE_Y) + NOISE_SIZE_Y) % NOISE_SIZE_Y
  const wrapZ = c => ((c % NOISE_SIZE_Z) + NOISE_SIZE_Z) % NOISE_SIZE_Z
  const at = (x, y, z) => data[(wrapZ(z) * NOISE_SIZE_Y + wrapY(y)) * NOISE_SIZE_X + wrapX(x)] / 255
  return (
    at(ix, iy, iz) * (1 - dx) * (1 - dy) * (1 - dz) +
    at(ix + 1, iy, iz) * dx * (1 - dy) * (1 - dz) +
    at(ix, iy + 1, iz) * (1 - dx) * dy * (1 - dz) +
    at(ix + 1, iy + 1, iz) * dx * dy * (1 - dz) +
    at(ix, iy, iz + 1) * (1 - dx) * (1 - dy) * dz +
    at(ix + 1, iy, iz + 1) * dx * (1 - dy) * dz +
    at(ix, iy + 1, iz + 1) * (1 - dx) * dy * dz +
    at(ix + 1, iy + 1, iz + 1) * dx * dy * dz
  )
}

function skyNoise3(data, px, py, pz, timeSec) {
  return sampleNoise3D(
    data,
    (px + timeSec * 0.0001) / NOISE_WRAP_SCALE,
    py / NOISE_WRAP_SCALE,
    (pz + timeSec * 0.00011) / NOISE_WRAP_SCALE
  )
}

function skyFbm5(data, px, py, pz, timeSec) {
  let f = 0,
    amp = 0.5
  for (let i = 0; i < 4; i++) {
    f += skyNoise3(data, px, py, pz, timeSec) * amp
    px = px * 2.02 + 5.1
    py = py * 2.02 + 1.3
    pz = pz * 2.02 + 3.7
    amp *= 0.5
  }
  return f
}

function skyFbmDetail4(data, px, py, pz, timeSec) {
  let f = 0,
    amp = 0.5
  for (let i = 0; i < 3; i++) {
    f += skyNoise3(data, px, py, pz, timeSec) * amp
    px = px * 2.05 + 1.7
    py = py * 2.05 + 9.2
    pz = pz * 2.05 + 5.3
    amp *= 0.5
  }
  return f
}

function cpuCloudDensity(data, px, py, pz, timeSec, cloudBase, cloudTop, coverage, windX, windZ) {
  if (py < cloudBase || py > cloudTop) return 0
  const relH = (py - cloudBase) / (cloudTop - cloudBase)
  const sat = x => Math.min(1, Math.max(0, x))
  const vEnv = smoothstep(sat(relH / 0.15)) * smoothstep(sat((1 - relH) / 0.6))
  const scale = 1 / 45
  const qx = px * scale + windX,
    qy = py * scale,
    qz = pz * scale + windZ
  const base = skyFbm5(data, qx, qy, qz, timeSec)
  const detail = skyFbm5(data, qx * 3 + 0.5, qy * 3 + 1.7, qz * 3 + 3.1, timeSec)
  const detail2 = skyFbmDetail4(data, qx * 6.5 + 2.3, qy * 6.5 + 0.8, qz * 6.5 + 4.1, timeSec)
  const erode = (detail * 0.7 + detail2 * 0.3) * 0.25 * (1 - smoothstep(sat((base - coverage) / 0.15)))
  const shaped = base - erode
  return smoothstep(sat((shaped - coverage) / 0.08)) * vEnv
}

export function computeCloudLightOcclusion(ctx, noiseData, windUniforms, prevOcclusion) {
  if (!noiseData) return 1.0
  const { x: sx, y: sy, z: sz } = ctx.primaryLightDir
  if (sy <= 0.01) return 1.0
  const { cloudBase, cloudTop, cloudCoverage: coverage } = ctx.timeInfo
  const [cx, cy, cz] = ctx.cameraPosition
  const timeSec = ctx.nowSec
  const windX = windUniforms.windDirection[0] * windUniforms.windStrength * timeSec * 0.0008
  const windZ = windUniforms.windDirection[1] * windUniforms.windStrength * timeSec * 0.0008
  const tBot = (cloudBase - cy) / sy
  const tTop = (cloudTop - cy) / sy
  if (tBot < 0 && tTop < 0) return 1.0
  const tMin = Math.max(Math.min(tBot, tTop), 0)
  const tMax = Math.max(tBot, tTop)
  const STEPS = 4
  const dt = (tMax - tMin) / STEPS
  let totalDensity = 0
  for (let i = 0; i < STEPS; i++) {
    const t = tMin + (i + 0.5) * dt
    totalDensity += cpuCloudDensity(
      noiseData,
      cx + sx * t,
      cy + sy * t,
      cz + sz * t,
      timeSec,
      cloudBase,
      cloudTop,
      coverage,
      windX,
      windZ
    )
  }
  const target = 1.0 - (totalDensity / STEPS) * 0.75
  return prevOcclusion + (target - prevOcclusion) * 0.08
}
