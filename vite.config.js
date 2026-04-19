import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import hugoPlugin from "vite-hugo-plugin"
import { readdirSync, readFileSync } from "fs"
import { join, resolve } from "path"

const SHADER_VIRTUAL_ID = "\0shaders-bundle"
const WGSL_VIRTUAL_ID = "\0wgsl-shaders-bundle"
const APP_DIR = resolve(import.meta.dirname)
const DIST_DIR = resolve(APP_DIR, "dist")

function minifyGLSL(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, "")
  const out = []
  let pending = ""
  for (let raw of src.split("\n")) {
    const ci = raw.indexOf("//")
    if (ci !== -1) raw = raw.slice(0, ci)
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("#")) {
      if (pending) {
        out.push(pending)
        pending = ""
      }
      out.push(line)
    } else {
      pending = pending ? pending + " " + line : line
    }
  }
  if (pending) out.push(pending)
  return out
    .map(l => (l.startsWith("#") ? l : l.replace(/  +/g, " ").replace(/ ?([\{\}\(\)\[\];,]) ?/g, "$1")))
    .join("\n")
}

function shaderBundlePlugin() {
  return {
    name: "shader-bundle",
    resolveId(id) {
      if (id.endsWith("wgsl-shaders-bundle.js")) return WGSL_VIRTUAL_ID
      if (id.endsWith("shaders-bundle.js")) return SHADER_VIRTUAL_ID
    },
    load(id) {
      if (id === SHADER_VIRTUAL_ID) {
        const shaderDir = "js/webgl/shaders"
        const entries = readdirSync(shaderDir).filter(f => f.endsWith(".vert") || f.endsWith(".frag"))
        for (const filename of entries) {
          this.addWatchFile(resolve(shaderDir, filename))
        }
        const lines = ["export default {"]
        for (const filename of entries) {
          const src = readFileSync(join(shaderDir, filename), "utf8")
          const minified = minifyGLSL(src).replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
          lines.push(`  ${JSON.stringify(filename)}: \`${minified}\`,`)
        }
        lines.push("}")
        return lines.join("\n")
      }

      if (id === WGSL_VIRTUAL_ID) {
        const shaderDir = "js/webgpu/shaders"
        let entries
        try {
          entries = readdirSync(shaderDir).filter(f => f.endsWith(".wgsl"))
        } catch {
          return "export default {}"
        }
        for (const filename of entries) {
          this.addWatchFile(resolve(shaderDir, filename))
        }
        const lines = ["export default {"]
        for (const filename of entries) {
          const src = readFileSync(join(shaderDir, filename), "utf8")
          const minified = minifyWGSL(src).replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
          lines.push(`  ${JSON.stringify(filename)}: \`${minified}\`,`)
        }
        lines.push("}")
        return lines.join("\n")
      }
    },
  }
}

function minifyWGSL(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, "")
  const lines = []
  for (const raw of src.split("\n")) {
    const ci = raw.indexOf("//")
    const line = (ci !== -1 ? raw.slice(0, ci) : raw).trim()
    if (line) lines.push(line)
  }
  return lines.join("\n").replace(/  +/g, " ")
}

// vite-hugo-plugin sets root=hugoOutDir, emptyOutDir=false, and aliases js→assets/js,
// none of which fit our setup (Hugo now owns all HTML; Vite only bundles JS/CSS).
// This plugin runs after hugoPlugin in the array and restores the correct values.
function hugoPluginOverride() {
  return {
    name: "hugo-plugin-override",
    config: () => ({
      root: APP_DIR,
      resolve: {
        alias: {
          js: resolve(APP_DIR, "js"),
          "/assets": resolve(APP_DIR, "assets"),
        },
      },
      build: {
        outDir: DIST_DIR,
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(APP_DIR, "js", "main.js"),
        },
      },
    }),
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    shaderBundlePlugin(),
    hugoPlugin({ appDir: APP_DIR, hugoOutDir: DIST_DIR }),
    hugoPluginOverride(),
    viteStaticCopy({
      targets: [{ src: "assets", dest: "." }],
    }),
  ],
  server: {
    watch: { usePolling: true },
    proxy: {
      "^/$": "http://localhost:1313",
      "/posts": "http://localhost:1313",
      "/favicon.svg": "http://localhost:1313",
      "/livereload": { target: "http://localhost:1313", ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "js/main.js",
        assetFileNames: assetInfo => (assetInfo.name?.endsWith(".css") ? "css/main.css" : "assets/[name][extname]"),
      },
    },
  },
})
