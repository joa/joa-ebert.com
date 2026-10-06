import { BlueprintFigure, Timeline, clamp, easeInOutSine, lerp, mulberry32, svgEl, svgText } from "../blueprint.js"

// Sizes in MiB. The card, the weights and the head are the post's numbers.
const CARD_MIB = 8192
const WEIGHTS_MIB = 6420
const HEAD_MIB = 521
// Illustrative: the runtime buffers' real size is unknown. 360 MiB puts the edge just above 1,410 MiB
// of desktop, consistent with the benchmark run fitting at 1,377 MiB.
const RUNTIME_MIB = 360
// Also illustrative: how the weights split into the few dozen slabs the post mentions.
const ALLOCATION_COUNT = 40
const HEAD_INDEX = ALLOCATION_COUNT - 1
const ALLOCATION_SEED = 27
const DESKTOP_STEP_MIB = 10
const MIB_PER_GIB = 1024

const INTRO_FROM_MIB = 1000
const INTRO_TO_MIB = 1700
const INTRO_MS = 2500
const DROP_MS = 400
// One token: the head is read in system RAM, crosses PCIe and lands in its old slot.
const TOKEN_MS = 1200
const READ_MS = 200
const TRAVEL_MS = 700
const LAND_FLASH_MS = 350

const VIEW_HEIGHT_UNITS = 262
const BAR_LEFT_UNITS = 40
const BAR_HEIGHT_UNITS = 44
const VRAM_TOP_UNITS = 72
const RAM_TOP_UNITS = 210
const BOX_INSET_UNITS = 4
const PACKET_UNITS = 7
const LINK_HALF_GAP_UNITS = 3

// A label row sits 25 units above its bar and its bracket 18 to 11 units above it, as in tile-overrun.
const rowAbove = barTopUnits => ({ labelY: barTopUnits - 25, lineY: barTopUnits - 18, tickEndY: barTopUnits - 11 })
const ROW_NEAR_VRAM = rowAbove(VRAM_TOP_UNITS)
const ROW_NEAR_RAM = rowAbove(RAM_TOP_UNITS)
// Whole regions, one row higher; short ticks keep clear of the labels below them.
const ROW_REGIONS = { labelY: 21, lineY: 28, tickEndY: 33 }

const LABELS = {
  desktop: "desktop",
  weights: "weights",
  runtime: "runtime · illustrative",
  head: "output head",
  ram: "system RAM",
  link: "PCIe",
}

function wideLayout() {
  return {
    widthUnits: 720,
    unitsPerMiB: 80 / MIB_PER_GIB,
    ticksGiB: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    linkXUnits: 700,
    boxGapUnits: 1,
    hatchPitchUnits: 6,
  }
}

function narrowLayout() {
  return {
    widthUnits: 400,
    unitsPerMiB: 40 / MIB_PER_GIB,
    ticksGiB: [0, 2, 4, 6, 8],
    linkXUnits: 380,
    boxGapUnits: 0.8,
    hatchPitchUnits: 5,
  }
}

// The weights as seeded slabs of varying size, the output head last and largest.
export function weightAllocationsMiB() {
  const random = mulberry32(ALLOCATION_SEED)
  const shares = Array.from({ length: ALLOCATION_COUNT - 1 }, () => 0.35 + random() * 1.3)
  const shareSum = shares.reduce((sum, share) => sum + share, 0)
  const restMiB = WEIGHTS_MIB - HEAD_MIB
  const sizesMiB = shares.map(share => Math.round((share / shareSum) * restMiB))
  // Rounding drift goes to the largest slab, so the sizes add up to the weights exactly
  const driftMiB = restMiB - sizesMiB.reduce((sum, size) => sum + size, 0)
  sizesMiB[sizesMiB.indexOf(Math.max(...sizesMiB))] += driftMiB
  return [...sizesMiB, HEAD_MIB]
}

