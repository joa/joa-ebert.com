// Atmosphere
// ##########
//
// CPU-side Preetham sky model, mirroring sky.frag's atmosphere() function.
// preethamPrecompute() returns 21 distribution coefficients; computeAtmosphereSkyColor()
// evaluates the model to produce the ambient sky tint for surface lighting.

import { smoothstep } from "./math-utils"

function perez(cosTheta, gamma, cosGamma, A, B, C, D, E) {
  return (
    Math.max(0, 1 + A * Math.exp(B / Math.max(cosTheta, 0.035))) *
    (1 + C * Math.exp(D * gamma) + E * cosGamma * cosGamma)
  )
}

export function preethamPrecompute(T, sunDirY) {
  const sunTheta = Math.acos(Math.min(Math.max(sunDirY, 0.01), 1.0))
  const cosSunTheta = Math.max(sunDirY, 0.01)
  const T2 = T * T
  const st = sunTheta,
    st2 = st * st,
    st3 = st2 * st
  const chi = (4.0 / 9.0 - T / 120.0) * (Math.PI - 2.0 * st)
  const pYz = Math.max(0, (4.0453 * T - 4.971) * Math.tan(chi) - 0.2155 * T + 2.4192)
  const pXz =
    (0.00166 * st3 - 0.00375 * st2 + 0.00209 * st) * T2 +
    (-0.02903 * st3 + 0.06377 * st2 - 0.03202 * st + 0.00394) * T +
    (0.11693 * st3 - 0.21196 * st2 + 0.06052 * st + 0.25886)
  const pYzc =
    (0.00275 * st3 - 0.0061 * st2 + 0.00317 * st) * T2 +
    (-0.04214 * st3 + 0.0897 * st2 - 0.04153 * st + 0.00516) * T +
    (0.15346 * st3 - 0.26756 * st2 + 0.0667 * st + 0.26688)
  const AY = 0.1787 * T - 1.463,
    BY = -0.3554 * T + 0.4275
  const CY = -0.0227 * T + 5.3251,
    DY = 0.1206 * T - 2.5771,
    EY = -0.067 * T + 0.3703
  const Ax = -0.0193 * T - 0.2592,
    Bx = -0.0665 * T + 0.0008
  const Cx = -0.0004 * T + 0.2125,
    Dx = -0.0641 * T - 0.8989,
    Ex = -0.0033 * T + 0.0452
  const Ay = -0.0167 * T - 0.2608,
    By = -0.095 * T + 0.0092
  const Cy = -0.0079 * T + 0.2102,
    Dy = -0.0441 * T - 1.6537,
    Ey = -0.0109 * T + 0.0529
  const fY0 = perez(1.0, sunTheta, cosSunTheta, AY, BY, CY, DY, EY)
  const fx0 = perez(1.0, sunTheta, cosSunTheta, Ax, Bx, Cx, Dx, Ex)
  const fy0 = perez(1.0, sunTheta, cosSunTheta, Ay, By, Cy, Dy, Ey)
  return {
    zenith: [pYz, pXz, pYzc],
    fRef: [fY0, fx0, fy0],
    aY: [AY, BY, CY, DY, EY],
    ax: [Ax, Bx, Cx, Dx, Ex],
    ay: [Ay, By, Cy, Dy, Ey],
  }
}

export function preethamPrecomputeArray(T, sunDirY) {
  const { zenith, fRef, aY, ax, ay } = preethamPrecompute(T, sunDirY)

  const [pYz, pXz, pYzc] = zenith
  const [pFY0, pFx0, pFy0] = fRef
  const [pAY, pBY, pCY, pDY, pEY] = aY
  const [pAx, pBx, pCx, pDx, pEx] = ax
  const [pAy, pBy, pCy, pDy, pEy] = ay

  return new Float32Array([
    pYz,
    pXz,
    pYzc,
    pFY0,
    pFx0,
    pFy0,
    pAY,
    pBY,
    pCY,
    pDY,
    pEY,
    pAx,
    pBx,
    pCx,
    pDx,
    pEx,
    pAy,
    pBy,
    pCy,
    pDy,
    pEy,
  ])
}

