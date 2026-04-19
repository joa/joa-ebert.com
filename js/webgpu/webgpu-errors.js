// WebGPU Errors
// #############
//
// Captures validation, internal, and out-of-memory errors and surfaces them
// in an on-screen overlay — useful on iOS Safari where DevTools is inaccessible.
// installErrorReporting(device) installs the handler; withErrorScopes() wraps per-frame work.

let overlay = null
let body = null
let count = 0
const MAX_LINES = 12
const seen = new Set()

function ensureOverlay() {
  if (overlay) return overlay
  if (typeof document === "undefined") return null
  overlay = document.createElement("div")
  overlay.id = "webgpu-error-overlay"
  overlay.style.cssText = [
    "position:fixed",
    "left:0",
    "right:0",
    "bottom:0",
    "max-height:50vh",
    "overflow:auto",
    "background:rgba(40,0,0,0.92)",
    "color:#ffd0d0",
    "font:11px/1.35 ui-monospace,Menlo,Consolas,monospace",
    "padding:8px 10px",
    "white-space:pre-wrap",
    "word-break:break-word",
    "pointer-events:auto",
    "border-top:2px solid #ff5050",
    "z-index:1000",
  ].join(";")
  const header = document.createElement("div")
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#ff8080;font-weight:bold"
  const title = document.createElement("span")
  title.textContent = "WebGPU errors"
  const dismiss = document.createElement("button")
  dismiss.textContent = "clear"
  dismiss.style.cssText = "background:#400;color:#fcc;border:1px solid #800;padding:2px 8px;font:inherit;cursor:pointer"
  dismiss.addEventListener("click", () => {
    body.textContent = ""
    seen.clear()
    count = 0
    overlay.style.display = "none"
  })
  header.appendChild(title)
  header.appendChild(dismiss)
  body = document.createElement("div")
  overlay.appendChild(header)
  overlay.appendChild(body)
  overlay.style.display = "none"
  document.body.appendChild(overlay)
  return overlay
}

export function hasError() {
  return seen.size > 0
}

export function reportError(label, error) {
  if (!error) return
  const message = error.message ?? String(error)
  const key = `${label}:${message}`
  if (seen.has(key)) return
  seen.add(key)
  console.error(`[webgpu:${label}]`, message)
  ensureOverlay()
  if (!body) return
  if (count < MAX_LINES) count++
  else body.firstChild?.remove()
  const line = document.createElement("div")
  line.style.cssText = "margin:2px 0;border-top:1px dashed #602020;padding-top:2px"
  line.textContent = `[${label}] ${message}`
  body.appendChild(line)
  overlay.style.display = "block"
}

export function installErrorReporting(device) {
  if (!device) return
  device.addEventListener("uncapturederror", event => {
    reportError("uncaptured", event.error)
  })
}

// Push validation + oom + internal scopes, run fn(), pop in reverse order.
// Errors are reported asynchronously; synchronous throws are re-thrown.
export function withErrorScopes(device, label, fn) {
  if (!device) return fn()
  device.pushErrorScope("validation")
  device.pushErrorScope("out-of-memory")
  device.pushErrorScope("internal")
  let result, threw
  try {
    result = fn()
  } catch (e) {
    threw = e
  }
  device.popErrorScope().then(e => e && reportError(`${label}/internal`, e))
  device.popErrorScope().then(e => e && reportError(`${label}/oom`, e))
  device.popErrorScope().then(e => e && reportError(`${label}/validation`, e))
  if (threw) throw threw
  return result
}
