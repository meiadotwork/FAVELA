// The loop, the screens, and the hand that fills in the player's intent.
//
// The simulation runs on a fixed step so the mechanics behave the same on any
// machine: cover, spread, reload times and stance transitions are all measured
// in seconds, and a slow frame draws late rather than stepping further.

import { loadAssets } from './assets.js';
import { STANCE_ORDER, FEEL, HEALTH, WEAPONS } from './tuning.js';
import { buildArena, climbAt, setHouse, rng, range } from './world.js';
import {
  makeActor, updateActor, separate, setStance, cycleStance,
  centre, muzzleX, muzzleY, weaponOf, startReload,
} from './actor.js';
import { makeBrain, updateBrain } from './ai.js';
import { makeBullet, stepBullets, aimPoint } from './combat.js';
import { makeFx, updateFx, flash, casing, mark, blood, shake, hitstop, kickFor } from './fx.js';
import { makeInput, moveAxis, stickRun, anyPress } from './input.js';
import {
  initRender, buildBackdrop, renderFrame, updateCamera, setZoom, view, toWorldX, toWorldY,
} from './render.js';
import { drawHud, drawTitle, drawPause, drawDead, drawRotateHint } from './hud.js';
import { drawDebug } from './debug.js';
import {
  resumeAudio, toggleMute, playShot, playImpact, playDry, playReloadDone,
  playHurt, playKill, playUi, playStep,
} from './audio.js';

const STEP = 1 / 60;
const rand = rng(0xc0ffee);

const ENEMY_KINDS = [
  { key: 'capuz', weapon: 'pistol', team: 'gang', hp: 80 },
  { key: 'pano', weapon: 'shotgun', team: 'gang', hp: 95 },
  { key: 'po', weapon: 'rifle', team: 'police', hp: 110 },
];

const game = {
  screen: 'title',
  arena: null,
  actors: [],
  bullets: [],
  player: null,
  fx: makeFx(),
  wave: 0,
  kills: 0,
  waveTimer: 0,
  flash: 0,
  hitmark: 0,
  hitmarkAt: null,
  hitmarkKill: false,
  banner: '',
  bannerT: 0,
  debug: false,
  canClimb: false,
  lastDt: STEP,
  input: null,
};

const WEAPON_CYCLE = ['rifle', 'pistol', 'shotgun'];

// --- what the simulation calls back into ---------------------------------

game.spawnBullet = (o) => { game.bullets.push(makeBullet(o)); };

game.onShot = (a, w, mx, my) => {
  flash(game.fx, mx + a.facing * 0.15, my, a.facing, w.pellets > 1 ? 2 : 1);
  casing(game.fx, mx - a.facing * 0.2, my - 0.05, a.facing);
  const dist = Math.abs(a.x - view.cam.x);
  if (a.player) shake(game.fx, kickFor(w));
  else shake(game.fx, kickFor(w) * 0.25 * Math.max(0, 1 - dist / 26));
  playShot(w.sound, Math.max(-1, Math.min(1, (a.x - view.cam.x) / 12)), dist);
};

game.onImpact = (x, y, material, b) => {
  mark(game.fx, x, y, material, b.dx);
  if (Math.abs(x - view.cam.x) < 24) playImpact(material, (x - view.cam.x) / 12);
};

game.onFlesh = (actor, x, y, zone, dealt, b) => {
  blood(game.fx, x, y, Math.sign(b.dx) || 1, zone === 'head' ? 1 : 0.6);
  playImpact('flesh', (x - view.cam.x) / 12);
  hitstop(game.fx, FEEL.hitstopHit);
  if (b.team === 'player' && actor.alive) {
    game.hitmark = 0.22;
    game.hitmarkAt = { x, y };
    game.hitmarkKill = false;
  }
  if (actor.player) {
    game.flash = Math.min(0.5, game.flash + dealt / 90);
    shake(game.fx, FEEL.shakeHit);
    playHurt();
  }
};

game.onKill = (actor, from) => {
  hitstop(game.fx, FEEL.hitstopKill);
  shake(game.fx, FEEL.shakeKill);
  playKill();
  if (!actor.player) {
    game.kills++;
    if (from && from.team === 'player') {
      game.hitmark = 0.3;
      game.hitmarkAt = { x: actor.x, y: centre(actor) };
      game.hitmarkKill = true;
    }
  } else {
    game.screen = 'dead';
  }
};

