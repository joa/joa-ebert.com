const COMPONENT_TYPES = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
}

const ELEMENT_SIZE = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const DRACO_EXT = "KHR_draco_mesh_compression"

async function parseGLB(url) {
  const buffer = await fetch(url).then(r => r.arrayBuffer())

  if (new DataView(buffer).getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB file")

  const chunks = new Map()
  let offset = 12

  while (offset < buffer.byteLength) {
    const view = new DataView(buffer, offset, 8)
    const length = view.getUint32(0, true)
    const type = view.getUint32(4, true)
    if (!chunks.has(type)) chunks.set(type, buffer.slice(offset + 8, offset + 8 + length))
    offset += 8 + length
  }

  const json = JSON.parse(new TextDecoder().decode(chunks.get(CHUNK_JSON)))
  if (json.extensionsUsed?.includes(DRACO_EXT) || json.extensionsRequired?.includes(DRACO_EXT)) {
    throw new Error("no draco support")
  }

  return { json, bin: chunks.get(CHUNK_BIN) ?? null }
}

export async function loadGLB(url) {
  const { json, bin } = await parseGLB(url)

  return json.meshes.flatMap(mesh =>
    mesh.primitives
      .map(({ attributes, indices }) => {
        const positions = readAccessorData(json, bin, attributes.POSITION)
        const normals = readAccessorData(json, bin, attributes.NORMAL)
        const indexData = readAccessorData(json, bin, indices)
        return positions && indexData ? { positions, normals, indices: indexData } : null
      })
      .filter(Boolean)
  )
}

// Rotation part of a glTF quaternion [x, y, z, w] as a row-major 3×3.
function quatToMat3(q) {
  const [x, y, z, w] = q
  const xx = x * x,
    yy = y * y,
    zz = z * z
  const xy = x * y,
    xz = x * z,
    yz = y * z
  const wx = w * x,
    wy = w * y,
    wz = w * z
  // prettier-ignore
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz),     2 * (xz + wy),
    2 * (xy + wz),     1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy),     2 * (yz + wx),     1 - 2 * (xx + yy),
  ]
}

