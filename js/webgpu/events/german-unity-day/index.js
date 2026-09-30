// German Unity Day
// ################
//
// Calendar event module: active October 1–7 (Tag der Deutschen Einheit, Oct 3).
// German flag (5:3) with red / gold / white fireworks — black sparks would be
// invisible against the night sky.

import { FlagDayModule } from "../flag-day/flag-day-module.js"

export default class GermanUnityDayModule extends FlagDayModule {
  constructor() {
    super({
      flagShader: "flag-de.wgsl",
      aspectRatio: 5 / 3,
      fireworkColors: [
        [1.0, 0.1, 0.05],
        [1.0, 0.8, 0.1],
        [1.0, 1.0, 1.0],
      ],
    })
  }
}
