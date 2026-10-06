// Shared foundation of the blueprint figures. Nothing here touches the DOM at module level,
// so a figure module can be imported from Node to exercise its pure logic.

const SVG_NS = "http://www.w3.org/2000/svg"
const NARROW_BELOW_PX = 600
const VISIBLE_RATIO = 0.3
const MAX_FRAME_DELTA_MS = 50
const TOUR_HOLD_MS = 1400

export function svgEl(tag, attrs = {}, parent = null) {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value))
  }
  parent?.append(element)
  return element
}

// A string becomes the text's content; an array of strings becomes one <tspan> per line.
export function svgText(content, attrs = {}, parent = null) {
  const text = svgEl("text", attrs, parent)
  if (!Array.isArray(content)) {
    text.textContent = content
    return text
  }
  content.forEach((line, index) => {
    const tspan = svgEl("tspan", { x: attrs.x ?? 0, dy: index === 0 ? 0 : "1.25em" }, text)
    tspan.textContent = line
  })
  return text
}

// Mulberry32 (Tommy Ettinger): a tiny 32-bit PRNG, so a seeded figure draws the same on every load.
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function lerp(from, to, t) {
  return from + (to - from) * t
}

export function easeInOutSine(t) {
  return (1 - Math.cos(Math.PI * t)) / 2
}

export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

// Steps run back to back. apply(progress) must be a pure function of progress that sets everything
// the step owns, so apply(1) is the step's end state and seekEnd() can replay all of them.
export class Timeline {
  #steps
  #holdMs
  #stepIndex = 0
  #stepElapsedMs = 0
  #heldMs = 0

  constructor(steps, { holdMs = 0 } = {}) {
    this.#steps = steps
    this.#holdMs = holdMs
  }

  get totalMs() {
    return this.#steps.reduce((sumMs, step) => sumMs + Math.max(0, step.durationMs), this.#holdMs)
  }

  get isFinished() {
    return this.#stepIndex >= this.#steps.length && this.#heldMs >= this.#holdMs
  }

  reset() {
    this.#stepIndex = 0
    this.#stepElapsedMs = 0
    this.#heldMs = 0
  }

