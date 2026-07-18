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
// Double tap the canvas to recalibrate the neutral orientation.
const GYRO_ENABLED = true

// Pinch dollies the camera along its facing direction. Spreading the fingers to twice their
// initial gap travels the full distance; that caps a single gesture, but successive pinches
// accumulate, so the camera keeps advancing.
const MAX_DOLLY_WU = 1.0

// Exponential approach rate (per second) for the dolly, so a pinch eases in rather than
// snapping to the finger spread.
const DOLLY_RATE_PER_S = 8.0

// Mobile Safari never dispatches dblclick for a double tap, so it is recognised from raw
// touches: a second lift landing soon after, and close to, the first.
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 30

export class Camera {
  position = [...S.initPos]
  speed = 2.0
  mouseSensitivity = 0.002
  touchSensitivity = 0.008
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
  #touchedOnce = false
  #touchLastX = 0
  #touchLastY = 0
  #pinchStartSpreadPx = 0
  #pinchStartDollyWu = 0
  #dollyTargetWu = 0
  #dollyAppliedWu = 0
  #requestGyroPermission = null
  #ac = new AbortController()

  constructor(canvas) {
    this.#canvas = canvas
    this.#bindEvents()
    this.#bindTouchLook()
    this.#bindPinch()
    this.#bindDoubleTap()
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
    // Yaw turns around world up, but pitch must tilt around the camera's own right axis —
    // post-multiplying keeps it correct wherever the base orientation happens to point.
    const yawQ = quatFromAxisAngle([0, -1, 0], this.#gyroYaw)
    const pitchQ = quatFromAxisAngle([1, 0, 0], this.#gyroPitch)
    return mulQuat(mulQuat(yawQ, this.#orientation), pitchQ)
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

  // Latches like `locked`: once a finger has steered the camera, the caller's idle drift must
  // stay out of the way for good, not reclaim the view the moment the touch ends.
  get isTouching() {
    return this.#isTouching || this.#touchedOnce
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
    this.#stepDolly(dt)

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

  // Framerate-independent exponential approach: 1 - e^(-k·dt).
  #stepDolly(dt) {
    const remainingWu = this.#dollyTargetWu - this.#dollyAppliedWu
    if (Math.abs(remainingWu) < 1e-4) return
    const stepWu = remainingWu * (1 - Math.exp(-DOLLY_RATE_PER_S * dt))
    this.#dollyAppliedWu += stepWu
    const fwd = this.forward
    this.position[0] += fwd[0] * stepWu
    this.position[1] += fwd[1] * stepWu
    this.position[2] += fwd[2] * stepWu
  }

  getViewMatrix(timeInfo) {
    if (!this.#locked && !this.#isTouching && !S.isCapture) return this.#getBobbedViewMatrix(timeInfo)
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
        this.#handleDoubleTap()
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

  #bindPinch() {
    const { signal } = this.#ac
    const spreadPx = ([a, b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

    this.#canvas.addEventListener(
      "touchstart",
      e => {
        if (e.touches.length !== 2) return
        this.#pinchStartSpreadPx = spreadPx(e.touches)
        this.#pinchStartDollyWu = this.#dollyTargetWu
        // Marks the camera user-controlled so the renderer's idle drift stops fighting the dolly.
        this.#isTouching = true
      },
      { passive: true, signal }
    )

    this.#canvas.addEventListener(
      "touchmove",
      e => {
        if (e.touches.length !== 2 || this.#pinchStartSpreadPx === 0) return
        const growth = spreadPx(e.touches) / this.#pinchStartSpreadPx - 1
        const gestureWu = Math.max(-MAX_DOLLY_WU, Math.min(MAX_DOLLY_WU, growth * MAX_DOLLY_WU))
        this.#dollyTargetWu = this.#pinchStartDollyWu + gestureWu
      },
      { passive: true, signal }
    )

    // Lifting a finger ends the gesture; the next pinch re-anchors on its own spread.
    const endPinch = e => {
      if (e.touches.length < 2) this.#pinchStartSpreadPx = 0
    }
    this.#canvas.addEventListener("touchend", endPinch, { passive: true, signal })
    this.#canvas.addEventListener("touchcancel", endPinch, { passive: true, signal })
  }

  // Dragging one finger steers the base orientation, which the gyro offset then rides on top of,
  // so a drag and a device tilt compose instead of overwriting each other.
  #bindTouchLook() {
    const { signal } = this.#ac
    const anchor = touch => {
      this.#touchLastX = touch.clientX
      this.#touchLastY = touch.clientY
    }

    this.#canvas.addEventListener(
      "touchstart",
      e => {
        this.#isTouching = true
        this.#touchedOnce = true
        anchor(e.touches[0])
      },
      { passive: true, signal }
    )

    this.#canvas.addEventListener(
      "touchmove",
      e => {
        // A second finger means a pinch; the dolly owns the gesture from here.
        if (e.touches.length !== 1) return
        const touch = e.touches[0]
        this.#yaw += (touch.clientX - this.#touchLastX) * this.touchSensitivity
        this.#pitch -= (touch.clientY - this.#touchLastY) * this.touchSensitivity
        this.#pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.#pitch))
        anchor(touch)
        this.#syncQuatFromEuler()
      },
      { passive: true, signal }
    )

    // Re-anchor on the surviving finger, or lifting out of a pinch snaps the view by its spread.
    const endTouch = e => {
      if (e.touches.length === 0) this.#isTouching = false
      else anchor(e.touches[0])
    }
    this.#canvas.addEventListener("touchend", endTouch, { passive: true, signal })
    this.#canvas.addEventListener("touchcancel", endTouch, { passive: true, signal })
  }

  #bindDoubleTap() {
    const { signal } = this.#ac
    let lastTapMs = 0
    let lastTapX = 0
    let lastTapY = 0
    let startX = 0
    let startY = 0
    let isTap = false

    this.#canvas.addEventListener(
      "touchstart",
      e => {
        // A pinch's second finger disqualifies the whole sequence.
        isTap = e.touches.length === 1
        startX = e.touches[0].clientX
        startY = e.touches[0].clientY
      },
      { passive: true, signal }
    )

    // A finger that travels is a look-around, not a tap.
    this.#canvas.addEventListener(
      "touchmove",
      e => {
        if (!isTap) return
        const { clientX, clientY } = e.touches[0]
        if (Math.hypot(clientX - startX, clientY - startY) > DOUBLE_TAP_SLOP_PX) isTap = false
      },
      { passive: true, signal }
    )

    this.#canvas.addEventListener(
      "touchend",
      e => {
        // Wait for the last finger, so the tail of a pinch is judged as one gesture, not a tap.
        if (e.touches.length !== 0) return
        if (!isTap) {
          lastTapMs = 0
          return
        }

        const { clientX, clientY } = e.changedTouches[0]
        const nowMs = performance.now()
        const isDoubleTap =
          nowMs - lastTapMs < DOUBLE_TAP_MS && Math.hypot(clientX - lastTapX, clientY - lastTapY) < DOUBLE_TAP_SLOP_PX

        // Consuming the timestamp keeps a third tap from pairing with the second.
        lastTapMs = isDoubleTap ? 0 : nowMs
        lastTapX = clientX
        lastTapY = clientY
        if (isDoubleTap) this.#handleDoubleTap()
      },
      { passive: true, signal }
    )
  }

