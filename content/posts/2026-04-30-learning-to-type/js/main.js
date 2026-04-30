import { Hand } from './hand.js';
import { ISO_QWERTY }     from './layouts/iso-qwerty.js';
import { SPLIT_GRAPHITE } from './layouts/split-graphite.js';
import MOBY_DICK from './data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HALO_LIFETIME_MS = 240;
const WPM = 80;
const MS_PER_CHAR = 60000 / (WPM * 5);
const KEY_DOWN_MS = Math.min(70, MS_PER_CHAR * 0.45);

var interrupted = false;

class Board {
  constructor(layout) {
    this.layout = layout;
    this.svg = document.getElementById(layout.svgId);
    if (!this.svg) throw new Error(`SVG not found: #${layout.svgId}`);

    const vb = layout.viewBox;
    this.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Strip the original style block so external CSS owns the look.
    const innerStyle = this.svg.querySelector('style');
    if (innerStyle) innerStyle.remove();

    // Layer for highlight halos (under hands so bones draw on top).
    this.halosGroup = el('g', { class: 'halos' });
    this.svg.appendChild(this.halosGroup);

    // Layer for hands.
    this.handsGroup = el('g', { class: 'hands' });
    this.svg.appendChild(this.handsGroup);

    this.handL = new Hand({ side: 'L', palmRest: layout.hands.L.palm, layout, hostGroup: this.handsGroup });
    this.handR = new Hand({ side: 'R', palmRest: layout.hands.R.palm, layout, hostGroup: this.handsGroup });
    this.distance = 0;
    this.distanceEl = this.svg.closest('.board')?.querySelector('.distance-counter');
    this._renderDistance();
  }

  pressKey(code) {
    const key = this.layout.keys[code];
    if (!key) return false;

    // Route to the assigned finger via whichever hand owns that finger code.
    const finger = key.finger;
    const hand = finger && finger[0] === 'L' ? this.handL : this.handR;
    if (!hand.pressKey(code)) return false;

    this._spawnHalo(key);
    return true;
  }

  releaseKey(code) {
    const key = this.layout.keys[code];
    if (!key) return false;

    const finger = key.finger;
    const hand = finger && finger[0] === 'L' ? this.handL : this.handR;
    return hand.releaseKey(code);
  }

  tick() {
    this.distance += this.handL.tick() + this.handR.tick();
    this._renderDistance();
  }

  _renderDistance() {
    if (!this.distanceEl) return;
    this.distanceEl.textContent = `${Math.round(this.distance).toLocaleString()} units travelled`;
  }

  _spawnHalo(key) {
    const center = key.center || { x: key.x + key.w / 2, y: key.y + key.h / 2 };
    const halo = el('circle', {
      class: 'halo',
      cx: center.x,
      cy: center.y,
      r: Math.min(Math.max(key.w, key.h), 50.0) * 0.55,
    });
    this.halosGroup.appendChild(halo);
    // Trigger transition to faded-out state via class switch on next frame.
    requestAnimationFrame(() => halo.classList.add('halo-fade'));
    setTimeout(() => halo.remove(), HALO_LIFETIME_MS);
  }
}

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

const LETTER_CODES = {
  a: 'KeyA', b: 'KeyB', c: 'KeyC', d: 'KeyD', e: 'KeyE', f: 'KeyF',
  g: 'KeyG', h: 'KeyH', i: 'KeyI', j: 'KeyJ', k: 'KeyK', l: 'KeyL',
  m: 'KeyM', n: 'KeyN', o: 'KeyO', p: 'KeyP', q: 'KeyQ', r: 'KeyR',
  s: 'KeyS', t: 'KeyT', u: 'KeyU', v: 'KeyV', w: 'KeyW', x: 'KeyX',
  y: 'KeyY', z: 'KeyZ',
};

const CHAR_CODES = {
  ' ': { code: 'Space' },
  '\n': { code: 'Enter' },
  '\t': { code: 'Tab' },
  '.': { code: 'Period' },
  ',': { code: 'Comma' },
  '-': { code: 'Minus' },
  ';': { code: 'Semicolon' },
  "'": { code: 'Quote' },
  '/': { code: 'Slash' },
  '0': { code: 'Digit0' },
  '1': { code: 'Digit1' },
  '2': { code: 'Digit2' },
  '3': { code: 'Digit3' },
  '4': { code: 'Digit4' },
  '5': { code: 'Digit5' },
  '6': { code: 'Digit6' },
  '7': { code: 'Digit7' },
  '8': { code: 'Digit8' },
  '9': { code: 'Digit9' },
  '?': { code: 'Slash', shift: true },
  '!': { code: 'Digit1', shift: true },
  ':': { code: 'Semicolon', shift: true },
  '"': { code: 'Quote', shift: true },
  '(': { code: 'Digit9', shift: true },
  ')': { code: 'Digit0', shift: true },
};

function keyForChar(char) {
  const lower = char.toLowerCase();
  if (LETTER_CODES[lower]) {
    return { code: LETTER_CODES[lower], shift: char !== lower };
  }
  return CHAR_CODES[char] || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oppositeShiftFor(board, code) {
  const key = board.layout.keys[code];
  return key && key.finger && key.finger[0] === 'L' ? 'ShiftRight' : 'ShiftLeft';
}

async function typeCharOnBoard(board, key) {
  const shiftCode = key.shift ? oppositeShiftFor(board, key.code) : null;
  if (shiftCode) board.pressKey(shiftCode);
  board.pressKey(key.code);
  await sleep(KEY_DOWN_MS);
  board.releaseKey(key.code);
  if (shiftCode) board.releaseKey(shiftCode);
}

async function runTypingDemo(boards, display) {
  let currentWord = '';
  display.textContent = '';

  for (const char of MOBY_DICK) {
    if (interrupted) {
      return;
    }

    const key = keyForChar(char);
    if (/\s/.test(char)) {
      currentWord = '';
      display.textContent = '';
    } else {
      currentWord += char;
      display.textContent = currentWord;
    }

    if (key) {
      await Promise.all(boards.map((board) => typeCharOnBoard(board, key)));
    }
    await sleep(Math.max(0, MS_PER_CHAR - KEY_DOWN_MS));
  }
}

const NAVIGATIONAL = new Set([
  'Tab', 'Space', 'Backspace', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Slash', 'Quote',
]);

function boot() {
  const boards = [new Board(ISO_QWERTY), new Board(SPLIT_GRAPHITE)];
  const downCodes = new Set();
  const typedWord = document.getElementById('typed-word');

  window.addEventListener('keydown', (e) => {
    interrupted = true;
    if (typedWord) typedWord.textContent = e.key === " " ? "Space" : e.key;
    let consumed = false;
    if (!downCodes.has(e.code)) {
      downCodes.add(e.code);
      for (const board of boards) {
        if (board.pressKey(e.code)) consumed = true;
      }
    } else {
      consumed = boards.some((board) => Boolean(board.layout.keys[e.code]));
    }
    if (consumed && NAVIGATIONAL.has(e.code)) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    if (typedWord) typedWord.textContent = "";
    downCodes.delete(e.code);
    let consumed = false;
    for (const board of boards) {
      if (board.releaseKey(e.code)) consumed = true;
    }
    if (consumed && NAVIGATIONAL.has(e.code)) e.preventDefault();
  });

  window.addEventListener('blur', () => {
    for (const code of downCodes) {
      for (const board of boards) board.releaseKey(code);
    }
    downCodes.clear();
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;
    for (const board of boards) board.tick(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (typedWord) runTypingDemo(boards, typedWord);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