// Whole allocations leave VRAM, the head first, and only as many more as the overflow needs.
export function residencyFor(desktopMiB, allocationsMiB) {
  const overMiB = desktopMiB + RUNTIME_MIB + WEIGHTS_MIB - CARD_MIB
  let firstEvictedIndex = allocationsMiB.length
  let evictedMiB = 0
  while (evictedMiB < overMiB) {
    firstEvictedIndex -= 1
    evictedMiB += allocationsMiB[firstEvictedIndex]
  }
  return {
    overMiB,
    firstEvictedIndex,
    evictedCount: allocationsMiB.length - firstEvictedIndex,
    residentWeightsMiB: WEIGHTS_MIB - evictedMiB,
  }
}

// The post's measurements: the head standalone and inside the paging model
const PAGING_READOUT = "the output head now pages over PCIe every token: 96.7 ms instead of 3.26 ms"

const formatMiB = mib => `${mib.toLocaleString("en-US")} MiB`

export function readoutFor(desktopMiB, { overMiB, evictedCount }) {
  const desktop = `desktop ${formatMiB(desktopMiB)}`
  if (overMiB <= 0) return `${desktop} · fits · ${formatMiB(-overMiB)} to spare`
  const moreCount = evictedCount - 1
  const more = moreCount > 0 ? ` · plus ${moreCount} more ${moreCount === 1 ? "allocation" : "allocations"}` : ""
  return `${desktop} · over by ${formatMiB(overMiB)} · ${PAGING_READOUT}${more}`
}

function runningSums(values) {
  let sum = 0
  return values.map(value => {
    const start = sum
    sum += value
    return start
  })
}

// Constant speed: the position comes from the arc length along the whole polyline, not per segment.
function pointAlong(points, fraction) {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
  let remaining = fraction * lengths.reduce((sum, length) => sum + length, 0)
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] === 0 ? 1 : clamp(remaining / lengths[index], 0, 1)
      return { x: lerp(points[index].x, points[index + 1].x, t), y: lerp(points[index].y, points[index + 1].y, t) }
    }
    remaining -= lengths[index]
  }
  return points[0]
}

function roundUnits(value) {
  return Math.round(value * 100) / 100
}

function setClass(element, className) {
  if (element.getAttribute("class") !== className) element.setAttribute("class", className)
}

function setAttrs(element, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    const text = String(typeof value === "number" ? roundUnits(value) : value)
    if (element.getAttribute(name) !== text) element.setAttribute(name, text)
  }
}

function bracketPath(fromXUnits, toXUnits, row) {
  const left = roundUnits(fromXUnits + 1)
  const right = roundUnits(Math.max(fromXUnits + 1, toXUnits - 1))
  return `M ${left} ${row.tickEndY} V ${row.lineY} H ${right} V ${row.tickEndY}`
}

export default class VramResidencyFigure extends BlueprintFigure {
  #allocationsMiB = weightAllocationsMiB()
  #rowOffsetsMiB = runningSums(this.#allocationsMiB)
  // 0 while an allocation sits in VRAM, 1 once it has dropped into system RAM
  #dropProgress = new Array(ALLOCATION_COUNT).fill(0)
  #spec = null
  #parts = null
  #desktopInput = null
  #intro = null
  // Time into the current token while the head pages over PCIe, null while nothing travels
  #tokenMs = null

  get #residency() {
    return residencyFor(this.state.desktopMiB, this.#allocationsMiB)
  }

  build(layout) {
    this.#spec = layout === "wide" ? wideLayout() : narrowLayout()
    this.#parts = this.#draw()
    this.#render()
  }

