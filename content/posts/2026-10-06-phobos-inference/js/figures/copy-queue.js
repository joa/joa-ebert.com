import { BlueprintFigure, Timeline, clamp, lerp, svgEl, svgText } from "../blueprint.js"

// Schematic time runs t = 0 → 10 along the axis. The playhead crosses one unit of t in 425 ms,
// so the before path (8 units) takes about 3.4 s and the after path (4.5 units) about 1.9 s.
const AXIS_END_T = 10
const MS_PER_T = 425
const BLOCK_GAP_UNITS = 1
const TEXT_LINE_UNITS = 15 // .bp-text is 12 units and svgText puts lines 1.25em apart
const ARROW_HEAD_UNITS = 6
const ARROW_HEAD_SPREAD_RAD = 0.5
const BRIDGE_CLIP_ID = "fig-copy-queue-bridges"
const BRIDGE_HALF_WIDTH_UNITS = 4

// A no-break space before each separator dot, so a wrapped line never starts with one
const READOUTS = {
  before: "the 8 KB row waits ≈ 1 ms behind the refills · measured: 17 t/s, slower than plain copies at 30",
  after: "no DMA on the critical path · measured: decode doubled",
}

// Every time here is schematic. A block's label sits inside it unless `place` says otherwise
// ("above", "after", "below"); `short` and `narrowPlace` take over in the narrow layout.
const PATHS = {
  before: {
    endT: 8,
    blocks: [
      { lane: "gpu", fromT: 0, toT: 2, kind: "work", label: "hits" },
      { lane: "gpu", fromT: 2, toT: 7.4, kind: "waiting", label: "waiting on the CPU" },
      { lane: "gpu", fromT: 7.4, toT: 8, kind: "work", label: "add CPU result", short: "add result", place: "above" },
      { lane: "copy", fromT: 0, toT: 2.4, kind: "refill", label: "expert refill", short: "refill" },
      { lane: "copy", fromT: 2.4, toT: 4.8, kind: "refill", label: "expert refill", short: "refill" },
      {
        lane: "copy",
        fromT: 4.8,
        toT: 5,
        kind: "row",
        label: "8 KB row",
        short: "8 KB",
        place: "after",
        note: ["the row, queued", "behind the refills"],
      },
      { lane: "cpu", fromT: 0, toT: 5, kind: "idle", label: "idle" },
      { lane: "cpu", fromT: 5, toT: 7, kind: "work", label: "compute misses", short: "misses" },
    ],
    // The row goes into the copy engine's queue at 2 and only comes out to the CPU at 5
    arrows: [
      { from: ["gpu", 2], to: ["copy", 2], kind: "row", label: ["row ready"] },
      { from: ["copy", 4.9], to: ["cpu", 5], kind: "row" },
      { from: ["cpu", 7], to: ["gpu", 7.4], kind: "work" },
    ],
    wait: { fromT: 2, toT: 4.8, label: "≈ 1 ms" },
  },
  after: {
    endT: 4.5,
    ghostT: 8,
    blocks: [
      { lane: "gpu", fromT: 0, toT: 2, kind: "work", label: "hits" },
      { lane: "gpu", fromT: 2, toT: 2.1, kind: "work", label: "write row", place: "above" },
      { lane: "gpu", fromT: 2.1, toT: 3.9, kind: "spin", label: "spin on flag", short: "spin" },
      { lane: "gpu", fromT: 3.9, toT: 4.5, kind: "work", label: "add CPU result", short: "add result", place: "above" },
      { lane: "copy", fromT: 0, toT: 2.4, kind: "background" },
      { lane: "copy", fromT: 2.4, toT: 4.8, kind: "background", label: "refills, in the background", place: "after" },
      { lane: "cpu", fromT: 0, toT: 2.05, kind: "spin", label: "spinning", short: "spin" },
      { lane: "cpu", fromT: 2.05, toT: 3.8, kind: "work", label: "compute misses", short: "misses" },
      { lane: "cpu", fromT: 3.8, toT: 3.9, kind: "work", label: "flag", place: "after", narrowPlace: "below" },
    ],
    // Pinned host memory: both arrows bridge the copy engine lane instead of going through it
    arrows: [
      { from: ["gpu", 2.05], to: ["cpu", 2.05], kind: "work", label: ["pinned host", "memory"], isBridge: true },
      { from: ["cpu", 3.85], to: ["gpu", 3.9], kind: "work", isBridge: true },
    ],
  },
}

