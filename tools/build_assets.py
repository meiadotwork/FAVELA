"""Turn the raw art drop into runtime atlases.

The drop holds one folder of sprite sheets per character plus a separate sheet
carrying that character's hit reaction and death, and a pile of cut-out
buildings. This script slices every sheet (see slicer.py), pulls the frame
ranges named in MANIFEST out of them, normalises each character to a common
standing height, and shelf-packs the result into one WebP atlas per character
with a JSON side-car the game reads at boot.

Every frame gets an anchor at the point the sprite meets the ground, taken from
the centroid of its lowest pixels rather than the centre of its box, so a
rifle poking out to the right does not drag the body sideways between frames.

Usage: python3 tools/build_assets.py <raw-drop-dir> <out-dir>
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

from slicer import slice_sheet, split_count

STAND_H = 190          # on-screen height of a standing character, in px
BUILDING_H = 520       # nominal height of a one-to-three storey house
WALL_H = 240           # height a flat masonry panel is stored at
ATLAS_W = 2048
PAD = 2
WEBP_Q = 88

# Which sliced sheet feeds which animation. Sheets are lettered in filename
# order; a (start, end) pair takes a slice of that sheet's frames, and None
# takes all of them. Ranges trim the settle poses off the ends of firing
# sequences so a burst reads as a burst.
MANIFEST = {
    'p1': {
        'name': 'Branco', 'dir': 'P1 Camisa Branca', 'weapon': 'rifle',
        'death': 'Photo Aug 13 2026, 7 15 42 PM (8).png',
        'anims': {
            'idle': ('F', None), 'walk': ('I', None), 'run': ('G', None),
            'shoot': ('K', (0, 4)), 'walkAim': ('J', None),
            'crouch': ('L', (0, 3)), 'crouchShoot': ('D', (1, 7)),
            'prone': ('H', (0, 3)), 'proneShoot': ('E', None),
            'roster': ('B', (0, 0)),
        },
    },
    'p2': {
        'name': 'Roxo', 'dir': 'P2 Calcao Roxo', 'weapon': 'rifle',
        'death': 'Photo Aug 13 2026, 7 15 42 PM (6) (1).png',
        'anims': {
            'idle': ('F', None), 'walk': ('I', None), 'run': ('J', None),
            'shoot': ('K', (0, 4)), 'walkAim': ('H', None),
            'crouch': ('L', (0, 3)), 'crouchShoot': ('B', (7, 16)),
            'prone': ('G', (0, 3)), 'proneShoot': ('E', None),
            'roster': ('C', (0, 0)),
        },
    },
    'p3': {
        'name': 'Preto', 'dir': 'P3 Calcao Preto', 'weapon': 'rifle',
        'death': 'Photo Aug 13 2026, 7 15 42 PM (10).png',
        'anims': {
            'idle': ('G', None), 'walk': ('I', None), 'run': ('K', None),
            'shoot': ('L', (0, 4)), 'walkAim': ('J', None),
            'crouch': ('M', (0, 3)), 'crouchShoot': ('E', (0, 7)),
            'prone': ('H', (0, 3)), 'proneShoot': ('F', None),
            'roster': ('C', (2, 2)),
        },
    },
    'p4': {
        'name': 'Tricolor', 'dir': 'P4 Calcao Tricolor', 'weapon': 'pistol',
        'death': 'Photo Aug 13 2026, 7 15 42 PM (8) (1).png',
        'anims': {
            'idle': ('G', None), 'walk': ('I', None), 'run': ('K', None),
            'shoot': ('L', (0, 4)), 'walkAim': ('J', None),
            'crouch': ('M', (0, 3)), 'crouchShoot': ('E', (0, 8)),
            'prone': ('H', (0, 3)), 'proneShoot': ('F', None),
            'roster': ('C', (0, 0)),
        },
    },
    'po': {
        'name': 'Policia', 'dir': 'Police', 'weapon': 'rifle',
        'death': 'Photo Aug 13 2026, 7 15 42 PM (7).png',
        'anims': {
            'idle': ('J', (0, 0)), 'walk': ('E', None), 'run': ('I', None),
            'shoot': ('J', (0, 4)), 'walkAim': ('F', None),
            'crouch': ('L', (0, 3)), 'crouchShoot': ('B', (3, 10)),
            'prone': ('H', (0, 3)), 'proneShoot': ('C', (3, 9)),
            'roster': ('K', (0, 0)),
        },
    },
}

HIT_FRAMES = 3     # the death sheets lead with a hit reaction...
DEATH_FRAMES = 6   # ...then fall over


def sheet_letter(i):
    return chr(ord('A') + i)


def slice_dir(path):
    """Slice every sheet in a folder, keyed by its letter in filename order."""
    out = {}
    for i, name in enumerate(sorted(n for n in os.listdir(path)
                                    if n.lower().endswith('.png'))):
        im, boxes = slice_sheet(os.path.join(path, name))
        out[sheet_letter(i)] = [im.crop(b) for b in boxes]
    return out


def anchor_x(im):
    """Centroid of the lowest slice of the sprite: where it touches ground."""
    a = np.asarray(im)[:, :, 3] > 32
    ys, xs = np.where(a)
    if not len(ys):
        return im.width / 2
    cut = ys.max() - max(2, int(im.height * 0.14))
    low = xs[ys >= cut]
    return float(low.mean()) if len(low) else im.width / 2


def scaled(im, factor):
    w = max(1, int(round(im.width * factor)))
    h = max(1, int(round(im.height * factor)))
    return im.resize((w, h), Image.LANCZOS)


def take(frames, rng):
    if rng is None:
        return list(frames)
    a, b = rng
    return list(frames[a:b + 1])


def load_death(path):
    """Split a hit/death sheet into its two labelled rows.

    These sheets are captioned with their own frame counts -- a hit reaction of
    three, then a death of six -- so the expected count is known, which matters
    because a falling body overlaps the pose behind it far too much for the
    generic valley cut to separate. Whichever row comes up short is re-cut into
    exactly the number of frames it says it holds.
    """
    im, boxes = slice_sheet(path)
    mask = np.asarray(im)[:, :, 3] > 32

    rows = []
    for b in sorted(boxes, key=lambda b: b[1]):
        cy = (b[1] + b[3]) / 2
        for row in rows:
            if min(r[1] for r in row) <= cy <= max(r[3] for r in row):
                row.append(b)
                break
        else:
            rows.append([b])

    out = []
    for row, want in zip(rows, (HIT_FRAMES, DEATH_FRAMES)):
        if len(row) < want:
            union = (min(r[0] for r in row), min(r[1] for r in row),
                     max(r[2] for r in row), max(r[3] for r in row))
            row = split_count(mask, union, 'x', want)
        out.append([im.crop(b) for b in sorted(row, key=lambda b: b[0])[:want]])
    while len(out) < 2:
        out.append([])
    return out[0], out[1]


def pack(frames):
    """Shelf-pack scaled frames into one atlas. Returns (image, placements)."""
    order = sorted(range(len(frames)), key=lambda i: -frames[i].height)
    shelves = []          # [y, height, cursor_x]
    place = [None] * len(frames)
    for i in order:
        f = frames[i]
        for s in shelves:
            if s[2] + f.width + PAD <= ATLAS_W and f.height <= s[1]:
                place[i] = (s[2], s[0])
                s[2] += f.width + PAD
                break
        else:
            y = shelves[-1][0] + shelves[-1][1] + PAD if shelves else 0
            shelves.append([y, f.height, f.width + PAD])
            place[i] = (0, y)
    h = (shelves[-1][0] + shelves[-1][1]) if shelves else 1
    atlas = Image.new('RGBA', (ATLAS_W, h), (0, 0, 0, 0))
    for i, (x, y) in enumerate(place):
        atlas.paste(frames[i], (x, y))
    return atlas, place


# Poses where the figure stands to full height, so the frame's own height is a
# direct measure of the character and can be normalised against exactly.
UPRIGHT = ('idle', 'walk', 'walkAim', 'shoot', 'roster', 'hit')


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


def body_mass(im):
    """Square root of the opaque area: how big this drawing of the body is.

    The sheets were generated one at a time and are not drawn to a common
    scale -- the same character stands 856px tall on one and 496px on another.
    Height alone cannot reconcile them, because a crouch is legitimately
    shorter than a stride. Area survives the change of pose far better than
    height does, so matching mass puts every sheet on one scale and leaves the
    crouch its crouch.
    """
    return float(np.sqrt((np.asarray(im)[:, :, 3] > 32).sum()))


def anim_scales(anims):
    """A scale factor per animation that brings every sheet to one character."""
    heights = {k: median([f.height for f in v]) for k, v in anims.items() if v}
    masses = {k: median([body_mass(f) for f in v]) for k, v in anims.items() if v}
    ref = 'walk' if 'walk' in heights else next(iter(heights))
    base = STAND_H / heights[ref]

    out = {}
    for name in anims:
        if name not in heights:
            out[name] = base
        elif name in UPRIGHT:
            out[name] = STAND_H / heights[name]
        else:
            out[name] = base * masses[ref] / masses[name]
    # The death sheet shares its source image with the hit reaction, so it
    # inherits that scale rather than being measured while lying down.
    if 'hit' in out:
        out['death'] = out['hit']
    return out


def build_character(key, spec, raw, out_dir):
    sheets = slice_dir(os.path.join(raw, 'Props', 'Caracter', spec['dir']))
    anims = {name: take(sheets[letter], rng)
             for name, (letter, rng) in spec['anims'].items()}

    hit, death = load_death(os.path.join(raw, 'Props', 'Caracter', spec['death']))
    anims['hit'], anims['death'] = hit, death

    scales = anim_scales(anims)

    frames, meta = [], {}
    for name, seq in anims.items():
        s = scales[name]
        entries = []
        for f in seq:
            sf = scaled(f, s)
            entries.append({'i': len(frames), 'ax': round(anchor_x(sf), 1),
                            'w': sf.width, 'h': sf.height})
            frames.append(sf)
        meta[name] = entries

    atlas, place = pack(frames)
    for name in meta:
        for e in meta[name]:
            x, y = place[e['i']]
            e['x'], e['y'] = x, y
            del e['i']

    atlas.save(os.path.join(out_dir, f'{key}.webp'), quality=WEBP_Q, method=5)
    print(f'  {key}: {len(frames)} frames, atlas {atlas.size}')
    return {'name': spec['name'], 'weapon': spec['weapon'],
            'sheet': f'{key}.webp', 'anims': meta}


def key_background(im, tol=30):
    """Knock out a flat backdrop some of the buildings were rendered against.

    Most of the drop is cut out already, but a handful arrived on solid white,
    black or grey. Those are keyed by flood-filling inwards from the border
    across pixels close to the corner colour, so a white wall in the middle of
    the house survives while the card behind it does not.
    """
    a = np.asarray(im).astype(np.int16)
    h, w = a.shape[:2]
    corners = np.array([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]])
    if (corners[:, 3] > 200).sum() < 3:
        return im

    bg = np.median(corners[:, :3], axis=0)
    similar = (np.abs(a[:, :, :3] - bg).max(axis=2) <= tol)

    lab, n = ndimage.label(similar)
    if n == 0:
        return im
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    if not border:
        return im

    out = np.asarray(im).copy()
    drop = np.isin(lab, list(border))
    # Shave one pixel off the new edge; lossy keying leaves a rim of backdrop.
    drop = ndimage.binary_dilation(drop, iterations=1)
    out[:, :, 3] = np.where(drop, 0, out[:, :, 3])
    return Image.fromarray(out, 'RGBA')


def building_score(im):
    """Prefer solid, colourful cut-outs over thin or washed-out ones."""
    a = np.asarray(im.resize((96, 96)))
    alpha = a[:, :, 3] > 32
    fill = alpha.mean()
    rgb = a[:, :, :3][alpha]
    variety = float(rgb.std()) if len(rgb) else 0.0
    return fill * 0.6 + min(variety, 90) / 90 * 0.4


def signature(im):
    """Small greyscale fingerprint, for spotting re-rolls of the same house."""
    g = np.asarray(im.convert('RGB').resize((12, 12))).astype(np.int16).mean(axis=2)
    return g - g.mean()


def build_buildings(raw, out_dir, houses_wanted, walls_wanted):
    """Sort the prop drop into houses to stand along the lane and wall panels.

    The drop mixes whole buildings with flat stretches of masonry. The flat ones
    are no use as houses but are exactly what the cover in the street should be
    made of, so they are split out by aspect and kept separately. Near-duplicate
    re-rolls of the same house are dropped by fingerprint, which the exact-hash
    pass upstream cannot catch.
    """
    src = os.path.join(raw, 'Props', 'buildings')
    houses, walls = [], []
    sigs = []
    for name in sorted(os.listdir(src)):
        if not name.lower().endswith('.png'):
            continue
        im = key_background(Image.open(os.path.join(src, name)).convert('RGBA'))
        a = np.asarray(im)[:, :, 3] > 32
        if not a.any():
            continue
        ys, xs = np.where(a)
        im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        if im.width < 200 or im.height < 160:
            continue

        sig = signature(im)
        if any(np.abs(sig - s).mean() < 6.0 for s in sigs):
            continue
        sigs.append(sig)

        entry = (building_score(im), name, im)
        (walls if im.width > im.height * 1.5 else houses).append(entry)

    os.makedirs(os.path.join(out_dir, 'buildings'), exist_ok=True)

    def emit(items, wanted, prefix, target_h):
        items.sort(key=lambda c: -c[0])
        out = []
        for i, (_, name, im) in enumerate(items[:wanted]):
            f = scaled(im, target_h / im.height)
            fn = f'buildings/{prefix}{i:02d}.webp'
            f.save(os.path.join(out_dir, fn), quality=WEBP_Q, method=5)
            out.append({'file': fn, 'w': f.width, 'h': f.height, 'src': name})
        return out

    built = emit(houses, houses_wanted, 'b', BUILDING_H)
    panels = emit(walls, walls_wanted, 'w', WALL_H)
    print(f'  buildings: {len(built)} houses of {len(houses)}, '
          f'{len(panels)} wall panels of {len(walls)}')
    return built, panels


def main(raw, out_dir, houses=32, walls=10):
    os.makedirs(out_dir, exist_ok=True)
    manifest = {'standHeight': STAND_H, 'characters': {}}
    for key, spec in MANIFEST.items():
        manifest['characters'][key] = build_character(key, spec, raw, out_dir)
    manifest['buildings'], manifest['walls'] = build_buildings(raw, out_dir, houses, walls)
    with open(os.path.join(out_dir, 'assets.json'), 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print('wrote', os.path.join(out_dir, 'assets.json'))


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main(sys.argv[1], sys.argv[2], *[int(a) for a in sys.argv[3:5]])
