// Gunfire, synthesised.
//
// The art drop came with no audio, and a firefight is mostly noise bursts: a
// crack of filtered white noise for the shot, a body-less thump for the report
// rolling down the alley, and short clicks for everything mechanical.

let ctx = null;
let master = null;
let noise = null;
let muted = false;

function boot() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // One second of noise, reused for every shot -- cheaper than making it again
  // sixteen times a second under automatic fire.
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function resumeAudio() {
  boot();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.55;
  return muted;
}

export const isMuted = () => muted;

function burst({ dur = 0.12, freq = 1400, q = 1.1, gain = 0.5, type = 'bandpass', decay = 0.9, pan = 0 }) {
  if (!boot() || muted) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur * decay);

  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) p.pan.value = Math.max(-1, Math.min(1, pan));

  src.connect(filter).connect(g);
  (p ? g.connect(p).connect(master) : g.connect(master));
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone({ f0 = 180, f1 = 60, dur = 0.18, gain = 0.35, type = 'sine' }) {
  if (!boot() || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * A gunshot is three sounds, not one.
 *
 * The crack is the round leaving -- a hard, bright transient a few milliseconds
 * long, which is the part that makes it sound like a weapon rather than a
 * whoosh. Under it sits the punch of the charge, a pitch falling off a cliff.
 * Behind both is the tail: the report rolling off the houses, which grows as
 * the shot gets further away, because at distance the slap is nearly all you
 * hear.
 */
const SHOT = {
  rifle: {
    crack: { freq: 3200, dur: 0.055, gain: 0.5, q: 0.7 },
    punch: { f0: 220, f1: 46, dur: 0.13, gain: 0.42 },
    tail: { freq: 900, dur: 0.28, gain: 0.16, q: 0.5 },
    click: 0.10,
  },
  pistol: {
    crack: { freq: 2400, dur: 0.05, gain: 0.52, q: 0.9 },
    punch: { f0: 300, f1: 60, dur: 0.10, gain: 0.4 },
    tail: { freq: 700, dur: 0.2, gain: 0.14, q: 0.6 },
    click: 0.12,
  },
  shotgun: {
    crack: { freq: 1500, dur: 0.09, gain: 0.55, q: 0.4 },
    punch: { f0: 150, f1: 32, dur: 0.26, gain: 0.6 },
    tail: { freq: 420, dur: 0.55, gain: 0.24, q: 0.35 },
    click: 0.06,
  },
};

export function playShot(weapon, pan = 0, distance = 0) {
  const s = SHOT[weapon] || SHOT.rifle;
  const near = Math.max(0.18, 1 - distance / 34);       // how present it is
  const far = 1 - near;                                  // how much is echo

  burst({ ...s.crack, gain: s.crack.gain * near, pan, decay: 0.55 });
  tone({ ...s.punch, gain: s.punch.gain * near, type: 'sine' });
  burst({
    ...s.tail,
    gain: s.tail.gain * (0.5 + far * 1.6),
    dur: s.tail.dur * (1 + far),
    pan,
    decay: 1,
  });
  // The action working: brass and steel, right after the round is gone.
  if (near > 0.5) burst({ dur: 0.04, freq: 5200, q: 4, gain: s.click * near, pan });
}

/**
 * A footfall. Pitched and weighted by stance, so a sprint lands harder than a
 * crouched shuffle -- and since the caller counts these off the ground covered
 * rather than off a clock, the rhythm is the speed.
 */
export function playStep(weight = 1, pan = 0, distance = 0) {
  const near = Math.max(0, 1 - distance / 18);
  if (near <= 0.02) return;
  burst({
    dur: 0.05 + 0.03 * weight,
    freq: 260 + Math.random() * 140,
    q: 0.8,
    gain: 0.1 * weight * near,
    pan,
    decay: 0.7,
  });
  burst({ dur: 0.035, freq: 3400 + Math.random() * 1200, q: 1.5, gain: 0.035 * weight * near, pan });
}

export function playImpact(material, pan = 0) {
  const map = {
    concrete: { freq: 2400, dur: 0.09, gain: 0.22 },
    metal: { freq: 3600, dur: 0.13, gain: 0.26 },
    dirt: { freq: 900, dur: 0.08, gain: 0.16 },
    flesh: { freq: 420, dur: 0.09, gain: 0.3 },
  };
  const s = map[material] || map.dirt;
  burst({ ...s, q: material === 'metal' ? 5 : 1.2, pan });
}

export function playDry() { burst({ dur: 0.04, freq: 2600, q: 6, gain: 0.25 }); }
export function playClick() { burst({ dur: 0.05, freq: 1800, q: 4, gain: 0.2 }); }
export function playReloadDone() { burst({ dur: 0.07, freq: 900, q: 3, gain: 0.28 }); }
export function playHurt() { tone({ f0: 260, f1: 70, dur: 0.3, gain: 0.35, type: 'triangle' }); }
export function playKill() {
  burst({ dur: 0.22, freq: 520, q: 0.7, gain: 0.3 });
  tone({ f0: 90, f1: 35, dur: 0.3, gain: 0.3 });
}
export function playUi(up = true) { tone({ f0: up ? 420 : 300, f1: up ? 620 : 180, dur: 0.1, gain: 0.2, type: 'square' }); }
