// Deferred Lighting
// #################
//
// Reads the G-buffer and produces the final lit image. Fullscreen vertex
// stage with per-material fragment lighting and debug visualization modes.
//
// Pipeline-overridable constant — set to 1 in the mobile scene pipeline so that
// background pixels are discarded rather than written black. This lets the sky
// (drawn as the first draw call in the same pass) show through without needing
// a separate forward pass or depthReadOnly (which Safari/Metal silently breaks).
override skipBackground: i32 = 0;

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
  emissiveIntensity: f32,
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

const PI: f32 = 3.14159265;
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

// Cook-Torrance GGX specular with Smith geometry and Schlick Fresnel. Replaces
// the old Blinn-Phong lobe: energy-shaped highlights with a grazing-angle
// Fresnel rise, which is the difference between "real surface" and "CG plastic".
// NdotL cancels against the BRDF denominator, so the returned term is the
// specular *radiance* factor (multiply by light colour outside).
fn ggxSpecular(N: vec3f, V: vec3f, L: vec3f, roughness: f32, F0: f32) -> f32 {
  let NdotL = dot(N, L);
  if (NdotL <= 0.0) {
    return 0.0;
  }
  let H = normalize(L + V);
  let NdotH = max(dot(N, H), 0.0);
  let NdotV = max(dot(N, V), 1e-3);
  let VdotH = max(dot(V, H), 0.0);
  let a = roughness * roughness;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * d * d);
  let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  let gv = NdotV / (NdotV * (1.0 - k) + k);
  let gl = NdotL / (NdotL * (1.0 - k) + k);
  let F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
  return min(D * gv * gl * F / (4.0 * NdotV), 8.0);
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
    // When skipBackground is set the sky was drawn before this pass; discard so
    // it shows through. Otherwise return black (forward pass draws sky on top).
    if (skipBackground != 0) { discard; }
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

  // Emissive bike lights: the head/tail lights carry a per-vertex emissive
  // strength in extraData (0 for every other matID-2 surface, i.e. text). Emit
  // the lamp colour directly, scaled past the LDR ceiling so bloom picks it up.
  if (matID == 2 && extraData > 0.001) {
    return vec4f(albedo_raw * extraData * lighting.emissiveIntensity, 1.0);
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
  var sunFacing = 1.0;
  if (matID == 2) {
    shadow = shadowFactorRadius(worldPos, 12.0);
    // Faces turned away from the sun are geometrically self-shadowed. This gate
    // is applied to the *direct sun* only (below), not to the skylight, so the
    // noisy wide-PCF samples stop dappling the unlit side while that side still
    // receives sky fill — otherwise back faces read as flat black.
    sunFacing = smoothstep(-0.05, 0.30, dot(N, L));
  } else {
    shadow = shadowFactorDefault(worldPos);
  }
  let cloudShadow = cloudShadowFactor(worldPos);

  // Cast-shadow visibility (drives the skylight tint) vs. direct-sun reception
  // (additionally excludes self-shadowed back faces). For non-text sunFacing is
  // 1, so the two are identical there.
  let lit = shadow * cloudShadow * lighting.mountainVisibility * lighting.cloudLightOcclusion;
  let sunLit = lit * sunFacing;

  // Ground micro-AO
  var microAO = 1.0;
  var creviceAO = 1.0;
  if (matID == 1) {
    let NdotUpBump = max(dot(N, vec3f(0.0, 1.0, 0.0)), 0.0);
    microAO = 0.74 + 0.26 * NdotUpBump;
    creviceAO = extraData;
    albedo *= microAO * creviceAO;
  }

  // Outdoor light is two-toned: a warm direct sun plus a cool blue skylight that
  // fills the shadows. The sun warms as it drops toward the horizon (golden hour).
  let sunLow = (1.0 - smoothstep(0.0, 0.35, frame.sunDirection.y)) * frame.sunAboveHorizon;
  let sunColor = mix(vec3f(1.0, 0.99, 0.97), vec3f(1.0, 0.62, 0.34), sunLow);

  // Ambient — geometry shadow bleeds into the ambient floor so contrast survives
  // high ambientIntensity settings (without this, shadow/lit ratio collapses to ~17%).
  // Cool skylight fill: a luminance-preserving hue shift toward the sky colour so
  // shadows read blue rather than neutral grey, pushed stronger in shadow and on
  // up-facing surfaces (which see more open sky).
  let skyLuma = max(dot(lighting.skyColor, vec3f(0.2126, 0.7152, 0.0722)), 0.001);
  let coolFill = clamp(lighting.skyColor / skyLuma, vec3f(0.0), vec3f(1.5));
  // Blue fill is strongest where the surface is unlit (in shade / facing away
  // from the sun) and on up-facing surfaces that see more open sky.
  let fillAmt = clamp(mix(0.75, 0.12, sunLit) + 0.12 * NdotUp, 0.0, 0.9);
  // Hemispheric form: up-facing surfaces see more of the open sky dome than
  // down-facing ones, so the skylight fill varies with the surface normal. This
  // is what gives shaded faces their shape instead of reading as a flat wash.
  let hemi = mix(0.6, 1.0, NdotUp);
  let ambientLight = mix(vec3f(1.0), coolFill, fillAmt) * lighting.ambientIntensity * hemi;
  // Trust the sun shadow map for the ambient occlusion floor only where the face
  // actually sees the sun. On self-shadowed back faces the wide-PCF samples are
  // pure acne, so fade to unoccluded sky fill there — clean, and correct, since a
  // face turned away from the sun isn't occluded from the sky.
  let castShadow = mix(1.0, shadow, sunFacing);
  let ambientShadow = mix(0.38, 1.0, castShadow);
  var ambient = albedo * ambientLight * ambientShadow;
  if (matID == 1) {
    ambient *= microAO * creviceAO;
  }

  // Diffuse — sun contribution uses a gentler coupling to ambientIntensity so
  // direct light remains meaningful even at high ambient values
  let sunScale = max(1.0 - lighting.ambientIntensity * 0.6, 0.25);
  let diffBase = albedo * sunLit * wrapNdotL * sunColor;
  var diffuseColor: vec3f;
  if (matID == 0) {
    diffuseColor = diffBase * sunScale * 0.85;
  } else if (matID == 1) {
    diffuseColor = diffBase * sunScale * 0.80;
  } else {
    diffuseColor = diffBase;
  }

  var color = ambient + diffuseColor;

  // Specular — physically-based GGX. Roughness derived from the legacy Phong
  // exponent so no G-buffer change is needed (grass ~0.28, ground ~0.30, text
  // ~0.16); specScale stays the per-material strength control.
  if (shininess > 0.5 && specScale > 0.0) {
    let roughness = clamp(sqrt(2.0 / (shininess + 2.0)), 0.05, 1.0);
    let spec = ggxSpecular(N, V, L, roughness, 0.04);
    let ambGate = select(lighting.ambientIntensity, 1.0, matID == 2);
    let heightMask = select(1.0, smoothstep(0.2, 0.85, extraData), matID == 0);
    let specColor = select(vec3f(1.0), vec3f(0.88, 0.97, 0.72), matID == 0);
    color += specColor * sunColor * spec * sunLit * ambGate * heightMask * specScale;
  }

  // Grass grazing-angle sky sheen: a cool silvery rim on the blade tips — the
  // shimmer of a real windblown meadow. It is a backlight effect (light coming
  // through the blades toward the eye), so the backlit gate keeps it near-zero at
  // overhead noon and reveals it at low sun, where it is physically real. Added
  // as light so it never greys the albedo.
  if (matID == 0) {
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    let sheenHeight = smoothstep(0.35, 0.95, extraData);
    let backlit = pow(max(dot(-L, V), 0.0), 3.0);
    let skySheen = mix(vec3f(1.0), coolFill, 0.5) * skyLuma;
    color += skySheen * fresnel * sheenHeight * backlit * 0.6 * lit;
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

  // Contre-jour rim on the letters. When the sun sits behind the text its
  // camera-facing faces fall into self-shadow (sunFacing → 0 above) yet the
  // form should not read as a flat filled slab — light wraps its edges. A
  // view-grazing Fresnel, gated by how back-lit the fragment is (sun opposite
  // the view direction) and by cast-shadow visibility, adds that bright rim, and
  // the sky fill on the shaded front is pulled down so the silhouette reads dark
  // against the bright sky. This is the "lit silhouette + rim" of real contre-jour.
  if (matID == 2) {
    let rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    let backlit = smoothstep(0.0, -0.55, dot(V, L));
    let rimVis = shadow * cloudShadow * lighting.mountainVisibility * lighting.cloudLightOcclusion;
    color += sunColor * rim * backlit * rimVis * 1.4 * frame.sunAboveHorizon;
    color *= 1.0 - backlit * (1.0 - sunFacing) * 0.35;
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
