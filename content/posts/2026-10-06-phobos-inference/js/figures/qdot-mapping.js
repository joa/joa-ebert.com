import { BlueprintFigure, Timeline, svgEl, svgText } from "../blueprint.js"

// A schematic matrix-vector product: 32 outputs, each one row of 32 Q8_0 blocks (32 int8 weights and a scale).
const ROW_COUNT = 32
const BLOCK_COUNT = 32
const LANE_COUNT = 32
// Per step a warp's 32 lanes read 512 contiguous bytes: 16 blocks of 32 int8 weights.
const STRETCH_BLOCKS = 16
const STRETCH_COUNT = BLOCK_COUNT / STRETCH_BLOCKS
const SHUFFLE_LEVELS = Math.log2(LANE_COUNT)

// Each lane takes 16 bytes, half a block, so a pair of lanes shares one block's scale (phobos qdot.rs).
const SCALE_COUNT = STRETCH_BLOCKS

// Schematic, not measured: one thread per output takes 32 × 140 ms, one warp per output 2 × (300 + 200) + 5 × 150 ms.
// With the output fill that is 4.8 s against 2.1 s, about 2.3×, inside the measured 2–7×.
const BLOCK_MS = 140
// The tail of every block step, spent standing at the block boundary to apply the scale
const SCALE_STOP_PORTION = 0.4
const READ_MS = 300
// Every lane multiplies its partial sum by its block's scale at once, in a register: a beat, not a stop
const SCALE_MS = 200
const SHUFFLE_LEVEL_MS = 150
const FILL_MS = 300

const LABELS = {
  activation: "activation",
  weights: "weights · Q8_0 blocks of 32 + a scale",
  output: "output",
  scale: "scale",
  scales: "× block scale",
  lanes: "one warp · 32 lanes",
  shuffle: "shuffle",
}

const READOUTS = {
  thread: "one thread per output · a warp's 32 reads hit 32 different rows · a stop every 32 weights for the scale",
  warp: "one warp per output · 512 contiguous bytes · each lane applies its block's scale · measured 2–7× faster",
}

// Both layouts stack the same pieces: the activation strip, the weight matrix with the output column on its
// right, and the warp's lane strip with its block scales over it and the shuffle tree under it. Only the metrics
// and the labels differ.
const WIDE = {
  widthUnits: 720,
  heightUnits: 340,
  leftUnits: 40,
  blockPitchUnits: 18,
  activationTopUnits: 18,
  activationHeightUnits: 10,
  matrixTopUnits: 52,
  rowPitchUnits: 6,
  rowHeightUnits: 5,
  outputLeftUnits: 640,
  outputWidthUnits: 12,
  laneLeftUnits: 136,
  lanePitchUnits: 12,
  laneSizeUnits: 9,
  laneTopUnits: 265,
  scaleGapUnits: 3,
  scaleHeightUnits: 4,
  laneDotRadiusUnits: 1.5,
  treeLevelPitchUnits: 12,
  treeDotRadiusUnits: 2.2,
  threadDotRadiusUnits: 1.8,
  laneTickWidthUnits: 1.6,
  labels: {
    activation: { x: 40, y: 8, anchor: "start" },
    weights: { x: 40, y: 39.5, anchor: "start" },
    output: { x: 646, y: 39.5, anchor: "middle" },
    scale: { x: 0, y: 253.5, anchor: "middle" },
    scales: { x: 532, y: 257, anchor: "start" },
    lanes: { x: 532, y: 269.5, anchor: "start" },
    shuffle: { x: 532, y: 310, anchor: "start" },
  },
}

const NARROW = {
  widthUnits: 400,
  heightUnits: 370,
  leftUnits: 40,
  blockPitchUnits: 10,
  activationTopUnits: 16,
  activationHeightUnits: 8,
  matrixTopUnits: 60,
  rowPitchUnits: 5,
  rowHeightUnits: 4,
  outputLeftUnits: 368,
  outputWidthUnits: 12,
  laneLeftUnits: 40,
  lanePitchUnits: 10,
  laneSizeUnits: 8,
  laneTopUnits: 268,
  scaleGapUnits: 3,
  scaleHeightUnits: 4,
  laneDotRadiusUnits: 1.3,
  treeLevelPitchUnits: 17,
  treeDotRadiusUnits: 2,
  threadDotRadiusUnits: 1.5,
  laneTickWidthUnits: 1.2,
  labels: {
    activation: { x: 40, y: 7, anchor: "start" },
    weights: { x: 40, y: 35, anchor: "start", lines: ["weights · Q8_0 blocks", "of 32 + a scale"] },
    output: { x: 380, y: 48.75, anchor: "end" },
    scale: { x: 0, y: 230, anchor: "middle" },
    scales: { x: 360, y: 247, anchor: "end" },
    lanes: { x: 40, y: 247, anchor: "start" },
    shuffle: { x: 212, y: 361, anchor: "start" },
  },
}

