import { BlueprintFigure, Timeline, clamp, easeOutCubic, lerp, mulberry32, svgEl, svgText } from "../blueprint.js"

const EXPERT_COUNT = 256
const GRID_COLUMNS = 16
const PICKS_PER_TOKEN = 8
// The post gives no slot count, so the figure draws the slots but never prints how many there are.
const SLOT_COUNT = 48
const CACHE_COLUMNS = 8
const WARMUP_TOKENS = 300
// Any seed gives the same long-run rates; this one opens on a typical token, two misses rather than none.
const SIMULATION_SEED = 5
// Tuned with a one-off Node run over 5,000 tokens: copy mode hits about 81%, the CPU path about 79%.
export const KEEP_PROBABILITY = 0.4
export const ZIPF_EXPONENT = 1.25

// One token takes about 1.1 s: route, hits, misses, then a short hold on the outcome.
const ROUTE_MS = 200
const HITS_MS = 160
const MISSES_MS = 680
const TOKEN_HOLD_MS = 60
// A packet waits at its start before it moves, so its fade-in is done by the time it travels.
const PACKET_PARK_MS = 120
const COPY_FLIGHT_MS = 400
const COPY_STAGGER_MS = 80
const BACKGROUND_FLIGHT_MS = 520
const WIRE_GROW_MS = 200
const CPU_START_MS = 200
const RESULT_START_MS = 420
const RESULT_FLIGHT_MS = 160

// Vose's alias method: O(n) to build, then every draw is one uniform column pick plus one biased coin flip.
class AliasSampler {
  #probabilities
  #aliases

  constructor(weights) {
    const count = weights.length
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    const scaled = weights.map(weight => (weight * count) / totalWeight)
    this.#probabilities = new Float64Array(count).fill(1)
    this.#aliases = new Uint16Array(count)
    const underfull = []
    const overfull = []
    scaled.forEach((value, index) => (value < 1 ? underfull : overfull).push(index))
    while (underfull.length > 0 && overfull.length > 0) {
      const small = underfull.pop()
      const large = overfull.pop()
      this.#probabilities[small] = scaled[small]
      this.#aliases[small] = large
      scaled[large] -= 1 - scaled[small]
      if (scaled[large] < 1) underfull.push(large)
      else overfull.push(large)
    }
  }

  sample(random) {
    const column = Math.floor(random() * this.#probabilities.length)
    return random() < this.#probabilities[column] ? column : this.#aliases[column]
  }
}

// Zipf-like popularity, weight 1 / rank^s. A seeded Fisher-Yates shuffle deals out the ranks, so the
// popular experts are scattered over the grid instead of filling its first row.
function zipfPopularity(random, exponent) {
  const ranks = Array.from({ length: EXPERT_COUNT }, (_, index) => index)
  for (let index = EXPERT_COUNT - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const swapped = ranks[index]
    ranks[index] = ranks[other]
    ranks[other] = swapped
  }
  return ranks.map(rank => 1 / (rank + 1) ** exponent)
}

// The router and the expert cache, without any DOM, so Node can import it to tune the numbers.
export class RouterSimulation {
  #random
  #popularity
  #sampler
  #keepProbability
  // Expert to cache slot. A Map iterates in insertion order, so re-inserting an expert on every use
  // keeps the least recently used one first: an O(1) LRU.
  #slotByExpert = new Map()
  #previousPicks = []
  #mode
  #tokenCount = 0
  #hitCount = 0

  constructor({
    mode = "copy",
    seed = SIMULATION_SEED,
    keepProbability = KEEP_PROBABILITY,
    zipfExponent = ZIPF_EXPONENT,
    warmupTokens = WARMUP_TOKENS,
  } = {}) {
    this.#random = mulberry32(seed)
    this.#keepProbability = keepProbability
    this.#popularity = zipfPopularity(this.#random, zipfExponent)
    this.#sampler = new AliasSampler(this.#popularity)
    this.#mode = mode
    for (let token = 0; token < warmupTokens; token += 1) this.step()
    this.#resetStats()
  }

  get mode() {
    return this.#mode
  }

  get hitRate() {
    return this.#tokenCount === 0 ? 0 : this.#hitCount / (this.#tokenCount * PICKS_PER_TOKEN)
  }

  // The cache survives a change of strategy; only the running statistics start over.
  setMode(mode) {
    this.#mode = mode
    this.#resetStats()
  }