// A footfall, from whoever is walking -- weighted by how hard the foot lands.
game.onFootstep = (a) => {
  const dist = Math.abs(a.x - view.cam.x);
  const running = Math.abs(a.vx) > 2.2;
  const weight = a.stance === 'prone' ? 0.35 : a.stance === 'crouch' ? 0.6 : running ? 1.25 : 0.9;
  playStep(weight, Math.max(-1, Math.min(1, (a.x - view.cam.x) / 12)), dist);
};

game.onNearMiss = () => {};
game.onReloadTick = (a) => { if (a.player) playReloadDone(); };

// --- setting the fight up ------------------------------------------------

function startRun() {
  game.arena = buildArena(1 + ((Math.random() * 9999) | 0));
  buildBackdrop(game.arena);
  game.actors = [];
  game.bullets = [];
  game.fx = makeFx();
  game.kills = 0;
  game.wave = 0;
  game.waveTimer = 1.2;
  game.flash = 0;
  game.banner = '';
  game.bannerT = 0;

  const p = makeActor({
    key: 'p1', name: 'Branco', weapon: 'rifle', team: 'player',
    player: true, x: game.arena.spawn.player, facing: game.arena.threat, hp: HEALTH.player,
  });
  game.player = p;
  game.actors.push(p);
  view.cam.x = p.x;
  game.screen = 'play';
}

function spawnWave() {
  game.wave++;
  const count = Math.min(8, 2 + Math.floor(game.wave * 1.2));
  const police = game.wave >= 3;
  const [near, far] = game.arena.spawn.enemy;
  for (let i = 0; i < count; i++) {
    const pool = police && rand() < 0.4 ? [ENEMY_KINDS[2]] : ENEMY_KINDS.slice(0, 2);
    const kind = pool[(rand() * pool.length) | 0];

    // One direction, always: up the lane from the far end, spread out so they
    // arrive as a column rather than a wall.
    const x = Math.min(game.arena.length - 2, range(rand, [near, far]));
    const a = makeActor({ ...kind, x, facing: -game.arena.threat });
    a.brain = makeBrain(a);
    // Later waves come up the lane already switched on.
    a.brain.timer = range(rand, [0.2, 1.4]) + i * 0.12;
    game.actors.push(a);
  }
  game.banner = police ? `ONDA ${game.wave} · POLICIA` : `ONDA ${game.wave}`;
  game.bannerT = 2.6;
  playUi(true);

  // Between waves you find a little more ammunition than you spent.
  const w = WEAPONS[game.player.weapon];
  game.player.reserve = Math.min(w.reserve, game.player.reserve + Math.ceil(w.mag * 2.5));
}

// --- the player's hand ---------------------------------------------------

/**
 * The nearest enemy the muzzle can actually reach, and the point on him it can
 * reach -- which may be only the head showing over a wall.
 */
function autoTarget(p) {
  // From the muzzle, not the body: the muzzle is what the round leaves, and at
  // a corner those are on opposite sides of a wall.
  const from = { x: muzzleX(p), y: muzzleY(p) };
  let best = null;
  for (const a of game.actors) {
    if (a.player || !a.alive) continue;
    const d = Math.abs(a.x - p.x);
    if (d > weaponOf(p).far) continue;
    const spot = aimPoint(game.arena, from, a);
    if (!spot) continue;
    const ahead = Math.sign(a.x - p.x) === p.facing;
    const score = d + (ahead ? 0 : 6);
    if (!best || score < best.score) best = { spot, score };
  }
  return best?.spot || null;
}

