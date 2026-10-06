import { BlueprintFigure, Timeline, easeOutCubic, mulberry32, svgEl, svgText } from "../blueprint.js"

// A 16-wide toy row with one 6σ outlier, rounded to ternary with the best possible scale, once as it is and once
// after a randomized Hadamard rotation: random signs, then the fast Walsh–Hadamard transform, log2(n) stages of
// butterflies that only add and subtract (the QuIP#/QuaRot recipe). The model's real block is 1,024 wide, ten
// stages. Seed 1489 sits at the median of 1,500 such rows: rounding error 0.52 as it is, 0.35 rotated.
const LANE_COUNT = 16
const STAGE_COUNT = Math.log2(LANE_COUNT)
const OUTLIER_LANE = 5
const OUTLIER_VALUE = 6
const ROW_SEED = 1489
const SCALE_SEARCH_STEPS = 1000

const SIGNS_MS = 350
const STAGE_MS = 300
const ARRIVE_MS = 450
const ROUND_MS = 600

export function exampleRow() {
  const random = mulberry32(ROW_SEED)
  // Box–Muller: two uniform draws per normal value
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const weights = Array.from({ length: LANE_COUNT }, gaussian)
  weights[OUTLIER_LANE] = OUTLIER_VALUE
  const signs = Array.from({ length: LANE_COUNT }, () => (random() < 0.5 ? -1 : 1))
  return { weights, signs }
}

// The fast Walsh–Hadamard transform, scaled by 1/sqrt(n) so the rotation is orthogonal
export function hadamard(values) {
  const out = values.slice()
  for (let half = 1; half < out.length; half *= 2) {
    for (let start = 0; start < out.length; start += 2 * half) {
      for (let lane = start; lane < start + half; lane++) {
        const [sum, difference] = [out[lane] + out[lane + half], out[lane] - out[lane + half]]
        out[lane] = sum
        out[lane + half] = difference
      }
    }
  }
  return out.map(value => value / Math.sqrt(out.length))
}

function relativeError(values, approximation) {
  return Math.hypot(...values.map((value, lane) => value - approximation[lane])) / Math.hypot(...values)
}

// Ternary rounding with whichever scale gives the smallest error, from a grid search over (0, max |v|]
export function roundTernary(values) {
  const maxAbs = Math.max(...values.map(Math.abs))
  let best = null
  for (let step = 1; step <= SCALE_SEARCH_STEPS; step++) {
    const scale = (maxAbs * step) / SCALE_SEARCH_STEPS
    const codes = values.map(value => Math.max(-1, Math.min(1, Math.round(value / scale))))
    const error = relativeError(
      values,
      codes.map(code => code * scale)
    )
    if (best === null || error < best.error) best = { scale, codes, error }
  }
  return best
}

// A no-break space ties each separator to the phrase before it, so no wrapped line starts with a dot.
function readout(phrases) {
  return phrases.join(" · ")
}

function percent(fraction) {
  return `${Math.round(fraction * 100)}%`
}

const ROW = exampleRow()
const ROTATED = hadamard(ROW.weights.map((weight, lane) => weight * ROW.signs[lane]))
const RAW_FIT = roundTernary(ROW.weights)
const ROTATED_FIT = roundTernary(ROTATED)

const MODES = {
  off: {
    values: ROW.weights,
    fit: RAW_FIT,
    readout: readout([
      "rounded as is",
      `the best scale fits the outlier, so ${RAW_FIT.codes.filter(code => code === 0).length} of 16 weights round to 0`,
      `rounding error ${percent(RAW_FIT.error)}`,
    ]),
  },
  on: {
    values: ROTATED,
    fit: ROTATED_FIT,
    readout: readout([
      "rotated first",
      "the outlier spreads over all 16",
      `rounding error ${percent(ROTATED_FIT.error)}`,
      "the activations get the same rotation at runtime",
    ]),
  },
}

const WIDE = {
  widthUnits: 720,
  heightUnits: 300,
  laneTop: 64,
  lanePitch: 13,
  barHeight: 8,
  leftAxis: 98,
  rightAxis: 612,
  halfWidth: 72,
  networkLeft: 180,
  networkRight: 534,
  signX: 206,
  stageX: [266, 330, 394, 458],
  butterflySpan: 24,
  capY: 34,
  subLabelY: 50,
  codeLabelOffset: 16,
  noteY: 290,
  labels: {
    left: { x: 26, anchor: "start", text: "a row of weights" },
    network: { x: 357, anchor: "middle", text: "Hadamard rotation" },
    right: { x: 684, anchor: "end", text: "rounded to −1, 0, +1" },
  },
  signsLabel: "random signs",
  stagesLabel: "4 butterfly stages",
  note: "adds and subtracts only, then ÷ 4 · the model's block is 1,024 wide: 10 stages",
}

