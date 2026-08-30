// Mountain Panorama Bake
// ######################
//
// Renders the mountain heightfield march into a lat-long strip (u = azimuth,
// v = dir.y over [PANO_Y_MIN, PANO_Y_MAX]) so the per-pixel sky pass can
// replace its 64-step march with a single texture sample. Re-recorded only
// when sun, camera, or atmosphere actually change — see
// Renderer#mountainPanoBakeNeeded.

#include "sky-common.inc.wgsl"

struct PanoVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> PanoVertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return PanoVertexOutput(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}

@fragment
fn fragmentMain(input: PanoVertexOutput) -> @location(0) vec4f {
  let azimuthRad = (input.texCoord.x - 0.5) * 2.0 * PI;
  let dirY = PANO_Y_MAX - input.texCoord.y * (PANO_Y_MAX - PANO_Y_MIN);
  let horiz = sqrt(max(1.0 - dirY * dirY, 1e-4));
  let dir = vec3f(sin(azimuthRad) * horiz, dirY, cos(azimuthRad) * horiz);
  let m = renderMountains(frame.cameraPosition, dir, frame.sunDirection);
  // Premultiplied: silhouette-edge texels bilinear-blend against black instead
  // of an arbitrary colour; the sky pass un-premultiplies after sharpening.
  return vec4f(m.rgb * m.a, m.a);
}
