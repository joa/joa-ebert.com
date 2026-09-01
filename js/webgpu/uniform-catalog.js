// Uniform Catalog
// ###############
//
// Every uniform buffer in the renderer: its WGSL struct, its byte layout and
// the size the renderer allocates for it. Documentation and source of truth —
// `UNIFORM_BYTES` at the bottom is what `renderer.js` allocates from, so a size
// can only change here, next to the layout it belongs to.
//
// WGSL alignment rules that drive every offset below: vec3f aligns to 16 but
// occupies 12, so a following f32 packs into the same 16-byte slot; vec2f
// aligns to 8; a struct's size rounds up to its largest member alignment.
//
// - Group 0: FrameUniforms (shared by every pass, written once per frame)
// - Group 1: per-pass resources (textures, samplers, pass-specific uniforms)
// - Group 3: per-object uniforms (text and bike model matrices)
//
// Where a buffer is larger than its struct the surplus is padding the renderer
// never writes; the note says so.

// GROUP 0: Per-frame uniforms
// ###########################
//
// struct FrameUniforms {
//   projectionMatrix:         mat4x4f,  // offset   0
//   viewMatrix:               mat4x4f,  // offset  64
//   invProjectionMatrix:      mat4x4f,  // offset 128
//   invViewMatrix:            mat4x4f,  // offset 192
//   viewProjectionMatrix:     mat4x4f,  // offset 256
//   invViewProjectionMatrix:  mat4x4f,  // offset 320
//   prevViewProjectionMatrix: mat4x4f,  // offset 384
//   lightSpaceMatrix:         mat4x4f,  // offset 448
//   cameraPosition:           vec3f,    // offset 512
//   time:                     f32,      // offset 524  (packs into the vec3f slot)
//   sunDirection:             vec3f,    // offset 528
//   windTime:                 f32,      // offset 540
//   moonDirection:            vec3f,    // offset 544
//   windStrength:             f32,      // offset 556
//   windDirection:            vec2f,    // offset 560
//   resolution:               vec2f,    // offset 568
//   sunAboveHorizon:          f32,      // offset 576
//   near:                     f32,      // offset 580
//   far:                      f32,      // offset 584
//   deltaTime:                f32,      // offset 588
//   cursorWorldPos:           vec3f,    // offset 592
//   cursorRadius:             f32,      // offset 604
// }
//
// Struct 608 bytes, buffer 640. Written by writeFrameUniforms() in gpu-updates.js,
// which repeats these offsets as float indices — keep the two in sync.
//
// Source of each value in the render loop:
//
//   projectionMatrix … lightSpaceMatrix  ← the matching ctx.* matrix
//   cameraPosition                       ← ctx.cameraPosition (camera.position)
//   time                                 ← ctx.nowSec
//   sunDirection                         ← ctx.sunDirection
//   windTime / windStrength / windDirection ← windSystem.uniforms
//   moonDirection                        ← timeInfo.moonPosition
//   resolution                           ← [ctx.width, ctx.height]
//   sunAboveHorizon                      ← max(0, timeInfo.sunPosition.y)
//   near / far                           ← NEAR (0.01) / FAR (1000)
//   deltaTime                            ← ctx.deltaTime (milliseconds)
//   cursorWorldPos / cursorRadius        ← ctx.cursorWorldPos / ctx.cursorActive

// GROUP 1: Per-pass uniforms
// ##########################

// Shadow pass (grass alpha cutout)
// struct ShadowUniforms {
//   alphaThreshold: f32,
//   pad:            vec3f,
// }
// Struct 16 bytes, buffer 32. Textures: windNoise + sampler.

// Grass pass
// struct GrassUniforms {
//   grassHeightFactor: f32,
//   grassWidthFactor:  f32,
//   alphaThreshold:    f32,
//   dewAmount:         f32,  // 0 = none, 1 = full dew (morning tint at blade tips)
// }
// Textures: windNoise + sampler.

// Flower pass
// struct FlowerUniforms {
//   sway:           f32,
//   alphaThreshold: f32,
//   heightFactor:   f32,   // follows grassHeightFactor so flowers scale with grass
//   pad1:           f32,
// }
// Textures: windNoise + sampler.

// Ground pass — no uniform buffer; heightmap texture + sampler only.

// Bird pass (shared by the G-buffer and shadow bird pipelines)
// struct BirdUniforms {
//   birdColor:     vec3f,
//   wingAmplitude: f32,
//   wingBeat:      f32,
//   birdScale:     f32,
//   pad:           vec2f,
// }

