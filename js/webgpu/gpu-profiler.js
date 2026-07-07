// GPU Profiler
// ############
//
// Perf HUD instrumentation, active only with ?perf in the URL. GPU pass timings
// use timestamp queries (when the adapter exposes "timestamp-query") resolved
// once per frame and read back through a small ring of map-read buffers so the
// render loop never stalls on mapAsync. CPU sections are performance.now()
// brackets. Both feed EMAs dumped as one console.table every REPORT_INTERVAL frames.

const MAX_PASS_SLOTS = 16
const REPORT_INTERVAL_FRAMES = 120
const EMA_ALPHA = 0.05
const NS_TO_MS = 1e-6

export class GpuProfiler {
  #querySet = null
  #resolveBuffer = null
  #readBuffers = []
  #pendingRead = null
  #slotByLabel = new Map()
  #usedLabels = new Set()
  #gpuEmaMs = new Map()
  #cpuEmaMs = new Map()
  #cpuStartMs = new Map()
  #frame = 0

  constructor(device) {
    if (!device.features.has("timestamp-query")) return
    const byteSize = MAX_PASS_SLOTS * 2 * 8
    this.#querySet = device.createQuerySet({ type: "timestamp", count: MAX_PASS_SLOTS * 2 })
    this.#resolveBuffer = device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    })
    this.#readBuffers = Array.from({ length: 3 }, () => ({
      buffer: device.createBuffer({ size: byteSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      busy: false,
      labels: null,
    }))
  }

  #slot(label) {
    let slot = this.#slotByLabel.get(label)
    if (slot === undefined) {
      if (this.#slotByLabel.size >= MAX_PASS_SLOTS) return -1
      slot = this.#slotByLabel.size
      this.#slotByLabel.set(label, slot)
    }
    this.#usedLabels.add(label)
    return slot
  }

  // timestampWrites descriptor for a single pass, or undefined when unavailable.
  pass(label) {
    if (!this.#querySet) return undefined
    const slot = this.#slot(label)
    if (slot < 0) return undefined
    return {
      querySet: this.#querySet,
      beginningOfPassWriteIndex: slot * 2,
      endOfPassWriteIndex: slot * 2 + 1,
    }
  }

  // A span covers several consecutive passes: the first pass gets spanBegin,
  // the last one spanEnd (timestampWrites fields are individually optional).
  spanBegin(label) {
    if (!this.#querySet) return undefined
    const slot = this.#slot(label)
    return slot < 0 ? undefined : { querySet: this.#querySet, beginningOfPassWriteIndex: slot * 2 }
  }

  spanEnd(label) {
    if (!this.#querySet) return undefined
    const slot = this.#slot(label)
    return slot < 0 ? undefined : { querySet: this.#querySet, endOfPassWriteIndex: slot * 2 + 1 }
  }

  beginFrame() {
    this.#frame++
    this.#usedLabels.clear()
  }

  // Record resolve + copy into the frame's encoder; must precede queue.submit().
  endFrame(encoder) {
    if (!this.#querySet || this.#usedLabels.size === 0) return
    encoder.resolveQuerySet(this.#querySet, 0, this.#slotByLabel.size * 2, this.#resolveBuffer, 0)
    const rb = this.#readBuffers.find(r => !r.busy)
    if (!rb) return
    encoder.copyBufferToBuffer(this.#resolveBuffer, 0, rb.buffer, 0, rb.buffer.size)
    rb.busy = true
    rb.labels = [...this.#usedLabels]
    this.#pendingRead = rb
  }

  // Map the copied timestamps; call right after queue.submit().
  readback() {
    const rb = this.#pendingRead
    this.#pendingRead = null
    if (rb) {
      rb.buffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const stamps = new BigInt64Array(rb.buffer.getMappedRange().slice(0))
          rb.buffer.unmap()
          rb.busy = false
          for (const label of rb.labels) {
            const slot = this.#slotByLabel.get(label)
            const begin = stamps[slot * 2]
            const end = stamps[slot * 2 + 1]
            if (begin === 0n || end <= begin) continue
            this.#ema(this.#gpuEmaMs, label, Number(end - begin) * NS_TO_MS)
          }
        })
        .catch(() => {
          rb.busy = false
        })
    }
    if (this.#frame % REPORT_INTERVAL_FRAMES === 0) this.#report()
  }

  cpuBegin(label) {
    this.#cpuStartMs.set(label, performance.now())
  }

  cpuEnd(label) {
    const start = this.#cpuStartMs.get(label)
    if (start !== undefined) this.#ema(this.#cpuEmaMs, label, performance.now() - start)
  }

  #ema(map, label, ms) {
    const prev = map.get(label)
    map.set(label, prev === undefined ? ms : prev + (ms - prev) * EMA_ALPHA)
  }

  #report() {
    const rows = {}
    for (const [label, ms] of this.#gpuEmaMs) rows[`gpu ${label}`] = { ms: +ms.toFixed(3) }
    for (const [label, ms] of this.#cpuEmaMs) rows[`cpu ${label}`] = { ms: +ms.toFixed(3) }
    if (Object.keys(rows).length) console.table(rows)
  }
}
