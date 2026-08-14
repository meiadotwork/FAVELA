"""Cut the stage props the mechanics test stands on: ground, stairs, houses.

The first art drop was mined for characters, tall houses and vehicles; this
takes the three folders it left behind -- Ground, Stairs and the single-storey
open-door houses -- and turns them into the pieces a side-on level is actually
made of:

  ground  a cross-section strip, drawn with its top edge on the ground line
          and tiled along the lane.
  stairs  a flight, stored with the profile of its own steps, so a body walks
          up the pixels that were drawn rather than up an invented ramp.
  layer1  one-storey houses that stand in the same layer as the player: a roof
          to climb onto, a doorway to stand in, corners to shoot around.

Everything is scaled off the same metre as the rest of the art (a character is
1.78 m at 190 px), so a house is a house-sized house next to a man.

Usage: python3 tools/build_stage_assets.py <raw-drop-dir> <out-dir>

Writes the three keys into the existing assets.json and leaves the rest of the
manifest -- characters, tall buildings, vehicles, fx -- untouched.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

from build_assets import PX_PER_M, WEBP_Q, key_background, scaled, trim_alpha

# Real-world sizes. A one-storey barraco is a room with a parapet on top; the
# water tank above that is not part of the roof you walk on.
HOUSE_M = 3.15         # ground to the roof slab
STAIR_M = 3.15         # a flight climbs exactly one storey
GROUND_H = 280         # on-screen depth of the ground cross-section, in px

# Which files to take, read off the drop by eye. The folders also hold
# multi-sprite contact sheets and two-storey houses, which are no use here.
GROUNDS = [
    ('concreto', 'Photo Aug 13 2026, 7 17 59 PM.png'),
    ('terra', 'Photo Aug 13 2026, 7 17 59 PM (6).png'),
    ('pedra', 'Photo Aug 13 2026, 7 17 59 PM (9).png'),
    ('asfalto', 'Photo Aug 13 2026, 7 17 59 PM (1).png'),
]

STAIRS = [
    'Photo Aug 13 2026, 7 17 59 PM (36).png',
    'Photo Aug 13 2026, 7 17 59 PM (37).png',
    'Photo Aug 13 2026, 7 17 59 PM (38).png',
    'Photo Aug 13 2026, 7 17 59 PM (43).png',
]

HOUSES = [
    ('Amarela', 'Photo Aug 13 2026, 7 18 00 PM (10).png'),
    ('Laranja', 'Photo Aug 13 2026, 7 18 00 PM (14).png'),
    ('Reboco', 'Photo Aug 13 2026, 7 18 00 PM (15).png'),
    ('Comprida', 'Photo Aug 13 2026, 9 50 48 AM.png'),
    ('Madeira', 'Photo Aug 13 2026, 9 50 45 AM.png'),
    ('Telhado', 'Photo Aug 13 2026, 7 18 00 PM (9).png'),
]

STAIR_SAMPLES = 96     # columns the step profile is stored at
SOLID = 24             # px of stacked pixels that make a step, not a handrail
POST_W = 5             # samples: wider than a rail post, narrower than a tread


def opaque(im, cut=32):
    return np.asarray(im.convert('RGBA'))[:, :, 3] > cut


# --------------------------------------------------------------- ground


def build_ground(raw, out_dir):
    """The ground strip. Stored as-is; the lane tiles it, mirroring alternates."""
    src = os.path.join(raw, 'Props', 'Ground')
    os.makedirs(os.path.join(out_dir, 'ground'), exist_ok=True)
    out = []
    for i, (name, fn) in enumerate(GROUNDS):
        path = os.path.join(src, fn)
        if not os.path.exists(path):
            print(f'  ground: missing {fn}')
            continue
        im = Image.open(path).convert('RGB')
        im = trim_flat_margins(im)
        f = im.resize((max(1, round(im.width * GROUND_H / im.height)), GROUND_H),
                      Image.LANCZOS)
        rel = f'ground/g{i}.webp'
        f.save(os.path.join(out_dir, rel), quality=WEBP_Q, method=5)
        out.append({'file': rel, 'w': f.width, 'h': f.height, 'name': name})
    print(f'  ground: {len(out)} strips')
    return out


def trim_flat_margins(im, tol=6):
    """Drop the blank bands a couple of the ground renders arrived padded with."""
    a = np.asarray(im).astype(np.int16)
    flat = (a.max(axis=(1, 2)) - a.min(axis=(1, 2)) < tol)
    keep = np.where(~flat)[0]
    if not len(keep):
        return im
    return im.crop((0, int(keep[0]), im.width, int(keep[-1]) + 1))


# --------------------------------------------------------------- stairs


def step_profile(mask, samples=STAIR_SAMPLES):
    """Height of the walkable surface across a flight, as a fraction of its box.

    The topmost pixel of a column is no good: the handrail floats a metre above
    the steps and would have a body walking on air. What is wanted is the top of
    the solid mass, so each column is scanned downward for the first run of
    `SOLID` stacked pixels -- thick enough to be a tread and the wall under it,
    too thick to be a rail or one of its posts.
    """
    h, w = mask.shape
    prof = []
    for s in range(samples):
        x0 = int(s * w / samples)
        x1 = max(x0 + 1, int((s + 1) * w / samples))
        col = mask[:, x0:x1].mean(axis=1) > 0.4
        run = 0
        top = None
        for y, v in enumerate(col):
            run = run + 1 if v else 0
            if run >= SOLID:
                top = y - SOLID + 1
                break
        prof.append(None if top is None else 1 - top / h)

    # Columns that hold nothing solid (the open air above the low end of the
    # flight) inherit their neighbour, so the profile stays a single surface.
    last = 0.0
    for i, v in enumerate(prof):
        if v is None:
            prof[i] = last
        else:
            last = prof[i]

    # The handrail posts are as solid as a step and stand a metre above one, so
    # each puts a spike in the profile. They are narrow, though, and a tread is
    # not, so an opening -- shrink, then grow back -- takes the posts off and
    # leaves the staircase.
    return [round(v, 4) for v in open1d(prof, POST_W)]


def open1d(values, width):
    """1D morphological opening: erase upward spikes narrower than `width`."""
    n = len(values)
    half = width // 2
    eroded = [min(values[max(0, i - half):min(n, i + half + 1)]) for i in range(n)]
    return [max(eroded[max(0, i - half):min(n, i + half + 1)]) for i in range(n)]


def build_stairs(raw, out_dir):
    src = os.path.join(raw, 'Props', 'Stairs')
    os.makedirs(os.path.join(out_dir, 'props'), exist_ok=True)
    out = []
    for i, fn in enumerate(STAIRS):
        path = os.path.join(src, fn)
        if not os.path.exists(path):
            print(f'  stairs: missing {fn}')
            continue
        im = trim_alpha(key_background(Image.open(path).convert('RGBA')))
        if im is None:
            continue

        # Scale by the top tread, not by the sprite: the handrail carries on
        # above the last step, and a flight scaled by its bounding box lands a
        # metre short of the roof it is supposed to reach. Where the treads are
        # is read at roughly the final size, since what separates a step from a
        # rail is a thickness in pixels.
        rough = scaled(im, STAIR_M * PX_PER_M / im.height)
        top = max(step_profile(opaque(rough)))
        f = scaled(im, STAIR_M * PX_PER_M / (im.height * max(0.2, top)))
        rel = f'props/stair{i}.webp'
        f.save(os.path.join(out_dir, rel), quality=WEBP_Q, method=5)
        prof = step_profile(opaque(f))
        # Which way the flight climbs, so the lane can mirror one that runs the
        # wrong way instead of only ever placing stairs on the left.
        rise = 1 if prof[-1] > prof[0] else -1
        out.append({'file': rel, 'w': f.width, 'h': f.height,
                    'surface': prof, 'rise': rise})
    print(f'  stairs: {len(out)} flights')
    return out


# ---------------------------------------------------------------- houses


def roof_line(mask):
    """Row where the roof slab starts: the first one the house is wide across.

    Scanned from the top, so the water tank, the aerial and the chimney -- all
    narrow -- are passed over and the flat slab under them is what comes back.
    """
    w = mask.shape[1]
    widths = mask.sum(axis=1)
    for y, v in enumerate(widths):
        if v > w * 0.72:
            return y
    return int(np.argmax(widths))


def doorway(im, roof_y):
    """The open door, as a column range: the dark gap in the middle of a wall.

    An open door is drawn as near-black through most of the wall's height, and
    nothing else on these facades is: the windows are shuttered or glazed and
    sit high, so a column is only a door if it stays dark all the way down to
    the doorstep.
    """
    a = np.asarray(im.convert('RGBA'))
    lum = a[:, :, :3].mean(axis=2)
    solid = a[:, :, 3] > 32
    h, w = lum.shape
    band = slice(int(roof_y + (h - roof_y) * 0.34), int(h * 0.9))
    dark = ((lum < 62) & solid)[band]
    share = dark.mean(axis=0)

    runs, start = [], None
    for x in range(w):
        if share[x] > 0.72 and start is None:
            start = x
        elif share[x] <= 0.72 and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, w))
    return [[int(a), int(b)] for a, b in runs if w * 0.04 <= b - a <= w * 0.26]


def build_houses(raw, out_dir):
    """One-storey houses, with the roof and the door measured off the sprite."""
    src = os.path.join(raw, 'Props', 'Open door houses')
    os.makedirs(os.path.join(out_dir, 'buildings'), exist_ok=True)
    out = []
    for i, (name, fn) in enumerate(HOUSES):
        path = os.path.join(src, fn)
        if not os.path.exists(path):
            print(f'  layer1: missing {fn}')
            continue
        im = trim_alpha(key_background(Image.open(path).convert('RGBA')))
        if im is None:
            continue

        # Scale so the roof slab -- not the water tank on top of it -- lands one
        # storey above the ground.
        mask = opaque(im)
        roof = roof_line(mask)
        factor = HOUSE_M * PX_PER_M / max(1, im.height - roof)
        f = scaled(im, factor)
        rel = f'buildings/h{i}.webp'
        f.save(os.path.join(out_dir, rel), quality=WEBP_Q, method=5)

        fm = opaque(f)
        ry = roof_line(fm)
        doors = doorway(f, ry)
        x0, x1 = wall_span(fm, ry)
        entry = {'file': rel, 'w': f.width, 'h': f.height, 'name': name,
                 'roof': int(ry), 'wall': [x0, x1], 'doors': doors}
        out.append(entry)
        print(f'    {name}: {f.width}x{f.height} roof y={ry} '
              f'wall={x0}..{x1} doors={doors}')
    print(f'  layer1: {len(out)} houses')
    return out


def wall_span(mask, roof_y):
    """Left and right edge of the building proper, below the roof overhang."""
    band = mask[int(roof_y + (mask.shape[0] - roof_y) * 0.5):]
    cols = np.where(band.sum(axis=0) > band.shape[0] * 0.25)[0]
    if not len(cols):
        return 0, mask.shape[1]
    return int(cols[0]), int(cols[-1]) + 1


# ------------------------------------------------------------------ main


def main(raw, out_dir):
    path = os.path.join(out_dir, 'assets.json')
    with open(path) as f:
        manifest = json.load(f)

    manifest['ground'] = build_ground(raw, out_dir)
    manifest['stairs'] = build_stairs(raw, out_dir)
    manifest['layer1'] = build_houses(raw, out_dir)

    with open(path, 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print('updated', path)


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main(sys.argv[1], sys.argv[2])
