// Bike Lights (cast)
// ##################
//
// Fullscreen deferred pass that adds the bike's head- and tail-light as real
// point lights, so their glow spills red/white onto the text, the bike frame,
// and the ground around it. Additive, like the firefly light pass. The lamp
// lenses themselves are emitted by the deferred pass (emissive) — this only
// lights the surrounding surfaces.

struct FrameUniforms {
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  invProjectionMatrix: mat4x4f,
  invViewMatrix: mat4x4f,
  viewProjectionMatrix: mat4x4f,
  invViewProjectionMatrix: mat4x4f,
  prevViewProjectionMatrix: mat4x4f,
  lightSpaceMatrix: mat4x4f,
  cameraPosition: vec3f,
  time: f32,
  sunDirection: vec3f,
  windTime: f32,
  moonDirection: vec3f,
  windStrength: f32,
  windDirection: vec2f,
  resolution: vec2f,
  sunAboveHorizon: f32,
  near: f32,
  far: f32,
  deltaTime: f32,
  cursorWorldPos: vec3f,
  cursorRadius: f32,
}

struct BikeLightUniforms {
  count: u32,
  intensity: f32,   // master cast-light strength (day/night fade)
  pad0: f32,
  pad1: f32,
  pos: array<vec4f, 2>,   // xyz = world position, w = reach
  color: array<vec4f, 2>, // rgb = radiant colour, w = per-lamp intensity
  dir: array<vec4f, 2>,   // xyz = world beam axis (normalised), w = cos(cone half-angle); w > 1 = omni
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> lights: BikeLightUniforms;
@group(1) @binding(1) var gAlbedoTex: texture_2d<f32>;
@group(1) @binding(2) var gAlbedoSampler: sampler;
@group(1) @binding(3) var gNormalTex: texture_2d<f32>;
@group(1) @binding(4) var gNormalSampler: sampler;
@group(1) @binding(5) var depthTex: texture_depth_2d;
@group(1) @binding(6) var depthSampler: sampler;

struct FullscreenVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return FullscreenVertexOutput(
    vec4f(uv * 2.0 - 1.0, 0.0, 1.0),
    vec2f(uv.x, 1.0 - uv.y),
  );
}

@fragment
fn fragmentMain(input: FullscreenVertexOutput) -> @location(0) vec4f {
  if (lights.count == 0u) {
    return vec4f(0.0);
  }

  let depthDims = textureDimensions(depthTex);
  let depthCoord = vec2i(vec2f(depthDims) * input.texCoord);
  let depth = textureLoad(depthTex, depthCoord, 0);
  if (depth >= 0.9999) {
    return vec4f(0.0);
  }

  let gDims = textureDimensions(gAlbedoTex);
  let gCoord = vec2i(vec2f(gDims) * input.texCoord);
  let albedo = textureLoad(gAlbedoTex, gCoord, 0).rgb;
  let N = normalize(textureLoad(gNormalTex, gCoord, 0).rgb * 2.0 - 1.0);

  let ndc = vec4f(input.texCoord.x * 2.0 - 1.0, 1.0 - input.texCoord.y * 2.0, depth, 1.0);
  let worldP4 = frame.invViewProjectionMatrix * ndc;
  let worldPos = worldP4.xyz / worldP4.w;

  var accumulated = vec3f(0.0);
  for (var i = 0u; i < lights.count; i++) {
    let reach = lights.pos[i].w;
    let toLight = lights.pos[i].xyz - worldPos;
    let dist = length(toLight);
    if (dist >= reach) {
      continue;
    }
    let L = toLight / max(dist, 1e-4);
    // Wrapped diffuse: a lamp this close reads better with a soft terminator than
    // a hard Lambert cut, and it keeps the frame tubes lit around their curve.
    let ndl = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    let t = 1.0 - dist / reach;
    // Spot cone: the headlight only lights surfaces inside its beam. -L is the
    // direction from the lamp toward the surface. w > 1 (omni) skips the cone.
    var spot = 1.0;
    let coneCos = lights.dir[i].w;
    if (coneCos <= 1.0) {
      let cd = dot(-L, lights.dir[i].xyz);
      let inner = mix(coneCos, 1.0, 0.4);
      spot = smoothstep(coneCos, inner, cd);
    }
    accumulated += albedo * lights.color[i].rgb * lights.color[i].w
                 * ndl * (t * t) * spot * lights.intensity;
  }

  return vec4f(accumulated, 1.0);
}
