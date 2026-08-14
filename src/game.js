// FAVELA -- boot, screens, and the run of play.
//
// Screen flow: title -> pick a character -> a level card (police levels open
// with the firework code) -> waves in the lane -> next level, or the game over
// card. The world object is rebuilt per level and handed to the systems in
// actors.js and render.js; nothing survives a level but the player's choice.

import { loadAssets, assets, charSpec, anim, drawFrame } from './assets.js';
import { initInput, input, endFrame, consume, touchState } from './input.js';
import { initAudio, resumeAudio, toggleMute, sfxFirework, sfxSiren, sfxUI } from './audio.js';
import { buildLevel, LEVELS, TIMES, WEATHER } from './level.js';
import {
  makeActor, updatePlayer, updateEnemy, updateBullets, updateParticles, WEAPONS,
} from './actors.js';
import { drawWorld, drawHud, drawMinimap, W, H } from './render.js';
import { spawnCivilians, updateCivilians } from './civilians.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingQuality = 'high';

const PLAYABLE = ['p1', 'p2', 'p3', 'p4'];

const game = {
  screen: 'boot',
  pick: 0,
  levelIndex: 0,
  world: null,
  time: 0,
  transition: 0,
  intro: null,
  paused: false,
};

// Exposed so the headless driver in tools/ can step through screens.
window.__game = game;

// ------------------------------------------------------------------ world

function startLevel(levelIndex, playerKey) {
  const level = buildLevel(levelIndex, playerKey);
  const spec = charSpec(playerKey);
  const player = makeActor(playerKey, 260, {
    team: 'player', facing: 1, hp: 100, weapon: spec.weapon,
  });

  const world = {
    level,
    spec,
    player,
    actors: [player],
    bullets: [],
    particles: [],
    flashes: [],
    fx: [],
    fxMeta: assets.manifest.fx || {},
    civilians: [],
    gunfire: null,
    camX: 0,
    shake: 0,
    time: 0,
    waveIndex: 0,
    waveDelay: 1.4,
    remaining: 0,
    cleared: false,
    toast: '',
    toastTime: 0,
    onDeath: (a) => {
      if (a.team === 'player') {
        game.screen = 'gameover';
        game.transition = 0;
      }
    },
  };
  spawnCivilians(world, Math.round(level.width / 230));
  game.world = world;
  return world;
}

/** Enemy roster for a level: rival crews, police, or both. */
function enemyKeyFor(level, i) {
  if (level.enemy === 'police') return 'po';
  if (level.enemy === 'mixed') return i % 2 === 0 ? 'po' : PLAYABLE[(i * 7 + 1) % PLAYABLE.length];
  const pool = PLAYABLE.filter((k) => k !== level.playerKey);
  return pool[i % pool.length];
}

function spawnWave(world) {
  const level = world.level;
  const count = level.waves[world.waveIndex];
  const skill = Math.min(0.95, 0.35 + level.index * 0.11);
  for (let i = 0; i < count; i++) {
    const fromRight = i % 2 === 0 ? world.player.x < level.width / 2 : false;
    const side = fromRight || world.player.x < level.width * 0.4 ? 1 : -1;
    const x = side > 0
      ? Math.min(level.width - 40, world.player.x + 900 + i * 120)
      : Math.max(40, world.player.x - 900 - i * 120);
    const key = enemyKeyFor(level, i + world.waveIndex * 3);
    const e = makeActor(key, x, {
      team: 'enemy',
      facing: side > 0 ? -1 : 1,
      hp: 44 + level.index * 5,
      weapon: charSpec(key).weapon,
      skill,
    });
    world.actors.push(e);
  }
  world.remaining = count;
  world.toast = `ONDA ${world.waveIndex + 1}`;
  world.toastTime = 1.6;
}

function updatePlay(dt) {
  const world = game.world;
  world.time += dt;
  world.shake = Math.max(0, world.shake - dt * 26);
  world.toastTime = Math.max(0, world.toastTime - dt);

  updatePlayer(world, world.player, input, dt);
  for (const a of world.actors) {
    if (a.team !== 'player') updateEnemy(world, a, dt);
  }
  updateBullets(world, dt);
  updateCivilians(world, dt);
  updateParticles(world, dt);

  // Bodies linger a while, then are cleared out.
  world.actors = world.actors.filter((a) => a.team === 'player' || !a.dead || a.deadTime < 16);
  world.remaining = world.actors.filter((a) => a.team === 'enemy' && !a.dead).length;

  if (world.remaining === 0 && !world.cleared) {
    world.waveDelay -= dt;
    if (world.waveDelay <= 0) {
      if (world.waveIndex + 1 < world.level.waves.length) {
        world.waveIndex++;
        world.waveDelay = 2.2;
        spawnWave(world);
      } else {
        world.cleared = true;
        game.screen = 'cleared';
        game.transition = 0;
      }
    }
  }

  // Camera leads the way the player faces, so you see what you walk into.
  const want = world.player.x - W / 2 + world.player.facing * 130;
  world.camX += (want - world.camX) * Math.min(1, dt * 4.2);
  world.camX = Math.max(0, Math.min(world.level.width - W, world.camX));
}

