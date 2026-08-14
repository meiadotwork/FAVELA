// Keyboard, mouse and touch, flattened to one set of named actions.
//
// Nothing above this file knows what a key is: the game asks whether `left` is
// held or `reload` was just pressed, and the same question is answered by a
// keyboard, a mouse, or a thumb on a phone.
//
// On touch the left of the screen carries a direction ring and the right a row
// of buttons. Both are drawn by the HUD straight off the tables here, so what
// you can see is exactly what is being hit-tested. The ring is analog -- how
// far you push it is how fast you walk, and pushing it to the rim is the run --
// and the whole left of the screen grabs it, so you never have to look down to
// find it.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'fire',
  KeyR: 'reload',
  KeyC: 'stance',
  KeyE: 'swap',
  KeyZ: 'zoom',
  KeyF: 'climb',
  Digit1: 'w1', Digit2: 'w2', Digit3: 'w3',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  F1: 'debug',
  Enter: 'start', NumpadEnter: 'start',
};

/** How far across the screen a finger still counts as reaching for the ring. */
const WALK_ZONE = 0.42;

export function makeInput(canvas) {
  const keys = new Set();      // held on the keyboard or mouse
  const touched = new Set();   // held by a finger, recomputed every touch event
  const edges = new Set();
  const touches = new Map();   // identifier -> the action that finger is on
  const points = new Map();    // identifier -> where it is, for the ring

  const input = {
    mouse: { x: 0, y: 0, active: false, down: false },
    touch: { active: false },
    // The direction ring: where it sits, how far it is pushed, where the knob
    // has ended up. hud.js draws it straight off this.
    stick: { x: 0, y: 0, r: 96, axis: 0, knob: 0, active: false },
    pads: [],
    down: (a) => keys.has(a) || touched.has(a),
    /** True once per press -- consumed, so two callers cannot both see it. */
    hit: (a) => edges.delete(a),
    flush: () => edges.clear(),
  };

  const press = (a) => { if (!keys.has(a)) edges.add(a); keys.add(a); };
  const release = (a) => { keys.delete(a); };

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
  addEventListener('blur', () => {
    keys.clear(); touched.clear(); touches.clear(); points.clear(); edges.clear();
    input.stick.axis = 0;
    input.stick.active = false;
  });

  // Canvas coordinates, clamped into the picture. A 16:9 canvas on a wider
  // phone leaves black bars down the sides, and a thumb that lands on one is
  // still a thumb asking for something -- so the bars count as their edge.
  const toCanvas = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * canvas.width;
    const y = ((ev.clientY - r.top) / r.height) * canvas.height;
    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  };

  // --- mouse. Moving it takes over the aim -- but a phone that synthesises
  // mouse events from taps must not be allowed to do that.
  canvas.addEventListener('mousemove', (e) => {
    if (input.touch.active) return;
    const p = toCanvas(e);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.active = true;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (input.touch.active) return;
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

  // --- touch.
  //
  // A ring on the left for direction and a row of buttons on the right. The
  // ring is analog: how far you push it is how fast you walk, and pushing it to
  // the rim is the run, which is why there is no run button.
  const layout = () => {
    const w = canvas.width;
    const h = canvas.height;
    const y = h - 96;
    input.pads = [
      { a: 'fire', x: w - 112, y: y - 4, r: 82, label: 'TIRO' },
      { a: 'climb', x: w - 190, y: y - 150, r: 50, label: 'SOBE' },
      { a: 'reload', x: w - 268, y, r: 52, label: 'CARREGA' },
      { a: 'stance', x: w - 388, y, r: 52, label: 'AGACHA' },
      { a: 'swap', x: w - 508, y, r: 52, label: 'ARMA' },
      { a: 'zoom', x: w - 628, y, r: 52, label: 'ZOOM' },
    ];
    input.stick.x = 160;
    input.stick.y = h - 128;
    input.stick.r = 96;
  };
  layout();
  input.relayout = layout;

  const padAt = (p) => input.pads.find((b) => Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.12);

  /** What a finger at this point is asking for. */
  const actionAt = (p) => {
    const pad = padAt(p);
    if (pad) return pad.a;
    if (p.x < canvas.width * WALK_ZONE) return 'stick';
    return 'fire';           // anywhere on the open right is also the trigger
  };

  const readStick = () => {
    const s = input.stick;
    let axis = 0;
    let held = false;
    for (const [id, action] of touches) {
      if (action !== 'stick') continue;
      const p = points.get(id);
      if (!p) continue;
      held = true;
      axis = Math.max(-1, Math.min(1, (p.x - s.x) / s.r));
    }
    s.active = held;
    s.axis = held && Math.abs(axis) > 0.18 ? axis : 0;
    s.knob = s.x + s.axis * s.r;
  };

  const onTouch = (e) => {
    e.preventDefault();
    input.touch.active = true;
    input.mouse.active = false;

    for (const t of e.changedTouches) {
      if (e.type === 'touchend' || e.type === 'touchcancel') {
        touches.delete(t.identifier);
        points.delete(t.identifier);
      } else {
        const p = toCanvas(t);
        points.set(t.identifier, p);
        // A finger that started on the ring keeps the ring even if it wanders
        // off it -- that is what makes it a stick rather than a target.
        if (touches.get(t.identifier) !== 'stick' || e.type === 'touchstart') {
          touches.set(t.identifier, actionAt(p));
        }
      }
    }

    // Rebuild what is held from the fingers currently down, and fire an edge
    // for anything that has just appeared.
    const now = new Set(touches.values());
    for (const a of now) if (!touched.has(a)) edges.add(a);
    touched.clear();
    for (const a of now) touched.add(a);
    readStick();
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    document.addEventListener(type, onTouch, { passive: false });
  }

  return input;
}

/** Left and right as one axis, whichever hand is driving. */
export function moveAxis(input) {
  const keys = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
  return keys || input.stick.axis;
}

/** Pushing the ring to its rim is the sprint. */
export function stickRun(input) {
  return Math.abs(input.stick.axis) > 0.86;
}

/** Any input at all, for the title and death screens. */
export function anyPress(input) {
  return input.hit('start') || input.hit('fire') || input.hit('stick');
}
