// The character controller: one body, every action it can take.
//
// The rule the whole thing is built on is that nothing here plays an animation
// directly. It works out what the body is doing -- which stance, moving or
// still, in the air, on the stairs, shooting -- and asks the animator for the
// matching clip; the animator decides whether that request wins (anim.js).
// Shots are not fired by the trigger either: the trigger starts the shooting
// clip, and the round leaves on the clip's `muzzle` frame.
//
// Stance is the design notes' three postures -- stand walks and runs, crouch
// creeps, prone barely moves -- and the numbers come from the game's own table
// so the test bench and the game agree.

import { Animator } from '../anim.js';
import { STANCE, WEAPONS } from '../actors.js';
import { GROUND_Y, surfaceAt, slopeAt, coverState } from './stage.js';

const GRAVITY = 1900;
const CLIMB_SLOPE = 0.22;      // steeper than this underfoot and it is a climb
const FALL_SOFT = 90;          // a drop shorter than this needs no landing

export function makeBody(key, x, opts = {}) {
  const weapon = opts.weapon || 'rifle';
  const body = {
    key,
    x,
    y: GROUND_Y,
    vy: 0,
    facing: 1,
    stance: 'stand',
    weapon,
    hp: 100,
    ammo: WEAPONS[weapon].mag,
    reload: 0,
    cooldown: 0,
    moving: 0,
    running: false,
    airborne: false,
    fallFrom: GROUND_Y,
    climbing: false,
    dead: false,
    locked: false,
    cover: 'open',
    onShot: opts.onShot || (() => {}),
    events: [],                 // animation events, for the inspector's log
  };
  body.anim = new Animator(key, { on: (name, an) => onAnimEvent(body, name, an) });
  return body;
}

function onAnimEvent(body, name, an) {
  body.events.push({ name, clip: an.name, t: performance.now() });
  if (body.events.length > 8) body.events.shift();
  if (name === 'muzzle') body.onShot(body);
}

export const stanceOf = (b) => STANCE[b.stance];
export const poseHeight = (b) => STANCE[b.stance].h;
export const muzzleY = (b) => b.y - poseHeight(b) * STANCE[b.stance].muzzle;
export const muzzleX = (b) => b.x + b.facing * (b.stance === 'prone' ? 62 : 24);

/** Step the body one frame. `cmd` is the flattened set of held/pressed inputs. */
export function updateBody(body, cmd, stage, dt) {
  const a = body;
  a.cooldown = Math.max(0, a.cooldown - dt);
  if (a.reload > 0) {
    a.reload -= dt;
    if (a.reload <= 0) a.ammo = WEAPONS[a.weapon].mag;
  }

  if (a.dead) {
    a.anim.play('death');
    a.anim.update(dt, 0);
    return;
  }

  applyStance(a, cmd);

  // Move first, then find the ground: walking into the foot of the stairs is
  // what puts a body on them, so the surface has to be read after the step.
  const s = STANCE[a.stance];
  const speed = a.running && a.stance === 'stand' ? s.run : s.speed;
  a.moving = cmd.left === cmd.right ? 0 : (cmd.right ? 1 : -1);
  a.running = !!cmd.run && a.stance === 'stand';
  if (a.moving && !a.airborne) a.facing = a.moving;

  const before = a.x;
  if (a.moving) {
    a.x = Math.max(stage.lane.x0, Math.min(stage.lane.x1, a.x + a.moving * speed * dt));
  }
  const travelled = a.x - before;

  const support = surfaceAt(stage, a.x, a.y);
  if (a.y < support - 0.5) {
    if (!a.airborne) {
      a.airborne = true;
      a.fallFrom = a.y;
    }
    a.vy += GRAVITY * dt;
    a.y = Math.min(support, a.y + a.vy * dt);
    if (a.y >= support) landed(a, support);
  } else {
    a.y = support;
    if (a.airborne) landed(a, support);
    a.vy = 0;
  }

  // A climb is not a mode the player switches into: it is what walking up a
  // steep enough surface is called.
  a.climbing = !a.airborne && a.moving !== 0
    && Math.abs(slopeAt(stage, a.x)) > CLIMB_SLOPE;

  if (cmd.fire) tryFire(a);

  a.cover = coverState(stage, a.x, a.y);
  // The inspector can pin a clip; then the controller keeps running the body
  // and only the choice of animation is taken out of its hands.
  if (!a.locked) chooseClip(a);
  a.anim.update(dt, travelled);
}

function landed(a, support) {
  const drop = support - a.fallFrom;
  a.y = support;
  a.vy = 0;
  a.airborne = false;
  if (drop > FALL_SOFT) a.anim.play('land', { restart: true });
}

function applyStance(a, cmd) {
  if (cmd.pressedDown) a.stance = a.stance === 'stand' ? 'crouch' : 'prone';
  if (cmd.pressedUp) a.stance = a.stance === 'prone' ? 'crouch' : 'stand';
  if (cmd.pressedStance) {
    a.stance = a.stance === 'stand' ? 'crouch' : a.stance === 'crouch' ? 'prone' : 'stand';
  }
}

/**
 * Pull the trigger. This does not make a bullet -- it starts the clip that
 * does, so the round always leaves on the frame the muzzle flash is drawn on.
 */
export function tryFire(a) {
  if (a.dead || a.cooldown > 0 || a.reload > 0 || a.airborne) return false;
  const w = WEAPONS[a.weapon];
  if (a.ammo <= 0) {
    a.reload = w.reload;
    return false;
  }
  const clip = a.stance === 'prone' ? 'proneShoot'
    : a.stance === 'crouch' ? 'crouchShoot' : 'shoot';
  if (!a.anim.play(clip, { restart: true })) return false;
  a.ammo--;
  a.cooldown = w.rof;
  if (a.ammo <= 0) a.reload = w.reload;
  return true;
}

/** What the body is doing, said in clip names. */
function chooseClip(a) {
  if (a.airborne) return a.anim.play('fall');
  if (a.climbing) return a.anim.play('climb');

  if (a.stance === 'prone') return a.anim.play(a.moving ? 'proneCrawl' : 'prone');
  if (a.stance === 'crouch') return a.anim.play('crouch');
  if (a.moving) return a.anim.play(a.cooldown > 0 || a.reload > 0 ? 'walkAim' : (a.running ? 'run' : 'walk'));
  return a.anim.play('idle');
}
