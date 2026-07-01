const EVENTS = [
  {
    id: "fourth-of-july",
    activeRanges: [{ month: 7, dayStart: 1, dayEnd: 7 }],
    loader: () => import("./fourth-of-july/index.js"),
  },
  /*{
    id: "world-cup-2026",
    activeRanges: [
      { month: 6, dayStart: 11, dayEnd: 30 },
      { month: 7, dayStart: 1, dayEnd: 19 },
    ],
    loader: () => import("./world-cup/index.js"),
  },*/
]

function isEventActive(event, date) {
  const month = date.getMonth() + 1
  const day = date.getDate()
  return event.activeRanges.some(r => r.month === month && day >= r.dayStart && day <= r.dayEnd)
}

export async function loadActiveModules(gpu, renderAPI) {
  const today = new Date()
  const active = EVENTS.filter(e => isEventActive(e, today))
  const modules = await Promise.all(
    active.map(async e => {
      const { default: EventClass } = await e.loader()
      const mod = new EventClass()
      await mod.init(gpu, renderAPI)
      return mod
    })
  )
  return modules
}
