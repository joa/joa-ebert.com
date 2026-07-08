// RenderToggle Component
// ######################
//
// Custom element <render-toggle> — a fixed overlay button, stacked just above
// the fullscreen button, that swaps the live WebGPU scene for the static
// placeholder image so visitors can spare their resources. The choice persists
// in localStorage; App reads RenderToggle.disabled on load to decide whether to
// boot the renderer at all. Toggling reloads so the GPU device is released (or
// re-acquired) cleanly rather than torn down by hand.

const STORAGE_KEY = "renderDisabled"

const ICON_POWER = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>
</svg>`

const ICON_ANIM = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="6 4 20 12 6 20 6 4"/>
</svg>`

export class RenderToggle extends HTMLElement {
  static register(registry) {
    registry.define("render-toggle", RenderToggle)
  }

  static get disabled() {
    return !!localStorage.getItem(STORAGE_KEY)
  }

  connectedCallback() {
    this.className = "render-toggle-btn"
    this.setAttribute("role", "button")
    this.setAttribute("tabindex", "0")
    this.render()
    this.addEventListener("click", () => this.#toggle())
    this.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        this.#toggle()
      }
    })
  }

  render() {
    const disabled = RenderToggle.disabled
    this.innerHTML = disabled ? ICON_ANIM : ICON_POWER
    this.title = `${disabled ? "Enable" : "Disable"} WebGPU scene`
    this.setAttribute("aria-label", this.title)
  }

  #toggle() {
    if (RenderToggle.disabled) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, "1")
    window.location.reload()
  }
}
