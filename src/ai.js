// The other side of the fight.
//
// An enemy reads the same geometry the player does: it picks a box, works out
// which side of it faces the threat, and then answers the one question the
// cover asks. A low wall it can shoot over is answered by standing up and
// ducking back down. A house corner it cannot shoot over is answered by
// stepping out past the edge and stepping back in. Everything else -- bursts,
// reloads, being pinned -- hangs off that cycle.

import { AI, STANCES, WEAPONS, SUPPRESSION, deg } from './tuning.js';
import { rng, range } from './world.js';
import { aimPoint } from './combat.js';
import { muzzleX, muzzleY, bodyHeight, centre, weaponOf } from './actor.js';

const rand = rng(0x5eed);

export function makeBrain(a) {
  return {
    state: 'approach',
    timer: 0,
    cover: null,
    side: 1,
    hidePos: a.x,
    peekPos: a.x,
    hideStance: 'crouch',
    hard: false,          // cover it must step around rather than shoot over
    up: false,            // currently peeking
    burst: 0,
    pinnedFor: 0,
    reaction: 0,
    settle: 0,
    error: 0,
    sway: 0,
    seen: false,
  };
}

/** What of the target this muzzle can reach right now, if anything. */
function sight(game, a, t) {
  if (Math.abs(t.x - a.x) > AI.sightRange) return null;
  return aimPoint(game.arena, { x: muzzleX(a), y: muzzleY(a) }, t);
}

/** The lowest stance this actor can hide in behind a given box. */
function hideStanceFor(cover) {
  if (STANCES.crouch.height <= cover.h - 0.02) return 'crouch';
  if (STANCES.prone.height <= cover.h - 0.02) return 'prone';
  return 'crouch';
}

/**
 * Choose a box to fight from.
 *
 * The box has to be a firing position first and a hiding place second: it is
 * judged by how far it sits from the player, not by how close it sits to the
 * enemy, or a crew spawning at the mouth of the alley digs in there and the
 * fight never happens. Walking distance only breaks ties.
 */
function chooseCover(game, a, t, avoid = null) {
  const want = AI.desiredRange[a.weapon] ?? 12;
  const own = Math.sign(a.x - t.x) || 1;              // which end of the lane it is on
  let best = null;
  for (const cover of game.arena.covers) {
    if (cover === avoid) continue;
    const reach = Math.abs(cover.x - a.x);
    if (reach > AI.coverWalk) continue;                // further than it will go
    if (Math.sign(cover.x - t.x) !== own) continue;    // never cross the player
    const side = Math.sign(t.x - cover.x) || 1;
    const behind = cover.x - side * (cover.w / 2 + 0.4);
    const rangeAt = Math.abs(t.x - behind);
    if (rangeAt < 2.0 || rangeAt > want + AI.coverSearch) continue;
    const score = Math.abs(rangeAt - want) + reach * 0.18 - cover.h * 1.2;
    if (!best || score < best.score) best = { cover, side, behind, score };
  }
  return best;
}

function takeCover(brain, found) {
  const { cover, side, behind } = found;
  const standMuzzle = STANCES.stand.muzzle;
  const hard = cover.h > standMuzzle && !(cover.glass && cover.glass[0] <= standMuzzle);
  brain.cover = cover;
  brain.side = side;
  brain.hard = hard;
  brain.hidePos = behind;
  brain.peekPos = hard ? cover.x + side * (cover.w / 2 + 0.5) : behind;
  brain.hideStance = hard ? 'stand' : hideStanceFor(cover);
}

/** Walk toward a spot, and stop dead once it is close enough to shoot from. */
function driveTo(a, x, run) {
  const d = x - a.x;
  if (Math.abs(d) < 0.35) { a.intent.move = 0; return true; }
  a.intent.move = Math.sign(d) * (Math.abs(d) > 1.2 ? 1 : 0.5);
  a.intent.run = run && Math.abs(d) > 3;
  return false;
}