// Loads a full glTF scene graph and bakes every mesh into a single merged,
// world-space vertex/index set. Node transforms are composed as T·R·S (all
// nodes in our assets are flat — no parenting — so the node's local TRS is its
// world transform). Per-vertex albedo/roughness/metalness come from each
// primitive's PBR material (glTF defaults: white, 1.0, 1.0). Because R is
// orthonormal, the correct normal transform for a possibly non-uniform or
// mirrored scale is R·diag(1/sx, 1/sy, 1/sz) — no full matrix inverse needed.
//
// `skipNode(name)` lets the caller drop non-geometry nodes (studio lights,
// ground planes, shadow catchers) that Blender exports alongside the model.
//
// `mirrorHalvesAcrossX`: some parts were modelled with a Blender Mirror modifier
// (plane X = 0) that was never applied before export, so the GLB holds only one
// half (e.g. the road bike's handlebar — left drop + tape only). We detect such
// a mesh by its fingerprint — it reaches the X = 0 plane and extends past ±0.25
// on exactly one side — and emit its reflection (negate X, flip winding). Parts
// that already have both halves, or sit near the centreline, don't match and are
// left untouched.
//
// `emissiveNode(name)` returns a per-node emissive strength (0 = not emissive).
// It is baked into a per-vertex `emissive` scalar so light-emitting parts (e.g.
// the bike's head/tail lights) can bypass shading downstream.
export async function loadGLBMerged(url, { skipNode, mirrorHalvesAcrossX = false, emissiveNode } = {}) {
  const { json, bin } = await parseGLB(url)

  const positions = []
  const normals = []
  const colors = []
  const material = [] // [roughness, metalness] per vertex
  const emissive = [] // emissive strength per vertex (0 = lit normally)
  const indices = []
  const bboxMin = [Infinity, Infinity, Infinity]
  const bboxMax = [-Infinity, -Infinity, -Infinity]

  for (const node of json.nodes) {
    if (node.mesh == null) continue
    if (skipNode?.(node.name ?? "")) continue

    const t = node.translation ?? [0, 0, 0]
    const s = node.scale ?? [1, 1, 1]
    const r = quatToMat3(node.rotation ?? [0, 0, 0, 1])
    const invS = [1 / s[0], 1 / s[1], 1 / s[2]]

    const nodeEmissive = emissiveNode?.(node.name ?? "") ?? 0

    const nodeVertStart = positions.length / 3
    const nodeIndexStart = indices.length
    let nodeXMin = Infinity
    let nodeXMax = -Infinity

    for (const prim of json.meshes[node.mesh].primitives) {
      const pos = readAccessorData(json, bin, prim.attributes.POSITION)
      const idx = readAccessorData(json, bin, prim.attributes.indices ?? prim.indices)
      if (!pos || !idx) continue
      const nrm = readAccessorData(json, bin, prim.attributes.NORMAL)

      const pbr = json.materials?.[prim.material]?.pbrMetallicRoughness ?? {}
      const [cr, cg, cb] = pbr.baseColorFactor ?? [1, 1, 1, 1]
      const roughness = pbr.roughnessFactor ?? 1.0
      const metalness = pbr.metallicFactor ?? 1.0

      const base = positions.length / 3
      for (let i = 0; i < pos.count; i++) {
        const px = pos.data[i * 3] * s[0],
          py = pos.data[i * 3 + 1] * s[1],
          pz = pos.data[i * 3 + 2] * s[2]
        const wx = t[0] + r[0] * px + r[1] * py + r[2] * pz
        const wy = t[1] + r[3] * px + r[4] * py + r[5] * pz
        const wz = t[2] + r[6] * px + r[7] * py + r[8] * pz
        positions.push(wx, wy, wz)
        nodeXMin = Math.min(nodeXMin, wx)
        nodeXMax = Math.max(nodeXMax, wx)
        bboxMin[0] = Math.min(bboxMin[0], wx)
        bboxMin[1] = Math.min(bboxMin[1], wy)
        bboxMin[2] = Math.min(bboxMin[2], wz)
        bboxMax[0] = Math.max(bboxMax[0], wx)
        bboxMax[1] = Math.max(bboxMax[1], wy)
        bboxMax[2] = Math.max(bboxMax[2], wz)

        const nx = (nrm ? nrm.data[i * 3] : 0) * invS[0]
        const ny = (nrm ? nrm.data[i * 3 + 1] : 1) * invS[1]
        const nz = (nrm ? nrm.data[i * 3 + 2] : 0) * invS[2]
        let ox = r[0] * nx + r[1] * ny + r[2] * nz
        let oy = r[3] * nx + r[4] * ny + r[5] * nz
        let oz = r[6] * nx + r[7] * ny + r[8] * nz
        const len = Math.hypot(ox, oy, oz) || 1
        normals.push(ox / len, oy / len, oz / len)

        colors.push(cr, cg, cb)
        material.push(roughness, metalness)
        emissive.push(nodeEmissive)
      }
      for (let i = 0; i < idx.count; i++) indices.push(base + idx.data[i])
    }

    // Reflect an unapplied-Mirror half across X = 0 (see doc above): reaches the
    // centre plane and extends past ±0.25 on one side only.
    const reachesCentre = nodeXMax >= -0.05 && nodeXMax <= 0.03 && nodeXMin < -0.25
    const reachesCentreR = nodeXMin >= -0.03 && nodeXMin <= 0.05 && nodeXMax > 0.25
    if (mirrorHalvesAcrossX && (reachesCentre || reachesCentreR)) {
      const vertEnd = positions.length / 3
      const indexEnd = indices.length
      const mirrorBase = vertEnd - nodeVertStart
      for (let v = nodeVertStart; v < vertEnd; v++) {
        const mx = -positions[v * 3]
        positions.push(mx, positions[v * 3 + 1], positions[v * 3 + 2])
        normals.push(-normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2])
        colors.push(colors[v * 3], colors[v * 3 + 1], colors[v * 3 + 2])
        material.push(material[v * 2], material[v * 2 + 1])
        emissive.push(emissive[v])
        bboxMin[0] = Math.min(bboxMin[0], mx)
        bboxMax[0] = Math.max(bboxMax[0], mx)
      }
      // Reversing winding keeps the reflected triangles front-facing.
      for (let k = nodeIndexStart; k < indexEnd; k += 3) {
        indices.push(indices[k] + mirrorBase, indices[k + 2] + mirrorBase, indices[k + 1] + mirrorBase)
      }
    }
  }

  if (indices.length === 0) return null

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    material: new Float32Array(material),
    emissive: new Float32Array(emissive),
    indices: new Uint32Array(indices),
    indexCount: indices.length,
    bbox: { min: bboxMin, max: bboxMax },
  }
}

function readAccessorData(json, bin, accessorIndex) {
  if (accessorIndex == null) return null

  const accessor = json.accessors[accessorIndex]
  if (accessor.bufferView === undefined) return null

  const bufferView = json.bufferViews[accessor.bufferView]
  const offset = (accessor.byteOffset ?? 0) + (bufferView.byteOffset ?? 0)
  const Type = COMPONENT_TYPES[accessor.componentType]

  return {
    data: new Type(bin, offset, accessor.count * ELEMENT_SIZE[accessor.type]),
    componentType: accessor.componentType,
    count: accessor.count,
  }
}
