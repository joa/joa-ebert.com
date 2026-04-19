// SSAO
// ####
//
// Screen-space ambient occlusion with temporal reprojection.

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

struct SSAOUniforms {
  ssaoRadius: f32,
  ssaoBias: f32,
  temporalAlpha: f32,
  pad: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> ssao: SSAOUniforms;
@group(1) @binding(1) var depthTex: texture_depth_2d;
@group(1) @binding(2) var depthSampler: sampler;
@group(1) @binding(3) var gAlbedoTex: texture_2d<f32>;
@group(1) @binding(4) var gAlbedoSampler: sampler;
@group(1) @binding(5) var ssaoPrevTex: texture_2d<f32>;
@group(1) @binding(6) var ssaoPrevSampler: sampler;

struct FullscreenVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  return FullscreenVertexOutput(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}

fn linearDepth(rawDepth: f32) -> f32 {
  // WebGPU perspective: NDC z in [0,1], near->0, far->1.
  // d = near*far / (far - rawDepth*(far-near)), normalized by far:
  return frame.near / (frame.far - rawDepth * (frame.far - frame.near));
}

@fragment
fn fragmentMain(input: FullscreenVertexOutput) -> @location(0) vec4f {
  let uv = input.texCoord;
  let depthDims = textureDimensions(depthTex);
  let depthCoord = vec2i(vec2f(depthDims) * uv);
  let rawDepth = textureLoad(depthTex, depthCoord, 0);

  if (rawDepth >= 0.9999) {
    return vec4f(1.0);
  }

  let fragLin = linearDepth(rawDepth);
  let fragDist = fragLin * frame.far;
  let gDims = textureDimensions(gAlbedoTex);
  let gCoord = vec2i(vec2f(gDims) * uv);
  let fragMatID = i32(round(textureLoad(gAlbedoTex, gCoord, 0).a * 3.0));

  // Text surfaces need larger bias to prevent surrounding terrain from flooding
  // letter faces with false occlusion
  let bias = select(ssao.ssaoBias, 0.2, fragMatID == 2);

  // Match WebGL: use a stable per-pixel rotation only. The previous WebGPU-only
  // frame-wide jitter rotated the entire half-res sampling pattern every frame,
  // which accumulated into visible horizontal scanlines under temporal SSAO.
  let pixelCoord = floor(input.position.xy);
  let randAngle = fract(sin(dot(pixelCoord, vec2f(127.1, 311.7))) * 43758.5453) * 6.2831853;
  let rc = cos(randAngle);
  let rs = sin(randAngle);

  // Precomputed cos/sin for 8 evenly-spaced tap angles (i * PI/4)
  const TAP_COS = array<f32, 8>(1.0, 0.7071068, 0.0, -0.7071068, -1.0, -0.7071068, 0.0, 0.7071068);
  const TAP_SIN = array<f32, 8>(0.0, 0.7071068, 1.0, 0.7071068, 0.0, -0.7071068, -1.0, -0.7071068);

  let texel = 1.0 / frame.resolution;
  var occlusion = 0.0;

  // Scale sampling radius inversely with depth for consistent world-space coverage
  let depthScale = clamp(0.005 / fragLin, 0.25, 1.0);

  for (var i = 0; i < 8; i++) {
    let dx = TAP_COS[i] * rc - TAP_SIN[i] * rs;
    let dy = TAP_COS[i] * rs + TAP_SIN[i] * rc;

    let jitter = fract(f32(i) * 0.6180339887 + randAngle);
    let r = (0.3 + 0.7 * jitter) * ssao.ssaoRadius * depthScale;

    let tapUV = clamp(uv + vec2f(dx, dy) * r * texel, vec2f(0.001), vec2f(0.999));
    let tapDC = vec2i(vec2f(depthDims) * tapUV);
    let tapLin = linearDepth(textureLoad(depthTex, clamp(tapDC, vec2i(0), vec2i(depthDims) - 1), 0));
    let tapDist = tapLin * frame.far;

    // Grass (matID 0) must not occlude text (matID 2) — only relevant for text pixels
    if (fragMatID == 2) {
      let tapGC = vec2i(vec2f(gDims) * tapUV);
      let tapMatID = i32(round(textureLoad(gAlbedoTex, clamp(tapGC, vec2i(0), vec2i(gDims) - 1), 0).a * 3.0));
      if (tapMatID == 0) {
        continue;
      }
    }

    // Occlusion and range check both in world-space units
    let occluded = select(0.0, 1.0, tapDist < fragDist - bias);
    let zDiffWorld = abs(fragDist - tapDist);
    let rangeCheck = smoothstep(3.0, 0.0, zDiffWorld);

    occlusion += occluded * rangeCheck;
  }

  var ao = 1.0 - occlusion * 0.125;
  ao = pow(ao, 1.8);

  // Temporal reprojection: blend with previous frame's SSAO
  let clipPos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, rawDepth, 1.0);
  let worldPos4 = frame.invViewProjectionMatrix * clipPos;
  let worldPos = worldPos4.xyz / worldPos4.w;
  let prevClip = frame.prevViewProjectionMatrix * vec4f(worldPos, 1.0);
  // Clip Y=+1 is screen top, but texture Y=0 is top → invert Y for textureLoad.
  let prevUV = vec2f(prevClip.x / prevClip.w * 0.5 + 0.5, 0.5 - prevClip.y / prevClip.w * 0.5);

  var alpha = ssao.temporalAlpha;
  if (alpha < 1.0
      && prevUV.x >= 0.0 && prevUV.x <= 1.0
      && prevUV.y >= 0.0 && prevUV.y <= 1.0) {
    // Ghosting suppression: reject history if depth changed significantly
    let reprojDC = vec2i(vec2f(depthDims) * prevUV);
    let reprojDepth = linearDepth(textureLoad(depthTex, clamp(reprojDC, vec2i(0), vec2i(depthDims) - 1), 0));
    let depthDelta = abs(fragLin - reprojDepth) * frame.far;
    if (depthDelta < 1.0) {
      let prevAO = textureSampleLevel(ssaoPrevTex, ssaoPrevSampler, prevUV, 0.0).r;
      ao = mix(prevAO, ao, alpha);
    }
  }

  return vec4f(vec3f(ao), 1.0);
}
