// Theme Toggle
// ############
//
// Wires up the #theme-toggle button. Reads the current theme from
// localStorage / OS preference, keeps html.theme-dark / html.theme-light in
// sync, persists the choice, and dispatches a "themeoverride" CustomEvent so
// the renderer can update its time-of-day override.

const STORAGE_KEY = "theme"

export function isDark() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "dark") return true
  if (stored === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function applyTheme(dark) {
  const html = document.documentElement
  html.classList.toggle("theme-dark", dark)
  html.classList.toggle("theme-light", !dark)
  localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light")
  window.dispatchEvent(new CustomEvent("themeoverride", { detail: { dark } }))
}

export function setupThemeToggle() {
  const btn = document.getElementById("theme-toggle")
  if (!btn) return
  btn.addEventListener("click", () => applyTheme(!isDark()), { passive: true })
}
