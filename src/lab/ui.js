// The on-screen controls and the readout.
//
// Buttons drive the same named actions the keyboard does (input.js), so there
// is one set of commands and no second code path to keep in step. A hold button
// is down for as long as a finger or a mouse is on it -- and is released on
// pointercancel and on losing the window too, or a dragged finger leaves the
// player walking into the distance for ever.

import { setAction } from '../input.js';
import { CLIP_NAMES, clipFrames } from '../anim.js';
import { WEAPONS } from '../actors.js';
import { TRACER_MODES } from './shots.js';
import { GROUND_Y } from './stage.js';

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

/** The clip chips: one button per animation on the sheet. */
export function initClipList(body, onPick) {
  const list = document.getElementById('clip-list');
  const buttons = new Map();
  for (const name of CLIP_NAMES) {
    const n = clipFrames(body.key, name).length;
    const b = document.createElement('button');
    b.className = 'mini';
    b.textContent = `${name} ${n}`;
    b.addEventListener('click', () => onPick(name));
    list.appendChild(b);
    buttons.set(name, b);
  }
  return buttons;
}

export function initToggle(id, labels, onChange) {
  const el = document.getElementById(id);
  let i = 0;
  el.addEventListener('click', () => {
    i = (i + 1) % labels.length;
    el.textContent = labels[i];
    el.classList.toggle('on', i > 0);
    onChange(i);
  });
  return el;
}

export function tracerLabel(mode) {
  return `RASTRO: ${TRACER_MODES[mode].toUpperCase()}`;
}

const hud = {};

export function readout(body, shots, stage, fps) {
  const set = (id, value) => {
    hud[id] = hud[id] || document.getElementById(id);
    if (hud[id].textContent !== value) hud[id].textContent = value;
  };
  const an = body.anim;
  const frames = an.frames.length;
  set('hud-clip', an.name + (an.frozen ? ' (parado)' : ''));
  set('hud-frame', `${Math.floor(an.index) % Math.max(1, frames) + 1}/${frames}`);
  set('hud-stance', STANCE_PT[body.stance]);
  set('hud-support', supportName(body, stage));
  set('hud-cover', COVER_PT[body.cover] || body.cover);
  set('hud-ammo', body.reload > 0 ? 'recarregando'
    : `${body.ammo}/${WEAPONS[body.weapon].mag}`);
  set('hud-shots', `${shots.fired} · acertos ${shots.hits}`);
  set('hud-fps', String(Math.round(fps)));
}

const STANCE_PT = { stand: 'em pé', crouch: 'agachado', prone: 'deitado' };
const COVER_PT = {
  open: 'exposto', corner: 'na quina', behind: 'atrás da parede',
  door: 'na porta', roof: 'na laje',
};

function supportName(body, stage) {
  if (body.airborne) return 'no ar';
  if (body.climbing) return 'subindo';
  if (body.y <= stage.house.roofY + 2) return 'laje';
  // On the stairs only when actually standing on a tread, not merely walking
  // past their foot on the street.
  if (body.y < GROUND_Y - 4) return 'escada';
  return 'chão';
}
