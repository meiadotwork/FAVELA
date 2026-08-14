// Keyboard, mouse and touch, flattened to one set of named actions.
//
// Nothing above this file knows what a key is: the game asks whether `left` is
// held or `reload` was just pressed, and the same question is answered by a
// keyboard, a mouse, or a thumb on a phone.
//
// On touch the left of the screen is an invisible pair of walk zones -- the
// near half walks left, the far half walks right, and sliding a thumb between
// them switches direction without lifting it -- while the right of the screen
// carries the buttons, which are drawn by the HUD from the same table used to
// hit-test them, so what you press is always what you see.

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
  Digit1: 'w1', Digit2: 'w2', Digit3: 'w3',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'mute',
  F1: 'debug',
  Enter: 'start', NumpadEnter: 'start',
};

/** How far across the screen the invisible walk zones reach. */
const WALK_ZONE = 0.42;

export function makeInput(canvas) {
  const keys = new Set();      // held on the keyboard or mouse
  const touched = new Set();   // held by a finger, recomputed every touch event
  const edges = new Set();
  const touches = new Map();   // identifier -> the action that finger is on

  const input = {
    mouse: { x: 0, y: 0, active: false, down: false },
    touch: { active: false },
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
  addEventListener('blur', () => { keys.clear(); touched.clear(); touches.clear(); edges.clear(); });

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
  // The buttons live on the right, where a right thumb rests, and every one of
  // them is transparent: this is a screen you are trying to see through.
  const layout = () => {
    const w = canvas.width;
    const h = canvas.height;
    input.pads = [
      { a: 'fire', x: w - 150, y: h - 160, r: 86, label: 'TIRO' },
      { a: 'stance', x: w - 310, y: h - 108, r: 58, label: 'AGACHA' },
      { a: 'reload', x: w - 160, y: h - 344, r: 54, label: 'CARREGA' },
      { a: 'swap', x: w - 320, y: h - 268, r: 50, label: 'ARMA' },
      { a: 'run', x: w - 455, y: h - 100, r: 46, label: 'CORRE' },
    ];
  };
  layout();
  input.relayout = layout;

  const padAt = (p) => input.pads.find((b) => Math.hypot(p.x - b.x, p.y - b.y) < b.r * 1.12);

  /** What a finger at this point is asking for. */
  const actionAt = (p) => {
    const pad = padAt(p);
    if (pad) return pad.a;
    if (p.x < canvas.width * WALK_ZONE) {
      return p.x < canvas.width * (WALK_ZONE / 2) ? 'left' : 'right';
    }
    return 'fire';           // anywhere on the open right is also the trigger
  };

  const onTouch = (e) => {
    e.preventDefault();
    input.touch.active = true;
    input.mouse.active = false;

    for (const t of e.changedTouches) {
      if (e.type === 'touchend' || e.type === 'touchcancel') {
        touches.delete(t.identifier);
      } else {
        // Re-read the action on every move, so sliding from the left zone into
        // the right one turns you round instead of sticking.
        touches.set(t.identifier, actionAt(toCanvas(t)));
      }
    }

    // Rebuild what is held from the fingers currently down, and fire an edge
    // for anything that has just appeared.
    const now = new Set(touches.values());
    for (const a of now) if (!touched.has(a)) edges.add(a);
    touched.clear();
    for (const a of now) touched.add(a);
  };
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    document.addEventListener(type, onTouch, { passive: false });
  }

  return input;
}

/** Left and right as one axis, whichever hand is driving. */
export function moveAxis(input) {
  return (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
}

/** Any input at all, for the title and death screens. */
export function anyPress(input) {
  return input.hit('start') || input.hit('fire') || input.hit('left') || input.hit('right');
}
