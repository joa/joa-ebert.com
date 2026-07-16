// Settings
// ########
//
// Static device and feature detection. Exports a singleton S with isMobile,
// darkMode, model path, initial camera position, and input behavior flags.

const idleY = 0.75
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
const isMac = (navigator.userAgentData?.platform ?? navigator.platform)?.toLowerCase()?.startsWith("mac")
const isTBDR = isMobile || isMac
const perfHud = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("perf")

// Set by scripts/placeholder-harness.js (?capture): static camera (no view
// bobbing) and full quality regardless of the emulated device. Quality gates
// check lowSpec / lowSpecTBDR; device-specific scene framing keeps isMobile.
const isCapture = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("capture")
const lowSpec = isMobile && !isCapture
const lowSpecTBDR = isTBDR && !isCapture

export default {
  isMobile,
  isTBDR,
  isCapture,
  lowSpec,
  lowSpecTBDR,
  perfHud,
  idleY,
  model: "/assets/joa-ebert.com.glb",
  mouseWheelScrubsTime: false,
  mouseWheelHoursPerNotch: -0.25, // 15min
  initPos: [-5, idleY, -5],
  initLookAt: [-5, 4.5, 10.0],
  timeInertia: 0.2,
  date: new Date(),
}
