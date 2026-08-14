// An actor: a body with a stance, a weapon and a will.
//
// The player and every enemy run this same code. What differs is only who fills
// in the intent each tick -- a keyboard on one side, ai.js on the other -- and a
// damage scale that keeps enemy fire survivable.

import {
  STANCES, STANCE_TIME, STANCE_ORDER, WEAPONS, BODY, HEALTH, SUPPRESSION, FEEL, AI, deg,
} from './tuning.js';

let nextId = 1;

export function makeActor(opts) {
  const w = WEAPONS[opts.weapon] || WEAPONS.rifle;
  return {
    id: nextId++,
    key: opts.key,                 // which atlas to draw from
    team: opts.team || 'gang',
    player: !!opts.player,
    name: opts.name || '',

    x: opts.x || 0,
    vx: 0,
    facing: opts.facing || 1,

    stance: 'stand',
    from: 'stand',                 // the stance being left, while changing
    want: 'stand',
    change: 0,                     // seconds left in the transition
    changeLen: 0,

    weapon: opts.weapon || 'rifle',
    mag: w.mag,
    reserve: w.reserve,
    reloading: 0,                  // seconds left on the current cycle
    reloadShell: false,
    cooldown: 0,
    trigger: false,                // was the trigger already held last tick
    bloom: 0,
    heat: 0,                       // seconds since the last shot fired

    hp: opts.hp || (opts.player ? HEALTH.player : HEALTH.enemy),
    maxHp: opts.hp || (opts.player ? HEALTH.player : HEALTH.enemy),
    alive: true,
    dying: 0,
    hurt: 0,                       // seconds of flinch left
    sinceHit: 99,
    suppression: 0,

    aim: 0,                        // radians, positive is up
    intent: blankIntent(),
    anim: 'idle',
    animT: 0,
    step: 0,                       // gait phase, so feet keep time with speed
    brain: null,
  };
}

export function blankIntent() {
  return { move: 0, run: false, stance: null, fire: false, reload: false, aimAt: null, swap: null };
}

export const stanceOf = (a) => STANCES[a.stance];
export const weaponOf = (a) => WEAPONS[a.weapon];

/** Mid-transition a body is genuinely half up: interpolate, don't snap. */
function blend(a, field) {
  const now = STANCES[a.stance][field];
  if (a.change <= 0) return now;
  const k = a.changeLen > 0 ? a.change / a.changeLen : 0;
  return now + (STANCES[a.from][field] - now) * k;
}

export const bodyHeight = (a) => blend(a, 'height');
export const muzzleY = (a) => blend(a, 'muzzle');
export const muzzleX = (a) => a.x + a.facing * 0.32;
export const centre = (a) => bodyHeight(a) * 0.62;
export const busy = (a) => a.change > 0 || a.hurt > 0 || !a.alive;

export function setStance(a, want) {
  if (!STANCES[want] || want === a.want || !a.alive) return;
  const key = `${a.stance}>${want}`;
  a.from = a.stance;
  a.stance = want;
  a.want = want;
  a.changeLen = STANCE_TIME[key] ?? 0.3;
  a.change = a.changeLen;
}

export function cycleStance(a, dir) {
  const i = STANCE_ORDER.indexOf(a.want);
  setStance(a, STANCE_ORDER[Math.max(0, Math.min(2, i + dir))]);
}

export function giveWeapon(a, name) {
  if (!WEAPONS[name] || a.weapon === name) return;
  const w = WEAPONS[name];
  a.weapon = name;
  a.mag = w.mag;
  a.reserve = w.reserve;
  a.reloading = 0;
  a.bloom = 0;
  a.cooldown = Math.max(a.cooldown, 0.35);
}

export function startReload(a) {
  const w = weaponOf(a);
  if (a.reloading > 0 || a.mag >= w.mag || a.reserve <= 0 || busy(a)) return;
  a.reloading = w.reload;
  a.reloadShell = w.shellReload;
}

