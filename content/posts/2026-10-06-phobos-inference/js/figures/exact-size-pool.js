import { BlueprintFigure, Timeline, clamp, easeOutCubic, lerp, mulberry32, svgEl, svgText } from "../blueprint.js"

const REQUEST_COUNT = 30
const REQUEST_MS = 700
// Moments within one request, as fractions of REQUEST_MS: a fresh allocation lands, the pass ends and
// its buffers go idle, and a beat later the agent's are stranded.
const ALLOCATED_AT = 0.25
const PASS_ENDS_AT = 0.5
const STRANDED_AT = 0.75

// Illustrative sizes, in tenths of a GiB so the sums stay exact: 6.0 + 30 × 0.3 = 15 GiB.
const BASELINE_TENTHS = 60
const PASS_TENTHS = 3
const CARD_GIB = 8
const GAUGE_MAX_GIB = 16
const FILL_INSET_UNITS = 3

const BUFFERS_PER_PASS = 5
const BENCHMARK_TOKENS = 512
const AGENT_SEED = 2511
const AGENT_FIRST_TOKENS = 1850
const AGENT_FIRST_SPREAD_TOKENS = 40
const AGENT_GROWTH_MIN_TOKENS = 120
const AGENT_GROWTH_MAX_TOKENS = 680
const MAX_SHAPE_KEY = "max shape"

const BLOCK_CLASSES = {
  fresh: "bp-box is-hot",
  inUse: "bp-box is-on",
  idle: "bp-box",
  stranded: "bp-box is-warn",
}

function formatCount(count) {
  return count.toLocaleString("en-US")
}

// No-break spaces keep each "·" on the line it closes, every number with its unit and "in use" whole.
const NBSP = " "
const SEPARATOR = `${NBSP}· `

function formatGiB(tenths) {
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)
}

function gibText(tenths) {
  return `${formatGiB(tenths)}${NBSP}GiB`
}

function range(count) {
  return [...Array(count).keys()]
}

// A transcript only grows: every request re-sends everything so far plus a new, ragged turn.
function agentTokens() {
  const random = mulberry32(AGENT_SEED)
  const tokens = [AGENT_FIRST_TOKENS + Math.round((random() - 0.5) * AGENT_FIRST_SPREAD_TOKENS)]
  while (tokens.length < REQUEST_COUNT) {
    tokens.push(tokens.at(-1) + Math.round(lerp(AGENT_GROWTH_MIN_TOKENS, AGENT_GROWTH_MAX_TOKENS, random())))
  }
  return tokens
}

// sizesRepeat: whether a finished pass's size ever comes up again. The agent's never does, so its
// shelves are stranded for good once their pass ends.
const WORKLOADS = {
  benchmark: {
    requestTokens: () => Array(REQUEST_COUNT).fill(BENCHMARK_TOKENS),
    poolKey: formatCount,
    sizesRepeat: true,
  },
  agent: { requestTokens: agentTokens, poolKey: formatCount, sizesRepeat: false },
  bounds: { requestTokens: agentTokens, poolKey: () => MAX_SHAPE_KEY, sizesRepeat: true },
}

// The pool is a Map keyed by exact size with one shelf per key: a request takes the shelf filed under
// its own size or allocates a fresh pass's worth of buffers. A pass ends before the next request
// arrives, so a matching shelf is always idle when it is asked for.
export function simulateRun(workloadName) {
  const workload = WORKLOADS[workloadName]
  const shelfIndexByKey = new Map()
  const requests = workload.requestTokens().map((tokens, index) => {
    const key = workload.poolKey(tokens)
    const isReused = shelfIndexByKey.has(key)
    if (!isReused) shelfIndexByKey.set(key, shelfIndexByKey.size)
    return {
      number: index + 1,
      tokens,
      shelfIndex: shelfIndexByKey.get(key),
      isReused,
      shelfCount: shelfIndexByKey.size,
    }
  })
  return { requests, shelfKeys: [...shelfIndexByKey.keys()], sizesRepeat: workload.sizesRepeat }
}

