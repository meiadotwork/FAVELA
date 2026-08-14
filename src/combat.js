// Rounds in flight, and everything they can run into.
//
// A bullet is a swept segment, tested against cover and bodies in the same
// tick, nearest hit wins. Nothing is a point sample, so nothing tunnels: a
// pellet crossing the lane at 95 m/s still finds the car door it should hit.

import { WORLD, SUPPRESSION, BODY } from './tuning.js';
import { traceCover, groundAt } from './world.js';
import { damageActor, zoneAt, hitbox, bodyHeight, posX } from './actor.js';

// Where to aim on a body, tried in order: centre mass first, then the parts
// that stick up over cover, then the parts under it. A man peeking over a wall
// is a head and a pair of shoulders, and this is what finds them -- which is
// also why peeking costs so much, since a head is worth two and a half hits.
const AIM_POINTS = [0.62, 0.74, 0.88, 0.45, 0.28];

/**
 * The highest-value point on a target that can actually be hit from `from`,
 * or null if the whole body is behind something.
 */
export function aimPoint(arena, from, target) {
  const h = bodyHeight(target);
  const x = posX(target);
  for (const f of AIM_POINTS) {
    const y = target.y + h * f;
    if (!traceCover(arena, from.x, from.y, x, y)) return { x, y };
  }
  return null;
}

export function makeBullet(o) {
  const n = Math.hypot(o.dx, o.dy) || 1;
  return {
    x: o.x, y: o.y,
    px: o.x, py: o.y,
    dx: o.dx / n, dy: o.dy / n,
    speed: o.speed,
    damage: o.damage,
    near: o.near, far: o.far,
    weapon: o.weapon,
    owner: o.owner, team: o.team,
    dist: 0,
    life: WORLD.bulletLife,
    dead: false,
  };
}

/** Where a segment first crosses an axis-aligned box, or -1 if it misses. */
function segBox(x0, y0, x1, y1, b) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q, lo, hi] of [[dx, x0, b.x0, b.x1], [dy, y0, b.y0, b.y1]]) {
    if (Math.abs(p) < 1e-9) {
      if (q < lo || q > hi) return -1;
      continue;
    }
    let a = (lo - q) / p;
    let c = (hi - q) / p;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return -1;
  }
  return t1 < 0 || t0 > 1 ? -1 : Math.max(0, t0);
}

/** Distance from a body's centre line to the path of a round, for suppression. */
function nearMiss(x0, y0, x1, y1, a) {
  const cx = posX(a);
  const cy = a.y + bodyHeight(a) * 0.6;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cy - y0) * dy) / len2));
  return Math.hypot(x0 + dx * t - cx, y0 + dy * t - cy);
}

/** Full damage inside `near`, a quarter at `far`, and nothing past it. */
function falloff(b) {
  if (b.dist <= b.near) return 1;
  if (b.dist >= b.far) return 0;
  return 1 - 0.75 * ((b.dist - b.near) / (b.far - b.near));
}

export function stepBullets(game, dt) {
  const { arena, actors } = game;
  const live = [];

  for (const b of game.bullets) {
    b.life -= dt;
    if (b.life <= 0) continue;

    const step = b.speed * dt;
    b.px = b.x;
    b.py = b.y;
    const nx = b.x + b.dx * step;
    const ny = b.y + b.dy * step;

    let hit = null;

    // Bodies. A round passes through its own side -- crews do not shoot each
    // other in the back, and the alley is crowded enough already.
    for (const a of actors) {
      if (!a.alive || a.id === b.owner || a.team === b.team) continue;
      const t = segBox(b.x, b.y, nx, ny, hitbox(a));
      if (t >= 0 && (!hit || t < hit.t)) hit = { t, actor: a };
    }

    // Cover.
    const cov = traceCover(arena, b.x, b.y, nx, ny);
    if (cov && (!hit || cov.t < hit.t)) hit = { t: cov.t, cover: cov.cover, x: cov.x, y: cov.y };

    // The ground, wherever the hill has put it under this round.
    const gy = groundAt(arena, nx);
    if (ny <= gy) {
      const drop = Math.max(1e-6, (b.y - gy) - (ny - gy));
      const t = Math.max(0, (b.y - gy) / drop);
      if (!hit || t < hit.t) hit = { t, ground: true, gy };
    }

    // Whoever it went past, on either side, gets rattled -- but only along the
    // stretch it actually flew. A round that buries itself in the wall in front
    // of a man has not gone past his ear, and must not pin him there.
    const ex = hit ? b.x + (nx - b.x) * hit.t : nx;
    const ey = hit ? b.y + (ny - b.y) * hit.t : ny;
    for (const a of actors) {
      if (!a.alive || a.id === b.owner || a.team === b.team) continue;
      if (nearMiss(b.x, b.y, ex, ey, a) < SUPPRESSION.radius) {
        a.suppression = Math.min(1.6, a.suppression + SUPPRESSION.perRound);
        if (a.player) game.onNearMiss(a);
      }
    }

    if (hit) {
      const hx = ex;
      const hy = ey;
      b.dist += step * hit.t;
      const power = falloff(b);

      if (hit.actor && power > 0) {
        const { mult, zone } = zoneAt(hit.actor, hy);
        // Only the player earns the head multiplier. A crew that headshots you
        // through its own detuned aim is not a fight, it is a coin toss.
        const worth = b.team === 'player' ? mult : Math.min(1, mult);
        const dealt = damageActor(hit.actor, b.damage * worth * power, b, game);
        game.onFlesh(hit.actor, hx, hy, zone, dealt, b);
      } else if (hit.cover) {
        game.onImpact(hx, hy, hit.cover.material, b);
      } else if (hit.ground) {
        game.onImpact(hx, hit.gy + 0.02, 'dirt', b);
      }
      continue;
    }

    b.dist += step;
    b.x = nx;
    b.y = ny;
    if (b.dist > b.far || b.x < 0 || b.x > arena.length || b.y > 40) continue;
    live.push(b);
  }

  game.bullets = live;
}

/** Is any part of this body currently shootable from there? */
export function exposed(arena, from, to) {
  return !!aimPoint(arena, from, to);
}

export const halfWidth = BODY.halfWidth;
