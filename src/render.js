// Drawing the lane.
//
// The simulation is in metres with the ground at y = 0 and up as positive.
// Exactly one place converts that to pixels -- sx()/sy() below -- so every
// sprite, box and particle in the game agrees about where the floor is.

import { PX_PER_M, SPRITE_SCALE, FEEL } from './tuning.js';
import { assets, anim, frameAt, drawFrame } from './assets.js';
import { rng } from './world.js';
import { bodyHeight, strideOf } from './actor.js';

export const view = {
  ctx: null,
  W: 1280,
  H: 720,
  groundY: 0,        // screen y of the ground line
  cam: { x: 0, target: 0 },
  dirt: null,
  backdrop: null,
};

export function initRender(canvas) {
  view.ctx = canvas.getContext('2d');
  view.W = canvas.width;
  view.H = canvas.height;
  view.groundY = Math.round(view.H * 0.80);
  view.dirt = paintDirt(1024, Math.round(view.H - view.groundY) + 40);
  return view.ctx;
}

export const sx = (x) => (x - view.cam.x) * PX_PER_M + view.W / 2;
export const sy = (y) => view.groundY - y * PX_PER_M;
export const toWorldX = (px) => view.cam.x + (px - view.W / 2) / PX_PER_M;
export const toWorldY = (py) => (view.groundY - py) / PX_PER_M;

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

  // Broad blotches of wetter and drier earth.
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

  // Ruts running down the lane.
  for (let i = 0; i < 22; i++) {
    const y = rand() * h;
    g.strokeStyle = rand() < 0.5 ? 'rgba(52,30,18,0.22)' : 'rgba(196,150,108,0.16)';
    g.lineWidth = 1 + rand() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 3);
    g.stroke();
  }

  // Puddles: a dark pool with a bright rim where the light catches the water.
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

  // Stones.
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
 * The favela behind the lane: three ranks of houses climbing the hill, each
 * moving less than the one in front. `lift` is how far up the slope a rank
 * sits, in metres, which is what turns a row of shacks into a hillside.
 */
