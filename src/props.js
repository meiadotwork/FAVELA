// The house, painted.
//
// It is drawn rather than loaded because the reference for it arrived as a
// picture in a conversation, not as a file in the repository -- so it is built
// here from the same measurements the simulation uses. The door is 2 m and the
// man beside it is 1.70 m, and every other feature is stepped off that: brick
// courses, the window, the cobogo vent, the roof slab and the water tank on
// top of it.
//
// If the real artwork is ever dropped into assets/, the renderer prefers it and
// none of this runs.

import { rng } from './world.js';

/** Painted at 200 px to the metre, then scaled to whatever the camera wants. */
export const HOUSE_PX = 200;

const BRICK = ['#c2451f', '#b53d1b', '#cb4f26', '#a83718'];
const PLASTER = ['#bdb6a4', '#c7c0ae', '#b2ab99'];
const CONCRETE = '#b7b1a2';

/** An irregular blob of fallen plaster, in metres, drawn as a jagged polygon. */
function patch(g, S, cx, cy, rx, ry, rand, fill) {
  g.beginPath();
  const n = 10 + ((rand() * 5) | 0);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.62 + rand() * 0.55;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) g.moveTo(x * S, y * S);
    else g.lineTo(x * S, y * S);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function brickwork(g, S, w, h, rand) {
  const bw = 0.26;
  const bh = 0.095;
  g.fillStyle = '#8d8a7e';                    // mortar behind the courses
  g.fillRect(0, 0, w * S, h * S);
  for (let row = 0, y = h; y > -bh; row++, y -= bh) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -off; x < w; x += bw) {
      g.fillStyle = BRICK[(rand() * BRICK.length) | 0];
      g.fillRect(
        Math.round((x + 0.012) * S), Math.round((h - y) * S),
        Math.round((bw - 0.024) * S), Math.round((bh - 0.014) * S),
      );
    }
  }
}

/** Louvred shutters: two leaves of horizontal slats in a painted frame. */
function window_(g, S, x, y, w, h) {
  g.fillStyle = CONCRETE;
  g.fillRect((x - 0.09) * S, (y - 0.09) * S, (w + 0.18) * S, (h + 0.18) * S);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect((x - 0.09) * S, (y + h + 0.02) * S, (w + 0.18) * S, 0.03 * S);

  g.fillStyle = '#2b2b2e';
  g.fillRect(x * S, y * S, w * S, h * S);
  for (const leaf of [0, 1]) {
    const lx = x + 0.03 + leaf * (w / 2);
    const lw = w / 2 - 0.06;
    g.fillStyle = '#d6d2c6';
    g.fillRect(lx * S, (y + 0.03) * S, lw * S, (h - 0.06) * S);
    for (let sy = y + 0.08; sy < y + h - 0.06; sy += 0.075) {
      g.fillStyle = 'rgba(40,38,34,0.75)';
      g.fillRect((lx + 0.02) * S, sy * S, (lw - 0.04) * S, 0.022 * S);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect((lx + 0.02) * S, (sy + 0.022) * S, (lw - 0.04) * S, 0.012 * S);
    }
  }
  // Sill, and the dirt that runs off it.
  g.fillStyle = '#c9c3b4';
  g.fillRect((x - 0.14) * S, (y + h + 0.05) * S, (w + 0.28) * S, 0.09 * S);
}

/** The doorway: a concrete frame around a hole with nothing lit behind it. */
function door(g, S, x, ground, w, h) {
  g.fillStyle = CONCRETE;
  g.fillRect((x - 0.11) * S, (ground - h - 0.13) * S, (w + 0.22) * S, (h + 0.13) * S);
  g.fillStyle = '#8f897b';
  g.fillRect((x - 0.11) * S, (ground - h - 0.13) * S, (w + 0.22) * S, 0.02 * S);

  const grad = g.createLinearGradient(0, (ground - h) * S, 0, ground * S);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(1, '#141216');
  g.fillStyle = grad;
  g.fillRect(x * S, (ground - h) * S, w * S, h * S);

  // The step out onto the lane.
  g.fillStyle = '#c4beaf';
  g.fillRect((x - 0.22) * S, (ground - 0.09) * S, (w + 0.44) * S, 0.09 * S);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect((x - 0.22) * S, (ground - 0.02) * S, (w + 0.44) * S, 0.02 * S);
}

