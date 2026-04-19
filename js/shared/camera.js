// Camera
// ######
//
// Quaternion-based first-person camera with pointer-lock mouse look, WASD movement,
// and exponential roll decay. Orientation is stored as a unit quaternion; yaw/pitch
// are kept in sync for input clamping. lookAtLerp() slerps with roll preserved.

import {
  lookAtMatrix,
  normalize,
  quatFromAxisAngle,
  mulQuat,
  quatRotateVec,
  slerpQuat,
  quatLookAt,
} from "./math-utils.js"
import S from "./settings.js"

const HALF_PI = Math.PI / 2 - 0.001

// Enable device orientation (gyroscope) panorama control for mobile.
// When true, tilting/rotating the physical device pans the camera view.
// Tap the canvas to recalibrate the neutral orientation.
const GYRO_ENABLED = true

export class Camera {
  position = [...S.initPos]
  speed = 2.0
  mouseSensitivity = 0.002
  #canvas
  #yaw = Math.PI
  #pitch = 0.25
  #roll = 0.0
  #orientation
  #keys = new Set()
  #locked = false
  #lockedOnce = false
  #gyroYaw = 0
  #gyroPitch = 0
  #gyroRef = null
  #isTouching = false
  #touchLastX = 0
  #touchLastY = 0
  #ac = new AbortController()

  constructor(canvas) {
    this.#canvas = canvas
    this.#bindEvents()
    this.#syncQuatFromEuler()
    if (GYRO_ENABLED) this.#initGyro()
  }