  advance(dtMs) {
    let remainingMs = Math.max(0, dtMs)
    while (this.#stepIndex < this.#steps.length) {
      const step = this.#steps[this.#stepIndex]
      const leftInStepMs = step.durationMs - this.#stepElapsedMs
      if (remainingMs < leftInStepMs) {
        this.#stepElapsedMs += remainingMs
        step.apply(this.#stepElapsedMs / step.durationMs)
        return true
      }
      remainingMs -= Math.max(0, leftInStepMs)
      step.apply(1)
      this.#stepIndex += 1
      this.#stepElapsedMs = 0
    }
    this.#heldMs = Math.min(this.#holdMs, this.#heldMs + remainingMs)
    return this.#heldMs < this.#holdMs
  }

  seekEnd() {
    for (const step of this.#steps) step.apply(1)
    this.#stepIndex = this.#steps.length
    this.#stepElapsedMs = 0
    this.#heldMs = this.#holdMs
  }
}

// Lifecycle: start() reads the state from the markup, builds the current layout and settles it.
// The frame loop runs only while the figure wants to play and at least 30% of it is on screen in a
// visible tab. Subclasses override build, update, settle, the on* hooks and optionally get tour().
export class BlueprintFigure {
  #root
  #svg
  #readout
  #drawing = null
  #layout = null
  #state = Object.freeze({})
  #reducedMotionQuery = null
  #isInView = false
  #isTabVisible = true
  #hasBeenVisible = false
  #hasInteracted = false
  #isPlaying = false
  #isInFrame = false
  #frameId = 0
  #lastFrameMs = null
  #rebuildFrameId = 0
  #activeTour = null

  constructor(root) {
    this.#root = root
    this.#svg = root.querySelector(".bp-svg")
    this.#readout = root.querySelector(".bp-readout")
    if (!this.#svg) throw new Error(`#${root.id} has no .bp-svg`)
  }

  get root() {
    return this.#root
  }

  get svg() {
    return this.#svg
  }

  get drawing() {
    return this.#drawing
  }

  get layout() {
    return this.#layout
  }

  get state() {
    return this.#state
  }

  get reducedMotion() {
    return this.#reducedMotionQuery?.matches ?? false
  }

  get isVisible() {
    return this.#isInView && this.#isTabVisible
  }

  get hasInteracted() {
    return this.#hasInteracted
  }

  get tour() {
    return []
  }

  start() {
    this.#state = Object.freeze(this.#readMarkupState())
    this.#syncControls(this.#state)
    this.#reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)")
    this.#reducedMotionQuery.addEventListener("change", () => this.#onReducedMotionChange())
    this.#isTabVisible = document.visibilityState === "visible"
    document.addEventListener("visibilitychange", () => this.#onTabVisibilityChange())
    this.#root.addEventListener("click", event => this.#onClick(event))
    this.#root.addEventListener("input", event => this.#onInputEvent(event))
    this.#rebuild(this.#layoutFor(this.#root.getBoundingClientRect().width))
    new ResizeObserver(entries => this.#onResize(entries)).observe(this.#root)
    new IntersectionObserver(entries => this.#onIntersection(entries), {
      threshold: [0, VISIBLE_RATIO],
    }).observe(this.#root)
  }

  build(layout) {}

  update(dtMs) {
    return false
  }

  settle() {}

  onChange(group, value) {}

  onAction(action) {}

  onInput(param, value) {}

  onFirstVisible() {
    this.#startTour()
  }

  play() {
    if (this.reducedMotion) {
      this.settle()
      return
    }
    this.#isPlaying = true
    this.#startLoop()
  }

  pause() {
    this.#isPlaying = false
    this.#stopLoop()
  }

  setReadout(text) {
    if (this.#readout && this.#readout.textContent !== text) this.#readout.textContent = text
  }

  setViewBox(widthUnits, heightUnits) {
    this.#svg.setAttribute("viewBox", `0 0 ${widthUnits} ${heightUnits}`)
  }

  // Programmatic state change: updates state and the controls, calls no hook.
  setState(patch) {
    this.#state = Object.freeze({ ...this.#state, ...patch })
    this.#syncControls(patch)
  }

  #readMarkupState() {
    const state = {}
    for (const button of this.#root.querySelectorAll("[data-group][data-value]")) {
      const { group, value } = button.dataset
      if (!Object.hasOwn(state, group) || button.getAttribute("aria-pressed") === "true") state[group] = value
    }
    for (const input of this.#root.querySelectorAll("input[data-param]")) {
      state[input.dataset.param] = Number(input.value)
    }
    return state
  }

  #syncControls(patch) {
    for (const button of this.#root.querySelectorAll("[data-group][data-value]")) {
      const { group, value } = button.dataset
      if (Object.hasOwn(patch, group)) button.setAttribute("aria-pressed", String(value === patch[group]))
    }
    for (const input of this.#root.querySelectorAll("input[data-param]")) {
      const { param } = input.dataset
      if (Object.hasOwn(patch, param) && Number(input.value) !== patch[param]) input.value = String(patch[param])
    }
  }

  // Tour patches and clicks go through here, so a patch fires its hooks even when a value is unchanged.
  #applyPatch(patch) {
    this.setState(patch)
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === "number") this.onInput(key, value)
      else this.onChange(key, value)
    }
  }

  #onClick(event) {
    const control = event.target.closest("[data-group][data-value], [data-action]")
    if (!control || !this.#root.contains(control) || control.disabled) return
    this.#noteReaderInput()
    if (control.dataset.action) this.onAction(control.dataset.action)
    else this.#applyPatch({ [control.dataset.group]: control.dataset.value })
  }

  #onInputEvent(event) {
    const input = event.target
    if (!input.matches("input[data-param]")) return
    this.#noteReaderInput()
    const value = Number(input.value)
    this.#state = Object.freeze({ ...this.#state, [input.dataset.param]: value })
    this.onInput(input.dataset.param, value)
  }

