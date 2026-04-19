// Moon Phase
// ##########
//
// Returns the current lunar phase in [0, 1) using a known new-moon epoch
// and the synodic period. Used by the renderer to set the moon phase uniform.
// 0.00 = new moon, 0.25 = first quarter, 0.50 = full moon, 0.75 = last quarter.

const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 0, 18)
const SYNODIC_PERIOD_MS = 29.530588853 * 24 * 60 * 60 * 1000

export default function moonPhase() {
  return ((Date.now() - KNOWN_NEW_MOON) % SYNODIC_PERIOD_MS) / SYNODIC_PERIOD_MS
}
