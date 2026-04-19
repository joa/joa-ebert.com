import { readdir, stat } from "fs/promises"
import { join, extname } from "path"
import sharp from "sharp"

const POSTS_DIR = "content/posts"
const JPEG_EXTS = new Set([".jpg", ".jpeg"])

async function findJpegs(dir) {
  const results = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await findJpegs(full)))
    } else if (JPEG_EXTS.has(extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
  return results
}

async function convertToWebP(src) {
  const dest = src.replace(/\.(jpg|jpeg)$/i, ".webp")
  try {
    const [srcStat, destStat] = await Promise.all([stat(src), stat(dest)])
    if (destStat.mtimeMs >= srcStat.mtimeMs) return false
  } catch {
    // dest doesn't exist yet
  }
  await sharp(src).webp({ quality: 85 }).toFile(dest)
  return true
}

const images = await findJpegs(POSTS_DIR)
const results = await Promise.all(images.map(convertToWebP))
const converted = results.filter(Boolean).length
console.log(`[convert-images] ${converted}/${images.length} images converted to WebP`)
