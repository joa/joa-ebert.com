import { BlueprintFigure, easeInOutSine, lerp, mulberry32, svgEl, svgText } from "../blueprint.js"

// Roofline arithmetic (Williams, Waterman and Patterson, "Roofline", CACM 2009) for the 0.8B Q8_0 model on an
// RTX 2080 SUPER. A Q8_0 weight costs 34/32 bytes and one multiply-add per token. The card does ~11.4 TFLOP/s of
// fp32 and moves ~415 GB/s, so below ~25 operations per byte the memory, not the math, sets the pace.
const BYTES_PER_WEIGHT = 34 / 32
const OPS_PER_WEIGHT = 2
const PROMPT_TOKENS = 512
const RIDGE_OPS_PER_BYTE = 25
const DECODE_OPS_PER_BYTE = OPS_PER_WEIGHT / BYTES_PER_WEIGHT
const PROMPT_OPS_PER_BYTE = DECODE_OPS_PER_BYTE * PROMPT_TOKENS
const AXIS_DECADES = 3

const SM_COUNT = 48
// Decoding keeps the math units busy at most ~2/25 of the time, so each delivery lights 4 of the 48.
const DECODE_BUSY_SM_COUNT = Math.round((SM_COUNT * DECODE_OPS_PER_BYTE) / RIDGE_OPS_PER_BYTE)
const WEIGHT_ROW_COUNT = 12
const PACKET_POOL_SIZE = 6
const PACKET_TRAVEL_MS = 1250
const POINT_MOVE_MS = 700
const HOT_COLUMN_MS = 160
// Decode, then the prompt, then decode again, unless the reader takes over first
const INTRO_SWITCH_MS = [6000, 12000]
const INTRO_PHASES = ["prompt", "decode"]

// A no-break space ties each separator to the phrase before it, so no wrapped line starts with a dot.
function readout(phrases) {
  return phrases.join(" · ")
}

const PHASES = {
  decode: {
    opsPerByte: DECODE_OPS_PER_BYTE,
    // Back to back: the bus never rests
    packetIntervalMs: PACKET_TRAVEL_MS / 5,
    passMs: 2400,
    // A frame with the bus full, for reduced motion
    stillMs: 1300,
    point: "decode ≈ 2",
    weights: "once per token",
    bus: "busy 100%",
    math: "busy ~8%",
    readout: readout([
      "decode",
      "~2 operations per byte, the card needs ~25",
      "the math waits on memory",
      "the 0.8B tops out near 500 tokens/s",
    ]),
  },
  prompt: {
    opsPerByte: PROMPT_OPS_PER_BYTE,
    packetIntervalMs: 4000,
    // The weights are read once for all 512 tokens, so the pass crawls.
    passMs: 60000,
    stillMs: 600,
    point: "prompt ≈ 1,000",
    weights: "once per prompt",
    bus: "busy ~3%",
    math: "busy 100%",
    readout: readout([
      "prompt",
      "512 tokens reuse every weight",
      "~1,000 operations per byte",
      "now the memory waits on the math",
    ]),
  },
}

const WIDE = {
  widthUnits: 720,
  heightUnits: 252,
  weights: { x: 24, y: 40, width: 130, height: 92, rowInset: 8, rowTop: 46, rowPitch: 7, rowHeight: 5 },
  bus: { x1: 162, x2: 470, y: 86, gap: 16, packetWidth: 16, packetHeight: 8 },
  math: { x: 478, y: 40, width: 204, height: 92, columns: 12, cell: 12, pitch: 16, gridTop: 56 },
  noteY: 150,
  labels: {
    weights: { x: 24, y: 28, anchor: "start", text: "weights in VRAM" },
    bus: { x: 316, y: 64, anchor: "middle", text: "memory bus · ~415 GB/s" },
    math: { x: 478, y: 28, anchor: "start", text: "48 SMs · ~11 TFLOP/s" },
  },
  gauge: {
    x1: 60,
    x2: 660,
    axisY: 206,
    pointLabelY: 176,
    regionLabelY: 192,
    tickLabelY: 222,
    ridgeLabelY: 240,
    captionY: 240,
    ridgeTopY: 188,
    ridgeBottomY: 214,
  },
}

