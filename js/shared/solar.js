// NOAA Solar Calculator — accurate to within ~0.01°
// https://gml.noaa.gov/grad/solcalc/calcdetails.html
// Coordinate system: +x = east, +y = up, +z = south

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

export const LOCATION_LAT = 52.0363289
export const LOCATION_LNG = 8.482794

export function solarElevationAzimuth(date) {
  const jd = date.getTime() / 86400000 + 2440587.5
  const jc = (jd - 2451545) / 36525

  const l0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)

  const mRad = m * DEG2RAD
  const c =
    Math.sin(mRad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * mRad) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * mRad) * 0.000289

  const sunAppLon = l0 + c - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * DEG2RAD)

  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
  const obliqRad = (meanObliq + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * DEG2RAD)) * DEG2RAD
  const sunAppLonRad = sunAppLon * DEG2RAD

  const decl = Math.asin(Math.sin(obliqRad) * Math.sin(sunAppLonRad))

  const y = Math.tan(obliqRad / 2) ** 2
  const l0Rad = l0 * DEG2RAD
  const eotMin =
    4 *
    RAD2DEG *
    (y * Math.sin(2 * l0Rad) -
      2 * e * Math.sin(mRad) +
      4 * e * y * Math.sin(mRad) * Math.cos(2 * l0Rad) -
      0.5 * y * y * Math.sin(4 * l0Rad) -
      1.25 * e * e * Math.sin(2 * mRad))

  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const ha = ((utcMin + eotMin + 4 * LOCATION_LNG) / 4 - 180) * DEG2RAD

  const latRad = LOCATION_LAT * DEG2RAD
  const cosZenith = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(ha)
  const zenithRad = Math.acos(Math.max(-1, Math.min(1, cosZenith)))
  const sinZenith = Math.sin(zenithRad)

  const elevationDeg = 90 - zenithRad * RAD2DEG

  let azimuthDeg = 0
  if (sinZenith > 1e-10) {
    const cosAz = (Math.sin(latRad) * cosZenith - Math.sin(decl)) / (Math.cos(latRad) * sinZenith)
    const az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * RAD2DEG
    azimuthDeg = ha > 0 ? (az + 180) % 360 : (540 - az) % 360
  }

  return { elevationDeg, azimuthDeg }
}

export function solarDirection(elevationDeg, azimuthDeg) {
  const el = elevationDeg * DEG2RAD
  const az = azimuthDeg * DEG2RAD
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: -Math.cos(el) * Math.cos(az),
  }
}

// Returns a Date adjusted so that local time = localHour, using current timezone offset.
export function dateForLocalHour(localHour) {
  const now = new Date()
  const utcOffsetMin = -now.getTimezoneOffset()
  const utcHour = localHour - utcOffsetMin / 60
  const d = new Date(now)
  d.setUTCHours(Math.floor(utcHour), Math.round((utcHour % 1) * 60), 0, 0)
  return d
}