function range(count) {
  return Array.from({ length: count }, (unused, index) => index)
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

function rect(x, y, width, height, rx) {
  return { x: roundUnits(x), y: roundUnits(y), width: roundUnits(width), height: roundUnits(height), rx }
}

function classNames(...names) {
  return names.filter(Boolean).join(" ")
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function setAttrs(element, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value))
  }
}

// Every element's geometry for one layout as ready attributes, so drawing and animating only pick classes.
function geometryFor(metrics) {
  const { leftUnits, blockPitchUnits, matrixTopUnits, rowPitchUnits, rowHeightUnits } = metrics
  const blockX = block => leftUnits + block * blockPitchUnits
  const rowY = row => matrixTopUnits + row * rowPitchUnits
  const rowCenterY = row => roundUnits(rowY(row) + rowHeightUnits / 2)
  const matrixBottomUnits = rowY(ROW_COUNT - 1) + rowHeightUnits
  const stretchWidthUnits = STRETCH_BLOCKS * blockPitchUnits
  const tickPitchUnits = stretchWidthUnits / LANE_COUNT
  const laneBottomUnits = metrics.laneTopUnits + metrics.laneSizeUnits
  const laneInsetUnits = (metrics.lanePitchUnits - metrics.laneSizeUnits) / 2
  const dotRadiusUnits = metrics.treeDotRadiusUnits
  // Level k of the shuffle tree holds 32 >> k partial sums, each centered over the lanes it has added up.
  const treeNode = (level, index) => ({
    x: roundUnits(metrics.laneLeftUnits + (index + 0.5) * 2 ** level * metrics.lanePitchUnits),
    y: roundUnits(laneBottomUnits + level * metrics.treeLevelPitchUnits),
  })
  // A pair of partial sums is joined by a bracket whose stem drops to their sum, one level down.
  const treeJoin = (level, index) => {
    const [left, right, sum] = [treeNode(level, 2 * index), treeNode(level, 2 * index + 1), treeNode(level + 1, index)]
    const pairBottomUnits = level === 0 ? laneBottomUnits : roundUnits(left.y + dotRadiusUnits)
    const sumTopUnits = roundUnits(sum.y - dotRadiusUnits)
    const barUnits = roundUnits((pairBottomUnits + sumTopUnits) / 2)
    return `M ${left.x} ${pairBottomUnits} V ${barUnits} H ${right.x} V ${pairBottomUnits} M ${sum.x} ${barUnits} V ${sumTopUnits}`
  }
  const threadGlideUnits = blockPitchUnits - 2 * metrics.threadDotRadiusUnits - 1
  return {
    activationBlock: block =>
      rect(blockX(block) + 0.5, metrics.activationTopUnits, blockPitchUnits - 1, metrics.activationHeightUnits, 1.5),
    row: row => rect(leftUnits, rowY(row), BLOCK_COUNT * blockPitchUnits, rowHeightUnits, 1),
    output: row => rect(metrics.outputLeftUnits, rowY(row), metrics.outputWidthUnits, rowHeightUnits, 1),
    boundary: block => ({ x1: blockX(block), y1: matrixTopUnits, x2: blockX(block), y2: matrixBottomUnits }),
    sweepLine: row => ({ x1: leftUnits, y1: rowCenterY(row), x2: leftUnits + stretchWidthUnits, y2: rowCenterY(row) }),
    laneTick: lane =>
      rect(
        leftUnits + (lane + 0.5) * tickPitchUnits - metrics.laneTickWidthUnits / 2,
        matrixTopUnits - 2,
        metrics.laneTickWidthUnits,
        rowHeightUnits + 4,
        0.5
      ),
    threadDot: row => ({
      cx: leftUnits + metrics.threadDotRadiusUnits + 0.5,
      cy: rowCenterY(row),
      r: metrics.threadDotRadiusUnits,
    }),
    lane: lane =>
      rect(
        metrics.laneLeftUnits + lane * metrics.lanePitchUnits + laneInsetUnits,
        metrics.laneTopUnits,
        metrics.laneSizeUnits,
        metrics.laneSizeUnits,
        1.5
      ),
    // One scale per pair of lanes, just above the two lanes that share its block
    scaleChip: chip =>
      rect(
        metrics.laneLeftUnits + chip * 2 * metrics.lanePitchUnits + laneInsetUnits,
        metrics.laneTopUnits - metrics.scaleGapUnits - metrics.scaleHeightUnits,
        2 * metrics.lanePitchUnits - 2 * laneInsetUnits,
        metrics.scaleHeightUnits,
        1
      ),
    // A lane's partial sum once its block's scale has been applied
    laneDot: lane => ({
      cx: roundUnits(metrics.laneLeftUnits + (lane + 0.5) * metrics.lanePitchUnits),
      cy: roundUnits(metrics.laneTopUnits + metrics.laneSizeUnits / 2),
      r: metrics.laneDotRadiusUnits,
    }),
    treeSum: (level, index) => {
      const node = treeNode(level, index)
      return { cx: node.x, cy: node.y, r: dotRadiusUnits }
    },
    // One path per level of the shuffle
    treeJoins: level =>
      range(LANE_COUNT >> (level + 1))
        .map(index => treeJoin(level, index))
        .join(" "),
    // Bands sit one unit outside the block boundaries they cover.
    activationBand: (fromBlock, blockCount) =>
      rect(
        blockX(fromBlock) - 1,
        metrics.activationTopUnits - 2,
        blockCount * blockPitchUnits + 2,
        metrics.activationHeightUnits + 4,
        2
      ),
    columnBand: block =>
      rect(blockX(block) - 1, matrixTopUnits - 2.5, blockPitchUnits + 2, matrixBottomUnits - matrixTopUnits + 5, 2),
    rowBand: stretch =>
      rect(blockX(stretch * STRETCH_BLOCKS) - 1, matrixTopUnits - 2.5, stretchWidthUnits + 2, rowHeightUnits + 5, 2),
    stretchShift: stretch => `translate(${roundUnits(stretch * stretchWidthUnits)} 0)`,
    // Threads glide from a block's left edge to its right edge, where they stop for the scale.
    threadShift: (block, glide) => `translate(${roundUnits(block * blockPitchUnits + glide * threadGlideUnits)} 0)`,
    scaleLabelX: block => roundUnits(blockX(block) + blockPitchUnits / 2),
  }
}