// Deferred lighting pass
// struct DeferredLightingUniforms {
//   skyColor:            vec3f,
//   ambientIntensity:    f32,
//   colorTemperature:    f32,
//   shadowEnabled:       f32,   // 0 when the sun is below the horizon
//   mountainVisibility:  f32,
//   moonFactor:          f32,
//   sparkleEnabled:      f32,
//   sparkleIntensity:    f32,
//   sparkleDensity:      f32,
//   sparkleSharpness:    f32,
//   sparkleSpeed:        f32,
//   cloudLightOcclusion: f32,
//   debugMode:           f32,   // ?dbg=N URL param, 0 = normal
//   emissiveIntensity:   f32,   // bike head/tail lamp glow multiplier
// }
// Textures: gAlbedo, gNormal, gDepth, shadowMap, cloudShadow + comparison sampler.

// Firefly lights pass (fullscreen additive)
// struct FireflyLightUniforms {
//   fireflyCount:  u32,
//   fireflyFactor: f32,
//   lightRadius:   f32,
//   pad:           f32,
//   fireflyData:   array<vec4f, 32>,  // offset 16: xyz position, w brightness
// }
// Textures: gAlbedo, gNormal, gDepth + non-filtering samplers.

// Bike lights pass (head/tail lamps cast onto the scene, fullscreen additive)
// struct BikeLightUniforms {
//   count:     u32,
//   intensity: f32,              // master cast strength (day/night fade)
//   pad0:      f32,
//   pad1:      f32,
//   pos:       array<vec4f, 2>,  // offset  16: xyz world position, w reach
//   color:     array<vec4f, 2>,  // offset  48: rgb colour, w per-lamp intensity
//   dir:       array<vec4f, 2>,  // offset  80: xyz beam axis, w cos(half-angle), > 1 = omni
// }
// Textures: gAlbedo, gNormal, gDepth + non-filtering samplers.

// Sky pass
// struct SkyUniforms {
//   zenithColor:      vec3f,   // offset   0
//   sunIntensity:     f32,     // offset  12
//   horizonColor:     vec3f,   // offset  16
//   cloudBase:        f32,     // offset  28
//   cloudTop:         f32,     // offset  32
//   cloudCoverage:    f32,     // offset  36
//   cloudSigmaE:      f32,     // offset  40
//   cloudSteps:       u32,     // offset  44
//   cloudShadowSteps: u32,     // offset  48
//   moonPhase:        f32,     // offset  52
//   chemtrailCount:   u32,     // offset  56
//   chemtrailOpacity: f32,     // offset  60
//   chemtrailWidth:   f32,     // offset  64
//   turbidity:        f32,     // offset  68
//   overcast:         f32,     // offset  72
//   pad:              f32,     // offset  76
//   pYz … pEy:        21 × f32,// offset  80: Preetham coefficients, see atmo.js
//   mountainSteps:    u32,     // offset 164
//   cloudClumping:    f32,     // offset 168: coverage swing between weather cells
//   cloudClumpScale:  f32,     // offset 172: weather cell size in world units
// }
// Textures: mountainHeightmap + 3D noise + samplers.

// Rain pass
// struct RainUniforms {
//   rainIntensity: f32,
//   pad:           vec3f,
// }
// Struct 16 bytes, buffer 32. Drop positions come from the instance stream.

// Particle pass
// struct ParticleUniforms {
//   ambientIntensity: f32,
//   pad:              vec3f,
// }
// Struct 16 bytes, buffer 32.

// Firefly sprite pass
// struct FireflySpriteUniforms {
//   fireflyFactor: f32,
//   pad:           vec3f,
// }
// Struct 16 bytes, buffer 32.

// Insect pass (flies and bees share the pipeline, one buffer each)
// struct InsectUniforms {
//   color:     vec3f,
//   opacity:   f32,   // baseOpacity × day visibility
//   sizeScale: f32,
//   kind:      f32,   // 0 = fly, 1 = bee
//   ambient:   f32,
//   pad:       f32,   // the renderer parks the base opacity here
// }

// SSAO pass
// struct SSAOUniforms {
//   ssaoRadius:    f32,
//   ssaoBias:      f32,
//   temporalAlpha: f32,  // 1 on the first frame, then 0.1; always 1 on low spec
//   pad:           f32,
// }
// Textures: depth, gAlbedo, the previous frame's AO + samplers.
//
// SSAO blur pass has no uniforms — resolution, near and far live in group 0.

// Bloom extract
// struct BloomExtractUniforms {
//   threshold: f32,
//   pad:       vec3f,
// }
// Struct 16 bytes, buffer 32.

// Bloom down / up — one buffer per mip level, sized UNIFORM_BYTES.bloomMip
// struct BloomDownUniforms {
//   halfTexel: vec2f,   // 0.5 / source mip size
//   pad:       vec2f,
// }

// God rays pass
// struct GodRayUniforms {
//   sunScreenPos:    vec2f,
//   godRayIntensity: f32,
//   sunVisible:      f32,
//   godRaySteps:     u32,
//   shadowEnabled:   f32,   // 0 on low spec: no dynamic shadow-map sampling
//   pad:             vec2f,
// }
// Struct 32 bytes, buffer 48. Textures: scene, depth, shadowMap, cloudShadow.

