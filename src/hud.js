// The read-out.
//
// The HUD only shows what the mechanics actually use: health, what is in the
// magazine, which stance you are in, how wide your cone has bloomed, and how
// hard you are being suppressed. If a number is on screen it is a number the
// simulation reads.

import { WEAPONS, STANCES, SUPPRESSION } from './tuning.js';
import { view, sx, sy, pxm } from './render.js';
import { spreadOf, muzzleX, muzzleY } from './actor.js';

const GOLD = '#f2c14e';
const INK = 'rgba(10,8,10,0.55)';

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function label(ctx, text, x, y, size = 12, colour = '#e8e2d4', align = 'left') {
  ctx.font = `${size}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

/** The crosshair opens exactly as far as the shot can stray. */
function crosshair(game) {
  const { ctx } = view;
  const p = game.player;
  if (!p.alive) return;
  const target = p.aimTarget;
  if (!target) return;

  const dist = Math.hypot(target.x - muzzleX(p), target.y - muzzleY(p));
  const spread = (spreadOf(p) * Math.PI) / 180;
  const gap = Math.max(5, Math.tan(spread) * dist * pxm());
  const x = sx(target.x);
  const y = sy(target.y);

  ctx.save();
  ctx.strokeStyle = p.aimLocked ? 'rgba(242,193,78,0.9)' : 'rgba(232,226,212,0.75)';
  ctx.lineWidth = 1.5;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * gap, y + dy * gap);
    ctx.lineTo(x + dx * (gap + 7), y + dy * (gap + 7));
    ctx.stroke();
  }
  if (p.aimLocked) {
    ctx.strokeStyle = 'rgba(242,193,78,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, gap + 3, 0, 6.283);
    ctx.stroke();
  }
  ctx.restore();
}

function healthBlock(game) {
  const { ctx } = view;
  const p = game.player;
  const x = 26;
  const y = 18;
  panel(ctx, x, y, 232, 66);

  const frac = Math.max(0, p.hp / p.maxHp);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + 12, y + 14, 208, 12);
  ctx.fillStyle = frac > 0.5 ? '#7fc26b' : frac > 0.25 ? GOLD : '#d0453a';
  ctx.fillRect(x + 12, y + 14, 208 * frac, 12);
  for (let i = 1; i < 4; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + 12 + (208 * i) / 4, y + 14, 1, 12);
  }
  label(ctx, `${Math.ceil(p.hp)}`, x + 224, y + 25, 12, '#e8e2d4', 'right');

  label(ctx, STANCES[p.stance].name, x + 12, y + 46, 13, GOLD);
  if (p.change > 0) label(ctx, 'MUDANDO', x + 100, y + 46, 11, 'rgba(232,226,212,0.6)');

  // Suppression: how much incoming fire is going past your ears.
  const sup = Math.min(1, p.suppression / 1.2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(x + 12, y + 54, 208, 4);
  ctx.fillStyle = p.suppression > SUPPRESSION.pinned ? '#d0453a' : 'rgba(232,226,212,0.5)';
  ctx.fillRect(x + 12, y + 54, 208 * sup, 4);
}

function ammoBlock(game) {
  const { ctx, W } = view;
  const p = game.player;
  const w = WEAPONS[p.weapon];
  const x = W - 258;
  const y = 18;
  panel(ctx, x, y, 232, 66);

  label(ctx, w.name, x + 12, y + 24, 14, GOLD);
  label(ctx, `${p.mag}`, x + 176, y + 28, 26, p.mag ? '#e8e2d4' : '#d0453a', 'right');
  label(ctx, `/ ${p.reserve}`, x + 220, y + 28, 12, 'rgba(232,226,212,0.55)', 'right');

  if (p.reloading > 0) {
    const k = 1 - p.reloading / (w.shellReload ? w.reload : w.reload);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + 12, y + 40, 208, 6);
    ctx.fillStyle = GOLD;
    ctx.fillRect(x + 12, y + 40, 208 * k, 6);
    label(ctx, w.shellReload ? 'CARTUCHO' : 'RECARREGANDO', x + 12, y + 60, 11, 'rgba(232,226,212,0.7)');
  } else {
    // Bloom, as a share of how wide this weapon can get.
    const bloom = w.bloomMax > 0 ? p.bloom / w.bloomMax : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x + 12, y + 40, 208, 6);
    ctx.fillStyle = bloom > 0.7 ? '#d0453a' : 'rgba(232,226,212,0.55)';
    ctx.fillRect(x + 12, y + 40, 208 * bloom, 6);
    label(ctx, `DISPERSAO ${spreadOf(p).toFixed(1)}°`, x + 12, y + 60, 11, 'rgba(232,226,212,0.6)');
  }
}

function waveBlock(game) {
  const { ctx, W } = view;
  const alive = game.actors.filter((a) => a.alive && !a.player).length;
  panel(ctx, W / 2 - 96, 18, 192, 44);
  label(ctx, `ONDA ${game.wave}`, W / 2, 40, 15, GOLD, 'center');
  label(ctx, `${alive} NA RUA · ${game.kills} ABATIDOS`, W / 2, 55, 11, 'rgba(232,226,212,0.65)', 'center');
}

function overlays(game) {
  const { ctx, W, H } = view;
  const p = game.player;

  const hurt = 1 - p.hp / p.maxHp;
  if (hurt > 0.02 || p.suppression > 0.1) {
    const k = Math.max(hurt * 0.55, Math.min(0.45, p.suppression * 0.3));
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(${p.suppression > 0.4 ? '20,14,10' : '90,10,10'},${k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  if (game.flash > 0) {
    ctx.fillStyle = `rgba(190,30,20,${Math.min(0.45, game.flash)})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (game.hitmark > 0) {
    const k = game.hitmark / 0.22;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${k})`;
    ctx.lineWidth = 2;
    const c = game.hitmarkKill ? 12 : 8;
    const x = game.hitmarkAt ? sx(game.hitmarkAt.x) : W / 2;
    const y = game.hitmarkAt ? sy(game.hitmarkAt.y) : H / 2;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * 4, y + dy * 4);
      ctx.lineTo(x + dx * c, y + dy * c);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (game.banner && game.bannerT > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, game.bannerT);
    label(ctx, game.banner, W / 2, H * 0.24, 34, GOLD, 'center');
    ctx.restore();
  }
}

// --- the touch controls --------------------------------------------------
//
// Drawn from the same tables input.js hit-tests, so the control you can see is
// exactly the control you are pressing: a direction ring on the left, a row of
// buttons on the right, all of them dark glass with a bright rim so they read
// over dirt and over a lit wall without hiding the lane behind them.

const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** The direction ring: a track, a knob, and the two ends marked. */
function stickRing(game) {
  const { ctx } = view;
  const s = game.input.stick;
  const knobX = s.active ? s.knob : s.x;

  ctx.save();
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, 6.283);
  ctx.fillStyle = 'rgba(12,10,12,0.34)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = s.active ? 'rgba(255,214,120,0.8)' : 'rgba(240,238,230,0.55)';
  ctx.stroke();

  // The axis it actually reads: left and right, and nothing else.
  ctx.strokeStyle = 'rgba(240,238,230,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x - s.r * 0.66, s.y);
  ctx.lineTo(s.x + s.r * 0.66, s.y);
  ctx.stroke();
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s.x + dir * (s.r * 0.66), s.y);
    ctx.lineTo(s.x + dir * (s.r * 0.5), s.y - 10);
    ctx.lineTo(s.x + dir * (s.r * 0.5), s.y + 10);
    ctx.closePath();
    ctx.fillStyle = 'rgba(240,238,230,0.35)';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(knobX, s.y, 38, 0, 6.283);
  ctx.fillStyle = s.active ? 'rgba(242,193,78,0.5)' : 'rgba(240,238,230,0.22)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = s.active ? 'rgba(255,224,150,0.95)' : 'rgba(240,238,230,0.6)';
  ctx.stroke();

  // At the rim it is a sprint, so say so at the rim.
  if (Math.abs(s.axis) > 0.86) {
    ctx.font = '11px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.fillText('CORRE', s.x, s.y - s.r - 10);
  }
  ctx.restore();
}

function touchPads(game) {
  const { ctx } = view;
  const input = game.input;
  if (!input || !(input.touch.active || coarse)) return;
  const p = game.player;

  stickRing(game);

  for (const pad of input.pads) {
    const lit = input.down(pad.a);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, pad.r, 0, 6.283);
    // Dark glass with a bright rim: legible against dirt or a lit wall alike,
    // and still something you can see the lane through.
    ctx.fillStyle = lit ? 'rgba(242,193,78,0.32)' : 'rgba(12,10,12,0.42)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = lit ? 'rgba(255,214,120,0.95)' : 'rgba(240,238,230,0.62)';
    ctx.stroke();

    // The weapon button says which weapon, since that is the question you ask
    // of it -- the others say what they do.
    const text = pad.a === 'swap' ? WEAPONS[p.weapon].name
      : pad.a === 'zoom' ? `${view.zoom.toFixed(2).replace(/0$/, '')}x`
        : pad.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${pad.r > 60 ? 16 : 12}px "Trebuchet MS", system-ui, sans-serif`;
    ctx.fillStyle = lit ? '#fff1c8' : 'rgba(240,238,230,0.92)';
    ctx.fillText(text, pad.x, pad.y);
    ctx.restore();
  }
}

