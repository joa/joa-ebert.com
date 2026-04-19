// Settings
// ########
//
// Static device and feature detection. Exports a singleton S with isMobile,
// darkMode, model path, initial camera position, and input behavior flags.

const idleY = 0.75
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
const isMac = (navigator.userAgentData?.platform ?? navigator.platform).startsWith("Mac")
const isTBDR = isMobile || isMac

export default {
  isMobile,
  isTBDR,
  idleY,
  model: "/assets/joa-ebert.com.glb",
  mouseWheelScrubsTime: false,
  mouseWheelHoursPerNotch: -0.25, // 15min
  initPos: [-5, idleY, -5],
  initLookAt: [-5, 4.5, 10.0],
  timeInertia: 0.2,
}
