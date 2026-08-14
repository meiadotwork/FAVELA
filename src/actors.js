// Actors and the shooting model.
//
// Three stances, from the design notes: standing walks and runs, a crouch that
// only creeps, and a prone that barely moves at all. Stance sets how tall the
// body is and how high the muzzle sits, and those two numbers are what the
// cover in level.js tests against -- so ducking behind a wall is not a special
// case anywhere, it just lowers the numbers.

import { GROUND_Y, STAND_H, blockedBy, surfaceAt, ladderAt, nearestCover } from './level.js';
import { anim, frameAt } from './assets.js';
import { sfxShot, sfxImpact, sfxHit, sfxDeath, sfxReload } from './audio.js';

export const STANCE = {
  stand: { h: STAND_H, muzzle: 0.66, speed: 150, run: 268, width: 44 },
  crouch: { h: STAND_H * 0.62, muzzle: 0.60, speed: 78, run: 78, width: 56 },
  prone: { h: STAND_H * 0.37, muzzle: 0.52, speed: 38, run: 38, width: 116 },
};

export const WEAPONS = {
  rifle: { rof: 0.11, dmg: 9, speed: 1750, mag: 30, reload: 1.7, spread: 0.02, burst: 0 },
  pistol: { rof: 0.20, dmg: 14, speed: 1450, mag: 12, reload: 1.35, spread: 0.015, burst: 0 },
};

export function makeActor(key, x, opts = {}) {
  const stance = opts.stance || 'stand';
  return {
    key,
    team: opts.team || 'enemy',
    x,
    y: GROUND_Y,               // feet
    vy: 0,
    facing: opts.facing || 1,
    stance,
    weapon: opts.weapon || 'rifle',
    hp: opts.hp ?? 100,
    maxHp: opts.hp ?? 100,
    ammo: WEAPONS[opts.weapon || 'rifle'].mag,
    reloading: 0,
    cooldown: 0,
    firing: false,
    moving: 0,                 // -1, 0, 1
    running: false,
    climbing: null,
    animName: 'idle',
    animTime: 0,
    hitFlash: 0,
    grace: 0,
    dead: false,
    deadTime: 0,
    ai: opts.team === 'player' ? null : {
      state: 'advance',
      timer: 0,
      spot: null,
      burst: 0,
      skill: opts.skill ?? 0.5,
    },
  };
}

export const poseHeight = (a) => STANCE[a.stance].h;
export const muzzleY = (a) => a.y - poseHeight(a) * STANCE[a.stance].muzzle;
export const centerY = (a) => a.y - poseHeight(a) * 0.55;

export function hitBox(a) {
  const s = STANCE[a.stance];
  const w = s.width;
  return { x0: a.x - w / 2, x1: a.x + w / 2, y0: a.y - s.h, y1: a.y };
}

/** Cycle stance downward (stand -> crouch -> prone) and back round. */
export function cycleStance(a) {
  a.stance = a.stance === 'stand' ? 'crouch' : a.stance === 'crouch' ? 'prone' : 'stand';
}

// ---------------------------------------------------------------- shooting

export function tryFire(world, a) {
  if (a.dead || a.cooldown > 0 || a.reloading > 0 || a.climbing) return false;
  const w = WEAPONS[a.weapon];
  if (a.ammo <= 0) {
    a.reloading = w.reload;
    sfxReload();
    return false;
  }

  const from = { x: a.x + a.facing * 20, y: muzzleY(a) };
  const target = autoAimTarget(world, a);

  // "The bullet auto aim": the shot leaves level and is steered onto the
  // target in flight, so aiming is a matter of choosing where to stand and
  // when to stand up -- not of pixel-hunting a crosshair.
  //
  // Only the player gets it clean. The same aim in enemy hands is lethal to
  // the point of being unfair -- perfect tracking, no let-up -- so theirs is
  // detuned by skill: they miss high or low, shoot slower, and hit softer.
  const ai = a.ai;
  const aimed = ai ? 0.35 + ai.skill * 0.5 : 1;
  let vy = 0;
  if (target) {
    const dx = target.x - from.x;
    const dy = centerY(target) - from.y;
    const t = Math.abs(dx) / w.speed;
    vy = t > 0 ? (dy / t) * aimed : 0;
    vy = Math.max(-620, Math.min(620, vy));
  }
  const scatter = ai ? w.spread * (3.4 - ai.skill * 1.8) : w.spread;
  vy += (Math.random() - 0.5) * w.speed * scatter;

  world.bullets.push({
    x: from.x,
    y: from.y,
    vx: a.facing * w.speed,
    vy,
    dmg: w.dmg * (ai ? 0.5 : 1),
    team: a.team,
    owner: a,
    homing: ai ? null : target,
    life: 1.6,
    trail: 0,
  });

  a.ammo--;
  a.cooldown = w.rof * (ai ? 2.3 : 1);
  a.firing = true;
  a.animTime = 0;
  world.shake = Math.min(9, world.shake + (a.team === 'player' ? 2.6 : 1.1));
  world.flashes.push({ x: from.x, y: from.y, t: 0.06, r: 46 });
  sfxShot(a.weapon, Math.abs(a.x - world.camX - 640));
  if (a.ammo <= 0) {
    a.reloading = w.reload;
    sfxReload();
  }
  return true;
}

