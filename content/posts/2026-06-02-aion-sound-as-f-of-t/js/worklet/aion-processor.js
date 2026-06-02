class AionProcessor extends AudioWorkletProcessor {
  #fn = () => [0, 0]
  #frame = 0
  #self
  #err = false

  constructor() {
    super()
    this.#self = (...args) => this.#fn(...args) // $ in user code is bound to #self so we even survive recompiles
    this.port.onmessage = (e) => this.#onMessage(e.data)
  }

  #onMessage({ type, code }) {
    this.#err = false
    if (type === "reset") {
      this.#frame = 0
      return
    }
    if (type !== "compile") return
    try {
      const fixedCode = code.replace(/\n\s*\n(\s*)([([])/g, "\n\n$1;$2") // prepend a defensive ; to ( or [ to dodge ASI for blank lines
      const ctor = new Function("$", "sampleRate", `return eval(${JSON.stringify(fixedCode)})`)
      const fn = ctor(this.#self, sampleRate)
      if (typeof fn === "function") {
        this.#fn = fn
      } else if (typeof fn === "object" && fn !== null) {
        const fns = Object.entries(fn).filter(([key]) => !key.startsWith("_")).map(([, f]) => f)
        const out = new Float64Array(2)
        if (fns.length === 0) throw new TypeError("object must have at least one active key")
        this.#fn = (t) => {
          let l = 0, r = 0
          for (const f of fns) {
            const [fl, fr] = f(t)
            l += fl
            r += fr
          }
          out[0] = l
          out[1] = r
          return out
        }
      } else {
        throw new TypeError("code must evaluate to a function or object")
      }
      this.port.postMessage({ type: "compiled" })
    } catch (err) {
      this.port.postMessage({ type: "error", message: String(err) })
      this.#err = true
    }
  }

  process(inputs, outputs) {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] ?? out[0]
    const sr = sampleRate
    let once = false
    for (let i = 0; i < left.length; i++) {
      try {
        const [l, r] = this.#fn(this.#frame++ / sr)
        if (isNaN(l) || isNaN(r)) {
          throw "NaN"
        }
        left[i] = l
        right[i] = r
      } catch (err) {
          left[i] = right[i] = 0.0
          this.#err || this.port.postMessage({ type: "error", message: String(err) })
          this.#err = true
      }
    }
    this.#err || this.port.postMessage({ type: "time", value: this.#frame / sr })
    return true
  }
}

registerProcessor("aion", AionProcessor)