/** Cobogo blocks: the pierced ventilation squares, two by two. */
function cobogo(g, S, x, y, size) {
  g.fillStyle = '#9c3d1c';
  g.fillRect((x - 0.03) * S, (y - 0.03) * S, (size * 2 + 0.06) * S, (size * 2 + 0.06) * S);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const bx = x + i * size;
      const by = y + j * size;
      g.fillStyle = '#c1481f';
      g.fillRect(bx * S, by * S, (size - 0.012) * S, (size - 0.012) * S);
      g.fillStyle = '#0d0c0e';
      g.save();
      g.translate((bx + size / 2) * S, (by + size / 2) * S);
      g.rotate(Math.PI / 4);
      const d = size * 0.42 * S;
      g.fillRect(-d / 2, -d / 2, d, d);
      g.restore();
    }
  }
}

/**
 * The blue water tank: stacked rings that step inward as they rise, each one
 * rounded off at the top, which is the shape that makes it read as a caixa
 * d'agua rather than a blue box.
 */
function tank(g, S, cx, base, d, h) {
  const rings = 3;
  for (let i = 0; i < rings; i++) {
    const ringH = h / (rings + 0.6);
    const y = base - (i + 1) * ringH;
    const rw = d * (1 - i * 0.09);
    const x = cx - rw / 2;
    g.fillStyle = i % 2 ? '#2a6fb8' : '#24619f';
    g.beginPath();
    g.ellipse(cx * S, y * S, (rw / 2) * S, (ringH * 0.34) * S, 0, Math.PI, 0);
    g.fill();
    g.fillRect(x * S, y * S, rw * S, ringH * S);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect((x + rw * 0.08) * S, (y + ringH * 0.15) * S, rw * 0.18 * S, ringH * 0.7 * S);
    g.fillStyle = 'rgba(10,30,55,0.35)';
    g.fillRect(x * S, (y + ringH * 0.86) * S, rw * S, ringH * 0.14 * S);
  }
  const lidW = d * 0.62;
  g.fillStyle = '#3585d4';
  g.beginPath();
  g.ellipse(cx * S, (base - h) * S, (lidW / 2) * S, (h * 0.1) * S, 0, 0, 6.283);
  g.fill();
  // Grime where it has stood in the sun for a decade.
  g.fillStyle = 'rgba(70,80,40,0.25)';
  g.fillRect((cx - d / 2) * S, (base - h * 0.34) * S, d * S, h * 0.1 * S);
}

/**
 * Paint the whole house onto an offscreen canvas, ground line at the bottom.
 * Returns the canvas and how many metres tall it is, tank included.
 */
