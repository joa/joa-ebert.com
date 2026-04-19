// Firefly Lights
// ##############
//
// Fullscreen deferred lighting pass for firefly point lights (additive).

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

struct FireflyLightUniforms {
  fireflyCount: u32,
  fireflyFactor: f32,
  lightRadius: f32,
  pad: f32,
  fireflyData: array<vec4f, 32>, // xyz = position, w = brightness
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> firefly: FireflyLightUniforms;
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
  if (firefly.fireflyCount == 0u) {
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
  let normalEncoded = textureLoad(gNormalTex, gCoord, 0).rgb;
  let N = normalize(normalEncoded * 2.0 - 1.0);

  let ndc = vec4f(input.texCoord.x * 2.0 - 1.0, 1.0 - input.texCoord.y * 2.0, depth, 1.0);
  let worldP4 = frame.invViewProjectionMatrix * ndc;
  let worldPos = worldP4.xyz / worldP4.w;

  let lightColor = vec3f(0.55, 1.0, 0.25);
  let invRadius = 1.0 / max(firefly.lightRadius, 0.001);

  var accumulated = vec3f(0.0);
  for (var i = 0u; i < firefly.fireflyCount; i++) {
    let data = firefly.fireflyData[i];
    let lightPos = data.xyz;
    let brightness = data.w;

    let toLight = lightPos - worldPos;
    let dist = length(toLight);
    if (dist >= firefly.lightRadius) {
      continue;
    }
    let L = toLight / dist;
    let NdotL = max(dot(N, L), 0.0);
    let t = 1.0 - dist * invRadius;
    accumulated += albedo * lightColor * NdotL * (t * t) * brightness * firefly.fireflyFactor;
  }

  return vec4f(accumulated, 1.0);
}