  update(dtMs) {
    if (this.#intro && !this.#intro.advance(dtMs)) this.#endIntro()
    const { firstEvictedIndex, evictedCount } = this.#residency
    const isDropping = this.#advanceDrops(dtMs, firstEvictedIndex)
    const isPaging = this.#advanceToken(dtMs, evictedCount > 0)
    this.#render()
    return this.#intro !== null || isDropping || isPaging
  }

  settle() {
    if (this.#intro) {
      this.#intro.seekEnd()
      this.#endIntro()
    }
    const { firstEvictedIndex } = this.#residency
    this.#dropProgress = this.#dropProgress.map((progress, index) => (index >= firstEvictedIndex ? 1 : 0))
    this.#tokenMs = null
    this.#render()
  }

  onInput(param) {
    if (param !== "desktopMiB") return
    if (this.#intro) this.#endIntro()
    this.#render()
    this.play()
  }

  // Instead of a tour: unless the reader got there first, push the desktop up until the head drops out.
  onFirstVisible() {
    if (this.hasInteracted || this.reducedMotion) return
    this.#intro = new Timeline([
      { durationMs: 0, apply: () => this.#showDesktop(INTRO_FROM_MIB) },
      {
        durationMs: INTRO_MS,
        apply: progress => this.#showDesktop(lerp(INTRO_FROM_MIB, INTRO_TO_MIB, easeInOutSine(progress))),
      },
    ])
    // The intro changes the readout every few frames; announce only what the reader does
    this.#setReadoutLive(false)
    this.play()
  }

  #showDesktop(desktopMiB) {
    this.setState({ desktopMiB: Math.round(desktopMiB / DESKTOP_STEP_MIB) * DESKTOP_STEP_MIB })
  }