/** The cone a shot leaves in: the gun, the stance, and how much you are moving. */
export function spreadOf(a) {
  const w = weaponOf(a);
  const s = STANCES[a.stance];
  const speed = Math.abs(a.vx);
  const motion = 1 + Math.min(1.6, (speed / Math.max(0.5, s.run)) * 1.6);
  return (w.spread * s.steady + a.bloom) * motion;
}

/** Point the gun at a world point, within what the sprites can pretend to hold. */
function aimAt(a, target) {
  if (!target) {
    a.aim = 0;
    return;
  }
  const dx = target.x - muzzleX(a);
  const dy = target.y - muzzleY(a);
  if (Math.abs(dx) > 0.05) a.facing = dx > 0 ? 1 : -1;
  const raw = Math.atan2(dy, Math.abs(dx) || 0.01);
  const cap = deg(FEEL.aimClamp);
  a.aim = Math.max(-cap, Math.min(cap, raw));
}

function fire(a, game) {
  const w = weaponOf(a);
  const scale = a.player ? 1 : AI.damageScale;
  const mx = muzzleX(a);
  const my = muzzleY(a);
  const cone = deg(spreadOf(a));

  for (let i = 0; i < w.pellets; i++) {
    // One pellet down the middle, the rest scattered across the cone -- so a
    // shotgun still rewards lining the shot up rather than pointing it.
    const jitter = w.pellets > 1
      ? (Math.random() * 2 - 1) * deg(w.spread) + (Math.random() * 2 - 1) * cone * 0.4
      : (Math.random() + Math.random() - 1) * cone;
    const ang = a.aim + jitter + (a.brain ? a.brain.error : 0);
    game.spawnBullet({
      x: mx, y: my,
      dx: Math.cos(ang) * a.facing,
      dy: Math.sin(ang),
      speed: w.speed,
      damage: w.damage * scale,
      weapon: a.weapon,
      near: w.near, far: w.far,
      owner: a.id, team: a.team,
    });
  }

  a.mag--;
  a.cooldown = 60 / w.rpm;
  a.bloom = Math.min(w.bloomMax, a.bloom + w.bloomShot);
  a.heat = 0;
  a.trigger = true;
  game.onShot(a, w, mx, my);
}

export function damageActor(a, amount, from, game) {
  if (!a.alive) return 0;
  a.hp -= amount;
  a.hurt = HEALTH.flinch;
  a.sinceHit = 0;
  if (a.hp <= 0) {
    a.hp = 0;
    a.alive = false;
    a.dying = 0;
    a.reloading = 0;
    game.onKill(a, from);
  }
  return amount;
}

/** Which multiplier a hit at this height earns, scaled to the stance. */
export function zoneAt(a, y) {
  const h = bodyHeight(a);
  const f = y / h;
  if (f >= BODY.headBottom) return { mult: BODY.head, zone: 'head' };
  if (f <= BODY.legTop) return { mult: BODY.legs, zone: 'legs' };
  return { mult: BODY.torso, zone: 'torso' };
}

/** The box a round has to cross to count as a hit. */
export function hitbox(a) {
  return { x0: a.x - BODY.halfWidth, x1: a.x + BODY.halfWidth, y0: 0, y1: bodyHeight(a) };
}

function pickAnim(a) {
  const s = STANCES[a.stance];
  const moving = Math.abs(a.vx) > 0.15;
  const running = moving && Math.abs(a.vx) > s.walk * 1.25;
  if (!a.alive) return 'death';
  if (a.hurt > 0) return 'hit';
  if (a.heat < 0.22) return moving ? s.anim.moveFire : s.anim.fire;
  if (running) return s.anim.run;
  if (moving) return s.anim.move;
  return s.anim.idle;
}

