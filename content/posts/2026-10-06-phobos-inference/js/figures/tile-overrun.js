import { BlueprintFigure, Timeline, mulberry32, svgEl, svgText } from "../blueprint.js"

const ROW_COUNT = 40
const TILE_ROWS = 32
const OUTPUT_ROWS = 5
// With fresh cudaMalloc, rows 5 to 33 are slack and the next allocation starts here.
const FRESH_NEXT_ROW = 34
const WRITE_MS = 1600
const CHECK_MS = 500
const CHECK_READ_PORTION = 0.6
const GARBAGE_BEAT_MS = 600
const GARBAGE_PULSE_MS = 900
const GARBAGE_PULSE_PORTION = 0.4
const TEXTURE_SEED = 32

const LABELS = {
  tile: "tile 0 · 32 rows",
  check: "check reads these",
  overrun: "27 rows past the end",
  masked: "masked",
  output: "your output · 5 rows",
  pool: "next allocation · in use",
  slack: "slack",
  next: "next allocation",
  garbage: "its owner reads garbage later",
}

const READOUTS = {
  fresh: "27 rows written past the end · into slack · the check passes",
  pool: "27 rows written past the end · into a live buffer · the check still passes",
  masked: "masked · nothing written past the end",
}

const ROW_STATUS_CLASSES = {
  untouched: "",
  written: " is-on",
  reading: " is-hot",
  overwritten: " is-warn",
  pulse: " is-warn is-hot",
}

// Memory runs left to right: rows are tall cells in one strip, brackets above and below it.
function wideLayout() {
  const stripTopUnits = 70
  const cell = row => ({ x: 40 + row * 16, y: stripTopUnits, width: 15, height: 34 })
  const centerXUnits = (fromRow, toRow) => (cell(fromRow).x + cell(toRow).x + 15) / 2
  const bracket = (fromRow, toRow, lineYUnits, tickYUnits) =>
    `M ${cell(fromRow).x + 1} ${tickYUnits} V ${lineYUnits} H ${cell(toRow).x + 14} V ${tickYUnits}`
  const above = (fromRow, toRow) => bracket(fromRow, toRow, stripTopUnits - 18, stripTopUnits - 11)
  const below = (fromRow, toRow) => bracket(fromRow, toRow, stripTopUnits + 50, stripTopUnits + 43)
  const aboveLabelYUnits = stripTopUnits - 25
  const belowLabelYUnits = stripTopUnits + 65
  const frameLeftUnits = cell(0).x - 5.5
  const frameRightUnits = cell(TILE_ROWS - 1).x + 20.5
  return {
    widthUnits: 720,
    heightUnits: 168,
    cell,
    head: position => ({ x: cell(0).x - 2.5 + position * 16, y: stripTopUnits - 5, width: 20, height: 44 }),
    textureTicks: (rect, random) =>
      [0, 1, 2].map(index => {
        const y = rect.y + 8 + index * 9 + random() * 2
        return { x1: rect.x + 3, y1: y, x2: rect.x + 7 + random() * 5, y2: y }
      }),
    brackets: {
      tile: `M ${frameLeftUnits} ${stripTopUnits - 6} V ${stripTopUnits - 44} H ${frameRightUnits} V ${stripTopUnits - 6}`,
      check: above(0, OUTPUT_ROWS - 1),
      overrun: above(OUTPUT_ROWS, TILE_ROWS - 1),
      output: below(0, OUTPUT_ROWS - 1),
      pool: below(OUTPUT_ROWS, ROW_COUNT - 1),
      slack: below(OUTPUT_ROWS, FRESH_NEXT_ROW - 1),
      next: below(FRESH_NEXT_ROW, ROW_COUNT - 1),
    },
    labels: {
      tile: { x: frameLeftUnits, y: stripTopUnits - 52, anchor: "start", className: "bp-cap" },
      check: { x: cell(0).x + 1, y: aboveLabelYUnits, anchor: "start" },
      overrun: { x: centerXUnits(OUTPUT_ROWS, TILE_ROWS - 1), y: aboveLabelYUnits, anchor: "middle" },
      output: { x: cell(0).x + 1, y: belowLabelYUnits, anchor: "start" },
      pool: { x: centerXUnits(OUTPUT_ROWS, ROW_COUNT - 1), y: belowLabelYUnits, anchor: "middle" },
      slack: { x: centerXUnits(OUTPUT_ROWS, FRESH_NEXT_ROW - 1), y: belowLabelYUnits, anchor: "middle" },
      next: { x: centerXUnits(FRESH_NEXT_ROW, ROW_COUNT - 1), y: belowLabelYUnits, anchor: "middle" },
      garbage: { x: centerXUnits(OUTPUT_ROWS, ROW_COUNT - 1), y: belowLabelYUnits + 17, anchor: "middle" },
    },
    baseline: "alphabetic",
  }
}