/** A phone held upright shows a sliver of lane and none of the fight. */
export function drawRotateHint() {
  if (typeof innerWidth !== 'number' || innerWidth > innerHeight * 0.95) return false;
  const { ctx, W, H } = view;
  ctx.fillStyle = 'rgba(6,5,8,0.92)';
  ctx.fillRect(0, 0, W, H);
  label(ctx, 'GIRE O TELEFONE', W / 2, H / 2, 34, GOLD, 'center');
  label(ctx, 'o jogo e deitado', W / 2, H / 2 + 28, 15, 'rgba(232,226,212,0.6)', 'center');
  return true;
}

export function drawHud(game) {
  crosshair(game);
  healthBlock(game);
  ammoBlock(game);
  waveBlock(game);
  touchPads(game);
  overlays(game);
}

const KEYS = [
  ['SETAS / WASD', 'andar'],
  ['SHIFT', 'correr'],
  ['BAIXO', 'agachar, depois deitar'],
  ['CIMA', 'levantar'],
  ['ESPACO / MOUSE', 'atirar'],
  ['R', 'recarregar'],
  ['1 2 3 / E', 'fuzil, pistola, doze'],
  ['F1', 'mostrar a mecanica'],
];

const THUMBS = [
  ['ANEL', 'andar - quanto mais longe, mais rapido'],
  ['ANEL NA BORDA', 'correr'],
  ['BOTOES', 'tiro, carrega, agacha, arma, zoom'],
  ['ZOOM', 'afasta a camera pro tiroteio longe'],
];

