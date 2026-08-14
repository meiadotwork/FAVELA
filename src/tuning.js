// Every number the fight is made of, in one table.
//
// The art states its own scale -- the character sheets are captioned
// "1.78 m / 110 px" -- so the simulation is written in metres and seconds and
// converted to pixels exactly once, here. A speed of 4 m/s is a sprint whatever
// the sheet is scaled to, and a 12 m shotgun range is a length you can pace out.

/** A man is 1.70 m and the art draws him 110 px tall. The door he fights
 *  around is 2 m, which is the other end of the same ruler. */
export const PX_PER_M = 110 / 1.70;
/** Atlas frames are cut at 190 px for that same 1.78 m. */
export const SPRITE_SCALE = 110 / 190;

export const deg = (d) => (d * Math.PI) / 180;

// --- Stances -------------------------------------------------------------
//
// Stance is the spine of the game. Each one sets how tall the body is, how high
// the muzzle sits, how fast you move and how steady you shoot -- and cover is a
// box with a top edge. Those numbers alone decide who can shoot whom: crouch
// behind a low wall and the wall eats incoming fire, but it eats yours too.

export const STANCES = {
  stand: {
    name: 'EM PE',
    height: 1.70,        // top of the body, for hit tests and cover checks
    muzzle: 1.36,        // where bullets leave, and where they must clear cover
    walk: 1.35,          // m/s -- this is a gunfight, not a footrace
    run: 3.3,
    steady: 1.0,         // spread multiplier -- higher is worse
    stride: 0.72,        // metres of ground per footfall, which paces the gait
    strideRun: 1.25,
    anim: { idle: 'idle', move: 'walk', run: 'run', fire: 'shoot', moveFire: 'walkAim' },
  },
  crouch: {
    name: 'AGACHADO',
    height: 1.10,
    muzzle: 0.91,
    walk: 0.85,
    run: 0.85,
    steady: 0.62,
    stride: 0.50,
    strideRun: 0.50,
    anim: { idle: 'crouch', move: 'crouch', run: 'crouch', fire: 'crouchShoot', moveFire: 'crouchShoot' },
  },
  prone: {
    name: 'DEITADO',
    height: 0.43,
    muzzle: 0.28,
    walk: 0.40,
    run: 0.40,
    steady: 0.38,
    stride: 0.36,
    strideRun: 0.36,
    anim: { idle: 'prone', move: 'proneCrawl', run: 'proneCrawl', fire: 'proneShoot', moveFire: 'proneShoot' },
  },
};

/** Going down is quicker than getting up, and prone costs the most either way. */
export const STANCE_TIME = {
  'stand>crouch': 0.22,
  'crouch>stand': 0.30,
  'crouch>prone': 0.40,
  'prone>crouch': 0.55,
  'stand>prone': 0.62,
  'prone>stand': 0.85,
};

export const STANCE_ORDER = ['stand', 'crouch', 'prone'];

// --- Weapons -------------------------------------------------------------
//
// Weapons differ in how they answer the geometry stance creates. The rifle is a
// steady stream that reaches down the lane; the pistol hits harder per shot and
// blooms fast; the shotgun throws pellets that spread wide and die at range --
// murderous across a doorway, useless at the far end of the alley.