// ----------------------------------------------------------------- intro

/**
 * The level card. On police levels it runs the signal from the design notes
 * first: three firework pops -- the lookouts' code that the police are coming
 * up -- and then the sirens.
 */
function startIntro(levelIndex) {
  const level = LEVELS[Math.min(levelIndex, LEVELS.length - 1)];
  const police = level.enemy === 'police' || level.enemy === 'mixed';
  game.intro = {
    t: 0,
    police,
    pops: police ? [0.5, 0.95, 1.4] : [],
    fired: 0,
    flashes: [],
    duration: police ? 4.4 : 2.6,
    level,
  };
  game.screen = 'intro';
}

function updateIntro(dt) {
  const it = game.intro;
  it.t += dt;

  while (it.fired < it.pops.length && it.t >= it.pops[it.fired]) {
    const x = 320 + it.fired * 250 + Math.random() * 90;
    it.flashes.push({ x, y: 120 + Math.random() * 90, t: 0 });
    sfxFirework();
    it.fired++;
    if (it.fired === it.pops.length) setTimeout(() => sfxSiren(3), 700);
  }
  for (const f of it.flashes) f.t += dt;

  if (it.t >= it.duration || consume('fire')) {
    startLevel(game.levelIndex, PLAYABLE[game.pick]);
    spawnWave(game.world);
    game.screen = 'play';
  }
}

