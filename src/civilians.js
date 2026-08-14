// Residents of the lane.
//
// They are not part of the fight: bullets pass through them and they cannot be
// killed. What they do is react. They walk the alley on their own business
// until a shot goes off nearby, and then they run for it -- the art drop gives
// each of them a panic pose to run in, heads down, dropping whatever they were
// carrying. The alley reads as somewhere people live rather than a shooting
// gallery, and the moment the street empties is the moment the fight starts.

import { assets } from './assets.js';

const STROLL = 42;        // px/s, out for the shopping
const FLEE = 210;         // px/s, going home now
const HEARING = 620;      // how far a gunshot carries to a civilian
const STARTLE = 2.5;      // seconds a shot keeps them running

export function spawnCivilians(world, count) {
  const people = assets.manifest.civilians?.people;
  if (!people || !people.length) return;

  // Spread them along the lane rather than scattering at random, so the street
  // is populated everywhere instead of clumping and leaving stretches empty.
  const span = world.level.width - 400;
  for (let i = 0; i < count; i++) {
    const x = 200 + span * ((i + Math.random() * 0.85) / count);
    // Nobody is standing in the player's lap at the whistle.
    if (Math.abs(x - world.player.x) < 300) continue;
    world.civilians.push({
      person: Math.floor(Math.random() * people.length),
      x,
      facing: Math.random() < 0.5 ? 1 : -1,
      state: 'stroll',
      animT: Math.random() * 2,
      turnIn: 2 + Math.random() * 5,
      pauseFor: 0,
    });
  }
}

export function updateCivilians(world, dt) {
  const shot = world.gunfire;
  const heard = shot && world.time - shot.time < STARTLE;

  for (const c of world.civilians) {
    c.animT += dt;

    if (c.state === 'stroll') {
      if (heard && Math.abs(shot.x - c.x) < HEARING) {
        c.state = 'flee';
        c.facing = Math.sign(c.x - shot.x) || 1;
        c.animT = 0;
      } else if (c.pauseFor > 0) {
        c.pauseFor -= dt;
      } else {
        c.x += c.facing * STROLL * dt;
        c.turnIn -= dt;
        if (c.turnIn <= 0) {
          c.turnIn = 3 + Math.random() * 6;
          if (Math.random() < 0.4) c.pauseFor = 0.8 + Math.random() * 2.2;
          else c.facing *= -1;
        }
        if (c.x < 60 || c.x > world.level.width - 60) c.facing *= -1;
      }
    } else {
      // Running away, and still flinching from anything that goes off ahead.
      if (heard && Math.sign(shot.x - c.x) === c.facing && Math.abs(shot.x - c.x) < 420) {
        c.facing *= -1;
      }
      c.x += c.facing * FLEE * dt;
    }
  }

  // Once they are off the edge of the level they are gone for good.
  world.civilians = world.civilians.filter(
    (c) => c.x > -160 && c.x < world.level.width + 160,
  );
}

/** The frame to draw for a civilian right now. */
export function civFrame(c) {
  const person = assets.manifest.civilians.people[c.person];
  const running = c.state === 'flee';
  const seq = running ? person.panic : person.walk;
  if (!seq || !seq.length) return null;
  const moving = running || c.pauseFor <= 0;
  const fps = running ? 13 : 8;
  const i = moving ? Math.floor(c.animT * fps) % seq.length : 0;
  return seq[i];
}