const NARROW = {
  widthUnits: 400,
  heightUnits: 278,
  weights: { x: 20, y: 44, width: 80, height: 92, rowInset: 6, rowTop: 50, rowPitch: 6.5, rowHeight: 4.5 },
  bus: { x1: 106, x2: 238, y: 88, gap: 14, packetWidth: 12, packetHeight: 7 },
  math: { x: 246, y: 44, width: 134, height: 92, columns: 8, cell: 11, pitch: 13.5, gridTop: 54 },
  noteY: 152,
  labels: {
    weights: { x: 20, y: 30, anchor: "start", text: "weights" },
    bus: { x: 172, y: 66, anchor: "middle", text: "bus · ~415 GB/s" },
    math: { x: 246, y: 20, anchor: "start", text: ["48 SMs", "~11 TFLOP/s"] },
  },
  gauge: {
    x1: 40,
    x2: 360,
    axisY: 214,
    pointLabelY: 184,
    regionLabelY: 200,
    tickLabelY: 230,
    ridgeLabelY: 248,
    captionY: 266,
    ridgeTopY: 196,
    ridgeBottomY: 222,
  },
}

function range(count) {
  return Array.from({ length: count }, (unused, index) => index)
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function setAttrs(element, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value))
  }
}

function logX(gauge, opsPerByte) {
  return gauge.x1 + (Math.log10(opsPerByte) / AXIS_DECADES) * (gauge.x2 - gauge.x1)
}

function rowClass(index, readingRow) {
  if (index < readingRow) return "bp-box is-on"
  return index === readingRow ? "bp-box is-hot" : "bp-box"
}

export default class BandwidthBoundFigure extends BlueprintFigure {
  #parts = null
  #metrics = WIDE
  // Start with a full bus rather than a lone first packet
  #timeMs = PACKET_TRAVEL_MS
  #pointX = null
  #pointFromX = 0
  #pointMoveMs = POINT_MOVE_MS
  #isPaused = false
  #introStep = INTRO_PHASES.length
  #introElapsedMs = 0
  #busyArrival = null
  #busyCells = new Set()

