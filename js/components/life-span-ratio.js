// LifeSpanRatio Component
// #######################
//
// Custom element <life-span-ratio> that renders a visual progress bar
// showing the fraction of a lifespan elapsed from birth-year to today.

export class LifeSpanRatio extends HTMLElement {
  birthYear = 0
  startYear = 0

  static register(registry) {
    registry.define("life-span-ratio", LifeSpanRatio)
  }

  static get observedAttributes() {
    return ["birth-year", "start-year"]
  }

  attributeChangedCallback(name, _prev, next) {
    switch (name) {
      case "birth-year":
        this.birthYear = parseInt(next, 10)
        this.render()
        break
      case "start-year":
        this.startYear = parseInt(next, 10)
        this.render()
        break
    }
  }

  connectedCallback() {
    this.render()
  }

  render() {
    const currentYear = new Date().getFullYear()
    const p = ((currentYear - this.startYear) / (currentYear - this.birthYear)) * 100.0
    this.innerHTML = `<code class="font-mono font-light bg-raised border border-edge-soft rounded text-sm [font-optical-sizing:auto] [font-variation-settings:'wdth'_300] p-[0.1em_0.4em]">${p === (p | 0) ? (p | 0).toString() : p.toFixed(2.0)}%</code>`
  }
}