// Each block kind as it looks ahead of the playhead, under it and behind it.
const BLOCK_CLASSES = {
  work: { future: "bp-box is-idle", now: "bp-box is-hot", past: "bp-box is-on" },
  refill: { future: "bp-box is-idle", now: "bp-box is-on", past: "bp-box is-on" },
  background: { future: "bp-box is-idle", now: "bp-box is-on is-idle", past: "bp-box is-on is-idle" },
  row: { future: "bp-box is-idle", now: "bp-box is-warn is-hot", past: "bp-box is-warn is-hot" },
  waiting: {
    future: "bp-box is-dashed is-idle",
    now: "bp-box is-dashed is-warn is-hot",
    past: "bp-box is-dashed is-warn",
  },
  idle: { future: "bp-box is-dashed is-idle", now: "bp-box is-dashed", past: "bp-box is-dashed" },
  spin: { future: "bp-box is-fine is-idle", now: "bp-box is-fine", past: "bp-box is-fine" },
}

const LIT_LABEL_CLASSES = {
  work: "bp-text is-on",
  refill: "bp-text is-on",
  background: "bp-text",
  row: "bp-text is-warn",
  waiting: "bp-text is-warn",
  idle: "bp-text",
  spin: "bp-text",
}

// Lanes run left to right over the time axis, their labels in a column on the left.
function wideLayout() {
  const xAt = t => 130 + 57 * t
  return {
    widthUnits: 720,
    heightUnits: 252,
    xAt,
    lanes: {
      gpu: { top: 36, bottom: 60 },
      copy: { top: 106, bottom: 130 },
      cpu: { top: 176, bottom: 200 },
    },
    laneLabels: {
      gpu: { x: 20, y: 48, lines: ["GPU"] },
      copy: { x: 20, y: 118, lines: ["copy engine"] },
      cpu: { x: 20, y: 188, lines: ["CPU"] },
    },
    aboveYUnits: 22,
    arrowLabelYUnits: 80,
    waitLineYUnits: 90,
    axisYUnits: 224,
    axisLabelYUnits: 242,
    caption: { x: xAt(0), y: 242 },
    leaderUnits: 8,
    isNarrow: false,
  }
}

// The same lanes over a shorter axis, their labels above them, short block labels.
function narrowLayout() {
  const xAt = t => 20 + 36 * t
  return {
    widthUnits: 400,
    heightUnits: 318,
    xAt,
    lanes: {
      gpu: { top: 26, bottom: 50 },
      copy: { top: 134, bottom: 158 },
      cpu: { top: 218, bottom: 242 },
    },
    laneLabels: {
      gpu: { x: 20, y: 14, lines: ["GPU"] },
      // On one line it would run into the arrows at t = 2
      copy: { x: 20, y: 106, lines: ["copy", "engine"] },
      cpu: { x: 20, y: 204, lines: ["CPU"] },
    },
    aboveYUnits: 14,
    arrowLabelYUnits: 72,
    waitLineYUnits: 118,
    axisYUnits: 270,
    axisLabelYUnits: 288,
    caption: { x: xAt(0), y: 306 },
    leaderUnits: 0,
    isNarrow: true,
  }
}

function phaseAt(timeT, fromT, toT) {
  if (timeT === null || timeT < fromT) return "future"
  return timeT < toT ? "now" : "past"
}

function laneCenterYUnits(lane) {
  return (lane.top + lane.bottom) / 2
}