// Mirrors sky.frag atmosphere(): blends keyframed night colors ↔ Preetham day
// colors using the same smoothstep on sun elevation. Samples at ~60° above
// horizon (dir=[0, 0.87, 0.5] normalized) for a representative ambient color.
export function computeAtmosphereSkyColor(timeInfo) {
  const sun = timeInfo.sunPosition
  const sunElev = sun.y
  const zenith = timeInfo.zenithColor
  const horizon = timeInfo.horizonColor
  const elev = 0.87
  const t = Math.pow(Math.max(0, Math.min(1, elev)), 0.5)
  const nightR = horizon.r + (zenith.r - horizon.r) * t
  const nightG = horizon.g + (zenith.g - horizon.g) * t
  const nightB = horizon.b + (zenith.b - horizon.b) * t

  if (sunElev <= -0.1) return { r: nightR, g: nightG, b: nightB }

  const dirY = 0.87,
    dirZ = 0.5
  const len = Math.sqrt(dirY * dirY + dirZ * dirZ)
  const day = preethamSkyRGB(
    0,
    dirY / len,
    dirZ / len,
    sun.x,
    sun.y,
    sun.z,
    timeInfo.turbidity ?? 2.5,
    timeInfo.overcast ?? 0.0
  )
  const raw = Math.max(0, Math.min(1, (sunElev + 0.1) / 0.25))
  const blend = smoothstep(raw)

  return {
    r: nightR + (day.r - nightR) * blend,
    g: nightG + (day.g - nightG) * blend,
    b: nightB + (day.b - nightB) * blend,
  }
}

function preethamSkyRGB(dirX, dirY, dirZ, sunX, sunY, sunZ, T, overcast = 0.0) {
  const sunTheta = Math.acos(Math.max(0.01, Math.min(1, sunY)))
  const cosTheta = Math.max(dirY, 0.01)
  const cosGamma = Math.max(-1, Math.min(1, dirX * sunX + dirY * sunY + dirZ * sunZ))
  const gamma = Math.acos(cosGamma)
  const cosSunTheta = Math.max(sunY, 0.01)
  const T2 = T * T
  const st = sunTheta,
    st2 = st * st,
    st3 = st2 * st
  const chi = (4 / 9 - T / 120) * (Math.PI - 2 * st)
  const Yz = Math.max(0, (4.0453 * T - 4.971) * Math.tan(chi) - 0.2155 * T + 2.4192)
  const xz =
    (0.00166 * st3 - 0.00375 * st2 + 0.00209 * st) * T2 +
    (-0.02903 * st3 + 0.06377 * st2 - 0.03202 * st + 0.00394) * T +
    (0.11693 * st3 - 0.21196 * st2 + 0.06052 * st + 0.25886)
  const yz =
    (0.00275 * st3 - 0.0061 * st2 + 0.00317 * st) * T2 +
    (-0.04214 * st3 + 0.0897 * st2 - 0.04153 * st + 0.00516) * T +
    (0.15346 * st3 - 0.26756 * st2 + 0.0667 * st + 0.26688)
  const AY = 0.1787 * T - 1.463,
    BY = -0.3554 * T + 0.4275
  const CY = -0.0227 * T + 5.3251,
    DY = 0.1206 * T - 2.5771,
    EY = -0.067 * T + 0.3703
  const Ax = -0.0193 * T - 0.2592,
    Bx = -0.0665 * T + 0.0008
  const Cx = -0.0004 * T + 0.2125,
    Dx = -0.0641 * T - 0.8989,
    Ex = -0.0033 * T + 0.0452
  const Ay = -0.0167 * T - 0.2608,
    By = -0.095 * T + 0.0092
  const Cy = -0.0079 * T + 0.2102,
    Dy = -0.0441 * T - 1.6537,
    Ey = -0.0109 * T + 0.0529
  const fY = perez(cosTheta, gamma, cosGamma, AY, BY, CY, DY, EY)
  const fY0 = perez(1, sunTheta, cosSunTheta, AY, BY, CY, DY, EY)
  const fx = perez(cosTheta, gamma, cosGamma, Ax, Bx, Cx, Dx, Ex)
  const fx0 = perez(1, sunTheta, cosSunTheta, Ax, Bx, Cx, Dx, Ex)
  const fy = perez(cosTheta, gamma, cosGamma, Ay, By, Cy, Dy, Ey)
  const fy0 = perez(1, sunTheta, cosSunTheta, Ay, By, Cy, Dy, Ey)
  const Y = (Yz * fY) / Math.max(fY0, 0.001)
  const x = (xz * fx) / Math.max(fx0, 0.001)
  const y = (yz * fy) / Math.max(fy0, 0.001)
  const clear = xyYToRgb(x, y, Y)
  const overcastY = Yz * ((1 + 2 * cosTheta) / 3)
  const cast = xyYToRgb(xz, yz, overcastY)
  const t = Math.max(0, Math.min(1, overcast))
  return {
    r: clear.r + (cast.r - clear.r) * t,
    g: clear.g + (cast.g - clear.g) * t,
    b: clear.b + (cast.b - clear.b) * t,
  }
}

function xyYToRgb(x, y, Y) {
  const yInv = Y / Math.max(y, 0.001)
  const X = yInv * x
  const Z = yInv * (1 - x - y)
  return {
    r: Math.max(0, (3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z) * 0.04),
    g: Math.max(0, (-0.969266 * X + 1.8760108 * Y + 0.041556 * Z) * 0.04),
    b: Math.max(0, (0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z) * 0.04),
  }
}