export default class QdotMappingFigure extends BlueprintFigure {
  #parts = null
  #timeline = new Timeline([])

  get tour() {
    return [{ mapping: "thread" }, { mapping: "warp" }]
  }

  get #isWarp() {
    return this.state.mapping === "warp"
  }

  build(layout) {
    this.#parts = this.#draw(layout === "wide" ? WIDE : NARROW)
    this.#timeline = this.#createTimeline()
    this.setReadout(READOUTS[this.state.mapping])
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
    this.setReadout(READOUTS[this.state.mapping])
    this.play()
  }

  #createTimeline() {
    const start = { durationMs: 0, apply: () => this.#showStart() }
    const fill = { durationMs: FILL_MS, apply: progress => this.#showOutputs(progress) }
    if (!this.#isWarp) {
      return new Timeline([
        start,
        { durationMs: BLOCK_COUNT * BLOCK_MS, apply: progress => this.#showThreadSweep(progress) },
        fill,
      ])
    }
    return new Timeline([
      start,
      ...range(STRETCH_COUNT).flatMap(stretch => [
        { durationMs: READ_MS, apply: () => this.#showStretch(stretch) },
        { durationMs: SCALE_MS, apply: progress => this.#showScales(progress) },
      ]),
      ...range(SHUFFLE_LEVELS).map(level => ({
        durationMs: SHUFFLE_LEVEL_MS,
        apply: progress => this.#showShuffleLevel(level, progress),
      })),
      fill,
    ])
  }

  // Paint order is layer order: the matrix, then what reads it, then the outputs, lanes and tree, then labels.
  #draw(metrics) {
    this.setViewBox(metrics.widthUnits, metrics.heightUnits)
    const geometry = geometryFor(metrics)
    const add = (tag, className, attrs, parent = this.drawing) => svgEl(tag, { class: className, ...attrs }, parent)

    for (const block of range(BLOCK_COUNT)) add("rect", "bp-box", geometry.activationBlock(block))
    const activationBand = add("rect", "bp-box is-on is-hidden", geometry.activationBand(0, 1))
    const rows = range(ROW_COUNT).map(row => add("rect", "bp-box is-hairline", geometry.row(row)))
    const boundaries = add("g", "bp-texture is-hairline", {})
    for (const block of range(BLOCK_COUNT).slice(1)) add("line", null, geometry.boundary(block), boundaries)

    // The other warps reading the other rows, drawn for the first stretch and shifted along
    const sweep = add("g", "bp-texture is-hairline is-on is-hidden", {})
    for (const row of range(ROW_COUNT).slice(1)) add("line", null, geometry.sweepLine(row), sweep)
    const rowBand = add("rect", "bp-box is-on is-hidden", geometry.rowBand(0))
    const laneTicks = add("g", "is-hidden", {})
    for (const lane of range(LANE_COUNT)) add("rect", "bp-packet", geometry.laneTick(lane), laneTicks)

    const columnBand = add("rect", "bp-box is-on is-instant is-hidden", geometry.columnBand(0))
    const threadDots = add("g", "is-hidden", {})
    for (const row of range(ROW_COUNT)) add("circle", "bp-packet", geometry.threadDot(row), threadDots)

    const outputs = range(ROW_COUNT).map(row => add("rect", "bp-box is-hairline", geometry.output(row)))
    const lanes = range(LANE_COUNT).map(lane => add("rect", "bp-box", geometry.lane(lane)))
    const scaleChips = range(SCALE_COUNT).map(chip => add("rect", "bp-box is-hidden", geometry.scaleChip(chip)))
    const laneDots = add("g", "is-hidden", {})
    for (const lane of range(LANE_COUNT)) add("circle", "bp-packet", geometry.laneDot(lane), laneDots)
    const treeJoins = range(SHUFFLE_LEVELS).map(level =>
      add("path", "bp-bracket is-hidden", { d: geometry.treeJoins(level) })
    )
    // treeSums[level] holds the partial sums that shuffle level produces: 16, 8, 4, 2, then the total
    const treeSums = range(SHUFFLE_LEVELS).map(level =>
      range(LANE_COUNT >> (level + 1)).map(index =>
        add("circle", "bp-box is-hidden", geometry.treeSum(level + 1, index))
      )
    )

    const labels = {}
    for (const [name, label] of Object.entries(metrics.labels)) {
      const attrs = { x: label.x, y: label.y, "text-anchor": label.anchor, "dominant-baseline": "central" }
      attrs.class = name === "scale" ? "bp-text is-warn is-instant is-hidden" : "bp-cap"
      labels[name] = svgText(label.lines ?? LABELS[name], attrs, this.drawing)
    }

    return {
      geometry,
      activationBand,
      rows,
      sweep,
      rowBand,
      laneTicks,
      columnBand,
      threadDots,
      outputs,
      lanes,
      scaleChips,
      laneDots,
      treeJoins,
      treeSums,
      labels,
    }
  }

  #showStart() {
    const parts = this.#parts
    // The warp's own row keeps the full outline so it stands out from the hairline matrix.
    parts.rows.forEach((row, index) => {
      setClass(row, this.#isWarp && index === 0 ? "bp-box is-on" : "bp-box is-hairline")
    })
    for (const output of parts.outputs) setClass(output, "bp-box is-hairline")
    for (const lane of parts.lanes) setClass(lane, "bp-box")
    // The block scales only exist as a strip in warp mode; one thread per output meets them as stops in the row.
    for (const chip of parts.scaleChips) setClass(chip, this.#isWarp ? "bp-box" : "bp-box is-hidden")
    setClass(parts.laneDots, "is-hidden")
    setClass(parts.labels.scales, this.#isWarp ? "bp-cap" : "bp-cap is-hidden")
    setClass(parts.activationBand, "bp-box is-on is-hidden")
    setClass(parts.columnBand, "bp-box is-on is-instant is-hidden")
    setClass(parts.threadDots, "is-hidden")
    setClass(parts.labels.scale, "bp-text is-warn is-instant is-hidden")
    this.#hideStretch()
    setClass(parts.labels.shuffle, "bp-cap is-hidden")
    for (const join of parts.treeJoins) setClass(join, "bp-bracket is-hidden")
    for (const sum of parts.treeSums.flat()) setClass(sum, "bp-box is-hidden")
  }

  // Each thread glides through its row's current block, then stands at the block boundary while the
  // scale is applied, and the band flashes amber for that stop.
  #showThreadSweep(progress) {
    const { geometry, activationBand, columnBand, threadDots, labels, lanes } = this.#parts
    const blockProgress = progress * BLOCK_COUNT
    const block = Math.min(Math.floor(blockProgress), BLOCK_COUNT - 1)
    const readPortion = 1 - SCALE_STOP_PORTION
    const blockFraction = blockProgress - block
    const isScaling = blockFraction >= readPortion

    setAttrs(columnBand, geometry.columnBand(block))
    setClass(columnBand, isScaling ? "bp-box is-warn is-hot is-instant" : "bp-box is-on is-instant")
    setAttrs(activationBand, geometry.activationBand(block, 1))
    setClass(activationBand, "bp-box is-on")
    setAttrs(threadDots, { transform: geometry.threadShift(block, Math.min(1, blockFraction / readPortion)) })
    setClass(threadDots, "")
    setAttrs(labels.scale, { x: geometry.scaleLabelX(block) })
    setClass(labels.scale, classNames("bp-text is-warn is-instant", !isScaling && "is-hidden"))
    for (const lane of lanes) setClass(lane, "bp-box is-on")
  }

  // The warp reads one contiguous 512-byte stretch of row 0 in a single step, while the other warps
  // do the same on the other rows.
  #showStretch(stretch) {
    const { geometry, activationBand, rowBand, laneTicks, sweep, lanes, scaleChips, laneDots } = this.#parts
    setAttrs(rowBand, geometry.rowBand(stretch))
    setAttrs(activationBand, geometry.activationBand(stretch * STRETCH_BLOCKS, STRETCH_BLOCKS))
    setAttrs(laneTicks, { transform: geometry.stretchShift(stretch) })
    setAttrs(sweep, { transform: geometry.stretchShift(stretch) })
    setClass(rowBand, "bp-box is-on")
    setClass(activationBand, "bp-box is-on")
    setClass(laneTicks, "")
    setClass(sweep, "bp-texture is-hairline is-on")
    for (const lane of lanes) setClass(lane, "bp-box is-on")
    // A new stretch brings the next 16 blocks and their 16 scales; the lanes keep the sums they already hold.
    for (const chip of scaleChips) setClass(chip, "bp-box")
    setClass(laneDots, stretch > 0 ? "" : "is-hidden")
  }

  // Every lane multiplies its partial sum by the scale its pair of lanes shares, all 32 at once, in a register.
  #showScales(progress) {
    const { scaleChips, laneDots } = this.#parts
    for (const chip of scaleChips) setClass(chip, progress < 0.5 ? "bp-box is-hot" : "bp-box is-on")
    setClass(laneDots, "")
  }

  #hideStretch() {
    const { activationBand, rowBand, laneTicks, sweep } = this.#parts
    setClass(activationBand, "bp-box is-on is-hidden")
    setClass(rowBand, "bp-box is-on is-hidden")
    setClass(laneTicks, "is-hidden")
    setClass(sweep, "bp-texture is-hairline is-on is-hidden")
  }

  // Every level of the shuffle halves the partial sums: 32 lanes, then 16, 8, 4, 2 and the total.
  #showShuffleLevel(level, progress) {
    const { treeJoins, treeSums, labels } = this.#parts
    if (level === 0) {
      this.#hideStretch()
      setClass(labels.shuffle, "bp-cap")
    }
    setClass(treeJoins[level], "bp-bracket is-on")
    const isTotal = level === SHUFFLE_LEVELS - 1
    for (const sum of treeSums[level]) {
      setClass(sum, classNames("bp-box", isTotal ? "is-hot" : "is-on", progress < 0.5 && "is-hidden"))
    }
  }

  // One thread per output: every thread finishes its row at once, and its band settles on the last block.
  // One warp per output: this warp's output and, at the same moment, the other warps' outputs.
  #showOutputs(progress) {
    const { activationBand, columnBand, labels, outputs } = this.#parts
    if (!this.#isWarp) {
      setClass(columnBand, "bp-box is-on")
      setClass(activationBand, "bp-box is-on")
      setClass(labels.scale, "bp-text is-warn is-instant is-hidden")
    }
    outputs.forEach((output, row) => {
      const fill = this.#isWarp && row === 0 ? "is-hot" : "is-on"
      setClass(output, classNames("bp-box is-hairline", progress > 0 && fill))
    })
  }
}
