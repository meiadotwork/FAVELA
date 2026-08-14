// All sound is synthesised. The art drop shipped no audio, and a favela
// firefight is mostly noise bursts and sirens, which WebAudio makes cheaply
// and lets us retune per weapon without shipping a byte.

let ctx = null;
let master = null;
let muted = false;

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

export const isMuted = () => muted;

/** A short burst of filtered white noise: the body of every gunshot and impact. */
function noise(duration, { type = 'lowpass', freq = 1800, q = 1, gain = 0.5, decay = 1 } = {}) {
  if (!ctx) return;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** decay;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const g = ctx.createGain();
  g.gain.value = gain;

  src.connect(filter).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + duration);
}

function tone(freq, duration, { type = 'sine', gain = 0.25, sweepTo = null } = {}) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(freq, now);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + duration);
}

/** Distance fades a sound and dulls it, so far-off fire sits behind the player's. */
function distanceMix(dist) {
  const near = Math.max(0, 1 - dist / 1400);
  return { gain: 0.12 + near * 0.55, freq: 900 + near * 2600 };
}

export function sfxShot(weapon = 'rifle', dist = 0) {
  const { gain, freq } = distanceMix(dist);
  if (weapon === 'pistol') {
    noise(0.09, { freq: freq * 0.9, gain: gain * 0.75, q: 1.5, decay: 2 });
    tone(180, 0.07, { type: 'square', gain: gain * 0.12, sweepTo: 60 });
  } else {
    noise(0.14, { freq, gain, q: 1.2, decay: 1.6 });
    tone(120, 0.11, { type: 'triangle', gain: gain * 0.18, sweepTo: 45 });
  }
}

export function sfxImpact(dist = 0) {
  const { gain } = distanceMix(dist);
  noise(0.06, { type: 'highpass', freq: 2200, gain: gain * 0.5, decay: 3 });
}

export function sfxHit() {
  noise(0.18, { freq: 700, gain: 0.5, decay: 1.2 });
  tone(90, 0.16, { type: 'sine', gain: 0.3, sweepTo: 40 });
}

export function sfxDeath() {
  noise(0.4, { freq: 420, gain: 0.4, decay: 0.8 });
  tone(70, 0.5, { type: 'sine', gain: 0.25, sweepTo: 30 });
}

/** The three pops that warn the hill the police are coming in. */
export function sfxFirework() {
  noise(0.05, { type: 'highpass', freq: 1200, gain: 0.55, decay: 4 });
  tone(2200, 0.12, { type: 'square', gain: 0.05, sweepTo: 400 });
}

/** Two-tone wail, repeated `wails` times from the given moment. */
export function sfxSiren(wails = 3) {
  if (!ctx) return;
  for (let i = 0; i < wails; i++) {
    const at = i * 0.62;
    setTimeout(() => tone(720, 0.3, { type: 'sawtooth', gain: 0.07, sweepTo: 980 }), at * 1000);
    setTimeout(() => tone(980, 0.3, { type: 'sawtooth', gain: 0.07, sweepTo: 720 }), (at + 0.31) * 1000);
  }
}

export function sfxUI(up = true) {
  tone(up ? 660 : 440, 0.06, { type: 'square', gain: 0.1 });
}

export function sfxReload() {
  noise(0.05, { type: 'bandpass', freq: 3000, q: 3, gain: 0.3, decay: 2 });
  setTimeout(() => noise(0.06, { type: 'bandpass', freq: 1800, q: 3, gain: 0.35, decay: 2 }), 110);
}
