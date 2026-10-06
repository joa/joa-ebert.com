# Explainer figures for "Filling in the blanks: Inference using Phobos"

Prompts for another model to build nine interactive blueprint figures (JS + SVG) for
`content/posts/draft-phobos-inference/index.md`, in the style of the learning-to-type post.

**How to run.** Hand the executing model one prompt at a time, in order:
"Execute Prompt N from `content/posts/draft-phobos-inference/figure-prompts.md`."
Prompt 1 builds the shared foundation plus the first figure; look at its result before running the rest.
Prompts 2–9 don't depend on each other, but they all insert into `index.md`, so run them one after another.
Prompts 8 and 9 were added later: 8 sits between Prompts 1 and 2 in the post, 9 between Prompts 4 and 5.

| Prompt | Figure id         | Section                            | The one idea                                                |
| ------ | ----------------- | ---------------------------------- | ----------------------------------------------------------- |
| 1      | `tile-overrun`    | Bugs only the whole model can see  | a 32-row tile writes 27 rows past a five-row output         |
| 2      | `qdot-mapping`    | Making decode fast                 | one thread per output row vs one warp per output row        |
| 3      | `idle-warps`      | Then I stopped optimizing by hand  | 32 of 256 threads doing the work, then all eight warps      |
| 4      | `vram-residency`  | The kernel was never slow          | the desktop pushes an allocation out over PCIe              |
| 5      | `expert-cache`    | A model that doesn't fit at all    | 256 experts, eight per token, a cache on the card           |
| 6      | `copy-queue`      | A model that doesn't fit at all    | an 8 KB readback stuck behind the expert refills            |
| 7      | `exact-size-pool` | Real work, not benchmarks          | an exact-size pool: benchmarks reuse, agents strand buffers |
| 8      | `bandwidth-bound` | Making decode fast                 | decode waits on memory: ~2 ops per byte, the card needs ~25 |
| 9      | `hadamard-rotation` | PrismML Ternary-Bonsai-2-27B     | rotate before rounding: the outlier stops wiping out the rest |

The arrow chain near the top of the post (`GGUF file ⟶ Tokenizer ⟶ …`) stays text on purpose.

---

## Shared brief

This section is binding for every prompt. Read all of it before you touch anything.

### 1. Context and permissions

- Repo: `C:\Users\joaeb\code\joa-ebert.com`, a Hugo + Vite site. The post is the page bundle
  `content/posts/draft-phobos-inference/` (`index.md` plus resources). It's a casual, technical post about running LLMs
  on Phobos, a small GPU kernel language, on a seven-year-old RTX 2080 SUPER, compared against llama.cpp.
- Visual reference: the published post `content/posts/2026-04-30-learning-to-type/` (look at `typist.md`,
  `css/style.css`, `js/main.js`) and its live page https://www.joa-ebert.com/posts/2026-04-30-learning-to-type/ in both
  color themes. Match that look: thin brand-colored hairlines drawn straight on the page background, faint fills, a
  soft glow on whatever is active, small uppercase letter-spaced labels. No panel or card background, no grid, no
  gradients, no icons, no emoji.
- You are explicitly authorized to (a) create files inside the post bundle and (b) edit `index.md` directly, but only
  to insert figure blocks and the front-matter keys named in these prompts. This overrides the diff-only rule in
  `content/CLAUDE.md` for this task. Do not change any prose, number, heading, footnote, table, or the existing
  `images/inference.svg` figure. Don't touch other posts, and don't touch files outside the bundle except your own
  scratchpad.
- **Back up first.** Drafts are gitignored (`content/posts/draft-*`), so git cannot restore `index.md`. Before your first
  edit, copy `index.md` into your scratchpad and put that path in your report. Don't run git commands that change state
  and don't commit.
- Leave the stray files already in the bundle (`*.diff`, `index*.md` copies, this file) alone.
- All visible text is American English. Don't add exclamation marks, emoji or marketing words.

### 2. How figures get onto the page (Hugo mechanics)

- The front matter lists bundle assets: `styles:` (loaded as stylesheets) and `scripts:` (loaded as
  `<script type="module">`). Both are resolved from the bundle by the theme (`layouts/partials/head.html`,
  `layouts/_default/baseof.html`). Prompt 1 adds `css/blueprint.css` and `js/main.js`.
- A figure block in `index.md` looks exactly like this, with one blank line before it, one blank line after it, and
  **no blank line inside it**:

  ```html
  <figure class="bp-figure">
  {{% include "fig-<id>.md" %}}
    <figcaption><p>Caption text, with <code>inline code</code> written as HTML.</p></figcaption>
  </figure>
  ```

  The `include` shortcode (`layouts/shortcodes/include.html`) pastes the fragment's raw text into the markdown before
  Goldmark runs. Goldmark ends a raw HTML block at the first blank line, so a blank line anywhere in the block or in the
  fragment breaks the figure (what follows turns into paragraphs or code blocks). Markdown is not parsed inside the
  block: use `<code>` and `<em>`, never backticks or asterisks.
- Fragments are `fig-<id>.md` files at the bundle root, next to `index.md`, containing only HTML (the `typist.md`
  precedent). Never put them in a subfolder: Hugo 0.147 publishes `.md` files in a bundle's subfolders as pages of their
  own, while `.md` files at the bundle root stay unpublished resources. Never name a fragment `.html`: Hugo treats
  `.html` files under `content/` as pages. Keep the Goldmark passthrough delimiters out of fragments: no double dollar
  signs, no backslash followed by a parenthesis or a square bracket.
- Bundle CSS and JS are served raw by Hugo. Plain CSS only (no `@apply`, no Tailwind directives). Plain ES modules only
  (no bundler, no npm imports, no CDN, no site modules from `/js/`). Relative paths only: the folder gets renamed when
  the post is published.

### 3. Architecture

Prompt 1 creates the shared files. Every later prompt adds one fragment, one module and one figure block, and does not
edit the shared files, except that it may append a clearly marked `/* fig: <id> */` section to the end of
`css/blueprint.css` if it truly needs figure-specific rules.

```text
content/posts/draft-phobos-inference/
  css/blueprint.css       shared tokens and classes for every figure
  js/main.js              finds [data-bp-figure] elements, imports ./figures/<name>.js, starts each one
  js/blueprint.js         BlueprintFigure base class and small helpers
  js/figures/<id>.js      one module per figure; its default export is a class extending BlueprintFigure
  fig-<id>.md             one HTML fragment per figure, at the bundle root (see §2)
```

Fragment template (element ids are `fig-<id>`; the buttons, range inputs and readout are the only interactive parts):

```html
<div class="bp" id="fig-<id>" data-bp-figure="<id>">
  <div class="bp-head">
    <span class="bp-tag">Short tag</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-<id>-title fig-<id>-desc">
    <title id="fig-<id>-title">…</title>
    <desc id="fig-<id>-desc">…</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="…">
    <button type="button" class="bp-btn" data-group="mode" data-value="a" aria-pressed="true">A</button>
    <button type="button" class="bp-btn" data-group="mode" data-value="b" aria-pressed="false">B</button>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>
```

A figure with two toggle groups wraps each one in `<div class="bp-group" role="group" aria-label="…">` inside
`.bp-controls` (see `fig-tile-overrun.md`); the base class doesn't care about the nesting. Like `typist.md`, the
fragment file has no trailing newline.

`js/main.js`: for each `[data-bp-figure]` element, check the name against `/^[a-z0-9-]+$/`, dynamically import
`./figures/<name>.js`, construct the default export with the element, and call `start()`. One failing figure must not
stop the others: catch, `console.error`, move on.

#### The `js/blueprint.js` contract

Later prompts build on exactly this API. It is what Prompt 1 built; `js/figures/tile-overrun.js` is the worked example.

- `svgEl(tag, attrs, parent)` creates an SVG element with the given attributes (`undefined` and `null` values are
  skipped), appends it when `parent` is given, and returns it.
- `svgText(content, attrs, parent)` creates a `<text>`: a string becomes its content, an array of strings becomes one
  `<tspan>` per line (sharing `attrs.x`, 1.25em apart). Still pass `text-anchor` and `dominant-baseline` in `attrs`.
- `mulberry32(seed)` returns a seeded PRNG producing floats in [0, 1). Everything random in a figure is seeded, so the
  figure looks the same on every load.
