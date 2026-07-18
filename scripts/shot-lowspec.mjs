// Renders the scene on the mobile/low-spec path and reports any WebGPU errors.
//
// S.lowSpec is `isMobile && !isCapture`
//
// Usage: node scripts/shot-lowspec.mjs <hour[,hour...]> [width] [height]
import { createServer } from "vite"
import puppeteer from "puppeteer"
import { resolve } from "path"

const APP_DIR = "C:/Users/joaeb/code/joa-ebert.com"
const OUT_DIR = process.env.SHOT_OUT_DIR ?? "."
const { shaderBundlePlugin } = await import("../vite.config.js")

const hours = (process.argv[2] ?? "12").split(",").map(parseFloat)
const width = parseInt(process.argv[3] ?? "390")
const height = parseInt(process.argv[4] ?? "500")
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

const HARNESS_PATH = "/__placeholders"
const HARNESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}</style></head>
<body><canvas id="webgpu-canvas"></canvas>
<script type="module" src="/scripts/placeholder-harness.js"></script></body></html>`

function harnessPlugin() {
  return {
    name: "lowspec-harness",
    configureServer(server) {
      server.middlewares.use(HARNESS_PATH, (req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(HARNESS_HTML)
      })
    },
  }
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

const browser = await puppeteer.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--window-size=800,900"],
})
let failed = false
try {
  const page = await browser.newPage()
  await page.setUserAgent(IPHONE_UA)
  page.on("pageerror", e => {
    failed = true
    console.error("[lowspec] page error:", e.message)
  })
  page.on("console", msg => {
    const t = msg.text()
    if (/error|invalid|validation/i.test(t)) {
      failed = true
      console.error("[lowspec] console:", t)
    }
  })
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  // No ?capture — that flag is what would switch S.lowSpec back off.
  await page.goto(`${harnessURL}?mode=full`, { waitUntil: "load" })
  await page.evaluate(() => window.placeholders.ready)
  await page.evaluate(n => window.placeholders.awaitFrames(n), 120)
  for (const hour of hours) {
    await page.evaluate(h => window.placeholders.setHour(h), hour)
    await page.evaluate(n => window.placeholders.awaitFrames(n), 40)
    const name = `lowspec-${String(hour).replace(".", "_")}.png`
    await page.screenshot({ type: "png", path: resolve(OUT_DIR, name) })
    console.log(`[lowspec] wrote ${name}`)
  }
  await page.close()
} finally {
  await browser.close()
  await server.close()
}
process.exit(failed ? 1 : 0)
