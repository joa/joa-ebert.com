// Voronoi
// #######
//
// CPU-side Voronoi cell lookup mirroring grass.wgsl for grass tuft placement
// pre-baking. Used by gpu-updates.js and the Voronoi web worker.

function hash(px, pz) {
  const s = Math.sin(px * 127.1 + pz * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function hash2(px, pz) {
  const d1 = px * 127.1 + pz * 311.7,
    d2 = px * 269.5 + pz * 183.3
  const s1 = Math.sin(d1) * 43758.5453,
    s2 = Math.sin(d2) * 43758.5453
  return [s1 - Math.floor(s1), s2 - Math.floor(s2)]
}

export function voronoiCell(px, pz) {
  const ipx = Math.floor(px),
    ipz = Math.floor(pz)
  const fpx = px - ipx,
    fpz = pz - ipz
  let f1 = 8.0,
    bestX = 0,
    bestZ = 0

  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [h1, h2] = hash2(ipx + i, ipz + j)
      const dx = i + h1 * 0.55 + 0.225 - fpx
      const dz = j + h2 * 0.55 + 0.225 - fpz
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < f1) {
        f1 = d
        bestX = ipx + i
        bestZ = ipz + j
      }
    }
  }

  return [f1, hash(bestX + 0.5, bestZ + 0.5)]
}