- `clamp(value, min, max)`, `lerp(from, to, t)`, `easeInOutSine(t)`, `easeOutCubic(t)`.
- `Timeline`: `new Timeline(steps, { holdMs = 0 } = {})`, an ordered list of steps `{ durationMs, apply(progress) }`
  with an optional hold at the end. `advance(dtMs)` runs the current step's `apply` with its progress in [0, 1],
  carries leftover time into the next step (a 0 ms step applies at 1 at once), and returns `true` while running or
  holding, `false` once finished. `seekEnd()` applies every step at progress 1, from the first, in order, and skips the
  hold. `reset()` rewinds without applying anything. `get totalMs`, `get isFinished`. `apply(progress)` must be a pure
  function of `progress` that sets everything the step owns (easing happens inside it), so `apply(1)` is the step's
  final state and `seekEnd()` lands exactly on the end state from anywhere. Start every timeline with a 0 ms step that
  resets the visuals to the pre-animation look of the current state.
- `BlueprintFigure`, constructed with the `.bp` root element (it throws if the root has no `.bp-svg`):
  - Getters: `root`, `svg`, `drawing` (the `<g class="bp-drawing">` the current layout draws into), `layout`
    (`"wide"` or `"narrow"`), `state` (a frozen snapshot: every `data-group` by name with its string value, plus every
    range input by its `data-param` as a number), `reducedMotion`, `isVisible`, `hasInteracted` (true after any reader
    click on a control or input on a range).
  - `start()` wires everything. It reads the initial state from the markup (each group's `aria-pressed="true"` button,
    else its first button; each range input's value), builds the current layout synchronously and settles it. It
    handles clicks on `[data-group][data-value]` (moves `aria-pressed` within the group, updates `state`, calls
    `onChange(group, value)`, also when the button was already pressed), clicks on `[data-action]` (calls
    `onAction(action)`), and `input` events on `input[data-param]` (updates `state`, calls `onInput(param, value)` with
    a number). A `ResizeObserver` on the root rebuilds whenever the layout changes (`"narrow"` below 600 px of container
    width, `"wide"` from 600 px up), one animation frame later so the resize can't trip the browser's ResizeObserver
    loop error; the root carries `data-layout` for CSS. The frame loop runs only while at least 30% of the root is in
    view (`IntersectionObserver`) and the tab is visible (`visibilitychange`): leaving pauses it, coming back resumes
    it. It follows `prefers-reduced-motion` live: turning it on cancels the tour, stops the loop and calls `settle()`.
  - Subclass hooks: `build(layout)` draws everything for this layout into the fresh `drawing` group, sets the viewBox
    with `setViewBox(width, height)`, and restores the visuals of the current state. The base calls `settle()` right
    after every `build()`, including the first. A rebuild replaces every element, so steps look elements up at apply
    time through fields that `build()` replaces; they never capture them in closures. `update(dtMs)` advances
    animations and returns `true` to keep the frame loop alive. `settle()` jumps to the end state of whatever is
    playing (used under reduced motion and after every build). `onChange(group, value)`, `onAction(action)`,
    `onInput(param, value)`. `onFirstVisible()` runs once, the first time the figure is in view (under reduced motion
    too); its default runs the tour.
  - Helpers: `play()` starts the single `requestAnimationFrame` loop (right away if the figure is visible, otherwise as
    soon as it is), or calls `settle()` under reduced motion. `pause()` stops it. The loop clamps frame deltas to 50 ms,
    passes 0 on the first frame after a (re)start, and ends as soon as `update()` returns `false`, unless a tour is
    holding or `play()` was called during that frame. `setReadout(text)` writes `.bp-readout` only when the text
    changed. `setViewBox(width, height)`. `setState(patch)` changes `state` and syncs the controls (`aria-pressed`, a
    range input's value) without calling any hook, for a figure that moves its own controls (Prompt 4's intro).
  - Tour: a subclass may define `get tour()` returning state patches such as `[{ mode: "a" }, { mode: "b" }]`. The
    default `onFirstVisible()` applies each patch as if the reader had clicked it (`setState`, then `onChange` for every
    key of the patch, changed or not, or `onInput` for number values), lets the resulting animation finish (until
    `update()` returns `false`), holds 1.4 s, then applies the next; after the last patch it stops without a hold. The
    tour keeps the loop running through its holds, so it works even when a hook doesn't call `play()`. Any reader input
    cancels the tour, and a reader who acted before the figure came into view gets none. Under reduced motion there is
    no tour: the figure shows its default state, settled. A figure with a tour doesn't add a `holdMs` to the end of its
    own sequences, or the hold doubles.
  - `build()` keeps `<title>` and `<desc>`; they live outside `drawing`.

`css/blueprint.css` provides the following. Use it as is; anything else goes into an appended `/* fig: <id> */` section.

- Tokens on `.bp`: the §4 set plus `--bp-warn-fill-on` and `--bp-warn-glow`. On the light page `--bp-dim` is mixed
  toward the page background, because `--color-brand-dk` is darker than `--color-brand` there and idle would outshout
  working.
- SVG shapes and text: `.bp-box`, `.bp-wire`, `.bp-bracket` (1 unit, `--bp-label`), `.bp-texture` (a `<g>` of faint
  ticks that inherit its stroke), `.bp-packet`, `.bp-text` (12 units), `.bp-cap` (11 units, uppercase), `.bp-num`
  (mono, tabular numerals). States: `.is-on`, `.is-hot` and `.is-warn` on boxes, wires, brackets and text; `.is-on` and
  `.is-warn` on textures; `.is-warn` on packets; `.is-warn.is-hot` is a glowing amber box; `.is-emph` (stroke 2) on
  wires and brackets; `.is-dashed` (a dashed `.bp-box` has no fill unless it is also on, hot or warn); `.is-idle`
  (opacity 0.5); `.is-hidden` (opacity 0). Fill, stroke and opacity transition over 250 ms except under reduced motion;
  geometry never transitions, so moving attributes every frame is safe.
- HTML: `.bp-head`, `.bp-tag`, `.bp-readout` (reserves two lines so the drawing doesn't jump, balanced wrapping),
  `.bp-aside`, `.bp-controls`, `.bp-group`, `.bp-btn`, `.bp-range-label`, `.bp-range`, `.bp-noscript`.

If you are executing Prompt 1 and what you built differs from this contract, update this subsection of
`figure-prompts.md` to match (only this subsection), so later prompts read the truth.

### 4. Visual language

Prompt 1 has turned this section into `css/blueprint.css`; where the two differ, the file wins (for example `--bp-dim`
on the light theme). Tokens live on `.bp`, not `:root`, and every color is a `light-dark()` pair built on the site's
own tokens, so both themes work (the site toggles `color-scheme` through `.theme-dark` / `.theme-light` on `<html>`).
The starting values were:

```css
.bp {
  --bp-line: var(--color-brand); /* working: active strokes */
  --bp-dim: var(--color-brand-dk); /* idle strokes, outlines */
  --bp-ink: var(--color-fg); /* look here: hot dots, packets */
  --bp-label: var(--color-muted); /* labels, brackets, axes */
  --bp-fill: light-dark(rgba(61, 96, 112, 0.05), rgba(92, 220, 255, 0.025));
  --bp-fill-on: light-dark(rgba(61, 96, 112, 0.16), rgba(92, 220, 255, 0.16));
  --bp-glow: light-dark(rgba(61, 96, 112, 0.25), rgba(92, 220, 255, 0.5));
  --bp-warn: light-dark(#9a4f1c, #ffb56a); /* trouble or cost: overflow, miss, waiting, stranded */
  --bp-warn-fill: light-dark(rgba(154, 79, 28, 0.12), rgba(255, 181, 106, 0.14));
}
```

One semantic legend across all the figures, so readers learn it once: **brand = working, ink = look here, amber =
trouble or cost, dim = idle.** Color never carries meaning alone: pair amber with a label, a dash pattern or a position.

- Shapes: `rect` with `rx` 2–4, stroke 1.2 in `--bp-dim`, fill `--bp-fill`. Active: stroke `--bp-line`, fill
  `--bp-fill-on`, `filter: drop-shadow(0 0 4px var(--bp-glow))`. Wires 1.5, emphasis 2. Idle: opacity around 0.5.
  Moving data ("packets") are small `--bp-ink` rounded rects with the glow, moving at constant speed along their path.
  Buses such as PCIe are two parallel hairlines.
- JS never writes a color: every visual state is a class. Suggested vocabulary (extend when needed): `.bp-box`,
  `.bp-wire`, `.bp-bracket`, `.bp-packet`, `.bp-text`, `.bp-cap` (small uppercase label), `.bp-num` (mono, tabular
  numerals), and the states `.is-on`, `.is-hot`, `.is-warn`, `.is-idle`, `.is-dashed`. Transition fill, stroke and
  opacity over 250 ms ease-out; no transitions under reduced motion.
- Type inside the SVG: `var(--font-sans, sans-serif)` for words, `var(--font-mono, monospace)` with
  `font-variant-numeric: tabular-nums` for numbers. Labels 12–13 viewBox units; `.bp-cap` is 11 units, uppercase,
  letter-spacing 0.16em. Nothing smaller than 11 units. Set `text-anchor` and `dominant-baseline` explicitly. Keep
  in-SVG text to a few words; sentences go in the readout.
- HTML parts: `.bp-head` is a flex row that wraps. `.bp-tag` is 11 px, uppercase, letter-spacing 0.22em, `--bp-line`
  (the learning-to-type counter is the model). `.bp-readout` is 12 px mono, sentence case, `--bp-ink`, right-aligned on
  wide screens and wrapping under the tag on narrow ones. `.bp-btn` is transparent with a 1 px `--bp-dim` border,
  radius 3 px, 11 px uppercase letter-spaced `--bp-line` text and a 32 px minimum height; `aria-pressed="true"` gets a
  `--bp-line` border, a `--bp-fill-on` background and `--bp-ink` text; `:focus-visible` gets a clear outline. Range
  inputs use `accent-color: var(--bp-line)`. The site's CSS resets buttons, so set borders and backgrounds explicitly.
  Code identifiers in button and range labels go in `<code>` (`Fresh <code>cudaMalloc</code>`,
  `<code>warp_partial</code>`), which `blueprint.css` exempts from the uppercase transform so they keep their case.
- Spacing: `.bp` gets roughly `margin: 1.5rem 0 0.5rem`; the site already styles `figcaption` (small, muted, centered).
- No `z-index` (repo rule). Layer with SVG paint order.

### 5. Layout

- Two layouts, chosen by the base class from the `.bp` container width. **Wide** from 600 px up: viewBox 720 units
  wide (the text column is about 655 px on desktop, so one unit is about 0.9 px, and never less than 0.83). **Narrow**
  below 600 px: viewBox 400 units wide (phones give about 340–350 px, so one unit is about 0.85 px). The breakpoint
  sits at 600 so an 11-unit label never renders below about 9 px. Heights are per figure; keep wide at or under about
  340 units and narrow at or under about 540.
- Narrow is a real rearrangement, usually stacked, not the wide drawing shrunk. No overlapping or clipped labels in
  either layout, and no horizontal scrolling.
- `.bp-svg { display: block; width: 100%; height: auto; overflow: visible }`.

### 6. Motion

- Calm and technical: ease-out or sine easing, no bounce, no elastic. Packets move at constant speed. Hold a finished
  state at least 1.4 s before anything repeats.
- A figure animates only while at least 30% of it is in view and the tab is visible. At most one
  `requestAnimationFrame` loop per playing figure, stopped as soon as `update()` returns `false`. Clamp frame deltas to
  50 ms. The site header already runs a WebGPU render loop, so don't add idle work.
- Create SVG elements once per layout and animate by changing attributes and classes. No element creation per frame.
- `prefers-reduced-motion: reduce`: no autoplay, no tour, no loops. Show the default state, settled. Buttons still
  switch states, instantly.

### 7. Accessibility

- Every SVG's `<title>` and `<desc>` say what the figure shows, in plain words (each prompt gives the text).
- Buttons are real `<button type="button">` elements, with `aria-pressed` on toggles. Everything works with the
  keyboard alone. Update the `aria-live` readout when the state changes, never every frame.
- A figure that keeps running on its own (Prompt 5's simulation) sets `aria-live="off"` on its readout while it plays,
  and switches it back to `polite` only while paused, so Pause and Step are announced but a running simulation isn't
  read out every second.

### 8. Code style

Nothing lints `content/`, so this is on you.

- Follow the repo's `CLAUDE.md`: ES6 classes; `#private` fields declared at the top of the class body; `get` for
  computed read-only properties; `#private` methods; no underscore prefixes anywhere; unit suffixes on names
  (`durationMs`, `sizeMiB`, `widthUnits`); names that explain themselves; comments only for the non-obvious (a comment
  naming the technique is welcome where one is used, for example Vose's alias method or an LRU built on `Map` order).
  Keep each figure module to a few hundred lines.
- Formatting per `.prettierrc`: no semicolons, double quotes, 2-space indent, 120 columns, ES5 trailing commas, no
  parentheses around a single arrow-function parameter. `content/` is in `.prettierignore`, so run it explicitly from
  the repo root: `npx prettier --ignore-path .none --write "content/posts/draft-phobos-inference/**/*.{js,css}"`.
- No DOM access at module top level, so pure logic (a simulation, a layout function) can be imported from Node.

### 9. Facts

Use only the numbers each prompt lists under **Facts**. Anything else a figure needs (sizes, counts, durations) is
illustrative and must read that way: the figure itself says "illustrative", "simulated" or "schematic" where it applies.
If a prompt and the post disagree, stop and report instead of picking one.

### 10. Verify before you report

1. From the repo root, start `npm run dev` in the background. It runs Vite and Hugo together. Use the **Vite** URL it
   prints (usually `http://localhost:5173`) plus `/posts/draft-phobos-inference/`. Port 1313 serves the page without
   the site CSS, so don't judge anything there.
2. Save this helper in your scratchpad as `figure-shots.mjs`. It resolves Puppeteer from the repo, so it can live
   anywhere:

   ```js
   import { createRequire } from "node:module"
   import { mkdirSync } from "node:fs"
   import { join } from "node:path"

   const require = createRequire("C:/Users/joaeb/code/joa-ebert.com/package.json")
   const puppeteer = require("puppeteer")

   const [baseUrl, outDir, onlyId, endWaitArg] = process.argv.slice(2)
   const PAGE_PATH = "/posts/draft-phobos-inference/"
   const SETTLE_MS = 4000
   const MID_WAIT_MS = 1500
   const END_WAIT_MS = Number(endWaitArg ?? 8000)
   const VIEWPORTS = [
     { name: "wide", widthPx: 1200 },
     { name: "narrow", widthPx: 390 },
   ]
   const sleep = durationMs => new Promise(resolve => setTimeout(resolve, durationMs))

   mkdirSync(outDir, { recursive: true })
   const browser = await puppeteer.launch({ headless: true })
   const figureErrors = []
   const siteErrors = []
   const record = (label, text, url = "") =>
     (url.includes(PAGE_PATH) || text.includes(PAGE_PATH) ? figureErrors : siteErrors).push(`${label}: ${text}`)

   for (const theme of ["dark", "light"]) {
     for (const viewport of VIEWPORTS) {
       for (const motion of ["no-preference", "reduce"]) {
         const label = `${theme}-${viewport.name}-${motion}`
         const page = await browser.newPage()
         page.on("console", message => {
           if (message.type() === "error") record(label, message.text(), message.location().url)
         })
         page.on("pageerror", error => record(label, error.stack ?? error.message))
         await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: motion }])
         await page.setViewport({ width: viewport.widthPx, height: 1100, deviceScaleFactor: 2 })
         await page.evaluateOnNewDocument(value => localStorage.setItem("theme", value), theme)
         await page.goto(new URL(PAGE_PATH, baseUrl).href, { waitUntil: "load" })
         await sleep(SETTLE_MS) // the site's WebGPU header keeps the main thread busy for a few seconds after load
         const ids = await page.$$eval("[data-bp-figure]", elements => elements.map(element => element.id))
         for (const id of ids.filter(id => !onlyId || id === onlyId)) {
           const figure = await page.$(`figure:has(#${id})`)
           await figure.evaluate(element => element.scrollIntoView({ block: "center" }))
           await sleep(MID_WAIT_MS)
           await figure.screenshot({ path: join(outDir, `${id}-${label}-mid.png`) })
           await sleep(END_WAIT_MS)
           await figure.screenshot({ path: join(outDir, `${id}-${label}-end.png`) })
         }
         await page.close()
       }
     }
   }
   await browser.close()
   console.log(siteErrors.length ? `ignored ${siteErrors.length} errors from the rest of the site` : "no site errors")
   console.log(figureErrors.length ? figureErrors.join("\n") : "no figure errors")
   ```

   Run `node <scratchpad>/figure-shots.mjs http://localhost:5173 <scratchpad>/shots fig-<id> [endWaitMs]`. Pass a
   longer end wait when your figure's tour runs longer than about nine seconds.
3. Look at every screenshot: both themes, both widths, mid-animation and end, with and without reduced motion. Check
   that no label overlaps or clips, nothing renders below 11 units, everything is visible in the light theme, amber
   reads clearly on the light background, nothing overflows horizontally at 390 px, each state shows its correct
   readout, and the reduced-motion frame is complete and makes sense. Fix and shoot again until it's clean.
4. The helper must print "no figure errors". Stop the dev server when you're done.
5. Report: files created and modified, the backup path, the screenshot folder, anything the spec left open that you had
   to decide, and anything you couldn't meet.

---

## Prompt 1 — Foundation, plus figure `tile-overrun`

Read the Shared brief in this file first; it is binding.

### Part A: the foundation

1. Back up `index.md` to your scratchpad.
2. Create `css/blueprint.css`, `js/blueprint.js` and `js/main.js` as described in Shared brief §3–§8.
3. In the front matter of `index.md`, add these keys right after `tags:` and change nothing else:

   ```yaml
   styles:
     - css/blueprint.css
   scripts:
     - js/main.js
   ```

4. Create the verification helper from §10 in your scratchpad.
5. Build Part B on top of it. If the contract in §3 turned out to need changes, update that subsection (see §3).

### Part B: figure `tile-overrun`

**Section.** "Bugs only the whole model can see".

**The one idea.** A kernel works in tiles of 32 rows, so a five-row output still gets a whole tile. Without a mask, the
other 27 rows are written past the end of the output, into whatever memory comes next. The op-by-op check only reads
its own five rows back, so it passes. Whether anything breaks depends on what comes next: fresh `cudaMalloc`s happened
to leave harmless slack there, while the buffer pool put somebody's live buffer there.

**Facts.** A tile is 32 rows. The output is 5 rows. 27 rows are written past the end. The check reads back only the
output's own rows. Fresh allocations happened to leave slack after the output. The pool put a live buffer right after
it. The fix is masking, plus `@aligned` for kernels whose callers can promise the shape.

**Placement.** Insert after the paragraph that begins
`It was the same bug. The kernels were writing outside their outputs.` and before the paragraph that begins
`The fix went into the compiler:`. If you can't find the anchor, stop and ask.

**Wide layout (viewBox 720 × about 250).**

- Memory is one horizontal strip with addresses increasing to the right: 40 row cells (about 15 units wide, 1 unit
  apart) from x≈40 to x≈680, at y≈120, about 34 units tall.
- Cells 0–4 are the output, with a bracket below: "your output · 5 rows".
- What follows the output depends on the memory mode:
  - **buffer pool**: cells 5–39 are one live buffer, bracket "next allocation · in use": solid outlines plus a faint
    data texture (a few short ticks per cell) so it reads as full.
  - **fresh cudaMalloc**: cells 5–33 are slack (dashed outlines, no fill, bracket "slack") and cells 34–39 are the next
    allocation.
- Above the strip: a frame spanning cells 0–31, labeled "tile 0 · 32 rows". Above cells 0–4: a smaller bracket, "check
  reads these".
- The write: a glowing write head sweeps cells 0→31 in about 1.6 s. Cells 0–4 turn `is-on`. Cells 5–31: with **no
  mask** they turn `is-warn` (overwritten) under a bracket "27 rows past the end"; when **masked** they stay untouched,
  the head passes over them dashed, and the bracket reads "masked".
- Then the check: the "check reads these" bracket lights up and shows "✓".
- Only for **buffer pool + no mask**: after a 0.6 s beat, cells 5–31 pulse amber once more with the label "its owner
  reads garbage later".

**Narrow layout (viewBox 400 × about 520).** The same memory as a vertical column, addresses increasing downward: 40
cells about 200 units wide and 9 tall at x≈40, from y≈70. Brackets and labels sit to the right of the column (x≈255):
"your output · 5 rows", "27 rows past the end" (or "masked"), "slack" or "next allocation", "check reads these ✓". The
tile frame becomes a bracket on the left side of the column, labeled at its top.

**Controls.** Group `mask`: "No mask" (`off`, default) and "Masked" (`on`). Group `memory`: "Fresh <code>cudaMalloc</code>"
(`fresh`) and "Buffer pool" (`pool`, default). Action "Replay". Every change replays the write.

**Tour.** `[{ mask: "off", memory: "fresh" }, { mask: "off", memory: "pool" }, { mask: "on", memory: "pool" }]`:
harmless first, then the real bug, then the fix.

**Head copy.** Tag: "One tile · 32 rows". Readout by state:

- no mask, fresh: "27 rows written past the end · into slack · the check passes"
- no mask, pool: "27 rows written past the end · into a live buffer · the check still passes"
- masked (either memory mode): "masked · nothing written past the end"

**SVG title and desc.** Title: "A tile that writes past its output". Desc: "A five-row output is covered by one 32-row
tile. Without a mask, the tile writes 27 rows past the end into the next allocation, which the op-by-op check never
reads."

**Figcaption** (use exactly this text):

```text
A five-row output still gets a full 32-row tile, and without a mask the other 27 rows land in whatever comes next. The check only reads its own five rows, so it passes either way. The pool just makes sure "whatever comes next" is somebody's live buffer.
```

---

## Prompt 2 — Figure `qdot-mapping`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "Making decode fast".

**The one idea.** Decoding is a matrix times a vector: every output is one row of weights dotted with the activation.
Before, each thread walked its own row, so a warp's 32 simultaneous reads landed in 32 different rows, and every 32
weights it stopped to apply that block's scale. With `qdot_t` a whole warp owns one row: its 32 lanes read one
contiguous 512-byte stretch together, the scales are folded into the operation, and a single shuffle adds up the lanes'
partial sums at the end.

**Facts.** A Q8_0 block is 32 int8 weights plus one scale. Before: one thread per output, stopping every 32 weights for
the scale. After: one warp per output, 32 lanes, 512 contiguous bytes per step, no shared memory, one shuffle at the
end. Measured: the decode projections got 2 to 7 times faster. The animation is schematic and says so; it must not
suggest a speedup factor outside that measured range.

**Placement.** After the paragraph that begins `Then the thread mapping was upside down.` and before the paragraph that
begins `After that, more than half the step was the driver.`. If you can't find the anchor, stop and ask.

**Wide layout (viewBox 720 × about 340).**

- The activation as a strip on top (y≈30): 32 blocks of 18 units, 576 units wide from x≈40, labeled "activation".
- The weight matrix below it (from y≈55): 32 rows at a 6-unit pitch (5 tall, 1 apart), the same 32 blocks per row,
  faint block boundaries every 18 units. Label: "weights · Q8_0 blocks of 32 + a scale" (shorten if it crowds).
- The output as a column of 32 small cells to the right (x≈640) at the same row pitch, labeled "output".
- Under the matrix (y≈262): "one warp · 32 lanes", drawn as 32 small squares, with room below them for the reduction
  tree.
- **Thread per output**: 32 dots, one per row, all sitting in the current block column, with a vertical band marking
  the column being read. The band steps block by block (about 140 ms per block) and flashes amber briefly at every
  block boundary (label once: "scale"). All 32 lane squares are `is-on`; the readout explains that each one is on a
  different row. After the last block, every output cell fills.
- **Warp per output**: row 0 is `is-on`. A contiguous band covering 16 blocks (512 weights, 512 bytes) lights up with
  32 lane ticks inside it, then the next 16 blocks (two steps, about 450 ms each). The other rows get a faint sweep at
  the same time (the other warps take the other rows). Then a shuffle reduction under the lane strip: 32 → 16 → 8 → 4 →
  2 → 1 dots, five levels of about 150 ms, lines joining each pair. Output 0 fills, and the other output cells fill at
  the same moment.

**Narrow layout (viewBox 400 × about 470).** The same pieces stacked: activation strip (32 blocks of 10 units),
matrix (32 rows at a 5-unit pitch), output column at the right edge (x≈370), lane strip (32 squares of 10 units) and
the reduction tree below it.

**Controls.** Group `mapping`: "Thread per output" (`thread`, default) and "Warp per output · <code>qdot_t</code>" (`warp`). Action
"Replay".

**Tour.** `[{ mapping: "thread" }, { mapping: "warp" }]`.

**Head copy.** Tag: "Decode · matrix × vector · schematic". Readout:

- thread: "one thread per output · a warp's 32 reads hit 32 different rows · a stop every 32 weights for the scale"
- warp: "one warp per output · 32 lanes read one contiguous 512-byte stretch · one shuffle at the end · measured 2–7×
  faster"

**SVG title and desc.** Title: "Two ways to map a matrix-vector product onto threads". Desc: "With one thread per
output, each thread walks its own row of weights and stops at every block of 32. With one warp per output, the 32 lanes
read 512 contiguous bytes at a time and add up their partial sums with a shuffle."

**Figcaption** (use exactly this text):

```text
Decoding is a matrix times a vector. Before, every thread walked its own row and stopped every 32 weights for that block's scale. With <code>qdot_t</code> a whole warp takes one row, reads it in contiguous 512-byte stretches and adds up its lanes with a single shuffle.
```

---

## Prompt 3 — Figure `idle-warps`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "Then I stopped optimizing by hand".

**The one idea.** A 256-thread block is eight warps of 32 threads. Decode attention's loop over the keys only ever ran
on one warp while seven sat idle. `warp_partial` splits the keys into eight slices; every warp runs its own slice with
its own partial result, and the eight partial results are merged at the end. Only the loop gets eight times the hands.
Setup and the merge don't shrink, which is why the measured time dropped by "more than half" and not by 8×.

**Facts.** 256 threads = 8 warps × 32 threads. Before: 32 of 256 threads do the work. After: all eight warps.
Measured: kernel time down 50–59% ("more than half"). The animation's `all` mode must take about 45% of the `one`
mode's time: the loop portion shrinks 8×, the fixed work (setup, merge, write) doesn't.

**Placement.** After the bullet list in "Then I stopped optimizing by hand", that is after the list item that begins
`- **The megakernel was a dead end.**`, and before the quote that begins `> Read what the profiler already prints`.
Leave a blank line between the list and the figure, or Markdown folds the figure into the last bullet. If you can't
find the anchor, stop and ask.

**Wide layout (viewBox 720 × about 300).**

- The block on the left: 8 rows (warps) of 32 squares (threads), squares 9 units at an 11-unit pitch, about 352 × 88,
  at x≈50, y≈60. Row labels "w0" through "w7" at x≈20 in the `.bp-cap` style.
- A keys track per warp on the right (x≈430 to x≈690), aligned with its row: a hairline with a progress bar. Above the
  tracks: "keys", with a small axis.
- Under both: a time bar labeled "time · schematic" showing the current mode's duration, with a ghost tick at the other
  mode's total for comparison.
- **one warp**: warp 0's squares are `is-on`, warps 1–7 are `is-idle`, with "idle" at the end of their empty tracks.
  Phases: setup 0.4 s (every track's left end ticks), loop 3.2 s (track 0 fills from 0 to 100%), write 0.2 s. Total
  3.8 s.
- **warp_partial**: all squares are `is-on`; the key axis shows eight segment ticks; each track fills only its own
  segment, all at once, in 0.4 s; then the merge, 0.7 s (eight short lines converge on one result dot at the right);
  then write, 0.2 s. With setup at 0.4 s the total is 1.7 s, about 45%.

**Narrow layout (viewBox 400 × about 400).** The block on top (squares 8 units at a 10-unit pitch, 320 wide), the
eight tracks stacked below it, the time bar at the bottom.

**Controls.** Group `loop`: "One warp" (`one`, default) and "<code>warp_partial</code>" (`all`). Action "Replay".

**Tour.** `[{ loop: "one" }, { loop: "all" }]`.

**Head copy.** Tag: "One block · 8 warps × 32 threads". Readout:

- one: "threads doing work: 32 of 256"
- all: "threads doing work: 256 of 256 · measured kernel time down 50–59%"

**SVG title and desc.** Title: "Seven idle warps". Desc: "A block of 256 threads is eight warps. Before, only one warp
ran the loop over the keys. With warp_partial every warp takes one slice of the keys, and the partial results are
merged at the end."

**Figcaption** (use exactly this text):

```text
A block has eight warps, and the decode attention loop only ever ran on one of them. <code>warp_partial</code> gives each warp its own slice of the keys and merges the results at the end. Only the loop gets eight times the hands, which is why the kernel's time dropped by more than half and not by 8×.
```

---

## Prompt 4 — Figure `vram-residency`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "The kernel was never slow" (a subsection of "Every format llama.cpp has").

**The one idea.** On Windows, one 8 GiB card holds the model's weights, the runtime's buffers and whatever the desktop
is using. Past 8 GiB nothing fails. The driver quietly moves an allocation to system RAM and pages it back over PCIe
every time a kernel touches it, while `nvidia-smi` still reports the memory as used and the GPU as busy. For the 27B,
that allocation was the output head, read every token: 3.26 ms from VRAM, 96.7 ms over PCIe.

**Facts.** The card has 8 GiB (8192 MiB). The Qwen3.8-27B IQ1_M weights are 6.27 GiB (use 6420 MiB). The output head is
one 521 MiB tensor, read every token. The head ran in 3.26 ms standalone and 96.7 ms inside the paging model.
`nvidia-smi` showed the memory as used and the GPU as 100% busy. Windows manages residency per allocation. The benchmark
run had 1377 MiB of desktop VRAM in use and still fit. The runtime buffers' size is unknown: use 360 MiB and label it
"illustrative", which puts the edge just above 1,410 MiB of desktop VRAM, consistent with the benchmark. Don't show
tokens per second.

**Placement.** After the paragraph that begins `The head was being paged in from system memory over PCIe, every single
token.` and before the paragraph that begins `From there it was memory work, not kernel work.`. If you can't find the
anchor, stop and ask.

**Wide layout (viewBox 720 × about 300).**

- The VRAM bar: x 40→680 maps 0→8 GiB (80 units per GiB), at y≈80, 44 units tall, with GiB ticks and labels (0 to 8)
  below it. The right end is a hard edge labeled "8 GiB".
- Inside it, left to right: **desktop** (width from the slider, a neutral dim hatch, label "desktop"), **runtime
  buffers** (360 MiB, dashed, label "runtime · illustrative"), then the **weights** as a row of about 40 allocations of
  seeded, varying widths, the last and largest being the **output head** (521 MiB, about 40.7 units, labeled "output
  head").
- A dimmer **system RAM** bar below it (y≈200), labeled "system RAM", and a **PCIe** link (two parallel hairlines)
  joining the two bars at the right (x≈700).
- When desktop + runtime + weights exceed 8192 MiB, whole allocations past the edge drop into the system RAM bar in
  amber (about 400 ms), starting with the output head and taking more only as needed. While anything is evicted, a
  packet travels up the PCIe link once per token (about every 1.2 s) to the head's old slot.
- When everything fits, no loop runs.

**Narrow layout (viewBox 400 × about 330).** The same design at 40 units per GiB (x 40→360), ticks at 0, 2, 4, 6 and
8 GiB, fewer labels (the head's label above the bar with a leader line).

**Controls.** A range input instead of buttons:

```html
<label class="bp-range-label">Desktop VRAM <input type="range" class="bp-range" data-param="desktopMiB" min="800" max="2200" step="10" value="1000"></label>
```

Show its current value in the readout. Under the head row, add a static aside
`<span class="bp-aside">nvidia-smi: memory used · GPU 100% busy</span>`, styled like the readout but in `--bp-label`.
It says the same thing in every state; that's the point.

**Intro instead of a tour.** Override `onFirstVisible()`: unless the reader has touched the slider, animate
`desktopMiB` from 1000 to 1700 over about 2.5 s (eased) so the head drops into system RAM, and stop there. Under reduced
motion, stay at 1000, settled.

**Head copy.** Tag: "RTX 2080 SUPER · 8 GiB". Readout (format numbers with `toLocaleString("en-US")`):

- fits: "desktop 1,000 MiB · fits · 412 MiB to spare" (the spare is computed)
- over: "desktop 1,700 MiB · over by 288 MiB · the output head now pages over PCIe every token: 96.7 ms instead of
  3.26 ms", adding " · plus N more allocations" when more than the head is evicted

**SVG title and desc.** Title: "What fits on an 8 GiB card". Desc: "The desktop, the runtime's buffers and the model's
weights share 8 GiB of VRAM. When they don't fit, whole allocations move to system RAM and are paged back over PCIe
whenever a kernel reads them."

**Figcaption** (use exactly this text):

```text
Everything the 27B needs on an 8 GiB card, plus whatever the desktop is using. Drag the desktop up: Windows doesn't fail anything, it quietly moves an allocation to system RAM and pulls it back over PCIe every time a kernel touches it, while <code>nvidia-smi</code> keeps saying the memory is used and the GPU is busy.
```

---

## Prompt 5 — Figure `expert-cache`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "A model that doesn't fit at all".

**The one idea.** Qwen3.6-35B-A3B has 256 experts in every layer and a router that picks eight of them for every token.
The experts are 19.5 GB and the card has 8, so only a cache of them lives on the GPU. The router's picks repeat a lot
from token to token, so most picks are already cached and run on the card. A miss either crosses the PCIe bus into a
cache slot, evicting the least recently used expert, or gets computed by the CPU straight from system RAM.

**Facts.** 256 experts per layer. Eight picked per token. The experts total 19.5 GB; the card has 8 GB. The rest of the
model is about 2 GB and lives on the GPU. The hit rate is about 80%. The link is PCIe 3.0 x8 at 6.4 GB/s. Eviction is
least recently used. When misses are computed on the CPU, one miss per token is still copied into the cache in the
background for later tokens. The post gives no slot count, so never print one (use 48 slots internally).

**Simulation.** Put a DOM-free `RouterSimulation` class in the figure module so Node can import it. Seeded with
`mulberry32`. Expert popularity follows a seeded Zipf-like distribution (sample with Vose's alias method, or a
cumulative table and a binary search; name the technique in a comment). Temporal locality: each of the previous
token's picks survives with probability `keepProbability`, and the rest are drawn by popularity without duplicates.
The cache is an LRU of 48 slots (a `Map` in insertion order gives O(1) LRU). Warm up 300 tokens before the first frame
so the figure doesn't start cold. Tune `keepProbability` and the Zipf exponent so that, in copy mode, the long-run hit
rate over 5,000 tokens lands between 76% and 84%. Check it with a one-off Node run and put the chosen values and the
measured rates for both modes in your report. The real model gets its ~80% with the CPU path, which also copies only
one miss per token into the cache, so if the CPU mode lands far below 70%, the locality model is wrong: fix the model,
don't display the gap. Reset the running hit rate when the miss mode changes.

**Placement.** After the paragraph that begins `Phobos keeps a cache of experts on the GPU instead.` and before the
paragraph that begins `Which is how the obvious good idea died.`. If you can't find the anchor, stop and ask.

**Wide layout (viewBox 720 × about 330).**

- Left: the experts as a 16 × 16 grid (cells 12 units, 2 apart, about 222 square) at x≈30, y≈70, with the label
  "256 experts · one layer · system RAM" above it.
- Middle: the PCIe link (two parallel hairlines) from x≈270 to x≈440 at y≈150, labeled "PCIe · 6.4 GB/s".
- Right: a GPU frame (x≈455 to x≈700, y≈40 to y≈300) labeled "GPU", holding the "expert cache" as a grid of 48 slots
  (6 × 8, about 24 units each) and, below it, a static dim box "rest of the model · ~2 GB".
- Under the link: a CPU box (x≈290 to x≈420, y≈235 to y≈290) labeled "CPU".
- One token about every 1.1 s: (1) the eight picks flash `is-hot` in the grid; (2) hits: their slots pulse `is-on`;
  (3) misses turn `is-warn` in the grid. In **copy** mode a packet per miss travels the link into the least recently
  used slot, which dims briefly and then lights with its new expert. In **CPU** mode a dashed wire runs from each miss
  to the CPU box, the CPU box pulses, a small result packet goes to the GPU frame, and one miss also crosses the link
  into a slot in the background, drawn dimmer. (4) The readout updates.
- Never draw lines from grid cells to cache slots; it turns into spaghetti. The grid's styling and the slot pulses carry
  hit versus miss.

**Narrow layout (viewBox 400 × about 540).** The grid on top (cells 10 units, 2 apart), the link running down from it,
the GPU frame with the cache below, the CPU box beside the link.

**Controls.** Group `miss`: "Copy over PCIe" (`copy`, default) and "Compute on CPU" (`cpu`). Actions: one "Pause"/"Play"
button (`toggle`; the figure flips its label and `aria-pressed`) and "Step" (`step`, which advances one token, also while
paused).

**Playback.** Unlike the other figures, this one runs continuously while it's in view: it's a live simulation. No tour:
override `onFirstVisible()` to call `play()`, and have `update()` keep returning `true` until the reader pauses. The
base class still stops the loop whenever the figure leaves the view or the tab is hidden. Under reduced motion it starts
paused on a settled token, and Step still works (instantly). The readout's `aria-live` follows the rule in §7.

**Head copy.** Tag: "Qwen3.6-35B-A3B · one layer". Readout: "token 42 · 7 of 8 already on the card · hit rate so far
79% · simulated routing".

**SVG title and desc.** Title: "An expert cache on the GPU". Desc: "For every token the router picks eight of 256
experts. Cached experts run on the GPU. Missing ones are copied over PCIe into the cache or computed by the CPU from
system RAM."

**Figcaption** (use exactly this text):

```text
One layer of Qwen3.6-35B-A3B: 256 experts, eight per token, and only a cache of them fits on the card. Most picks are already there; the rest cross the PCIe bus or get computed by the CPU straight from system RAM. The routing is simulated and tuned to the roughly 80% hit rate the real model gets.
```

---

## Prompt 6 — Figure `copy-queue`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "A model that doesn't fit at all" (the second figure in that section).

**The one idea.** Before the CPU can compute its missed experts, it needs one 8 KB row of activations from the GPU.
That tiny readback went through the same copy engine as the big expert refills, so it waited about a millisecond
behind them every time, and putting it on another CUDA stream doesn't help, because both streams feed one copy engine.
The fix: nothing on the critical path is a DMA. The GPU writes the row straight into pinned host memory, the CPU
threads are already spinning and start at once, and a tiny GPU kernel spins on a flag in host memory until the CPU's
result lands. The copy engine keeps refilling experts in the background, and nobody waits for it.

**Facts.** An 8 KB row. About 1 ms of waiting, every time. The wait was behind expert refill copies. Separate
non-blocking streams share one copy engine. The control data (which experts, their weights, which cache slot holds
what, the CPU's result) lives in pinned host memory that GPU kernels read and write directly. The CPU threads spin
instead of sleeping. A small PTX kernel spins on a flag. Measured before the fix: 17 t/s with CPU misses against 30 t/s
with plain copies. After: decode doubled. Everything else, including every duration on the time axis, is schematic.

**Placement.** After the paragraph that begins `So nothing on the critical path is a DMA anymore.` and before the
paragraph that begins `The model also found a classic`. If you can't find the anchor, stop and ask.

**Wide layout (viewBox 720 × about 290).**

- Three lanes with `.bp-cap` labels at x≈20: "GPU" (y≈70), "copy engine" (y≈135), "CPU" (y≈200). The lanes run from
  x≈130 to x≈700 over a schematic time axis t = 0 → 10 (57 units per t).
- Draw all blocks as faint outlines first; a playhead then sweeps from t = 0 to the end at constant speed (about 3.4 s
  for before, about 1.9 s for after) and lights each block as it passes.
- **Before**:
  - copy engine: "expert refill" from 0 to 2.4 and from 2.4 to 4.8 (large blocks, `--bp-line`), then "8 KB row" from
    4.8 to 5.0 (an amber sliver), with a leader label "the row, queued behind the refills".
  - GPU: "hits" from 0 to 2.0; at 2.0 a dashed amber arrow down to the copy engine lane ("row ready"); idle from 2.0 to
    7.4 (dashed amber outline, "waiting on the CPU"); "add CPU result" from 7.4 to 8.0.
  - CPU: idle from 0 to 5.0 (dashed); "compute misses" from 5.0 to 7.0; a result arrow up to the GPU from 7.0 to 7.4.
  - A bracket over the copy engine lane from 2.0 to 4.8: "≈ 1 ms".
  - An end marker at 8.0: "layer done".
- **After**:
  - copy engine: the same two refills from 0 to 4.8, dimmer, labeled "refills, in the background".
  - GPU: "hits" from 0 to 2.0; a tiny "write row" at 2.0 with an arrow straight down to the CPU lane that bridges over
    the copy engine lane (a small gap in the lane line where it crosses), labeled "pinned host memory"; "spin on flag"
    from 2.1 to 3.9 (dim, fine dashes); "add CPU result" from 3.9 to 4.5.
  - CPU: "spinning" from 0 to 2.05 (fine dashes); "compute misses" from 2.05 to 3.8; "flag" at 3.8 with an arrow up to
    the GPU arriving at 3.9, bridging the copy engine lane the same way.
  - An end marker at 4.5, "layer done", plus a ghost tick at 8.0 labeled "before".
- Don't print a ratio between the two end markers; the readout carries the measurement.

**Narrow layout (viewBox 400 × about 430).** Lane labels above each lane instead of to the left, the time axis from
x≈20 to x≈380, short block labels ("refill", "8 KB", "hits", "misses", "spin"), and the "≈ 1 ms" bracket.

**Controls.** Group `path`: "Before" (`before`, default) and "After" (`after`). Action "Replay".

**Tour.** `[{ path: "before" }, { path: "after" }]`.

**Head copy.** Tag: "One layer of a decode step · schematic". Readout:

- before: "the 8 KB row waits ≈ 1 ms behind the refills · measured: 17 t/s, slower than plain copies at 30"
- after: "no DMA on the critical path · measured: decode doubled"

**SVG title and desc.** Title: "An 8 KB readback stuck behind the expert copies". Desc: "Before: the activation row the
CPU needs waits in the copy engine's queue behind large expert refills, so first the CPU and then the GPU wait. After:
the GPU writes the row into pinned host memory, the CPU starts immediately, and the GPU picks up the result by polling
a flag."

**Figcaption** (use exactly this text):

```text
One layer of a decode step, not to scale. The CPU can't start on its experts until it has an 8 KB row of activations, and that tiny readback used to sit in the same copy-engine queue as the expert refills. Now the GPU writes the row straight into pinned host memory and a small kernel spins on a flag until the CPU's answer is back.
```

---

## Prompt 7 — Figure `exact-size-pool`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "Real work, not benchmarks".

**The one idea.** The buffer pool files every released buffer under its exact size and only hands it out again for a
request of that same size. A benchmark sends the same prompt length every time, so every pass reuses the previous
pass's buffers and memory stays flat. A coding agent sends a new length with every request, so every pass allocates
fresh buffers and the old ones sit in the pool for good: gigabytes within a few dozen requests, until the card spills
into system RAM. The post's lesson is to size scratch from bounds, never from the data; then every request asks the
pool for the same size.

**Facts.** The pool files buffers by exact size. A benchmark repeats the same length on every request; an agent sends a
new length every time, and each one strands a prompt pass's worth of buffers. The real session reached about 15 GiB of
GPU memory on an 8 GB card, half of it spilled into system RAM. "Gigabytes, within a few dozen requests." Lesson: size
scratch from bounds. The "sized from bounds" mode shows that lesson; don't present it as the exact code fix.
Illustrative, and labeled as such in the figure: a 6.0 GiB baseline (weights, caches, desktop), 0.3 GiB per pass, and
30 requests, so that 6 + 30 × 0.3 = 15 GiB.

**Placement.** After the paragraph that begins
`Here's why. The buffer pool files a released buffer under its exact size` and before the paragraph that begins
`This exact rule bit me three times.`. If you can't find the anchor, stop and ask.

**Wide layout (viewBox 720 × about 320).**

- Left (x≈20 to x≈190): the last eight requests as mono text rows, newest on top ("#12 · 2,511 tokens"), the current
  one `is-hot`.
- Middle (x≈210 to x≈530): the pool's shelves, one row per size key (a mono label such as "2,511" at the left of the
  shelf), each holding one pass's worth of buffers (five small blocks). Buffer states: in use `is-on`; idle and
  reusable, dim; stranded `is-warn`, with the label "stranded" next to the first stranded shelf. Show at most eight
  shelves and collapse older ones into a "+ 14 more shelves" line.
- Right (x≈560 to x≈700): a vertical VRAM gauge from 0 to 16 GiB (240 units, 15 per GiB) with a line at 8 GiB labeled
  "8 GiB card". It fills up to the current use: brand up to 8 GiB, amber above it with the label "spilled to system
  RAM".
- One request about every 700 ms, 30 requests, then hold:
  - **benchmark**: every request is 512 tokens. The first pass creates the "512" shelf and every later pass takes the
    same buffers (idle → in use → idle). The gauge stays at 6.3 GiB.
  - **coding agent**: seeded, ragged lengths that grow like a transcript (start near 1,850, then add 120 to 680 tokens
    each time). No shelf ever matches, so each pass creates a new shelf. When a pass ends its buffers go idle and, a
    beat later, amber and "stranded". The gauge climbs 0.3 GiB per request, to 15 GiB.
  - **sized from bounds**: every pass asks for the same bound size (label the shelf "max shape"). One shelf, reused
    every time, a flat gauge.

**Narrow layout (viewBox 400 × about 470).** The gauge becomes a horizontal bar on top (0 → 16 GiB over 360 units, the
8 GiB line in the middle), the shelves go below it (at most six), and the request list is dropped (the readout names
the current request).

**Controls.** Group `workload`: "Benchmark" (`benchmark`), "Coding agent" (`agent`, default) and "Sized from bounds"
(`bounds`). Action "Replay".

**Tour.** `[{ workload: "benchmark" }, { workload: "agent" }]`, ending on the problem.

**Head copy.** Tag: "Buffer pool · filed by exact size". Readout while a run plays: "request 12 · 2,511 tokens ·
reused: no · stranded: 3.3 GiB · 9.6 GiB in use on an 8 GiB card · illustrative sizes" (stranded = finished passes ×
0.3; in use = 6.0 + stranded + the running pass). At the end of the agent run: "30 requests · 9 GiB stranded · 15 GiB in
use on an 8 GiB card · illustrative sizes".

**SVG title and desc.** Title: "A pool that only reuses exact sizes". Desc: "Requests of the same size reuse the pool's
buffers. Requests of a new size every time leave their buffers behind, and memory use climbs past the card's 8 GiB."

**Figcaption** (use exactly this text):

```text
The pool only hands a buffer back out for a request of exactly the same size. A benchmark always asks for the same size, an agent never does, so every prompt left a pass's worth of buffers behind until the card spilled into system RAM. Sizes are illustrative.
```

---

## Prompt 8 — Figure `bandwidth-bound`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "Making decode fast", right after the two paragraphs on why decode is bandwidth-bound and before the
`qdot-mapping` figure.

**The one idea.** Decoding is bound by memory bandwidth. A decode step reads every weight once per token and does one
multiply-add with it, about two operations per byte, while the card needs roughly 25 operations per byte before the
math, not the memory, becomes the limit. So the bus is always busy, the math units mostly wait, and the speed limit is
the bytes a token needs divided by the bandwidth. A 512-token prompt reuses every weight 512 times, about a thousand
operations per byte, and the bottleneck flips.

**Facts.** Q8_0 stores 32 weights in 34 bytes, and a token does one multiply-add (two operations) per weight, so decode
runs at ~1.9 ("~2") operations per byte and a 512-token prompt at ~964 ("~1,000"). The RTX 2080 SUPER: ~11.4 TFLOP/s
fp32 peak ("~11 TFLOP/s"), ~415 GB/s on a plain memory copy (the spec sheet says 496), 48 SMs. Its balance point is
roughly 25 operations per byte (11.4 TFLOP/s over 415–496 GB/s is 23–27.5). The 0.8B Q8_0 model reads 0.83 GB per token,
so its ceiling is about 2 ms, roughly 500 tokens a second; Phobos decodes it at 328. Derived, and labeled in the figure:
the math units are busy ~8% of the time in decode (2 over 25, so 4 of the 48 SMs light up), the bus ~3% in a prompt
(25 over 964). All animation timing is schematic.

**Placement.** After the paragraph that begins `A prompt is the opposite.` and before the paragraph that begins
`Step one was keeping the weights quantized`. If you can't find the anchor, stop and ask. The two paragraphs before the
figure, starting at `Decoding and reading a prompt are different problems.`, were written together with it.

**Wide layout (viewBox 720 × 252).**

- Top row, left to right: a "weights in VRAM" block (x 24–154, y 40–132) holding 12 weight rows; the "memory bus ·
  ~415 GB/s" as two parallel hairlines (x 162–470, 16 apart around y 86) carrying 16 × 8 packets; a "48 SMs · ~11
  TFLOP/s" block (x 478–682, y 40–132) holding a 12 × 4 grid of 12-unit squares at a 16-unit pitch.
- Notes under the three blocks (y 150): "once per token" or "once per prompt" under the weights, "busy 100%" or "busy ~3%"
  under the bus, "busy ~8%" or "busy 100%" under the SMs. Whatever sets the pace is `is-hot`; decode's idle math is
  `is-warn`.
- Bottom: a log axis of operations per byte from 1 to 1,000 (x 60–660 at y 206, ticks and labels at 1, 10, 100 and
  1,000), emphasized amber (`is-warn`) left of the balance point and brand (`is-on`) right of it. A dashed tick at 25 is
  labeled "card needs ≈ 25", "memory-bound" and "compute-bound" sit over the two segments, and "operations per byte" goes
  under the axis. The operating point is a glowing dot on the axis with "decode ≈ 2" or "prompt ≈ 1,000" above it, the
  label anchored so it never leaves the axis.
- **Decode:** a packet leaves every 250 ms and crosses the bus in 1,250 ms, so five are always in flight. A read cursor
  walks the 12 weight rows once per token (2.4 s a pass): rows already read `is-on`, the current one `is-hot`. Each
  delivery lights 4 of the 48 SMs, picked by a seeded hash of the delivery's index (Knuth's multiplicative hash into
  `mulberry32`), so they wander over the grid the same way on every load.
- **Prompt:** a packet only every 4 s, the cursor crawls (one pass for the whole prompt), and all 48 SMs are `is-on`
  with a column sweeping `is-hot` every 160 ms.
- Switching phases slides the dot along the axis (700 ms, sine easing); its label hides until the dot lands.

**Narrow layout (viewBox 400 × 278).** The same row, narrower: weights x 20–100, the bus x 106–238 labeled "bus · ~415
GB/s", and the SMs x 246–380 as an 8 × 6 grid labeled "48 SMs" over "~11 TFLOP/s". The axis runs x 40–360 at y 214, with
"card needs ≈ 25" and "operations per byte" on separate lines under it.

**Controls.** Group `phase`: "Decode · 1 token" (`decode`, default) and "Prompt · 512 tokens" (`prompt`). One
"Pause"/"Play" button (action `toggle`, `aria-pressed="true"` while paused), hidden under reduced motion.

**Playback.** Runs continuously while in view, like Prompt 5. Instead of a tour, `onFirstVisible()` plays decode,
switches to the prompt at 6 s and back to decode at 12 s, then stays there, unless the reader clicks anything first; the
readout's `aria-live` is off during that intro (§7). Under reduced motion there is no intro, just a still frame: a full
bus in decode, one packet mid-bus in the prompt.

**Head copy.** Tag: "Bytes vs math · RTX 2080 SUPER". Readouts, with a no-break space before every "·" so a wrapped
line never starts with a dot:

- decode: "decode · ~2 operations per byte, the card needs ~25 · the math waits on memory · the 0.8B tops out near 500
  tokens/s"
- prompt: "prompt · 512 tokens reuse every weight · ~1,000 operations per byte · now the memory waits on the math"

Both wrap to three lines at every width from 360 to 1200 px. Reserve three
(`#fig-bandwidth-bound .bp-readout { min-height: 4.5em }`) so switching phases never moves the drawing.

**SVG title and desc.** Title: "Why decoding is bound by memory bandwidth". Desc: "Weights stream from VRAM over the
memory bus to the card's 48 SMs. Decoding reads every weight once per token and does about two operations per byte, so
the bus is always busy while the math units sit mostly idle. A 512-token prompt reuses every weight 512 times, about a
thousand operations per byte, so the math units are busy and the bus mostly idle. A log scale of operations per byte
marks the card's balance point at about 25."

**Figcaption** (use exactly this text):

```text
Decoding pushes every weight across the memory bus once per token and does almost no math with it, so the bus sets the pace and the math units mostly wait. A prompt reuses each weight for all 512 tokens, and the bottleneck flips.
```

---

## Prompt 9 — Figure `hadamard-rotation`

Read the Shared brief in this file first; it is binding. Prompt 1 built the foundation: use `js/blueprint.js` as it is.

**Section.** "PrismML Ternary-Bonsai-2-27B" (under "More Quantizations").

**The one idea.** Ternary weights share one scale per block, so a single outlier can ruin it: the best scale fits the
outlier and every small weight rounds to zero. A randomized Hadamard rotation (random sign flips, then the fast
Walsh–Hadamard transform: log2(n) stages of butterflies that only add and subtract, then a division by sqrt(n)) spreads
the outlier over the whole block before rounding, so rounding loses a lot less. The activations get the same rotation
at runtime, so the product doesn't change, and one rotation serves every projection that reads the same input.

**Facts.** PTQ1_0 packs 128 ternary weights (−1, 0, +1) into 26 bytes plus one scale. The model's Hadamard blocks are
1,024 wide, so the real transform has 10 stages; the figure is a 16-wide toy with 4 stages and a division by 4. The
rotation is orthogonal, so it changes no lengths and `(W·Hᵀ)·(H·x) = W·x`. The toy row is seeded and representative:
15 standard-normal weights plus a 6σ outlier at lane 5, `mulberry32(1489)` with Box–Muller (two uniform draws per
value), then 16 sign draws. Over 1,500 such rows the median rounding error (relative L2, best possible ternary scale
from a 1,000-step grid search over (0, max|v|]) is 0.52 as is and 0.35 rotated, and rotation helps in all 1,500 rows;
seed 1489 sits at both medians (0.522 with 15 of 16 weights rounding to 0, 0.346). Rows with heavy tails but no
standout outlier barely improve, so don't claim more than the figure shows. Compute every number in the readout from
the drawn row; never type one in.

**Placement.** After the paragraph that begins `Since 1-bit was my niche in which I hill-climbed early on` and before
the paragraph that begins `Then several "human errors" needed to be removed.`. If you can't find the anchor, stop and
ask.

**Wide layout (viewBox 720 × 300).**

- Three columns over 16 lanes (centers from y 64, 13 apart, bars 8 tall). Left, "a row of weights": horizontal bars
  from an axis at x 98 (72 units for the outlier's 6), the outlier `is-warn`, the rest `is-on`. Right, "rounded to −1,
  0, +1": the same kind of bars from an axis at x 612. Middle, "Hadamard rotation" (x 180–534): a hairline per lane, a
  column of "+"/"−" sign glyphs at x 206 labeled "random signs", and four butterfly stages at x 266, 330, 394 and 458
  labeled "4 butterfly stages". Stage k joins lanes 2^k apart with crossing lines 24 units either side of its x.
- Rounding marks in the right column: dashed `is-dashed` lines at ±scale (the solid axis is 0) with "−1", "0" and "+1"
  under them, a 2-unit ink tick at each value's rounded position, and an amber `is-warn` wire from each value to its
  tick.
- A note under the network: "adds and subtracts only, then ÷ 4 · the model's block is 1,024 wide: 10 stages".

**Narrow layout (viewBox 400 × 306).** The same three columns: lanes 11.5 apart, left axis x 62 and right axis x 338
(46 units for the outlier), the network x 112–288 with signs at x 130 and stages at x 164, 198, 232 and 266 (crossings
13 units either side). Labels "weights", "rotation", "rounded", sub-labels "signs" and "4 stages", and the note on two
lines: "adds and subtracts, then ÷ 4" over "the model's block: 1,024 wide".

**Controls.** Group `rotation`: "Round as is" (`off`) and "Rotate, then round" (`on`, default). Action "Replay".

**Playback.** Tour `[{ rotation: "off" }, { rotation: "on" }]`.

- **Round as is:** the signs go `is-idle` and the butterflies hide (the lanes run straight). The right bars show the raw
  row at once, then the rounding marks fade in over 600 ms (ticks from 40%, errors from 60%). The best scale lands on
  the outlier: the levels sit at the column's edges and all 15 small weights get amber errors down to 0.
- **Rotate, then round:** the signs flash `is-hot` (350 ms), each butterfly stage lights `is-on` in turn (300 ms each),
  the right bars grow from the axis to the rotated values (450 ms, ease-out), then the same rounding (600 ms). The
  levels land at about ±2.
- Under reduced motion: no tour, the default (rotated) frame settled; clicking switches instantly.

**Head copy.** Tag: "Rotate, then round · a 16-wide toy". Readouts, with a no-break space before every "·", numbers
computed from the drawn row:

- as is: "rounded as is · the best scale fits the outlier, so 15 of 16 weights round to 0 · rounding error 52%"
- rotated: "rotated first · the outlier spreads over all 16 · rounding error 35% · the activations get the same
  rotation at runtime"

Both wrap to three lines at every width from 360 to 1200 px. Reserve three
(`#fig-hadamard-rotation .bp-readout { min-height: 4.5em }`) so switching never moves the drawing.

**SVG title and desc.** Title: "Rotating before rounding". Desc: "A row of 16 weights with one large outlier is rounded
to ternary values, once as it is and once after a Hadamard rotation. Rounded as it is, the best scale fits the outlier
and the 15 small weights all round to zero. The rotation, random sign flips followed by four stages of additions and
subtractions, spreads the outlier over all 16 values, and the rounding error drops from 52 to 35 percent. The model's
real blocks are 1,024 wide."

**Figcaption** (use exactly this text):

```text
Ternary weights share one scale per block, so a single outlier can ruin it: the best scale fits the outlier and every small weight rounds to zero. A Hadamard rotation, random sign flips followed by stages of adds and subtracts, spreads the outlier over the whole block, so rounding loses a lot less. The activations get the same rotation at runtime, so the product doesn't change, and one rotation serves every projection that reads the same input.
```