/** Closest live opponent ahead of the shooter, preferring ones in the clear. */
function autoAimTarget(world, a) {
  let best = null;
  let bestScore = Infinity;
  for (const t of world.actors) {
    if (t.dead || t.team === a.team) continue;
    const dx = t.x - a.x;
    if (dx * a.facing <= 0) continue;              // behind the shooter
    const dist = Math.abs(dx);
    if (dist > 1500) continue;
    const blocked = blockedBy(world.level, a.x + a.facing * 20, muzzleY(a), t.x, centerY(t));
    const score = dist + (blocked ? 900 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function updateBullets(world, dt) {
  const { level } = world;
  for (const b of world.bullets) {
    if (b.life <= 0) continue;

    // Gentle homing keeps the auto-aim honest when the target moves after the
    // trigger, but never enough to turn a bullet round a corner.
    if (b.homing && !b.homing.dead) {
      const t = b.homing;
      const dx = t.x - b.x;
      if (dx * Math.sign(b.vx) > 0) {
        const want = (centerY(t) - b.y) / (Math.abs(dx) / Math.abs(b.vx) || 1);
        b.vy += Math.max(-1, Math.min(1, (want - b.vy) / 420)) * 1400 * dt;
      }
    }

    const nx = b.x + b.vx * dt;
    const ny = b.y + b.vy * dt;

    const hit = blockedBy(level, b.x, b.y, nx, ny);
    if (hit) {
      spark(world, hit.x, hit.y, -Math.sign(b.vx));
      sfxImpact(Math.abs(hit.x - world.camX - 640));
      b.life = 0;
      continue;
    }

    let struck = null;
    for (const a of world.actors) {
      if (a.dead || a.team === b.team) continue;
      const box = hitBox(a);
      // Swept test on x, since bullets outrun their own hitbox at these speeds.
      const enters = (b.x <= box.x1 && nx >= box.x0) || (b.x >= box.x0 && nx <= box.x1);
      if (!enters) continue;
      const t = Math.abs((b.vx > 0 ? box.x0 - b.x : box.x1 - b.x) / (b.vx * dt || 1));
      const yAt = b.y + (ny - b.y) * Math.max(0, Math.min(1, t));
      if (yAt >= box.y0 && yAt <= box.y1) {
        struck = { a, y: yAt };
        break;
      }
    }

    if (struck) {
      damage(world, struck.a, b.dmg, Math.sign(b.vx));
      spark(world, struck.a.x, struck.y, -Math.sign(b.vx), '#b3222a');
      b.life = 0;
      continue;
    }

    b.x = nx;
    b.y = ny;
    b.vy += 240 * dt;                                  // a little drop over range
    b.life -= dt;
    if (b.y > GROUND_Y) {
      spark(world, b.x, GROUND_Y, -Math.sign(b.vx));
      b.life = 0;
    }
  }
  world.bullets = world.bullets.filter((b) => b.life > 0 && Math.abs(b.x - world.camX) < 3000);
}

export function damage(world, a, amount, dir = 1) {
  if (a.dead) return;
  // A short grace period after being hit, so one burst cannot land whole and
  // delete the player between two frames.
  if (a.team === 'player') {
    if (a.grace > 0) return;
    a.grace = 0.22;
  }
  a.hp -= amount;
  a.hitFlash = 0.14;
  if (a.hp <= 0) {
    a.hp = 0;
    a.dead = true;
    a.deadTime = 0;
    a.animName = 'death';
    a.animTime = 0;
    a.facing = dir < 0 ? 1 : -1;
    sfxDeath();
    world.onDeath?.(a);
  } else {
    a.stagger = 0.22;
    sfxHit();
  }
}

function spark(world, x, y, dir, color = '#ffd27a') {
  for (let i = 0; i < 5; i++) {
    world.particles.push({
      x, y,
      vx: dir * (40 + Math.random() * 190),
      vy: (Math.random() - 0.6) * 190,
      life: 0.18 + Math.random() * 0.24,
      max: 0.42,
      color,
      size: 1 + Math.random() * 2.2,
      grav: 620,
    });
  }
}

// ------------------------------------------------------------- simulation

export function updateActor(world, a, dt) {
  a.cooldown = Math.max(0, a.cooldown - dt);
  a.hitFlash = Math.max(0, a.hitFlash - dt);
  a.grace = Math.max(0, a.grace - dt);
  a.stagger = Math.max(0, (a.stagger || 0) - dt);
  if (a.reloading > 0) {
    a.reloading -= dt;
    if (a.reloading <= 0) a.ammo = WEAPONS[a.weapon].mag;
  }

  if (a.dead) {
    a.deadTime += dt;
    a.animTime += dt;
    return;
  }

  if (a.climbing) {
    const c = a.climbing;
    c.t += dt / c.dur;
    a.y = c.fromY + (c.toY - c.fromY) * Math.min(1, c.t);
    a.x = c.fromX + (c.toX - c.fromX) * Math.min(1, c.t);
    if (c.t >= 1) {
      a.y = c.toY;
      a.climbing = null;
    }
    a.animName = 'run';
    a.animTime += dt;
    return;
  }

  // Horizontal movement, scaled by stance and by whether they are sprinting.
  const s = STANCE[a.stance];
  const speed = (a.running && a.stance === 'stand' ? s.run : s.speed) * (a.stagger > 0 ? 0.4 : 1);
  if (a.moving) {
    a.x += a.moving * speed * dt;
    a.x = Math.max(20, Math.min(world.level.width - 20, a.x));
  }

  // Gravity, and the surface under the feet: ground, or a roof to stand on.
  const support = surfaceAt(world.level, a.x, a.y);
  if (a.y < support - 0.5) {
    a.vy += 1900 * dt;
    a.y = Math.min(support, a.y + a.vy * dt);
    if (a.y >= support) a.vy = 0;
  } else {
    a.y = support;
    a.vy = 0;
  }

  chooseAnim(a, dt);
}

function chooseAnim(a, dt) {
  const shooting = a.cooldown > 0.001 && a.firing;
  let name;
  if (a.stance === 'prone') name = shooting ? 'proneShoot' : 'prone';
  else if (a.stance === 'crouch') name = shooting ? 'crouchShoot' : 'crouch';
  else if (shooting) name = a.moving ? 'walkAim' : 'shoot';
  else if (a.moving) name = a.running ? 'run' : 'walk';
  else name = 'idle';

  if (name !== a.animName) {
    a.animName = name;
    a.animTime = 0;
  }
  a.animTime += dt;
  if (a.cooldown <= 0) a.firing = false;
}

const ANIM_FPS = {
  walk: 12, run: 15, idle: 5, walkAim: 12, shoot: 16,
  crouch: 7, crouchShoot: 16, prone: 6, proneShoot: 16, hit: 10, death: 11,
};

export function currentFrame(a) {
  const name = a.dead ? 'death' : a.animName;
  const fps = ANIM_FPS[name] ?? 10;
  const frames = anim(a.key, name);
  if (a.dead) {
    // Death plays once and holds on the body.
    const i = Math.min(frames.length - 1, Math.floor(a.animTime * fps));
    return frames[i];
  }
  const moveDriven = name === 'walk' || name === 'run' || name === 'walkAim';
  const t = moveDriven ? a.animTime : a.animTime;
  return frameAt(a.key, name, Math.floor(t * fps));
}

// -------------------------------------------------------------- player

export function updatePlayer(world, a, input, dt) {
  if (a.dead) return updateActor(world, a, dt);

  const left = input.held.left;
  const right = input.held.right;
  a.moving = left === right ? 0 : (right ? 1 : -1);
  a.running = input.held.run && a.stance === 'stand';
  if (a.moving) a.facing = a.moving;

  // Down steps the stance down, up steps it back up -- and up at a ladder
  // climbs instead, which is why the ladder is checked first.
  if (input.pressed.up) {
    const l = ladderAt(world.level, a.x);
    if (l && a.y > l.top + 8 && a.stance === 'stand') {
      a.climbing = {
        t: 0, dur: 0.55,
        fromX: a.x, toX: Math.max(l.x0, Math.min(l.x1, a.x)),
        fromY: a.y, toY: l.top,
      };
      input.pressed.up = false;
    } else if (a.stance === 'prone') a.stance = 'crouch';
    else if (a.stance === 'crouch') a.stance = 'stand';
  }
  if (input.pressed.down) {
    if (a.stance === 'stand') a.stance = 'crouch';
    else if (a.stance === 'crouch') a.stance = 'prone';
  }
  if (input.pressed.stance) cycleStance(a);

  if (input.held.fire) tryFire(world, a);

  updateActor(world, a, dt);
}

// ----------------------------------------------------------------- AI

/**
 * Enemies push toward the player, then fight from cover: find a box, crouch
 * behind it, and pop up in bursts. Skill scales reaction time and accuracy, so
 * later levels press harder without changing the rules.
 */
export function updateEnemy(world, a, dt) {
  if (a.dead) return updateActor(world, a, dt);
  const player = world.player;
  const ai = a.ai;
  ai.timer -= dt;

  const dx = player.x - a.x;
  const dist = Math.abs(dx);
  a.facing = Math.sign(dx) || a.facing;

  const engaged = dist < 760;
  const lineBlocked = blockedBy(world.level, a.x + a.facing * 20, muzzleY(a), player.x, centerY(player));

  if (ai.timer <= 0) {
    ai.timer = 0.5 + Math.random() * (1.6 - ai.skill * 0.7);
    if (!engaged) {
      ai.state = 'advance';
    } else if (lineBlocked && Math.random() < 0.7) {
      ai.state = 'flank';
    } else if (Math.random() < 0.55) {
      const spot = nearestCover(world.level, a.x, player.x, 520);
      ai.spot = spot;
      ai.state = spot ? 'takeCover' : 'fight';
    } else {
      ai.state = 'fight';
    }
  }

  a.moving = 0;
  a.running = false;

  switch (ai.state) {
    case 'advance': {
      a.stance = 'stand';
      a.moving = Math.sign(dx);
      a.running = dist > 900;
      break;
    }
    case 'flank': {
      // Blocked line: walk out past the edge of whatever is in the way.
      a.stance = 'stand';
      a.moving = Math.sign(dx);
      break;
    }
    case 'takeCover': {
      const spot = ai.spot;
      if (!spot) { ai.state = 'fight'; break; }
      const d = spot.x - a.x;
      if (Math.abs(d) > 18) {
        a.moving = Math.sign(d);
        a.stance = 'stand';
      } else {
        a.stance = 'crouch';
        // Behind cover the burst is the whole point: rise, fire, drop.
        ai.burst -= dt;
        if (ai.burst <= 0) {
          ai.burst = 1.1 + Math.random() * 1.4;
          ai.popUp = 0.55 + ai.skill * 0.5;
        }
        if (ai.popUp > 0) {
          ai.popUp -= dt;
          a.stance = 'stand';
          if (!lineBlocked) tryFire(world, a);
        }
      }
      break;
    }
    default: {
      // Standing fight: close a little, shoot when the line is open.
      if (dist > 420) a.moving = Math.sign(dx);
      else if (dist < 190) a.moving = -Math.sign(dx);
      a.stance = dist < 500 && Math.random() < 0.02 ? 'crouch' : a.stance;
      if (!lineBlocked && dist < 900 && burstReady(a, dt)) tryFire(world, a);
      break;
    }
  }

  separate(world, a);
  updateActor(world, a, dt);
}

/** Push enemies apart, so a squad reads as a squad and not as one thick body. */
function separate(world, a) {
  const min = 74;
  for (const o of world.actors) {
    if (o === a || o.dead || o.team !== a.team) continue;
    const d = o.x - a.x;
    const overlap = min - Math.abs(d);
    if (overlap > 0) {
      // Split the correction between the pair, so neither gets shoved alone.
      const push = Math.sign(d || (Math.random() - 0.5)) * overlap * 0.5;
      a.x -= push;
      o.x += push;
    }
  }
}

/**
 * Trigger discipline: a few rounds, then a pause long enough to move in. Enemies
 * holding the trigger down is what made them unsurvivable, not their aim.
 */
function burstReady(a, dt) {
  const ai = a.ai;
  ai.rounds = ai.rounds ?? 0;
  ai.rest = (ai.rest ?? 0) - dt;
  if (ai.rest > 0) return false;
  if (ai.rounds >= 3 + Math.floor(ai.skill * 3)) {
    ai.rounds = 0;
    ai.rest = 0.9 + Math.random() * 1.5 * (1 - ai.skill * 0.5);
    return false;
  }
  ai.rounds++;
  return true;
}

export function updateParticles(world, dt) {
  for (const p of world.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += (p.grav ?? 400) * dt;
  }
  world.particles = world.particles.filter((p) => p.life > 0);
  for (const f of world.flashes) f.t -= dt;
  world.flashes = world.flashes.filter((f) => f.t > 0);
}