  get #phase() {
    return PHASES[this.state.phase] ?? PHASES.decode
  }

  get #targetX() {
    return logX(this.#metrics.gauge, this.#phase.opsPerByte)
  }

  get #toggleButton() {
    return this.root.querySelector('[data-action="toggle"]')
  }

  get #readoutElement() {
    return this.root.querySelector(".bp-readout")
  }

  build(layout) {
    this.#metrics = layout === "wide" ? WIDE : NARROW
    this.#parts = this.#draw(this.#metrics)
    this.#pointX = this.#targetX
    this.#pointFromX = this.#pointX
    this.#pointMoveMs = POINT_MOVE_MS
    this.#busyArrival = null
    this.#showPhaseText()
  }

  update(dtMs) {
    if (this.#isPaused) return false
    this.#timeMs += dtMs
    this.#pointMoveMs = Math.min(POINT_MOVE_MS, this.#pointMoveMs + dtMs)
    this.#advanceIntro(dtMs)
    this.#render()
    return true
  }

  settle() {
    this.#pointMoveMs = POINT_MOVE_MS
    if (this.reducedMotion) this.#timeMs = this.#phase.stillMs
    const toggle = this.#toggleButton
    if (toggle) toggle.hidden = this.reducedMotion
    this.#render()
  }

  onChange(group) {
    if (group !== "phase") return
    this.#beginPhase()
    this.play()
  }

  onAction(action) {
    if (action !== "toggle") return
    this.#isPaused = !this.#isPaused
    const toggle = this.#toggleButton
    toggle.textContent = this.#isPaused ? "Play" : "Pause"
    toggle.setAttribute("aria-pressed", String(this.#isPaused))
    if (this.#isPaused) this.pause()
    else this.play()
  }

  onFirstVisible() {
    if (this.reducedMotion) return
    if (!this.hasInteracted) this.#startIntro()
    this.play()
  }

  #beginPhase() {
    this.#pointFromX = this.#pointX
    this.#pointMoveMs = this.#isPaused || this.reducedMotion ? POINT_MOVE_MS : 0
    this.#showPhaseText()
    if (this.reducedMotion) this.settle()
    else this.#render()
  }

  #startIntro() {
    this.#introStep = 0
    this.#introElapsedMs = 0
    this.#readoutElement?.setAttribute("aria-live", "off")
  }

  #endIntro() {
    this.#introStep = INTRO_PHASES.length
    this.#readoutElement?.setAttribute("aria-live", "polite")
  }

  #advanceIntro(dtMs) {
    if (this.#introStep >= INTRO_PHASES.length) return
    if (this.hasInteracted) {
      this.#endIntro()
      return
    }
    this.#introElapsedMs += dtMs
    if (this.#introElapsedMs < INTRO_SWITCH_MS[this.#introStep]) return
    const phase = INTRO_PHASES[this.#introStep]
    this.#introStep += 1
    this.setState({ phase })
    this.#beginPhase()
    if (this.#introStep === INTRO_PHASES.length) this.#endIntro()
  }

  #showPhaseText() {
    const { notes, pointLabel } = this.#parts
    const phase = this.#phase
    const isDecode = this.state.phase !== "prompt"
    notes.weights.textContent = phase.weights
    notes.bus.textContent = phase.bus
    notes.math.textContent = phase.math
    setClass(notes.bus, isDecode ? "bp-num is-hot" : "bp-num")
    setClass(notes.math, isDecode ? "bp-num is-warn" : "bp-num is-hot")
    pointLabel.textContent = phase.point
    this.setReadout(phase.readout)
  }

  // Knuth's multiplicative hash turns each delivery into its own seed, so the busy units wander over
  // the grid and land the same way on every load.
  #busyCellsFor(arrival) {
    if (arrival !== this.#busyArrival) {
      const random = mulberry32(Math.imul(arrival + 1, 2654435761))
      const busy = new Set()
      while (busy.size < DECODE_BUSY_SM_COUNT) busy.add(Math.floor(random() * SM_COUNT))
      this.#busyArrival = arrival
      this.#busyCells = busy
    }
    return this.#busyCells
  }

  #render() {
    const { packets, rows, cells, point, pointLabel } = this.#parts
    const { bus, math, gauge } = this.#metrics
    const phase = this.#phase

    const newestPacket = Math.floor(this.#timeMs / phase.packetIntervalMs)
    const travelUnits = bus.x2 - bus.x1 - bus.packetWidth
    packets.forEach((packet, index) => {
      const emitted = newestPacket - index
      const ageMs = this.#timeMs - emitted * phase.packetIntervalMs
      const isOnBus = emitted >= 0 && ageMs < PACKET_TRAVEL_MS
      if (isOnBus) setAttrs(packet, { x: roundUnits(bus.x1 + (ageMs / PACKET_TRAVEL_MS) * travelUnits) })
      setClass(packet, isOnBus ? "bp-packet" : "bp-packet is-hidden")
    })

    const passProgress = (this.#timeMs % phase.passMs) / phase.passMs
    const readingRow = Math.floor(passProgress * WEIGHT_ROW_COUNT)
    rows.forEach((row, index) => setClass(row, rowClass(index, readingRow)))

    if (this.state.phase === "prompt") {
      const hotColumn = Math.floor(this.#timeMs / HOT_COLUMN_MS) % math.columns
      cells.forEach((cell, index) =>
        setClass(cell, index % math.columns === hotColumn ? "bp-box is-hot" : "bp-box is-on")
      )
    } else {
      const busy = this.#busyCellsFor(Math.floor((this.#timeMs - PACKET_TRAVEL_MS) / phase.packetIntervalMs))
      cells.forEach((cell, index) => setClass(cell, busy.has(index) ? "bp-box is-on" : "bp-box"))
    }

    const isMoving = this.#pointMoveMs < POINT_MOVE_MS
    this.#pointX = lerp(this.#pointFromX, this.#targetX, easeInOutSine(this.#pointMoveMs / POINT_MOVE_MS))
    setAttrs(point, { cx: roundUnits(this.#pointX) })
    // The label hides while the marker travels, then settles on whichever side keeps it inside the axis.
    setClass(pointLabel, isMoving ? "bp-text is-hot is-hidden" : "bp-text is-hot")
    if (!isMoving) {
      const nearLeft = this.#pointX < gauge.x1 + 40
      const nearRight = this.#pointX > gauge.x2 - 40
      setAttrs(pointLabel, {
        x: roundUnits(nearLeft ? this.#pointX - 8 : nearRight ? this.#pointX + 8 : this.#pointX),
        "text-anchor": nearLeft ? "start" : nearRight ? "end" : "middle",
      })
    }
  }

  // Paint order is layer order: frames and rows, the bus and its packets, the grid, then the gauge and labels.
  #draw(metrics) {
    this.setViewBox(metrics.widthUnits, metrics.heightUnits)
    const { weights, bus, math, gauge } = metrics
    const add = (tag, className, attrs, parent = this.drawing) => svgEl(tag, { class: className, ...attrs }, parent)
    const text = (content, className, x, y, anchor = "middle") =>
      svgText(content, { class: className, x, y, "text-anchor": anchor, "dominant-baseline": "central" }, this.drawing)

    add("rect", "bp-box", { x: weights.x, y: weights.y, width: weights.width, height: weights.height, rx: 3 })
    const rows = range(WEIGHT_ROW_COUNT).map(row =>
      add("rect", "bp-box", {
        x: weights.x + weights.rowInset,
        y: roundUnits(weights.rowTop + row * weights.rowPitch),
        width: weights.width - 2 * weights.rowInset,
        height: weights.rowHeight,
        rx: 1,
      })
    )

    for (const offset of [-bus.gap / 2, bus.gap / 2]) {
      add("line", "bp-wire", { x1: bus.x1, y1: bus.y + offset, x2: bus.x2, y2: bus.y + offset })
    }
    const packets = range(PACKET_POOL_SIZE).map(() =>
      add("rect", "bp-packet is-hidden", {
        x: bus.x1,
        y: bus.y - bus.packetHeight / 2,
        width: bus.packetWidth,
        height: bus.packetHeight,
        rx: 1.5,
      })
    )

    add("rect", "bp-box", { x: math.x, y: math.y, width: math.width, height: math.height, rx: 3 })
    const gridWidth = (math.columns - 1) * math.pitch + math.cell
    const gridLeft = math.x + (math.width - gridWidth) / 2
    const cells = range(SM_COUNT).map(index =>
      add("rect", "bp-box", {
        x: roundUnits(gridLeft + (index % math.columns) * math.pitch),
        y: roundUnits(math.gridTop + Math.floor(index / math.columns) * math.pitch),
        width: math.cell,
        height: math.cell,
        rx: 1.5,
      })
    )

    for (const label of Object.values(metrics.labels)) text(label.text, "bp-cap", label.x, label.y, label.anchor)
    const notes = {
      weights: text("", "bp-text", weights.x + weights.width / 2, metrics.noteY),
      bus: text("", "bp-num", (bus.x1 + bus.x2) / 2, metrics.noteY),
      math: text("", "bp-num", math.x + math.width / 2, metrics.noteY),
    }

    const ridgeX = roundUnits(logX(gauge, RIDGE_OPS_PER_BYTE))
    add("line", "bp-wire is-warn is-emph", { x1: gauge.x1, y1: gauge.axisY, x2: ridgeX, y2: gauge.axisY })
    add("line", "bp-wire is-on is-emph", { x1: ridgeX, y1: gauge.axisY, x2: gauge.x2, y2: gauge.axisY })
    for (const decade of range(AXIS_DECADES + 1)) {
      const x = roundUnits(logX(gauge, 10 ** decade))
      add("line", "bp-bracket", { x1: x, y1: gauge.axisY - 4, x2: x, y2: gauge.axisY + 4 })
      text((10 ** decade).toLocaleString("en-US"), "bp-num", x, gauge.tickLabelY)
    }
    add("line", "bp-bracket is-dashed", { x1: ridgeX, y1: gauge.ridgeTopY, x2: ridgeX, y2: gauge.ridgeBottomY })
    text("card needs ≈ 25", "bp-text", ridgeX, gauge.ridgeLabelY)
    text("operations per byte", "bp-cap", gauge.x1, gauge.captionY, "start")
    text("memory-bound", "bp-text is-warn", (gauge.x1 + ridgeX) / 2, gauge.regionLabelY)
    text("compute-bound", "bp-text is-on", (ridgeX + gauge.x2) / 2, gauge.regionLabelY)

    const point = add("circle", "bp-packet", { cx: logX(gauge, DECODE_OPS_PER_BYTE), cy: gauge.axisY, r: 5 })
    const pointLabel = text("", "bp-text is-hot", 0, gauge.pointLabelY)

    return { rows, packets, cells, notes, point, pointLabel }
  }
}
