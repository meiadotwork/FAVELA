// The on-screen controls and the readout.
//
// Buttons drive the same named actions the keyboard does (input.js), so there
// is one set of commands and no second code path to keep in step. A hold button
// is down for as long as a finger or a mouse is on it -- and is released on
// pointercancel and on losing the window too, or a dragged finger leaves the
// player walking into the distance for ever.

import { setAction } from '../input.js';
import { CLIP_NAMES, clipFrames } from '../anim.js';

export function initPad() {
  for (const el of document.querySelectorAll('[data-hold]')) bindHold(el, el.dataset.hold);
  for (const el of document.querySelectorAll('[data-tap]')) bindTap(el, el.dataset.tap);
}

function bindHold(el, action) {
  const down = (e) => {
    e.preventDefault();
    el.classList.add('down');
    setAction(action, true);
    el.setPointerCapture?.(e.pointerId);
  };
  const up = () => {
    el.classList.remove('down');
    setAction(action, false);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  addEventListener('blur', up);
}

/**
 * A tap button. Stance changes are edge-triggered, so the action is raised for
 * one frame and dropped by the loop -- holding the button does not cycle.
 */
function bindTap(el, action) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('down');
    setAction(action, true);
    setTimeout(() => {
      setAction(action, false);
      el.classList.remove('down');
    }, 60);
  });
}

/** One chip per animation on the sheet, labelled with its frame count. */
export function initClipList(body, onPick) {
  const list = document.getElementById('clip-list');
  const buttons = new Map();
  for (const name of CLIP_NAMES) {
    const b = document.createElement('button');
    b.className = 'mini';
    b.textContent = `${name} ${clipFrames(body.key, name).length}`;
    b.addEventListener('click', () => onPick(name));
    list.appendChild(b);
    buttons.set(name, b);
  }
  return buttons;
}

const hud = {};

export function readout(body) {
  const set = (id, value) => {
    hud[id] = hud[id] || document.getElementById(id);
    if (hud[id].textContent !== value) hud[id].textContent = value;
  };
  const an = body.anim;
  const frames = an.frames.length;
  set('hud-clip', `${an.name} ${Math.floor(an.index) % Math.max(1, frames) + 1}/${frames}`);
  set('hud-stance', STANCE_PT[body.stance]);
  set('hud-cover', WHERE_PT[body.cover] || body.cover);
}

const STANCE_PT = { stand: 'em pé', crouch: 'agachado', prone: 'deitado' };
const WHERE_PT = {
  open: 'na rua', corner: 'na quina', behind: 'atrás da parede',
  door: 'na porta', roof: 'na laje',
};
