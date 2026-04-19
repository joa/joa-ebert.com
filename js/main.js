import "../css/style.css"
import { ExtLink } from "./components/ext-link.js"
import { LifeSpanRatio } from "./components/life-span-ratio.js"
import { setupThemeToggle } from "./components/theme-toggle.js"

const ID_PROFILE_MORE = "profile-more"
const ID_PROFILE_MORE_BTN = "profile-more-btn"
const COMPONENTS = [ExtLink, LifeSpanRatio]

async function awaitDocument() {
  if (document.readyState === "loading") {
    await new Promise(resolve => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true, passive: true })
    })
  }
}

async function awaitIdle(timeout = 1000) {
  await new Promise(resolve => {
    requestIdleCallback(resolve, { timeout })
  })
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
    await awaitIdle()
    await this.initCanvas()
  }

  async initCanvas() {
    const home = window.location.pathname === "/"
    const mode = home ? "full" : "small"
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

    const dismissSpinner = () => {
      const spinner = document.getElementById("canvas-spinner")
      if (!spinner) return
      spinner.style.opacity = "0"
      spinner.addEventListener("transitionend", () => spinner.remove(), { once: true })
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
        const fallback = document.getElementById("canvas-fallback")
        if (fallback) {
          fallback.src = fallback.dataset.src
          fallback.classList.remove("hidden")
        }
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