  step() {
    const picks = this.#route().map(expert => {
      const slot = this.#slotByExpert.get(expert) ?? null
      return { expert, slot, isHit: slot !== null }
    })
    const hits = picks.filter(pick => pick.isHit)
    // Touch every hit before inserting anything, so a token's misses never evict its own hits.
    for (const { expert, slot } of hits) {
      this.#slotByExpert.delete(expert)
      this.#slotByExpert.set(expert, slot)
    }
    const isBackground = this.#mode === "cpu"
    const copies = this.#chooseCopies(picks.filter(pick => !pick.isHit)).map(({ expert }) => ({
      expert,
      slot: this.#insert(expert),
      isBackground,
    }))
    this.#tokenCount += 1
    this.#hitCount += hits.length
    return Object.freeze({
      number: this.#tokenCount,
      mode: this.#mode,
      picks,
      copies,
      hitCount: hits.length,
      hitRate: this.hitRate,
    })
  }

  #resetStats() {
    this.#tokenCount = 0
    this.#hitCount = 0
  }

  // Temporal locality: each of the previous token's picks comes back with keepProbability, the rest are
  // drawn by popularity, rejecting duplicates.
  #route() {
    const picks = this.#previousPicks.filter(() => this.#random() < this.#keepProbability)
    while (picks.length < PICKS_PER_TOKEN) {
      const expert = this.#sampler.sample(this.#random)
      if (!picks.includes(expert)) picks.push(expert)
    }
    this.#previousPicks = picks
    return picks
  }

  // Copy mode brings every miss over. The CPU path computes its misses from system RAM and copies only
  // the most popular one into the cache, in the background, for later tokens.
  #chooseCopies(misses) {
    if (this.#mode === "copy" || misses.length === 0) return misses
    const popularity = this.#popularity
    return [misses.reduce((best, miss) => (popularity[miss.expert] > popularity[best.expert] ? miss : best))]
  }

  #insert(expert) {
    let slot = this.#slotByExpert.size
    if (slot >= SLOT_COUNT) {
      const [leastRecentExpert, freedSlot] = this.#slotByExpert.entries().next().value
      this.#slotByExpert.delete(leastRecentExpert)
      slot = freedSlot
    }
    this.#slotByExpert.set(expert, slot)
    return slot
  }
}

function latticeRect(index, columns, leftUnits, topUnits, sizeUnits, pitchUnits) {
  return {
    x: leftUnits + (index % columns) * pitchUnits,
    y: topUnits + Math.floor(index / columns) * pitchUnits,
    width: sizeUnits,
    height: sizeUnits,
  }
}

const PACKET_LENGTH_UNITS = 14
const PACKET_THICKNESS_UNITS = 6
const LINK_HALF_GAP_UNITS = 5

// A packet's rect at progress t of a straight path, centered on it; the packet's front ends at toUnits.
function horizontalPacket(fromXUnits, toXUnits, centerYUnits) {
  return t => ({
    x: lerp(fromXUnits, toXUnits - PACKET_LENGTH_UNITS, t),
    y: centerYUnits - PACKET_THICKNESS_UNITS / 2,
    width: PACKET_LENGTH_UNITS,
    height: PACKET_THICKNESS_UNITS,
  })
}

function verticalPacket(centerXUnits, fromYUnits, toYUnits) {
  return t => ({
    x: centerXUnits - PACKET_THICKNESS_UNITS / 2,
    y: lerp(fromYUnits, toYUnits - PACKET_LENGTH_UNITS, t),
    width: PACKET_THICKNESS_UNITS,
    height: PACKET_LENGTH_UNITS,
  })
}

// System RAM on the left, the PCIe link across the middle with the CPU under it, the GPU on the right.
function wideLayout() {
  const gpuFrame = { x: 455, y: 30, width: 245, height: 242 }
  const restBox = { x: 467.5, y: 232, width: 220, height: 28 }
  const cpuBox = { x: 290, y: 224, width: 130, height: 44 }
  const linkLeftUnits = 262
  const linkYUnits = 140
  const restYUnits = restBox.y + restBox.height / 2
  return {
    widthUnits: 720,
    heightUnits: 280,
    cell: expert => latticeRect(expert, GRID_COLUMNS, 30, 30, 12, 14),
    slot: index => latticeRect(index, CACHE_COLUMNS, 467.5, 58, 24, 28),
    gpuFrame,
    restBox,
    cpuBox,
    cpuPort: { x: cpuBox.x, y: cpuBox.y + cpuBox.height / 2 },
    linkLines: [-1, 1].map(side => {
      const y = linkYUnits + side * LINK_HALF_GAP_UNITS
      return { x1: linkLeftUnits, y1: y, x2: gpuFrame.x, y2: y }
    }),
    linkPacket: horizontalPacket(linkLeftUnits, gpuFrame.x, linkYUnits),
    resultPacket: horizontalPacket(cpuBox.x + cpuBox.width, restBox.x, restYUnits),
    labels: [
      { text: "256 experts · one layer · system RAM", x: 30, y: 20, anchor: "start", className: "bp-text" },
      { text: "GPU", x: gpuFrame.x, y: 20, anchor: "start", className: "bp-cap" },
      { text: "expert cache", x: restBox.x, y: 49, anchor: "start", className: "bp-cap" },
      { text: "PCIe · 6.4 GB/s", x: (linkLeftUnits + gpuFrame.x) / 2, y: linkYUnits - 14, anchor: "middle" },
      {
        text: "rest of the model · ~2 GB",
        x: restBox.x + restBox.width / 2,
        y: restYUnits,
        anchor: "middle",
        baseline: "central",
      },
    ],
  }
}

