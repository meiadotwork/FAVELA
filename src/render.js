// Drawing. The lane is built in depth order: sky, distant hillside, the row of
// houses, then everything standing in the lane itself. Cover is textured by
// sampling the base of a real house sprite, so a wall in the street is made of
// the same masonry as the buildings behind it rather than flat canvas colour.

import { assets, drawFrame } from './assets.js';
import { GROUND_Y } from './level.js';
import { currentFrame, poseHeight, STANCE, WEAPONS } from './actors.js';

export const W = 1280;
export const H = 720;

const rnd = (seed) => {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

export function drawWorld(ctx, world) {
  const { level, camX } = world;
  const shakeX = (Math.random() - 0.5) * world.shake;
  const shakeY = (Math.random() - 0.5) * world.shake;

  drawSky(ctx, level, camX);

  ctx.save();
  ctx.translate(-camX + shakeX, shakeY);

  drawSkyline(ctx, level, camX);
  drawHouses(ctx, level, camX);
  drawGround(ctx, level, camX);
  drawProps(ctx, level, camX);

  // Cover and bodies interleave: anything the player can hide behind is drawn
  // after them, so ducking actually puts the wall in front of the body.
  for (const a of world.actors) if (a.dead) drawActor(ctx, a, world);
  for (const a of world.actors) if (!a.dead) drawActor(ctx, a, world);

  drawCovers(ctx, level, camX);
  drawBullets(ctx, world);
  drawFx(ctx, world);
  drawParticles(ctx, world);

  ctx.restore();

  drawWeather(ctx, world);
  drawLightAndTint(ctx, world);
}

// ------------------------------------------------------------------ sky

function drawSky(ctx, level, camX) {
  const t = level.time;
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, t.sky[0]);
  g.addColorStop(0.55, t.sky[1]);
  g.addColorStop(1, t.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (t.sun) {
    const sx = W * t.sun.x - camX * 0.02;
    const sy = H * t.sun.y;
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 340);
    glow.addColorStop(0, t.sun.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 340, sy - 340, 680, 680);
  } else {
    // Night: a scatter of stars, plus the city glow off the horizon.
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    for (let i = 0; i < 70; i++) {
      const x = (rnd(i) * 2200 - camX * 0.05) % W;
      ctx.globalAlpha = 0.25 + rnd(i + 99) * 0.65;
      ctx.fillRect(x < 0 ? x + W : x, rnd(i + 7) * 300, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    const glow = ctx.createLinearGradient(0, 220, 0, 460);
    glow.addColorStop(0, 'rgba(0,0,0,0)');
    glow.addColorStop(1, 'rgba(255,170,90,.14)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 220, W, 240);
  }
}

function drawSkyline(ctx, level, camX) {
  // The hillside behind the lane: same houses, small and stacked up a slope,
  // scrolling at a fraction of the camera so it sits far back.
  const par = 0.28;
  ctx.save();
  ctx.translate(camX * (1 - par), 0);
  for (const s of level.skyline) {
    const img = assets.buildings[s.img];
    if (!img) continue;
    const w = img.width * s.scale;
    const h = img.height * s.scale;
    if (s.x + w < camX * par - 240 || s.x > camX * par + W + 240) continue;
    ctx.drawImage(img, s.x, s.base - h, w, h);
  }
  ctx.restore();

  // Aerial haze: the hillside takes on the sky's colour with distance. It
  // fades in from nothing at the top so there is no visible seam.
  const haze = ctx.createLinearGradient(0, 120, 0, GROUND_Y);
  haze.addColorStop(0, `${level.time.sky[1]}00`);
  haze.addColorStop(0.55, `${level.time.sky[1]}5c`);
  haze.addColorStop(1, `${level.time.sky[2]}30`);
  ctx.save();
  ctx.translate(camX, 0);
  ctx.fillStyle = haze;
  ctx.fillRect(0, 120, W, GROUND_Y - 120);
  ctx.restore();
}

function drawHouses(ctx, level, camX) {
  for (const h of level.houses) {
    const img = assets.buildings[h.img];
    if (!img) continue;
    if (h.x + h.w < camX - 200 || h.x > camX + W + 200) continue;
    ctx.drawImage(img, h.x, GROUND_Y - h.h, h.w, h.h);
  }
  // Contact shadow where the row meets the street.
  const sh = ctx.createLinearGradient(0, GROUND_Y - 40, 0, GROUND_Y + 6);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,.32)');
  ctx.fillStyle = sh;
  ctx.fillRect(camX - 100, GROUND_Y - 40, W + 200, 46);
}

function drawGround(ctx, level, camX) {
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  g.addColorStop(0, '#5d5850');
  g.addColorStop(0.25, '#4b4741');
  g.addColorStop(1, '#332f2b');
  ctx.fillStyle = g;
  ctx.fillRect(camX - 100, GROUND_Y, W + 200, H - GROUND_Y);

  // Cobbles and cracks, hashed off world x so they hold still as it scrolls.
  ctx.save();
  const x0 = Math.floor((camX - 100) / 46) * 46;
  for (let x = x0; x < camX + W + 100; x += 46) {
    for (let row = 0; row < 3; row++) {
      const y = GROUND_Y + 12 + row * 32;
      const j = rnd(x * 0.13 + row * 3.7);
      ctx.fillStyle = `rgba(0,0,0,${0.05 + j * 0.09})`;
      ctx.fillRect(x + (row % 2) * 23 + j * 6, y, 38, 3);
    }
  }
  ctx.restore();
}

function drawProps(ctx, level, camX) {
  for (const p of level.props) {
    if (p.x < camX - 260 || p.x > camX + W + 260) continue;
    if (p.kind === 'line') {
      ctx.strokeStyle = 'rgba(20,18,16,.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + p.w / 2, p.y + 16, p.x + p.w, p.y - 6);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const t = 0.15 + i * 0.22;
        const lx = p.x + p.w * t;
        const ly = p.y + 12 - Math.abs(t - 0.5) * 18;
        ctx.fillStyle = `hsl(${(p.hue + i * 37) % 360} 55% 62%)`;
        ctx.fillRect(lx, ly, 15, 26);
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(lx, ly, 15, 4);
      }
    } else {
      ctx.fillStyle = 'rgba(60,80,90,.22)';
      ctx.beginPath();
      ctx.ellipse(p.x, GROUND_Y + 26, p.w * 0.28, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- cover

function drawCovers(ctx, level, camX) {
  for (const c of level.covers) {
    if (c.x1 < camX - 120 || c.x0 > camX + W + 120) continue;
    if (c.kind === 'car' || c.kind === 'truck') drawVehicle(ctx, c);
    else drawMasonry(ctx, c);
  }
}

/** A slab of wall, textured from a real masonry panel. */
function drawMasonry(ctx, c) {
  // A corner is a slice of its own house, so it matches what it juts out of;
  // everything else is cut from a flat wall panel.
  const img = c.house != null ? assets.buildings[c.house] : assets.walls[c.panel];
  const w = c.x1 - c.x0;
  const y = GROUND_Y - c.top;
  if (img) {
    // Sample at the panel's own aspect so the brickwork is not stretched, and
    // take the band nearest the ground, which is where the walls are.
    const sh = Math.min(img.height, c.top / (w / img.width || 1));
    const sw = Math.min(img.width, w * (sh / c.top));
    const sx = Math.max(0, Math.min(img.width - sw, c.seed * (img.width - sw)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x0, y, w, c.top);
    ctx.clip();
    ctx.drawImage(img, sx, img.height - sh, sw, sh, c.x0, y, w, c.top);
    ctx.restore();
  } else {
    ctx.fillStyle = '#8d8375';
    ctx.fillRect(c.x0, y, w, c.top);
  }

  // A capping course and a shadow give the slab a top edge to read against.
  ctx.fillStyle = 'rgba(232,226,210,.55)';
  ctx.fillRect(c.x0 - 3, y - 6, w + 6, 8);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(c.x0 - 3, y + 2, w + 6, 3);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(c.x0, GROUND_Y - 6, w, 6);
  ctx.strokeStyle = 'rgba(25,20,16,.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x0, y, w, c.top);
}

/** A parked vehicle. The sprite is the cover: its sill is the line bullets stop at. */
function drawVehicle(ctx, c) {
  const img = c.kind === 'truck' ? assets.caveirao : assets.cars[c.art];
  const w = c.x1 - c.x0;
  if (!img) {
    ctx.fillStyle = '#4a4a52';
    ctx.fillRect(c.x0, GROUND_Y - c.top, w, c.top);
    return;
  }
  const h = c.kind === 'truck' ? c.top / 0.98 : c.top / 0.60;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.beginPath();
  ctx.ellipse(c.x0 + w / 2, GROUND_Y + 4, w * 0.48, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(img, c.x0, GROUND_Y - h, w, h);
  ctx.restore();
}

// --------------------------------------------------------------- actors

function drawActor(ctx, a, world) {
  const frame = currentFrame(a);
  if (!frame) return;

  // Ground shadow, tightened up when prone.
  const s = STANCE[a.stance];
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.30)';
  ctx.beginPath();
  ctx.ellipse(a.x, a.y + 3, s.width * 0.72, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawFrame(ctx, a.key, frame, a.x, a.y, a.facing, 1, a.dead ? Math.max(0.25, 1 - a.deadTime / 14) : 1);

  if (a.hitFlash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a.hitFlash * 2.4;
    drawFrame(ctx, a.key, frame, a.x, a.y, a.facing, 1, 1);
    ctx.restore();
  }

  if (!a.dead && a.team !== 'player') drawEnemyPip(ctx, a);
  if (!a.dead && a.team === 'player') drawPlayerMark(ctx, a, world);
}

function drawEnemyPip(ctx, a) {
  const top = a.y - poseHeight(a) - 16;
  const w = 40;
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(a.x - w / 2, top, w, 5);
  ctx.fillStyle = a.hp > a.maxHp * 0.4 ? '#d8483f' : '#f0a24a';
  ctx.fillRect(a.x - w / 2, top, w * (a.hp / a.maxHp), 5);
}

function drawPlayerMark(ctx, a, world) {
  const top = a.y - poseHeight(a) - 26;
  const bob = Math.sin(world.time * 4) * 2;
  ctx.save();
  ctx.fillStyle = 'rgba(242,193,78,.95)';
  ctx.beginPath();
  ctx.moveTo(a.x, top + bob + 9);
  ctx.lineTo(a.x - 7, top + bob);
  ctx.lineTo(a.x + 7, top + bob);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBullets(ctx, world) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const b of world.bullets) {
    const len = Math.min(46, Math.abs(b.vx) * 0.016);
    ctx.strokeStyle = b.team === 'player' ? 'rgba(255,236,170,.95)' : 'rgba(255,186,140,.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.sign(b.vx) * len, b.y - b.vy * 0.016);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFx(ctx, world) {
  for (const e of world.fx) {
    const frames = assets.fx[e.kind];
    if (!frames || !frames.length) continue;
    const i = Math.min(frames.length - 1, Math.floor(e.t * e.fps));
    const img = frames[i];
    if (!img) continue;
    const meta = assets.manifest.fx[e.kind][i];
    ctx.save();
    ctx.globalAlpha = e.fade ? Math.max(0, Math.min(1, e.fade - e.t * 0.02)) : 1;
    // Bursts sit centred on the impact; a pool spreads on the ground below it.
    const y = e.ground ? GROUND_Y - meta.h * 0.75 : e.y - meta.h / 2;
    ctx.drawImage(img, e.x - meta.w / 2, y, meta.w, meta.h);
    ctx.restore();
  }
}

function drawParticles(ctx, world) {
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of world.flashes) {
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    g.addColorStop(0, `rgba(255,226,150,${f.t * 9})`);
    g.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
  }
  ctx.restore();
}

// --------------------------------------------------------------- weather

function drawWeather(ctx, world) {
  const { weather, time } = world.level;

  if (weather.rain > 0) {
    ctx.save();
    ctx.strokeStyle = time.sun ? 'rgba(200,220,240,.42)' : 'rgba(170,195,230,.34)';
    ctx.lineWidth = 1.3;
    const n = Math.floor(180 * weather.rain);
    const slant = 60 * weather.wind;
    for (let i = 0; i < n; i++) {
      const seed = i * 1.37;
      const speed = 900 + rnd(seed) * 700;
      const x = ((rnd(seed) * 1600 + world.time * slant * 4) % 1500) - 110 - world.camX * 0.25 % 200;
      const y = ((rnd(seed + 3) * H + world.time * speed) % (H + 120)) - 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - slant * 0.22, y + 22);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (weather.fog > 0) {
    const g = ctx.createLinearGradient(0, GROUND_Y - 300, 0, H);
    g.addColorStop(0, `rgba(200,205,215,0)`);
    g.addColorStop(1, `rgba(198,203,214,${weather.fog})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y - 300, W, H - GROUND_Y + 300);
  }
}

function drawLightAndTint(ctx, world) {
  const t = world.level.time;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = t.shade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = t.tint;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // At night the muzzle flashes are the light source, so they get to bloom.
  if (t.ambient < 0.7) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of world.flashes) {
      const x = f.x - world.camX;
      const g = ctx.createRadialGradient(x, f.y, 0, x, f.y, 260);
      g.addColorStop(0, `rgba(255,205,120,${f.t * 3.4})`);
      g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 260, f.y - 260, 520, 520);
    }
    ctx.restore();
  }

  // Vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${0.34 + (1 - t.ambient) * 0.3})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ HUD

export function drawHud(ctx, world) {
  const p = world.player;
  ctx.save();
  ctx.font = '600 15px "Trebuchet MS", sans-serif';
  ctx.textBaseline = 'top';

  // Health
  ctx.fillStyle = 'rgba(10,10,14,.62)';
  ctx.fillRect(22, 20, 268, 46);
  ctx.fillStyle = 'rgba(255,255,255,.14)';
  ctx.fillRect(30, 28, 252, 14);
  const hp = Math.max(0, p.hp / p.maxHp);
  ctx.fillStyle = hp > 0.5 ? '#6fbf5e' : hp > 0.25 ? '#f0a24a' : '#d8483f';
  ctx.fillRect(30, 28, 252 * hp, 14);
  ctx.fillStyle = '#e8e2d4';
  ctx.fillText(`${world.spec.name.toUpperCase()}`, 30, 46);

  // Ammo and stance
  const mag = WEAPONS[p.weapon].mag;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(10,10,14,.62)';
  ctx.fillRect(W - 250, 20, 228, 46);
  ctx.fillStyle = p.reloading > 0 ? '#f0a24a' : '#e8e2d4';
  ctx.font = '700 22px "Trebuchet MS", sans-serif';
  ctx.fillText(p.reloading > 0 ? 'RECARREGANDO' : `${p.ammo} / ${mag}`, W - 34, 24);
  ctx.font = '600 13px "Trebuchet MS", sans-serif';
  ctx.fillStyle = 'rgba(232,226,212,.75)';
  const stanceLabel = { stand: 'EM PÉ', crouch: 'AGACHADO', prone: 'DEITADO' }[p.stance];
  ctx.fillText(stanceLabel, W - 34, 50);

  // Level banner
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,10,14,.55)';
  ctx.fillRect(W / 2 - 190, 20, 380, 46);
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 17px "Trebuchet MS", sans-serif';
  ctx.fillText(`${world.level.index + 1}. ${world.level.name.toUpperCase()}`, W / 2, 25);
  ctx.fillStyle = 'rgba(232,226,212,.7)';
  ctx.font = '600 12px "Trebuchet MS", sans-serif';
  ctx.fillText(
    `${world.level.time.label} · ${world.level.weather.label} · onda ${world.waveIndex + 1}/${world.level.waves.length} · ${world.remaining} restantes`,
    W / 2, 48,
  );

  ctx.restore();

  if (world.toast && world.toastTime > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, world.toastTime * 1.6);
    ctx.textAlign = 'center';
    ctx.font = '700 40px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#f2c14e';
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 14;
    ctx.fillText(world.toast, W / 2, 150);
    ctx.restore();
  }
}

/** Minimap strip: where the player is along the lane, and where the enemies are. */
export function drawMinimap(ctx, world) {
  const x0 = 22;
  const y0 = 78;
  const w = 268;
  ctx.save();
  ctx.fillStyle = 'rgba(10,10,14,.5)';
  ctx.fillRect(x0, y0, w, 12);
  for (const a of world.actors) {
    if (a.dead) continue;
    const t = a.x / world.level.width;
    ctx.fillStyle = a.team === 'player' ? '#f2c14e' : '#d8483f';
    ctx.fillRect(x0 + t * w - 1.5, y0 + 2, 3, 8);
  }
  ctx.restore();
}
