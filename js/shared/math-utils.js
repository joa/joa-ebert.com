export function normalize([x, y, z]) {
  const len = Math.sqrt(x * x + y * y + z * z)
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 0]
}

export function subtract(a, b) {
  const [ax, ay, az] = a
  const [bx, by, bz] = b
  return [ax - bx, ay - by, az - bz]
}

export function cross(a, b) {
  const [ax, ay, az] = a
  const [bx, by, bz] = b
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
}

export function dot(a, b) {
  const [ax, ay, az] = a
  const [bx, by, bz] = b
  return ax * bx + ay * by + az * bz
}

export function multiplyMV(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ]
}

export function multiplyMM(a, b) {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15] = a
  const [b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15] = b
  return [
    a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3,
    a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3,
    a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3,
    a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3,
    a0 * b4 + a4 * b5 + a8 * b6 + a12 * b7,
    a1 * b4 + a5 * b5 + a9 * b6 + a13 * b7,
    a2 * b4 + a6 * b5 + a10 * b6 + a14 * b7,
    a3 * b4 + a7 * b5 + a11 * b6 + a15 * b7,
    a0 * b8 + a4 * b9 + a8 * b10 + a12 * b11,
    a1 * b8 + a5 * b9 + a9 * b10 + a13 * b11,
    a2 * b8 + a6 * b9 + a10 * b10 + a14 * b11,
    a3 * b8 + a7 * b9 + a11 * b10 + a15 * b11,
    a0 * b12 + a4 * b13 + a8 * b14 + a12 * b15,
    a1 * b12 + a5 * b13 + a9 * b14 + a13 * b15,
    a2 * b12 + a6 * b13 + a10 * b14 + a14 * b15,
    a3 * b12 + a7 * b13 + a11 * b14 + a15 * b15,
  ]
}

export function perspectiveMatrixWebGPU(fov, aspect, near, far) {
  const f = 1.0 / Math.tan(fov / 2)
  const rangeInv = 1.0 / (near - far)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * rangeInv, -1, 0, 0, near * far * rangeInv, 0]
}

export function lookAtMatrix(eye, target, up) {
  const z = normalize(subtract(eye, target))
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]
}

export function orthographicMatrixWebGPU(left, right, bottom, top, near, far) {
  const rl = right - left
  const tb = top - bottom
  const fn_ = far - near
  return [
    2 / rl, 0, 0, 0,
    0, 2 / tb, 0, 0,
    0, 0, -1 / fn_, 0,
    -(right + left) / rl, -(top + bottom) / tb, -near / fn_, 1,
  ]
}

export function invertMatrix4(m) {
  const out = new Float32Array(16)
  const [m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33] = m
  const b00 = m00 * m11 - m10 * m01, b01 = m00 * m21 - m20 * m01
  const b02 = m00 * m31 - m30 * m01, b03 = m10 * m21 - m20 * m11
  const b04 = m10 * m31 - m30 * m11, b05 = m20 * m31 - m30 * m21
  const b06 = m02 * m13 - m12 * m03, b07 = m02 * m23 - m22 * m03
  const b08 = m02 * m33 - m32 * m03, b09 = m12 * m23 - m22 * m13
  const b10 = m12 * m33 - m32 * m13, b11 = m22 * m33 - m32 * m23
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) return m
  det = 1.0 / det
  out[0] = (m11 * b11 - m21 * b10 + m31 * b09) * det
  out[1] = (m20 * b10 - m10 * b11 - m30 * b09) * det
  out[2] = (m13 * b05 - m23 * b04 + m33 * b03) * det
  out[3] = (m22 * b04 - m12 * b05 - m32 * b03) * det
  out[4] = (m21 * b08 - m01 * b11 - m31 * b07) * det
  out[5] = (m00 * b11 - m20 * b08 + m30 * b07) * det
  out[6] = (m23 * b02 - m03 * b05 - m33 * b01) * det
  out[7] = (m02 * b05 - m22 * b02 + m32 * b01) * det
  out[8] = (m01 * b10 - m11 * b08 + m31 * b06) * det
  out[9] = (m10 * b08 - m00 * b10 - m30 * b06) * det
  out[10] = (m03 * b04 - m13 * b02 + m33 * b00) * det
  out[11] = (m12 * b02 - m02 * b04 - m32 * b00) * det
  out[12] = (m11 * b07 - m01 * b09 - m21 * b06) * det
  out[13] = (m00 * b09 - m10 * b07 + m20 * b06) * det
  out[14] = (m13 * b01 - m03 * b03 - m23 * b00) * det
  out[15] = (m02 * b03 - m12 * b01 + m22 * b00) * det
  return out
}

export function mulQuat(a, b) {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export function normalizeQuat([x, y, z, w]) {
  const len = Math.sqrt(x * x + y * y + z * z + w * w)
  return len > 0 ? [x / len, y / len, z / len, w / len] : [0, 0, 0, 1]
}

export function conjugateQuat(q) {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function quatFromAxisAngle(axis, angle) {
  const half = angle * 0.5
  const s = Math.sin(half)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]
}

export function quatRotateVec(q, v) {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ]
}

export function slerpQuat(a, b, t) {
  const [ax, ay, az, aw] = a
  let [bx, by, bz, bw] = b
  let cosHalf = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw
  // flip b to take the short arc
  if (cosHalf < 0) {
    cosHalf = -cosHalf
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }
  let s0, s1
  if (cosHalf > 0.9999) {
    s0 = 1 - t
    s1 = t
  } else {
    const halfAngle = Math.acos(cosHalf)
    const sinHalf = Math.sqrt(1 - cosHalf * cosHalf)
    s0 = Math.sin((1 - t) * halfAngle) / sinHalf
    s1 = Math.sin(t * halfAngle) / sinHalf
  }
  return normalizeQuat([ax * s0 + bx * s1, ay * s0 + by * s1, az * s0 + bz * s1, aw * s0 + bw * s1])
}

export function quatLookAt(forward, up) {
  const f = normalize(forward)
  const r = normalize(cross(f, up)) // right
  const u = cross(r, f)             // camUp
  const m00 = r[0], m01 = u[0], m02 = -f[0]
  const m10 = r[1], m11 = u[1], m12 = -f[1]
  const m20 = r[2], m21 = u[2], m22 = -f[2]
  const trace = m00 + m11 + m22
  let qx, qy, qz, qw
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    qw = 0.25 / s
    qx = (m21 - m12) * s
    qy = (m02 - m20) * s
    qz = (m10 - m01) * s
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    qw = (m21 - m12) / s
    qx = 0.25 * s
    qy = (m01 + m10) / s
    qz = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    qw = (m02 - m20) / s
    qx = (m01 + m10) / s
    qy = 0.25 * s
    qz = (m12 + m21) / s
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    qw = (m10 - m01) / s
    qx = (m02 + m20) / s
    qy = (m12 + m21) / s
    qz = 0.25 * s
  }
  return normalizeQuat([qx, qy, qz, qw])
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

export function easeInOutQuad(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

export function smoothstep2(a, b, x) {
   x = clamp((x - a) / (b - a))
   return x * x * (3.0 - 2.0 * x)
}

function clamp(x, lower = 0.0, upper = 1.0) {
  if (x < lower) return lower
  if (x > upper) return upper
  return x
}