  // Runs inside the touchend/dblclick handler so iOS still sees a live user gesture.
  #handleDoubleTap() {
    if (!GYRO_ENABLED) return
    this.#recenterGyro()
    this.#requestGyroPermission?.()
  }

  // Drop the neutral reference so the next reading becomes the new centre.
  #recenterGyro() {
    this.#gyroRef = null
    this.#gyroYaw = 0
    this.#gyroPitch = 0
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
      // beta drops as the top of the device tips away from the viewer, which is a look-down.
      const db = e.beta - this.#gyroRef.beta
      this.#gyroYaw = -da * (Math.PI / 180)
      this.#gyroPitch = Math.max(-HALF_PI, Math.min(HALF_PI, db * (Math.PI / 180)))
    }

    const needsPermission =
      typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"

    if (!needsPermission) {
      window.addEventListener("deviceorientation", handleOrientation, { signal })
      return
    }

    // iOS gates the sensor behind a user gesture, so the same double tap that recentres grants it.
    // A rejected request clears the latch, letting a later tap ask again.
    let requestPending = false
    this.#requestGyroPermission = () => {
      if (requestPending) return
      requestPending = true
      DeviceOrientationEvent.requestPermission()
        .then(state => {
          if (state !== "granted") return
          window.addEventListener("deviceorientation", handleOrientation, { signal })
          this.#isTouching = true
        })
        .catch(() => {
          requestPending = false
        })
    }
  }

  destroy() {
    this.#ac.abort()
    if (document.pointerLockElement === this.#canvas) document.exitPointerLock()
  }
}