export function updateActor(a, dt, game) {
  if (!a.alive) {
    a.dying += dt;
    a.vx = 0;
    a.anim = 'death';
    a.animT += dt;
    return;
  }

  const w = weaponOf(a);
  const s = STANCES[a.stance];
  const it = a.intent;

  a.change = Math.max(0, a.change - dt);
  a.hurt = Math.max(0, a.hurt - dt);
  a.sinceHit += dt;
  a.heat += dt;
  a.bloom = Math.max(0, a.bloom - w.bloomDecay * dt);
  a.suppression = Math.max(0, a.suppression - SUPPRESSION.decay * dt);
  a.cooldown = Math.max(0, a.cooldown - dt);

  if (it.swap) { giveWeapon(a, it.swap); it.swap = null; }
  if (it.stance && it.stance !== a.want) setStance(a, it.stance);

  // --- movement. Changing stance roots you; that is the cost of changing it.
  const top = (it.run && a.stance === 'stand' ? s.run : s.walk) * (a.change > 0 ? 0.15 : 1);
  const target = it.move * top;
  const accel = (Math.abs(target) > Math.abs(a.vx) ? 14 : 22) * dt;
  a.vx += Math.max(-accel, Math.min(accel, target - a.vx));
  if (Math.abs(target) < 0.01 && Math.abs(a.vx) < 0.05) a.vx = 0;
  a.x += a.vx * dt;
  a.x = Math.max(1, Math.min(game.arena.length - 1, a.x));
  a.step += Math.abs(a.vx) * dt;

  // --- aim. Facing follows the gun when there is something to shoot at, and
  // the direction of travel when there is not.
  if (it.aimAt) aimAt(a, it.aimAt);
  else {
    a.aim = 0;
    if (Math.abs(a.vx) > 0.1) a.facing = a.vx > 0 ? 1 : -1;
  }

  // --- reloading. The shotgun feeds one shell at a time and can be cut short
  // to get a round off, which is the whole reason to carry it.
  if (a.reloading > 0) {
    a.reloading -= dt;
    if (a.reloading <= 0) {
      if (a.reloadShell) {
        const want = Math.min(1, w.mag - a.mag, a.reserve);
        a.mag += want;
        a.reserve -= want;
        a.reloading = a.mag < w.mag && a.reserve > 0 ? w.reload : 0;
      } else {
        const want = Math.min(w.mag - a.mag, a.reserve);
        a.mag += want;
        a.reserve -= want;
        a.reloading = 0;
      }
      game.onReloadTick(a);
    }
    if (a.reloadShell && it.fire && a.mag > 0) a.reloading = 0;
  } else if (it.reload) {
    startReload(a);
  }

  // --- the trigger
  const canFire = a.cooldown <= 0 && a.mag > 0 && !busy(a) && a.reloading <= 0;
  if (it.fire && canFire && (w.auto || !a.trigger)) fire(a, game);
  if (!it.fire) a.trigger = false;
  if (it.fire && a.mag <= 0 && a.reloading <= 0) startReload(a);

  if (a.player && a.sinceHit > HEALTH.regenDelay && a.hp < a.maxHp) {
    a.hp = Math.min(a.maxHp, a.hp + HEALTH.regenRate * dt);
  }

  // One-shot intents live exactly one simulation step, not one frame: a frame
  // that draws without stepping must not swallow the reload you asked for.
  it.reload = false;

  const next = pickAnim(a);
  a.animT = next === a.anim ? a.animT + dt : 0;
  a.anim = next;
}

/** Actors are solid to each other, so a crowd has a shape and cannot stack up. */
export function separate(actors, dt) {
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < actors.length; j++) {
      const b = actors[j];
      if (!b.alive) continue;
      const d = b.x - a.x;
      const min = BODY.halfWidth * 1.7;
      if (Math.abs(d) < min) {
        const push = ((min - Math.abs(d)) / min) * FEEL.bodyPush * dt;
        const dir = d === 0 ? (a.id < b.id ? -1 : 1) : Math.sign(d);
        a.x -= dir * push;
        b.x += dir * push;
      }
    }
  }
}
