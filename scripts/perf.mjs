// Dumps the renderer's GPU pass timings (the ?perf HUD) to stdout
//
// Usage: node scripts/perf.mjs [hour] [width] [height]
import { createServer } from "vite"
import puppeteer from "puppeteer"

const APP_DIR = "C:/Users/joaeb/code/joa-ebert.com"
const { shaderBundlePlugin } = await import("../vite.config.js")

const hour = parseFloat(process.argv[2] ?? "12")
const width = parseInt(process.argv[3] ?? "1280")
const height = parseInt(process.argv[4] ?? "720")
const FRAMES = 900

const HARNESS_PATH = "/__placeholders"
const HARNESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}</style></head>
<body><canvas id="webgpu-canvas"></canvas>
<script type="module" src="/scripts/placeholder-harness.js"></script></body></html>`

function harnessPlugin() {
  return {
    name: "perf-harness",
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
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--window-size=1400,900"],
})
try {
  const page = await browser.newPage()
  page.on("pageerror", e => console.error("[perf] page error:", e.message))
  // The profiler reports via console.table, whose payload is a structured object
  // rather than text — serialize the args instead of taking msg.text().
  page.on("console", async msg => {
    const rows = await Promise.all(msg.args().map(a => a.jsonValue().catch(() => null)))
    for (const row of rows) {
      if (row && typeof row === "object") console.log(JSON.stringify(row))
    }
  })
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.goto(`${harnessURL}?mode=full&capture&perf`, { waitUntil: "load" })
  await page.evaluate(() => window.placeholders.ready)
  await page.evaluate(h => window.placeholders.setHour(h), hour)
  await page.evaluate(n => window.placeholders.awaitFrames(n), FRAMES)
  await page.close()
} finally {
  await browser.close()
  await server.close()
}
