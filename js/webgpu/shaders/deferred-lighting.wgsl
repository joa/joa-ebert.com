// Deferred Lighting
// #################
//
// Reads the G-buffer and produces the final lit image. Fullscreen vertex
// stage with per-material fragment lighting and debug visualization modes.

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

struct DeferredLightingUniforms {
  skyColor: vec3f,
  ambientIntensity: f32,
  colorTemperature: f32,
  shadowEnabled: f32,
  mountainVisibility: f32,
  moonFactor: f32,
  sparkleEnabled: f32,
  sparkleIntensity: f32,
  sparkleDensity: f32,
  sparkleSharpness: f32,
  sparkleSpeed: f32,
  cloudLightOcclusion: f32,
  debugMode: f32,
  pad: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

@group(1) @binding(0) var<uniform> lighting: DeferredLightingUniforms;
@group(1) @binding(1) var gAlbedoTex: texture_2d<f32>;
@group(1) @binding(2) var gNormalTex: texture_2d<f32>;
@group(1) @binding(3) var gMaterialTex: texture_2d<f32>;
@group(1) @binding(4) var depthTexture: texture_depth_2d;
@group(1) @binding(5) var shadowMap: texture_depth_2d;
@group(1) @binding(6) var cloudShadowTex: texture_2d<f32>;
@group(1) @binding(7) var linearSampler: sampler;
@group(1) @binding(8) var shadowSampler: sampler_comparison;

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

const SHADOW_SAMPLES: i32 = 16;
const SHADOW_RADIUS: f32 = 2.5;

const POISSON_DISK = array<vec2f, 16>(
  vec2f(-0.94201624, -0.39906216),
  vec2f( 0.94558609, -0.76890725),
  vec2f(-0.09418410, -0.92938870),
  vec2f( 0.34495938,  0.29387760),
  vec2f(-0.91588581,  0.45771432),
  vec2f(-0.81544232, -0.87912464),
  vec2f(-0.38277543,  0.27676845),
  vec2f( 0.97484398,  0.75648379),
  vec2f( 0.44323325, -0.97511554),
  vec2f( 0.53742981, -0.47373420),
  vec2f(-0.26496911, -0.41893023),
  vec2f( 0.79197514,  0.19090188),
  vec2f(-0.24188840,  0.99706507),
  vec2f(-0.81409955,  0.91437590),
  vec2f( 0.19984126,  0.78641367),
  vec2f( 0.14383161, -0.14100790)
);

fn shadowFactorRadius(worldPos: vec3f, radius: f32) -> f32 {
  if (lighting.shadowEnabled < 0.5) {
    return 1.0;
  }
  let lsPos = frame.lightSpaceMatrix * vec4f(worldPos, 1.0);
  let lsNDC = lsPos.xyz / lsPos.w;
  let shadowUV = vec2f(lsNDC.x * 0.5 + 0.5, 0.5 - lsNDC.y * 0.5);
  if (shadowUV.x < 0.0 || shadowUV.x > 1.0 ||
      shadowUV.y < 0.0 || shadowUV.y > 1.0 ||
      lsNDC.z < 0.0 || lsNDC.z > 1.0) {
    return 1.0;
  }
  let bias = 0.0003;
  let refDepth = lsNDC.z - bias;
  let smDims = vec2f(textureDimensions(shadowMap));
  
  // Interleaved hardware PCF with Poisson disk. 
  // Each textureSampleCompareLevel call performs 2x2 bilinear hardware comparison.
  // Using 16 Poisson samples provides high quality for large radii (like text) 
  // while being ~4x faster than manual 64-tap bilinear filtering.
  let angle = fract(sin(dot(worldPos.xz * 32.0, vec2f(127.1, 311.7))) * 43758.5453) * 6.2832;
  let cosA = cos(angle);
  let sinA = sin(angle);
  
  var shadow = 0.0;
  for (var i = 0; i < SHADOW_SAMPLES; i++) {
    let d = POISSON_DISK[i];
    let rotOffset = vec2f(d.x * cosA - d.y * sinA, d.x * sinA + d.y * cosA);
    let sampleUV = shadowUV + rotOffset * radius / smDims;
    shadow += textureSampleCompareLevel(shadowMap, shadowSampler, sampleUV, refDepth);
  }
  return shadow / f32(SHADOW_SAMPLES);
}

fn shadowFactorDefault(worldPos: vec3f) -> f32 {
  return shadowFactorRadius(worldPos, SHADOW_RADIUS);
}

fn cloudShadowFactor(worldPos: vec3f) -> f32 {
  let uv = clamp(worldPos.xz / 80.0 + 0.5, vec2f(0.0), vec2f(1.0));
  let dims = textureDimensions(cloudShadowTex);
  let coord = vec2i(uv * vec2f(dims));
  return textureLoad(cloudShadowTex, clamp(coord, vec2i(0), vec2i(dims) - 1), 0).r;
}

fn textSparkle(worldPos: vec3f, N: vec3f, H: vec3f) -> f32 {
  let cell = floor(worldPos * lighting.sparkleDensity);
  let ra = fract(sin(dot(cell, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
  let rb = fract(sin(dot(cell, vec3f(269.5, 183.3, 246.1))) * 43758.5453);
  let rc = fract(sin(dot(cell, vec3f(113.5, 89.9, 332.3))) * 43758.5453);
  let rd = fract(sin(dot(cell, vec3f(419.2, 371.1, 158.7))) * 43758.5453);
  let envelope = pow(max(sin(frame.time * lighting.sparkleSpeed + ra * 6.2832), 0.0), 8.0);
  let perturb = vec3f(rb * 2.0 - 1.0, rc * 2.0 - 1.0, rd * 2.0 - 1.0) * 0.4;
  let sparkleN = normalize(N + perturb);
  let spec = pow(max(dot(sparkleN, H), 0.0), lighting.sparkleSharpness * 128.0);
  return spec * envelope;
}

@fragment
fn fragmentMain(input: FullscreenVertexOutput) -> @location(0) vec4f {
  let uv = input.texCoord;
  let depthDims = textureDimensions(depthTexture);
  let depthCoord = vec2i(vec2f(depthDims) * uv);
  let depth = textureLoad(depthTexture, depthCoord, 0);

  let gDims = textureDimensions(gAlbedoTex);
  let gCoord = vec2i(vec2f(gDims) * uv);
  let gAlb = textureLoad(gAlbedoTex, gCoord, 0);
  let gNrm = textureLoad(gNormalTex, gCoord, 0);
  let gMat = textureLoad(gMaterialTex, gCoord, 0);

  // Debug output modes (enable via URL ?dbg=N):
  //   1 = depth as grayscale       (all white => depth read broken)
  //   2 = gAlbedo.rgb raw          (black => G-buffer color not written)
  //   3 = matID color key          (red/green/blue/yellow per material)
  //   4 = gNormal.rgb raw
  //   5 = gMaterial.rgb raw
  //   6 = shadow factor
  //   7 = solid magenta            (verifies shader runs at all)
  let dbg = i32(round(lighting.debugMode));
  if (dbg == 1) {
    let g = 1.0 - pow(depth, 16.0);
    return vec4f(vec3f(g), 1.0);
  } else if (dbg == 2) {
    return vec4f(gAlb.rgb, 1.0);
  } else if (dbg == 3) {
    let mid = i32(round(gAlb.a * 3.0));
    if (depth >= 0.9999) { return vec4f(vec3f(0.0), 1.0); }
    if (mid == 0) { return vec4f(0.0, 1.0, 0.0, 1.0); }
    if (mid == 1) { return vec4f(0.6, 0.4, 0.2, 1.0); }
    if (mid == 2) { return vec4f(1.0, 1.0, 1.0, 1.0); }
    if (mid == 3) { return vec4f(1.0, 0.0, 0.0, 1.0); }
    return vec4f(1.0, 0.0, 1.0, 1.0);
  } else if (dbg == 4) {
    return vec4f(gNrm.rgb, 1.0);
  } else if (dbg == 5) {
    return vec4f(gMat.rgb, 1.0);
  } else if (dbg == 7) {
    return vec4f(1.0, 0.0, 1.0, 1.0);
  }

  if (depth >= 0.9999) {
    return vec4f(vec3f(0.0), 1.0);
  }
  
  let albedo_raw = gAlb.rgb;
  let matID = i32(round(gAlb.a * 3.0));

  let N = normalize(gNrm.rgb * 2.0 - 1.0);
  let extraData = gNrm.a;

  let shininess = gMat.r * 256.0;
  let wrapFactor = gMat.g;
  let sssStr = gMat.b;
  let specScale = gMat.a;

  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let worldP4 = frame.invViewProjectionMatrix * ndc;
  let worldPos = worldP4.xyz / worldP4.w;

  let L = normalize(frame.sunDirection);
  let V = normalize(frame.cameraPosition - worldPos);
  let H = normalize(L + V);

  // Bird: flat ambient, no shading
  if (matID == 3) {
    return vec4f(albedo_raw * lighting.ambientIntensity, 1.0);
  }

  var albedo = albedo_raw;

  // Grass uses view-dependent fake normal for diffuse
  var diffN = N;
  if (matID == 0) {
    diffN = normalize(mix(vec3f(0.0, 1.0, 0.0), V, 0.15));
  }

  let NdotL = max(dot(diffN, L), 0.0);
  let NdotUp = max(dot(diffN, vec3f(0.0, 1.0, 0.0)), 0.0);
  let wrapNdotL = max((NdotL + wrapFactor) / (1.0 + wrapFactor), 0.0);

  // Text uses wider PCF radius
  var shadow: f32;
  if (matID == 2) {
    shadow = shadowFactorRadius(worldPos, 12.0);
  } else {
    shadow = shadowFactorDefault(worldPos);
  }
  let cloudShadow = cloudShadowFactor(worldPos);

  let lit = shadow * cloudShadow * lighting.mountainVisibility * lighting.cloudLightOcclusion;

  // Ground micro-AO
  var microAO = 1.0;
  var creviceAO = 1.0;
  if (matID == 1) {
    let NdotUpBump = max(dot(N, vec3f(0.0, 1.0, 0.0)), 0.0);
    microAO = 0.74 + 0.26 * NdotUpBump;
    creviceAO = extraData;
    albedo *= microAO * creviceAO;
  }

  // Ambient
  let skyBlend = NdotUp * 0.25;
  let ambientLight = mix(vec3f(1.0), lighting.skyColor, skyBlend) * lighting.ambientIntensity;
  var ambient = albedo * ambientLight;
  if (matID == 1) {
    ambient *= microAO * creviceAO;
  }

  // Diffuse
  let diffBase = albedo * lit * wrapNdotL;
  var diffuseColor: vec3f;
  if (matID == 0) {
    diffuseColor = diffBase * (1.0 - lighting.ambientIntensity) * 0.85;
  } else if (matID == 1) {
    diffuseColor = diffBase * (1.0 - lighting.ambientIntensity) * 0.80;
  } else {
    diffuseColor = diffBase;
  }

  var color = ambient + diffuseColor;

  // Specular
  if (shininess > 0.5 && specScale > 0.0) {
    let spec = pow(max(dot(N, H), 0.0), shininess);
    let ambGate = select(lighting.ambientIntensity, 1.0, matID == 2);
    let heightMask = select(1.0, smoothstep(0.2, 0.85, extraData), matID == 0);
    let specColor = select(vec3f(1.0), vec3f(0.88, 0.97, 0.72), matID == 0);
    color += specColor * spec * lit * ambGate * heightMask * specScale;
  }

  // SSS
  if (sssStr > 0.0) {
    let forward = pow(max(dot(-L, V), 0.0), 3.0);
    if (matID == 0) {
      let sssH = smoothstep(0.25, 1.0, extraData);
      color += vec3f(0.95, 0.78, 0.22) * forward * lit * sssStr * lighting.ambientIntensity * sssH;
      let transForward = pow(max(dot(-L, V), 0.0), 8.0);
      color += vec3f(0.6, 0.9, 0.2) * transForward * lit * sssH * 0.4;
    } else if (matID == 2) {
      let sssGate = smoothstep(0.0, 0.12, L.y) * min(1.0, L.y / 0.1);
      let backBleed = max(-dot(N, L) + 0.2, 0.0) * 0.35;
      color += vec3f(1.0, 0.82, 0.55) * (forward * 0.5 + backBleed) * lit * sssGate;
    }
  }

  // Text sparkles
  if (matID == 2 && lighting.sparkleEnabled > 0.5) {
    let sparkle = textSparkle(worldPos, N, H);
    color += vec3f(1.0, 0.97, 0.88) * sparkle * lighting.sparkleIntensity * lit;
  }

  // Moon light for text
  if (matID == 2 && lighting.moonFactor > 0.0) {
    let Lm = normalize(frame.moonDirection);
    let moonColor = vec3f(0.72, 0.82, 1.0);
    let moonLit = cloudShadow * lighting.mountainVisibility * lighting.cloudLightOcclusion;
    let NdotLm = max(dot(N, Lm), 0.0);
    let wrapNdotLm = max((NdotLm + wrapFactor) / (1.0 + wrapFactor), 0.0);
    color += albedo * moonColor * wrapNdotLm * lighting.moonFactor * 0.35 * moonLit;
    let Hm = normalize(Lm + V);
    let specM = pow(max(dot(N, Hm), 0.0), shininess);
    color += moonColor * specM * lighting.moonFactor * 0.28 * specScale * moonLit;
    let forwardM = pow(max(dot(-Lm, V), 0.0), 3.0);
    let backBleedM = max(-dot(N, Lm) + 0.2, 0.0) * 0.3;
    let moonGate = smoothstep(0.0, 0.08, Lm.y) * lighting.moonFactor;
    color += vec3f(0.6, 0.72, 1.0) * (forwardM * 0.25 + backBleedM) * moonGate * sssStr * moonLit;
  }

  // Color temperature (skip at neutral to avoid per-pixel coefficient computation)
  if (abs(lighting.colorTemperature) > 0.001) {
    let rCoeff = select(0.06, 0.10, matID == 0);
    let gCoeff = select(0.03, 0.05, matID == 0);
    let bCoeff = select(0.06, 0.10, matID == 0);
    if (lighting.colorTemperature > 0.0) {
      color.r += lighting.colorTemperature * rCoeff;
      color.g += lighting.colorTemperature * gCoeff;
    } else {
      color.b -= lighting.colorTemperature * bCoeff;
      if (matID == 0) {
        color.r += lighting.colorTemperature * 0.05;
      }
    }
  }

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
