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

export async function loadGLB(url) {
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

  const bin = chunks.get(CHUNK_BIN) ?? null

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
