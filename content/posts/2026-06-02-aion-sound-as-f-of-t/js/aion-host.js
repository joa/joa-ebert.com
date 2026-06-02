export default class AionHost {
  #ctx = null
  #node = null
  #stdlib = ""
  #pendingCode = null
  #onError = null
  #onCompiled = null
  #onTime = null

  constructor({ stdlib = "", onError = null, onCompiled = null, onTime = null } = {}) {
    this.#stdlib = stdlib
    this.#onError = onError
    this.#onCompiled = onCompiled
    this.#onTime = onTime
  }

  get state() {
    return this.#ctx?.state ?? "closed"
  }

  async start(code) {
    if (!this.#ctx) {
      this.#ctx = new AudioContext()
      const url = new URL("./worklet/aion-processor.js", import.meta.url)
      await this.#ctx.audioWorklet.addModule(url)
      this.#node = new AudioWorkletNode(this.#ctx, "aion", { outputChannelCount: [2] })
      this.#node.connect(this.#ctx.destination)
      this.#node.port.onmessage = (e) => this.#onWorkletMessage(e.data)
      if (this.#pendingCode != null) {
        this.apply(this.#pendingCode)
        this.#pendingCode = null
      }
    }
    if (code != null) this.apply(code)
    this.#node.port.postMessage({ type: "reset" })
    if (this.#ctx.state === "suspended") await this.#ctx.resume()
  }

  async stop() {
    if (this.#ctx?.state === "running") await this.#ctx.suspend()
    this.#onTime?.(0)
  }

  async apply(code) {
    if (!this.#ctx) {
      return this.start(code)
    }

    if (!this.#node) {
      this.#pendingCode = code
      return
    }

    this.#node.port.postMessage({ type: "compile", code: `${this.#stdlib}\n${code}` })
  }

  #onWorkletMessage(msg) {
    if (msg.type === "error") this.#onError?.(msg.message)
    else if (msg.type === "compiled") this.#onCompiled?.()
    else if (msg.type === "time") this.#onTime?.(msg.value)
  }
}