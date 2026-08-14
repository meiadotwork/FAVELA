// The animation machinery: clips, an animator, and the rules that pick a clip.
//
// A character sheet arrives as a bag of loose poses. What turns that into
// movement is four things, and this file is all four:
//
//   1. a clip table -- what each named animation is, how fast it runs, whether
//      it loops, and what it falls back to on a sheet that never drew it;
//   2. an animator that advances one clip, fires the events written on it, and
//      hands back the frame to draw;
//   3. distance-driven playback, so a walk cycle is stepped by how far the body
//      actually travelled and the feet do not skate;
//   4. priorities and a queue, so being shot interrupts a stroll but a stroll
//      never interrupts being shot.
//
// Nothing here knows about the game: it takes a character key and a clip name
// and gives back a frame. The controller in lab/body.js decides which clip.

import { anim } from './assets.js';

/**
 * The clip table.
 *
 *   fps      frames a second at speed 1
 *   loop     restart at the end, or hold the last frame
 *   from     which sheet animation the frames come from, when the clip is not
 *            an animation in its own right (a fall is one frame of a run)
 *   range    [first, last] of the sheet animation to use, inclusive -- the
 *            firing rows on the sheet open with the rifle down at the hip and
 *            raise it over a frame or two, which is a lead-in, not a loop
 *   frame    pin to a single frame of `from`, for held poses
 *   stride   px of ground travel per frame -- set, and the clip is stepped by
 *            distance instead of by time
 *   priority a request only interrupts a clip of the same priority or lower
 *   then     clip to fall into when this one ends
 *   events   { frameIndex: 'name' }, fired as the frame is entered
 */
export const CLIPS = {
  idle: { fps: 5, loop: true },
  walk: { fps: 12, loop: true, stride: 13 },
  run: { fps: 15, loop: true, stride: 21 },
  walkAim: { fps: 12, loop: true, stride: 13 },
  crouch: { fps: 7, loop: true, stride: 11 },
  prone: { fps: 6, loop: true, stride: 9 },
  proneCrawl: { fps: 8, loop: true, stride: 9, from: 'proneCrawl' },

  // Firing loops the frames with the rifle up and shouldered. The frames where
  // it is still coming up belong to the moment the gun is raised, not to every
  // round: played on each shot, they are all you ever see, and the character
  // spends a firefight lowering his weapon.
  shoot: {
    fps: 17, loop: false, range: [2, 4], priority: 1, then: 'idle',
    events: { 0: 'muzzle' },
  },
  crouchShoot: {
    fps: 17, loop: false, range: [2, 5], priority: 1, then: 'crouch',
    events: { 0: 'muzzle' },
  },
  proneShoot: {
    fps: 17, loop: false, range: [1, 6], priority: 1, then: 'prone',
    events: { 0: 'muzzle' },
  },

  // The sheet has no ladder or stair cycle, so the climb is the walk played
  // slower -- a body taking one step per tread rather than per stride.
  climb: { from: 'walk', fps: 9, loop: true, stride: 15 },
  // ...and no jump either. A fall holds the airborne pose out of the run.
  fall: { from: 'run', frame: 3, fps: 1, loop: false },
  land: { from: 'crouch', frame: 1, fps: 12, loop: false, priority: 1, then: 'idle' },

  hit: { fps: 11, loop: false, priority: 2, then: 'idle' },
  death: { fps: 11, loop: false, priority: 3 },
  roster: { fps: 1, loop: false },
};

/** Every clip name, in the order the inspector should list them. */
export const CLIP_NAMES = Object.keys(CLIPS);

export function clipOf(name) {
  return CLIPS[name] || CLIPS.idle;
}

const resolved = new Map();

/**
 * Frames a clip resolves to on a given character: the sheet animation it names
 * (after that sheet's own fallbacks), cut to the clip's range.
 *
 * Cached, because this is asked for several times a frame and slicing a range
 * would otherwise allocate a new array every time.
 */
