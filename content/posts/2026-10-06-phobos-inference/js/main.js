// Starts every blueprint figure on the page. Each figure lives in ./figures/<name>.js and fails
// on its own: one broken figure must not take the others down.
const FIGURE_NAME = /^[a-z0-9-]+$/

async function startFigure(root) {
  const name = root.dataset.bpFigure
  try {
    if (!FIGURE_NAME.test(name)) throw new Error(`invalid figure name "${name}"`)
    const { default: Figure } = await import(`./figures/${name}.js`)
    new Figure(root).start()
  } catch (error) {
    console.error(`Blueprint figure "${name}" failed to start`, error)
  }
}

for (const root of document.querySelectorAll("[data-bp-figure]")) startFigure(root)