function readPlayer(input, dt) {
  const p = game.player;
  const it = p.intent;
  if (!p.alive) { it.fire = false; it.move = 0; return; }

  it.move = moveAxis(input);
  it.fire = input.down('fire');
  if (input.hit('reload')) it.reload = true;   // held until a step consumes it
  it.run = input.down('run') || stickRun(input);

  if (input.hit('w1')) it.swap = 'rifle';
  if (input.hit('w2')) it.swap = 'pistol';
  if (input.hit('w3')) it.swap = 'shotgun';
  if (input.hit('swap')) {
    it.swap = WEAPON_CYCLE[(WEAPON_CYCLE.indexOf(p.weapon) + 1) % WEAPON_CYCLE.length];
  }
  if (input.hit('zoom')) { setZoom(view.zoomStep + 1); playUi(view.zoom > 0.8); }
  if (input.hit('climb')) it.climb = true;

  // Down goes one stance lower, up goes one higher: stand, crouch, prone.
  if (input.hit('down')) cycleStance(p, 1);
  if (input.hit('up')) cycleStance(p, -1);
  if (input.hit('stance')) {
    const i = STANCE_ORDER.indexOf(p.want);
    setStance(p, STANCE_ORDER[(i + 1) % 3]);
  }

  // Aim: the mouse if it has been moved, otherwise the nearest enemy in reach.
  // Either way the shot is a real line from the muzzle, and cover is cover.
  if (input.mouse.active) {
    const wx = toWorldX(input.mouse.x);
    const wy = Math.max(0.05, toWorldY(input.mouse.y));
    p.aimTarget = { x: wx, y: wy };
    p.aimLocked = false;
  } else {
    // With nothing to lock onto, aim the way you are walking -- taking the
    // fallback from the current facing instead would pin you to one direction
    // for the whole game, since facing is then only ever set by the fallback.
    const spot = autoTarget(p);
    const dir = it.move !== 0 ? Math.sign(it.move) : p.facing;
    p.aimTarget = spot || { x: p.x + dir * 12, y: muzzleY(p) };
    p.aimLocked = !!spot;
  }
  it.aimAt = p.aimTarget;

  // Whether there is a wall within reach, for the button to say so.
  game.canClimb = !!climbAt(game.arena, p.x, p.y) && !p.climb;

  if (it.fire && p.mag <= 0 && p.reloading <= 0) {
    if (p.reserve > 0) startReload(p);
    else if (p.cooldown <= 0) { playDry(); p.cooldown = 0.35; }
  }
  void dt;
}

// --- the step ------------------------------------------------------------

function step(dt) {
  const p = game.player;

  for (const a of game.actors) {
    if (a.brain) updateBrain(a, game, dt);
    updateActor(a, dt, game);
  }
  separate(game.actors, dt);
  stepBullets(game, dt);
  updateFx(game.fx, dt);

  game.flash = Math.max(0, game.flash - dt * 1.4);
  game.hitmark = Math.max(0, game.hitmark - dt);
  game.bannerT = Math.max(0, game.bannerT - dt);

  // The dead are cleared once they have finished falling and faded.
  game.actors = game.actors.filter((a) => a.player || a.alive || a.dying < 8);

  const enemies = game.actors.filter((a) => !a.player && a.alive).length;
  if (enemies === 0) {
    game.waveTimer -= dt;
    if (game.waveTimer <= 0) {
      spawnWave();
      game.waveTimer = 4.5;
    }
  }
  void p;
}

// --- the loop ------------------------------------------------------------

let acc = 0;
let last = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  game.lastDt = dt;

  const input = game.input;
  if (input.hit('debug')) game.debug = !game.debug;
  if (input.hit('mute')) toggleMute();

  if (game.screen === 'title') {
    if (anyPress(input)) { resumeAudio(); startRun(); }
  } else if (game.screen === 'dead') {
    if (anyPress(input)) { playUi(false); game.screen = 'title'; }
  } else if (input.hit('pause')) {
    game.screen = game.screen === 'pause' ? 'play' : 'pause';
  }

  if (game.screen === 'play') {
    readPlayer(input, dt);
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps++ < 5) {
      if (game.fx.hitstop > 0) { game.fx.hitstop -= STEP; acc -= STEP; continue; }
      step(STEP);
      acc -= STEP;
    }
    updateCamera(game, dt);
  }

  if (game.arena) {
    renderFrame(game);
    if (game.screen !== 'title') drawHud(game);
    if (game.debug) drawDebug(game);
  }
  if (game.screen === 'title') drawTitle(game);
  if (game.screen === 'pause') drawPause();
  if (game.screen === 'dead') drawDead(game);
  drawRotateHint();

  input.flush();
}

// --- boot ----------------------------------------------------------------

async function boot() {
  const canvas = document.getElementById('game');
  const bar = document.querySelector('#bar i');
  initRender(canvas);
  game.input = makeInput(canvas);

  const manifest = await loadAssets('assets', (k) => {
    if (bar) bar.style.width = `${Math.round(k * 100)}%`;
  });
  // The artwork carries its own measurements; the level is built from those.
  setHouse(manifest.house?.metres);
  document.getElementById('boot')?.classList.add('done');

  // A quiet lane to look at behind the title screen.
  game.arena = buildArena(4);
  buildBackdrop(game.arena);
  game.player = makeActor({
    key: 'p1', weapon: 'rifle', team: 'player', player: true, x: game.arena.spawn.player,
  });
  game.actors = [game.player];
  view.cam.x = game.player.x;

  // The whole state, reachable from the console -- tuning a fight is a lot
  // easier when you can read the numbers out of it while it is running.
  game.view = view;
  window.FAVELA = game;

  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
}

boot();