function blockLabelSpot(spec, block) {
  const lane = spec.lanes[block.lane]
  const place = (spec.isNarrow && block.narrowPlace) || block.place
  const centerXUnits = (spec.xAt(block.fromT) + spec.xAt(block.toT)) / 2
  if (place === "above") return { x: centerXUnits, y: spec.aboveYUnits, anchor: "middle" }
  if (place === "below") return { x: centerXUnits, y: lane.bottom + 12, anchor: "middle" }
  if (place === "after") {
    const leaderUnits = block.note ? spec.leaderUnits : 0
    const gapUnits = leaderUnits > 0 ? leaderUnits + 6 : 5
    return { x: spec.xAt(block.toT) + gapUnits, y: laneCenterYUnits(lane), anchor: "start" }
  }
  return { x: centerXUnits, y: laneCenterYUnits(lane), anchor: "middle" }
}

// From the edge of one lane to the facing edge of the other, so the tip stops short of the block.
function arrowLine(spec, arrow) {
  const [fromLane, fromT] = arrow.from
  const [toLane, toT] = arrow.to
  const isDown = spec.lanes[toLane].top > spec.lanes[fromLane].top
  return {
    x1: spec.xAt(fromT),
    y1: isDown ? spec.lanes[fromLane].bottom + 1 : spec.lanes[fromLane].top - 1,
    x2: spec.xAt(toT),
    y2: isDown ? spec.lanes[toLane].top - 1.5 : spec.lanes[toLane].bottom + 1.5,
  }
}

function xUnitsAtY(line, yUnits) {
  return lerp(line.x1, line.x2, (yUnits - line.y1) / (line.y2 - line.y1))
}

// An open chevron angled back along the shaft, so a slanted arrow gets a slanted head.
function arrowHeadPath(line) {
  const backRad = Math.atan2(line.y1 - line.y2, line.x1 - line.x2)
  const corner = offsetRad =>
    `${roundUnits(line.x2 + ARROW_HEAD_UNITS * Math.cos(backRad + offsetRad))} ` +
    `${roundUnits(line.y2 + ARROW_HEAD_UNITS * Math.sin(backRad + offsetRad))}`
  const tip = `${roundUnits(line.x2)} ${roundUnits(line.y2)}`
  return `M ${corner(ARROW_HEAD_SPREAD_RAD)} L ${tip} L ${corner(-ARROW_HEAD_SPREAD_RAD)}`
}

// Evenodd fill rule: the whole drawing minus a narrow window wherever a bridged arrow crosses the
// copy engine lane, which leaves a gap in the lane's line and blocks under the arrow.
function bridgeClipPath(spec, path) {
  const lane = spec.lanes.copy
  const windows = path.arrows
    .filter(arrow => arrow.isBridge)
    .map(arrow => {
      const crossingXUnits = xUnitsAtY(arrowLine(spec, arrow), laneCenterYUnits(lane))
      const leftUnits = roundUnits(crossingXUnits - BRIDGE_HALF_WIDTH_UNITS)
      return `M ${leftUnits} ${lane.top - 4} h ${2 * BRIDGE_HALF_WIDTH_UNITS} V ${lane.bottom + 4} H ${leftUnits} Z`
    })
  return [`M 0 0 H ${spec.widthUnits} V ${spec.heightUnits} H 0 Z`, ...windows].join(" ")
}

