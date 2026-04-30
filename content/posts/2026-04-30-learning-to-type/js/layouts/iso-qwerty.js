// ISO keyboard with standard QWERTY touch-typing finger assignment.
// Coordinates correspond to keyboard_iso.svg. The viewBox is extended below
// the original 320 to leave room for hands.

const k = (x, y, w, h, finger) => ({ x, y, w, h, finger });

export const ISO_QWERTY = {
  name: 'ISO / QWERTY',
  svgId: 'kbd-iso',
  viewBox: { x: 0, y: 0, w: 900, h: 380 },

  hands: {
    L: {
      palm: { x: 220, y: 380 },
      homeKeys: {
        LP: 'KeyA', LR: 'KeyS', LM: 'KeyD', LI: 'KeyF',
        LT: { x: 340, y: 268 }, // hover above the left side of space
      },
    },
    R: {
      palm: { x: 620, y: 380 },
      homeKeys: {
        RI: 'KeyJ', RM: 'KeyK', RR: 'KeyL', RP: 'Semicolon',
        RT: 'Space', // hover above the right side of space
      },
    },
  },

  keys: {
    // Row 1 — number row (y=10, h=50)
    Backquote: k( 10, 10, 70, 50, 'LP'),
    Digit1:    k( 88, 10, 50, 50, 'LP'),
    Digit2:    k(146, 10, 50, 50, 'LR'),
    Digit3:    k(204, 10, 50, 50, 'LM'),
    Digit4:    k(262, 10, 50, 50, 'LI'),
    Digit5:    k(320, 10, 50, 50, 'LI'),
    Digit6:    k(378, 10, 50, 50, 'RI'),
    Digit7:    k(436, 10, 50, 50, 'RI'),
    Digit8:    k(494, 10, 50, 50, 'RM'),
    Digit9:    k(552, 10, 50, 50, 'RR'),
    Digit0:    k(610, 10, 50, 50, 'RP'),
    Minus:     k(668, 10, 50, 50, 'RP'),
    Equal:     k(726, 10, 50, 50, 'RP'),
    Backspace: k(784, 10, 90, 50, 'RP'),

    // Row 2 — Q row (y=68, h=50)
    Tab:          k( 10, 68, 90, 50, 'LP'),
    KeyQ:         k(108, 68, 50, 50, 'LP'),
    KeyW:         k(166, 68, 50, 50, 'LR'),
    KeyE:         k(224, 68, 50, 50, 'LM'),
    KeyR:         k(282, 68, 50, 50, 'LI'),
    KeyT:         k(340, 68, 50, 50, 'LI'),
    KeyY:         k(398, 68, 50, 50, 'RI'),
    KeyU:         k(456, 68, 50, 50, 'RI'),
    KeyI:         k(514, 68, 50, 50, 'RM'),
    KeyO:         k(572, 68, 50, 50, 'RR'),
    KeyP:         k(630, 68, 50, 50, 'RP'),
    BracketLeft:  k(688, 68, 50, 50, 'RP'),
    BracketRight: k(746, 68, 50, 50, 'RP'),

    // ISO Enter — L-shaped path; use a representative target near the upper rect.
    Enter: { x: 844, y: 68, w: 50, h: 108, finger: 'RP', center: { x: 869, y: 122 } },

    // Row 3 — home row (y=126, h=50)
    CapsLock:  k( 10, 126, 110, 50, 'LP'),
    KeyA:      k(128, 126, 50, 50, 'LP'),
    KeyS:      k(186, 126, 50, 50, 'LR'),
    KeyD:      k(244, 126, 50, 50, 'LM'),
    KeyF:      k(302, 126, 50, 50, 'LI'),
    KeyG:      k(360, 126, 50, 50, 'LI'),
    KeyH:      k(418, 126, 50, 50, 'RI'),
    KeyJ:      k(476, 126, 50, 50, 'RI'),
    KeyK:      k(534, 126, 50, 50, 'RM'),
    KeyL:      k(592, 126, 50, 50, 'RR'),
    Semicolon: k(650, 126, 50, 50, 'RP'),
    Quote:     k(708, 126, 50, 50, 'RP'),
    // ISO has Enter to the right; the Backslash/# rectangle here is the ISO hash key.
    Backslash: k(766, 126, 50, 50, 'RP'),

    // Row 4 — Z row (y=184, h=50)
    ShiftLeft:     k( 10, 184, 90, 50, 'LP'),
    IntlBackslash: k(108, 184, 50, 50, 'LP'),
    KeyZ:          k(166, 184, 50, 50, 'LP'),
    KeyX:          k(224, 184, 50, 50, 'LR'),
    KeyC:          k(282, 184, 50, 50, 'LM'),
    KeyV:          k(340, 184, 50, 50, 'LI'),
    KeyB:          k(398, 184, 50, 50, 'LI'),
    KeyN:          k(456, 184, 50, 50, 'RI'),
    KeyM:          k(514, 184, 50, 50, 'RI'),
    Comma:         k(572, 184, 50, 50, 'RM'),
    Period:        k(630, 184, 50, 50, 'RR'),
    Slash:         k(688, 184, 50, 50, 'RP'),
    ShiftRight:    k(746, 184,128, 50, 'RP'),

    // Row 5 — bottom row (y=242, h=50)
    ControlLeft:  k( 10, 242, 90, 50, 'LP'),
    MetaLeft:     k(108, 242, 70, 50, 'LP'),
    AltLeft:      k(186, 242, 70, 50, 'LT'),
    Space:        k(300, 242,356, 50, 'RT'),
    AltRight:     k(628, 242, 70, 50, 'RT'),
    ContextMenu:  k(706, 242, 70, 50, 'RP'),
    ControlRight: k(784, 242, 90, 50, 'RP'),
  },
};
