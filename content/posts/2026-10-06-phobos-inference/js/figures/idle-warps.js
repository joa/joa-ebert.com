import { BlueprintFigure, Timeline, easeInOutSine, lerp, svgEl, svgText } from "../blueprint.js"

const WARP_COUNT = 8
const THREADS_PER_WARP = 32
const PHASES = ["setup", "loop", "merge", "write"]
// Schematic, not measured: warp_partial runs the loop 8× shorter but adds a merge, while setup and
// write stay as they are, so a run takes 1.7 s against 3.8 s, about 45%.
const PHASE_MS = {
  one: { setup: 400, loop: 3200, merge: 0, write: 200 },
  all: { setup: 400, loop: 400, merge: 700, write: 200 },
}
const SLICE_INSET_UNITS = 1
const SEGMENT_GAP_UNITS = 1.5
const PACKET_WIDTH_UNITS = 3
const PARTIAL_RADIUS_UNITS = 2.5
const RESULT_RADIUS_UNITS = 4
const SETUP_TICK_OFFSET_UNITS = 2

const LABELS = {
  threads: "256 threads",
  keys: "keys",
  time: "time · schematic",
  idle: "idle",
}

// The ghost tick marks where the other mode's run ends.
const GHOST_LABELS = {
  one: { text: "warp_partial", className: "bp-num" },
  all: { text: "one warp", className: "bp-text" },
}

const READOUTS = {
  one: "threads doing work: 32 of 256",
  all: "threads doing work: 256 of 256 · measured kernel time down 50–59%",
}

function runMs(mode) {
  return PHASES.reduce((sumMs, phase) => sumMs + PHASE_MS[mode][phase], 0)
}

function phaseStartMs(mode, phase) {
  return PHASES.slice(0, PHASES.indexOf(phase)).reduce((sumMs, earlier) => sumMs + PHASE_MS[mode][earlier], 0)
}

const LONGEST_RUN_MS = Math.max(runMs("one"), runMs("all"))

// Warps are rows: each row of the block continues to the right as that warp's track over the keys.
function wideLayout() {
  const blockTopUnits = 56
  const rowY = warp => blockTopUnits + warp * 11 + 4.5
  return {
    widthUnits: 720,
    heightUnits: 224,
    square: (warp, thread) => ({ x: 50 + thread * 11, y: blockTopUnits + warp * 11, width: 9, height: 9 }),
    warpLabelsY: [rowY],
    warpLabelX: 20,
    trackY: rowY,
    heads: { threads: { x: 50, y: 32 }, keys: { x: 430, y: 32 } },
    keys: { left: 430, right: 660, axisY: 42, barHeight: 5, packetHeight: 9 },
    partialX: 666,
    idleX: 665,
    result: { x: 704, y: rowY(3.5) },
    time: { left: 50, right: 704, labelY: 178, ghostLabelY: 178, top: 186, height: 10, phaseLabelY: 212 },
  }
}

// Stacked: the block on top, the eight tracks below it with their own warp labels, the time bar last.
// Rows sit 11 units apart (columns 10) so the stacked 11-unit warp labels keep some air between them.
function narrowLayout() {
  const blockRowY = warp => 34 + warp * 11
  const trackY = warp => 170 + warp * 14
  return {
    widthUnits: 400,
    heightUnits: 360,
    square: (warp, thread) => ({ x: 42 + thread * 10, y: 30 + warp * 11, width: 8, height: 8 }),
    warpLabelsY: [blockRowY, trackY],
    warpLabelX: 10,
    trackY,
    heads: { threads: { x: 42, y: 20 }, keys: { x: 42, y: 142 } },
    keys: { left: 42, right: 304, axisY: 151, barHeight: 5, packetHeight: 9 },
    partialX: 310,
    idleX: 309,
    result: { x: 358, y: trackY(3.5) },
    time: { left: 42, right: 388, labelY: 302, ghostLabelY: 320, top: 326, height: 8, phaseLabelY: 348 },
  }
}

function sliceX(keys, slice) {
  return lerp(keys.left, keys.right, slice / WARP_COUNT)
}

function timeX(time, ms) {
  return lerp(time.left, time.right, ms / LONGEST_RUN_MS)
}

