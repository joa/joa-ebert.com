import "../css/style.css"
import { ExtLink } from "./components/ext-link.js"
import { LifeSpanRatio } from "./components/life-span-ratio.js"
import { RenderToggle } from "./components/render-toggle.js"
import { setupThemeToggle, isDark } from "./components/theme-toggle.js"
import S from "./shared/settings.js"

const ID_PROFILE_MORE = "profile-more"
const ID_PROFILE_MORE_BTN = "profile-more-btn"
const COMPONENTS = [ExtLink, LifeSpanRatio, RenderToggle]

function dismissSpinner() {
  const spinner = document.getElementById("canvas-spinner")
  if (!spinner) return
  spinner.style.opacity = "0"
  spinner.addEventListener("transitionend", () => spinner.remove(), { once: true })
}

async function awaitDocument() {
  if (document.readyState === "loading") {
    await new Promise(resolve => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true, passive: true })
    })
  }
}

function registerComponents() {
  const registry = window.customElements

  if (registry) {
    COMPONENTS.forEach(it => it.register(registry))
  }
}

function setupScrollIndicator() {
  const indicator = document.getElementById("scroll-indicator")
  if (!indicator) return
  const header = document.querySelector("header")
  if (!header) return
  indicator.style.visibility = "visible"
  window.addEventListener(
    "scroll",
    () => {
      const progress = window.scrollY / header.offsetHeight
      indicator.style.opacity = Math.max(0, 1 - progress * 4).toString()
    },
    { passive: true }
  )
}

function setupMoreButton() {
  const more = document.getElementById(ID_PROFILE_MORE)
  const moreBtn = document.getElementById(ID_PROFILE_MORE_BTN)
  if (!more || !moreBtn) return

  moreBtn.addEventListener(
    "click",
    () => {
      moreBtn.hidden = true
      more.classList.add("expanded")
    },
    { once: true, passive: true }
  )
}

// Static header image rendered by `npm run gen-placeholders`, shown when the
// WebGPU renderer is unavailable. Mirrors the live scene: the index follows
// the clock (one image per hour and device class), blog headers follow the
// theme (dedicated compact-scene captures per theme and device class).
function showPlaceholder(mode) {
  const img = document.getElementById("canvas-fallback")
  if (!img) return

  const device = S.isMobile ? "mobile" : "desktop"
  const update = (dark = isDark()) => {
    img.src =
      mode === "full"
        ? `/assets/placeholders/${device}-${String(new Date().getHours()).padStart(2, "0")}.webp`
        : `/assets/placeholders/compact-${device}-${dark ? "dark" : "light"}.webp`
  }

  update()
  img.classList.remove("hidden")

  if (mode !== "full") {
    window.addEventListener("themeoverride", ({ detail }) => update(detail.dark), { passive: true })
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", event => update(event.matches))
  }
}

class App {
  #webGPU = null

  constructor() {
    this.init()
  }

  async init() {
    awaitDocument()
    registerComponents()
    setupScrollIndicator()
    setupMoreButton()
    setupThemeToggle()
    await this.initCanvas()
  }

  async initCanvas() {
    const home = window.location.pathname === "/"
    const mode = home ? "full" : "small"

    // Visitor opted out of the live scene — skip the renderer, show the placeholder.
    if (RenderToggle.disabled) {
      const canvas = document.getElementById("webgpu-canvas")
      if (canvas) canvas.hidden = true
      dismissSpinner()
      showPlaceholder(mode)
      return
    }

    const skipIntro = !home || localStorage.getItem("skipIntro")
    const [{ TimeSystem }, { AdaptiveQuality }] = await Promise.all([
      import("./shared/time-system.js"),
      import("./shared/adaptive-quality.js"),
    ])

    const opts = {
      timeSystem: new TimeSystem(),
      adaptiveQuality: new AdaptiveQuality(),
      controlsUI: null,
    }

    if (mode === "full") {
      const { ControlsUI } = await import("./shared/controls-ui.js")
      opts.controlsUI = new ControlsUI(opts.timeSystem, opts.adaptiveQuality)
    }

    if (!skipIntro) {
      opts.timeSystem.setOverride("rain", 0) // who wants to start with rain eh?
    }

    const f = async x => {
      const canvas = document.getElementById(x)
      if (!canvas) {
        return
      }

      try {
        const { Renderer } = await import("./webgpu/renderer.js")
        const r = new Renderer(canvas, mode, opts)
        await r.init()
        dismissSpinner()
        return r
      } catch (error) {
        opts.controlsUI?.destroy()
        dismissSpinner()
        canvas.hidden = true
        showPlaceholder(mode)
        console.error("failed to initialize renderer:", error)
        return
      }
    }

    this.#webGPU = f("webgpu-canvas")

    if (opts.controlsUI) {
      this.#webGPU?.then(r => {
        if (r) opts.controlsUI.captureCallback = () => r.requestCapture()
      })
    }

    if (!skipIntro) {
      this.initAnimation()
    }
  }

  initAnimation() {
    this.#webGPU?.then(async x => {
      if (!x) {
        return
      }
      const { buildIntro } = await import("./shared/intro.js")
      const a = x.cameraAnimator
      const ctx = x.ctx
      localStorage.setItem("skipIntro", true)
      a.play(buildIntro(ctx.primaryLightDir))
    })
  }

  destroy() {
    this.#webGPU?.then(x => {
      if (!x || typeof x.destroy !== "function") {
        return
      }
      x.destroy()
    })
  }
}

const app = new App()

window.addEventListener("beforeunload", () => {
  app.destroy()
})

if (typeof window !== "undefined") {
  window.app = app
}