export function updateBrain(a, game, dt) {
  const b = a.brain;
  const t = game.player;
  const it = a.intent;
  it.move = 0;
  it.run = false;
  it.fire = false;
  it.reload = false;
  it.aimAt = null;

  if (!a.alive || !t || !t.alive) return;

  const w = weaponOf(a);
  const spot = sight(game, a, t);
  const see = !!spot;
  b.seen = see;
  b.settle = see ? Math.min(AI.aimSettle, b.settle + dt) : 0;
  b.timer -= dt;

  // Aim error decays the longer it has you in the open, and never quite
  // reaches zero. It also drifts, so a burst walks across you rather than
  // stapling itself to one spot.
  const k = b.settle / AI.aimSettle;
  const spread = AI.aimError[0] + (AI.aimError[1] - AI.aimError[0]) * k;
  b.sway += dt * 2.2;
  b.error = deg(spread) * (Math.sin(b.sway) * 0.6 + (rand() - 0.5) * 0.8) * (1 + a.suppression);

  it.aimAt = spot || { x: t.x, y: centre(t) };

  // Cover is re-picked when the one it holds stops making sense -- the player
  // walked around it, or the fight moved on down the lane.
  const stale = !b.cover
    || Math.sign(t.x - b.cover.x) !== b.side
    || Math.abs(a.x - b.cover.x) > AI.coverWalk;
  if (stale && b.state !== 'attack') {
    const found = chooseCover(game, a, t);
    if (found) takeCover(b, found);
    else b.cover = null;
  }

  const pinned = a.suppression > SUPPRESSION.pinned;
  b.pinnedFor = pinned ? b.pinnedFor + dt : 0;

  // Being held down is a position problem, not a waiting problem. Past a few
  // seconds of it the box has stopped being cover and become a trap, so it
  // gives the box up and works its way to another one.
  if (b.pinnedFor > AI.pinnedBreak && b.cover) {
    const found = chooseCover(game, a, t, b.cover);
    if (found) {
      takeCover(b, found);
      b.state = 'approach';
      b.pinnedFor = 0;
      a.suppression *= 0.4;
    }
  }
  const hurt = a.hp / a.maxHp < AI.retreatAt;
  const wantRange = AI.desiredRange[a.weapon] ?? 12;
  const gap = Math.abs(t.x - a.x);

  // --- out of ammo: get down first, feed it second.
  if (a.mag <= 0 && a.reserve > 0) {
    b.state = 'reload';
    b.up = false;
  }

  switch (b.state) {
    case 'reload': {
      it.stance = b.cover && !b.hard ? b.hideStance : 'crouch';
      if (b.cover) driveTo(a, b.hidePos, true);
      it.reload = true;
      if (a.mag >= (w.shellReload ? Math.min(WEAPONS[a.weapon].mag, 3) : 1) && a.reloading <= 0) {
        b.state = b.cover ? 'hold' : 'attack';
        b.timer = range(rand, AI.duck) * 0.5;
      }
      break;
    }

    // Move onto the cover it has chosen, then settle behind it.
    case 'approach': {
      if (!b.cover) { b.state = 'attack'; break; }
      if (gap < AI.minGap) { b.state = 'attack'; break; }   // never walk into him
      it.stance = gap < wantRange + 4 && !b.hard ? 'crouch' : 'stand';
      if (driveTo(a, b.hidePos, gap > wantRange + 2)) {
        b.state = 'hold';
        b.timer = range(rand, AI.reaction);
        b.up = false;
      }
      break;
    }

    // Behind cover, deciding when to show itself.
    case 'hold': {
      it.stance = b.hard ? 'stand' : b.hideStance;
      driveTo(a, b.hidePos, false);
      if (pinned) { b.timer = Math.max(b.timer, 0.35); break; }
      if (hurt && gap < wantRange) break;                 // stay down and bleed
      if (b.timer <= 0) {
        b.state = 'peek';
        b.timer = range(rand, AI.peek);
        b.burst = Math.round(range(rand, AI.burst));
        b.up = true;
      }
      break;
    }

    // Up and shooting -- standing over a low wall, or stepped out past a corner.
    case 'peek': {
      it.stance = 'stand';
      driveTo(a, b.peekPos, false);
      const ready = Math.abs(a.x - b.peekPos) < 0.6 && a.change <= 0;
      if (ready && see && b.burst > 0) {
        it.fire = true;
        if (a.heat < 0.05) b.burst--;
      }
      if (b.timer <= 0 || b.burst <= 0 || pinned || (!see && b.timer < 0.4)) {
        b.state = 'hold';
        b.timer = range(rand, AI.duck) * (pinned ? 1.6 : 1);
        b.up = false;
      }
      break;
    }

    // No cover worth having: close the distance and fire on the move.
    default: {
      const closing = gap > wantRange + AI.rangeSlack;
      const backing = gap < wantRange - AI.rangeSlack;
      if (closing || backing) {
        driveTo(a, t.x - Math.sign(t.x - a.x) * wantRange, closing && gap > wantRange * 1.8);
        it.stance = 'stand';
      } else {
        it.stance = pinned ? 'prone' : 'crouch';
      }
      if (see && !pinned && b.timer <= 0) {
        it.fire = b.burst > 0;
        if (a.heat < 0.05) b.burst--;
        if (b.burst <= 0) {
          b.burst = Math.round(range(rand, AI.burst));
          b.timer = range(rand, AI.burstGap);
        }
      }
      if (b.cover && Math.abs(a.x - b.cover.x) < AI.coverWalk) b.state = 'approach';
      break;
    }
  }
}