// Everything the figure shows while request requestIndex is at progress (a fraction of REQUEST_MS).
// requestIndex -1 is the empty pool before the first request; isFinished is the end of the run.
export function snapshotAt(run, requestIndex, progress, isFinished = false) {
  const request = run.requests[requestIndex]
  const shelfCount = request?.shelfCount ?? 0
  const isFresh = request !== undefined && !request.isReused
  const finishedStatus = run.sizesRepeat ? "idle" : "stranded"
  let passStatus = finishedStatus
  if (isFresh && progress < ALLOCATED_AT) passStatus = "fresh"
  else if (progress < PASS_ENDS_AT) passStatus = "inUse"
  else if (progress < STRANDED_AT) passStatus = "idle"
  const shelvesNewestFirst = run.shelfKeys
    .slice(0, shelfCount)
    .map((key, shelfIndex) => ({ key, status: shelfIndex === request.shelfIndex ? passStatus : finishedStatus }))
    .reverse()

  const strandedTenths = PASS_TENTHS * shelvesNewestFirst.filter(shelf => shelf.status === "stranded").length
  const allocatedTenths = BASELINE_TENTHS + PASS_TENTHS * shelfCount
  const pendingTenths = isFresh ? PASS_TENTHS * (1 - easeOutCubic(clamp(progress / ALLOCATED_AT, 0, 1))) : 0
  const memory = `${gibText(allocatedTenths)} in${NBSP}use on an ${CARD_GIB}${NBSP}GiB card`
  const isRunning = request !== undefined && !isFinished
  const readoutParts = isRunning
    ? [
        `request ${request.number}`,
        `${formatCount(request.tokens)}${NBSP}tokens`,
        `reused:${NBSP}${request.isReused ? "yes" : "no"}`,
        `stranded:${NBSP}${gibText(strandedTenths)}`,
        memory,
        "illustrative sizes",
      ]
    : [`${requestIndex + 1} requests`, `${gibText(strandedTenths)} stranded`, memory, "illustrative sizes"]
  return {
    requestsNewestFirst: run.requests.slice(0, requestIndex + 1).reverse(),
    shelvesNewestFirst,
    usedGiB: (allocatedTenths - pendingTenths) / 10,
    isRunning,
    isFinished,
    readout: readoutParts.join(SEPARATOR),
  }
}

// The rect covering fromGiB..toGiB along the gauge, inset across it and at its zero end.
function gaugeRect(gauge, fromGiB, toGiB, insetUnits = 0) {
  const startUnits = fromGiB * gauge.unitsPerGiB + (fromGiB === 0 ? insetUnits : 0)
  const alongUnits = Math.max(0, toGiB * gauge.unitsPerGiB - startUnits)
  const acrossUnits = gauge.thicknessUnits - 2 * insetUnits
  if (gauge.isVertical) {
    return { x: gauge.x + insetUnits, y: gauge.y - startUnits - alongUnits, width: acrossUnits, height: alongUnits }
  }
  return { x: gauge.x + startUnits, y: gauge.y + insetUnits, width: alongUnits, height: acrossUnits }
}

