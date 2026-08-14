// Loading and drawing of the art built by tools/build_assets.py.
//
// Every character is one WebP atlas plus a table of frames; each frame carries
// an `ax` anchor, the x inside the frame where the sprite meets the ground.
// Drawing through anchorAt() keeps a character planted on one spot while its
// silhouette changes underneath it -- a rifle swinging out to the right must
// not shove the body left.

export const assets = {
  manifest: null,
  sheets: {},      // character key -> Image
  buildings: [],   // houses, in manifest order
  house: null,     // the player's house, if real art was supplied
  props: {},       // every building in the play plane, by name
  walls: [],       // flat masonry panels, used to texture cover
  cars: [],        // parked vehicles, used as cover
  caveirao: null,  // the police armoured truck
  fx: {},          // impact effects, by kind
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(base = 'assets', onProgress = () => {}) {
  const manifest = await (await fetch(`${base}/assets.json`)).json();
  assets.manifest = manifest;

  const jobs = [];
  for (const [key, ch] of Object.entries(manifest.characters)) {
    jobs.push(loadImage(`${base}/${ch.sheet}`).then((img) => { assets.sheets[key] = img; }));
  }
  manifest.buildings.forEach((b, i) => {
    jobs.push(loadImage(`${base}/${b.file}`).then((img) => { assets.buildings[i] = img; }));
  });
  (manifest.walls || []).forEach((b, i) => {
    jobs.push(loadImage(`${base}/${b.file}`).then((img) => { assets.walls[i] = img; }));
  });
  (manifest.cars || []).forEach((c, i) => {
    jobs.push(loadImage(`${base}/${c.file}`).then((img) => { assets.cars[i] = img; }));
  });
  if (manifest.caveirao) {
    jobs.push(loadImage(`${base}/${manifest.caveirao.file}`)
      .then((img) => { assets.caveirao = img; }));
  }
  // The buildings in the play plane, each with its own measurements alongside.
  for (const [name, spec] of Object.entries(manifest.props || {})) {
    jobs.push(loadImage(`${base}/${spec.file}`).then((img) => {
      assets.props[name] = img;
      if (name === 'casa') assets.house = img;
    }));
  }

  // Shared sheets: animations that arrived on their own drop rather than on a
  // character's atlas, which frames name for themselves when they are drawn.
  for (const [name, file] of Object.entries(manifest.sheets || {})) {
    jobs.push(loadImage(`${base}/${file}`).then((img) => { assets.sheets[name] = img; }));
  }

  if (manifest.civilians) {
    jobs.push(loadImage(`${base}/${manifest.civilians.sheet}`)
      .then((img) => { assets.sheets.civ = img; }));
  }
  for (const [kind, frames] of Object.entries(manifest.fx || {})) {
    assets.fx[kind] = [];
    frames.forEach((f, i) => {
      jobs.push(loadImage(`${base}/${f.file}`).then((img) => { assets.fx[kind][i] = img; }));
    });
  }

  let done = 0;
  await Promise.all(jobs.map((p) => p.then(() => onProgress(++done / jobs.length))));
  return manifest;
}

export function charSpec(key) {
  return assets.manifest.characters[key];
}

// Not every character sheet carries every animation -- the gang sheets have no
// walk-and-aim, for instance -- so each one names the pose to borrow instead.
const FALLBACK = {
  climb: 'walk',          // for anyone whose sheet has no climb of their own
  crouchWalk: 'crouch',   // ditto the crouched gait
  walkAim: 'shoot',
  shoot: 'idle',
  crouchShoot: 'crouch',
  crouch: 'idle',
  proneShoot: 'prone',
  prone: 'proneCrawl',
  proneCrawl: 'prone',
  hit: 'idle',
  death: 'idle',
  roster: 'idle',
  run: 'walk',
};

export function anim(key, name) {
  const anims = assets.manifest.characters[key].anims;
  let seen = 0;
  let want = name;
  while (want && !anims[want]?.length && seen++ < 6) want = FALLBACK[want];
  return anims[want] || anims.idle;
}

/** Frame `i` of an animation, wrapping so callers can pass a free-running counter. */
export function frameAt(key, name, i) {
  const frames = anim(key, name);
  return frames[((i % frames.length) + frames.length) % frames.length];
}

/**
 * Draw a frame with its ground anchor placed at (x, y), optionally mirrored.
 * Scale is applied about that anchor, so a sprite grows out of the floor.
 */
export function drawFrame(ctx, key, frame, x, y, facing = 1, scale = 1, alpha = 1) {
  // Most frames live on their character's own atlas; a frame may name another,
  // which is how one shared sheet -- the climb -- serves several characters.
  const sheet = assets.sheets[frame.sheet || key];
  if (!sheet) return;
  const w = frame.w * scale;
  const h = frame.h * scale;
  const ax = frame.ax * scale;

  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, -ax, -h, w, h);
  ctx.restore();
}

/** Where a sprite's box sits in world space, for hit tests and debug overlays. */
export function frameBox(frame, x, y, facing = 1, scale = 1) {
  const w = frame.w * scale;
  const ax = frame.ax * scale;
  return {
    x: facing < 0 ? x - (w - ax) : x - ax,
    y: y - frame.h * scale,
    w,
    h: frame.h * scale,
  };
}