  #endIntro() {
    this.#intro = null
    this.#setReadoutLive(true)
  }

  #setReadoutLive(isLive) {
    this.root.querySelector(".bp-readout")?.setAttribute("aria-live", isLive ? "polite" : "off")
  }

  #advanceDrops(dtMs, firstEvictedIndex) {
    let isMoving = false
    for (let index = 0; index < ALLOCATION_COUNT; index += 1) {
      const target = index >= firstEvictedIndex ? 1 : 0
      const progress = this.#dropProgress[index]
      if (progress === target) continue
      isMoving = true
      const stepProgress = dtMs / DROP_MS
      this.#dropProgress[index] =
        target > progress ? Math.min(target, progress + stepProgress) : Math.max(target, progress - stepProgress)
    }
    return isMoving
  }

  // A token cycle starts once the head has landed in system RAM and repeats for as long as it stays there.
  #advanceToken(dtMs, isEvicted) {
    if (!isEvicted) {
      this.#tokenMs = null
      return false
    }
    if (this.#dropProgress[HEAD_INDEX] < 1) return true
    this.#tokenMs = this.#tokenMs === null ? 0 : (this.#tokenMs + dtMs) % TOKEN_MS
    return true
  }

  #xOf(mib) {
    return BAR_LEFT_UNITS + mib * this.#spec.unitsPerMiB
  }

  #draw() {
    const { widthUnits, ticksGiB, linkXUnits, hatchPitchUnits } = this.#spec
    const drawing = this.drawing
    this.setViewBox(widthUnits, VIEW_HEIGHT_UNITS)
    const edgeX = this.#xOf(CARD_MIB)
    const barBottomY = VRAM_TOP_UNITS + BAR_HEIGHT_UNITS
    const bar = topY => ({
      x: BAR_LEFT_UNITS - 3,
      y: topY,
      width: edgeX - BAR_LEFT_UNITS + 3,
      height: BAR_HEIGHT_UNITS,
    })
    svgEl("rect", { class: "bp-box", rx: 3, ...bar(VRAM_TOP_UNITS) }, drawing)
    svgEl("rect", { class: "bp-box is-idle", rx: 3, ...bar(RAM_TOP_UNITS) }, drawing)

    const desktop = svgEl("rect", { class: "bp-box", rx: 2 }, drawing)
    // The hatch covers the whole bar and is clipped to the desktop, so a drag only resizes one rect
    const clipId = `${this.root.id}-desktop-clip`
    const desktopClip = svgEl("rect", {}, svgEl("clipPath", { id: clipId }, drawing))
    const hatch = svgEl("g", { class: "bp-texture", "clip-path": `url(#${clipId})` }, drawing)
    const boxTopY = VRAM_TOP_UNITS + BOX_INSET_UNITS
    const boxHeight = BAR_HEIGHT_UNITS - 2 * BOX_INSET_UNITS
    for (let x = BAR_LEFT_UNITS - boxHeight; x < edgeX; x += hatchPitchUnits) {
      svgEl("line", { x1: x, y1: boxTopY + boxHeight, x2: x + boxHeight, y2: boxTopY }, hatch)
    }
    const runtime = svgEl("rect", { class: "bp-box is-dashed", rx: 2 }, drawing)
    const slot = svgEl("rect", { class: "bp-box is-dashed is-warn is-hidden", rx: 2 }, drawing)
    const allocations = this.#allocationsMiB.map(() => svgEl("rect", { class: "bp-box", rx: 2 }, drawing))

    for (const gib of ticksGiB) {
      const x = roundUnits(this.#xOf(gib * MIB_PER_GIB))
      svgEl("line", { class: "bp-bracket", x1: x, y1: barBottomY, x2: x, y2: barBottomY + 5 }, drawing)
      const isEdge = gib === CARD_MIB / MIB_PER_GIB
      if (isEdge) continue
      const attrs = {
        class: "bp-num",
        x,
        y: barBottomY + 18,
        "text-anchor": "middle",
        "dominant-baseline": "alphabetic",
      }
      svgText(String(gib), attrs, drawing)
    }
    const edgeLabel = svgText(
      "8 GiB",
      { x: edgeX + 4, y: barBottomY + 18, "text-anchor": "end", "dominant-baseline": "alphabetic" },
      drawing
    )
    const edge = svgEl("line", { x1: edgeX, y1: VRAM_TOP_UNITS - 6, x2: edgeX, y2: barBottomY + 6 }, drawing)

    const vramMidY = VRAM_TOP_UNITS + BAR_HEIGHT_UNITS / 2
    const ramMidY = RAM_TOP_UNITS + BAR_HEIGHT_UNITS / 2
    // PCIe as two parallel hairlines, out of the VRAM bar's right end and into system RAM's
    const barEndX = roundUnits(edgeX)
    const link = [-1, 1].map(side => {
      const offset = side * LINK_HALF_GAP_UNITS
      const d = `M ${barEndX} ${vramMidY + offset} H ${linkXUnits - offset} V ${ramMidY - offset} H ${barEndX}`
      return svgEl("path", { class: "bp-wire", d }, drawing)
    })

    const text = (content, attrs) => svgText(content, { "dominant-baseline": "alphabetic", ...attrs }, drawing)
    text(LABELS.ram, { class: "bp-cap", x: BAR_LEFT_UNITS, y: RAM_TOP_UNITS - 8, "text-anchor": "start" })
    const linkLabelY = (vramMidY + ramMidY) / 2 - 5
    text(LABELS.link, { class: "bp-text", x: linkXUnits - 9, y: linkLabelY, "text-anchor": "end" })

    const brackets = {}
    const labels = {}
    for (const [name, anchor] of [
      ["desktop", "start"],
      ["weights", "middle"],
      ["runtime", "start"],
      ["head", "end"],
    ]) {
      brackets[name] = svgEl("path", { class: "bp-bracket" }, drawing)
      labels[name] = text(LABELS[name], { class: "bp-text", "text-anchor": anchor })
    }

    const packet = svgEl(
      "rect",
      { class: "bp-packet is-hidden", rx: 2, width: PACKET_UNITS, height: PACKET_UNITS },
      drawing
    )
    return {
      desktop,
      desktopClip,
      runtime,
      allocations,
      slot,
      edge,
      edgeLabel,
      link,
      brackets,
      labels,
      packet,
      edgeX,
      vramMidY,
      ramMidY,
    }
  }

  #boxAttrs(fromXUnits, widthUnits, topY) {
    const gapUnits = this.#spec.boxGapUnits
    return {
      x: fromXUnits + gapUnits / 2,
      y: topY + BOX_INSET_UNITS,
      width: Math.max(0, widthUnits - gapUnits),
      height: BAR_HEIGHT_UNITS - 2 * BOX_INSET_UNITS,
    }
  }

  #render() {
    const desktopMiB = this.state.desktopMiB
    const residency = this.#residency
    const isOver = residency.evictedCount > 0
    const { unitsPerMiB } = this.#spec
    const parts = this.#parts
    const { edgeX } = parts

    const desktopWidth = desktopMiB * unitsPerMiB
    const desktopBox = this.#boxAttrs(BAR_LEFT_UNITS, desktopWidth, VRAM_TOP_UNITS)
    setAttrs(parts.desktop, desktopBox)
    setAttrs(parts.desktopClip, desktopBox)
    const runtimeX = this.#xOf(desktopMiB)
    const runtimeWidth = RUNTIME_MIB * unitsPerMiB
    setAttrs(parts.runtime, this.#boxAttrs(runtimeX, runtimeWidth, VRAM_TOP_UNITS))

    const weightsX = this.#xOf(desktopMiB + RUNTIME_MIB)
    // The head's old slot is whatever room is left before the edge. It keeps its last geometry while it
    // fades out, or a jump back down would flash it across the spare room.
    const residentEndX = this.#xOf(desktopMiB + RUNTIME_MIB + residency.residentWeightsMiB)
    if (isOver) setAttrs(parts.slot, this.#boxAttrs(residentEndX, edgeX - residentEndX, VRAM_TOP_UNITS))

    const headRect = this.#renderAllocations(desktopMiB, residency)

    const { brackets, labels } = parts
    setAttrs(brackets.desktop, { d: bracketPath(BAR_LEFT_UNITS, runtimeX, ROW_REGIONS) })
    setAttrs(labels.desktop, { x: BAR_LEFT_UNITS + 1, y: ROW_REGIONS.labelY })
    const weightsEndX = Math.min(this.#xOf(desktopMiB + RUNTIME_MIB + WEIGHTS_MIB), edgeX)
    setAttrs(brackets.weights, { d: bracketPath(weightsX, weightsEndX, ROW_REGIONS) })
    setAttrs(labels.weights, { x: (weightsX + weightsEndX) / 2, y: ROW_REGIONS.labelY })
    setAttrs(brackets.runtime, { d: bracketPath(runtimeX, runtimeX + runtimeWidth, ROW_NEAR_VRAM) })
    setAttrs(labels.runtime, { x: runtimeX + 1, y: ROW_NEAR_VRAM.labelY })

    // The head's label fades out where the head leaves and fades in where it lands, so it never crosses
    // the axis labels on the way. The head is always the first to go, so "over" means "the head is out".
    const headDrop = this.#dropProgress[HEAD_INDEX]
    const isHeadMoving = headDrop > 0 && headDrop < 1
    const headRow = (isHeadMoving ? !isOver : headDrop === 1) ? ROW_NEAR_RAM : ROW_NEAR_VRAM
    const headLabelState = `${isOver ? " is-warn" : " is-on"}${isHeadMoving ? " is-hidden" : ""}`
    setAttrs(brackets.head, { d: bracketPath(headRect.x, headRect.x + headRect.width, headRow) })
    setAttrs(labels.head, { x: headRect.x + headRect.width - 1, y: headRow.labelY })
    setClass(brackets.head, `bp-bracket${headLabelState}`)
    setClass(labels.head, `bp-text${headLabelState}`)

    setClass(parts.edge, isOver ? "bp-bracket is-emph is-warn" : "bp-bracket is-emph")
    setClass(parts.edgeLabel, isOver ? "bp-num is-warn" : "bp-num")
    for (const wire of parts.link) setClass(wire, isOver ? "bp-wire is-warn" : "bp-wire")
    this.#renderToken(isOver, headRect, (residentEndX + edgeX) / 2)

    this.setReadout(readoutFor(desktopMiB, residency))
    this.#desktopInput ??= this.root.querySelector("input[data-param='desktopMiB']")
    if (this.#desktopInput) setAttrs(this.#desktopInput, { "aria-valuetext": formatMiB(desktopMiB) })
  }

  // Resident allocations sit in the row after the runtime; evicted ones keep their order in system RAM,
  // right-aligned under the 8 GiB edge, so the head drops straight down at the moment it leaves.
  #renderAllocations(desktopMiB, { firstEvictedIndex }) {
    const { unitsPerMiB } = this.#spec
    let headRect = null
    for (let index = 0; index < ALLOCATION_COUNT; index += 1) {
      const widthUnits = this.#allocationsMiB[index] * unitsPerMiB
      const offsetMiB = this.#rowOffsetsMiB[index]
      const rowX = this.#xOf(desktopMiB + RUNTIME_MIB + offsetMiB)
      const ramX = this.#xOf(CARD_MIB - WEIGHTS_MIB + offsetMiB)
      // An evicted allocation leaves from inside the edge even when a jump put its row position past it
      const isEvicted = index >= firstEvictedIndex
      const vramX = isEvicted ? Math.min(rowX, ramX) : rowX
      const drop = easeInOutSine(this.#dropProgress[index])
      const x = lerp(vramX, ramX, drop)
      const topY = lerp(VRAM_TOP_UNITS, RAM_TOP_UNITS, drop)
      const element = this.#parts.allocations[index]
      setAttrs(element, this.#boxAttrs(x, widthUnits, topY))
      if (index === HEAD_INDEX) {
        headRect = { x, width: widthUnits }
        continue
      }
      setClass(element, isEvicted ? "bp-box is-warn" : "bp-box")
    }
    return headRect
  }

  // One token while the head is out: it glows in system RAM, a packet carries it over PCIe, the old slot lights up.
  #renderToken(isOver, headRect, slotCenterX) {
    const { packet, slot, allocations, edgeX, vramMidY, ramMidY } = this.#parts
    const tokenMs = this.#tokenMs
    const isReading = tokenMs !== null && tokenMs < READ_MS
    const isTraveling = tokenMs !== null && tokenMs < READ_MS + TRAVEL_MS
    const landedMs = tokenMs === null ? -1 : tokenMs - READ_MS - TRAVEL_MS
    const isLanding = landedMs >= 0 && landedMs < LAND_FLASH_MS

    const headClass = !isOver ? "bp-box is-on" : isReading ? "bp-box is-warn is-hot" : "bp-box is-warn"
    setClass(allocations[HEAD_INDEX], headClass)
    const slotClass = !isOver ? " is-hidden" : isLanding ? " is-hot" : ""
    setClass(slot, `bp-box is-dashed is-warn${slotClass}`)

    // A hidden packet stays where it is, so the 250 ms opacity fade never shows it jumping
    setClass(packet, isTraveling ? "bp-packet" : "bp-packet is-hidden")
    if (tokenMs === null) return
    const { linkXUnits } = this.#spec
    const path = [
      { x: headRect.x + headRect.width / 2, y: ramMidY },
      { x: linkXUnits, y: ramMidY },
      { x: linkXUnits, y: vramMidY },
      { x: clamp(slotCenterX, BAR_LEFT_UNITS, edgeX - PACKET_UNITS / 2 - 2), y: vramMidY },
    ]
    const point = pointAlong(path, clamp((tokenMs - READ_MS) / TRAVEL_MS, 0, 1))
    setAttrs(packet, { x: point.x - PACKET_UNITS / 2, y: point.y - PACKET_UNITS / 2 })
  }
}
