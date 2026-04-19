// Controls UI
// ###########
//
// Burger-menu debug panel for real-time parameter tweaking. Driven by a PARAMS
// array — each entry with key/label/range automatically renders an input that
// reads from and writes to timeSystem.timeInfo.

import { buildIntro } from "./intro.js"

const PARAMS = [
  { key: "timeOfDay", label: "Time of Day", min: 0, max: 24, step: 0.1 },
  { key: "turbidity", label: "Sky Turbidity", min: 2.2, max: 9.3, step: 0.01 },
  { key: "overcast", label: "Sky Overcast", min: 0, max: 1, step: 0.01 },
  { key: "zenithColor", label: "Zenith Color", type: "color" },
  { key: "horizonColor", label: "Horizon Color", type: "color" },
  { key: "ambientIntensity", label: "Ambient Intensity", min: 0, max: 2, step: 0.01 },
  {
    key: "fogQuality",
    label: "Fog Quality",
    type: "select",
    options: [
      { value: 0, label: "Low — Analytical" },
      { value: 1, label: "High — Volumetric" },
    ],
  },
  { key: "fogSteps", label: "Fog Steps", min: 1, max: 64, step: 1 },
  { key: "fogColor", label: "Fog Color", type: "color" },
  { key: "fogDensity", label: "Fog Density", min: 0, max: 1, step: 0.01 },
  { key: "fogIntensity", label: "Fog Intensity", min: 0, max: 3, step: 0.01 },
  { key: "fogHeightFalloff", label: "Fog Height Falloff", min: 0, max: 3, step: 0.01 },
  { key: "cloudBase", label: "Cloud Base", min: 10, max: 200, step: 1 },
  { key: "cloudTop", label: "Cloud Top", min: 10, max: 200, step: 1 },
  { key: "cloudCoverage", label: "Cloud Coverage", min: 0, max: 1, step: 0.01 },
  { key: "cloudSigmaE", label: "Cloud Density", min: 0, max: 0.2, step: 0.001 },
  { key: "cloudSteps", label: "Cloud Steps", min: 1, max: 64, step: 1 },
  { key: "cloudShadowSteps", label: "Cloud Shadow Steps", min: 1, max: 16, step: 1 },
  { key: "colorTemperature", label: "Color Temp", min: -1, max: 1, step: 0.01 },
  { key: "bloomIntensity", label: "Bloom Intensity", min: 0, max: 2, step: 0.01 },
  { key: "bloomThreshold", label: "Bloom Threshold", min: 0, max: 1, step: 0.01 },
  { key: "godRayIntensity", label: "God Ray Intensity", min: 0, max: 5, step: 0.1 },
  { key: "godRayDecay", label: "God Ray Decay", min: 0, max: 1, step: 0.01 },
  { key: "godRaySteps", label: "God Ray Steps", min: 1, max: 256, step: 1 },
  { key: "lensFlareIntensity", label: "Lens Flare Intensity", min: 0, max: 2, step: 0.01 },
  { key: "rainbowIntensity", label: "Rainbow Intensity", min: 0, max: 2, step: 0.01 },
  { key: "grainStrength", label: "Film Grain Strength", min: 0, max: 0.3, step: 0.001 },
  { key: "vignetteStrength", label: "Vignette Strength", min: 0, max: 1, step: 0.01 },
  { key: "ssaoIntensity", label: "SSAO Intensity", min: 0, max: 1, step: 0.01 },
  { key: "depthOfField", label: "DoF Strength", min: 0, max: 8, step: 0.01 },
  { key: "dofFocusNear", label: "DoF Focus Near", min: 0.1, max: 50, step: 0.1 },
  { key: "dofFocusFar", label: "DoF Focus Far", min: 0.1, max: 100, step: 0.1 },
  { key: "dofBlurNear", label: "DoF Blur Near", min: 0.1, max: 50, step: 0.1 },
  { key: "dofBlurFar", label: "DoF Blur Far", min: 0.1, max: 100, step: 0.1 },
  { key: "chromaticAberration", label: "Chromatic Abb.", min: 0, max: 0.05, step: 0.0001 },
  { key: "cgExposure", label: "Exposure", min: 0, max: 3, step: 0.01 },
  { key: "cgContrast", label: "Contrast", min: 0, max: 2, step: 0.01 },
  { key: "cgSaturation", label: "Saturation", min: 0, max: 2, step: 0.01 },
  { key: "cgLift", label: "Color Lift", type: "color" },
  { key: "grassHeightFactor", label: "Grass Height", min: 0, max: 8, step: 0.1 },
  { key: "grassWidthFactor", label: "Grass Width", min: 0, max: 8, step: 0.1 },
  { key: "dewAmount", label: "Dew Amount", min: 0, max: 1, step: 0.01 },
  { key: "windStrength", label: "Wind Strength", min: 0, max: 1, step: 0.01 },
  { key: "rain", label: "Rain Intensity", min: 0, max: 1, step: 0.01 },
  { key: "respiratoryRate", label: "Respiratory Rate", min: 0, max: 60, step: 1 },
  { key: "heartRate", label: "Hearth Rate", min: 38, max: 192, step: 1 },
  { key: "birdSeparationRadius", label: "Bird Separation R.", min: 0.5, max: 15, step: 0.1 },
  { key: "birdAlignmentRadius", label: "Bird Alignment R.", min: 1, max: 20, step: 0.1 },
  { key: "birdCohesionRadius", label: "Bird Cohesion R.", min: 1, max: 20, step: 0.1 },
  { key: "birdSeparationWeight", label: "Bird Sep. Weight", min: 0, max: 5, step: 0.05 },
  { key: "birdAlignmentWeight", label: "Bird Ali. Weight", min: 0, max: 5, step: 0.05 },
  { key: "birdCohesionWeight", label: "Bird Coh. Weight", min: 0, max: 5, step: 0.05 },
  { key: "birdSeekWeight", label: "Bird Seek Weight", min: 0, max: 5, step: 0.05 },
  { key: "birdMaxSpeed", label: "Bird Max Speed", min: 1, max: 30, step: 0.5 },
  { key: "birdMaxForce", label: "Bird Max Force", min: 0.1, max: 10, step: 0.1 },
  { key: "birdWingBeat", label: "Bird Wing Speed", min: 0.01, max: 2, step: 0.01 },
  { key: "birdWingAmplitude", label: "Bird Wing Amp.", min: 0, max: 1, step: 0.01 },
  { key: "birdAltitude", label: "Bird Altitude", min: 20, max: 80, step: 0.5 },
  { key: "birdScale", label: "Bird Size", min: 0.05, max: 2, step: 0.01 },
  { key: "chemtrailCount", label: "Chemtrail Count", min: 0, max: 8, step: 1 },
  { key: "chemtrailOpacity", label: "Chemtrail Opacity", min: 0, max: 2, step: 0.05 },
  { key: "chemtrailWidth", label: "Chemtrail Width", min: 0.003, max: 0.06, step: 0.001 },
  { key: "fireflyIntensity", label: "Firefly Intensity", min: 0, max: 3, step: 0.05 },
  { key: "fireflyLightRadius", label: "Firefly Light Radius", min: 0.5, max: 12, step: 0.25 },
  { key: "sparkleEnabled", label: "Text Sparkles", type: "bool" },
  { key: "sparkleIntensity", label: "Sparkle Intensity", min: 0, max: 3, step: 0.05 },
  { key: "sparkleDensity", label: "Sparkle Density", min: 0.5, max: 20, step: 0.5 },
  { key: "sparkleSharpness", label: "Sparkle Sharpness", min: 0.1, max: 5, step: 0.05 },
  { key: "sparkleSpeed", label: "Sparkle Speed", min: 0.1, max: 5, step: 0.1 },
]

