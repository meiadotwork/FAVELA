// The mechanics, drawn.
//
// F1 turns the fight into its own diagram: every cover box with its top edge
// marked, every body with its damage zones, the line from each muzzle to the
// player and whether that line is clear. Tuning a cover shooter without being
// able to see the boxes is guesswork.

import { STANCES, BODY, AI } from './tuning.js';
import { view, sx, sy, pxm } from './render.js';
import { traceCover } from './world.js';
import { bodyHeight, muzzleX, muzzleY, hitbox, spreadOf, centre, posX } from './actor.js';

function line(ctx, x0, y0, x1, y1, colour, dash = null) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(sx(x0), sy(y0));
  ctx.lineTo(sx(x1), sy(y1));
  ctx.stroke();
  ctx.restore();
}

function text(ctx, s, x, y, colour = '#9fe8b0', size = 10) {
  ctx.font = `${size}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.fillText(s, x, y);
}

function drawCoverBoxes(game) {
  const { ctx } = view;
  for (const c of game.arena.covers) {
    const x = sx(c.x0);
    const w = c.w * pxm();
    const top = sy(c.h);
    ctx.strokeStyle = 'rgba(120,220,255,0.55)';
    ctx.strokeRect(x, top, w, sy(0) - top);

    // The top edge is the rule: below it, a round is stopped.
    ctx.strokeStyle = '#7cd6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, top);
    ctx.stroke();
    ctx.lineWidth = 1;

    if (c.glass) {
      ctx.fillStyle = 'rgba(120,220,255,0.16)';
      ctx.fillRect(x, sy(c.glass[1]), w, sy(c.glass[0]) - sy(c.glass[1]));
      text(ctx, 'vidro', x + 3, sy(c.glass[0]) - 3, '#7cd6ff');
    }
    text(ctx, `${c.kind} ${c.h.toFixed(2)}m`, x + 3, top - 4, '#7cd6ff');
  }
}

function drawBody(a) {
  const { ctx } = view;
  const box = hitbox(a);
  const h = bodyHeight(a);
  const x0 = sx(box.x0);
  const w = sx(box.x1) - x0;

  // Damage zones: head, torso, legs, in the proportions the sim uses.
  const bands = [
    [BODY.headBottom, 1.0, 'rgba(255,90,90,0.22)'],
    [BODY.legTop, BODY.headBottom, 'rgba(255,220,120,0.14)'],
    [0, BODY.legTop, 'rgba(120,255,160,0.12)'],
  ];
  for (const [lo, hi, colour] of bands) {
    ctx.fillStyle = colour;
    ctx.fillRect(x0, sy(a.y + h * hi), w, sy(a.y + h * lo) - sy(a.y + h * hi));
  }
  ctx.strokeStyle = a.player ? '#9fe8b0' : '#ff9a7a';
  ctx.strokeRect(x0, sy(a.y + h), w, sy(a.y) - sy(a.y + h));

  // Muzzle height, which is the number cover is measured against.
  line(ctx, posX(a) - 0.6, muzzleY(a), posX(a) + 0.6, muzzleY(a), '#f2c14e');
}

function drawSightlines(game) {
  const { ctx } = view;
  const p = game.player;
  for (const a of game.actors) {
    if (a.player || !a.alive || !p.alive) continue;
    const mx = muzzleX(a);
    const my = muzzleY(a);
    const hit = traceCover(game.arena, mx, my, posX(p), centre(p));
    line(ctx, mx, my, hit ? hit.x : posX(p), hit ? hit.y : centre(p),
      hit ? 'rgba(255,90,90,0.5)' : 'rgba(120,255,160,0.65)', hit ? [4, 4] : null);

    const b = a.brain;
    if (b) {
      const label = `${b.state}${b.up ? '^' : '_'} ${b.cover ? b.cover.kind : 'aberto'}`;
      text(ctx, label, sx(posX(a)) - 22, sy(a.y + bodyHeight(a)) - 18, b.seen ? '#ffd08a' : '#8aa0b8');
      if (b.cover) {
        line(ctx, b.hidePos, 0, b.hidePos, 0.5, '#5ad0ff');
        line(ctx, b.peekPos, 0, b.peekPos, 0.8, '#ffb45a');
      }
    }
  }
}

function drawPlayerAim(game) {
  const { ctx } = view;
  const p = game.player;
  if (!p.alive) return;
  const mx = muzzleX(p);
  const my = muzzleY(p);
  const reach = 40;
  const spread = (spreadOf(p) * Math.PI) / 180;
  for (const s of [-spread, 0, spread]) {
    const a = p.aim + s;
    const ex = mx + Math.cos(a) * reach * p.facing;
    const ey = my + Math.sin(a) * reach;
    const hit = traceCover(game.arena, mx, my, ex, ey);
    line(ctx, mx, my, hit ? hit.x : ex, hit ? hit.y : ey,
      s === 0 ? 'rgba(242,193,78,0.8)' : 'rgba(242,193,78,0.28)');
  }
}

function drawPanel(game) {
  const { ctx, H } = view;
  const p = game.player;
  const rows = [
    `x        ${p.x.toFixed(2)} m   v ${p.vx.toFixed(2)} m/s  pes ${p.y.toFixed(2)} m`,
    `stance   ${p.stance}${p.change > 0 ? ` -> ${p.want} ${(p.change * 1000) | 0}ms` : ''}`,
    `altura   ${bodyHeight(p).toFixed(2)} m   cano ${muzzleY(p).toFixed(2)} m`,
    `arma     ${p.weapon}  ${p.mag}/${p.reserve}  bloom ${p.bloom.toFixed(2)}`,
    `cone     ${spreadOf(p).toFixed(2)}°`,
    `supress. ${p.suppression.toFixed(2)} (pin ${AI.retreatAt})`,
    `balas    ${game.bullets.length}   atores ${game.actors.length}`,
    `onda     ${game.wave}   dt ${(game.lastDt * 1000).toFixed(1)}ms`,
  ];
  ctx.fillStyle = 'rgba(6,10,8,0.72)';
  ctx.fillRect(20, H - 92 - rows.length * 14 - 14, 320, rows.length * 14 + 12);
  rows.forEach((r, i) => text(ctx, r, 28, H - 92 - rows.length * 14 + i * 14, '#9fe8b0'));

  // What each stance would clear, for the box the player is nearest to.
  const near = game.arena.covers
    .map((c) => ({ c, d: Math.abs(c.x - p.x) }))
    .sort((a, b) => a.d - b.d)[0];
  if (near && near.d < 8) {
    const lines = Object.entries(STANCES).map(([k, s]) =>
      `${k.padEnd(7)} cano ${s.muzzle.toFixed(2)}  ${s.muzzle > near.c.h ? 'passa' : 'bloqueado'}`);
    ctx.fillStyle = 'rgba(6,10,8,0.72)';
    ctx.fillRect(360, H - 92 - 3 * 14 - 14, 260, 3 * 14 + 12);
    lines.forEach((r, i) => text(ctx, r, 368, H - 92 - 3 * 14 + i * 14, '#7cd6ff'));
  }
}

export function drawDebug(game) {
  const { ctx } = view;
  ctx.save();
  drawCoverBoxes(game);
  for (const a of game.actors) if (a.alive) drawBody(a);
  drawSightlines(game);
  drawPlayerAim(game);
  drawPanel(game);
  ctx.restore();
}