function drawIntro() {
  const it = game.intro;

  ctx.fillStyle = '#0b0c12';
  ctx.fillRect(0, 0, W, H);

  // Night sky over the hill, so the fireworks read.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0d1c');
  g.addColorStop(1, '#1a1420');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // A silhouetted skyline of real houses.
  ctx.save();
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < 14; i++) {
    const img = assets.buildings[(i * 5 + it.level.name.length) % assets.buildings.length];
    if (!img) continue;
    const s = 0.42 + ((i * 37) % 20) / 100;
    const w = img.width * s;
    const h = img.height * s;
    ctx.globalAlpha = 1;
    ctx.drawImage(img, i * 108 - 60, H - h - 40, w, h);
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(6,8,16,.72)';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of it.flashes) {
    const a = Math.max(0, 1 - f.t * 1.6);
    const r = 40 + f.t * 260;
    const rg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
    rg.addColorStop(0, `rgba(255,240,200,${a * 0.95})`);
    rg.addColorStop(0.4, `rgba(255,190,90,${a * 0.35})`);
    rg.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 64px "Trebuchet MS", sans-serif';
  ctx.fillText(it.level.name.toUpperCase(), W / 2, H / 2 - 10);
  ctx.fillStyle = 'rgba(232,226,212,.8)';
  ctx.font = '600 18px "Trebuchet MS", sans-serif';
  ctx.fillText(
    `FASE ${game.levelIndex + 1} · ${TIMES[it.level.time].label} · ${WEATHER[it.level.weather].label}`.toUpperCase(),
    W / 2, H / 2 + 28,
  );

  if (it.police && it.fired >= it.pops.length) {
    ctx.fillStyle = '#d8483f';
    ctx.font = '700 24px "Trebuchet MS", sans-serif';
    ctx.fillText('FOGOS: A POLÍCIA ESTÁ SUBINDO', W / 2, H / 2 + 88);
  } else if (it.police) {
    ctx.fillStyle = 'rgba(232,226,212,.55)';
    ctx.font = '600 16px "Trebuchet MS", sans-serif';
    ctx.fillText('...', W / 2, H / 2 + 88);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- screens

function drawTitle() {
  ctx.fillStyle = '#0b0c12';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  for (let i = 0; i < 12; i++) {
    const img = assets.buildings[(i * 9) % assets.buildings.length];
    if (!img) continue;
    const s = 0.5 + ((i * 23) % 26) / 100;
    ctx.globalAlpha = 0.55;
    ctx.drawImage(img, i * 126 - 80, H - img.height * s - 20, img.width * s, img.height * s);
  }
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(9,10,18,.92)');
  g.addColorStop(1, 'rgba(9,10,18,.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 108px "Trebuchet MS", sans-serif';
  ctx.fillText('FAVELA', W / 2, 210);
  ctx.fillStyle = '#e8e2d4';
  ctx.font = '600 20px "Trebuchet MS", sans-serif';
  ctx.fillText('DEFENDA A QUEBRADA', W / 2, 268);

  ctx.fillStyle = 'rgba(232,226,212,.72)';
  ctx.font = '600 16px "Trebuchet MS", sans-serif';
  const lines = input.touch
    ? ['ARRASTE À ESQUERDA PARA ANDAR', 'TOQUE À DIREITA PARA ATIRAR', 'BOTÃO NO CANTO TROCA A POSTURA']
    : ['SETAS / WASD  ANDAR', 'SHIFT  CORRER', '↓ AGACHAR · DEITAR      ↑ LEVANTAR · SUBIR',
      'ESPAÇO  ATIRAR (MIRA AUTOMÁTICA)', 'M  SOM      P  PAUSA'];
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 360 + i * 30));

  ctx.fillStyle = Math.sin(game.time * 4) > 0 ? '#f2c14e' : 'rgba(242,193,78,.35)';
  ctx.font = '700 22px "Trebuchet MS", sans-serif';
  ctx.fillText(input.touch ? 'TOQUE PARA COMEÇAR' : 'ESPAÇO PARA COMEÇAR', W / 2, H - 90);
  ctx.restore();
}

function drawSelect() {
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#161a26');
  g.addColorStop(1, '#0c0d12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 34px "Trebuchet MS", sans-serif';
  ctx.fillText('ESCOLHA SEU PERSONAGEM', W / 2, 62);

  const slot = W / PLAYABLE.length;
  PLAYABLE.forEach((key, i) => {
    const spec = charSpec(key);
    const cx = slot * (i + 0.5);
    const sel = i === game.pick;
    const baseY = 494;

    ctx.fillStyle = sel ? 'rgba(242,193,78,.12)' : 'rgba(255,255,255,.03)';
    ctx.fillRect(cx - slot / 2 + 16, 104, slot - 32, 486);
    ctx.strokeStyle = sel ? '#f2c14e' : 'rgba(255,255,255,.10)';
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeRect(cx - slot / 2 + 16, 104, slot - 32, 486);

    // The idle loop stands the character up facing forward, which the
    // turnaround frames do not reliably do -- some of them face away.
    const frames = anim(key, 'idle');
    const f = frames[Math.floor(game.time * 5) % frames.length];
    const scale = sel ? 1.45 : 1.2;
    drawFrame(ctx, key, f, cx, baseY, 1, scale, sel ? 1 : 0.7);

    ctx.fillStyle = sel ? '#f2c14e' : 'rgba(232,226,212,.75)';
    ctx.font = '700 26px "Trebuchet MS", sans-serif';
    ctx.fillText(spec.name.toUpperCase(), cx, baseY + 16);
    ctx.fillStyle = 'rgba(232,226,212,.6)';
    ctx.font = '600 14px "Trebuchet MS", sans-serif';
    const w = WEAPONS[spec.weapon];
    ctx.fillText(spec.weapon === 'pistol' ? 'PISTOLA · TIRO FORTE' : 'FUZIL · RAJADA', cx, baseY + 48);
    ctx.fillText(`dano ${w.dmg} · pente ${w.mag}`, cx, baseY + 68);
  });

  ctx.fillStyle = 'rgba(232,226,212,.6)';
  ctx.font = '600 16px "Trebuchet MS", sans-serif';
  ctx.fillText(input.touch ? 'TOQUE NO PERSONAGEM PARA JOGAR' : '← →  ESCOLHER          ESPAÇO  CONFIRMAR', W / 2, H - 42);
  ctx.restore();
}

function drawCard(title, subtitle, hint, color = '#f2c14e') {
  ctx.fillStyle = 'rgba(8,9,14,.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.font = '700 72px "Trebuchet MS", sans-serif';
  ctx.fillText(title, W / 2, H / 2 - 30);
  ctx.fillStyle = '#e8e2d4';
  ctx.font = '600 22px "Trebuchet MS", sans-serif';
  ctx.fillText(subtitle, W / 2, H / 2 + 26);
  ctx.fillStyle = Math.sin(game.time * 4) > 0 ? 'rgba(232,226,212,.9)' : 'rgba(232,226,212,.4)';
  ctx.font = '600 18px "Trebuchet MS", sans-serif';
  ctx.fillText(hint, W / 2, H / 2 + 96);
  ctx.restore();
}

// ------------------------------------------------------------ touch pads

function drawTouchControls() {
  if (!input.touch) return;
  ctx.save();
  ctx.globalAlpha = 0.32;

  const o = touchState.origin;
  if (o && touchState.stick) {
    const s = touchState.stick;
    const len = Math.hypot(s.x, s.y) || 1;
    const cl = Math.min(80, len);
    ctx.strokeStyle = '#e8e2d4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.arc(o.x + (s.x / len) * cl, o.y + (s.y / len) * cl, 30, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = touchState.fire ? '#f2c14e' : '#e8e2d4';
  ctx.beginPath();
  ctx.arc(W - 300, H - 130, 62, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e8e2d4';
  ctx.fillRect(W - 170, H - 170, 130, 130);
  ctx.fillRect(W - 170, H - 340, 130, 130);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#15151c';
  ctx.textAlign = 'center';
  ctx.font = '700 15px "Trebuchet MS", sans-serif';
  ctx.fillText('POSTURA', W - 105, H - 110);
  ctx.fillText('CORRER', W - 105, H - 280);
  ctx.fillText('TIRO', W - 300, H - 124);
  ctx.restore();
}

// ------------------------------------------------------------------ loop

let last = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  game.time += dt;

  if (consume('pause') && game.screen === 'play') game.paused = !game.paused;

  switch (game.screen) {
    case 'title':
      drawTitle();
      if (consume('fire') || (input.touch && input.anyKey)) {
        sfxUI();
        game.screen = 'select';
      }
      break;

    case 'select': {
      drawSelect();
      if (consume('left')) { game.pick = (game.pick + PLAYABLE.length - 1) % PLAYABLE.length; sfxUI(false); }
      if (consume('right')) { game.pick = (game.pick + 1) % PLAYABLE.length; sfxUI(); }
      if (consume('fire')) {
        sfxUI();
        game.levelIndex = 0;
        startIntro(0);
      }
      break;
    }

    case 'intro':
      updateIntro(dt);
      drawIntro();
      break;

    case 'play': {
      if (!game.paused) updatePlay(dt);
      drawWorld(ctx, game.world);
      drawHud(ctx, game.world);
      drawMinimap(ctx, game.world);
      drawTouchControls();
      if (game.paused) drawCard('PAUSA', '', 'P PARA VOLTAR');
      break;
    }

    case 'cleared': {
      game.transition += dt;
      drawWorld(ctx, game.world);
      drawHud(ctx, game.world);
      const last = game.levelIndex >= LEVELS.length - 1;
      drawCard(
        last ? 'QUEBRADA SEGURA' : 'ÁREA LIMPA',
        last ? 'Você segurou todas as fases.' : `Fase ${game.levelIndex + 1} concluída`,
        last ? 'ESPAÇO PARA VOLTAR AO INÍCIO' : 'ESPAÇO PARA A PRÓXIMA FASE',
        '#6fbf5e',
      );
      if (game.transition > 0.7 && consume('fire')) {
        sfxUI();
        if (last) {
          game.screen = 'title';
        } else {
          game.levelIndex++;
          startIntro(game.levelIndex);
        }
      }
      break;
    }

    case 'gameover': {
      game.transition += dt;
      if (!game.paused) {
        // Let the death animation and the bullets already in the air finish.
        const world = game.world;
        world.time += dt;
        updateBullets(world, dt);
        updateParticles(world, dt);
        for (const a of world.actors) if (a.team !== 'player') updateEnemy(world, a, dt);
        updatePlayer(world, world.player, { held: {}, pressed: {} }, dt);
      }
      drawWorld(ctx, game.world);
      drawCard('CAIU', `Fase ${game.levelIndex + 1} · ${game.world.level.name}`, 'ESPAÇO PARA TENTAR DE NOVO', '#d8483f');
      if (game.transition > 1 && consume('fire')) {
        sfxUI();
        startIntro(game.levelIndex);
      }
      break;
    }

    default:
      break;
  }

  endFrame();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot

async function boot() {
  const bootEl = document.getElementById('boot');
  const bar = bootEl.querySelector('#bar i');

  initInput(canvas, () => {
    initAudio();
    resumeAudio();
  });

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') toggleMute();
  });

  try {
    await loadAssets('assets', (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
  } catch (err) {
    bootEl.innerHTML = `<span style="letter-spacing:0">Não foi possível carregar os assets.<br>
      Rode um servidor local: <code>python3 -m http.server</code></span>`;
    throw err;
  }

  bootEl.classList.add('done');
  game.screen = 'title';
  requestAnimationFrame((t) => { last = t; frame(t); });
}

boot();
