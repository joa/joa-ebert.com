// Uniform Catalog
// ###############
//
// Documents every uniform buffer grouped by update frequency and defines WGSL
// struct layouts. Serves as both documentation and source of truth: the WGSL
// structs in shaders must match the byte layouts defined here.
//
// - Group 0: FrameUniforms (640 bytes, shared by all passes, updated once per frame)
// - Group 1: per-pass resources (textures, samplers, pass-specific uniforms)
// - Group 3: per-object uniforms (e.g. text model matrix)

// GROUP 0: Per-frame uniforms — updated once per frame
// ####################################################
//
// WGSL struct:
//
// struct FrameUniforms {
//   projectionMatrix:       mat4x4f,   // offset   0  (64 bytes)
//   viewMatrix:             mat4x4f,   // offset  64  (64 bytes)
//   invProjectionMatrix:    mat4x4f,   // offset 128  (64 bytes)
//   invViewMatrix:          mat4x4f,   // offset 192  (64 bytes)
//   viewProjectionMatrix:   mat4x4f,   // offset 256  (64 bytes)
//   invViewProjectionMatrix:mat4x4f,   // offset 320  (64 bytes)
//   prevViewProjectionMatrix:mat4x4f,  // offset 384  (64 bytes)
//   lightSpaceMatrix:       mat4x4f,   // offset 448  (64 bytes)
//
//   cameraPosition:         vec3f,     // offset 512  (12 + 4 pad)
//   time:                   f32,       // offset 528  (packed after camera pad)
//   sunDirection:            vec3f,     // offset 532  (12 + 4 pad)
//   windTime:               f32,       // offset 548
//   moonDirection:           vec3f,     // offset 552  (12 + 4 pad)
//   windStrength:           f32,       // offset 568
//   windDirection:          vec2f,     // offset 572  (8 bytes)
//   resolution:             vec2f,     // offset 580  (8 bytes)
//
//   sunAboveHorizon:        f32,       // offset 576
//   near:                   f32,       // offset 580
//   far:                    f32,       // offset 584
//   deltaTime:              f32,       // offset 588
//   cursorWorldPos:         vec3f,     // offset 592  (12 + 4 pad)
//   cursorRadius:           f32,       // offset 604
// }
//
// Total: ~608 bytes → pad to 640 (16-byte aligned)

export const FRAME_UNIFORMS_SIZE = 640 // conservative, 16-byte aligned

// Source mapping (where each value comes from in the JS render loop):
//
// projectionMatrix        ← ctx.projectionMatrix
// viewMatrix              ← ctx.viewMatrix
// invProjectionMatrix     ← ctx.invProjectionMatrix
// invViewMatrix           ← ctx.invViewMatrix
// viewProjectionMatrix    ← ctx.viewProjectionMatrix
// invViewProjectionMatrix ← ctx.invViewProjectionMatrix
// prevViewProjectionMatrix← this.#prevViewProjectionMatrix
// lightSpaceMatrix        ← ctx.lightSpaceMatrix
// cameraPosition          ← this.camera.position
// time                    ← ctx.currentTime * 0.001
// sunDirection            ← ctx.sunPosition.{x,y,z}
// windTime                ← windSystem.windTime
// moonDirection           ← timeInfo.moonPosition.{x,y,z}
// windStrength            ← windSystem.windStrength
// windDirection           ← windSystem.windDirection
// resolution              ← [ctx.width, ctx.height]
// sunAboveHorizon         ← max(0, timeInfo.sunPosition.y)
// near                    ← NEAR (0.01)
// far                     ← FAR (1000)
// deltaTime               ← ctx.deltaTime

// GROUP 1: Per-pass uniforms — varies per render pass
// ###################################################
//
// Each pass has its own bind group layout with:
//   - A pass-specific uniform buffer (if needed)
//   - Texture bindings
//   - Sampler bindings
//
// Below are the pass-specific uniform structs.

// Grass Pass
// ##########
// struct GrassUniforms {
//   grassHeightFactor:  f32,
//   grassWidthFactor:   f32,
//   alphaThreshold:     f32,
//   dewAmount:          f32,   // 0=none, 1=full dew (morning tint at blade tips)
// }
// Textures: windNoiseTex + sampler

// Sky Pass
// ########
// struct SkyUniforms {
//   zenithColor:        vec3f, + pad
//   horizonColor:       vec3f, + pad
//   sunIntensity:       f32,
//   cloudBase:          f32,
//   cloudTop:           f32,
//   cloudCoverage:      f32,
//   cloudSigmaE:        f32,
//   cloudSteps:         u32,
//   cloudShadowSteps:   u32,
//   moonPhase:          f32,
//   chemtrailCount:     u32,
//   chemtrailOpacity:   f32,
//   chemtrailWidth:     f32,
//   turbidity:          f32,
//   overcast:           f32,
// }
// Textures: mountainHeightmap + noiseTex3D + 2 samplers

// Deferred Lighting Pass
// ######################
// struct DeferredLightingUniforms {
//   skyColor:             vec3f, + pad
//   ambientIntensity:     f32,
//   colorTemperature:     f32,
//   shadowEnabled:        f32,
//   mountainVisibility:   f32,
//   moonFactor:           f32,
//   sparkleEnabled:       f32,
//   sparkleIntensity:     f32,
//   sparkleDensity:       f32,
//   sparkleSharpness:     f32,
//   sparkleSpeed:         f32,
//   cloudLightOcclusion:  f32,
//   debugMode:            f32,  // ?dbg=N URL param, 0 = normal
//   _pad:                 f32,
// }
// Textures: gAlbedo, gNormal, gMaterial, depth, shadowMap, cloudShadow + samplers