export function buildBackdrop(arena) {
  const rand = rng(arena.seed * 31 + 5);
  const layers = [
    { par: 0.20, lift: 7.5, scale: 1.15, tint: 'rgba(24,26,44,0.66)', items: [] },
    { par: 0.44, lift: 3.4, scale: 1.0, tint: 'rgba(28,26,38,0.42)', items: [] },
    { par: 0.72, lift: 0.0, scale: 0.86, tint: 'rgba(20,18,26,0.18)', items: [] },
  ];
  const n = assets.buildings.length;
  for (const layer of layers) {
    let x = -40;
    while (x < arena.length + 40) {
      const i = (rand() * n) | 0;
      const b = assets.manifest.buildings[i];
      const w = (b.w * SPRITE_SCALE * layer.scale) / PX_PER_M;
      layer.items.push({ i, x, w, lift: layer.lift + rand() * 1.6, flip: rand() < 0.4 });
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
      const w = b.w * SPRITE_SCALE * layer.scale;
      const h = b.h * SPRITE_SCALE * layer.scale;
      const x = sx(it.x + off);
      if (x > W + w || x + w < -w) continue;
      const y = sy(it.lift) - h;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      if (it.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    // One flat wash per rank, which is what puts them behind each other.
    ctx.fillStyle = layer.tint;
    ctx.fillRect(0, 0, W, view.groundY);
  }
}

function drawGround() {
  const { ctx, W, H } = view;
  const tile = view.dirt;
  const y = view.groundY - 6;

  // The far side of the lane: a band of shadow at the foot of the houses that
  // stops the sky showing through the gaps between them at ankle height.
  const base = ctx.createLinearGradient(0, sy(2.4), 0, view.groundY);
  base.addColorStop(0, 'rgba(18,13,16,0)');
  base.addColorStop(0.45, 'rgba(20,13,13,0.45)');
  base.addColorStop(1, 'rgba(20,13,12,0.92)');
  ctx.fillStyle = base;
  ctx.fillRect(0, sy(2.4), W, view.groundY - sy(2.4) + 2);
  const offset = ((view.cam.x * PX_PER_M) % tile.width + tile.width) % tile.width;
  for (let x = -offset; x < W; x += tile.width) {
    ctx.drawImage(tile, Math.round(x), y, tile.width, tile.height);
  }
  const shade = ctx.createLinearGradient(0, y, 0, H);
  shade.addColorStop(0, 'rgba(20,12,8,0.55)');
  shade.addColorStop(0.25, 'rgba(20,12,8,0)');
  shade.addColorStop(0.8, 'rgba(10,6,4,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, y, W, H - y);
}

// --- cover ---------------------------------------------------------------

function drawWall(cover) {
  const { ctx } = view;
  const spec = assets.manifest.walls?.[cover.art % (assets.manifest.walls?.length || 1)];
  const img = assets.walls[cover.art % assets.walls.length];
  const w = cover.w * PX_PER_M;
  const h = cover.h * PX_PER_M;
  const x = sx(cover.x0);
  const y = sy(cover.h);
  if (img && spec) {
    // Show the foot of the masonry, tiled across, so the courses stay square.
    const srcH = Math.min(spec.h, (h / SPRITE_SCALE));
    const srcY = spec.h - srcH;
    const stepW = spec.w * SPRITE_SCALE;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let dx = 0; dx < w + stepW; dx += stepW) {
      ctx.drawImage(img, 0, srcY, spec.w, srcH, x + dx, y, stepW, h);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#6a6157';
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, 3);
}

function drawCorner(cover) {
  const { ctx } = view;
  const i = cover.art % assets.buildings.length;
  const img = assets.buildings[i];
  const spec = assets.manifest.buildings[i];
  const w = cover.w * PX_PER_M;
  const h = cover.h * PX_PER_M;
  const x = sx(cover.x0);
  const y = sy(cover.h);
  if (img) {
    const srcW = Math.min(spec.w, (w / SPRITE_SCALE) * (spec.h / (h / SPRITE_SCALE)));
    ctx.drawImage(img, 0, 0, srcW, spec.h, x, y, w, h);
  } else {
    ctx.fillStyle = '#4c4740';
    ctx.fillRect(x, y, w, h);
  }
}

function drawVehicle(cover) {
  const { ctx } = view;
  const isTruck = cover.kind === 'caveirao';
  const img = isTruck ? assets.caveirao : assets.cars[cover.art % assets.cars.length];
  const spec = isTruck ? assets.manifest.caveirao : assets.manifest.cars[cover.art % assets.manifest.cars.length];
  if (!img) return;
  const w = spec.w * SPRITE_SCALE;
  const h = spec.h * SPRITE_SCALE;
  ctx.save();
  ctx.translate(sx(cover.x), sy(0));
  if (cover.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

function drawCover(cover) {
  if (cover.kind === 'wall') drawWall(cover);
  else if (cover.kind === 'corner') drawCorner(cover);
  else drawVehicle(cover);
}

// --- actors --------------------------------------------------------------

/**
 * Which frame of an animation an actor is on.
 *
 * Walking, running and crawling are counted off the ground covered, not off a
 * clock: one cycle of the animation is two footfalls, so however fast the legs
 * are carrying him the feet land where they are planted. Everything else --
 * firing, flinching, dying -- runs on time, because none of it is a gait.
 */
function frameIndex(a, n) {
  const moving = Math.abs(a.vx) > 0.15;
  switch (a.anim) {
    case 'walk': case 'walkAim': case 'run': case 'proneCrawl':
      return Math.floor((a.step / (2 * strideOf(a))) * n);
    case 'crouch':
      return moving ? Math.floor((a.step / (2 * strideOf(a))) * n) : Math.floor(a.animT * 5);
    case 'shoot': case 'crouchShoot': case 'proneShoot': return Math.floor(a.animT * 22);
    case 'hit': return Math.min(2, Math.floor(a.animT * 18));
    case 'death': return Math.floor(a.dying * 11);
    default: return Math.floor(a.animT * 6);
  }
}

function drawShadow(a) {
  const { ctx } = view;
  const w = (a.stance === 'prone' ? 1.5 : 0.75) * PX_PER_M * 0.6;
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#150d09';
  ctx.beginPath();
  ctx.ellipse(sx(a.x), sy(0) + 2, w, 7, 0, 0, 6.283);
  ctx.fill();
  ctx.restore();
}

export function drawActor(a) {
  const { ctx } = view;
  drawShadow(a);
  const dead = !a.alive;

  // Loops wrap; a death animation plays once and stays down.
  const frames = anim(a.key, a.anim);
  const i = frameIndex(a, frames.length);
  const f = dead
    ? frames[Math.min(frames.length - 1, i)]
    : frameAt(a.key, a.anim, i);

  const alpha = dead ? Math.max(0.25, 1 - Math.max(0, a.dying - 6) * 0.5) : 1;
  drawFrame(ctx, a.key, f, sx(a.x), sy(0), a.facing, SPRITE_SCALE, alpha);

  if (!dead && a.hurt > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, a.hurt * 2.4);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#7a1010';
    ctx.fillRect(sx(a.x) - 26, sy(bodyHeight(a)), 52, bodyHeight(a) * PX_PER_M);
    ctx.restore();
  }

  if (!a.player && !dead) drawEnemyTag(a);
}

function drawEnemyTag(a) {
  const { ctx } = view;
  const x = sx(a.x);
  const y = sy(bodyHeight(a)) - 12;
  const w = 34;
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
    ctx.ellipse(sx(d.x), sy(d.y), d.w * PX_PER_M, d.h * PX_PER_M * 0.4, 0, 0, 6.283);
    ctx.fill();
  }
  ctx.restore();

  for (const c of fx.casings) {
    ctx.save();
    ctx.translate(sx(c.x), sy(c.y));
    ctx.rotate(c.ang);
    ctx.fillStyle = '#d8b25a';
    ctx.fillRect(-3, -1.2, 6, 2.4);
    ctx.restore();
  }

  // Tracers: a short bright streak along the round's own path.
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of bullets) {
    const tail = b.weapon === 'shotgun' ? 0.5 : 1.3;
    ctx.strokeStyle = b.team === 'player' ? 'rgba(255,226,150,0.92)' : 'rgba(255,168,120,0.85)';
    ctx.lineWidth = b.weapon === 'shotgun' ? 1.4 : 2;
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
    const w = spec.w * SPRITE_SCALE;
    const h = spec.h * SPRITE_SCALE;
    ctx.save();
    ctx.globalAlpha = Math.max(0, k);
    ctx.drawImage(img, sx(mk.x) - w / 2, sy(mk.y) - h / 2, w, h);
    ctx.restore();
  }

  for (const p of fx.sparks) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = p.hot ? '#ffd68a' : p.colour;
    const s = p.size * PX_PER_M;
    ctx.fillRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
  }
  ctx.globalAlpha = 1;

  for (const f of fx.flashes) {
    const k = 1 - f.t / f.life;
    const r = (0.28 + f.size * 0.18) * PX_PER_M * (0.7 + k * 0.5);
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
  const lead = p.aimTarget ? Math.sign(p.aimTarget.x - p.x) : p.facing;
  const want = p.x + lead * FEEL.cameraLead * (p.intent.fire ? 1 : 0.55);
  const cam = view.cam;
  const half = view.W / (2 * PX_PER_M);
  const clampLo = half - 4;
  const clampHi = game.arena.length - half + 4;
  cam.target = Math.max(clampLo, Math.min(clampHi, want));
  if (Math.abs(cam.target - cam.x) > FEEL.cameraDead) {
    cam.x += (cam.target - cam.x) * Math.min(1, FEEL.cameraLerp * dt);
  }
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
  drawGround();

  const back = game.arena.covers.filter((c) => !c.front);
  const front = game.arena.covers.filter((c) => c.front);
  back.forEach(drawCover);

  const order = game.actors.slice().sort((a, b) => (a.alive === b.alive ? a.x - b.x : (a.alive ? 1 : -1)));
  for (const a of order) drawActor(a);

  drawFx(game.fx, game.bullets);
  front.forEach(drawCover);

  ctx.restore();
}
