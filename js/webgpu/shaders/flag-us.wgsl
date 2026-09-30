// US Flag
// #######
//
// Procedural albedo: 13 red/white horizontal stripes with a blue canton
// (top-left, 7/13 of height, 40% of width) containing 50 white stars
// arranged in alternating rows of 6 and 5.

#include "flag.inc.wgsl"

// Flag proportions per US specification (10:19 ratio normalised to [0,1]).
const CANTON_W = 0.4;       // blue canton width as fraction of flag width
const CANTON_H = 7.0 / 13.0; // blue canton height covers top 7 stripes

// Returns 1.0 if (u,v) lies inside a 5-pointed star centred at (cx,cy) with
// outer radius r.  Uses a simple cross-product winding test on the 10 edges.
fn inStar(u: f32, v: f32, cx: f32, cy: f32, r: f32) -> f32 {
  let p = vec2f(u - cx, v - cy);
  let d = length(p);
  if (d > r) { return 0.0; }

  // Inner radius of a regular 5-pointed star (ratio outer/inner ≈ 2.618)
  let ri = r / 2.618;
  // Build the 10 vertices of the star polygon
  var inside = true;
  for (var i = 0u; i < 5u; i++) {
    let a0 = (f32(i) * 2.0 - 0.5) * 3.14159265 / 5.0; // outer
    let a1 = (f32(i) * 2.0 + 0.5) * 3.14159265 / 5.0; // inner
    let a2 = (f32(i) * 2.0 + 1.5) * 3.14159265 / 5.0; // next outer
    let v0 = vec2f(cos(a0), sin(a0)) * r;
    let v1 = vec2f(cos(a1), sin(a1)) * ri;
    let v2 = vec2f(cos(a2), sin(a2)) * r;
    // Edge v0→v1
    let e01 = v1 - v0;
    let n01 = vec2f(-e01.y, e01.x);
    if (dot(n01, p - v0) < 0.0) { inside = false; }
    // Edge v1→v2
    let e12 = v2 - v1;
    let n12 = vec2f(-e12.y, e12.x);
    if (dot(n12, p - v1) < 0.0) { inside = false; }
  }
  return select(0.0, 1.0, inside);
}

fn flagAlbedo(uv: vec2f) -> vec3f {
  let u = uv.x;
  // uv.y = 0 at the top row (row 0, highest Y in world space), 1 at bottom
  let v = uv.y;

  // 13 equal-height stripes; even rows (0,2,...) are red — top stripe is red
  let stripe = u32(v * 13.0);
  let isRed = (stripe & 1u) == 0u;
  let red = vec3f(0.698, 0.133, 0.133);
  let white = vec3f(1.0, 1.0, 1.0);
  var col = select(white, red, isRed);

  // Blue canton: top-left quadrant (small v = near top, small u = near hoist)
  if (v < CANTON_H && u < CANTON_W) {
    col = vec3f(0.0, 0.165, 0.490);

    // 50 stars: rows of 6 and rows of 5, alternating (9 rows total, first has 6)
    let starAreaW = CANTON_W;
    let starAreaH = CANTON_H;
    let star_r = min(starAreaW, starAreaH) * 0.050;

    let su = u / starAreaW;
    let sv = v / starAreaH;

    // Row spacing: 9 rows in [0,1], centred between 0 and 1
    // Even rows (0,2,4,6,8): 6 stars spaced at 1/6 intervals, offset 1/12
    // Odd rows (1,3,5,7):    5 stars spaced at 1/5 intervals, offset 1/10
    let row = min(u32(sv * 9.0), 8u);
    let rowV = (f32(row) + 0.5) / 9.0 * starAreaH;

    let isEvenRow = (row & 1u) == 0u;
    if (isEvenRow) {
      // 6 stars per row
      for (var j = 0u; j < 6u; j++) {
        let starU = (f32(j) + 0.5) / 6.0 * starAreaW;
        let s = inStar(u, v, starU, rowV, star_r);
        if (s > 0.0) { col = white; }
      }
    } else {
      // 5 stars per row
      for (var j = 0u; j < 5u; j++) {
        let starU = (f32(j) + 0.5) / 5.0 * starAreaW;
        let s = inStar(u, v, starU, rowV, star_r);
        if (s > 0.0) { col = white; }
      }
    }
  }

  return col;
}
