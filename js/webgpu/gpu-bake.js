import { smoothstep } from "../shared/math-utils.js"
import {
  NOISE_CHANNELS,
  NOISE_CH_BASE,
  NOISE_CH_DETAIL,
  NOISE_CH_WEATHER,
  NOISE_TEX_DEPTH,
  NOISE_TEX_HEIGHT,
  NOISE_TEX_WIDTH,
} from "./gpu-buffers.js"

// Fullscreen quad draw into `view`, used by every bake pipeline.
export function recordBake(encoder, pipeline, view, fullscreenQuad, bindGroup) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
  })
  pass.setPipeline(pipeline)
  if (bindGroup) pass.setBindGroup(0, bindGroup)
  const streams = fullscreenQuad.streams
  for (let slot = 0; slot < streams.length; slot++) pass.setVertexBuffer(slot, streams[slot])
  pass.draw(fullscreenQuad.vertexCount)
  pass.end()
}

// One-shot bake, submitted on its own command buffer at startup.
export function bakeOnce(device, pipeline, target, fullscreenQuad, bindGroup) {
  const encoder = device.createCommandEncoder()
  recordBake(encoder, pipeline, target.createView(), fullscreenQuad, bindGroup)
  device.queue.submit([encoder.finish()])
}

// struct CloudShadowBakeUniforms: sunDir(vec3f@0), cloudBase(f32@12),
//   cloudCoverage(f32@16), windStrength(f32@20), windDir(vec2f@24), time(f32@32),
//   cloudClumping(f32@36), cloudClumpScale(f32@40)
export function writeCloudShadowUniforms(uniforms, ctx, windUniforms) {
  const f = uniforms.f
  f[0] = ctx.primaryLightDir.x
  f[1] = ctx.primaryLightDir.y
  f[2] = ctx.primaryLightDir.z
  f[3] = ctx.timeInfo.cloudBase
  f[4] = ctx.timeInfo.cloudCoverage
  f[5] = windUniforms.windStrength
  f[6] = windUniforms.windDirection[0]
  f[7] = windUniforms.windDirection[1]
  f[8] = ctx.nowSec
  f[9] = ctx.timeInfo.cloudClumping
  f[10] = ctx.timeInfo.cloudClumpScale
  uniforms.write()
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
const CLOUD_OVERSHOOT = 0.2 // clouds spill this fraction of slab height past base/top (mirrors sky.wgsl)
const NOISE_SIZE_X = NOISE_TEX_WIDTH
const NOISE_SIZE_Y = NOISE_TEX_HEIGHT
const NOISE_SIZE_Z = NOISE_TEX_DEPTH

// Mirrors the sky.wgsl cloud sampling constants.
const CLOUD_DRIFT_QX = 0.1
const CLOUD_DRIFT_QZ = 0.11
const BASE_TILE_Q = 8.0
const DETAIL_TILE_Q = 4.0
const WOBBLE_TILE_Q = 23.0

// Hoisted from sampleNoise3D — defining these as closures per call created
// ~176 short-lived functions per throttled lighting frame.
const wrapX = c => ((c % NOISE_SIZE_X) + NOISE_SIZE_X) % NOISE_SIZE_X
const wrapY = c => ((c % NOISE_SIZE_Y) + NOISE_SIZE_Y) % NOISE_SIZE_Y
const wrapZ = c => ((c % NOISE_SIZE_Z) + NOISE_SIZE_Z) % NOISE_SIZE_Z
const noiseAt = (data, x, y, z, ch) =>
  data[((wrapZ(z) * NOISE_SIZE_Y + wrapY(y)) * NOISE_SIZE_X + wrapX(x)) * NOISE_CHANNELS + ch] / 255

function sampleNoise3D(data, u, v, w, ch) {
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
  return (
    noiseAt(data, ix, iy, iz, ch) * (1 - dx) * (1 - dy) * (1 - dz) +
    noiseAt(data, ix + 1, iy, iz, ch) * dx * (1 - dy) * (1 - dz) +
    noiseAt(data, ix, iy + 1, iz, ch) * (1 - dx) * dy * (1 - dz) +
    noiseAt(data, ix + 1, iy + 1, iz, ch) * dx * dy * (1 - dz) +
    noiseAt(data, ix, iy, iz + 1, ch) * (1 - dx) * (1 - dy) * dz +
    noiseAt(data, ix + 1, iy, iz + 1, ch) * dx * (1 - dy) * dz +
    noiseAt(data, ix, iy + 1, iz + 1, ch) * (1 - dx) * dy * dz +
    noiseAt(data, ix + 1, iy + 1, iz + 1, ch) * dx * dy * dz
  )
}

// Mirrors cloudTexAt() in sky.wgsl for one channel.
function cloudTexAt(data, qx, qy, qz, tileQ, ch, timeSec) {
  return sampleNoise3D(
    data,
    (qx + CLOUD_DRIFT_QX * timeSec) / tileQ,
    qy / tileQ,
    (qz + CLOUD_DRIFT_QZ * timeSec) / tileQ,
    ch
  )
}

// Mirrors weatherField() in sky.wgsl.
function cpuWeatherField(data, qx, qz, timeSec, clumpScale) {
  const tileQ = (4 * clumpScale) / 45
  const a = cloudTexAt(data, qx, 21.7, qz, tileQ, NOISE_CH_WEATHER, timeSec)
  return smoothstep(Math.min(1, Math.max(0, (a - 0.3) / 0.4)))
}

function cpuCloudDensity(data, px, py, pz, timeSec, cloud, windX, windZ) {
  const { cloudBase, cloudTop, cloudCoverage, cloudClumping, cloudClumpScale } = cloud
  const margin = (cloudTop - cloudBase) * CLOUD_OVERSHOOT
  const q0x = px / 45,
    q0y = py / 45,
    q0z = pz / 45
  const wobble = (cloudTexAt(data, q0x + 8.3, q0y, q0z + 2.1, WOBBLE_TILE_Q, NOISE_CH_WEATHER, timeSec) - 0.5) * margin
  const slabBase = cloudBase + wobble
  const slabTop = cloudTop + wobble
  if (py < slabBase || py > slabTop) return 0
  const sat = x => Math.min(1, Math.max(0, x))
  const qx = q0x + windX,
    qy = q0y,
    qz = q0z + windZ

  const weather = cpuWeatherField(data, qx, qz, timeSec, cloudClumpScale)
  const coverage = sat(cloudCoverage - (weather - 0.5) * cloudClumping)
  const ceiling = 0.7 + 0.3 * weather

  const relH = (py - slabBase) / (slabTop - slabBase)
  const vEnv =
    smoothstep(sat(relH / (0.15 * ceiling))) * (1 - smoothstep(sat((relH - ceiling * 0.5) / (ceiling * 0.5))))
  const base = cloudTexAt(data, qx, qy, qz, BASE_TILE_Q, NOISE_CH_BASE, timeSec)
  const detail = cloudTexAt(data, qx, qy, qz, DETAIL_TILE_Q, NOISE_CH_DETAIL, timeSec)
  const edgeBand = 1 - smoothstep(sat((base - coverage - 0.04) / 0.26))
  const shaped = base - (1 - detail) * 0.38 * edgeBand
  return smoothstep(sat((shaped - coverage) / 0.08)) * vEnv
}

export function computeCloudLightOcclusion(ctx, noiseData, windUniforms, prevOcclusion) {
  if (!noiseData) return 1.0
  const { x: sx, y: sy, z: sz } = ctx.primaryLightDir
  if (sy <= 0.01) return 1.0
  const { cloudBase, cloudTop } = ctx.timeInfo
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
      ctx.timeInfo,
      windX,
      windZ
    )
  }
  const target = 1.0 - (totalDensity / STEPS) * 0.75
  return prevOcclusion + (target - prevOcclusion) * 0.08
}