const DEBUG_MODES = [
  { value: 0, label: "Normal" },
  { value: 1, label: "Depth" },
  { value: 2, label: "Albedo" },
  { value: 3, label: "Material ID" },
  { value: 4, label: "Normals" },
  { value: 5, label: "Material" },
  { value: 6, label: "Shadow" },
  { value: 7, label: "Magenta" },
]

const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
</svg>`

const ICON_COMPRESS = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
</svg>`

const ICON_ANIM = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3,22.0000002 L21,12 L3,2 L3,22.0000002 Z M5,19 L17.5999998,11.9999999 L5,5 L5,19 Z M7,16 L14.1999999,12 L7,8 L7,16 Z M9,13 L10.8,12 L9,11 L9,13 Z"/>
</svg>`

function rgbToHex(rgb) {
  const [r, g, b] = Array.isArray(rgb) ? rgb : [rgb.r, rgb.g, rgb.b]
  const ch = c =>
    Math.max(0, Math.min(255, Math.round(c * 255)))
      .toString(16)
      .padStart(2, "0")
  return `#${ch(r)}${ch(g)}${ch(b)}`
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  }
}

export class ControlsUI {
  #timeSystem
  #adaptiveQuality
  #animators = []
  #panel
  #burger
  #fsBtn
  #animBtn
  #aqCheckbox
  #controls = {}
  #isOpen = false
  #debugMode = parseInt(new URLSearchParams(window.location.search).get("dbg") ?? "0", 10) || 0
  #captureCallback = null

