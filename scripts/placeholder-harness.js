// Placeholder Harness
// ###################
//
// Browser-side companion of scripts/gen-placeholders.js. Boots the WebGPU
// renderer fullscreen ("full" for the index header, "small" for the compact
// blog header via ?mode=small) and exposes window.placeholders so the
// generator can scrub the hour of day and wait for settled frames before
// screenshotting.

import { TimeSystem } from "../js/shared/time-system.js"
import { AdaptiveQuality } from "../js/shared/adaptive-quality.js"
import { Renderer } from "../js/webgpu/renderer.js"
import S from "../js/shared/settings.js"

const mode = new URLSearchParams(window.location.search).get("mode") ?? "full"
const canvas = document.getElementById("webgpu-canvas")
const timeSystem = new TimeSystem()
const adaptiveQuality = new AdaptiveQuality()

// Deterministic captures: quality pinned to the live pipeline's best case
// (the page URL also carries ?capture, which lifts the device-based quality
// gates in settings.js and disables camera view bobbing), no rain streaks
// frozen mid-air.
adaptiveQuality.lockQuality(1)
timeSystem.setOverride("rain", 0)
timeSystem.setOverride("grainStrength", 0)
timeSystem.setOverride("cloudSteps", 64)
timeSystem.setOverride("fogSteps", 64)

const renderer = new Renderer(canvas, mode, { timeSystem, adaptiveQuality, controlsUI: null })

window.placeholders = {
  ready: renderer.init().then(() => true),
  setHour: hour => timeSystem.setOverrideTime(hour),
  // Force any timeInfo property (fog, DoF, etc.) for a capture, mirroring the
  // debug controls — lets shots exercise non-default looks (e.g. far blur + fog).
  setOverride: (key, value) => timeSystem.setOverride(key, value),
  // Reposition the idle-drift camera target (debug/inspection captures). The
  // renderer eases toward S.initPos / S.initLookAt each frame, so overriding
  // them (and idleY, which co-drives the settle height) moves the camera once
  // enough frames elapse. Used to get close-up looks into the grass.
  setCamera: (pos, look) => {
    S.initPos[0] = pos[0]
    S.initPos[1] = pos[1]
    S.initPos[2] = pos[2]
    S.idleY = pos[1]
    S.initLookAt[0] = look[0]
    S.initLookAt[1] = look[1]
    S.initLookAt[2] = look[2]
  },
  awaitFrames: count =>
    new Promise(resolve => {
      const step = n => (n <= 0 ? resolve() : requestAnimationFrame(() => step(n - 1)))
      step(count)
    }),
}
