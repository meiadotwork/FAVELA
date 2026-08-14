// Level layout: the lane the fight happens in, and everything that stops a
// bullet in it.
//
// The world is a strip. Houses stand along the back of the lane; a few of them
// push a corner out into it. Cover is a list of boxes with a top edge, which is
// all the shooting model needs: a bullet is stopped when it crosses a box below
// that edge. That one rule gives crouching behind a wall, standing up to shoot
// over it, and -- with a second gap band -- the car from the design notes,
// which is solid to the sill and glass above it.

import { assets } from './assets.js';

export const GROUND_Y = 616;
export const STAND_H = 190;

// Cover profiles, in units of a standing character's height.
export const COVER = {
  wall: { top: 0.52, label: 'muro' },
  crate: { top: 0.40, label: 'caixa' },
  car: { top: 0.55, gap: [0.55, 0.95], label: 'carro' },   // sized from its sprite
  truck: { top: 2.60, label: 'caveirão' },                 // armoured, solid throughout
  corner: { top: 2.20, label: 'quina' },
};

/** Deterministic per-level RNG, so a level looks the same every time you retry. */
export function makeRng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const range = (rng, a, b) => a + rng() * (b - a);

// Time of day and weather drive one palette each; a level combines them.
export const TIMES = {
  morning: {
    label: 'manhã',
    sky: ['#8fc4e8', '#dbe7ea', '#f3e2c4'],
    sun: { x: 0.22, y: 0.24, glow: 'rgba(255,236,190,.55)' },
    tint: 'rgba(255,226,170,.10)', shade: 'rgba(30,40,70,.10)', ambient: 1.0,
  },
  day: {
    label: 'meio-dia',
    sky: ['#5fa8dd', '#a9d3ec', '#e8eef0'],
    sun: { x: 0.6, y: 0.12, glow: 'rgba(255,255,225,.45)' },
    tint: 'rgba(255,247,214,.06)', shade: 'rgba(20,30,60,.06)', ambient: 1.0,
  },
  dusk: {
    label: 'fim de tarde',
    sky: ['#2d3a6b', '#b4563f', '#f0a24a'],
    sun: { x: 0.82, y: 0.42, glow: 'rgba(255,166,90,.6)' },
    tint: 'rgba(255,150,80,.18)', shade: 'rgba(30,20,60,.22)', ambient: 0.86,
  },
  night: {
    label: 'madrugada',
    sky: ['#070a18', '#12193a', '#26304f'],
    sun: null,
    tint: 'rgba(90,120,200,.16)', shade: 'rgba(4,6,18,.52)', ambient: 0.55,
  },
};

export const WEATHER = {
  clear: { label: 'firme', rain: 0, fog: 0, wind: 0.2 },
  haze: { label: 'abafado', rain: 0, fog: 0.22, wind: 0.1 },
  rain: { label: 'chuva', rain: 1, fog: 0.14, wind: 0.5 },
  storm: { label: 'temporal', rain: 1.9, fog: 0.26, wind: 1.0 },
};

// The campaign. Gang levels are rival crews coming up the alley; police levels
// open with the firework code from the design notes.
export const LEVELS = [
  { name: 'Beco do Sol', time: 'morning', weather: 'clear', enemy: 'gang', waves: [2, 3], width: 3600 },
  { name: 'Rua de Cima', time: 'day', weather: 'haze', enemy: 'gang', waves: [3, 3, 2], width: 4200 },
  { name: 'Batida', time: 'day', weather: 'clear', enemy: 'police', waves: [3, 4], width: 4200 },
  { name: 'Chuva na Laje', time: 'dusk', weather: 'rain', enemy: 'gang', waves: [3, 4, 3], width: 4600 },
  { name: 'Toque de Recolher', time: 'night', weather: 'clear', enemy: 'police', waves: [4, 4, 3], width: 4600 },
  { name: 'Temporal', time: 'night', weather: 'storm', enemy: 'mixed', waves: [4, 5, 4], width: 5000 },
];

/**
 * Build one level: houses along the back, cover in the lane, roofs to climb.
 * Buildings are chosen from the manifest by index so the same seed rebuilds it.
 */