export function paintHouse(spec) {
  const S = HOUSE_PX;
  const w = spec.w;
  const bodyH = spec.h;
  const total = bodyH + spec.tank + 0.25;
  const c = document.createElement('canvas');
  c.width = Math.round(w * S);
  c.height = Math.round(total * S);
  const g = c.getContext('2d');
  const rand = rng(0xb0a1);

  // The wall is brick, then plaster over most of it, then plaster missing
  // again in patches -- which is why the brick shows through in the reference.
  g.save();
  g.translate(0, (total - bodyH) * S);
  brickwork(g, S, w, bodyH, rand);

  g.save();
  g.beginPath();
  g.rect(0, 0, w * S, bodyH * S);
  g.clip();
  // Render that is still on: a few big fields of it rather than a wash, so the
  // brick stays the loudest thing on the wall the way it is in the reference.
  const fields = [
    [0.05, bodyH * 0.5, 0.72, bodyH * 0.62],
    [w * 0.44, bodyH * 0.72, 1.15, bodyH * 0.42],
    [w - 0.2, bodyH * 0.55, 0.8, bodyH * 0.6],
  ];
  for (const [cx, cy, rx, ry] of fields) {
    patch(g, S, cx, cy, rx, ry, rand, PLASTER[(rand() * PLASTER.length) | 0]);
    // A hard shadow along the broken edge, where the render has come away.
    g.save();
    g.globalAlpha = 0.35;
    patch(g, S, cx + 0.04, cy + 0.05, rx * 0.99, ry * 0.99, rand, '#5c5548');
    g.restore();
    patch(g, S, cx, cy, rx * 0.95, ry * 0.95, rand, PLASTER[(rand() * PLASTER.length) | 0]);
  }
  g.restore();

  // Cracks.
  g.strokeStyle = 'rgba(60,54,46,0.55)';
  for (let i = 0; i < 9; i++) {
    g.lineWidth = (0.6 + rand()) * (S / 200);
    g.beginPath();
    let x = rand() * w;
    let y = rand() * bodyH;
    g.moveTo(x * S, (bodyH - y) * S);
    for (let k = 0; k < 5; k++) {
      x += (rand() - 0.5) * 0.5;
      y += (rand() - 0.4) * 0.5;
      g.lineTo(x * S, (bodyH - y) * S);
    }
    g.stroke();
  }

  const ground = bodyH;
  window_(g, S, w * 0.13, bodyH - 1.85, 1.05, 0.95);
  door(g, S, w * 0.455, ground, 0.95, spec.door);
  cobogo(g, S, w * 0.72, bodyH - 1.75, 0.21);

  // Algae bleeding down from the roof line, and weeds at the footing.
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const len = 0.12 + rand() * 0.5;
    g.fillStyle = `rgba(86,102,58,${0.18 + rand() * 0.3})`;
    g.fillRect(x * S, 0, (0.02 + rand() * 0.05) * S, len * S);
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * w;
    const hgt = 0.06 + rand() * 0.16;
    g.strokeStyle = rand() < 0.5 ? '#4e6b2c' : '#6d8f3c';
    g.lineWidth = 1.4 * (S / 200);
    g.beginPath();
    g.moveTo(x * S, ground * S);
    g.lineTo((x + (rand() - 0.5) * 0.1) * S, (ground - hgt) * S);
    g.stroke();
  }
  g.restore();

  // The roof slab, overhanging, with its shadow on the wall beneath.
  const slabH = 0.34;
  const slabY = (total - bodyH) * S;
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(0, slabY + slabH * S, w * S, 0.07 * S);
  g.fillStyle = '#a29b8c';
  g.fillRect(-0.07 * S, slabY, (w + 0.14) * S, slabH * S);
  g.fillStyle = '#cfc9ba';
  g.fillRect(-0.07 * S, slabY, (w + 0.14) * S, 0.08 * S);
  g.fillStyle = 'rgba(50,45,38,0.55)';
  g.fillRect(-0.07 * S, slabY + slabH * S - 0.045 * S, (w + 0.14) * S, 0.045 * S);
  // The joint lines cast into the concrete.
  g.fillStyle = 'rgba(60,54,46,0.4)';
  for (let i = 1; i < 4; i++) g.fillRect((w * i / 4) * S, slabY, 0.02 * S, slabH * S);

  // On the roof: two vent pipes and the tank.
  const roof = total - bodyH;
  for (const [px, ph, pw] of [[w * 0.55, 0.55, 0.14], [w * 0.62, 0.32, 0.08]]) {
    g.fillStyle = '#9a9384';
    g.fillRect(px * S, (roof - ph) * S, pw * S, ph * S);
    g.fillStyle = '#b4ad9d';
    g.fillRect((px - 0.03) * S, (roof - ph) * S, (pw + 0.06) * S, 0.06 * S);
  }
  tank(g, S, w * 0.79, roof, 0.92, spec.tank);

  // Sit it into the light the rest of the scene is lit by: a warm shade over
  // the whole thing, heaviest at the foot where the lane is already in shadow.
  const dusk = g.createLinearGradient(0, (total - bodyH) * S, 0, total * S);
  dusk.addColorStop(0, 'rgba(52,36,44,0.16)');
  dusk.addColorStop(0.55, 'rgba(40,28,32,0.24)');
  dusk.addColorStop(1, 'rgba(24,16,18,0.44)');
  g.fillStyle = dusk;
  g.fillRect(0, 0, w * S, total * S);

  // The silhouette: a dark line down both walls and along the foot, which is
  // what separates a building from the hill of buildings behind it.
  g.strokeStyle = 'rgba(20,14,12,0.55)';
  g.lineWidth = 3 * (S / 200);
  g.beginPath();
  g.moveTo(1, (total - bodyH) * S);
  g.lineTo(1, total * S);
  g.lineTo(w * S - 1, total * S);
  g.lineTo(w * S - 1, (total - bodyH) * S);
  g.stroke();

  return { canvas: c, metres: total, bodyH };
}
