// God Rays
// ########
//
// Radial light scattering from the sun screen position. Henyey-Greenstein
// phase function, depth-gated, with shadow map sampling.

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

struct GodRayUniforms {
  sunScreenPos: vec2f,
  godRayIntensity: f32,
  sunVisible: f32,
  godRaySteps: u32,
  shadowEnabled: f32,
  pad: vec2f,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> godray: GodRayUniforms;
@group(1) @binding(1) var sceneTexture: texture_2d<f32>;
@group(1) @binding(2) var depthTexture: texture_depth_2d;
@group(1) @binding(3) var shadowMap: texture_depth_2d;
@group(1) @binding(4) var cloudShadowTex: texture_2d<f32>;
@group(1) @binding(5) var linearSampler: sampler;
@group(1) @binding(6) var shadowSampler: sampler_comparison;

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

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

fn worldPosFromDepth(uv: vec2f, depth: f32) -> vec3f {
  let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let world = frame.invViewProjectionMatrix * clip;
  return world.xyz / world.w;
}

@fragment
fn fragmentMain(input: FullscreenVertexOutput) -> @location(0) vec4f {
  if (godray.sunVisible < 0.5 || godray.godRayIntensity < 0.005 ||
      godray.sunScreenPos.x < -0.5 || godray.sunScreenPos.x > 1.5 ||
      godray.sunScreenPos.y < -0.5 || godray.sunScreenPos.y > 1.5) {
    return vec4f(vec3f(0.0), 1.0);
  }

  const DECAY = 0.97;
  const WEIGHT = 0.018;
  const DENSITY = 0.90;

  var uv = input.texCoord;
  let stepCount = f32(godray.godRaySteps);
  let delta = (uv - godray.sunScreenPos) * (DENSITY / stepCount);

  let sceneDims = textureDimensions(sceneTexture);
  let depthDims = textureDimensions(depthTexture);

  // View direction for H-G phase function
  let fragDepthCoord = vec2i(vec2f(depthDims) * input.texCoord);
  let fragDepth = textureLoad(depthTexture, fragDepthCoord, 0);
  let fragWorld = worldPosFromDepth(input.texCoord, fragDepth);
  let viewDir = normalize(fragWorld - frame.cameraPosition);
  let cosTheta = dot(viewDir, normalize(frame.sunDirection));
  let phase = henyeyGreenstein(cosTheta, 0.7);
  let phaseScale = phase / henyeyGreenstein(1.0, 0.7);

  var illumination = 1.0;
  var color = vec3f(0.0);

  for (var i = 0u; i < godray.godRaySteps; i++) {
    uv -= delta;
    let suv = clamp(uv, vec2f(0.0), vec2f(1.0));

    let sampleCoord = vec2i(vec2f(depthDims) * suv);
    let depth = textureLoad(depthTexture, sampleCoord, 0);
    let sceneCoord = vec2i(vec2f(sceneDims) * suv);
    // The scene buffer is HDR — the sun disc reaches ~14×. This accumulator was
    // tuned against a 1.5-clamped scene and writes to an rgba8unorm target, so
    // cap the tap at the old ceiling to keep shaft energy stable.
    let sceneColor = min(textureLoad(sceneTexture, clamp(sceneCoord, vec2i(0), vec2i(sceneDims) - 1), 0).rgb, vec3f(1.5));

    let lum = dot(sceneColor, vec3f(0.2126, 0.7152, 0.0722));
    // Only the bright sky/sun emits light shafts; solid geometry (grass, text)
    // occludes them and contributes nothing. Emitting from lit geometry turned
    // sunlit foreground grass into a bright green vertical shaft — geometry must
    // block the crepuscular rays, never radiate them.
    var contrib = 0.0;
    if (depth >= 0.9999) {
      contrib = smoothstep(0.58, 0.78, lum);
    }
    color += sceneColor * contrib * illumination * WEIGHT;
    illumination *= DECAY;
  }

  color *= phaseScale * vec3f(1.15, 1.0, 0.75);

  return vec4f(color * godray.godRayIntensity, 1.0);
}
