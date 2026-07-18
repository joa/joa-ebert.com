// G-buffer layout — shared by every writer (grass, ground, flower, text, bike,
// bird, flag, event mesh) and every reader (deferred lighting, bike/firefly
// lights, SSAO, DoF CoC).
//
//   @location(0) gAlbedo  rgba8unorm  rgb = albedo, a = matID / MAT_ID_MAX
//   @location(1) gNormal  rgba8unorm  rg  = octahedral normal, ba = payload
//   @location(2) gDepth   r32float    r   = NDC depth
//
// Two ideas keep this at three attachments while carrying more than it used to:
//
// 1. Surface constants (wrap, SSS, specular) are *not* stored per pixel. They
//    are a pure function of the material, so they live in materialFor()'s table
//    and only the genuinely per-pixel values ride in the two payload channels.
//    That is what freed a whole attachment.
//
// 2. The freed attachment became gDepth, a copy of the NDC depth the fragment
//    already computed. Readers reconstruct world position from it instead of
//    sampling the depth texture, so the depth buffer is never simultaneously
//    sampled and attached — which is what lets the deferred and forward halves
//    of the scene share a single render pass (see Renderer#renderScenePass).
//
// Normals are octahedral (Cigolle et al., "A Survey of Efficient Representations
// for Independent Unit Vectors", JCGT 2014): rg8 octahedral has lower worst-case
// error (~0.5°) than the rgb8 xyz encoding it replaces, so packing normals into
// two channels *improves* fidelity while freeing the other two for payload.

const MAT_GRASS = 0u;
const MAT_GROUND = 1u;
const MAT_TEXT = 2u;
const MAT_BIRD = 3u;
const MAT_BIKE = 4u;
const MAT_BIKE_LAMP = 5u;
const MAT_FLAG = 6u;
const MAT_EVENT = 7u;
const MAT_ID_MAX = 7.0;

// Per-pixel payload in gNormal.ba, interpreted per material:
//   GRASS      b = blade height ratio (0 at root, 1 at tip)
//   GROUND     b = crevice AO
//   TEXT       b = shininess / 256
//   BIKE       b = shininess / 256,  a = specular scale
//   BIKE_LAMP  b = emissive strength
//   EVENT      b = shininess / 256 (specular derived from it)
//   BIRD/FLAG  unused
const NO_PAYLOAD = vec2f(0.0);

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) depth: f32,
}

fn octWrap(v: vec2f) -> vec2f {
  return (1.0 - abs(v.yx)) * select(vec2f(-1.0), vec2f(1.0), v >= vec2f(0.0));
}

fn encodeNormalOct(n: vec3f) -> vec2f {
  let u = normalize(n);
  let p = u.xy * (1.0 / (abs(u.x) + abs(u.y) + abs(u.z)));
  return select(octWrap(p), p, u.z >= 0.0) * 0.5 + 0.5;
}

fn decodeNormalOct(e: vec2f) -> vec3f {
  let f = e * 2.0 - 1.0;
  let z = 1.0 - abs(f.x) - abs(f.y);
  let t = max(-z, 0.0);
  return normalize(vec3f(f + select(vec2f(t), vec2f(-t), f >= vec2f(0.0)), z));
}

fn encodeGBuffer(albedo: vec3f, matID: u32, normal: vec3f, payload: vec2f, ndcDepth: f32) -> GBufferOutput {
  return GBufferOutput(
    vec4f(albedo, f32(matID) / MAT_ID_MAX),
    vec4f(encodeNormalOct(normal), payload),
    ndcDepth,
  );
}

fn decodeMatID(albedoAlpha: f32) -> u32 {
  return u32(round(albedoAlpha * MAT_ID_MAX));
}

// Text, bike, flag and event meshes share one lighting path (wide-PCF shadows,
// contre-jour rim, sparkle, moon rim). They carry distinct IDs only because
// their surface constants and payloads differ.
fn isSolidSurface(matID: u32) -> bool {
  return matID == MAT_TEXT || matID == MAT_BIKE || matID == MAT_FLAG || matID == MAT_EVENT;
}

// Surface response constants. `shininess` is the legacy Phong exponent; the
// lighting pass gates specular off entirely when it lands near zero.
struct Material {
  shininess: f32,
  wrapFactor: f32,
  sssStrength: f32,
  specScale: f32,
}

fn materialFor(matID: u32, payload: vec2f) -> Material {
  let shininess = payload.x * 256.0;
  switch matID {
    case MAT_GRASS: { return Material(24.0, 0.0, 0.55, 0.28); }
    case MAT_GROUND: { return Material(20.0, 0.0, 0.0, 0.09); }
    case MAT_TEXT: { return Material(shininess, 0.5, 0.5, 0.9); }
    case MAT_BIKE: { return Material(shininess, 0.1, 0.0, payload.y); }
    case MAT_FLAG: { return Material(0.0, 0.2, 0.0, 0.0); }
    // Smooth event-mesh surfaces get proportionally more specular.
    case MAT_EVENT: { return Material(shininess, 0.05, 0.0, payload.x * 0.7); }
    default: { return Material(0.0, 0.0, 0.0, 0.0); }
  }
}
