// FAVELA -- bancada de mecânicas.
//
// Not a game: one character, one street, one single-storey house, and every
// action the sheet can draw, laid out where they can be looked at. What is
// being tested here, in order:
//
//   * the animation machinery in anim.js -- clips, events, priorities, and a
//     walk cycle stepped by distance travelled rather than by the clock;
//   * the three postures and the moves between them;
//   * climbing: walking up a flight of stairs onto the roof of the house, and
//     falling off the other side;
//   * the cover corner from the design notes -- the house stands in the
//     player's own layer, so its wall is something to hide behind and step out
//     of, and its doorway is a hole to shoot through;
//   * shooting: rounds that cross the lane in a fifth of a second, and only
//     sometimes leave a tracer behind them.
//
// The whole stage is one screen wide and everything is on a labelled button.

import { loadAssets, assets } from '../assets.js';
import { initKeyboard, input, endFrame, consume } from '../input.js';
import { initAudio, resumeAudio, sfxShot, sfxImpact, sfxHit, sfxDeath } from '../audio.js';
import { buildStage } from './stage.js';
import { makeBody, updateBody, hurt, revive, muzzleX, muzzleY } from './body.js';
import { makeShots, updateShots, fire, TRACER_MODES } from './shots.js';
import { drawStage } from './draw.js';
import { initPad, initClipList, initToggle, tracerLabel, readout } from './ui.js';

const CHARACTER = 'p1';       // "chose one caracter": Branco, o do fuzil

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const lab = {
  stage: null,
  body: null,
  shots: makeShots(),
  cam: { x: 0, y: 0 },
  debug: false,
  locked: null,               // clip held by the inspector, or null for automatic
  fps: 60,
  chips: null,
};

// Exposed so a headless driver can pose the bench and shoot a screenshot.
window.__lab = lab;

// ------------------------------------------------------------------ boot

async function boot() {
  const bootEl = document.getElementById('boot');
  const bar = bootEl.querySelector('#bar i');

  initKeyboard(() => { initAudio(); resumeAudio(); });
  addEventListener('pointerdown', () => { initAudio(); resumeAudio(); }, { once: true });

  try {
    await loadAssets('assets', (p) => { bar.style.width = `${Math.round(p * 100)}%`; },
      { stage: true });
  } catch (err) {
    bootEl.innerHTML = '<span style="letter-spacing:0">Não foi possível carregar os assets.<br>'
      + 'Rode um servidor local: <code>python3 -m http.server</code></span>';
    throw err;
  }

  lab.stage = buildStage();
  lab.body = makeBody(CHARACTER, lab.stage.house.x1 + 260, { onShot: shoot });
  lab.cam.x = lab.body.x;

  buildControls();
  resize();
  addEventListener('resize', resize);

  bootEl.classList.add('done');
  requestAnimationFrame((t) => { last = t; frame(t); });
}

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}

// -------------------------------------------------------------- controls

function buildControls() {
  initPad();

  lab.chips = initClipList(lab.body, (name) => {
    // Picking a clip pins it; picking it again hands the body back its own
    // judgement. That is the whole of the inspector: a switch between "play
    // what the mechanics ask for" and "play this".
    lab.locked = lab.locked === name ? null : name;
    lab.body.locked = !!lab.locked;
    if (lab.locked) lab.body.anim.play(name, { restart: true });
    for (const [n, b] of lab.chips) b.classList.toggle('on', n === lab.locked);
  });

  const freeze = document.getElementById('btn-freeze');
  freeze.addEventListener('click', () => {
    lab.body.anim.frozen = !lab.body.anim.frozen;
    freeze.classList.toggle('on', lab.body.anim.frozen);
    freeze.textContent = lab.body.anim.frozen ? 'SOLTAR' : 'CONGELAR';
  });
  document.getElementById('btn-prev').addEventListener('click', () => step(-1));
  document.getElementById('btn-next').addEventListener('click', () => step(1));

  initToggle('btn-debug', ['MOSTRAR COLISÃO', 'ESCONDER COLISÃO'], (i) => { lab.debug = !!i; });
  initToggle('btn-tracer', TRACER_MODES.map((_, i) => tracerLabel(i)), (i) => {
    lab.shots.tracerMode = i;
  });

  document.getElementById('btn-ground').addEventListener('click', () => rebuild({ ground: 1 }));
  document.getElementById('btn-house').addEventListener('click', () => rebuild({ house: 1 }));

  document.getElementById('btn-hurt').addEventListener('click', () => {
    hurt(lab.body);
    if (lab.body.dead) sfxDeath(); else sfxHit();
  });
  document.getElementById('btn-revive').addEventListener('click', () => revive(lab.body));

  const clips = document.getElementById('clips');
  const toggle = document.getElementById('clips-toggle');
  // On a small window the panel would sit on top of the controls, so it starts
  // folded away and the buttons stay reachable.
  if (innerWidth < 1000 || innerHeight < 680) {
    clips.classList.add('closed');
    toggle.textContent = '+';
  }
  toggle.addEventListener('click', () => {
    clips.classList.toggle('closed');
    toggle.textContent = clips.classList.contains('closed') ? '+' : '—';
  });
}

function step(delta) {
  lab.body.anim.frozen = true;
  const freeze = document.getElementById('btn-freeze');
  freeze.classList.add('on');
  freeze.textContent = 'SOLTAR';
  lab.body.anim.step(delta);
}

/** Swap a piece of the stage, keeping the body where it stands. */
function rebuild(delta) {
  const s = lab.stage;
  lab.stage = buildStage({
    ground: (s.groundIndex + (delta.ground || 0)) % assets.manifest.ground.length,
    house: (s.houseIndex + (delta.house || 0)) % assets.manifest.layer1.length,
    stairs: s.stairIndex,
  });
}

// ------------------------------------------------------------- shooting

/**
 * Fired by the animation, not by the trigger: the controller starts the
 * shooting clip and this runs on the frame the muzzle flash is drawn.
 */
function shoot(body) {
  fire(lab.shots, { x: muzzleX(body), y: muzzleY(body) }, body.facing, body.weapon);
  sfxShot(body.weapon, 0);
}

// ------------------------------------------------------------------ loop

let last = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  lab.fps += ((dt ? 1 / dt : 60) - lab.fps) * 0.1;

  const cmd = {
    left: input.held.left,
    right: input.held.right,
    run: input.held.run,
    fire: input.held.fire,
    pressedUp: consume('up'),
    pressedDown: consume('down'),
    pressedStance: consume('stance'),
  };

  const impactsBefore = lab.shots.hits;
  updateBody(lab.body, cmd, lab.stage, dt);
  updateShots(lab.shots, lab.stage, dt);
  if (lab.shots.hits > impactsBefore) sfxImpact(0);

  // The camera leads the way the body faces and keeps the roof in frame.
  const want = lab.body.x + lab.body.facing * 120;
  lab.cam.x += (want - lab.cam.x) * Math.min(1, dt * 4.5);

  drawStage(ctx, canvas, lab.stage, lab.body, lab.shots, lab.cam, { debug: lab.debug });
  readout(lab.body, lab.shots, lab.stage, lab.fps);

  endFrame();
  requestAnimationFrame(frame);
}

boot();