const NARROW = {
  widthUnits: 400,
  heightUnits: 306,
  laneTop: 70,
  lanePitch: 11.5,
  barHeight: 7,
  leftAxis: 62,
  rightAxis: 338,
  halfWidth: 46,
  networkLeft: 112,
  networkRight: 288,
  signX: 130,
  stageX: [164, 198, 232, 266],
  butterflySpan: 13,
  capY: 30,
  subLabelY: 50,
  codeLabelOffset: 15,
  noteY: 278,
  labels: {
    left: { x: 16, anchor: "start", text: "weights" },
    network: { x: 200, anchor: "middle", text: "rotation" },
    right: { x: 384, anchor: "end", text: "rounded" },
  },
  signsLabel: "signs",
  stagesLabel: "4 stages",
  note: ["adds and subtracts, then ÷ 4", "the model's block: 1,024 wide"],
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

export default class HadamardRotationFigure extends BlueprintFigure {
  #parts = null
  #metrics = WIDE
  #timeline = new Timeline([])

  get tour() {
    return [{ rotation: "off" }, { rotation: "on" }]
  }

  get #mode() {
    return MODES[this.state.rotation] ?? MODES.on
  }

  get #isRotated() {
    return this.state.rotation !== "off"
  }

  build(layout) {
    this.#metrics = layout === "wide" ? WIDE : NARROW
    this.#parts = this.#draw(this.#metrics)
    this.#timeline = this.#createTimeline()
  }

  update(dtMs) {
    return this.#timeline.advance(dtMs)
  }

  settle() {
    this.#timeline.seekEnd()
  }

  onChange(group) {
    if (group === "rotation") this.#replay()
  }

  onAction(action) {
    if (action === "replay") this.#replay()
  }

  #replay() {
    this.#timeline = this.#createTimeline()
    this.play()
  }

  #createTimeline() {
    const start = { durationMs: 0, apply: () => this.#showStart() }
    const round = { durationMs: ROUND_MS, apply: progress => this.#showRounding(progress) }
    if (!this.#isRotated) {
      return new Timeline([start, { durationMs: 0, apply: () => this.#showValues(1) }, round])
    }
    return new Timeline([
      start,
      { durationMs: SIGNS_MS, apply: progress => this.#showSigns(progress) },
      ...range(STAGE_COUNT).map(stage => ({
        durationMs: STAGE_MS,
        apply: progress => this.#showStage(stage, progress),
      })),
      { durationMs: ARRIVE_MS, apply: progress => this.#showValues(easeOutCubic(progress)) },
      round,
    ])
  }

  #laneY(lane) {
    return roundUnits(this.#metrics.laneTop + lane * this.#metrics.lanePitch)
  }

  #unitsPerValue() {
    return this.#metrics.halfWidth / OUTLIER_VALUE
  }

  #barAttrs(axis, value, lane) {
    const lengthUnits = value * this.#unitsPerValue()
    return {
      x: roundUnits(Math.min(axis, axis + lengthUnits)),
      y: roundUnits(this.#laneY(lane) - this.#metrics.barHeight / 2),
      width: roundUnits(Math.abs(lengthUnits)),
      height: this.#metrics.barHeight,
    }
  }

  #showStart() {
    const { signs, stages, rightBars, levels, codeLabels, ticks, errors } = this.#parts
    for (const sign of signs) setClass(sign, this.#isRotated ? "bp-num" : "bp-num is-idle")
    for (const line of stages.flat()) setClass(line, this.#isRotated ? "bp-wire" : "bp-wire is-hidden")
    rightBars.forEach((bar, lane) => {
      const isOutlier = !this.#isRotated && lane === OUTLIER_LANE
      setClass(bar, isOutlier ? "bp-box is-warn" : "bp-box is-on")
      setAttrs(bar, this.#barAttrs(this.#metrics.rightAxis, 0, lane))
    })
    for (const element of [...levels, ...codeLabels, ...ticks, ...errors]) {
      setClass(element, `${element.dataset.base} is-hidden`)
    }
    this.setReadout(this.#mode.readout)
  }

  #showSigns(progress) {
    for (const sign of this.#parts.signs) setClass(sign, progress < 1 ? "bp-num is-hot" : "bp-num")
  }

  // Each stage adds and subtracts pairs of lanes half, then one, two and four blocks apart.
  #showStage(stage, progress) {
    for (const line of this.#parts.stages[stage]) setClass(line, progress < 1 ? "bp-wire is-on" : "bp-wire")
  }

  #showValues(progress) {
    const { values } = this.#mode
    this.#parts.rightBars.forEach((bar, lane) => {
      setAttrs(bar, this.#barAttrs(this.#metrics.rightAxis, values[lane] * progress, lane))
    })
  }

  // The −1, 0, +1 levels at the fitted scale, each value's rounded position, and its error in amber.
  #showRounding(progress) {
    const { levels, codeLabels, ticks, errors } = this.#parts
    const { values, fit } = this.#mode
    const axis = this.#metrics.rightAxis
    const scaleUnits = fit.scale * this.#unitsPerValue()
    ;[-1, 1].forEach((code, index) =>
      setAttrs(levels[index], { x1: roundUnits(axis + code * scaleUnits), x2: roundUnits(axis + code * scaleUnits) })
    )
    ;[-1, 0, 1].forEach((code, index) => setAttrs(codeLabels[index], { x: roundUnits(axis + code * scaleUnits) }))
    for (const element of [...levels, ...codeLabels]) {
      setClass(element, progress > 0 ? element.dataset.base : `${element.dataset.base} is-hidden`)
    }
    values.forEach((value, lane) => {
      const roundedX = roundUnits(axis + fit.codes[lane] * scaleUnits)
      const valueX = roundUnits(axis + value * this.#unitsPerValue())
      setAttrs(ticks[lane], { x: roundedX - 1 })
      setAttrs(errors[lane], { x1: valueX, x2: roundedX })
      setClass(ticks[lane], progress >= 0.4 ? "bp-packet" : "bp-packet is-hidden")
      setClass(errors[lane], progress >= 0.6 ? "bp-wire is-warn" : "bp-wire is-warn is-hidden")
    })
  }

  // Paint order is layer order: axes and lanes, bars, the network, then the rounding marks and labels.
  #draw(metrics) {
    this.setViewBox(metrics.widthUnits, metrics.heightUnits)
    const add = (tag, className, attrs, parent = this.drawing) => svgEl(tag, { class: className, ...attrs }, parent)
    const text = (content, className, x, y, anchor = "middle") =>
      svgText(content, { class: className, x, y, "text-anchor": anchor, "dominant-baseline": "central" }, this.drawing)
    // Elements that toggle is-hidden keep their resting classes here.
    const withBase = (element, base) => {
      element.dataset.base = base
      return element
    }
    const lanes = range(LANE_COUNT)
    const topY = this.#laneY(0) - metrics.lanePitch / 2
    const bottomY = this.#laneY(LANE_COUNT - 1) + metrics.lanePitch / 2

    for (const axis of [metrics.leftAxis, metrics.rightAxis]) {
      add("line", "bp-bracket", { x1: axis, y1: topY, x2: axis, y2: bottomY })
    }
    for (const lane of lanes) {
      const y = this.#laneY(lane)
      add("line", "bp-bracket is-idle", { x1: metrics.networkLeft, y1: y, x2: metrics.networkRight, y2: y })
    }

    for (const lane of lanes) {
      const className = lane === OUTLIER_LANE ? "bp-box is-warn" : "bp-box is-on"
      add("rect", className, { ...this.#barAttrs(metrics.leftAxis, ROW.weights[lane], lane), rx: 1 })
    }
    const rightBars = lanes.map(lane =>
      add("rect", "bp-box is-on", { ...this.#barAttrs(metrics.rightAxis, 0, lane), rx: 1 })
    )

    const signs = lanes.map(lane => text(ROW.signs[lane] > 0 ? "+" : "−", "bp-num", metrics.signX, this.#laneY(lane)))
    const stages = range(STAGE_COUNT).map(stage => {
      const half = 2 ** stage
      const x = metrics.stageX[stage]
      const lines = []
      for (let start = 0; start < LANE_COUNT; start += 2 * half) {
        for (let lane = start; lane < start + half; lane++) {
          const [upperY, lowerY] = [this.#laneY(lane), this.#laneY(lane + half)]
          const left = x - metrics.butterflySpan
          const right = x + metrics.butterflySpan
          lines.push(add("line", "bp-wire", { x1: left, y1: upperY, x2: right, y2: lowerY }))
          lines.push(add("line", "bp-wire", { x1: left, y1: lowerY, x2: right, y2: upperY }))
        }
      }
      return lines
    })

    const levels = [-1, 1].map(() =>
      withBase(
        add("line", "bp-bracket is-dashed is-hidden", { x1: 0, y1: topY, x2: 0, y2: bottomY }),
        "bp-bracket is-dashed"
      )
    )
    const errors = lanes.map(lane =>
      withBase(
        add("line", "bp-wire is-warn is-hidden", { x1: 0, y1: this.#laneY(lane), x2: 0, y2: this.#laneY(lane) }),
        "bp-wire is-warn"
      )
    )
    const tickHeight = metrics.barHeight + 4
    const ticks = lanes.map(lane =>
      withBase(
        add("rect", "bp-packet is-hidden", {
          x: 0,
          y: this.#laneY(lane) - tickHeight / 2,
          width: 2,
          height: tickHeight,
        }),
        "bp-packet"
      )
    )
    const codeLabelY = this.#laneY(LANE_COUNT - 1) + metrics.codeLabelOffset
    const codeLabels = ["−1", "0", "+1"].map(code => withBase(text(code, "bp-num is-hidden", 0, codeLabelY), "bp-num"))

    for (const label of Object.values(metrics.labels)) text(label.text, "bp-cap", label.x, metrics.capY, label.anchor)
    const stagesCenter = (metrics.stageX[0] + metrics.stageX[STAGE_COUNT - 1]) / 2
    text(metrics.signsLabel, "bp-text", metrics.signX, metrics.subLabelY)
    text(metrics.stagesLabel, "bp-text", stagesCenter, metrics.subLabelY)
    text(metrics.note, "bp-text", (metrics.networkLeft + metrics.networkRight) / 2, metrics.noteY)

    return { signs, stages, rightBars, levels, codeLabels, ticks, errors }
  }
}