// Post-Process Pass
// #################
// struct PostProcessUniforms {
//   fogColor:             vec3f, + pad
//   cgLift:               vec3f, + pad
//   sunScreenPos:         vec2f,
//   depthOfField:         f32,
//   dofFocusNear:         f32,
//   dofFocusFar:          f32,
//   dofBlurNear:          f32,
//   dofBlurFar:           f32,
//   enableFXAA:           f32,
//   bloomIntensity:       f32,
//   godRayIntensity:      f32,
//   ssaoIntensity:        f32,
//   chromaticAberration:  f32,
//   cgExposure:           f32,
//   cgContrast:           f32,
//   cgSaturation:         f32,
//   lensFlareIntensity:   f32,
//   grainStrength:        f32,
//   vignetteStrength:     f32,
//   rainIntensity:        f32,
//   rainbowIntensity:     f32,
// }
// Textures: scene, depth, bloom, godRay, ssao, fog, gAlbedo + samplers

// God Rays Pass
// #############
// struct GodRayUniforms {
//   sunScreenPos:   vec2f,
//   godRayIntensity:f32,
//   sunVisible:     f32,
//   godRaySteps:    u32,
// }
// Textures: scene, depth, shadowMap, cloudShadow + samplers

// Fog Pass
// ########
// struct FogUniforms {
//   fogColor:           vec3f, + pad
//   fogDensity:         f32,
//   fogHeightFalloff:   f32,
//   fogIntensity:       f32,
//   fogQuality:         f32,
//   fogSteps:           u32,
//   fogWindDir:         vec2f,
//   fogWindStrength:    f32,
//   fireflyCount:       u32,
//   fireflyFactor:      f32,
//   fireflyLightRadius: f32,
// }
// Textures: depth, noiseTex3D + samplers
// Storage: fireflyPositions[32], fireflyBrightness[32]

// SSAO Pass
// #########
// struct SSAOUniforms {
//   ssaoRadius:     f32,
//   ssaoBias:       f32,
//   temporalAlpha:  f32,
// }
// Textures: depth, gAlbedo, ssaoPrev + samplers

// SSAO Blur Pass
// ##############
// (no extra uniforms beyond frame uniforms — resolution, near, far are in group 0)
// Textures: ssao, depth + samplers

// Bloom Extract
// #############
// struct BloomExtractUniforms {
//   threshold: f32,
// }
// Textures: scene + sampler

// Bloom Down/Up
// #############
// struct BloomPassUniforms {
//   halfTexel: vec2f,
// }
// Textures: source + sampler

// Cloud Shadow Bake
// #################
// struct CloudShadowBakeUniforms {
//   cloudBase:     f32,
//   cloudCoverage: f32,
// }
// (sunDirection, windDirection, windStrength, time are in frame uniforms)

// Rain Pass
// #########
// struct RainUniforms {
//   rainIntensity: f32,
// }
// (matrices, time, wind, camera are in frame uniforms)

// Particle Pass
// #############
// struct ParticleUniforms {
//   ambientIntensity: f32,
// }

// Firefly Lights Pass
// ###################
// struct FireflyLightUniforms {
//   fireflyCount:       u32,
//   fireflyFactor:      f32,
//   lightRadius:        f32,
// }
// Storage: fireflyPositions[32], fireflyBrightness[32]
// Textures: gAlbedo, gNormal, depth + samplers

// Firefly Sprites Pass
// ####################
// struct FireflySpriteUniforms {
//   fireflyFactor: f32,
// }

// Bird Pass
// #########
// struct BirdUniforms {
//   birdColor:      vec3f, + pad
//   wingAmplitude:  f32,
//   wingBeat:       f32,
//   birdScale:      f32,
// }

// GROUP 3: Per-object uniforms
// ############################
//
// struct ObjectUniforms {
//   modelMatrix: mat4x4f,  // 64 bytes
// }
//
// Used by: text, shadowText
// Grass/ground/sky/particles don't need a model matrix.

export const OBJECT_UNIFORMS_SIZE = 64

// Texture unit mapping (WebGL2) → Bind group entries (WebGPU)
// ###########################################################
//
// In WebGL2, textures are bound to numbered units (TEXTURE0..7).
// In WebGPU, each texture+sampler pair is a binding in a bind group.
//
// WebGL2 TEXTURE0  → varies by pass (wind noise, mountain heightmap, gAlbedo, scene, ...)
// WebGL2 TEXTURE1  → varies by pass (3D noise, gNormal, depth, ...)
// ...
//
// No fixed unit→binding mapping. Each pass's bind group layout
// defines its own texture bindings at whatever indices are convenient.

// Uniform update flow (per frame)
// ###############################
//
// 1. Write FrameUniforms to frameUniformBuffer via device.queue.writeBuffer()
// 2. For each render pass:
//    a. Write pass-specific uniforms to their buffer (if dirty)
//    b. Create or reuse bind groups
//    c. Set bind groups on the render pass encoder
//    d. Draw
