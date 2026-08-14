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
    mine: !!opts.mine,             // cover reserved for the player
    solid: !!opts.solid,           // a body cannot walk through it either
  };
}

/** The house, in metres. The door is 2 m and everything else is measured off it. */
export const HOUSE = {
  w: 5.6,          // wall to wall, as drawn
  h: 2.9,          // ground to the top of the roof slab
  door: 2.0,       // the ruler the rest of the art is drawn against
  tank: 0.8,       // the water tank standing on the roof
  jut: 0.9,        // how much of it actually stands in the lane
};

/**
 * One house on an empty lane.
 *
 * There is nothing else to hide behind, which is the point: the house is a
 * solid block at full height that no stance shoots over, so the fight is about
 * its two corners. The crew comes from one end only, which makes the far corner
 * -- the one facing away from them -- the safe side, and stepping past the near
 * one the price of taking a shot.
 */
export function buildArena(seed = 7) {
  const len = WORLD.laneLength;
  const houseX = len * 0.28;                    // centre of the drawn building
  const cornerX = houseX + HOUSE.w / 2;         // where its wall meets the lane

  // The building itself is set back and drawn behind the actors, who walk along
  // its face. What is actually in the lane is the corner, jutting out: a narrow
  // full-height block that stops everything and that nobody walks through. Cover
  // in one dimension has to be the corner, not the whole house, or standing
  // behind the wall would mean standing five metres from the edge you need to
  // shoot past.
  const corner = box('corner', cornerX - HOUSE.jut / 2, HOUSE.jut, HOUSE.h, {
    material: 'concrete',
    front: false,
    mine: true,             // the player's corner; the crew does not get to use it
    solid: true,
  });

  return {
    length: len,
    covers: [corner],
    // Where the artwork goes, which is wider than the thing that stops bullets.
    art: { x0: cornerX - HOUSE.w, w: HOUSE.w },
    corner,
    // Everything arrives from up the lane, so one side of the corner is safe.
    threat: 1,                                  // the direction they come from
    spawn: {
      enemy: [cornerX + 34, cornerX + 58],      // where they come on from
      player: cornerX - HOUSE.jut - 2.2,        // in the lee of the corner
    },
    seed,
  };
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

/**
 * Push a body out of anything solid.
 *
 * Low cover is walked past, which is why boxes do not block movement in
 * general -- but a house is a house. Being able to stand inside its footprint
 * made the corner a free kill: the wall hid the body from every shot while the
 * muzzle, half a metre in front of it, was already round the edge and firing.
 */
export function pushOutOfSolids(arena, x, halfWidth) {
  for (const c of arena.covers) {
    if (!c.solid) continue;
    if (x + halfWidth <= c.x0 || x - halfWidth >= c.x1) continue;
    const left = c.x0 - halfWidth;
    const right = c.x1 + halfWidth;
    return Math.abs(x - left) < Math.abs(x - right) ? left : right;
  }
  return x;
}

/** The lowest stance whose muzzle clears a box, given where you stand. */
export function clearsAt(cover, muzzleY) {
  return muzzleY > cover.h || (cover.glass && muzzleY >= cover.glass[0]);
}
