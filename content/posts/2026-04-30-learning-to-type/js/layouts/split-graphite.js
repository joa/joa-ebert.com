// Split ergo keyboard with the Graphite layout.
// Geometry derived from keyboard_split.svg.
//
// Letter rows (Graphite):
//   B L D W Z   ' F O U J
//   N R T S G   Y H A E I
//   Q X M C V   K P , . /
//
// Column-to-finger (each side, outer -> inner):
//   col 0: pinky | col 1: ring | col 2: middle | col 3: index | col 4: index-inner | col 5: index-extra

const SVG_W = 1000, SVG_H = 480;

// LEFT half: outer translate(40, 30). Each column has its own translate.
// RIGHT half: translate(960, 30) scale(-1, 1) — geometry mirrors x.
const LEFT_BASE_X = 40;
const BASE_Y      = 50;
const COL_X       = [0, 58, 116, 174, 232, 290, 390];
const COL_Y_OFF   = [0, 0, -10, -20, -10, 0, 0];
const ROW_Y       = [0, 58, 116, 174, 232]; // local row offsets within a column
const KEY_W = 50, KEY_H = 50;

const leftXY = (col, row) => ({
  x: LEFT_BASE_X + COL_X[col],
  y: BASE_Y + COL_Y_OFF[col] + ROW_Y[row],
});
const rightXY = (col, row) => ({
  x: SVG_W - 40 - COL_X[col] - KEY_W,   // 960 - col_x - w
  y: BASE_Y + COL_Y_OFF[col] + ROW_Y[row],
});

const k = (col, row, finger, side) => {
  const { x, y } = side === 'L' ? leftXY(col, row) : rightXY(col, row);
  return { x, y, w: KEY_W, h: KEY_H, finger };
};

// Thumb cluster transform: rotate(-60), then translate. cos(-60)=0.5, sin(-60)=-√3/2.
const COS = 0.5;
const SIN = -0.8660254;

// LEFT thumb cluster: outer translate(40,30) + inner translate(240,348) rotate(-60)
//   combined translate = (280, 378) before rotation.
function leftThumb(localX, localY, lw, lh) {
  const cx = localX + lw / 2;
  const cy = localY + lh / 2;
  return {
    x: localX, y: localY, w: lw, h: lh,    // unrotated rect (informational)
    center: {
      x: COS * cx - SIN * cy + 282 + 40,        // SVG rotate matrix: cos*x - sin*y
      y: SIN * cx + COS * cy + 350 + 30,        //                    sin*x + cos*y
    },
  };
}

// RIGHT thumb cluster: outer translate(960,30) scale(-1,1) + inner translate(240,348) rotate(-60).
// Final mapping for a local point (x,y):
//   1) rotate(-60):    (cos*x - sin*y, sin*x + cos*y)
//   2) translate +240, +348
//   3) scale x by -1
//   4) translate +960, +30
function rightThumb(localX, localY, lw, lh) {
  const cx = localX + lw / 2;
  const cy = localY + lh / 2;
  const rx = COS * cx - SIN * cy;
  const ry = SIN * cx + COS * cy;
  return {
    x: localX, y: localY, w: lw, h: lh,
    center: {
      x: 960 - (rx + 282),
      y: ry + 350 + 30,
    },
  };
}

const lt = (lx, ly, lw, lh, finger) => ({ ...leftThumb(lx, ly, lw, lh), finger });
const rt = (lx, ly, lw, lh, finger) => ({ ...rightThumb(lx, ly, lw, lh), finger });

// Finger per side: outer-to-inner = pinky, ring, middle, index, index, index
const COL_FINGER = ['P', 'P', 'R', 'M', 'I', 'I', 'I'];
const fingerCode = (side, col) => side + COL_FINGER[col];

// Big thumb keys (key 4 of each cluster) — used as thumb home positions
const L_THUMB_BIG = leftThumb(0, 0, 60, 50).center;
const R_THUMB_BIG = rightThumb(0, 0, 60, 50).center;

// Build letter / number / inner-column / mod-row keys
const keys = {};