// Depth of field (shared by the CoC and blur passes)
// struct DofUniforms {
//   near:          f32,
//   far:           f32,
//   depthOfField:  f32,
//   dofFocusNear:  f32,
//   dofFocusFar:   f32,
//   dofBlurNear:   f32,
//   dofBlurFar:    f32,
//   ssaoIntensity: f32,
// }

// Fog — bound by the post-process pass at binding 13
// struct FogUniforms {
//   fogColor:           vec3f,             // offset   0
//   fogDensity:         f32,               // offset  12
//   fogHeightFalloff:   f32,               // offset  16
//   fogIntensity:       f32,               // offset  20
//   fogQuality:         f32,               // offset  24
//   fogSteps:           u32,               // offset  28
//   fogWindDir:         vec2f,             // offset  32
//   fogWindStrength:    f32,               // offset  40
//   fireflyCount:       u32,               // offset  44
//   fireflyFactor:      f32,               // offset  48
//   fireflyLightRadius: f32,               // offset  52
//   fogPad:             vec2f,             // offset  56
//   fireflyData:        array<vec4f, 32>,  // offset  64: xyz position, w brightness
//   bikePos:            vec4f,             // offset 576: xyz headlight, w reach (0 = off)
//   bikeColor:          vec4f,             // offset 592: rgb beam, w scatter intensity
//   bikeDir:            vec4f,             // offset 608: xyz beam axis, w cos(half-angle)
// }
// When no fireflies are lit the renderer writes only bytes 0–64 and 576–624,
// skipping the 512-byte firefly array.

// Post-process pass
// struct PostProcessUniforms {
//   fogColor:            vec3f,             // offset   0
//   depthOfField:        f32,               // offset  12
//   cgLift:              vec3f,             // offset  16
//   enableFXAA:          f32,               // offset  28
//   sunScreenPos:        vec2f,             // offset  32  ((2,2) = sun behind camera)
//   dofFocusNear:        f32,               // offset  40
//   dofFocusFar:         f32,               // offset  44
//   dofBlurNear:         f32,               // offset  48
//   dofBlurFar:          f32,               // offset  52
//   bloomIntensity:      f32,               // offset  56  (0 when the pass is skipped)
//   godRayIntensity:     f32,               // offset  60  (0 when the pass is skipped)
//   ssaoIntensity:       f32,               // offset  64  (0 when the pass is skipped)
//   chromaticAberration: f32,               // offset  68
//   cgExposure:          f32,               // offset  72
//   cgContrast:          f32,               // offset  76
//   cgSaturation:        f32,               // offset  80
//   lensFlareIntensity:  f32,               // offset  84
//   grainStrength:       f32,               // offset  88
//   vignetteStrength:    f32,               // offset  92
//   rainIntensity:       f32,               // offset  96
//   rainbowIntensity:    f32,               // offset 100
//   bikeParams:          vec4f,             // offset 112: x count, y glow, z flare
//   bikePos:             array<vec4f, 2>,   // offset 128: xyz world position per lamp
//   bikeColor:           array<vec4f, 2>,   // offset 160: rgb radiant colour per lamp
// }
// Struct 192 bytes, buffer 256. Textures: scene, depth, bloom, godRay, ssao,
// gAlbedo, 3D noise, dofBlur + samplers, plus the fog uniform at binding 13.

// Cloud shadow bake (its own group 0 — the bake runs before frame uniforms bind)
// struct CloudShadowBakeUniforms {
//   sunDirection:  vec3f,
//   cloudBase:     f32,
//   cloudCoverage: f32,
//   windStrength:  f32,
//   windDirection: vec2f,
//   time:          f32,
//   pad:           vec3f,
// }

// GROUP 3: Per-object uniforms
// ############################
//
// struct ObjectUniforms {
//   modelMatrix: mat4x4f,
// }
//
// Used by text and bike, in both the G-buffer and shadow passes. Grass, ground,
// sky and the sprite effects place their instances in world space directly.

// Buffer sizes
// ############
//
// Allocated by Renderer#createUniforms(); each name maps to one UniformBuffer
// (GPU buffer plus host staging). Layouts are documented above in this order.

export const UNIFORM_BYTES = {
  frame: 640,
  textObject: 64,
  bikeObject: 64,
  cloudShadow: 64,
  shadow: 32,
  grass: 16,
  flower: 16,
  bird: 32,
  deferredLighting: 64,
  fireflyLights: 528,
  bikeLights: 112,
  sky: 176,
  rain: 32,
  particle: 32,
  fireflySprite: 32,
  fly: 32,
  bee: 32,
  ssao: 16,
  bloomExtract: 32,
  godRay: 48,
  dof: 32,
  fog: 624,
  postprocess: 256,
}

// One per bloom mip level, so each step carries its own source half-texel.
export const BLOOM_MIP_UNIFORM_BYTES = 16