// Memory runs top to bottom: rows are wide cells in one column, the tile bracket on the left,
// memory regions (inner lane) and the tile's two parts (outer lane) on the right.
function narrowLayout() {
  const columnTopUnits = 30
  const cell = row => ({ x: 40, y: columnTopUnits + row * 10, width: 200, height: 8 })
  const centerYUnits = (fromRow, toRow) => (cell(fromRow).y + cell(toRow).y + 8) / 2
  const bracket = lineXUnits => (fromRow, toRow) =>
    `M ${lineXUnits - 5} ${cell(fromRow).y} H ${lineXUnits} V ${cell(toRow).y + 8} H ${lineXUnits - 5}`
  const region = bracket(250)
  const tilePart = bracket(258)
  const labelLeftUnits = 266
  return {
    widthUnits: 400,
    heightUnits: 440,
    cell,
    head: position => ({ x: 35, y: columnTopUnits - 3 + position * 10, width: 210, height: 14 }),
    textureTicks: (rect, random) =>
      [0, 1, 2, 3].map(index => {
        const x1 = rect.x + 10 + index * 46 + random() * 12
        const y = rect.y + rect.height / 2
        return { x1, y1: y, x2: x1 + 8 + random() * 18, y2: y }
      }),
    brackets: {
      tile: `M 32 ${cell(0).y} H 26 V ${cell(TILE_ROWS - 1).y + 8} H 32`,
      check: tilePart(0, OUTPUT_ROWS - 1),
      overrun: tilePart(OUTPUT_ROWS, TILE_ROWS - 1),
      output: region(0, OUTPUT_ROWS - 1),
      pool: region(OUTPUT_ROWS, ROW_COUNT - 1),
      slack: region(OUTPUT_ROWS, FRESH_NEXT_ROW - 1),
      next: region(FRESH_NEXT_ROW, ROW_COUNT - 1),
    },
    labels: {
      tile: { x: 26, y: columnTopUnits - 12, anchor: "start", className: "bp-cap" },
      output: { x: labelLeftUnits, y: columnTopUnits + 16, anchor: "start" },
      check: { x: labelLeftUnits, y: columnTopUnits + 34, anchor: "start" },
      overrun: { x: labelLeftUnits, y: centerYUnits(6, 6), anchor: "start" },
      garbage: {
        x: labelLeftUnits,
        y: centerYUnits(8, 8),
        anchor: "start",
        lines: ["its owner reads", "garbage later"],
      },
      // Centered on the rows the tile's bracket leaves free, one line above and one below the center
      pool: {
        x: labelLeftUnits,
        y: centerYUnits(TILE_ROWS, ROW_COUNT - 1) - 7.5,
        anchor: "start",
        lines: ["next allocation", "in use"],
      },
      slack: { x: labelLeftUnits, y: centerYUnits(32, 33), anchor: "start" },
      next: { x: labelLeftUnits, y: centerYUnits(FRESH_NEXT_ROW, ROW_COUNT - 1), anchor: "start" },
    },
    baseline: "central",
  }
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

export default class TileOverrunFigure extends BlueprintFigure {
  #parts = null
  #timeline = new Timeline([])

  get tour() {
    return [
      { mask: "off", memory: "fresh" },
      { mask: "off", memory: "pool" },
      { mask: "on", memory: "pool" },
    ]
  }

  get #isMasked() {
    return this.state.mask === "on"
  }

  get #isPool() {
    return this.state.memory === "pool"
  }

  get #readout() {
    if (this.#isMasked) return READOUTS.masked
    return this.#isPool ? READOUTS.pool : READOUTS.fresh
  }

  build(layout) {
    this.#parts = this.#draw(layout === "wide" ? wideLayout() : narrowLayout())
    this.#timeline = this.#createTimeline()
    this.setReadout(this.#readout)
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
    this.setReadout(this.#readout)
    this.play()
  }

  #createTimeline() {
    const steps = [
      { durationMs: 0, apply: () => this.#showBeforeWrite() },
      { durationMs: WRITE_MS, apply: progress => this.#showWrite(progress) },
      { durationMs: CHECK_MS, apply: progress => this.#showCheck(progress) },
    ]
    if (!this.#isMasked && this.#isPool) {
      steps.push({ durationMs: GARBAGE_BEAT_MS, apply: () => {} })
      steps.push({ durationMs: GARBAGE_PULSE_MS, apply: progress => this.#showGarbage(progress) })
    }
    return new Timeline(steps)
  }

  #draw(spec) {
    this.setViewBox(spec.widthUnits, spec.heightUnits)
    const brackets = {}
    for (const [name, d] of Object.entries(spec.brackets)) {
      brackets[name] = svgEl("path", { class: "bp-bracket", d }, this.drawing)
    }
    const labels = {}
    for (const [name, label] of Object.entries(spec.labels)) {
      const attrs = {
        class: label.className ?? "bp-text",
        x: roundUnits(label.x),
        y: roundUnits(label.y),
        "text-anchor": label.anchor,
        "dominant-baseline": spec.baseline,
      }
      labels[name] = svgText(label.lines ?? LABELS[name], attrs, this.drawing)
    }
    const random = mulberry32(TEXTURE_SEED)
    const cells = []
    const textures = []
    for (let row = 0; row < ROW_COUNT; row += 1) {
      const rect = spec.cell(row)
      cells.push(svgEl("rect", { class: "bp-box", rx: 2, ...rect }, this.drawing))
      if (row < OUTPUT_ROWS) {
        textures.push(null)
        continue
      }
      const texture = svgEl("g", { class: "bp-texture" }, this.drawing)
      for (const tick of spec.textureTicks(rect, random)) {
        svgEl(
          "line",
          { x1: roundUnits(tick.x1), y1: roundUnits(tick.y1), x2: roundUnits(tick.x2), y2: roundUnits(tick.y2) },
          texture
        )
      }
      textures.push(texture)
    }
    const head = svgEl("rect", { class: "bp-box is-hot is-hidden", rx: 3, ...spec.head(0) }, this.drawing)
    return { spec, brackets, labels, cells, textures, head }
  }

  #paintRow(row, status) {
    const isSlack = !this.#isPool && row >= OUTPUT_ROWS && row < FRESH_NEXT_ROW
    setClass(this.#parts.cells[row], `bp-box${isSlack ? " is-dashed" : ""}${ROW_STATUS_CLASSES[status]}`)
    const texture = this.#parts.textures[row]
    if (!texture) return
    const isDamaged = status === "overwritten" || status === "pulse"
    setClass(texture, isSlack ? "bp-texture is-hidden" : `bp-texture${isDamaged ? " is-warn" : ""}`)
  }

  #statusAfterWrite(row, isWritten) {
    if (!isWritten) return "untouched"
    if (row < OUTPUT_ROWS) return "written"
    return this.#isMasked ? "untouched" : "overwritten"
  }

  #showBeforeWrite() {
    const { brackets, labels, head } = this.#parts
    for (let row = 0; row < ROW_COUNT; row += 1) this.#paintRow(row, "untouched")
    setClass(head, "bp-box is-hot is-hidden")
    setClass(brackets.tile, "bp-bracket")
    setClass(labels.tile, "bp-cap")
    setClass(brackets.check, "bp-bracket")
    setClass(labels.check, "bp-text")
    setText(labels.check, LABELS.check)
    setClass(brackets.overrun, "bp-bracket is-hidden")
    setClass(labels.overrun, "bp-text is-hidden")
    setText(labels.overrun, this.#isMasked ? LABELS.masked : LABELS.overrun)
    for (const name of ["pool", "slack", "next"]) {
      const isShown = (name === "pool") === this.#isPool
      setClass(brackets[name], isShown ? "bp-bracket" : "bp-bracket is-hidden")
      setClass(labels[name], isShown ? "bp-text" : "bp-text is-hidden")
    }
    setClass(labels.garbage, "bp-text is-warn is-hidden")
  }

  // The head sweeps the tile's 32 rows at constant speed; a row counts as written once the head reaches it.
  #showWrite(progress) {
    const { brackets, labels, head, spec } = this.#parts
    const headRow = progress * (TILE_ROWS - 1)
    const writtenRows = progress >= 1 ? TILE_ROWS : Math.round(headRow) + 1
    for (let row = 0; row < TILE_ROWS; row += 1) this.#paintRow(row, this.#statusAfterWrite(row, row < writtenRows))

    const isWriting = progress < 1
    const isPastOutput = headRow > OUTPUT_ROWS - 0.5
    const headRect = spec.head(headRow)
    head.setAttribute("x", roundUnits(headRect.x))
    head.setAttribute("y", roundUnits(headRect.y))
    const headDash = this.#isMasked && isPastOutput ? " is-dashed" : ""
    setClass(head, `bp-box is-hot${headDash}${isWriting ? "" : " is-hidden"}`)
    setClass(brackets.tile, isWriting ? "bp-bracket is-on" : "bp-bracket")
    setClass(labels.tile, isWriting ? "bp-cap is-on" : "bp-cap")

    const overrunState = !isPastOutput ? " is-hidden" : this.#isMasked ? " is-on" : " is-warn"
    setClass(brackets.overrun, `bp-bracket${overrunState}${this.#isMasked ? " is-dashed" : ""}`)
    setClass(labels.overrun, `bp-text${overrunState}`)
  }

  #showCheck(progress) {
    const { brackets, labels } = this.#parts
    const isChecking = progress > 0
    const isReading = isChecking && progress < CHECK_READ_PORTION
    for (let row = 0; row < OUTPUT_ROWS; row += 1) this.#paintRow(row, isReading ? "reading" : "written")
    setClass(brackets.check, isChecking ? "bp-bracket is-on" : "bp-bracket")
    setClass(labels.check, isChecking ? "bp-text is-on" : "bp-text")
    setText(labels.check, isChecking ? `${LABELS.check} ✓` : LABELS.check)
  }

  #showGarbage(progress) {
    const isPulsing = progress > 0 && progress < GARBAGE_PULSE_PORTION
    for (let row = OUTPUT_ROWS; row < TILE_ROWS; row += 1) this.#paintRow(row, isPulsing ? "pulse" : "overwritten")
    setClass(this.#parts.labels.garbage, progress > 0 ? "bp-text is-warn" : "bp-text is-warn is-hidden")
  }
}
