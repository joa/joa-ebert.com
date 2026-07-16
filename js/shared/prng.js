export class Prng {
  // mulberry32

  #state

  constructor(seed = 0) {
    this.#state = (seed | 0) + 0x6d2b79f5
  }

  next() {
    let t = (this.#state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min, max) {
    return min + this.next() * (max - min)
  }
}
