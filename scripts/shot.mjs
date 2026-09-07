// Single-hour small screenshot of the WebGPU header scene, for visual iteration.
// Usage: node shot.mjs <hour> [width] [height]
import { createServer } from "vite"
import puppeteer from "puppeteer"
import { pathToFileURL } from "url"
import { resolve } from "path"

const APP_DIR = process.env.SHOT_APP_DIR
const OUT_DIR = process.env.SHOT_OUT_DIR

const { shaderBundlePlugin } = await import("../vite.config.js")

const hours = (process.argv[2] ?? "14.33").split(",").map(parseFloat)
const width = parseInt(process.argv[3] ?? "512")
const height = parseInt(process.argv[4] ?? "340")
const WARMUP_FRAMES = parseInt(process.env.SHOT_WARMUP ?? "120")
const SETTLE_FRAMES = parseInt(process.env.SHOT_SETTLE ?? "40")

const HARNESS_PATH = "/__placeholders"
const HARNESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}</style></head>
<body><canvas id="webgpu-canvas"></canvas>
<script type="module" src="/scripts/placeholder-harness.js"></script></body></html>`

function harnessPlugin() {
  return {
    name: "shot-harness",
    configureServer(server) {
      server.middlewares.use(HARNESS_PATH, (req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(HARNESS_HTML)
      })
    },
  }
}

async function launch(headless, gpuArgs = ["--enable-gpu"]) {
  return puppeteer.launch({
    headless,
    protocolTimeout: 3_600_000, // software rendering can take seconds per frame
    args: ["--enable-unsafe-webgpu", "--no-sandbox", "--window-size=1280,720", ...gpuArgs],
  })
}
// Probe for a WebGPU adapter in a blank page on an http origin (about:blank
// hides navigator.gpu). The probe browser is thrown away either way: SwiftShader
// misbehaves when the shot page shares a browser with an earlier adapter probe.
async function hasWebGPU(browser, url) {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: "load" })
  const ok = await page.evaluate(async () => Boolean(navigator.gpu && (await navigator.gpu.requestAdapter())))
  await page.close()
  return ok
}

const server = await createServer({
  configFile: false,
  root: APP_DIR,
  plugins: [shaderBundlePlugin(), harnessPlugin()],
  server: { port: 0 },
  logLevel: "warn",
})
await server.listen()
const harnessURL = new URL(HARNESS_PATH, server.resolvedUrls.local[0]).href

// Software WebGPU for GPU-less containers. The full SwiftShader stack (Vulkan
// device + ANGLE GL for compositing) is required — the shorter
// --use-webgpu-adapter=swiftshader creates a device that Dawn silently destroys
// on the first canvas present. Slow (seconds per frame) but correct and
// deterministic; SHOT_WARMUP/SHOT_SETTLE trim the frame counts to compensate.
const SOFTWARE_ARGS = [
  "--enable-features=Vulkan",
  "--use-vulkan=swiftshader",
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--disable-gpu-watchdog",
]

const hardwareProbe = await launch(true)
const hardwareOK = await hasWebGPU(hardwareProbe, harnessURL)
await hardwareProbe.close()
let browser
if (hardwareOK) {
  browser = await launch(true)
} else {
  const softwareProbe = await launch(true, SOFTWARE_ARGS)
  const softwareOK = await hasWebGPU(softwareProbe, harnessURL)
  await softwareProbe.close()
  browser = softwareOK ? await launch(true, SOFTWARE_ARGS) : await launch(false)
}

try {
  const page = await browser.newPage()
  page.on("pageerror", e => console.error("[shot] page error:", e.message))
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  // DBG=N forwards the renderer's ?dbg= G-buffer visualisation modes.
  const dbg = process.env.DBG ? `&dbg=${process.env.DBG}` : ""
  await page.goto(`${harnessURL}?mode=full&capture${dbg}`, { waitUntil: "load" })
  await page.evaluate(() => window.placeholders.ready)
  // Optional close-up camera override: CAM='[[px,py,pz],[lx,ly,lz]]'
  if (process.env.CAM) {
    const [pos, look] = JSON.parse(process.env.CAM)
    await page.evaluate(([p, l]) => window.placeholders.setCamera(p, l), [pos, look])
  }
  // Optional timeInfo overrides: OVR='{"fogIntensity":3,"depthOfField":7}'
  if (process.env.OVR) {
    for (const [key, value] of Object.entries(JSON.parse(process.env.OVR))) {
      await page.evaluate(([k, v]) => window.placeholders.setOverride(k, v), [key, value])
    }
  }
  await page.evaluate(n => window.placeholders.awaitFrames(n), WARMUP_FRAMES)
  for (const hour of hours) {
    await page.evaluate(h => window.placeholders.setHour(h), hour)
    await page.evaluate(n => window.placeholders.awaitFrames(n), SETTLE_FRAMES)
    const name = `shot-${String(hour).replace(".", "_")}.png`
    await page.screenshot({ type: "png", path: resolve(OUT_DIR, name) })
    console.log(`[shot] wrote ${name}`)
  }
  await page.close()
} finally {
  await browser.close()
  await server.close()
}
