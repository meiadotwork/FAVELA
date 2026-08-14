// Drawing the test stage.
//
// Depth order is the point of the picture: the house is in the same layer as
// the player, so it is drawn *after* the body. Standing behind the wall really
// does put the wall in front of you -- and because that would leave the player
// looking at a house with nobody in it, the body is drawn again through the
// wall as a faint silhouette, the way a 2D game shows what it has hidden.

import { assets, drawFrame } from '../assets.js';
import { GROUND_Y, TARGET, targetBox } from './stage.js';
import { TRACER_LIFE, TRACER_LEN } from './shots.js';

export const VIEW_H = 1000;        // world px visible top to bottom
export const HORIZON = 0.76;       // where the ground line sits on screen

export function viewport(canvas, cam) {
  const scale = canvas.height / VIEW_H;
  return {
    scale,
    w: canvas.width / scale,
    h: VIEW_H,
    x: cam.x - canvas.width / scale / 2,
    y: GROUND_Y - VIEW_H * HORIZON,
  };
}

export function drawStage(ctx, canvas, stage, body, shots, cam) {
  const view = viewport(canvas, cam);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSky(ctx, canvas);

  ctx.save();
  ctx.scale(view.scale, view.scale);
  ctx.translate(-view.x, -view.y);

  drawSkyline(ctx, view);
  drawGround(ctx, stage, view);
  drawStairs(ctx, stage);

  // Anything standing on the street is behind the facade; anything on the roof
  // is on top of it. One rule, applied to the boards and to the body alike.
  for (const t of stage.targets) if (t.y > stage.house.roofY) drawTarget(ctx, t);

  // Depth is decided by where the body is standing. On the street it is behind
  // the facade -- that is the cover corner, and hiding has to look like hiding.
  // On the roof it is on top of the house and belongs in front of it, parapet,
  // water tank and all.
  const onTop = body.cover === 'roof';
  if (!onTop) drawBody(ctx, body);
  drawHouse(ctx, stage);
  for (const t of stage.targets) if (t.y <= stage.house.roofY) drawTarget(ctx, t);
  if (onTop) drawBody(ctx, body);
  else if (body.cover === 'behind') drawGhost(ctx, body, stage);

  drawShots(ctx, shots);

  ctx.restore();
  return view;
}

// ------------------------------------------------------------------ sky

function drawSky(ctx, canvas) {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#5fa8dd');
  g.addColorStop(0.62, '#b9d7e8');
  g.addColorStop(1, '#e6d9c0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** The hill behind the lane, so the stage has a horizon and not a void. */
function drawSkyline(ctx, view) {
  const imgs = assets.buildings;
  if (!imgs.length) return;
  ctx.save();
  const step = 96;
  const first = Math.floor((view.x - 400) / step);
  const last = Math.ceil((view.x + view.w + 400) / step);
  for (let i = first; i <= last; i++) {
    const img = imgs[((i % imgs.length) + imgs.length) % imgs.length];
    if (!img) continue;
    // Smaller houses sit higher, so the stack reads as a hillside climbing
    // away rather than as a row of props hanging in the sky.
    const s = 0.26 + ((i * 37) % 17) / 100;
    const h = img.height * s;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(img, i * step, GROUND_Y - h - (0.43 - s) * 300, img.width * s, h);
  }
  // Distance haze, so the hill sits behind the lane instead of in it.
  ctx.globalAlpha = 1;
  const haze = ctx.createLinearGradient(0, GROUND_Y - 420, 0, GROUND_Y);
  haze.addColorStop(0, 'rgba(186,214,232,.34)');
  haze.addColorStop(1, 'rgba(214,225,225,.62)');
  ctx.fillStyle = haze;
  ctx.fillRect(view.x, GROUND_Y - 420, view.w, 420);
  ctx.restore();
}

// --------------------------------------------------------------- ground

function drawGround(ctx, stage, view) {
  const art = stage.groundArt;
  const img = assets.ground[stage.groundIndex];
  if (!img) return;
  const first = Math.floor((view.x - art.w) / art.w);
  const last = Math.ceil((view.x + view.w) / art.w);
  for (let i = first; i <= last; i++) {
    const x = i * art.w;
    ctx.save();
    // Every other tile is mirrored, which hides the seam between copies.
    if (((i % 2) + 2) % 2 === 1) {
      ctx.translate(x + art.w, GROUND_Y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, art.w, art.h);
    } else {
      ctx.drawImage(img, x, GROUND_Y, art.w, art.h);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- props

function drawStairs(ctx, stage) {
  const img = assets.stairs[stage.stairIndex];
  const s = stage.stairs;
  if (img) ctx.drawImage(img, s.x, s.y, s.art.w, s.art.h);
}

function drawHouse(ctx, stage) {
  const img = assets.layer1[stage.houseIndex];
  const h = stage.house;
  if (img) ctx.drawImage(img, h.x, h.y, h.art.w, h.art.h);
}

function drawTarget(ctx, t) {
  const box = targetBox(t);
  ctx.save();
  ctx.fillStyle = '#4a3a28';
  ctx.fillRect(t.x - 5, box.y1 - 46, 10, 46);
  ctx.fillStyle = t.flash > 0 ? '#f2c14e' : '#c9bfae';
  ctx.fillRect(box.x0, box.y0, TARGET.w, TARGET.h - 40);
  ctx.strokeStyle = '#6b1d1d';
  ctx.lineWidth = 4;
  for (let r = 8; r < TARGET.w / 2 + 8; r += 9) {
    ctx.beginPath();
    ctx.arc(t.x, box.y0 + (TARGET.h - 40) / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#2b2118';
  ctx.font = '600 20px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(t.hits), t.x, box.y1 - 52);
  ctx.restore();
}

// ----------------------------------------------------------------- body

export function drawBody(ctx, body, alpha = 1) {
  const frame = body.anim.frame;
  if (!frame) return;
  drawFrame(ctx, body.key, frame, body.x, body.y, body.facing, 1, alpha);
}

/**
 * The body seen through the wall it is hiding behind, plus a marker over the
 * roof. Cover only reads as cover if the player can still tell where they are.
 */
function drawGhost(ctx, body, stage) {
  ctx.save();
  drawBody(ctx, body, 0.42);

  const y = stage.house.roofY - 26;
  ctx.fillStyle = 'rgba(242,193,78,.92)';
  ctx.beginPath();
  ctx.moveTo(body.x, y + 18);
  ctx.lineTo(body.x - 11, y);
  ctx.lineTo(body.x + 11, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --------------------------------------------------------------- shots

function drawShots(ctx, shots) {
  ctx.save();
  ctx.lineCap = 'round';

  ctx.globalCompositeOperation = 'lighter';
  for (const f of shots.flashes) {
    const r = 34 * (f.t / 0.05);
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, Math.max(1, r));
    g.addColorStop(0, 'rgba(255,246,214,.95)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const t of shots.tracers) {
    const a = t.t / TRACER_LIFE;
    const len = Math.min(TRACER_LEN, Math.abs(t.x1 - t.x0));
    const x1 = t.x1;
    const x0 = t.x1 - t.dir * len;
    const g = ctx.createLinearGradient(x0, t.y0, x1, t.y1);
    g.addColorStop(0, 'rgba(255,210,120,0)');
    g.addColorStop(1, `rgba(255,236,180,${0.85 * a})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x0, t.y0);
    ctx.lineTo(x1, t.y1);
    ctx.stroke();
  }

  for (const p of shots.sparks) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.restore();
}
