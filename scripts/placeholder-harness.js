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

const renderer = new Renderer(canvas, mode, { timeSystem, adaptiveQuality, controlsUI: null })

window.placeholders = {
  ready: renderer.init().then(() => true),
  setHour: hour => timeSystem.setOverrideTime(hour),
  awaitFrames: count =>
    new Promise(resolve => {
      const step = n => (n <= 0 ? resolve() : requestAnimationFrame(() => step(n - 1)))
      step(count)
    }),
}