// The grid on top, the link running down into the GPU, the CPU beside the link.
function narrowLayout() {
  const gpuFrame = { x: 20, y: 316, width: 360, height: 184 }
  const restBox = { x: 236, y: 346, width: 132, height: 50 }
  const cpuBox = { x: 242, y: 250, width: 120, height: 44 }
  const linkTopUnits = 228
  const linkXUnits = 200
  const restXUnits = restBox.x + restBox.width / 2
  return {
    widthUnits: 400,
    heightUnits: 506,
    cell: expert => latticeRect(expert, GRID_COLUMNS, 105, 30, 10, 12),
    slot: index => latticeRect(index, CACHE_COLUMNS, 32, 346, 20, 24),
    gpuFrame,
    restBox,
    cpuBox,
    cpuPort: { x: cpuBox.x + cpuBox.width / 2, y: cpuBox.y },
    linkLines: [-1, 1].map(side => {
      const x = linkXUnits + side * LINK_HALF_GAP_UNITS
      return { x1: x, y1: linkTopUnits, x2: x, y2: gpuFrame.y }
    }),
    linkPacket: verticalPacket(linkXUnits, linkTopUnits, gpuFrame.y),
    resultPacket: verticalPacket(restXUnits, cpuBox.y + cpuBox.height, restBox.y),
    labels: [
      { text: "256 experts · one layer · system RAM", x: 200, y: 20, anchor: "middle" },
      { text: "PCIe · 6.4 GB/s", x: linkXUnits - 12, y: 272, anchor: "end", baseline: "central" },
      { text: "GPU", x: gpuFrame.x, y: gpuFrame.y - 8, anchor: "start", className: "bp-cap" },
      { text: "expert cache", x: 32, y: 336, anchor: "start", className: "bp-cap" },
      {
        text: ["rest of the model", "~2 GB"],
        x: restXUnits,
        y: restBox.y + restBox.height / 2 - 7.5,
        anchor: "middle",
        baseline: "central",
      },
    ],
  }
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

function setRect(element, rect) {
  for (const name of ["x", "y", "width", "height"]) element.setAttribute(name, roundUnits(rect[name]))
}

function setLine(element, from, to) {
  element.setAttribute("x1", roundUnits(from.x))
  element.setAttribute("y1", roundUnits(from.y))
  element.setAttribute("x2", roundUnits(to.x))
  element.setAttribute("y2", roundUnits(to.y))
}

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function readoutFor(token) {
  const hitPercent = Math.round(token.hitRate * 100)
  const hits = `${token.hitCount} of ${PICKS_PER_TOKEN} already on the card`
  return `token ${token.number.toLocaleString("en-US")} · ${hits} · hit rate so far ${hitPercent}% · simulated routing`
}

// A live simulation: while in view it routes one token about every 1.1 s until the reader pauses it.
export default class ExpertCacheFigure extends BlueprintFigure {
  #simulation = null
  #token = null
  #parts = null
  #timeline = new Timeline([])
  #isPaused = false

  start() {
    // Quiet while the first token is written at load; #syncPlayback() sets the real value.
    this.root.querySelector(".bp-readout")?.setAttribute("aria-live", "off")
    super.start()
    if (this.reducedMotion) this.#isPaused = true
    this.#syncPlayback()
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => this.#syncPlayback())
  }

  build(layout) {
    this.#simulation ??= new RouterSimulation({ mode: this.state.miss })
    this.#token ??= this.#simulation.step()
    this.#parts = this.#draw(layout === "wide" ? wideLayout() : narrowLayout())
    this.#timeline = this.#createTimeline(this.#token)
  }

  update(dtMs) {
    if (this.#timeline.advance(dtMs)) return true
    if (this.#isPaused) return false
    this.#nextToken()
    return true
  }

  settle() {
    this.#timeline.seekEnd()
  }

  // Also runs when reduced motion is switched on. Pausing lands on the settled token.
  pause() {
    this.#isPaused = true
    this.#timeline.seekEnd()
    super.pause()
    this.#syncPlayback()
  }

  onFirstVisible() {
    if (!this.#isPaused) this.play()
  }

  onChange(group, value) {
    if (group !== "miss" || value === this.#simulation.mode) return
    this.#simulation.setMode(value)
    this.#stepNow()
  }

  onAction(action) {
    if (action === "step") this.#stepNow()
    else if (action === "toggle" && this.#isPaused) this.#resume()
    else if (action === "toggle") this.pause()
  }

  #resume() {
    this.#isPaused = false
    this.#syncPlayback()
    this.play()
  }

  // Finishes the token on screen and plays the next one; under reduced motion play() settles it at once.
  #stepNow() {
    this.#timeline.seekEnd()
    this.#nextToken()
    this.play()
  }

  #nextToken() {
    this.#token = this.#simulation.step()
    this.#timeline = this.#createTimeline(this.#token)
  }

  // The readout is live only while paused, so Pause and Step are announced but a running simulation isn't.
  // Under reduced motion the figure never runs on its own and Step walks through it, so Play is hidden.
  #syncPlayback() {
    const toggle = this.root.querySelector('[data-action="toggle"]')
    if (toggle) {
      toggle.textContent = this.#isPaused ? "Play" : "Pause"
      toggle.setAttribute("aria-pressed", String(this.#isPaused))
      toggle.hidden = this.reducedMotion
    }
    this.root.querySelector(".bp-readout")?.setAttribute("aria-live", this.#isPaused ? "polite" : "off")
  }

  #createTimeline(token) {
    return new Timeline([
      { durationMs: 0, apply: () => this.#showIdle(token) },
      { durationMs: ROUTE_MS, apply: progress => this.#showRoute(token, progress) },
      { durationMs: HITS_MS, apply: progress => this.#showHits(token, progress) },
      { durationMs: MISSES_MS, apply: progress => this.#showMisses(token, progress * MISSES_MS) },
      { durationMs: 0, apply: () => this.setReadout(readoutFor(token)) },
      { durationMs: TOKEN_HOLD_MS, apply: () => {} },
    ])
  }

  #draw(spec) {
    this.setViewBox(spec.widthUnits, spec.heightUnits)
    const layer = this.drawing
    svgEl("rect", { class: "bp-bracket", rx: 4, ...spec.gpuFrame }, layer)
    for (const line of spec.linkLines) svgEl("line", { class: "bp-wire", ...line }, layer)
    svgEl("rect", { class: "bp-box", rx: 3, ...spec.restBox }, layer)
    const cpuBox = svgEl("rect", { class: "bp-box", rx: 3, ...spec.cpuBox }, layer)
    const cells = Array.from({ length: EXPERT_COUNT }, (_, expert) =>
      svgEl("rect", { class: "bp-box", rx: 2, ...spec.cell(expert) }, layer)
    )
    const slots = Array.from({ length: SLOT_COUNT }, (_, slot) =>
      svgEl("rect", { class: "bp-box", rx: 3, ...spec.slot(slot) }, layer)
    )
    for (const label of spec.labels) {
      const attrs = {
        class: label.className ?? "bp-text",
        x: roundUnits(label.x),
        y: roundUnits(label.y),
        "text-anchor": label.anchor,
        "dominant-baseline": label.baseline ?? "alphabetic",
      }
      svgText(label.text, attrs, layer)
    }
    const cpuCenter = centerOf(spec.cpuBox)
    const cpuLabel = svgText(
      "CPU",
      { class: "bp-cap", x: cpuCenter.x, y: cpuCenter.y, "text-anchor": "middle", "dominant-baseline": "central" },
      layer
    )
    const wires = Array.from({ length: PICKS_PER_TOKEN }, () =>
      svgEl("line", { class: "bp-wire is-dashed is-warn is-hidden" }, layer)
    )
    const packets = Array.from({ length: PICKS_PER_TOKEN }, () =>
      svgEl("rect", { class: "bp-packet is-warn is-hidden", rx: 2, ...spec.linkPacket(1) }, layer)
    )
    const resultPacket = svgEl("rect", { class: "bp-packet is-hidden", rx: 2, ...spec.resultPacket(1) }, layer)
    return { spec, cells, slots, cpuBox, cpuLabel, wires, packets, resultPacket }
  }

  #showIdle(token) {
    const { cells, slots, cpuBox, cpuLabel, wires, packets, resultPacket } = this.#parts
    for (const cell of cells) setClass(cell, "bp-box")
    for (const slot of slots) setClass(slot, "bp-box")
    for (const wire of wires) setClass(wire, "bp-wire is-dashed is-warn is-hidden")
    for (const packet of packets) setClass(packet, "bp-packet is-warn is-hidden")
    setClass(resultPacket, "bp-packet is-hidden")
    const isCpuIdle = token.mode === "copy"
    setClass(cpuBox, isCpuIdle ? "bp-box is-idle" : "bp-box")
    setClass(cpuLabel, isCpuIdle ? "bp-cap is-idle" : "bp-cap")
  }

  #showRoute(token, progress) {
    for (const pick of token.picks) setClass(this.#parts.cells[pick.expert], progress > 0 ? "bp-box is-hot" : "bp-box")
  }

  #showHits(token, progress) {
    const isShown = progress > 0
    for (const pick of token.picks.filter(pick => pick.isHit)) {
      setClass(this.#parts.cells[pick.expert], isShown ? "bp-box is-on" : "bp-box is-hot")
      setClass(this.#parts.slots[pick.slot], isShown ? "bp-box is-on" : "bp-box")
    }
  }

  #showMisses(token, elapsedMs) {
    const misses = token.picks.filter(pick => !pick.isHit)
    for (const pick of misses) {
      setClass(this.#parts.cells[pick.expert], elapsedMs > 0 ? "bp-box is-warn is-hot" : "bp-box is-hot")
    }
    this.#showCopies(token.copies, elapsedMs)
    if (token.mode === "cpu") this.#showCpuPath(misses, elapsedMs)
  }

  // Copies queue at the link and cross it one after another at constant speed. The least recently used
  // slot empties while its new expert is on the way, then lights up. A background copy is drawn dimmer.
  #showCopies(copies, elapsedMs) {
    const { packets, slots, spec } = this.#parts
    const spreadMs = MISSES_MS - PACKET_PARK_MS - COPY_FLIGHT_MS
    const staggerMs = copies.length > 1 ? Math.min(COPY_STAGGER_MS, spreadMs / (copies.length - 1)) : 0
    copies.forEach((copy, index) => {
      const queuedMs = elapsedMs - index * staggerMs
      const flightMs = copy.isBackground ? BACKGROUND_FLIGHT_MS : COPY_FLIGHT_MS
      const flight = clamp((queuedMs - PACKET_PARK_MS) / flightMs, 0, 1)
      const isQueued = queuedMs > 0
      const dimmer = copy.isBackground ? " is-idle" : ""
      // A packet that isn't queued yet stays put, so one still fading out from the last token doesn't jump.
      if (isQueued) setRect(packets[index], spec.linkPacket(flight))
      setClass(packets[index], `bp-packet is-warn${dimmer}${isQueued && flight < 1 ? "" : " is-hidden"}`)
      const slotClass = !isQueued ? "bp-box" : flight < 1 ? "bp-box is-dashed is-idle" : `bp-box is-on${dimmer}`
      setClass(slots[copy.slot], slotClass)
    })
  }

  // Each miss is read by the CPU straight from system RAM; its result then crosses to the GPU.
  #showCpuPath(misses, elapsedMs) {
    const { wires, spec, cpuBox, cpuLabel, resultPacket } = this.#parts
    const growth = easeOutCubic(clamp(elapsedMs / WIRE_GROW_MS, 0, 1))
    misses.forEach((pick, index) => {
      const from = centerOf(spec.cell(pick.expert))
      setLine(wires[index], from, { x: lerp(from.x, spec.cpuPort.x, growth), y: lerp(from.y, spec.cpuPort.y, growth) })
      setClass(wires[index], `bp-wire is-dashed is-warn${elapsedMs > 0 ? "" : " is-hidden"}`)
    })
    const isComputing = misses.length > 0 && elapsedMs >= CPU_START_MS
    const isPulsing = isComputing && elapsedMs < RESULT_START_MS
    setClass(cpuBox, isPulsing ? "bp-box is-hot" : isComputing ? "bp-box is-on" : "bp-box")
    setClass(cpuLabel, isComputing ? "bp-cap is-on" : "bp-cap")
    const resultFlight = clamp((elapsedMs - RESULT_START_MS) / RESULT_FLIGHT_MS, 0, 1)
    const isResultShown = misses.length > 0 && elapsedMs >= RESULT_START_MS - PACKET_PARK_MS && resultFlight < 1
    setRect(resultPacket, spec.resultPacket(resultFlight))
    setClass(resultPacket, isResultShown ? "bp-packet" : "bp-packet is-hidden")
  }
}