export const WEAPONS = {
  rifle: {
    name: 'FUZIL',
    auto: true,
    rpm: 620,
    damage: 16,
    pellets: 1,
    spread: 0.85,         // degrees, at rest, standing
    bloomShot: 0.55,      // degrees added per shot
    bloomMax: 5.0,
    bloomDecay: 6.5,      // degrees shed per second
    mag: 30,
    reserve: 300,
    reload: 2.35,
    shellReload: false,
    speed: 340,           // m/s -- fast enough that range stops being lead
    near: 26,             // full damage out to here
    far: 65,              // quarter damage here, and nothing beyond
    kick: 0.55,           // camera and muzzle rise
    sound: 'rifle',
  },
  pistol: {
    name: 'PISTOLA',
    auto: false,
    rpm: 400,
    damage: 31,
    pellets: 1,
    spread: 1.5,
    bloomShot: 1.30,
    bloomMax: 7.0,
    bloomDecay: 6.0,
    mag: 15,
    reserve: 150,
    reload: 1.75,
    shellReload: false,
    speed: 260,
    near: 12,
    far: 32,
    kick: 0.75,
    sound: 'pistol',
  },
  shotgun: {
    name: 'DOZE',
    auto: false,
    rpm: 78,              // pump-action cycle
    damage: 12,
    pellets: 8,
    spread: 6.5,
    bloomShot: 0.0,       // the spread is the gun, not the shooter
    bloomMax: 0.0,
    bloomDecay: 8.0,
    mag: 6,
    reserve: 60,
    reload: 0.52,         // per shell -- see shellReload
    shellReload: true,    // fed one at a time, and interruptible
    speed: 190,
    near: 5,
    far: 14,
    kick: 2.0,
    sound: 'shotgun',
  },
};

// --- Damage --------------------------------------------------------------

export const BODY = {
  headTop: 1.00,          // fractions of stance height, measured from the ground
  headBottom: 0.86,
  legTop: 0.42,
  halfWidth: 0.25,        // m
  head: 2.6,              // damage multipliers
  torso: 1.0,
  legs: 0.65,
};

export const HEALTH = {
  player: 100,
  enemy: 100,
  regenDelay: 6.0,        // seconds after the last hit
  regenRate: 9.0,         // hp per second, up to the last full quarter
  flinch: 0.18,           // seconds of interrupted fire when hit
};

/** A round passing this close rattles whoever it passes. */
export const SUPPRESSION = {
  radius: 1.1,            // m
  perRound: 0.34,
  decay: 0.55,            // per second
  pinned: 0.65,           // AI stays down above this
};

// --- The other side ------------------------------------------------------
//
// Enemies run the same actor code with a detuned aim: they miss, they fire in
// bursts, and they hit for half. Perfect tracking in their hands is not a fight,
// it is a formality.

export const AI = {
  damageScale: 0.5,
  sightRange: 48,         // m
  reaction: [0.28, 0.55], // seconds between seeing you and firing
  aimError: [7.5, 2.4],   // degrees, decaying to the second over settle
  aimSettle: 1.6,         // seconds of continuous sight to steady down
  burst: [3, 6],          // rounds
  burstGap: [0.35, 0.9],  // seconds between bursts
  peek: [0.9, 1.8],       // seconds spent up before ducking again
  duck: [0.7, 1.6],       // seconds spent behind cover
  coverSearch: 9,         // m of slack past its own range when judging a box
  coverWalk: 45,          // m it will walk to reach one worth having
  retreatAt: 0.22,        // fraction of health that sends it looking for cover
  desiredRange: { rifle: 24, pistol: 14, shotgun: 7 },
  rangeSlack: 6,          // m of tolerance before it closes or backs off
  minGap: 6,              // m it will not walk inside of, whatever the cover
  goProne: 20,            // m past which it fights lying down
  pinnedBreak: 2.6,       // seconds of being held down before it moves house
};

// --- Feel ----------------------------------------------------------------

export const FEEL = {
  hitstopKill: 0.055,     // seconds of frozen simulation on a kill
  hitstopHit: 0.018,
  shakeShot: 0.6,
  shakeHit: 3.2,
  shakeKill: 2.0,
  cameraLead: 3.2,        // m the camera leans toward where you are aiming
  cameraDead: 1.0,        // m of slack before the camera moves at all
  cameraLerp: 4.5,
  aimClamp: 22,           // degrees of elevation the sprites can pretend to hold
  bodyPush: 2.6,          // m/s of separation between overlapping actors
  climbUp: 1.15,          // seconds on the wall, going up
  climbDown: 0.75,        // and coming down
  zooms: [1, 0.72, 0.52], // how far the camera can be pulled back, in steps
};

export const WORLD = {
  laneLength: 95,         // m from end to end
  gravity: 18,            // m/s^2, for casings and debris
  bulletLife: 2.5,        // seconds before a round gives up
};