  set captureCallback(fn) {
    this.#captureCallback = fn
  }

  constructor(timeSystem, adaptiveQuality) {
    this.#timeSystem = timeSystem
    this.#adaptiveQuality = adaptiveQuality
    this.#createDOM()
  }

  get debugMode() {
    return this.#debugMode
  }

  addAnimator(animator) {
    this.#animators.push(animator)
  }

  toggle() {
    this.#isOpen = !this.#isOpen
    this.#burger.classList.toggle("open", this.#isOpen)
    this.#panel.classList.toggle("open", this.#isOpen)
    if (this.#isOpen && this.#adaptiveQuality) {
      this.#adaptiveQuality.enabled = false
      if (this.#aqCheckbox) this.#aqCheckbox.checked = false
    }
    if (this.#isOpen) {
      this.#render()
    }
  }

  #setParam(key, value) {
    if (key === "timeOfDay") this.#timeSystem.setOverrideTime(value)
    else this.#timeSystem.setOverride(key, value)
  }

  #clearParam(key) {
    if (key === "timeOfDay") this.#timeSystem.clearOverrideTime()
    else this.#timeSystem.clearOverride(key)
  }

  #makeGroup() {
    const group = document.createElement("div")
    group.className = "control-group"
    const header = document.createElement("div")
    header.className = "control-header"
    const row = document.createElement("div")
    row.className = "control-input-row"
    group.append(header, row)
    return { group, header, row }
  }

  #makeLabel(text) {
    const label = document.createElement("span")
    label.className = "control-label"
    label.textContent = text
    return label
  }

  #makeInput(param) {
    if (param.type === "color") {
      const input = document.createElement("input")
      input.type = "color"
      input.className = "control-color"
      input.addEventListener("input", e => {
        const { r, g, b } = hexToRgb(e.target.value)
        this.#setParam(param.key, param.key === "cgLift" ? [r, g, b] : { r, g, b })
      })
      return input
    }
    if (param.type === "bool") {
      const input = document.createElement("input")
      input.type = "checkbox"
      input.className = "control-checkbox"
      input.addEventListener("change", e => {
        this.#setParam(param.key, e.target.checked ? 1.0 : 0.0)
      })
      return input
    }
    if (param.type === "select") {
      const input = document.createElement("select")
      input.className = "control-select"
      for (const { value, label } of param.options) {
        const option = document.createElement("option")
        option.value = value
        option.textContent = label
        input.appendChild(option)
      }
      input.addEventListener("change", e => {
        this.#setParam(param.key, parseFloat(e.target.value))
      })
      return input
    }
    const input = document.createElement("input")
    input.type = "range"
    input.className = "control-slider"
    input.min = param.min
    input.max = param.max
    input.step = param.step
    input.addEventListener("input", e => {
      this.#setParam(param.key, parseFloat(e.target.value))
    })
    return input
  }

  #toggleExpanded() {
    const header = document.querySelector("header")
    const expanded = header.classList.toggle("canvas-expanded")
    if (expanded) window.scrollTo(0, 0)
    this.#burger.classList.toggle("visible", expanded)
    this.#fsBtn.innerHTML = expanded ? ICON_COMPRESS : ICON_EXPAND
    if (!expanded && this.#isOpen) this.toggle()
  }

  #playAnimation() {
    if (!this.#animators.length) return
    const { sunPosition } = this.#timeSystem.timeInfo
    this.#animators.forEach(animator => animator.play(buildIntro(sunPosition)))
  }

  #appendBtn(text, handler, marginTop = "6px") {
    const btn = document.createElement("button")
    btn.className = "control-reset"
    btn.style.cssText = `width:100%;margin-top:${marginTop};padding:10px`
    btn.textContent = text
    btn.addEventListener("click", handler)
    this.#panel.appendChild(btn)
  }

  destroy() {
    this.#fsBtn?.remove()
    this.#animBtn?.remove()
    this.#burger?.remove()
    this.#panel?.remove()
  }

  #createDOM() {
    this.#animBtn = document.createElement("div")
    this.#animBtn.className = "anim-btn"
    this.#animBtn.innerHTML = ICON_ANIM
    this.#animBtn.addEventListener("click", () => this.#playAnimation())
    document.body.insertBefore(this.#animBtn, document.body.firstChild)

    this.#fsBtn = document.createElement("div")
    this.#fsBtn.className = "fs-btn"
    this.#fsBtn.innerHTML = ICON_EXPAND
    this.#fsBtn.addEventListener("click", () => this.#toggleExpanded())
    document.body.insertBefore(this.#fsBtn, document.body.firstChild)

    this.#burger = document.createElement("div")
    this.#burger.className = "controls-burger"
    this.#burger.innerHTML = "<span></span><span></span><span></span>"
    this.#burger.addEventListener("click", () => this.toggle())
    document.body.appendChild(this.#burger)

    this.#panel = document.createElement("div")
    this.#panel.className = "controls-panel"

    const title = document.createElement("div")
    title.className = "controls-title"
    title.textContent = "Rendering Controls"
    this.#panel.appendChild(title)

    if (this.#adaptiveQuality) {
      const { group, header, row } = this.#makeGroup()
      header.appendChild(this.#makeLabel("Adaptive Quality"))
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      checkbox.checked = this.#adaptiveQuality.enabled
      checkbox.addEventListener("change", e => {
        this.#adaptiveQuality.enabled = e.target.checked
      })
      this.#aqCheckbox = checkbox
      row.appendChild(checkbox)
      this.#panel.appendChild(group)
    }

    {
      const { group, header, row } = this.#makeGroup()
      header.appendChild(this.#makeLabel("Debug Mode"))
      const select = document.createElement("select")
      select.className = "control-select"
      for (const { value, label } of DEBUG_MODES) {
        const option = document.createElement("option")
        option.value = value
        option.textContent = label
        if (value === this.#debugMode) option.selected = true
        select.appendChild(option)
      }
      select.addEventListener("change", e => {
        this.#debugMode = parseInt(e.target.value, 10)
      })
      row.appendChild(select)
      this.#panel.appendChild(group)
    }

    for (const param of PARAMS) {
      const { group, header, row } = this.#makeGroup()
      header.appendChild(this.#makeLabel(param.label))
      const valueDisplay = document.createElement("span")
      valueDisplay.className = "control-value"
      header.appendChild(valueDisplay)
      const resetBtn = document.createElement("button")
      resetBtn.className = "control-reset"
      resetBtn.textContent = "Reset"
      resetBtn.addEventListener("click", () => this.#clearParam(param.key))
      header.appendChild(resetBtn)
      const input = this.#makeInput(param)
      row.appendChild(input)
      this.#panel.appendChild(group)
      this.#controls[param.key] = { input, valueDisplay }
    }

    this.#appendBtn("Reset All Overrides", () => this.#timeSystem.clearAllOverrides(), "10px")
    this.#appendBtn("Replay Animation", () => this.#playAnimation())
    this.#appendBtn("Save PNG", () => this.#captureCallback?.())

    document.body.appendChild(this.#panel)
  }

  #render() {
    const cache = {}
    const apply = () => {
      const timeInfo = this.#timeSystem.timeInfo
      for (const param of PARAMS) {
        const control = this.#controls[param.key]
        const value = timeInfo[param.key]
        let inputVal, displayVal
        if (param.type === "color") {
          inputVal = rgbToHex(value)
          displayVal = Array.isArray(value)
            ? `[${value[0].toFixed(2)}, ${value[1].toFixed(2)}, ${value[2].toFixed(2)}]`
            : `(${value.r.toFixed(2)}, ${value.g.toFixed(2)}, ${value.b.toFixed(2)})`
        } else if (param.type === "bool") {
          const on = value > 0.5
          inputVal = String(on)
          displayVal = on ? "on" : "off"
        } else if (param.type === "select") {
          inputVal = String(Math.round(value))
          displayVal = param.options.find(opt => opt.value === Math.round(value))?.label ?? ""
        } else {
          inputVal = String(value)
          displayVal = value.toFixed(2)
        }
        const cached = cache[param.key]
        if (!cached || cached.inputVal !== inputVal || cached.displayVal !== displayVal) {
          if (param.type === "bool") control.input.checked = inputVal === "true"
          else control.input.value = inputVal
          control.valueDisplay.textContent = displayVal
          cache[param.key] = { inputVal, displayVal }
        }
      }
      if (this.#isOpen) requestAnimationFrame(apply)
    }
    requestAnimationFrame(apply)
  }
}
