// Drawing the lane.
//
// The simulation is in metres with the ground at y = 0 and up as positive.
// Exactly one place converts that to pixels -- sx()/sy() below -- so every
// sprite, box and particle in the game agrees about where the floor is, and
// pulling the camera back for a long shot is one number in that conversion.

import { PX_PER_M, SPRITE_SCALE, FEEL } from './tuning.js';
import { assets, anim, frameAt, drawFrame } from './assets.js';
import { rng, HOUSE, PROPS, groundAt } from './world.js';
import { paintHouse } from './props.js';
import { bodyHeight, strideOf, posX } from './actor.js';

export const view = {
  ctx: null,
  W: 1280,
  H: 720,
  groundY: 0,        // screen y of the ground line
  cam: { x: 0, target: 0 },
  // One step back by default: a real 6 m house fills a third of the screen at
  // 1x, which makes the lane feel like a corridor. 0.72 shows 27 m of it.
  zoom: 0.72,
  zoomStep: 1,
  dirt: null,
  backdrop: null,
  house: null,
};

export function initRender(canvas) {
  view.ctx = canvas.getContext('2d');
  view.W = canvas.width;
  view.H = canvas.height;
  view.groundY = Math.round(view.H * 0.80);
  view.dirt = paintDirt(1024, Math.round(view.H - view.groundY) + 40);
  return view.ctx;
}

/** Pixels to the metre, right now -- the camera's zoom lives in here. */
export const pxm = () => PX_PER_M * view.zoom;
/** The scale atlas frames are drawn at, which must track the same zoom. */
export const sprite = () => SPRITE_SCALE * view.zoom;

export const sx = (x) => (x - view.cam.x) * pxm() + view.W / 2;
export const sy = (y) => view.groundY - y * pxm();
export const toWorldX = (px) => view.cam.x + (px - view.W / 2) / pxm();
export const toWorldY = (py) => (view.groundY - py) / pxm();

/** How many metres of lane the screen currently shows. */
export const viewWidth = () => view.W / pxm();

export function setZoom(step) {
  const steps = FEEL.zooms;
  view.zoomStep = ((step % steps.length) + steps.length) % steps.length;
  view.zoom = steps[view.zoomStep];
  return view.zoom;
}

// --- the ground ----------------------------------------------------------
//
// Beaten red earth, painted once into an offscreen tile and repeated: bands of
// dried mud, loose stones, wheel ruts and standing water, with the near edge
// falling into shadow.