export function drawTitle(game) {
  const { ctx, W, H } = view;
  ctx.fillStyle = 'rgba(8,6,10,0.72)';
  ctx.fillRect(0, 0, W, H);
  label(ctx, 'FAVELA', W / 2, H * 0.3, 74, GOLD, 'center');
  label(ctx, 'segure a viela', W / 2, H * 0.3 + 28, 16, 'rgba(232,226,212,0.7)', 'center');

  let y = H * 0.46;
  for (const [k, v] of (game?.input?.touch.active || coarse ? THUMBS : KEYS)) {
    label(ctx, k, W / 2 - 24, y, 13, '#e8e2d4', 'right');
    label(ctx, v, W / 2 + 24, y, 13, 'rgba(232,226,212,0.6)');
    y += 22;
  }
  const touch = game?.input?.touch.active || coarse;
  label(ctx, touch ? 'TOQUE PARA COMECAR' : 'ENTER PARA COMECAR', W / 2, H * 0.88, 15, GOLD, 'center');
}

export function drawPause() {
  const { ctx, W, H } = view;
  ctx.fillStyle = 'rgba(8,6,10,0.6)';
  ctx.fillRect(0, 0, W, H);
  label(ctx, 'PAUSA', W / 2, H / 2, 40, GOLD, 'center');
  label(ctx, 'P para voltar', W / 2, H / 2 + 26, 13, 'rgba(232,226,212,0.6)', 'center');
}

export function drawDead(game) {
  const { ctx, W, H } = view;
  ctx.fillStyle = 'rgba(40,6,6,0.55)';
  ctx.fillRect(0, 0, W, H);
  label(ctx, 'CAIU', W / 2, H * 0.42, 58, '#d0453a', 'center');
  label(ctx, `onda ${game.wave} · ${game.kills} abatidos`, W / 2, H * 0.42 + 30, 15, '#e8e2d4', 'center');
  label(ctx, game?.input?.touch.active || coarse ? 'TOQUE PARA VOLTAR' : 'ENTER PARA VOLTAR',
    W / 2, H * 0.42 + 74, 14, GOLD, 'center');
}