export function buildLevel(index, playerKey) {
  const def = LEVELS[Math.min(index, LEVELS.length - 1)];
  const rng = makeRng(index * 7919 + 13);
  const nBuildings = assets.buildings.length;

  const houses = [];
  const covers = [];
  const platforms = [];
  const ladders = [];
  const props = [];

  // The hillside behind the lane. Houses are packed tightly enough to overlap
  // into one mass, and the smaller they are the higher they sit, so the stack
  // reads as a slope climbing away rather than as props floating in the sky.
  const skyline = [];
  for (let x = -240; x < def.width + 400; x += range(rng, 46, 86)) {
    const scale = range(rng, 0.22, 0.42);
    skyline.push({
      img: Math.floor(rng() * nBuildings),
      x,
      scale,
      base: GROUND_Y - (8 + (0.42 - scale) * 620) - range(rng, 0, 40),
    });
  }
  skyline.sort((a, b) => a.scale - b.scale);   // furthest up the hill drawn first

  // The row of houses the lane runs along. Gaps between them are empty lots.
  let x = -120;
  while (x < def.width) {
    const img = Math.floor(rng() * nBuildings);
    const scale = range(rng, 0.72, 1.06);
    const meta = assets.manifest.buildings[img];
    const w = meta.w * scale;
    const house = { img, x, w, h: meta.h * scale, scale, roof: null };

    // Roughly every third house is climbable: a roof to fight from, reached by
    // a ladder at one end.
    if (rng() < 0.34 && w > 260) {
      const top = GROUND_Y - house.h * range(rng, 0.44, 0.6);
      const inset = w * 0.12;
      house.roof = { x0: x + inset, x1: x + w - inset, y: top };
      platforms.push(house.roof);
      const side = rng() < 0.5 ? x + inset + 10 : x + w - inset - 46;
      ladders.push({ x0: side, x1: side + 36, top, bottom: GROUND_Y });
    }

    houses.push(house);
    x += w;

    if (rng() < 0.34) {
      // An empty lot: room to be caught in the open, so it gets loose cover.
      const lot = range(rng, 240, 460);
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const kind = rng() < 0.45 ? 'car' : (rng() < 0.6 ? 'wall' : 'crate');
        addCover(covers, makeCover(kind, x + range(rng, 30, lot - 60), rng));
      }
      x += lot;
    } else if (rng() < 0.5) {
      // A corner pushed out into the lane, to fight around.
      addCover(covers, makeCover('corner', x - range(rng, 20, 60), rng, houses[houses.length - 1]));
    }

    if (rng() < 0.45) {
      addCover(covers, makeCover(rng() < 0.5 ? 'wall' : 'crate', x - range(rng, 120, 260), rng));
    }
  }

  // On a police level the caveirao is parked in the alley: the raid's own
  // vehicle, and the one piece of cover nothing shoots through.
  if (def.enemy === 'police' || def.enemy === 'mixed') {
    addCover(covers, makeCover('truck', def.width * range(rng, 0.55, 0.75), rng));
  }

  // No stretch of the lane should be a killing field with nothing to hide
  // behind, so any gap wider than this gets a piece of cover dropped into it.
  const MAX_OPEN = 560;
  covers.sort((a, b) => a.x0 - b.x0);
  for (let gx = 200; gx < def.width - 200; gx += 120) {
    const near = covers.some((c) => c.x1 > gx - MAX_OPEN / 2 && c.x0 < gx + MAX_OPEN / 2);
    if (!near) {
      addCover(covers, makeCover(rng() < 0.4 ? 'car' : (rng() < 0.6 ? 'wall' : 'crate'), gx, rng));
      covers.sort((a, b) => a.x0 - b.x0);
    }
  }

  // Laundry lines and puddles: no gameplay, but the lane reads as lived-in.
  for (let i = 0; i < 26; i++) {
    props.push({
      kind: rng() < 0.5 ? 'line' : 'puddle',
      x: range(rng, 0, def.width),
      y: GROUND_Y - range(rng, 150, 320),
      w: range(rng, 90, 210),
      hue: Math.floor(range(rng, 0, 360)),
    });
  }

  return {
    index,
    def,
    name: def.name,
    width: def.width,
    time: TIMES[def.time],
    weather: WEATHER[def.weather],
    enemy: def.enemy,
    waves: def.waves,
    playerKey,
    houses,
    skyline,
    covers,
    platforms,
    ladders,
    props,
    spawnPoints: [-80, def.width + 80],
  };
}