function paintDirt(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const rand = rng(0xd127);

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#6b4128');
  grad.addColorStop(0.18, '#8a5636');
  grad.addColorStop(0.62, '#9a6440');
  grad.addColorStop(1, '#4a2c1b');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  for (let i = 0; i < 260; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 14 + rand() * 90;
    const light = rand() < 0.5;
    const a = 0.05 + rand() * 0.1;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, light ? `rgba(190,140,98,${a})` : `rgba(60,34,20,${a})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.45, 0, 0, 6.283);
    g.fill();
  }

  for (let i = 0; i < 22; i++) {
    const y = rand() * h;
    g.strokeStyle = rand() < 0.5 ? 'rgba(52,30,18,0.22)' : 'rgba(196,150,108,0.16)';
    g.lineWidth = 1 + rand() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 3);
    g.stroke();
  }

  for (let i = 0; i < 9; i++) {
    const x = rand() * w;
    const y = h * (0.35 + rand() * 0.55);
    const rx = 18 + rand() * 55;
    const ry = rx * (0.2 + rand() * 0.12);
    g.fillStyle = 'rgba(58,38,24,0.55)';
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, 6.283);
    g.fill();
    g.fillStyle = 'rgba(168,132,96,0.28)';
    g.beginPath();
    g.ellipse(x - rx * 0.15, y - ry * 0.3, rx * 0.7, ry * 0.5, 0, 0, 6.283);
    g.fill();
  }

  for (let i = 0; i < 900; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 0.7 + rand() * 2.6;
    g.fillStyle = rand() < 0.45 ? 'rgba(212,180,142,0.5)' : 'rgba(48,28,17,0.45)';
    g.beginPath();
    g.ellipse(x, y, r, r * 0.7, rand() * 3, 0, 6.283);
    g.fill();
  }
  return c;
}

/**
 * The favela behind the lane: two ranks of houses climbing the hill, well back.
 * The near rank is deliberately empty -- the only building in the play plane is
 * the one you fight around.
 */
export function buildBackdrop(arena) {
  const rand = rng(arena.seed * 31 + 5);
  const layers = [
    { par: 0.16, lift: 8.5, scale: 1.15, tint: 'rgba(24,26,44,0.70)', items: [] },
    { par: 0.34, lift: 4.0, scale: 0.98, tint: 'rgba(28,26,38,0.46)', items: [] },
    { par: 0.62, lift: 0.0, scale: 0.8, tint: 'rgba(18,16,24,0.30)', items: [] },
  ];
  const n = assets.buildings.length;
  for (const layer of layers) {
    let x = -60;
    while (x < arena.length + 60) {
      const i = (rand() * n) | 0;
      const b = assets.manifest.buildings[i];
      const w = (b.w * SPRITE_SCALE * layer.scale) / PX_PER_M;
      layer.items.push({ i, x, w, lift: layer.lift + rand() * 1.8, flip: rand() < 0.4 });
      x += w * (0.6 + rand() * 0.28);
    }
  }
  view.backdrop = layers;
}

function drawBackdrop() {
  const { ctx, W } = view;
  const sky = ctx.createLinearGradient(0, 0, 0, view.groundY);
  sky.addColorStop(0, '#1b1a2c');
  sky.addColorStop(0.55, '#41304a');
  sky.addColorStop(0.85, '#8c5b47');
  sky.addColorStop(1, '#c08a5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, view.groundY + 2);

  for (const layer of view.backdrop) {
    const off = view.cam.x * (1 - layer.par);
    for (const it of layer.items) {
      const b = assets.manifest.buildings[it.i];
      const img = assets.buildings[it.i];
      if (!img) continue;
      const w = b.w * sprite() * layer.scale;
      const h = b.h * sprite() * layer.scale;
      const x = sx(it.x + off);
      if (x > W + w || x + w < -w) continue;
      const y = sy(it.lift) - h;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      if (it.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.fillStyle = layer.tint;
    ctx.fillRect(0, 0, W, view.groundY);
  }
}

function drawGround(arena) {
  const { ctx, W, H } = view;
  const tile = view.dirt;
  if (!view.dirtPattern) view.dirtPattern = ctx.createPattern(tile, 'repeat');

  // The hillside, as one filled shape: trace the terrain profile across the
  // screen and close it off the bottom. Terraces, flights and the flat lane are
  // the same path, so nothing has to know which it is drawing.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-2, H + 2);
  const x0 = toWorldX(-2);
  const x1 = toWorldX(W + 2);
  const step = 0.4;
  for (let x = x0; x <= x1; x += step) ctx.lineTo(sx(x), sy(groundAt(arena, x)) + 4);
  ctx.lineTo(W + 2, sy(groundAt(arena, x1)) + 4);
  ctx.lineTo(W + 2, H + 2);
  ctx.closePath();
  ctx.clip();

  ctx.save();
  ctx.translate(-((view.cam.x * pxm()) % tile.width), 0);
  ctx.fillStyle = view.dirtPattern;
  ctx.fillRect(0, sy(groundAt(arena, view.cam.x)) - tile.height, W + tile.width * 2, H);
  ctx.restore();

  const shade = ctx.createLinearGradient(0, sy(0), 0, H);
  shade.addColorStop(0, 'rgba(20,12,8,0)');
  shade.addColorStop(0.7, 'rgba(10,6,4,0.5)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// --- the house -----------------------------------------------------------

/**
 * The buildings in the play plane, drawn from the arena's art rectangles. Each
 * one is placed by its measured width, so the drawing and the cover boxes that
 * came out of the same measurements cannot drift apart.
 */
function drawBuildings(arena) {
  const { ctx, W } = view;
  for (const item of arena.art) {
    const img = assets.props[item.prop];
    const w = item.w * pxm();
    const x = sx(item.x0);
    if (x > W || x + w < 0) continue;
    const foot = sy(item.y || 0);
    if (img) {
      const h = (img.height / img.width) * w;
      ctx.drawImage(img, x, foot - h, w, h);
    } else if (item.prop === 'casa') {
      if (!view.house) view.house = paintHouse(HOUSE);
      const { canvas, metres } = view.house;
      ctx.drawImage(canvas, x, foot - metres * pxm(), w, metres * pxm());
    }
  }

  // The lee of the player's corner, so the safe side reads as shadow.
  const c = arena.corner;
  const shade = ctx.createLinearGradient(sx(c.x0 - 3.5), 0, sx(c.x0), 0);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = shade;
  ctx.fillRect(sx(c.x0 - 3.5), sy(c.base + c.h), 3.5 * pxm(), c.h * pxm());
  void PROPS;
}

// --- actors --------------------------------------------------------------

/**
 * Which frame of an animation an actor is on.
 *
 * Walking, running and crawling are counted off the ground covered, not off a
 * clock: one cycle of the animation is two footfalls, so however fast the legs
 * are carrying him the feet land where they are planted.
 */
function frameIndex(a, n) {
  const moving = Math.abs(a.vx) > 0.15;
  switch (a.anim) {
    case 'walk': case 'walkAim': case 'run': case 'proneCrawl': case 'crouchWalk':
      return Math.floor((a.step / (2 * strideOf(a))) * n);
    case 'crouch':
      return moving ? Math.floor((a.step / (2 * strideOf(a))) * n) : Math.floor(a.animT * 5);
    case 'climb': {
      // One pass of the six frames across the whole climb, so the reach at the
      // top lands as he arrives rather than half way up.
      const k = a.climb ? Math.min(0.999, a.climb.t / a.climb.dur) : 0.999;
      return Math.floor(k * n);
    }
    case 'shoot': case 'crouchShoot': case 'proneShoot': return Math.floor(a.animT * 22);
    case 'hit': return Math.min(2, Math.floor(a.animT * 18));
    case 'death': return Math.floor(a.dying * 11);
    default: return Math.floor(a.animT * 6);
  }
}

function drawShadow(a) {
  const { ctx } = view;
  const w = (a.stance === 'prone' ? 1.4 : 0.7) * pxm() * 0.6;
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#150d09';
  ctx.beginPath();
  ctx.ellipse(sx(posX(a)), sy(a.y) + 2, w, 7 * view.zoom, 0, 0, 6.283);
  ctx.fill();
  ctx.restore();
}

export function drawActor(a) {
  const { ctx } = view;
  drawShadow(a);
  const dead = !a.alive;

  const frames = anim(a.key, a.anim);
  const i = frameIndex(a, frames.length);
  const f = dead ? frames[Math.min(frames.length - 1, i)] : frameAt(a.key, a.anim, i);

  const alpha = dead ? Math.max(0.25, 1 - Math.max(0, a.dying - 6) * 0.5) : 1;
  drawFrame(ctx, a.key, f, sx(posX(a)), sy(a.y), a.facing, sprite(), alpha);

  if (!dead && a.hurt > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, a.hurt * 2.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#7a1010';
    ctx.fillRect(sx(posX(a)) - 26 * view.zoom, sy(a.y + bodyHeight(a)), 52 * view.zoom, bodyHeight(a) * pxm());
    ctx.restore();
  }

  if (!a.player && !dead) drawEnemyTag(a);
}

function drawEnemyTag(a) {
  const { ctx } = view;
  const x = sx(posX(a));
  const y = sy(a.y + bodyHeight(a)) - 12;
  const w = 34 * Math.max(0.7, view.zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = a.team === 'police' ? '#5aa9e6' : '#e05a4a';
  ctx.fillRect(x - w / 2, y, w * (a.hp / a.maxHp), 4);
}

// --- effects -------------------------------------------------------------

export function drawFx(fx, bullets) {
  const { ctx } = view;

  ctx.save();
  for (const d of fx.decals) {
    ctx.fillStyle = d.colour;
    ctx.beginPath();
    ctx.ellipse(sx(d.x), sy(d.y), d.w * pxm(), d.h * pxm() * 0.4, 0, 0, 6.283);
    ctx.fill();
  }
  ctx.restore();

  for (const c of fx.casings) {
    ctx.save();
    ctx.translate(sx(c.x), sy(c.y));
    ctx.rotate(c.ang);
    ctx.fillStyle = '#d8b25a';
    ctx.fillRect(-3 * view.zoom, -1.2 * view.zoom, 6 * view.zoom, 2.4 * view.zoom);
    ctx.restore();
  }

  ctx.save();
  ctx.lineCap = 'round';
  for (const b of bullets) {
    const tail = b.weapon === 'shotgun' ? 0.5 : 1.6;
    ctx.strokeStyle = b.team === 'player' ? 'rgba(255,226,150,0.92)' : 'rgba(255,168,120,0.85)';
    ctx.lineWidth = (b.weapon === 'shotgun' ? 1.4 : 2) * Math.max(0.6, view.zoom);
    ctx.beginPath();
    ctx.moveTo(sx(b.x), sy(b.y));
    ctx.lineTo(sx(b.x - b.dx * tail), sy(b.y - b.dy * tail));
    ctx.stroke();
  }
  ctx.restore();

  for (const mk of fx.marks) {
    const list = assets.fx[mk.material] || assets.fx.dirt || [];
    const img = list[mk.i % (list.length || 1)];
    const k = 1 - mk.t / mk.life;
    if (!img) continue;
    const spec = assets.manifest.fx[mk.material][mk.i % list.length];
    const w = spec.w * sprite();
    const h = spec.h * sprite();
    ctx.save();
    ctx.globalAlpha = Math.max(0, k);
    ctx.drawImage(img, sx(mk.x) - w / 2, sy(mk.y) - h / 2, w, h);
    ctx.restore();
  }

  for (const p of fx.sparks) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = p.hot ? '#ffd68a' : p.colour;
    const s = p.size * pxm();
    ctx.fillRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
  }
  ctx.globalAlpha = 1;

  for (const f of fx.flashes) {
    const k = 1 - f.t / f.life;
    const r = (0.28 + f.size * 0.18) * pxm() * (0.7 + k * 0.5);
    const x = sx(f.x);
    const y = sy(f.y);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,244,206,${0.95 * k})`);
    g.addColorStop(0.35, `rgba(255,183,72,${0.6 * k})`);
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283);
    ctx.fill();
  }
}

// --- the whole frame -----------------------------------------------------

export function updateCamera(game, dt) {
  const p = game.player;
  // The crew only ever comes from one end, so the camera does not centre on
  // the player at all: it puts him against the trailing edge and gives the
  // whole rest of the screen to the lane he is shooting down. You and whoever
  // is coming for you end up on opposite edges of the same picture.
  const half = viewWidth() / 2;
  const want = p.x + game.arena.threat * (half - FEEL.cameraEdge);
  const cam = view.cam;
  const lo = half - 6;
  const hi = game.arena.length - half + 6;
  cam.target = Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), want));
  cam.x += (cam.target - cam.x) * Math.min(1, FEEL.cameraLerp * dt);
}

export function renderFrame(game) {
  const { ctx, W, H } = view;
  const shakeX = (Math.random() - 0.5) * game.fx.shake * 2.2;
  const shakeY = (Math.random() - 0.5) * game.fx.shake * 1.6;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawBackdrop();
  drawGround(game.arena);

  drawBuildings(game.arena);

  const order = game.actors.slice().sort((a, b) => (a.alive === b.alive ? a.x - b.x : (a.alive ? 1 : -1)));
  for (const a of order) drawActor(a);

  drawFx(game.fx, game.bullets);

  ctx.restore();
}
