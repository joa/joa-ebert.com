// Placeholder Generator
// #####################
//
// Renders the WebGPU header scene in headless Chrome and exports one static
// image per hour of the day for desktop and mobile (48 total) into
// assets/placeholders/. js/main.js shows the image matching the current hour
// and device when WebGPU is unavailable.
//
// Usage: npm run gen-placeholders

import { createServer } from "vite"
import { mkdir } from "fs/promises"
import { resolve } from "path"
import puppeteer from "puppeteer"
import sharp from "sharp"
import { shaderBundlePlugin } from "../vite.config.js"

const APP_DIR = resolve(import.meta.dirname, "..")
const OUT_DIR = resolve(APP_DIR, "assets", "placeholders")
const HOURS = 24
const WARMUP_FRAMES = 120
const SETTLE_FRAMES = 45
const WEBP_QUALITY = 85

// Captures are supersampled: rendered at SUPERSAMPLE times the shipped size
// (via deviceScaleFactor) and downscaled with Lanczos for crisp grass blades.
const SUPERSAMPLE = 2

// Header geometry per layout: the index header is 62vh of a common viewport
// (layouts/index.html), the compact blog header is 20vh (layouts/_default/
// baseof.html). Mobile is emulated (UA + touch) so S.isMobile renders the
// authentic mobile scene; outputScale 2 ships retina.
const DEVICES = [
  {
    name: "desktop",
    viewport: { width: 1920, height: 670 },
    compactViewport: { width: 1920, height: 216 },
    outputScale: 1,
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 523, isMobile: true, hasTouch: true },
    compactViewport: { width: 390, height: 169, isMobile: true, hasTouch: true },
    outputScale: 2,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
      "Version/17.0 Mobile/15E148 Safari/604.1",
  },
]

// The compact (blog) scene is theme-driven, not clock-driven: one capture per
// theme at the renderer's compactHourForDark hours (see js/webgpu/renderer.js).
const COMPACT_SHOTS = [
  { theme: "light", hour: 12 },
  { theme: "dark", hour: 21.9 },
]

const HARNESS_PATH = "/__placeholders"
const HARNESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
      canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
    </style>
  </head>
  <body>
    <canvas id="webgpu-canvas"></canvas>
    <script type="module" src="/scripts/placeholder-harness.js"></script>
  </body>
</html>`

function harnessPlugin() {
  return {
    name: "placeholder-harness",
    configureServer(server) {
      server.middlewares.use(HARNESS_PATH, (req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(HARNESS_HTML)
      })
    },
  }
}

async function launchBrowser(headless) {
  return puppeteer.launch({
    headless,
    args: ["--enable-unsafe-webgpu", "--enable-gpu", "--window-size=1920,1080"],
  })
}

// navigator.gpu only exists in secure contexts, so probe on the (localhost)
// harness page rather than about:blank.
async function hasWebGPU(browser, harnessURL) {
  const page = await browser.newPage()
  await page.goto(harnessURL, { waitUntil: "load" })
  const ok = await page.evaluate(async () => Boolean(navigator.gpu && (await navigator.gpu.requestAdapter())))
  await page.close()
  return ok
}

async function openHarness(browser, harnessURL, device, viewport, mode) {
  const page = await browser.newPage()
  page.on("pageerror", error => console.error(`[gen-placeholders] ${device.name} page error:`, error.message))
  await page.setViewport({ ...viewport, deviceScaleFactor: device.outputScale * SUPERSAMPLE })
  if (device.userAgent) await page.setUserAgent(device.userAgent)
  await page.goto(`${harnessURL}?mode=${mode}&capture`, { waitUntil: "load" })
  await page.evaluate(() => window.placeholders.ready)
  await page.evaluate(n => window.placeholders.awaitFrames(n), WARMUP_FRAMES)
  return page
}

async function captureShot(page, device, viewport, hour, name) {
  await page.evaluate(h => window.placeholders.setHour(h), hour)
  await page.evaluate(n => window.placeholders.awaitFrames(n), SETTLE_FRAMES)
  const png = await page.screenshot({ type: "png" })
  await sharp(png)
    .resize(viewport.width * device.outputScale, viewport.height * device.outputScale, { kernel: "lanczos3" })
    .webp({ quality: WEBP_QUALITY })
    .toFile(resolve(OUT_DIR, name))
  console.log(`[gen-placeholders] ${name}`)
}

async function captureDevice(browser, harnessURL, device) {
  let page = await openHarness(browser, harnessURL, device, device.viewport, "full")
  for (let hour = 0; hour < HOURS; hour++) {
    await captureShot(page, device, device.viewport, hour, `${device.name}-${String(hour).padStart(2, "0")}.webp`)
  }
  await page.close()

  page = await openHarness(browser, harnessURL, device, device.compactViewport, "small")
  for (const { theme, hour } of COMPACT_SHOTS) {
    await captureShot(page, device, device.compactViewport, hour, `compact-${device.name}-${theme}.webp`)
  }
  await page.close()
}

await mkdir(OUT_DIR, { recursive: true })

const server = await createServer({
  configFile: false,
  root: APP_DIR,
  plugins: [shaderBundlePlugin(), harnessPlugin()],
  server: { port: 0 },
  logLevel: "warn",
})
await server.listen()
const harnessURL = new URL(HARNESS_PATH, server.resolvedUrls.local[0]).href

let browser = await launchBrowser(true)
if (!(await hasWebGPU(browser, harnessURL))) {
  console.warn("[gen-placeholders] no WebGPU adapter in headless Chrome, retrying with a visible window")
  await browser.close()
  browser = await launchBrowser(false)
  if (!(await hasWebGPU(browser, harnessURL))) {
    await browser.close()
    await server.close()
    throw new Error("no WebGPU adapter available in Chrome")
  }
}

try {
  for (const device of DEVICES) {
    await captureDevice(browser, harnessURL, device)
  }
} finally {
  await browser.close()
  await server.close()
}

console.log(`[gen-placeholders] wrote ${DEVICES.length * (HOURS + COMPACT_SHOTS.length)} images to assets/placeholders`)