// Requests, the pool's shelves and a vertical memory gauge side by side. Both lists run newest on
// top, so each request shares a row with the shelf it used.
function wideLayout() {
  const rowCenterYUnits = row => 46 + row * 29
  const blocksLeftUnits = 272
  const blockPitchUnits = 35
  const blocksRightUnits = blocksLeftUnits + (BUFFERS_PER_PASS - 1) * blockPitchUnits + 30
  // Vertical: x is the left edge, y the zero end at the bottom.
  const gauge = { isVertical: true, x: 566, y: 280, thicknessUnits: 36, unitsPerGiB: 15 }
  const cardLineYUnits = gauge.y - CARD_GIB * gauge.unitsPerGiB
  const gaugeLabelXUnits = gauge.x + gauge.thicknessUnits + 14
  return {
    widthUnits: 720,
    heightUnits: 292,
    requestRowCount: 8,
    shelfRowCount: 8,
    captions: [
      { text: "requests", x: 20, y: 14 },
      { text: "pool shelves", x: 210, y: 14 },
      { text: "GPU memory", x: gauge.x, y: 14 },
    ],
    requestRow: row => ({ x: 20, y: rowCenterYUnits(row) }),
    shelfLabel: row => ({ x: blocksLeftUnits - 10, y: rowCenterYUnits(row) }),
    block: (row, index) => ({
      x: blocksLeftUnits + index * blockPitchUnits,
      y: rowCenterYUnits(row) - 8,
      width: 30,
      height: 16,
    }),
    shelfLine: row => `M ${blocksLeftUnits - 4} ${rowCenterYUnits(row) + 11} H ${blocksRightUnits + 4}`,
    strandedLabel: row => ({ x: blocksRightUnits + 12, y: rowCenterYUnits(row) }),
    moreLabel: { x: blocksLeftUnits, y: rowCenterYUnits(8) },
    gauge,
    cardLine: `M ${gauge.x - 8} ${cardLineYUnits} H ${gauge.x + gauge.thicknessUnits + 8}`,
    gaugeLabels: [
      { text: "16 GiB", x: gaugeLabelXUnits, y: gauge.y - GAUGE_MAX_GIB * gauge.unitsPerGiB, className: "bp-num" },
      { text: "8 GiB card", x: gaugeLabelXUnits, y: cardLineYUnits, className: "bp-text" },
      { text: "0", x: gaugeLabelXUnits, y: gauge.y, className: "bp-num" },
    ],
    spillLabel: { lines: ["spilled to", "system RAM"], x: gaugeLabelXUnits, y: cardLineYUnits - 38 },
  }
}

// The gauge becomes a bar across the top and the shelves stack below it; the readout names the
// current request instead of a list.
function narrowLayout() {
  const rowCenterYUnits = row => 132 + row * 34
  const blocksLeftUnits = 92
  const blockPitchUnits = 40
  const blocksRightUnits = blocksLeftUnits + (BUFFERS_PER_PASS - 1) * blockPitchUnits + 35
  // Horizontal: x is the zero end on the left, y the top edge.
  const gauge = { isVertical: false, x: 20, y: 26, thicknessUnits: 28, unitsPerGiB: 22.5 }
  const cardLineXUnits = gauge.x + CARD_GIB * gauge.unitsPerGiB
  const underBarYUnits = gauge.y + gauge.thicknessUnits + 18
  return {
    widthUnits: 400,
    heightUnits: 350,
    requestRowCount: 0,
    shelfRowCount: 6,
    captions: [
      { text: "GPU memory", x: 20, y: 12 },
      { text: "pool shelves", x: 20, y: 106 },
    ],
    shelfLabel: row => ({ x: blocksLeftUnits - 10, y: rowCenterYUnits(row) }),
    block: (row, index) => ({
      x: blocksLeftUnits + index * blockPitchUnits,
      y: rowCenterYUnits(row) - 10,
      width: 35,
      height: 20,
    }),
    shelfLine: row => `M ${blocksLeftUnits - 4} ${rowCenterYUnits(row) + 14} H ${blocksRightUnits + 4}`,
    strandedLabel: row => ({ x: blocksRightUnits + 12, y: rowCenterYUnits(row) }),
    moreLabel: { x: blocksLeftUnits, y: rowCenterYUnits(6) },
    gauge,
    cardLine: `M ${cardLineXUnits} ${gauge.y - 8} V ${gauge.y + gauge.thicknessUnits + 8}`,
    gaugeLabels: [
      { text: "16 GiB", x: gauge.x + GAUGE_MAX_GIB * gauge.unitsPerGiB, y: 12, anchor: "end", className: "bp-num" },
      { text: "0", x: gauge.x, y: underBarYUnits, className: "bp-num" },
      { text: "8 GiB card", x: cardLineXUnits - 8, y: underBarYUnits, anchor: "end", className: "bp-text" },
    ],
    spillLabel: { lines: ["spilled to system RAM"], x: cardLineXUnits + 8, y: underBarYUnits },
  }
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text
}

