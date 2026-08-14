// Keyboard, mouse and touch, flattened to one set of named actions.
//
// Nothing above this file knows what a key is: the game asks whether MOVE_LEFT
// is held or STANCE_DOWN was just pressed, and the same question is answered by
// a keyboard, a thumb on the left half of a phone, or a mouse button.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'fire',
  KeyR: 'reload',
  KeyC: 'stance',
  KeyQ: 'prone',
  Digit1: 'w1', Digit2: 'w2', Digit3: 'w3',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  F1: 'debug',
  Enter: 'start', NumpadEnter: 'start',
};

export function makeInput(canvas) {
  const held = new Set();
  const edges = new Set();
  const input = {
    held,
    mouse: { x: 0, y: 0, active: false, down: false },
    touch: { stick: 0, fire: false, active: false },
    down: (a) => held.has(a),
    /** True once per press -- consumed, so two callers cannot both see it. */
    hit: (a) => (edges.delete(a) ? true : false),
    flush: () => edges.clear(),
  };

  const press = (a) => { if (!held.has(a)) edges.add(a); held.add(a); };
  const release = (a) => { held.delete(a); };

  addEventListener('keydown', (e) => {
    const a = KEYMAP[e.code];
    if (!a) return;
    if (!e.repeat) press(a);
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F1') e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    const a = KEYMAP[e.code];
    if (a) release(a);
  });
  addEventListener('blur', () => { held.clear(); edges.clear(); });

  // --- mouse. Moving it takes over the aim; the keyboard takes it back.
  const toCanvas = (ev) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * canvas.width,
      y: ((ev.clientY - r.top) / r.height) * canvas.height,
    };
  };
  canvas.addEventListener('mousemove', (e) => {
    const p = toCanvas(e);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.active = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    const p = toCanvas(e);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.active = true;
    if (e.button === 0) { input.mouse.down = true; press('fire'); }
    if (e.button === 2) press('stance');
    e.preventDefault();
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) { input.mouse.down = false; release('fire'); }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- touch. Left half steers, right half shoots, corner pads do the rest.
  const pads = [];
  const touches = new Map();
  const layout = () => {
    const w = canvas.width;
    const h = canvas.height;
    pads.length = 0;
    pads.push({ a: 'run', x: w - 300, y: h - 120, r: 52, label: 'CORRE' });
    pads.push({ a: 'stance', x: w - 180, y: h - 120, r: 52, label: 'AGACHA' });
    pads.push({ a: 'reload', x: w - 60, y: h - 120, r: 52, label: 'RECARGA' });
  };
  layout();
  input.pads = pads;

  const padAt = (p) => pads.find((b) => Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.2);

  const onTouch = (e) => {
    e.preventDefault();
    input.touch.active = true;
    for (const t of e.changedTouches) {
      const p = toCanvas(t);
      if (e.type === 'touchstart') {
        const pad = padAt(p);
        if (pad) { touches.set(t.identifier, { pad }); press(pad.a); continue; }
        if (p.x > canvas.width * 0.52) {
          touches.set(t.identifier, { fire: true });
          press('fire');
        } else {
          touches.set(t.identifier, { stick: true, ox: p.x });
        }
      } else if (e.type === 'touchmove') {
        const rec = touches.get(t.identifier);
        if (rec?.stick) input.touch.stick = Math.max(-1, Math.min(1, (p.x - rec.ox) / 70));
      } else {
        const rec = touches.get(t.identifier);
        if (rec?.stick) input.touch.stick = 0;
        if (rec?.fire) release('fire');
        if (rec?.pad) release(rec.pad.a);
        touches.delete(t.identifier);
      }
    }
    input.touch.fire = held.has('fire');
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    canvas.addEventListener(type, onTouch, { passive: false });
  }

  input.relayout = layout;
  return input;
}

/** Left/right as one axis, keyboard and thumb-stick folded together. */
export function moveAxis(input) {
  let ax = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
  if (!ax && Math.abs(input.touch.stick) > 0.15) ax = input.touch.stick;
  return Math.max(-1, Math.min(1, ax));
}
