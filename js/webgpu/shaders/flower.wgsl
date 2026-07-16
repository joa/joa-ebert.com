// Flowers
// #######
//
// Instanced meadow flowers rendered as crossed-billboard impostors: clover leaf
// clumps, yellow dandelion blooms, and white dandelion seed puffs. Silhouette
// and colour are painted procedurally in the fragment shader and resolved with
// an alpha-tested dither, matching the grass pipeline. Outputs to the G-buffer
// as foliage (matID 0) so it shares the grass lighting/translucency path.

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

struct FlowerUniforms {
  sway: f32,
  alphaThreshold: f32,
  heightFactor: f32,
  pad1: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> flower: FlowerUniforms;
@group(1) @binding(1) var windNoiseTex: texture_2d<f32>;
@group(1) @binding(2) var windNoiseSampler: sampler;

const CLOVER = 0.0;
const BLOOM = 1.0;
const PUFF = 2.0;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) cardNormal: vec2f,
  // Instance: iPos = (worldX, groundY, worldZ), iData = (rotationRad, scale, kind, seed)
  @location(3) iPos: vec3f,
  @location(4) iData: vec4f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPos: vec3f,
  @location(2) normal: vec3f,
  @location(3) @interpolate(flat) kind: f32,
  @location(4) @interpolate(flat) seed: f32,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let kind = input.iData.z;
  let scale = input.iData.y;
  let seed = input.iData.w;

  // Clover sits low and spreads wide; dandelions stand tall and narrow.
  let isClover = kind < 0.5;
  let widthMul = select(1.0, 1.7, isClover);
  let heightMul = select(1.0, 0.6, isClover);

  // Flowers grow with the surrounding grass so they keep pace and aren't buried
  // when it's tall: height tracks grassHeightFactor linearly (like the blades),
  // footprint widens more gently so the silhouettes stay in proportion.
  let hf = flower.heightFactor;
  let vScale = scale * hf;
  let hScale = scale * mix(1.0, hf, 0.5);
  var local = vec3f(input.position.x * widthMul * hScale, input.position.y * heightMul * vScale, input.position.z * widthMul * hScale);

  // Per-instance yaw so the crossed cards don't all align.
  let ca = cos(input.iData.x);
  let sa = sin(input.iData.x);
  let rx = local.x * ca - local.z * sa;
  let rz = local.x * sa + local.z * ca;

  // Gentle wind sway of the upper part, sampled from the shared wind noise so it
  // agrees with the grass around it. heightCurve keeps the base planted.
  let wt = frame.windTime * 0.05;
  let nX = textureSampleLevel(windNoiseTex, windNoiseSampler, (input.iPos.xz * 0.33 + vec2f(wt, 0.0)) * 0.03125, 0.0).r;
  let nZ = textureSampleLevel(windNoiseTex, windNoiseSampler, (input.iPos.xz * 0.33 + vec2f(0.0, wt * 0.85)) * 0.03125, 0.0).r;
  let windVec = (vec2f(nX, nZ) * 2.0 - 1.0 + frame.windDirection * 0.3);
  let heightCurve = input.position.y * input.position.y;
  let swayAmt = flower.sway * frame.windStrength * heightCurve * vScale;
  let sway = windVec * swayAmt;

  let worldPos = input.iPos + vec3f(rx + sway.x, local.y, rz + sway.y);

  // Card normal rotated into world, biased toward the sky so petals catch the
  // skylight the way real flat blooms do.
  let nWorld = normalize(vec3f(input.cardNormal.x * ca - input.cardNormal.y * sa, 0.0, input.cardNormal.x * sa + input.cardNormal.y * ca));
  let normal = normalize(mix(nWorld, vec3f(0.0, 1.0, 0.0), 0.55));

  return VertexOutput(
    frame.projectionMatrix * frame.viewMatrix * vec4f(worldPos, 1.0),
    input.uv,
    worldPos,
    normal,
    kind,
    seed,
  );
}

struct FragmentInput {
  @builtin(position) fragCoord: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPos: vec3f,
  @location(2) normal: vec3f,
  @location(3) @interpolate(flat) kind: f32,
  @location(4) @interpolate(flat) seed: f32,
}