function setGeometry(element, geometry) {
  for (const [name, value] of Object.entries(geometry)) {
    const text = String(roundUnits(value))
    if (element.getAttribute(name) !== text) element.setAttribute(name, text)
  }
}

function paintShelf({ line, blocks, label }, shelf) {
  if (!shelf) {
    setClass(line, "bp-bracket is-hidden")
    for (const block of blocks) setClass(block, "bp-box is-hidden")
    setClass(label, "bp-num is-hidden")
    return
  }
  setClass(line, "bp-bracket")
  for (const block of blocks) setClass(block, BLOCK_CLASSES[shelf.status])
  setText(label, shelf.key)
  const labelClass = shelf.key === MAX_SHAPE_KEY ? "bp-text" : "bp-num"
  const isWorking = shelf.status === "fresh" || shelf.status === "inUse"
  setClass(label, isWorking ? `${labelClass} is-on` : labelClass)
}

export default class ExactSizePoolFigure extends BlueprintFigure {
  #parts = null
  #readoutElement = null
  #timeline = new Timeline([])

  get tour() {
    return [{ workload: "benchmark" }, { workload: "agent" }]
  }

  build(layout) {
    this.#readoutElement = this.root.querySelector(".bp-readout")
    this.#parts = this.#draw(layout === "wide" ? wideLayout() : narrowLayout())
    this.#timeline = this.#createTimeline()
  }

  update(dtMs) {
    return this.#timeline.advance(dtMs)
  }

  settle() {
    this.#timeline.seekEnd()
  }

  onChange() {
    this.#replay()
  }

  onAction(action) {
    if (action === "replay") this.#replay()
  }