function textAttrs(className, { x, y, anchor }) {
  return {
    class: className,
    x: roundUnits(x),
    y: roundUnits(y),
    "text-anchor": anchor,
    "dominant-baseline": "central",
  }
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function setAttr(element, name, value) {
  const text = String(value)
  if (element.getAttribute(name) !== text) element.setAttribute(name, text)
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

export default class CopyQueueFigure extends BlueprintFigure {
  #parts = null
  #timeline = new Timeline([])

  get tour() {
    return [{ path: "before" }, { path: "after" }]
  }

  get #path() {
    return PATHS[this.state.path]
  }

  build(layout) {
    this.#parts = this.#draw(layout === "wide" ? wideLayout() : narrowLayout())
    this.#timeline = this.#createTimeline()
    this.setReadout(READOUTS[this.state.path])
  }

  update(dtMs) {
    return this.#timeline.advance(dtMs)
  }

  settle() {
    this.#timeline.seekEnd()
  }

  onChange(group) {
    if (group === "path") this.#replay()
  }

  onAction(action) {
    if (action === "replay") this.#replay()
  }

  #replay() {
    this.#timeline = this.#createTimeline()
    this.setReadout(READOUTS[this.state.path])
    this.play()
  }

  // One sweep at constant speed: the playhead lights each block as it passes.
  #createTimeline() {
    const { endT } = this.#path
    return new Timeline([
      { durationMs: 0, apply: () => this.#paint(null) },
      { durationMs: endT * MS_PER_T, apply: progress => this.#paint(progress * endT) },
    ])
  }

  #draw(spec) {
    this.setViewBox(spec.widthUnits, spec.heightUnits)
    for (const label of Object.values(spec.laneLabels)) {
      svgText(label.lines, textAttrs("bp-cap", { ...label, anchor: "start" }), this.drawing)
    }
    this.#drawAxis(spec)
    const scenes = {}
    for (const [name, path] of Object.entries(PATHS)) scenes[name] = this.#drawScene(spec, path)
    // The playhead: a line across the lanes and a knob riding the time axis
    const startXUnits = spec.xAt(0)
    const axisYUnits = spec.axisYUnits
    const playhead = svgEl(
      "line",
      {
        class: "bp-wire is-hot is-hidden",
        x1: startXUnits,
        y1: spec.lanes.gpu.top - 2,
        x2: startXUnits,
        y2: axisYUnits,
      },
      this.drawing
    )
    const knob = svgEl(
      "rect",
      { class: "bp-packet is-hidden", x: startXUnits - 3, y: axisYUnits - 5, width: 6, height: 10, rx: 1.5 },
      this.drawing
    )
    return { spec, scenes, playhead, knob }
  }

  #drawAxis(spec) {
    const axisYUnits = spec.axisYUnits
    const axis = { x1: spec.xAt(0), y1: axisYUnits, x2: spec.xAt(AXIS_END_T) + 8, y2: axisYUnits }
    const axisPath = `M ${axis.x1} ${axisYUnits} H ${axis.x2} ${arrowHeadPath(axis)}`
    svgEl("path", { class: "bp-bracket", d: axisPath }, this.drawing)
    for (let t = 0; t <= AXIS_END_T; t += 1) {
      const tickXUnits = spec.xAt(t)
      svgEl(
        "line",
        { class: "bp-bracket", x1: tickXUnits, y1: axisYUnits, x2: tickXUnits, y2: axisYUnits + 4 },
        this.drawing
      )
    }
    svgText("time · schematic", textAttrs("bp-cap", { ...spec.caption, anchor: "start" }), this.drawing)
  }

  #drawScene(spec, path) {
    const group = svgEl("g", {}, this.drawing)
    const hasBridges = path.arrows.some(arrow => arrow.isBridge)
    if (hasBridges) {
      const clip = svgEl("clipPath", { id: BRIDGE_CLIP_ID }, svgEl("defs", {}, group))
      svgEl("path", { "clip-rule": "evenodd", d: bridgeClipPath(spec, path) }, clip)
    }
    const laneGroups = {}
    for (const [name, lane] of Object.entries(spec.lanes)) {
      const isBridged = hasBridges && name === "copy"
      laneGroups[name] = svgEl("g", { "clip-path": isBridged ? `url(#${BRIDGE_CLIP_ID})` : null }, group)
      svgEl(
        "line",
        { class: "bp-bracket is-idle", x1: spec.xAt(0), y1: lane.bottom, x2: spec.xAt(AXIS_END_T), y2: lane.bottom },
        laneGroups[name]
      )
    }
    const arrowGroup = svgEl("g", {}, group)
    const labelGroup = svgEl("g", {}, group)
    const blocks = path.blocks.map(block => this.#drawBlock(spec, block, laneGroups[block.lane], labelGroup))
    const arrows = path.arrows.map(arrow => this.#drawArrow(spec, arrow, arrowGroup, labelGroup))
    const wait = path.wait ? this.#drawWait(spec, path.wait, group) : null
    const endXUnits = spec.xAt(path.endT)
    const endTick = this.#drawAxisMarker(spec, endXUnits, group)
    const endLabel = svgText(
      "layer done",
      textAttrs("bp-text is-idle", { x: endXUnits, y: spec.axisLabelYUnits, anchor: "middle" }),
      group
    )
    if (path.ghostT !== undefined) {
      const ghostXUnits = spec.xAt(path.ghostT)
      this.#drawAxisMarker(spec, ghostXUnits, group)
      // The tick stays faint; the word must still read on the light page
      svgText("before", textAttrs("bp-text", { x: ghostXUnits, y: spec.axisLabelYUnits, anchor: "middle" }), group)
    }
    return { group, blocks, arrows, wait, endTick, endLabel }
  }

  #drawAxisMarker(spec, xUnits, parent) {
    const axisYUnits = spec.axisYUnits
    return svgEl(
      "line",
      { class: "bp-bracket is-idle", x1: xUnits, y1: axisYUnits, x2: xUnits, y2: axisYUnits + 9 },
      parent
    )
  }

  #drawBlock(spec, block, laneGroup, labelGroup) {
    const lane = spec.lanes[block.lane]
    const widthUnits = Math.max(spec.xAt(block.toT) - spec.xAt(block.fromT) - BLOCK_GAP_UNITS, 1.5)
    const rect = svgEl(
      "rect",
      {
        class: BLOCK_CLASSES[block.kind].future,
        x: roundUnits(spec.xAt(block.fromT) + BLOCK_GAP_UNITS / 2),
        y: lane.top,
        width: roundUnits(widthUnits),
        height: lane.bottom - lane.top,
        rx: 2,
      },
      laneGroup
    )
    const text = spec.isNarrow ? (block.short ?? block.label) : block.label
    if (!text) return { block, rect, label: null }
    const spot = blockLabelSpot(spec, block)
    const label = svgText(text, textAttrs("bp-text", spot), labelGroup)
    // The row is too thin to hold a label: on wide screens a leader points it at a short note
    if (block.note && spec.leaderUnits > 0) {
      const leaderLeftUnits = spec.xAt(block.toT) + 2
      svgEl(
        "line",
        { class: "bp-bracket", x1: leaderLeftUnits, y1: spot.y, x2: leaderLeftUnits + spec.leaderUnits, y2: spot.y },
        labelGroup
      )
      svgText(block.note, textAttrs("bp-text", { ...spot, y: spot.y + TEXT_LINE_UNITS }), labelGroup)
    }
    return { block, rect, label }
  }

  #drawArrow(spec, arrow, arrowGroup, labelGroup) {
    const line = arrowLine(spec, arrow)
    const shaftPath = `M ${roundUnits(line.x1)} ${roundUnits(line.y1)} L ${roundUnits(line.x2)} ${roundUnits(line.y2)}`
    const shaft = svgEl("path", { class: "bp-wire is-idle", d: shaftPath }, arrowGroup)
    const head = svgEl("path", { class: "bp-wire is-idle", d: arrowHeadPath(line) }, arrowGroup)
    if (!arrow.label) return { arrow, shaft, head, label: null }
    const centerYUnits = spec.arrowLabelYUnits
    const spot = {
      x: xUnitsAtY(line, centerYUnits) - 6,
      y: centerYUnits - ((arrow.label.length - 1) * TEXT_LINE_UNITS) / 2,
      anchor: "end",
    }
    return { arrow, shaft, head, label: svgText(arrow.label, textAttrs("bp-text", spot), labelGroup) }
  }

  #drawWait(spec, wait, parent) {
    const fromXUnits = spec.xAt(wait.fromT) + 2.5
    const toXUnits = spec.xAt(wait.toT) - 2
    const lineYUnits = spec.waitLineYUnits
    const bracket = svgEl("path", { class: "bp-bracket is-warn is-hidden", d: `M ${fromXUnits} ${lineYUnits}` }, parent)
    const label = svgText(
      wait.label,
      textAttrs("bp-text is-warn is-hidden", { x: (fromXUnits + toXUnits) / 2, y: lineYUnits - 10, anchor: "middle" }),
      parent
    )
    return { wait, bracket, label, fromXUnits, toXUnits, lineYUnits, tickYUnits: lineYUnits + 6 }
  }

  // A pure function of the playhead's time; null is the look before the sweep starts.
  #paint(timeT) {
    const { spec, scenes, playhead, knob } = this.#parts
    for (const [name, { group }] of Object.entries(scenes)) {
      setClass(group, name === this.state.path ? "" : "is-hidden")
    }
    const scene = scenes[this.state.path]
    for (const { block, rect, label } of scene.blocks) {
      const phase = phaseAt(timeT, block.fromT, block.toT)
      setClass(rect, BLOCK_CLASSES[block.kind][phase])
      if (label) setClass(label, phase === "future" ? "bp-text" : LIT_LABEL_CLASSES[block.kind])
    }
    for (const { arrow, shaft, head, label } of scene.arrows) {
      const isLit = timeT !== null && timeT >= arrow.from[1]
      const tone = isLit ? (arrow.kind === "row" ? "is-warn" : "is-on") : "is-idle"
      setClass(shaft, `bp-wire${arrow.kind === "row" ? " is-dashed" : ""} ${tone}`)
      setClass(head, `bp-wire ${tone}`)
      if (label) setClass(label, isLit ? `bp-text ${tone}` : "bp-text")
    }
    if (scene.wait) this.#paintWait(scene.wait, timeT)
    const isDone = timeT !== null && timeT >= this.#path.endT
    setClass(scene.endTick, isDone ? "bp-bracket is-hot" : "bp-bracket is-idle")
    setClass(scene.endLabel, isDone ? "bp-text is-hot" : "bp-text is-idle")

    if (timeT === null) {
      setClass(playhead, "bp-wire is-hot is-hidden")
      setClass(knob, "bp-packet is-hidden")
      return
    }
    const playheadXUnits = roundUnits(spec.xAt(timeT))
    setAttr(playhead, "x1", playheadXUnits)
    setAttr(playhead, "x2", playheadXUnits)
    setAttr(knob, "x", roundUnits(playheadXUnits - 3))
    setClass(playhead, "bp-wire is-hot")
    setClass(knob, "bp-packet")
  }

  // The bracket grows with the playhead while the row waits and gets its label once the row is out.
  #paintWait({ wait, bracket, label, fromXUnits, toXUnits, lineYUnits, tickYUnits }, timeT) {
    const hasStarted = timeT !== null && timeT >= wait.fromT
    const isComplete = timeT !== null && timeT >= wait.toT
    const reachXUnits = isComplete ? toXUnits : clamp(this.#parts.spec.xAt(timeT ?? 0), fromXUnits, toXUnits)
    const openPath = `M ${roundUnits(fromXUnits)} ${tickYUnits} V ${lineYUnits} H ${roundUnits(reachXUnits)}`
    setAttr(bracket, "d", isComplete ? `${openPath} V ${tickYUnits}` : openPath)
    setClass(bracket, hasStarted ? "bp-bracket is-warn" : "bp-bracket is-warn is-hidden")
    setClass(label, isComplete ? "bp-text is-warn" : "bp-text is-warn is-hidden")
  }
}