struct GBufferOutput {
  @location(0) albedo: vec4f,
  @location(1) normal: vec4f,
  @location(2) material: vec4f,
}

fn h11(x: f32) -> f32 {
  return fract(sin(x * 127.1) * 43758.5453);
}

fn vnoise1(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(h11(i), h11(i + 1.0), u);
}

// Soft-edged coverage of a disc — 1 inside, ramping to 0 across `soft`.
fn disc(uv: vec2f, c: vec2f, r: f32, soft: f32) -> f32 {
  return 1.0 - smoothstep(r - soft, r, distance(uv, c));
}

const BAYER = array<i32, 16>(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

// Clover: a low clump of three rounded leaflets with the pale watermark chevron,
// on short stalks, occasionally topped by a white pom-pom flower head.
fn clover(uv: vec2f, seed: f32, sway: f32) -> vec4f {
  var cover = 0.0;
  var col = vec3f(0.22, 0.44, 0.17); // rich, slightly blue-leaning clover green

  // Short stalk feeding the cluster.
  let stalkX = 0.5 + (seed - 0.5) * 0.06;
  let stalk = step(abs(uv.x - stalkX), 0.028) * (1.0 - smoothstep(0.32, 0.5, uv.y)) * step(0.04, uv.y);
  cover = max(cover, stalk);

  let center = vec2f(0.5, 0.62);
  let rot = seed * 6.2831;
  var wm = 0.0;
  for (var i = 0; i < 3; i++) {
    let a = rot + f32(i) * 2.0944;
    let dir = vec2f(cos(a), sin(a));
    let lc = center + dir * 0.15;
    let d = distance(uv, lc);
    let lobe = 1.0 - smoothstep(0.15, 0.175, d);
    // Heart notch: bite a small circle out of the outer tip of each leaflet.
    let notch = disc(uv, lc + dir * 0.16, 0.07, 0.02);
    cover = max(cover, lobe * (1.0 - notch));
    // Pale watermark arc near the leaflet base (toward the cluster centre).
    wm = max(wm, disc(uv, lc - dir * 0.06, 0.09, 0.03) * (1.0 - disc(uv, lc - dir * 0.06, 0.05, 0.02)));
  }
  col = mix(col, vec3f(0.46, 0.60, 0.34), wm * 0.8);
  // Per-leaflet shading gradient so the clump reads round, not flat.
  col *= 0.82 + 0.18 * (1.0 - smoothstep(0.0, 0.28, distance(uv, center)));

  // Occasional white clover flower.
  if (seed > 0.66) {
    let fc = vec2f(stalkX, 0.84);
    let head = disc(uv, fc, 0.15, 0.03);
    // Fluffy florets: nibble the rim with radial noise so it isn't a clean ball.
    let ang = atan2(uv.y - fc.y, uv.x - fc.x);
    let rim = vnoise1(ang * 5.0 + seed * 20.0) * 0.05;
    let headCover = 1.0 - smoothstep(0.12 - rim, 0.15 - rim, distance(uv, fc));
    if (headCover > 0.0) {
      cover = max(cover, headCover);
      let pink = smoothstep(0.6, 1.0, (uv.y - fc.y) / -0.15 + 0.5);
      col = mix(vec3f(0.95, 0.95, 0.93), vec3f(0.95, 0.78, 0.82), pink * 0.5) * (0.85 + 0.15 * head);
    }
  }

  return vec4f(col, cover);
}

// Dandelion bloom: a slender stem topped by a yellow flower head of radial ray
// florets. The head closes and greens toward night (real dandelions fold shut).
fn bloom(uv: vec2f, seed: f32, sunUp: f32) -> vec4f {
  var cover = 0.0;
  let stemX = 0.5 + (seed - 0.5) * 0.05;
  let headC = vec2f(stemX, 0.8);
  let headR = mix(0.09, 0.2, sunUp);

  // Hollow stem.
  let stem = step(abs(uv.x - stemX), 0.022) * (1.0 - smoothstep(headC.y - 0.05, headC.y, uv.y)) * step(0.02, uv.y);
  cover = max(cover, stem);

  // Ray-floret head: serrate the radius so the disc reads as many fine petals.
  let d = uv - headC;
  let ang = atan2(d.y, d.x);
  let serr = 0.82 + 0.18 * abs(sin(ang * 13.0 + seed * 10.0));
  let r = length(d);
  let head = 1.0 - smoothstep(headR * serr - 0.015, headR * serr, r);
  cover = max(cover, head);

  // Colour: warm orange heart → bright yellow rays; folds to green when closed.
  let rn = clamp(r / max(headR, 0.001), 0.0, 1.0);
  var petal = mix(vec3f(0.98, 0.66, 0.06), vec3f(1.0, 0.86, 0.12), smoothstep(0.2, 0.9, rn));
  petal += vnoise1(ang * 13.0 + seed * 5.0) * 0.06 - 0.03; // per-ray glint
  let closed = mix(vec3f(0.42, 0.52, 0.22), petal, sunUp); // green bud at night
  let stemCol = vec3f(0.30, 0.46, 0.20);
  let col = select(stemCol, closed, head > stem);

  return vec4f(col, cover);
}

// Dandelion seed puff: a stem topped by a soft spherical "clock" of white pappi.
// The rim is feathered with noise so the silhouette reads fluffy, not solid.
fn puff(uv: vec2f, seed: f32) -> vec4f {
  var cover = 0.0;
  let stemX = 0.5 + (seed - 0.5) * 0.05;
  let headC = vec2f(stemX, 0.8);
  let headR = 0.22;

  let stem = step(abs(uv.x - stemX), 0.02) * (1.0 - smoothstep(headC.y - 0.06, headC.y, uv.y)) * step(0.02, uv.y);
  cover = max(cover, stem);

  let d = uv - headC;
  let ang = atan2(d.y, d.x);
  let r = length(d);
  // Feathered edge: density fades out over the rim, dithered by radial noise.
  let feather = vnoise1(ang * 9.0 + seed * 30.0) * 0.05 + vnoise1(ang * 23.0) * 0.02;
  let density = 1.0 - smoothstep(headR * 0.55, headR + feather, r);
  // Thin the interior slightly so it looks airy rather than a painted disc.
  let airy = 0.55 + 0.45 * vnoise1(ang * 40.0 + r * 60.0);
  let head = density * airy;
  cover = max(cover, head);

  // Faint radial filaments catching light, brown seed core at the base.
  let filament = 0.85 + 0.15 * abs(sin(ang * 30.0));
  var col = vec3f(0.9, 0.91, 0.9) * filament;
  col = mix(col, vec3f(0.42, 0.34, 0.22), disc(uv, headC + vec2f(0.0, -0.02), 0.03, 0.02));
  let stemCol = vec3f(0.30, 0.46, 0.20);
  col = select(stemCol, col, head > stem);

  return vec4f(col, cover);
}

@fragment
fn fragmentMain(input: FragmentInput) -> GBufferOutput {
  let sunUp = smoothstep(0.0, 0.25, frame.sunAboveHorizon);

  var res: vec4f;
  if (input.kind < 0.5) {
    res = clover(input.uv, input.seed, flower.sway);
  } else if (input.kind < 1.5) {
    res = bloom(input.uv, input.seed, sunUp);
  } else {
    res = puff(input.uv, input.seed);
  }

  // Alpha-tested silhouette, ordered dither like the grass pass.
  let bx = i32(input.fragCoord.x) % 4;
  let by = i32(input.fragCoord.y) % 4;
  let dither = f32(BAYER[by * 4 + bx]) / 16.0;
  if (res.a < max(flower.alphaThreshold, dither)) {
    discard;
  }

  // Foliage material (matID 0) — shares the grass lighting/translucency path.
  return GBufferOutput(
    vec4f(res.rgb, 0.0),
    vec4f(normalize(input.normal) * 0.5 + 0.5, input.uv.y),
    vec4f(24.0 / 256.0, 0.0, 0.55, 0.28),
  );
}
