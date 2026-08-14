// Everything that makes a shot feel like a shot and nothing that changes the
// fight: flashes, casings, dust, blood, decals, shake and the few frames of
// frozen time that sell a kill.
//
// All of it is in world metres, like the simulation, so an ejected shell lands
// where a shell would land.

import { WORLD, PX_PER_M, FEEL } from './tuning.js';

const MAX_DECALS = 90;

export function makeFx() {
  return {
    flashes: [],
    sparks: [],
    casings: [],
    decals: [],
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    hitstop: 0,
    marks: [],     // impact sprites from the art, keyed by material
  };
}

export function flash(fx, x, y, facing, size) {
  fx.flashes.push({ x, y, facing, size, t: 0, life: 0.06 + size * 0.02 });
}

export function shake(fx, amount) {
  fx.shake = Math.min(14, fx.shake + amount);
}

export function hitstop(fx, seconds) {
  fx.hitstop = Math.max(fx.hitstop, seconds);
}

/** A hit on hard cover or the ground: the art's impact sprite plus loose dust. */
export function mark(fx, x, y, material, dir) {
  fx.marks.push({ x, y, material, i: (Math.random() * 5) | 0, t: 0, life: 0.28 });
  const n = material === 'metal' ? 7 : 5;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (0.15 + Math.random() * 0.7) * (dir < 0 ? 1 : -1) + (dir < 0 ? 0 : Math.PI);
    const s = 2 + Math.random() * 5;
    fx.sparks.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.abs(Math.sin(a)) * s * 0.8 + 1,
      t: 0,
      life: 0.3 + Math.random() * 0.5,
      size: 0.02 + Math.random() * 0.05,
      hot: material === 'metal' && Math.random() < 0.5,
      colour: material === 'dirt' ? '#7a5233' : material === 'metal' ? '#b9bcc4' : '#9d9384',
    });
  }
  if (material !== 'metal' && Math.random() < 0.5) addDecal(fx, x, 0, 0.12, 0.18);
}

export function blood(fx, x, y, dir, power) {
  for (let i = 0; i < 6 + power * 6; i++) {
    const a = (Math.random() - 0.5) * 1.5;
    const s = 2 + Math.random() * 6 * (0.5 + power);
    fx.sparks.push({
      x, y,
      vx: Math.cos(a) * s * dir,
      vy: Math.sin(a) * s + 1.5,
      t: 0,
      life: 0.35 + Math.random() * 0.4,
      size: 0.03 + Math.random() * 0.05,
      colour: '#8e1d1d',
      wet: true,
    });
  }
}

export function addDecal(fx, x, y, w, h, colour = 'rgba(28,20,14,0.5)') {
  fx.decals.push({ x, y, w, h, colour, t: 0 });
  if (fx.decals.length > MAX_DECALS) fx.decals.shift();
}

export function casing(fx, x, y, facing) {
  fx.casings.push({
    x, y,
    vx: -facing * (1.4 + Math.random() * 1.2),
    vy: 2.4 + Math.random() * 1.4,
    ang: Math.random() * 6.28,
    spin: (Math.random() - 0.5) * 26,
    t: 0,
    life: 3.5,
    rest: false,
  });
}

export function updateFx(fx, dt) {
  fx.hitstop = Math.max(0, fx.hitstop - dt);

  fx.shake = Math.max(0, fx.shake - fx.shake * 9 * dt - 1.5 * dt);
  const s = fx.shake;
  fx.shakeX = (Math.random() - 0.5) * s * 2;
  fx.shakeY = (Math.random() - 0.5) * s * 1.4;

  fx.flashes = fx.flashes.filter((f) => (f.t += dt) < f.life);
  fx.marks = fx.marks.filter((mk) => (mk.t += dt) < mk.life);

  fx.sparks = fx.sparks.filter((p) => {
    p.t += dt;
    p.vy -= WORLD.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      if (p.wet && Math.random() < 0.35) addDecal(fx, p.x, 0, 0.1, 0.1, 'rgba(78,14,14,0.45)');
      return false;
    }
    return p.t < p.life;
  });

  for (const c of fx.casings) {
    c.t += dt;
    if (c.rest) continue;
    c.vy -= WORLD.gravity * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.ang += c.spin * dt;
    if (c.y <= 0.02) {
      c.y = 0.02;
      c.vy *= -0.32;
      c.vx *= 0.55;
      c.spin *= 0.4;
      if (Math.abs(c.vy) < 0.5) { c.rest = true; c.vy = 0; c.vx = 0; }
    }
  }
  fx.casings = fx.casings.filter((c) => c.t < c.life + (c.rest ? 4 : 0));
}

/** Camera shake, in pixels, for the renderer to translate by. */
export const shakeOffset = (fx) => ({ x: fx.shakeX * PX_PER_M * 0.02, y: fx.shakeY * PX_PER_M * 0.02 });

export const kickFor = (weapon) => weapon.kick * FEEL.shakeShot;
