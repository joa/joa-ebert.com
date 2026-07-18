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
const WARMUP_FRAMES = 120
const SETTLE_FRAMES = 40

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

async function launch(headless) {
  return puppeteer.launch({ headless, args: ["--enable-unsafe-webgpu", "--enable-gpu", "--window-size=1280,720"] })
}
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

let browser = await launch(true)
if (!(await hasWebGPU(browser, harnessURL))) {
  await browser.close()
  browser = await launch(false)
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
