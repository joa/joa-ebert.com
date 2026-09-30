// German Flag
// ###########
//
// Procedural albedo: three equal horizontal bands, black / red / gold
// (Bundesflagge, 3:5). Colors follow the federal design spec's sRGB values;
// black is lifted slightly because real dyed cloth never reaches zero albedo.

#include "flag.inc.wgsl"

fn flagAlbedo(uv: vec2f) -> vec3f {
  let black = vec3f(0.03, 0.03, 0.03);
  let red = vec3f(0.867, 0.0, 0.0);
  let gold = vec3f(1.0, 0.808, 0.0);
  // uv.y = 0 at the top edge
  let band = min(u32(uv.y * 3.0), 2u);
  return select(select(gold, red, band == 1u), black, band == 0u);
}