  #buildQuat(yaw, pitch, roll) {
    const q = mulQuat(quatFromAxisAngle([0, -1, 0], yaw), quatFromAxisAngle([1, 0, 0], pitch))
    return roll ? mulQuat(q, quatFromAxisAngle([0, 0, 1], roll)) : q
  }

  #syncQuatFromEuler() {
    this.#orientation = this.#buildQuat(this.#yaw, this.#pitch, this.#roll)
  }

  #syncEulerFromQuat() {
    const [qx, qy, qz, qw] = this.#orientation
    this.#pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (qw * qx - qy * qz))))
    this.#yaw = Math.atan2(-2 * (qw * qy + qx * qz), 1 - 2 * (qy * qy + qz * qz))
    this.#roll = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qx * qx + qz * qz))
  }

  get #effectiveOrientation() {
    if (this.#gyroYaw === 0 && this.#gyroPitch === 0) return this.#orientation
    const gyroQ = mulQuat(quatFromAxisAngle([0, -1, 0], this.#gyroYaw), quatFromAxisAngle([1, 0, 0], this.#gyroPitch))
    return mulQuat(gyroQ, this.#orientation)
  }

  get forward() {
    return quatRotateVec(this.#effectiveOrientation, [0, 0, -1])
  }

  get right() {
    return quatRotateVec(this.#effectiveOrientation, [1, 0, 0])
  }

  get target() {
    const f = this.forward
    return [this.position[0] + f[0], this.position[1] + f[1], this.position[2] + f[2]]
  }

  get locked() {
    return this.#locked || this.#lockedOnce
  }

  get isTouching() {
    return this.#isTouching
  }

  ypr(y, p, r) {
    this.#yaw = y
    this.#pitch = p
    this.#roll = r
    this.#syncQuatFromEuler()
  }

  lookAt(direction) {
    const { x, y, z } = direction
    this.#orientation = quatLookAt([x, y, z], [0, 1, 0])
    this.#syncEulerFromQuat()
  }

  lookAtLerp([x, y, z], t) {
    const baseQ = quatLookAt([x, y, z], [0, 1, 0])
    const targetQ = this.#roll ? mulQuat(baseQ, quatFromAxisAngle([0, 0, 1], this.#roll)) : baseQ
    this.#orientation = slerpQuat(this.#orientation, targetQ, t)
    this.#syncEulerFromQuat()
  }

  orbit(center, radius, theta, phi) {
    const cp = Math.cos(phi)
    const px = center[0] + radius * cp * Math.sin(theta)
    const py = center[1] + radius * Math.sin(phi)
    const pz = center[2] - radius * cp * Math.cos(theta)
    this.position = [px, py, pz]
    this.#orientation = quatLookAt([center[0] - px, center[1] - py, center[2] - pz], [0, 1, 0])
    this.#syncEulerFromQuat()
  }

  update(deltaTime) {
    if (Math.abs(this.#roll) > 1e-3) {
      this.#roll += -this.#roll * 0.1
      this.#syncQuatFromEuler()
    }

    const dt = deltaTime / 1000
    const dist = this.speed * dt
    const fwd = this.forward
    const r = this.right
    const fwdXZ = normalize([fwd[0], 0, fwd[2]])

    // wasd for you, lnrt for me <3
    if (this.#keys.has("w") || this.#keys.has("l")) {
      this.position[0] += fwdXZ[0] * dist
      this.position[2] += fwdXZ[2] * dist
    }
    if (this.#keys.has("s") || this.#keys.has("r")) {
      this.position[0] -= fwdXZ[0] * dist
      this.position[2] -= fwdXZ[2] * dist
    }
    if (this.#keys.has("a") || this.#keys.has("n")) {
      this.position[0] -= r[0] * dist
      this.position[2] -= r[2] * dist
    }
    if (this.#keys.has("d") || this.#keys.has("t")) {
      this.position[0] += r[0] * dist
      this.position[2] += r[2] * dist
    }

    if (this.#keys.has(" ")) this.position[1] += dist
    if (this.#keys.has("shift")) this.position[1] -= dist
    if (this.#keys.has("q"))
      console.log(
        `${this.position.map(x => x.toFixed(2.0)).join(", ")}, ${(this.#yaw / Math.PI).toFixed(2.0)} * Math.PI, ${(this.#pitch / Math.PI).toFixed(2.0)} * Math.PI, ${(this.#roll / Math.PI).toFixed(2.0)} * Math.PI`
      )
  }

  getViewMatrix(timeInfo) {
    if (!this.#locked && !this.#isTouching) return this.#getBobbedViewMatrix(timeInfo)
    const up = quatRotateVec(this.#effectiveOrientation, [0, 1, 0])
    return lookAtMatrix(this.position, this.target, up)
  }

  #computeBobOffset(t, timeInfo) {
    const breathRate = timeInfo.respiratoryRate / 60
    const heartRate = timeInfo.heartRate / 60
    const TAU = 2 * Math.PI
    const breath = Math.sin(TAU * breathRate * t)
    const heart = Math.sin(TAU * heartRate * t)
    const sway = Math.sin(TAU * 0.07 * t) * 0.6 + Math.sin(TAU * 0.11 * t + 1.3) * 0.4
    const sway2 = Math.sin(TAU * 0.11 * t + 1.3)
    return {
      dy: breath * 0.008 + heart * 0.0015,
      dx: sway * 0.003,
      dpitch: breath * 0.0126,
      droll: sway2 * 0.0119,
    }
  }

  #getBobbedViewMatrix(timeInfo) {
    const { dy, dx, dpitch, droll } = this.#computeBobOffset(performance.now() * 0.001, timeInfo)
    const baseQ = this.#effectiveOrientation
    const right = quatRotateVec(baseQ, [1, 0, 0])
    const eye = [this.position[0] + right[0] * dx, this.position[1] + dy, this.position[2] + right[2] * dx]
    const bobbedQ = mulQuat(baseQ, mulQuat(quatFromAxisAngle([1, 0, 0], dpitch), quatFromAxisAngle([0, 0, 1], droll)))
    const fwd = quatRotateVec(bobbedQ, [0, 0, -1])
    const up = quatRotateVec(bobbedQ, [0, 1, 0])
    return lookAtMatrix(eye, [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]], up)
  }

  #bindEvents() {
    const { signal } = this.#ac

    this.#canvas.addEventListener(
      "dblclick",
      () => {
        if (!this.#locked) this.#canvas.requestPointerLock()
        if (GYRO_ENABLED) this.#gyroRef = null
      },
      { signal }
    )

    document.addEventListener(
      "pointerlockchange",
      () => {
        this.#locked = document.pointerLockElement === this.#canvas
        if (this.#locked) {
          this.#lockedOnce = true
        }
      },
      { signal }
    )

    document.addEventListener(
      "mousemove",
      e => {
        if (!this.#locked) return
        this.#yaw += e.movementX * this.mouseSensitivity
        this.#roll += e.movementX * this.mouseSensitivity * 0.1
        if (this.#roll > HALF_PI * 0.5) this.#roll = HALF_PI * 0.5
        if (this.#roll < -(HALF_PI * 0.5)) this.#roll = -(HALF_PI * 0.5)
        this.#pitch -= e.movementY * this.mouseSensitivity
        this.#pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.#pitch))
        this.#syncQuatFromEuler()
      },
      { signal }
    )

    if (!GYRO_ENABLED) {
      this.#canvas.addEventListener(
        "touchstart",
        e => {
          this.#isTouching = true
          this.#touchLastX = e.touches[0].clientX
          this.#touchLastY = e.touches[0].clientY
        },
        { passive: true, signal }
      )
      this.#canvas.addEventListener(
        "touchmove",
        e => {
          const touch = e.touches[0]
          const dx = touch.clientX - this.#touchLastX
          const dy = touch.clientY - this.#touchLastY
          this.#touchLastX = touch.clientX
          this.#touchLastY = touch.clientY
          this.#yaw += dx * (this.mouseSensitivity * 4.0)
          this.#pitch -= dy * (this.mouseSensitivity * 4.0)
          this.#pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.#pitch))
          this.#syncQuatFromEuler()
        },
        { passive: true, signal }
      )
      const endTouch = e => {
        if (e.touches.length === 0) this.#isTouching = false
      }
      this.#canvas.addEventListener("touchend", endTouch, { signal })
      this.#canvas.addEventListener("touchcancel", endTouch, { signal })
    }

    document.addEventListener(
      "keydown",
      e => {
        if (e.target !== document.body && e.target.tagName !== "CANVAS") return
        this.#keys.add(e.key.toLowerCase())
        if (e.key === " " && this.#locked) e.preventDefault()
      },
      { signal }
    )

    document.addEventListener("keyup", e => this.#keys.delete(e.key.toLowerCase()), { signal })
  }

  #initGyro() {
    const { signal } = this.#ac
    const handleOrientation = e => {
      if (e.alpha === null) return
      if (!this.#gyroRef) {
        this.#gyroRef = { alpha: e.alpha, beta: e.beta }
        return
      }
      this.#isTouching = true
      let da = e.alpha - this.#gyroRef.alpha
      if (da > 180) da -= 360
      if (da < -180) da += 360
      const db = e.beta - this.#gyroRef.beta
      this.#gyroYaw = -da * (Math.PI / 180)
      this.#gyroPitch = Math.max(-HALF_PI, Math.min(HALF_PI, db * (Math.PI / 180) * 0.5))
    }

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      this.#canvas.addEventListener(
        "click",
        () => {
          DeviceOrientationEvent.requestPermission()
            .then(state => {
              if (state === "granted") {
                window.addEventListener("deviceorientation", handleOrientation, { signal })
                this.#isTouching = true
              }
            })
            .catch(() => {})
        },
        { once: true, signal }
      )
    } else {
      window.addEventListener("deviceorientation", handleOrientation, { signal })
    }
  }

  destroy() {
    this.#ac.abort()
    if (document.pointerLockElement === this.#canvas) document.exitPointerLock()
  }
}
