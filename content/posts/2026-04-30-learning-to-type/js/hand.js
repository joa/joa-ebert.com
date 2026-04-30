import { solveChain, initChain } from './ik.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const LEFT_FINGERS  = ['LP', 'LR', 'LM', 'LI', 'LT'];
const RIGHT_FINGERS = ['RP', 'RR', 'RM', 'RI', 'RT'];

// Natural MCP-knuckle offset from palm. Magnitude becomes the metacarpal
// bone length, direction sets the rest-pose splay (pinky outer, thumb to
// the side). The metacarpal is solved as part of the IK chain, so it
// rotates slightly under load while staying ~rooted at this length.
const KNUCKLE_OFFSETS = {
  LP: { dx: -82, dy:  -4 },
  LR: { dx: -34, dy: -14 },
  LM: { dx:  14, dy: -18 },
  LI: { dx:  62, dy: -14 },
  LT: { dx:  90, dy:  28 },
  RT: { dx: -90, dy:  28 },
  RI: { dx: -62, dy: -14 },
  RM: { dx: -14, dy: -18 },
  RR: { dx:  34, dy: -14 },
  RP: { dx:  82, dy:  -4 },
};

// Phalanx lengths past the knuckle (proximal, middle, distal for fingers;
// proximal, distal for thumb). Sized so visible fingers match human hand
// proportions: pinky ~70% of middle, ring & index equal at ~90% of middle.
//   Pinky:       110  (shortest)
//   Ring, Index: 143  (equal)
//   Middle:      160  (longest)
//   Thumb:       112
// Bone splits use anatomical 5:3:2 ratio for fingers, 5:4 for the thumb.
const PHALANX_LENGTHS = {
  LP: [55, 33, 22],
  LR: [72, 43, 28],
  LM: [80, 48, 32],
  LI: [72, 43, 28],
  LT: [62, 50],
  RT: [62, 50],
  RI: [72, 43, 28],
  RM: [80, 48, 32],
  RR: [72, 43, 28],
  RP: [55, 33, 22],
};

const TIP_EASE        = 0.60;
const PALM_EASE       = 0.10;
const PALM_FOLLOW     = 0.30;
const PRESS_PULL      = 0.70;
const PRESS_DECAY     = 0.46;
const PRESS_INSET     = 4;
const REST_POSE_EASE  = 0.18;
const ACTIVE_POSE_EASE = 0.03;

export class Hand {
  constructor({ side, palmRest, layout, hostGroup }) {
    this.side       = side;
    this.layout     = layout;
    this.bend       = side === 'L' ? +1 : -1;
    this.palmRest   = { ...palmRest };
    this.palm       = { ...palmRest };
    this.pressForce = { x: 0, y: 0 };
    this.activeKeys = new Map();

    const codes = side === 'L' ? LEFT_FINGERS : RIGHT_FINGERS;
    this.fingerOrder = codes;
    this.homeKeys = layout.hands[side].homeKeys || {};

    this.fingers = {};
    for (const code of codes) {
      const offset = KNUCKLE_OFFSETS[code];
      const metacarpalLen = Math.hypot(offset.dx, offset.dy);
      const phalanges = PHALANX_LENGTHS[code];
      const lengths = [metacarpalLen, ...phalanges];
      const totalReach = lengths.reduce((s, l) => s + l, 0);

      const homeRef = this.homeKeys[code];
      let homeTarget = null;
      if (typeof homeRef === 'string') homeTarget = this._keyCenter(homeRef);
      else if (homeRef && typeof homeRef === 'object') homeTarget = { ...homeRef };
      if (!homeTarget) {
        // Default hover above palm in the offset direction (used for thumb
        // when no home key is set).
        homeTarget = {
          x: this.palmRest.x + offset.dx,
          y: this.palmRest.y + offset.dy - totalReach * 0.35,
        };
      }

      const joints = new Array(lengths.length + 1);
      for (let i = 0; i <= lengths.length; i++) joints[i] = { x: 0, y: 0 };

      this.fingers[code] = {
        offset,
        lengths,
        homeTarget,
        targetTip:  { ...homeTarget },
        currentTip: { ...homeTarget },
        joints,
        restJoints: joints.map(() => ({ x: 0, y: 0 })),
        heldKeys: [],
      };
    }

    this._settlePalm();

    // Seed each chain in the bend-correct curl. FABRIK uses the previous
    // joint state as its initial guess, so a good seed is what locks in
    // the elbow side for every subsequent frame.
    for (const code in this.fingers) {
      const f = this.fingers[code];
      initChain(f.joints, this.palm, f.currentTip, f.lengths, this.bend);
      initChain(f.restJoints, this.palm, f.currentTip, f.lengths, this.bend);
    }

    this._buildElements(hostGroup);
    this._render();
  }

  _settlePalm() {
    let avgDx = 0, avgDy = 0, n = 0;
    for (const code in this.fingers) {
      avgDx += this.fingers[code].targetTip.x - this.palmRest.x;
      avgDy += this.fingers[code].targetTip.y - this.palmRest.y;
      n++;
    }
    this.palm.x = this.palmRest.x + PALM_FOLLOW * (avgDx / n);
    this.palm.y = this.palmRest.y + PALM_FOLLOW * (avgDy / n);
  }

  _keyCenter(code) {
    const k = this.layout.keys[code];
    if (!k) return null;
    if (k.center) return { ...k.center };
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  }

