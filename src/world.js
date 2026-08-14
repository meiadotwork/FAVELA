// The lane, and the one rule that makes it a cover shooter.
//
// Everything in the alley that stops a bullet is an axis-aligned box with a top
// edge. A round is stopped when it crosses a box below that edge -- so the same
// wall that saves you also blocks you, and the only way to shoot over it is to
// stand up and accept being shootable in return.
//
// Cover blocks bullets but not walking. In a side view the boxes read as being
// slightly in front of or behind the lane, which is why a low wall drawn over
// the actors still lets them stroll past it.

import { WORLD } from './tuning.js';

/** Deterministic noise, so a layout can be re-rolled and studied. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const pick = (rand, list) => list[Math.min(list.length - 1, (rand() * list.length) | 0)];
export const range = (rand, [lo, hi]) => lo + rand() * (hi - lo);

/**
 * One piece of cover. Heights are metres above the ground; `glass` is a band
 * that bullets pass through, which is what makes a car different from a wall.
 */
function box(kind, x, w, h, opts = {}) {
  return {
    kind,
    x, w, h,
    x0: x - w / 2,
    x1: x + w / 2,
    material: opts.material || 'concrete',
    glass: opts.glass || null,     // [lo, hi] in metres
    front: opts.front !== false,   // drawn over the actors
    art: opts.art ?? 0,
    flip: opts.flip || false,
  };
}

/**
 * Lay out an alley: a run of cover with clear ground between the pieces, walls
 * to crouch behind, cars to shoot the windows out of, and one armoured truck
 * that nothing goes through.
 */
export function buildArena(seed = 7) {
  const rand = rng(seed);
  const covers = [];
  const len = WORLD.laneLength;

  let x = 12;
  let last = '';
  while (x < len - 12) {
    let kind = pick(rand, ['wall', 'wall', 'wall', 'car', 'car', 'corner', 'gap']);
    if (kind === last) kind = 'gap';
    last = kind;

    if (kind === 'wall') {
      const w = range(rand, [3.2, 7.5]);
      const h = range(rand, [0.9, 1.35]);
      covers.push(box('wall', x + w / 2, w, h, {
        material: 'concrete', art: (rand() * 10) | 0, flip: rand() < 0.5,
      }));
      x += w + range(rand, [3.5, 7]);
    } else if (kind === 'car') {
      const w = range(rand, [4.0, 4.6]);
      const h = 1.45;
      covers.push(box('car', x + w / 2, w, h, {
        material: 'metal',
        glass: [h * 0.58, h],       // bodywork to the sill, windows above it
        art: (rand() * 6) | 0, flip: rand() < 0.5,
      }));
      x += w + range(rand, [4, 8]);
    } else if (kind === 'corner') {
      // A house corner juts into the lane at full height: step out to shoot,
      // step back to be safe. Nothing clears it, at any stance.
      const w = range(rand, [1.6, 2.6]);
      covers.push(box('corner', x + w / 2, w, range(rand, [3.4, 4.6]), {
        material: 'concrete', art: (rand() * 10) | 0, front: rand() < 0.6,
      }));
      x += w + range(rand, [5, 9]);
    } else {
      x += range(rand, [7, 13]);    // open ground, and nowhere to hide on it
    }
  }

  // The caveirao sits a third of the way down: armoured throughout, no glass
  // band, the one piece of cover in the alley that nothing shoots through.
  const truckX = len * 0.36;
  covers.forEach((c, i) => { if (Math.abs(c.x - truckX) < 7) covers[i] = null; });
  const truck = box('caveirao', truckX, 5.9, 2.16, { material: 'metal', front: true });
  const arena = {
    length: len,
    covers: covers.filter(Boolean).concat([truck]),
    spawn: { left: 6, right: len - 6, player: len * 0.5 },
    seed,
  };
  arena.covers.sort((a, b) => a.x0 - b.x0);
  return arena;
}

/** Solid height of a box at a given point: the glass band is a hole in it. */
function solidAt(cover, y) {
  if (y > cover.h) return false;
  if (cover.glass && y >= cover.glass[0] && y <= cover.glass[1]) return false;
  return true;
}

/**
 * March a segment through one box and return the fraction of the way along at
 * which it is stopped, or -1 if it gets through. Boxes are thin in the lane, so
 * this is a 2D slab clip plus a walk across the glass band.
 */
export function hitCover(cover, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;

  for (const [p, q0, q1, lo, hi] of [[dx, x0, x1, cover.x0, cover.x1], [dy, y0, y1, 0, cover.h]]) {
    if (Math.abs(p) < 1e-9) {
      if (q0 < lo || q0 > hi) return -1;
      continue;
    }
    let a = (lo - q0) / p;
    let b = (hi - q0) / p;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
    void q1;
  }
  if (t1 < 0 || t0 > 1) return -1;
  t0 = Math.max(t0, 0);

  if (!cover.glass) return t0;

  // With a glass band the box is solid, hollow, solid -- so find the first
  // point inside it that is actually armoured. Sixteen samples across a box a
  // few metres wide is finer than any round is thick.
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    if (solidAt(cover, y0 + dy * t)) return t;
  }
  return -1;
}

/** The nearest cover a shot runs into, or null if the line is clear. */
export function traceCover(arena, x0, y0, x1, y1) {
  let best = null;
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (const cover of arena.covers) {
    if (cover.x1 < lo || cover.x0 > hi) continue;
    const t = hitCover(cover, x0, y0, x1, y1);
    if (t >= 0 && (!best || t < best.t)) {
      best = { t, cover, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
    }
  }
  return best;
}

/** Can a muzzle here see a body there? The question the whole AI is built on. */
export function losClear(arena, x0, y0, x1, y1) {
  return !traceCover(arena, x0, y0, x1, y1);
}

/**
 * Where to stand to use a box: just behind its edge on your side of it. Cover
 * only works from one side, and this is the side facing the threat.
 */
export function coverSlot(cover, fromX) {
  const side = fromX < cover.x ? -1 : 1;
  return cover.x + side * (cover.w / 2 + 0.35);
}

/** The lowest stance whose muzzle clears a box, given where you stand. */
export function clearsAt(cover, muzzleY) {
  return muzzleY > cover.h || (cover.glass && muzzleY >= cover.glass[0]);
}
