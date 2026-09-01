import { smoothstep } from "../shared/math-utils.js"
import { NOISE_TEX_DEPTH, NOISE_TEX_HEIGHT, NOISE_TEX_WIDTH } from "./gpu-buffers.js"

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
const NOISE_WRAP_SCALE = 32
const CLOUD_OVERSHOOT = 0.2 // clouds spill this fraction of slab height past base/top (mirrors sky.wgsl)
const NOISE_SIZE_X = NOISE_TEX_WIDTH
const NOISE_SIZE_Y = NOISE_TEX_HEIGHT
const NOISE_SIZE_Z = NOISE_TEX_DEPTH

// Hoisted from sampleNoise3D — defining these as closures per call created
// ~176 short-lived functions per throttled lighting frame.
const wrapX = c => ((c % NOISE_SIZE_X) + NOISE_SIZE_X) % NOISE_SIZE_X
const wrapY = c => ((c % NOISE_SIZE_Y) + NOISE_SIZE_Y) % NOISE_SIZE_Y
const wrapZ = c => ((c % NOISE_SIZE_Z) + NOISE_SIZE_Z) % NOISE_SIZE_Z
const noiseAt = (data, x, y, z) => data[(wrapZ(z) * NOISE_SIZE_Y + wrapY(y)) * NOISE_SIZE_X + wrapX(x)] / 255

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
  return (
    noiseAt(data, ix, iy, iz) * (1 - dx) * (1 - dy) * (1 - dz) +
    noiseAt(data, ix + 1, iy, iz) * dx * (1 - dy) * (1 - dz) +
    noiseAt(data, ix, iy + 1, iz) * (1 - dx) * dy * (1 - dz) +
    noiseAt(data, ix + 1, iy + 1, iz) * dx * dy * (1 - dz) +
    noiseAt(data, ix, iy, iz + 1) * (1 - dx) * (1 - dy) * dz +
    noiseAt(data, ix + 1, iy, iz + 1) * dx * (1 - dy) * dz +
    noiseAt(data, ix, iy + 1, iz + 1) * (1 - dx) * dy * dz +
    noiseAt(data, ix + 1, iy + 1, iz + 1) * dx * dy * dz
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

// Mirrors cascadeFbm() in sky.wgsl.
const FBM5_MEAN = 0.4682
const CASCADE_MEAN = 0.9976
const CASCADE_GAIN = 0.2695

function skyCascadeFbm(data, px, py, pz, timeSec) {
  let f = 1,
    weight = 0.85
  for (let i = 0; i < 4; i++) {
    f *= 1 + weight * (2 * skyNoise3(data, px, py, pz, timeSec) - 1)
    px = px * 2.02 + 5.1
    py = py * 2.02 + 1.3
    pz = pz * 2.02 + 3.7
    weight *= 0.6
  }
  return FBM5_MEAN + (f - CASCADE_MEAN) * CASCADE_GAIN
}

// Mirrors weatherField() in sky.wgsl.
function cpuWeatherField(data, qx, qz, timeSec, clumpScale) {
  const cellsPerQ = 45 / clumpScale
  const boil = timeSec * 0.0001
  let px = (qx + boil) * cellsPerQ,
    py = 21.7 * cellsPerQ,
    pz = (qz + boil * 1.1) * cellsPerQ
  let f = 0,
    amp = 0.5
  for (let i = 0; i < 3; i++) {
    f += sampleNoise3D(data, px / NOISE_WRAP_SCALE, py / NOISE_WRAP_SCALE, pz / NOISE_WRAP_SCALE) * amp
    px = px * 2.03 + 3.3
    py = py * 2.03 + 7.1
    pz = pz * 2.03 + 1.9
    amp *= 0.5
  }
  return smoothstep(Math.min(1, Math.max(0, (f / 0.875 - 0.3) / 0.4)))
}

function cpuCloudDensity(data, px, py, pz, timeSec, cloud, windX, windZ) {
  const { cloudBase, cloudTop, cloudCoverage, cloudClumping, cloudClumpScale } = cloud
  const margin = (cloudTop - cloudBase) * CLOUD_OVERSHOOT
  const wobble = (skyFbm5(data, px / 260 + 8.3, py / 260, pz / 260 + 2.1, timeSec) - 0.47) * margin
  const slabBase = cloudBase + wobble
  const slabTop = cloudTop + wobble
  if (py < slabBase || py > slabTop) return 0
  const sat = x => Math.min(1, Math.max(0, x))
  const scale = 1 / 45
  const qx = px * scale + windX,
    qy = py * scale,
    qz = pz * scale + windZ

  const weather = cpuWeatherField(data, qx, qz, timeSec, cloudClumpScale)
  const coverage = sat(cloudCoverage - (weather - 0.5) * cloudClumping)
  const ceiling = 0.7 + 0.3 * weather

  const relH = (py - slabBase) / (slabTop - slabBase)
  const vEnv =
    smoothstep(sat(relH / (0.15 * ceiling))) * (1 - smoothstep(sat((relH - ceiling * 0.4) / (ceiling * 0.6))))
  const base = skyCascadeFbm(data, qx, qy, qz, timeSec)
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
