// Bullets.
//
// The brief for these was "bullets real fast, don't always trace them", so a
// round crosses the screen in about a fifth of a second and most of them are
// invisible while they do it. Only some rounds leave a tracer, and the tracer
// is a short streak rather than a line drawn all the way back to the muzzle --
// which is what a real one looks like, and what keeps a burst from turning the
// lane into a cat's cradle.
//
// At that speed a bullet steps further in one frame than a body is wide, so it
// is never tested where it happens to land: each frame's flight is a segment,
// and the segment is what gets asked about the wall and about every target.

import { WEAPONS } from '../actors.js';
import { wallHit, targetBox, GROUND_Y } from './stage.js';

export const SPEED = 3600;          // px/s -- the lane in a fifth of a second
export const TRACER_SHARE = 0.25;   // rounds that leave a visible streak
export const TRACER_LEN = 150;
export const TRACER_LIFE = 0.075;

export const TRACER_MODES = ['alguns', 'todos', 'nenhum'];

export function makeShots() {
  return {
    bullets: [], tracers: [], sparks: [], flashes: [],
    fired: 0, hits: 0, tracerMode: 0,
  };
}

/**
 * Fire one round from a body. Straight and flat: this is a test bench, so the
 * shot goes exactly where the muzzle points and nothing steers it.
 */
export function fire(shots, from, dir, weapon = 'rifle') {
  const w = WEAPONS[weapon];
  const spread = (Math.random() - 0.5) * w.spread;
  const trace = shots.tracerMode === 1
    || (shots.tracerMode === 0 && Math.random() < TRACER_SHARE);
  shots.bullets.push({
    x: from.x,
    y: from.y,
    vx: dir * SPEED,
    vy: spread * SPEED,
    dmg: w.dmg,
    life: 0.9,
    trace,
  });
  shots.flashes.push({ x: from.x, y: from.y, t: 0.05, dir });
  shots.fired++;
}

export function updateShots(shots, stage, dt) {
  for (const t of stage.targets) t.flash = Math.max(0, t.flash - dt);

  for (const b of shots.bullets) {
    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;

    const wall = wallHit(stage, b.x, b.y, nx, ny);
    const target = firstTarget(stage, b, nx, ny);

    // Whichever comes first along this frame's flight.
    let stop = null;
    if (wall && target) stop = wall.t <= target.t ? wall : target;
    else stop = wall || target;

    if (b.trace) {
      shots.tracers.push({
        x0: b.x, y0: b.y,
        x1: stop ? stop.x : nx, y1: stop ? stop.y : ny,
        dir: Math.sign(b.vx), t: TRACER_LIFE,
      });
    }

    if (stop) {
      b.life = 0;
      if (stop.target) {
        stop.target.hits++;
        stop.target.flash = 0.35;
        shots.hits++;
        burst(shots, stop.x, stop.y, -Math.sign(b.vx), '#e8d9b0');
      } else {
        burst(shots, stop.x, stop.y, -Math.sign(b.vx), '#cfc6b4');
      }
      shots.lastImpact = { x: stop.x, y: stop.y, kind: stop.target ? 'alvo' : 'parede' };
      continue;
    }

    b.x = nx;
    b.y = ny;
    b.life -= dt;
    if (b.y >= GROUND_Y) {
      b.life = 0;
      burst(shots, b.x, GROUND_Y, -Math.sign(b.vx), '#9c8a6d');
    }
  }
  shots.bullets = shots.bullets.filter((b) => b.life > 0);

  for (const t of shots.tracers) t.t -= dt;
  shots.tracers = shots.tracers.filter((t) => t.t > 0);

  for (const f of shots.flashes) f.t -= dt;
  shots.flashes = shots.flashes.filter((f) => f.t > 0);

  for (const p of shots.sparks) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 780 * dt;
  }
  shots.sparks = shots.sparks.filter((p) => p.life > 0);
}

/** The first target the segment crosses, with where along it that happened. */
function firstTarget(stage, b, nx, ny) {
  let best = null;
  for (const t of stage.targets) {
    const box = targetBox(t);
    const entering = (b.x <= box.x1 && nx >= box.x0) || (b.x >= box.x0 && nx <= box.x1);
    if (!entering) continue;
    const edge = b.vx > 0 ? box.x0 : box.x1;
    const at = Math.max(0, Math.min(1, (edge - b.x) / (nx - b.x || 1)));
    const y = b.y + (ny - b.y) * at;
    if (y < box.y0 || y > box.y1) continue;
    if (!best || at < best.t) best = { t: at, x: b.x + (nx - b.x) * at, y, target: t };
  }
  return best;
}

function burst(shots, x, y, dir, color) {
  for (let i = 0; i < 6; i++) {
    shots.sparks.push({
      x, y,
      vx: dir * (60 + Math.random() * 260),
      vy: (Math.random() - 0.65) * 220,
      life: 0.16 + Math.random() * 0.22,
      max: 0.38,
      size: 1 + Math.random() * 2.4,
      color,
    });
  }
}
