// 2D FABRIK inverse-kinematics solver for chains of arbitrary length.
//
//   joints   array of {x,y}, length = lengths.length + 1
//   root     fixed root position (joints[0] is forced to this)
//   target   desired tip position (joints[n] is pulled toward this)
//   lengths  bone lengths between consecutive joints
//
// Mutates and returns `joints`. Uses the array's current values as the
// initial guess, so callers should keep it stable across frames — that's
// what gives smooth, history-aware motion and a stable elbow side.

export function solveChain(joints, root, target, lengths, iterations = 8) {
  const n = lengths.length;
  let totalLen = 0;
  for (const l of lengths) totalLen += l;

  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const d = Math.hypot(dx, dy) || 1e-6;

  // Out of reach: clamp to a straight line at maximum extension.
  if (d >= totalLen) {
    const ux = dx / d, uy = dy / d;
    joints[0].x = root.x; joints[0].y = root.y;
    let cum = 0;
    for (let i = 0; i < n; i++) {
      cum += lengths[i];
      joints[i + 1].x = root.x + cum * ux;
      joints[i + 1].y = root.y + cum * uy;
    }
    return joints;
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Backward pass: anchor tip at target, walk back toward root.
    joints[n].x = target.x;
    joints[n].y = target.y;
    for (let i = n - 1; i >= 0; i--) {
      const ax = joints[i + 1].x, ay = joints[i + 1].y;
      const bx = joints[i].x,     by = joints[i].y;
      const r = Math.hypot(bx - ax, by - ay) || 1e-6;
      const lambda = lengths[i] / r;
      joints[i].x = ax + lambda * (bx - ax);
      joints[i].y = ay + lambda * (by - ay);
    }
    // Forward pass: anchor root, walk forward toward tip.
    joints[0].x = root.x; joints[0].y = root.y;
    for (let i = 0; i < n; i++) {
      const ax = joints[i].x,     ay = joints[i].y;
      const bx = joints[i + 1].x, by = joints[i + 1].y;
      const r = Math.hypot(bx - ax, by - ay) || 1e-6;
      const lambda = lengths[i] / r;
      joints[i + 1].x = ax + lambda * (bx - ax);
      joints[i + 1].y = ay + lambda * (by - ay);
    }
  }

  return joints;
}

// Seed a chain in a curled rest pose: each interior joint sits perpendicular
// to the root->target line on the bend side, peaking near the chain middle.
// FABRIK can converge to either elbow side, so we use this once at startup
// to lock in the anatomically correct curl direction.
export function initChain(joints, root, target, lengths, bend) {
  const n = lengths.length;
  let totalLen = 0;
  for (const l of lengths) totalLen += l;
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / d, uy = dy / d;
  // Perpendicular pointing toward the natural bend side.
  const px = -uy * bend, py = ux * bend;
  const slack = Math.max(0, totalLen - d);
  const bow = slack * 0.5;

  joints[0].x = root.x; joints[0].y = root.y;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += lengths[i];
    const t = cum / totalLen;
    const sag = bow * Math.sin(Math.PI * t);
    joints[i + 1].x = root.x + cum * ux + sag * px;
    joints[i + 1].y = root.y + cum * uy + sag * py;
  }
  joints[n].x = target.x;
  joints[n].y = target.y;
}
