// Keyboard and touch, flattened into one set of named actions so the rest of
// the game never asks which device it came from.

export const ACTIONS = ['left', 'right', 'up', 'down', 'run', 'fire', 'stance', 'pause'];

const KEY_MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'fire', KeyJ: 'fire',
  KeyC: 'stance', ControlLeft: 'stance', KeyK: 'stance',
  Escape: 'pause', KeyP: 'pause',
};

export const input = {
  held: Object.fromEntries(ACTIONS.map((a) => [a, false])),
  pressed: Object.fromEntries(ACTIONS.map((a) => [a, false])),
  touch: false,
  anyKey: false,
};

const held = new Set();

function set(action, down) {
  if (!action) return;
  if (down && !input.held[action]) input.pressed[action] = true;
  input.held[action] = down;
  if (down) input.anyKey = true;
}

/** Consume edge-triggered presses; call once at the end of each frame. */
export function endFrame() {
  for (const a of ACTIONS) input.pressed[a] = false;
  input.anyKey = false;
}

export function consume(action) {
  const was = input.pressed[action];
  input.pressed[action] = false;
  return was;
}

/** Drive an action from outside -- an on-screen button, or a test harness. */
export function setAction(action, down) {
  set(action, down);
}

export function initInput(canvas, onFirstInteraction = () => {}) {
  const greet = once(onFirstInteraction);
  initKeyboard(greet);
  initTouch(canvas, greet);
}

function once(fn) {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

/** Keyboard only: what a page with its own on-screen buttons wants. */
export function initKeyboard(onFirstInteraction = () => {}) {
  const greet = once(onFirstInteraction);

  addEventListener('keydown', (e) => {
    const action = KEY_MAP[e.code];
    if (action) e.preventDefault();
    if (e.repeat) return;
    greet();
    held.add(e.code);
    set(action, true);
    if (!action) input.anyKey = true;
  });

  addEventListener('keyup', (e) => {
    held.delete(e.code);
    const action = KEY_MAP[e.code];
    if (action && ![...held].some((c) => KEY_MAP[c] === action)) set(action, false);
  });

  addEventListener('blur', () => {
    held.clear();
    for (const a of ACTIONS) set(a, false);
  });
}

// Touch layout: the left half of the screen is a virtual stick whose direction
// comes from the drag vector, the right half is fire. Buttons for stance and
// run sit in the corners; hit areas are generous because the real ones are not
// drawn until the player actually touches the screen.
export const touchState = { stick: null, origin: null, fire: false, buttons: {} };

function initTouch(canvas, greet) {
  const pointers = new Map();

  const norm = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1280, y: ((e.clientY - r.top) / r.height) * 720 };
  };

  const zones = (p) => {
    if (p.x > 1280 - 190 && p.y > 720 - 190) return 'stance';
    if (p.x > 1280 - 190 && p.y > 720 - 360 && p.y <= 720 - 190) return 'run';
    return p.x < 560 ? 'stick' : 'fire';
  };

  const refresh = () => {
    let dx = 0;
    let dy = 0;
    let firing = false;
    const buttons = {};
    for (const p of pointers.values()) {
      if (p.zone === 'stick') {
        dx = p.now.x - p.origin.x;
        dy = p.now.y - p.origin.y;
        touchState.origin = p.origin;
        touchState.stick = { x: dx, y: dy };
      } else if (p.zone === 'fire') firing = true;
      else buttons[p.zone] = true;
    }
    if (![...pointers.values()].some((p) => p.zone === 'stick')) {
      touchState.stick = null;
      touchState.origin = null;
    }
    touchState.fire = firing;
    touchState.buttons = buttons;

    const dead = 26;
    set('left', dx < -dead);
    set('right', dx > dead);
    set('up', dy < -dead * 1.4);
    set('down', dy > dead * 1.4);
    set('run', !!buttons.run || Math.abs(dx) > 130);
    set('fire', firing);
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    greet();
    input.touch = e.pointerType !== 'mouse';
    const p = norm(e);
    const zone = zones(p);
    pointers.set(e.pointerId, { origin: p, now: p, zone });
    if (zone === 'stance') set('stance', true);
    input.anyKey = true;
    refresh();
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.now = norm(e);
    refresh();
  });

  const release = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (p.zone === 'stance') set('stance', false);
    pointers.delete(e.pointerId);
    refresh();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