  _buildElements(group) {
    const palmCircle = el('circle', { class: 'palm', r: 6 });
    group.appendChild(palmCircle);
    this.palmCircle = palmCircle;

    for (const code of Object.keys(this.fingers)) {
      const f = this.fingers[code];
      const n = f.lengths.length; // bones per finger (4 for digits, 3 for thumb)
      f.bones    = [];
      f.jointEls = []; // interior joints — n-1 per finger
      for (let i = 0; i < n; i++) {
        const bone = el('line', { class: 'bone' });
        group.appendChild(bone);
        f.bones.push(bone);
      }
      for (let i = 0; i < n - 1; i++) {
        // i=0 is MCP (knuckle), i=1 is PIP/IP, i=2 (fingers only) is DIP.
        const isMcp = (i === 0);
        const j = el('circle', {
          class: isMcp ? 'joint knuckle' : 'joint',
          r: isMcp ? 3.5 : 3,
        });
        group.appendChild(j);
        f.jointEls.push(j);
      }
      f.tCircle = el('circle', { class: 'tip', r: 4 });
      group.appendChild(f.tCircle);
    }
  }

  pressKey(code) {
    const key = this.layout.keys[code];
    if (!key) return false;
    const fingerCode = this._availableFinger(key.finger, code);
    const finger = this.fingers[fingerCode];
    if (!finger) return false;

    const c = this._keyCenter(code);
    const target = { x: c.x, y: c.y + PRESS_INSET };
    finger.heldKeys = finger.heldKeys.filter((held) => held.code !== code);
    finger.heldKeys.push({ code, target });
    finger.targetTip = target;
    this.activeKeys.set(code, fingerCode);

    // Pulse palm-pull toward the pressed key — lets distant keys be reachable.
    this.pressForce.x = c.x - this.palmRest.x;
    this.pressForce.y = c.y - this.palmRest.y;

    return true;
  }

  releaseKey(code) {
    const key = this.layout.keys[code];
    if (!key) return false;
    const fingerCode = this.activeKeys.get(code) || key.finger;
    const finger = this.fingers[fingerCode];
    if (!finger) return false;

    finger.heldKeys = finger.heldKeys.filter((held) => held.code !== code);
    finger.targetTip = { ...finger.homeTarget };
    this.activeKeys.delete(code);
    return true;
  }

  _availableFinger(preferred, code) {
    const existing = this.activeKeys.get(code);
    if (existing) return existing;

    const start = this.fingerOrder.indexOf(preferred);
    if (start === -1) return null;
    for (let i = start; i < this.fingerOrder.length; i++) {
      const fingerCode = this.fingerOrder[i];
      const finger = this.fingers[fingerCode];
      if (finger && finger.heldKeys.length === 0) return fingerCode;
    }
    return null;
  }

  tick() {
    let distance = 0;
    let avgDx = 0, avgDy = 0, n = 0;
    let heldDx = 0, heldDy = 0, heldN = 0;
    for (const code in this.fingers) {
      const f = this.fingers[code];
      avgDx += f.targetTip.x - this.palmRest.x;
      avgDy += f.targetTip.y - this.palmRest.y;
      n++;
      if (f.heldKeys.length) {
        heldDx += f.targetTip.x - this.palmRest.x;
        heldDy += f.targetTip.y - this.palmRest.y;
        heldN++;
      }
    }
    avgDx /= n; avgDy /= n;
    if (heldN) {
      heldDx /= heldN;
      heldDy /= heldN;
    }

    this.pressForce.x *= PRESS_DECAY;
    this.pressForce.y *= PRESS_DECAY;

    const palmTargetX = this.palmRest.x + PALM_FOLLOW * avgDx + PRESS_PULL * (this.pressForce.x + heldDx);
    const palmTargetY = this.palmRest.y + PALM_FOLLOW * avgDy + PRESS_PULL * (this.pressForce.y + heldDy);

    this.palm.x += (palmTargetX - this.palm.x) * PALM_EASE;
    this.palm.y += (palmTargetY - this.palm.y) * PALM_EASE;

    for (const code in this.fingers) {
      const f = this.fingers[code];
      const prevX = f.currentTip.x;
      const prevY = f.currentTip.y;
      f.currentTip.x += (f.targetTip.x - f.currentTip.x) * TIP_EASE;
      f.currentTip.y += (f.targetTip.y - f.currentTip.y) * TIP_EASE;
      distance += Math.hypot(f.currentTip.x - prevX, f.currentTip.y - prevY);

      initChain(f.restJoints, this.palm, f.currentTip, f.lengths, this.bend);
      const poseEase = f.heldKeys.length ? ACTIVE_POSE_EASE : REST_POSE_EASE;
      for (let i = 1; i < f.joints.length - 1; i++) {
        f.joints[i].x += (f.restJoints[i].x - f.joints[i].x) * poseEase;
        f.joints[i].y += (f.restJoints[i].y - f.joints[i].y) * poseEase;
      }

      solveChain(f.joints, this.palm, f.currentTip, f.lengths);
    }

    this._render();
    return distance;
  }

  _render() {
    this.palmCircle.setAttribute('cx', this.palm.x);
    this.palmCircle.setAttribute('cy', this.palm.y);

    for (const code in this.fingers) {
      const f = this.fingers[code];
      const j = f.joints;
      const n = f.lengths.length;
      for (let i = 0; i < n; i++) {
        const a = j[i], b = j[i + 1];
        f.bones[i].setAttribute('x1', a.x);
        f.bones[i].setAttribute('y1', a.y);
        f.bones[i].setAttribute('x2', b.x);
        f.bones[i].setAttribute('y2', b.y);
      }
      for (let i = 0; i < n - 1; i++) {
        const p = j[i + 1];
        f.jointEls[i].setAttribute('cx', p.x);
        f.jointEls[i].setAttribute('cy', p.y);
      }
      const tip = j[n];
      f.tCircle.setAttribute('cx', tip.x);
      f.tCircle.setAttribute('cy', tip.y);
    }
  }
}

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}
