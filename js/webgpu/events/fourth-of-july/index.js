// Fourth of July
// ##############
//
// Calendar event module: active July 1–7.
// US flag (19:10) with red / white / blue / gold fireworks.

import { FlagDayModule } from "../flag-day/flag-day-module.js"

export default class FourthOfJulyModule extends FlagDayModule {
  constructor() {
    super({
      flagShader: "flag-us.wgsl",
      aspectRatio: 19 / 10,
      fireworkColors: [
        [1.0, 0.15, 0.1],
        [1.0, 1.0, 1.0],
        [0.15, 0.45, 1.0],
        [1.0, 0.8, 0.15],
      ],
    })
  }
}