// From the edge of a warp's partial result to the edge of the merged result.
function mergeEnds(spec, trackY) {
  const dx = spec.result.x - spec.partialX
  const dy = spec.result.y - trackY
  const lengthUnits = Math.hypot(dx, dy)
  const along = distanceUnits => ({
    x: spec.partialX + (dx / lengthUnits) * distanceUnits,
    y: trackY + (dy / lengthUnits) * distanceUnits,
  })
  return { from: along(PARTIAL_RADIUS_UNITS + 1.5), to: along(lengthUnits - RESULT_RADIUS_UNITS - 1.5) }
}

function drawLabel(parent, content, { className, x, y, anchor = "start", baseline = "alphabetic" }) {
  const attrs = { class: className, x: roundUnits(x), y: roundUnits(y), "text-anchor": anchor }
  return svgText(content, { ...attrs, "dominant-baseline": baseline }, parent)
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

export default class IdleWarpsFigure extends BlueprintFigure {
  #parts = null
  #timeline = new Timeline([])

  get tour() {
    return [{ loop: "one" }, { loop: "all" }]
  }

  get #mode() {
    return this.state.loop === "all" ? "all" : "one"
  }

  build(layout) {
    this.#parts = this.#draw(layout === "wide" ? wideLayout() : narrowLayout())
    this.#timeline = this.#createTimeline()
    this.setReadout(READOUTS[this.#mode])
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
    this.setReadout(READOUTS[this.#mode])
    this.play()
  }

  #isWorking(warpIndex) {
    return this.#mode === "all" || warpIndex === 0
  }

  // One warp walks every key; with warp_partial, warp w walks slice w of eight.
  #sliceFor(warpIndex) {
    const { keys } = this.#parts.spec
    if (this.#mode === "one") {
      return warpIndex === 0 ? { fromX: keys.left + SLICE_INSET_UNITS, toX: keys.right - SLICE_INSET_UNITS } : null
    }
    return {
      fromX: sliceX(keys, warpIndex) + SLICE_INSET_UNITS,
      toX: sliceX(keys, warpIndex + 1) - SLICE_INSET_UNITS,
    }
  }

  #createTimeline() {
    const phaseMs = PHASE_MS[this.#mode]
    const showPhase = {
      setup: progress => this.#showSetup(progress),
      loop: progress => this.#showLoop(progress),
      merge: progress => this.#showMerge(progress),
      write: progress => this.#showWrite(progress),
    }
    const phaseSteps = PHASES.filter(phase => phaseMs[phase] > 0).map(phase => ({
      durationMs: phaseMs[phase],
      apply: progress => {
        this.#showTimeSegment(phase, progress)
        showPhase[phase](progress)
      },
    }))
    return new Timeline([{ durationMs: 0, apply: () => this.#showBeforeRun() }, ...phaseSteps])
  }

  #draw(spec) {
    this.setViewBox(spec.widthUnits, spec.heightUnits)
    const layer = this.drawing
    const { keys, time } = spec
    drawLabel(layer, LABELS.threads, { className: "bp-cap", ...spec.heads.threads })
    drawLabel(layer, LABELS.keys, { className: "bp-cap", ...spec.heads.keys })
    drawLabel(layer, LABELS.time, { className: "bp-cap", x: time.left, y: time.labelY })

    const axisPath = `M ${keys.left} ${keys.axisY + 5} V ${keys.axisY} H ${keys.right} V ${keys.axisY + 5}`
    svgEl("path", { class: "bp-bracket", d: axisPath }, layer)
    const sliceTicks = []
    for (let slice = 1; slice < WARP_COUNT; slice += 1) {
      const x = roundUnits(sliceX(keys, slice))
      sliceTicks.push(svgEl("line", { class: "bp-bracket", x1: x, y1: keys.axisY, x2: x, y2: keys.axisY + 4 }, layer))
    }

    const warps = []
    for (let warpIndex = 0; warpIndex < WARP_COUNT; warpIndex += 1) {
      const labels = spec.warpLabelsY.map(rowY =>
        drawLabel(layer, `w${warpIndex}`, {
          className: "bp-cap",
          x: spec.warpLabelX,
          y: rowY(warpIndex),
          baseline: "central",
        })
      )
      const squares = []
      for (let thread = 0; thread < THREADS_PER_WARP; thread += 1) {
        squares.push(svgEl("rect", { class: "bp-box", rx: 2, ...spec.square(warpIndex, thread) }, layer))
      }
      warps.push({ labels, squares, ...this.#drawTrack(spec, spec.trackY(warpIndex)) })
    }
    const result = svgEl(
      "circle",
      { class: "bp-box is-hidden", cx: spec.result.x, cy: spec.result.y, r: RESULT_RADIUS_UNITS },
      layer
    )

    const segments = {}
    const phaseLabels = {}
    for (const phase of PHASES) {
      const segmentAttrs = { class: "bp-box is-on", x: time.left, y: time.top, width: 0, height: time.height, rx: 2 }
      segments[phase] = svgEl("rect", segmentAttrs, layer)
      phaseLabels[phase] = drawLabel(layer, phase, {
        className: "bp-text is-hidden",
        x: time.left,
        y: time.phaseLabelY,
        anchor: "middle",
        baseline: "central",
      })
    }
    const barMiddleY = time.top + time.height / 2
    const ghostRunAttrs = { x1: time.left, y1: barMiddleY, x2: time.left, y2: barMiddleY }
    const ghostRun = svgEl("line", { class: "bp-bracket is-dashed is-hidden", ...ghostRunAttrs }, layer)
    const ghostTickAttrs = { x1: time.left, y1: time.top - 4, x2: time.left, y2: time.top + time.height + 4 }
    const ghostTick = svgEl("line", { class: "bp-bracket is-dashed", ...ghostTickAttrs }, layer)
    const ghostLabel = drawLabel(layer, "", { className: "bp-text", x: time.left, y: time.ghostLabelY })
    return { spec, warps, sliceTicks, result, segments, phaseLabels, ghostRun, ghostTick, ghostLabel }
  }

  #drawTrack(spec, y) {
    const layer = this.drawing
    const { keys } = spec
    const merge = mergeEnds(spec, y)
    const tickX = keys.left - SETUP_TICK_OFFSET_UNITS
    const barAttrs = { x: keys.left, y: y - keys.barHeight / 2, width: 0, height: keys.barHeight, rx: 1.5 }
    const packetAttrs = {
      x: keys.left,
      y: y - keys.packetHeight / 2,
      width: PACKET_WIDTH_UNITS,
      height: keys.packetHeight,
      rx: 1,
    }
    const mergeFrom = { x1: roundUnits(merge.from.x), y1: roundUnits(merge.from.y) }
    return {
      merge,
      line: svgEl("line", { class: "bp-wire", x1: keys.left, y1: y, x2: keys.right, y2: y }, layer),
      setupTick: svgEl("line", { class: "bp-wire is-hidden", x1: tickX, y1: y - 4, x2: tickX, y2: y + 4 }, layer),
      bar: svgEl("rect", { class: "bp-box is-on", ...barAttrs }, layer),
      packet: svgEl("rect", { class: "bp-packet is-hidden", ...packetAttrs }, layer),
      mergeLine: svgEl(
        "line",
        { class: "bp-wire is-on is-hidden", ...mergeFrom, x2: mergeFrom.x1, y2: mergeFrom.y1 },
        layer
      ),
      partial: svgEl("circle", { class: "bp-box is-hidden", cx: spec.partialX, cy: y, r: PARTIAL_RADIUS_UNITS }, layer),
      idleLabel: drawLabel(layer, LABELS.idle, {
        className: "bp-text is-hidden",
        x: spec.idleX,
        y,
        baseline: "central",
      }),
    }
  }

  // Every mode-dependent look, plus empty tracks and an empty time bar.
  #showBeforeRun() {
    const { spec, warps, sliceTicks, result, ghostRun, ghostTick, ghostLabel } = this.#parts
    const mode = this.#mode
    warps.forEach((warp, warpIndex) => {
      const isWorking = this.#isWorking(warpIndex)
      for (const square of warp.squares) setClass(square, isWorking ? "bp-box is-on" : "bp-box is-idle")
      for (const label of warp.labels) setClass(label, isWorking ? "bp-cap is-on" : "bp-cap")
      setClass(warp.line, isWorking ? "bp-wire" : "bp-wire is-dashed is-idle")
      setClass(warp.setupTick, "bp-wire is-hidden")
      warp.bar.setAttribute("width", 0)
      setClass(warp.packet, "bp-packet is-hidden")
      setClass(warp.partial, "bp-box is-hidden")
      setClass(warp.idleLabel, isWorking ? "bp-text is-hidden" : "bp-text")
      setClass(warp.mergeLine, "bp-wire is-on is-hidden")
      this.#extendMergeLine(warp, 0)
    })
    for (const tick of sliceTicks) setClass(tick, mode === "all" ? "bp-bracket" : "bp-bracket is-hidden")
    setClass(result, "bp-box is-hidden")
    for (const phase of PHASES) this.#showTimeSegment(phase, 0)

    const ghostX = roundUnits(timeX(spec.time, runMs(mode === "one" ? "all" : "one")))
    // A dashed hairline carries a shorter run on to the longer one's tick; it shows once the run is written.
    ghostRun.setAttribute("x1", roundUnits(timeX(spec.time, runMs(mode)) + 2))
    ghostRun.setAttribute("x2", ghostX)
    setClass(ghostRun, "bp-bracket is-dashed is-hidden")
    ghostTick.setAttribute("x1", ghostX)
    ghostTick.setAttribute("x2", ghostX)
    ghostLabel.setAttribute("x", ghostX)
    // At the far right end the label would run out of the drawing, so it ends at the tick there.
    ghostLabel.setAttribute("text-anchor", mode === "all" ? "end" : "middle")
    setClass(ghostLabel, GHOST_LABELS[mode].className)
    setText(ghostLabel, GHOST_LABELS[mode].text)
  }

  // The time bar grows phase by phase, one segment per phase, labeled while it runs.
  #showTimeSegment(phase, progress) {
    const { spec, segments, phaseLabels } = this.#parts
    const mode = this.#mode
    const startMs = phaseStartMs(mode, phase)
    const startX = timeX(spec.time, startMs)
    const fullWidthUnits = timeX(spec.time, startMs + PHASE_MS[mode][phase]) - startX
    const segment = segments[phase]
    segment.setAttribute("x", roundUnits(startX + SEGMENT_GAP_UNITS / 2))
    segment.setAttribute("width", roundUnits(Math.max(0, fullWidthUnits - SEGMENT_GAP_UNITS) * progress))
    const label = phaseLabels[phase]
    label.setAttribute("x", roundUnits(startX + fullWidthUnits / 2))
    setClass(label, progress === 0 ? "bp-text is-hidden" : progress < 1 ? "bp-text is-on" : "bp-text")
  }

  #showSetup(progress) {
    const isRunning = progress > 0 && progress < 1
    this.#parts.warps.forEach((warp, warpIndex) => {
      const restingClass = this.#isWorking(warpIndex) ? "bp-wire" : "bp-wire is-idle"
      setClass(warp.setupTick, progress === 0 ? "bp-wire is-hidden" : isRunning ? "bp-wire is-on" : restingClass)
    })
  }

  // Every working warp walks its keys at the same constant speed; only the number of keys differs.
  #showLoop(progress) {
    const isRunning = progress > 0 && progress < 1
    this.#parts.warps.forEach((warp, warpIndex) => {
      const slice = this.#sliceFor(warpIndex)
      if (!slice) return
      const headX = lerp(slice.fromX, slice.toX, progress)
      warp.bar.setAttribute("x", roundUnits(slice.fromX))
      warp.bar.setAttribute("width", roundUnits(headX - slice.fromX))
      warp.packet.setAttribute("x", roundUnits(headX - PACKET_WIDTH_UNITS / 2))
      setClass(warp.packet, isRunning ? "bp-packet" : "bp-packet is-hidden")
      setClass(warp.partial, progress < 1 ? "bp-box is-hidden" : "bp-box is-on")
    })
  }

  #showMerge(progress) {
    const { warps, result } = this.#parts
    const reach = easeInOutSine(progress)
    for (const warp of warps) {
      this.#extendMergeLine(warp, reach)
      setClass(warp.mergeLine, progress === 0 ? "bp-wire is-on is-hidden" : "bp-wire is-on")
    }
    setClass(result, progress < 1 ? "bp-box is-hidden" : "bp-box is-on")
  }

  // With one warp, its own result is the output; with warp_partial, the merged one is.
  #showWrite(progress) {
    const { warps, result, ghostRun } = this.#parts
    const isWarpPartial = this.#mode === "all"
    setClass(isWarpPartial ? result : warps[0].partial, progress === 0 ? "bp-box is-on" : "bp-box is-hot")
    // Only the shorter warp_partial run has a longer one left to reach.
    setClass(ghostRun, isWarpPartial && progress === 1 ? "bp-bracket is-dashed" : "bp-bracket is-dashed is-hidden")
  }

  #extendMergeLine(warp, reach) {
    const { from, to } = warp.merge
    warp.mergeLine.setAttribute("x2", roundUnits(lerp(from.x, to.x, reach)))
    warp.mergeLine.setAttribute("y2", roundUnits(lerp(from.y, to.y, reach)))
  }
}