  #replay() {
    this.#timeline = this.#createTimeline()
    // Shows the new run at once, even while the loop waits for the figure to scroll into view
    this.#timeline.advance(0)
    this.play()
  }

  #createTimeline() {
    const run = simulateRun(this.state.workload)
    const lastIndex = run.requests.length - 1
    return new Timeline([
      { durationMs: 0, apply: () => this.#show(snapshotAt(run, -1, 0)) },
      ...range(run.requests.length).map(index => ({
        durationMs: REQUEST_MS,
        apply: progress => this.#show(snapshotAt(run, index, progress)),
      })),
      { durationMs: 0, apply: () => this.#show(snapshotAt(run, lastIndex, 1, true)) },
    ])
  }

  #draw(spec) {
    this.setViewBox(spec.widthUnits, spec.heightUnits)
    const addText = (content, { x, y, anchor = "start", className }) =>
      svgText(
        content,
        { class: className, x: roundUnits(x), y: roundUnits(y), "text-anchor": anchor, "dominant-baseline": "central" },
        this.drawing
      )
    for (const caption of spec.captions) addText(caption.text, { ...caption, className: "bp-cap" })

    const cardFrame = svgEl("rect", { class: "bp-box", rx: 2 }, this.drawing)
    setGeometry(cardFrame, gaugeRect(spec.gauge, 0, CARD_GIB))
    // Past the card's own memory the gauge is dashed: that part lives in system RAM.
    const spillFrame = svgEl("rect", { class: "bp-box is-dashed", rx: 2 }, this.drawing)
    setGeometry(spillFrame, gaugeRect(spec.gauge, CARD_GIB, GAUGE_MAX_GIB))
    const cardFill = svgEl("rect", { class: "bp-box is-on", rx: 1.5 }, this.drawing)
    const spillFill = svgEl("rect", { class: "bp-box is-warn is-hot is-hidden", rx: 1.5 }, this.drawing)
    svgEl("path", { class: "bp-bracket is-emph", d: spec.cardLine }, this.drawing)
    for (const label of spec.gaugeLabels) addText(label.text, label)
    const spillLabel = addText(spec.spillLabel.lines, { ...spec.spillLabel, className: "bp-text is-warn is-hidden" })

    const requestRows = range(spec.requestRowCount).map(row =>
      addText("", { ...spec.requestRow(row), className: "bp-num is-hidden" })
    )
    const shelfRows = range(spec.shelfRowCount).map(row => ({
      line: svgEl("path", { class: "bp-bracket is-hidden", d: spec.shelfLine(row) }, this.drawing),
      blocks: range(BUFFERS_PER_PASS).map(index =>
        svgEl("rect", { class: "bp-box is-hidden", rx: 2, ...spec.block(row, index) }, this.drawing)
      ),
      label: addText("", { ...spec.shelfLabel(row), anchor: "end", className: "bp-num is-hidden" }),
    }))
    const strandedLabel = addText("stranded", { ...spec.strandedLabel(0), className: "bp-text is-warn is-hidden" })
    const moreLabel = addText("", { ...spec.moreLabel, className: "bp-text is-warn is-hidden" })
    return { spec, cardFill, spillFill, spillLabel, requestRows, shelfRows, strandedLabel, moreLabel }
  }

  #show(snapshot) {
    const { spec, requestRows, shelfRows, strandedLabel, moreLabel } = this.#parts
    requestRows.forEach((rowText, row) => {
      const request = snapshot.requestsNewestFirst[row]
      if (request) setText(rowText, `#${request.number} · ${formatCount(request.tokens)} tokens`)
      const isCurrent = row === 0 && snapshot.isRunning
      setClass(rowText, !request ? "bp-num is-hidden" : isCurrent ? "bp-num is-hot" : "bp-num")
    })

    shelfRows.forEach((shelfRow, row) => paintShelf(shelfRow, snapshot.shelvesNewestFirst[row]))
    // The label rides with the oldest stranded shelf still on screen, so it only moves with its shelf.
    const visibleShelves = snapshot.shelvesNewestFirst.slice(0, shelfRows.length)
    const strandedRow = visibleShelves.findLastIndex(shelf => shelf.status === "stranded")
    if (strandedRow >= 0) setGeometry(strandedLabel, spec.strandedLabel(strandedRow))
    setClass(strandedLabel, strandedRow >= 0 ? "bp-text is-warn" : "bp-text is-warn is-hidden")
    const collapsedCount = snapshot.shelvesNewestFirst.length - shelfRows.length
    if (collapsedCount > 0) setText(moreLabel, `+ ${collapsedCount} more ${collapsedCount === 1 ? "shelf" : "shelves"}`)
    setClass(moreLabel, collapsedCount > 0 ? "bp-text is-warn" : "bp-text is-warn is-hidden")

    this.#showGauge(snapshot.usedGiB)
    this.#showReadout(snapshot)
  }

  #showGauge(usedGiB) {
    const { spec, cardFill, spillFill, spillLabel } = this.#parts
    const isSpilled = usedGiB > CARD_GIB
    setGeometry(cardFill, gaugeRect(spec.gauge, 0, Math.min(usedGiB, CARD_GIB), FILL_INSET_UNITS))
    setGeometry(spillFill, gaugeRect(spec.gauge, CARD_GIB, Math.max(usedGiB, CARD_GIB), FILL_INSET_UNITS))
    setClass(spillFill, isSpilled ? "bp-box is-warn is-hot" : "bp-box is-warn is-hot is-hidden")
    setClass(spillLabel, isSpilled ? "bp-text is-warn" : "bp-text is-warn is-hidden")
  }

  // A run rewrites the readout every few hundred milliseconds. The live region stays quiet until the
  // run ends, so a screen reader announces the result rather than every request.
  #showReadout(snapshot) {
    const politeness = snapshot.isFinished ? "polite" : "off"
    if (this.#readoutElement?.getAttribute("aria-live") !== politeness) {
      this.#readoutElement?.setAttribute("aria-live", politeness)
    }
    this.setReadout(snapshot.readout)
  }
}