  #noteReaderInput() {
    this.#hasInteracted = true
    this.#activeTour = null
  }

  #layoutFor(widthPx) {
    return widthPx < NARROW_BELOW_PX ? "narrow" : "wide"
  }

  #onResize(entries) {
    const widthPx = entries[entries.length - 1].contentRect.width
    if (widthPx === 0) return
    const layout = this.#layoutFor(widthPx)
    cancelAnimationFrame(this.#rebuildFrameId)
    this.#rebuildFrameId = 0
    if (layout === this.#layout) return
    // Rebuilding resizes the root; doing it inside this callback would trip the browser's
    // "ResizeObserver loop completed with undelivered notifications" error, so wait a frame.
    this.#rebuildFrameId = requestAnimationFrame(() => {
      this.#rebuildFrameId = 0
      this.#rebuild(layout)
    })
  }

  #rebuild(layout) {
    this.#layout = layout
    this.#root.dataset.layout = layout
    this.#drawing?.remove()
    this.#drawing = svgEl("g", { class: "bp-drawing" }, this.#svg)
    this.build(layout)
    this.settle()
  }

  #onIntersection(entries) {
    const entry = entries[entries.length - 1]
    // The ratio reported at the threshold crossing can round to just below it.
    this.#isInView = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO - 0.001
    this.#onVisibilityChange()
  }

  #onTabVisibilityChange() {
    this.#isTabVisible = document.visibilityState === "visible"
    this.#onVisibilityChange()
  }

  #onVisibilityChange() {
    if (!this.isVisible) {
      this.#stopLoop()
      return
    }
    if (!this.#hasBeenVisible) {
      this.#hasBeenVisible = true
      this.onFirstVisible()
    }
    this.#startLoop()
  }

  #onReducedMotionChange() {
    if (!this.reducedMotion) return
    this.#activeTour = null
    this.pause()
    this.settle()
  }

  #startLoop() {
    if (this.#frameId !== 0 || this.#isInFrame || !this.#isPlaying || !this.isVisible) return
    this.#lastFrameMs = null
    this.#frameId = requestAnimationFrame(nowMs => this.#onFrame(nowMs))
  }

  #stopLoop() {
    cancelAnimationFrame(this.#frameId)
    this.#frameId = 0
  }

  #onFrame(nowMs) {
    this.#frameId = 0
    const dtMs = this.#lastFrameMs === null ? 0 : clamp(nowMs - this.#lastFrameMs, 0, MAX_FRAME_DELTA_MS)
    this.#lastFrameMs = nowMs
    // Re-armed below by update() or the tour, or by a play() call made during this frame.
    this.#isPlaying = false
    this.#isInFrame = true
    try {
      if (this.update(dtMs) || (this.#activeTour !== null && this.#advanceTour(dtMs))) this.#isPlaying = true
    } finally {
      this.#isInFrame = false
    }
    if (this.#isPlaying && this.isVisible) this.#frameId = requestAnimationFrame(next => this.#onFrame(next))
  }

  #startTour() {
    const patches = this.tour
    if (patches.length === 0 || this.reducedMotion || this.#hasInteracted) return
    this.#activeTour = { patches, index: 0, heldMs: 0 }
    this.#applyPatch(patches[0])
    this.#isPlaying = true
    this.#startLoop()
  }

  // Runs once the current patch's animation has finished: hold, then apply the next patch.
  #advanceTour(dtMs) {
    const tour = this.#activeTour
    if (tour.index === tour.patches.length - 1) {
      this.#activeTour = null
      return false
    }
    tour.heldMs += dtMs
    if (tour.heldMs < TOUR_HOLD_MS) return true
    tour.index += 1
    tour.heldMs = 0
    this.#applyPatch(tour.patches[tour.index])
    return true
  }
}