/** Keep cover apart: two boxes in the same spot read as one broken prop. */
function addCover(covers, cover) {
  const pad = 70;
  for (const c of covers) {
    if (cover.x0 < c.x1 + pad && cover.x1 > c.x0 - pad) return;
  }
  covers.push(cover);
}

function makeCover(kind, x, rng, house = null) {
  const spec = COVER[kind];

  // Vehicles take their geometry from the sprite that will be drawn, so the
  // line bullets stop at is the line the player can see on the bodywork.
  if (kind === 'car' || kind === 'truck') {
    const pool = kind === 'truck' ? [assets.manifest.caveirao] : assets.manifest.cars;
    const idx = Math.floor(rng() * pool.length);
    const art = pool[idx];
    if (art) {
      return {
        kind,
        x0: x,
        x1: x + art.w,
        // Solid to the window sill; the caveirao is armoured all the way up.
        top: art.h * (kind === 'truck' ? 0.98 : 0.60),
        gap: kind === 'truck' ? null : [art.h * 0.60, art.h * 0.97],
        art: idx,
        seed: rng(),
      };
    }
  }

  const w = kind === 'corner' ? range(rng, 54, 84) : range(rng, 130, 200);
  const top = STAND_H * spec.top * (kind === 'corner' ? range(rng, 0.9, 1.25) : range(rng, 0.94, 1.06));
  return {
    kind,
    x0: x,
    x1: x + w,
    top,
    gap: null,
    // Corners are a slice of the house they belong to; loose cover is built
    // from the flat masonry panels, so a wall in the street is real brickwork.
    house: house ? house.img : null,
    panel: Math.floor(rng() * Math.max(1, assets.walls.length)),
    seed: rng(),
  };
}

/** Height above ground of the surface supporting a body at x, y. */
export function surfaceAt(level, x, feetY) {
  let best = GROUND_Y;
  for (const p of level.platforms) {
    if (x >= p.x0 && x <= p.x1 && p.y >= feetY - 24 && p.y < best) best = p.y;
  }
  return best;
}

export function ladderAt(level, x) {
  return level.ladders.find((l) => x >= l.x0 - 14 && x <= l.x1 + 14) || null;
}

/**
 * First cover between two points, or null. `y` is the bullet's height above
 * ground at the crossing; a car's window band lets it through.
 */
export function blockedBy(level, x0, y0, x1, y1) {
  const dx = x1 - x0;
  if (dx === 0) return null;
  let nearest = null;
  let nearestT = Infinity;

  for (const c of level.covers) {
    // Parametric crossing of the cover's near edge, in the direction of travel.
    const edge = dx > 0 ? c.x0 : c.x1;
    const t = (edge - x0) / dx;
    if (t < 0 || t > 1 || t > nearestT) continue;
    const far = dx > 0 ? c.x1 : c.x0;
    if ((far - x0) / dx < 0) continue;

    const y = y0 + (y1 - y0) * t;          // world y where it crosses
    const above = GROUND_Y - y;             // height above the ground line
    if (above > c.top) continue;            // sails over the top
    if (c.gap && above >= c.gap[0] && above <= c.gap[1]) continue;  // through the glass

    nearest = { cover: c, t, x: x0 + dx * t, y };
    nearestT = t;
  }
  return nearest;
}

/** True when a body standing at x has cover between it and a threat at fromX. */
export function inCoverFrom(level, x, feetY, poseTop, fromX) {
  const hit = blockedBy(level, fromX, GROUND_Y - poseTop * 0.6, x, feetY - poseTop * 0.5);
  return !!hit;
}

/** The nearest cover a mover at x could reach to hide from a threat at fromX. */
export function nearestCover(level, x, fromX, maxDist = 900) {
  let best = null;
  let bestScore = Infinity;
  for (const c of level.covers) {
    if (c.kind === 'corner') continue;
    const mid = (c.x0 + c.x1) / 2;
    // Stand on the side of the cover away from the threat.
    const spot = fromX < mid ? c.x1 + 26 : c.x0 - 26;
    const d = Math.abs(spot - x);
    if (d > maxDist) continue;
    if (d < bestScore) {
      bestScore = d;
      best = { cover: c, x: spot };
    }
  }
  return best;
}