// Row 0 — number row, cols 0-4 each side
const NUM_LEFT  = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const NUM_RIGHT = ['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
NUM_LEFT.forEach((code, i)  => {
  const col = 1 + i
  keys[code] = k(col, 0, fingerCode('L', col), 'L');
});
// On the right side col 4 is innermost, col 0 is outermost; Graphite numbers go 6 7 8 9 0 inner->outer
NUM_RIGHT.forEach((code, i) => {
  const col = 5 - i;          // i=0 (Digit6) -> col 4, i=4 (Digit0) -> col 0
  keys[code] = k(col, 0, fingerCode('R', col), 'R');
});

// Row 1 — top letter row: B L D W Z | ' F O U J
const ROW1_LEFT  = ['KeyB', 'KeyL', 'KeyD', 'KeyW', 'KeyZ'];
const ROW1_RIGHT = ['Quote', 'KeyF', 'KeyO', 'KeyU', 'KeyJ'];   // inner -> outer
ROW1_LEFT.forEach((code, i)  => {
  const col = 1 + i
  keys[code] = k(col, 1, fingerCode('L', col), 'L');
});
ROW1_RIGHT.forEach((code, i) => {
  const col = 5 - i;
  keys[code] = k(col, 1, fingerCode('R', col), 'R');
});

// Row 2 — home row: N R T S G | Y H A E I
const ROW2_LEFT  = ['KeyN', 'KeyR', 'KeyT', 'KeyS', 'KeyG'];
const ROW2_RIGHT = ['KeyY', 'KeyH', 'KeyA', 'KeyE', 'KeyI'];
ROW2_LEFT.forEach((code, i)  => {
  const col = 1 + i
  keys[code] = k(col, 2, fingerCode('L', col), 'L');
});
ROW2_RIGHT.forEach((code, i) => {
  const col = 5 - i;
  keys[code] = k(col, 2, fingerCode('R', col), 'R');
});

// Row 3 — bottom letter row: Q X M C V | K P , . /
const ROW3_LEFT  = ['KeyQ', 'KeyX', 'KeyM', 'KeyC', 'KeyV'];
const ROW3_RIGHT = ['KeyK', 'KeyP', 'Comma', 'Period', 'Slash'];
ROW3_LEFT.forEach((code, i)  => {
  const col = 1 + i
  keys[code] = k(col, 3, fingerCode('L', col), 'L');
});
ROW3_RIGHT.forEach((code, i) => {
  const col = 5 - i;
  keys[code] = k(col, 3, fingerCode('R', col), 'R');
});

// Row 4 — modifier row, cols 0-3 each side (col 4 absent, col 5 absent at this row)
const ROW4_LEFT  = ['ControlLeft', 'ControlLeft', 'MetaLeft', 'AltLeft'];
const ROW4_RIGHT = ['AltRight', 'MetaRight', 'ControlRight', 'ControlRight'];  // col 3 -> col 0
ROW4_LEFT.forEach((code, i)  => {
  const col = i
  keys[code] = k(col, 4, fingerCode('L', col), 'L');
});
ROW4_RIGHT.forEach((code, i) => {
  const col = 3 - i;          // 'AltRight' -> col 3, 'ShiftRight' -> col 0
  keys[code] = k(col, 4, fingerCode('R', col), 'R');
});

// Inner column (col 5) — only 3 rows. Used for symbols / brackets.
keys['Backquote']    = k(5, 0, fingerCode('L', 5), 'L');
keys['Backslash']    = k(5, 1, fingerCode('L', 5), 'L');
keys['BracketLeft']  = k(5, 2, fingerCode('L', 5), 'L');
keys['Equal']        = k(5, 0, fingerCode('R', 5), 'R');
keys['Minus']        = k(5, 1, fingerCode('R', 5), 'R');
keys['BracketRight'] = k(5, 2, fingerCode('R', 5), 'R');

// Thumb clusters
keys['ShiftLeft']   = lt( 0,   0, 60,  50, 'LT');
keys['ShiftRight']  = lt( 0,   0, 60,  50, 'LT');
keys['Backspace']   = lt( 0,  58, 60,  50, 'LT');
keys['Escape']      = lt( 0, 116, 60,  50, 'LT');

keys['Space']       = rt( 0,   0, 60,  50, 'RT');
keys['Enter']       = rt( 0,  58, 60,  50, 'RT');
//keys['ContextMenu'] = rt( 0,   0, 60,  50, 'RT');
keys['CapsLock']    = rt( 0,  58, 60,  50, 'RT');
keys['NumLock']     = rt( 0, 116, 60,  50, 'RT');
//keys['Enter']       = rt(68,   0, 60, 108, 'RT');

export const SPLIT_GRAPHITE = {
  name: 'SPLIT / GRAPHITE',
  svgId: 'kbd-split',
  viewBox: { x: 0, y: 0, w: 1000, h: 480 },

  hands: {
    L: {
      palm: { x: 200, y: 400 },
      // Home keys for Graphite home row + thumb on Space (big left thumb key)
      homeKeys: { LP: 'KeyN', LR: 'KeyR', LM: 'KeyT', LI: 'KeyS', LT: 'ShiftLeft' },
    },
    R: {
      palm: { x: 820, y: 400 },
      homeKeys: { RI: 'KeyH', RM: 'KeyA', RR: 'KeyE', RP: 'KeyI', RT: 'Space' },
    },
  },

  keys,
};
