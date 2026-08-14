// The test stage: a strip of ground, one single-storey house, one flight of
// stairs, and a few boards to shoot at.
//
// Everything a body or a bullet asks of the world is answered here, and there
// are only three questions:
//
//   surfaceAt(x, feetY)  what is under the feet -- street, stairs or roof
//   wallAt(x, y)         is there house in the way of this point
//   coverState(x, y)     where a body is standing relative to the house
//
// The house is the mechanic from the design notes: it stands in the same layer
// as the player, so its wall is cover you hide behind and step out of. Its roof
// is one storey up and the stairs reach it, which is the whole of "climbing".
//
// Geometry comes from the art, not from numbers made up here: the roof line and
// the doorways were measured off the house sprite when it was cut, and the
// stairs carry the profile of their own treads.

import { assets } from '../assets.js';

export const GROUND_Y = 620;      // world y of the street
export const CORNER = 46;         // how close to the end of a wall is "at the corner"
export const LANE = { x0: -700, x1: 2400 };

export function buildStage(opts = {}) {
  const wrap = (i, list) => ((i % list.length) + list.length) % list.length;
  const houseIndex = wrap(opts.house ?? 3, assets.manifest.layer1);
  const stairIndex = wrap(opts.stairs ?? 0, assets.manifest.stairs);
  const groundIndex = wrap(opts.ground ?? 0, assets.manifest.ground);

  const houseArt = assets.manifest.layer1[houseIndex];
  const stairArt = assets.manifest.stairs[stairIndex];
  const groundArt = assets.manifest.ground[groundIndex];

  // The flight climbs left to right and stops against the left wall of the
  // house, so the top tread and the roof are the same step.
  const house = placeHouse(houseArt, 520);
  const stairs = placeStairs(stairArt, house.x0 - stairArt.w + 10);

  return {
    houseIndex, stairIndex, groundIndex,
    houseArt, stairArt, groundArt,
    house, stairs,
    targets: makeTargets(house),
    lane: LANE,
  };
}

function placeHouse(art, x) {
  const bottom = GROUND_Y;
  const roofY = bottom - (art.h - art.roof);
  return {
    art,
    x,                                   // sprite left edge, in world px
    y: bottom - art.h,                   // sprite top edge
    x0: x + art.wall[0],                 // the wall proper, without the eaves
    x1: x + art.wall[1],
    roofY,
    doors: (art.doors || []).map(([a, b]) => [x + a, x + b]),
  };
}

function placeStairs(art, x) {
  return {
    art,
    x,
    y: GROUND_Y - art.h,
    x0: x,
    x1: x + art.w,
    top: GROUND_Y - art.h * art.surface[art.surface.length - 1],
  };
}

function makeTargets(house) {
  // One in the open on either side of the house, and one on the roof: a flat
  // shot from the street cannot reach that one, so it is worth the climb. The
  // pair on the ground are what the wall is tested against -- from the middle
  // of the lane neither is hittable through the house.
  return [
    { x: house.x0 - 660, y: GROUND_Y, hits: 0, flash: 0 },
    { x: house.x1 + 420, y: GROUND_Y, hits: 0, flash: 0 },
    { x: house.x0 + 230, y: house.roofY, hits: 0, flash: 0 },
  ];
}

export const TARGET = { w: 46, h: 128 };

/** Height of the surface holding up a body at x, given where its feet are now. */
export function surfaceAt(stage, x, feetY) {
  let best = GROUND_Y;

  const s = stage.stairs;
  if (x >= s.x0 && x <= s.x1) {
    const y = stairSurface(s, x);
    if (y < best && y >= feetY - STEP_UP) best = y;
  }

  const h = stage.house;
  if (x >= h.x0 - 6 && x <= h.x1 + 6 && h.roofY < best && h.roofY >= feetY - STEP_UP) {
    best = h.roofY;
  }
  return best;
}

// How far up a body will step without being lifted onto a roof from the street:
// one tread of the stairs, and nothing like a storey.
const STEP_UP = 56;

/** The drawn height of the flight at x. */
export function stairSurface(stairs, x) {
  const prof = stairs.art.surface;
  const t = (x - stairs.x0) / (stairs.x1 - stairs.x0);
  const i = Math.max(0, Math.min(prof.length - 1, Math.round(t * (prof.length - 1))));
  return GROUND_Y - stairs.art.h * prof[i];
}

/** Slope of whatever is under the feet: how a climb is told from a walk. */
export function slopeAt(stage, x) {
  const s = stage.stairs;
  if (x < s.x0 || x > s.x1) return 0;
  const d = 14;
  return (stairSurface(s, x - d) - stairSurface(s, x + d)) / (d * 2);
}

/**
 * Is the house in the way at this point?
 *
 * The wall runs from the street to the roof. An open door is a hole in it --
 * bullets go through a doorway, which is what makes standing in one a firing
 * position rather than a hiding place.
 */
export function wallAt(stage, x, y) {
  const h = stage.house;
  if (x < h.x0 || x > h.x1) return false;
  if (y < h.roofY || y > GROUND_Y) return false;
  for (const [a, b] of h.doors) {
    if (x >= a && x <= b) return false;
  }
  return true;
}

/** Where the wall stops a shot fired from x0,y0 towards x1,y1, or null. */
export function wallHit(stage, x0, y0, x1, y1) {
  const h = stage.house;
  const dx = x1 - x0;
  if (!dx) return null;

  // Walk the segment at the resolution of a door frame; the doorways are the
  // only detail in the wall and none is narrower than this.
  const steps = Math.max(2, Math.ceil(Math.abs(dx) / 14));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + (y1 - y0) * t;
    if (x < h.x0 || x > h.x1) continue;
    if (wallAt(stage, x, y)) return { x, y, t, kind: 'wall' };
  }
  return null;
}

/**
 * Where a body is standing relative to the house.
 *
 *   open     out in the lane
 *   corner   at the end of the wall: the shot goes out, and so does the return
 *   behind   in the wall's shadow, safe from the lane and unable to shoot into it
 *   door     in a doorway: a hole in the wall to shoot through
 *   roof     on top, above the wall and exposed to everything
 */
export function coverState(stage, x, feetY) {
  const h = stage.house;
  if (feetY <= h.roofY + 2 && x >= h.x0 - 8 && x <= h.x1 + 8) return 'roof';
  if (x < h.x0 || x > h.x1) return 'open';
  for (const [a, b] of h.doors) {
    if (x >= a - 6 && x <= b + 6) return 'door';
  }
  if (x - h.x0 < CORNER || h.x1 - x < CORNER) return 'corner';
  return 'behind';
}

/** Half-width of a target board, for the bullet sweep. */
export function targetBox(t) {
  return { x0: t.x - TARGET.w / 2, x1: t.x + TARGET.w / 2, y0: t.y - TARGET.h, y1: t.y };
}