export function clipFrames(key, name) {
  const id = `${key}:${name}`;
  let frames = resolved.get(id);
  if (!frames) {
    const clip = clipOf(name);
    frames = anim(key, clip.from || name);
    if (clip.range) frames = frames.slice(clip.range[0], clip.range[1] + 1);
    resolved.set(id, frames);
  }
  return frames;
}

export class Animator {
  /**
   * @param {string} key  character the frames come from
   * @param {object} opts on(event, animator) is called for every clip event
   */
  constructor(key, opts = {}) {
    this.key = key;
    this.onEvent = opts.on || (() => {});
    this.name = 'idle';
    this.time = 0;          // seconds inside the clip
    this.index = 0;         // frame index, ahead of wrapping
    this.speed = 1;
    this.done = false;
    this.fired = -1;        // last frame index whose events have gone off
  }

  get clip() {
    return clipOf(this.name);
  }

  get frames() {
    return clipFrames(this.key, this.name);
  }

  /** The frame to draw this instant. */
  get frame() {
    const clip = this.clip;
    const frames = this.frames;
    const i = Math.floor(this.index);
    if (clip.frame != null) return frames[Math.min(clip.frame, frames.length - 1)];
    if (!clip.loop) return frames[Math.max(0, Math.min(i, frames.length - 1))];
    return frames[((i % frames.length) + frames.length) % frames.length];
  }

  /**
   * Ask for a clip. Returns true if it took.
   *
   * A request is refused while a higher-priority clip is still playing, which
   * is what stops a walk cancelling the flinch from a bullet -- and refused
   * again if it is already the clip running, so holding a direction does not
   * restart the stride every frame.
   */
  play(name, { restart = false, speed = 1 } = {}) {
    if (!CLIPS[name]) return false;
    const want = clipOf(name);
    const cur = this.clip;
    if (name === this.name) {
      this.speed = speed;
      if (restart) this.reset();
      return true;
    }
    const busy = !cur.loop && !this.done && cur.priority > 0;
    if (busy && (want.priority || 0) < (cur.priority || 0)) return false;

    this.name = name;
    this.speed = speed;
    this.reset();
    return true;
  }

  reset() {
    this.time = 0;
    this.index = 0;
    this.done = false;
    this.fired = -1;
    this.fire(0);
  }

  /**
   * Advance the clip.
   *
   * @param {number} dt       seconds
   * @param {number} distance ground travelled since the last call, in px; a
   *                          clip with a stride is stepped by this instead
   */
  update(dt, distance = 0) {
    const clip = this.clip;
    const frames = this.frames;
    if (!frames.length) return;

    const before = this.index;
    if (clip.stride && distance) {
      this.index += Math.abs(distance) / clip.stride;
    } else if (clip.stride && !distance && clip.loop) {
      // A stride clip with nothing to step it -- a walk in place -- ticks over
      // slowly rather than freezing mid-stride.
      this.index += dt * clip.fps * 0.35 * this.speed;
    } else {
      this.time += dt * this.speed;
      this.index += dt * clip.fps * this.speed;
    }

    const whole = Math.floor(this.index);
    if (whole !== Math.floor(before)) this.fire(whole);

    if (!clip.loop && this.index >= frames.length - 1) {
      this.index = frames.length - 1;
      if (!this.done) {
        this.done = true;
        this.onEvent('end', this);
        if (clip.then) this.play(clip.then);
      }
    } else if (clip.loop && this.index >= frames.length) {
      this.index -= frames.length;
      this.fired = -1;
    }
  }

  fire(index) {
    const events = this.clip.events;
    if (!events) return;
    const frames = this.frames.length || 1;
    const i = this.clip.loop ? index % frames : index;
    if (i === this.fired) return;
    this.fired = i;
    const name = events[i];
    if (name) this.onEvent(name, this);
  }
}
