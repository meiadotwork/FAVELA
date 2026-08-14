"""Slice AI-generated sprite sheets into individual frames.

Source sheets are transparent PNGs holding a loose grid of poses, and the grid
is irregular: 5x2 here, a single stacked column there. Rather than assume a
shape, the sheet is cut recursively along whichever axis shows a seam, in the
manner of the XY-cut used for document layout.

Seams are found by density rather than by blank space, because the poses
overlap: a rifle barrel routinely reaches into the neighbouring frame, so there
is no empty gutter to cut at. What separates two poses is a run of columns thin
enough to be only a barrel crossing, against the solid mass of a body -- so the
cut goes through the valleys of the projection profile.

Debris the generator scattered around a pose (ejected casings, smoke puffs, a
detached muzzle flash) lands in its own undersized cell and is folded back into
the nearest real frame rather than dropped, keeping flashes on their rifle.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ALPHA_CUT = 32
VALLEY = 0.18      # share of the profile peak below which a run reads as a seam
MIN_GAP = 10       # a seam must be at least this many px wide
MIN_SIDE = 44      # a real pose is at least this wide and tall
ABSORB = 110       # cells under this on either axis are debris, not a pose
MAX_DEPTH = 14


def seams(profile):
    """Midpoints of the valleys in a projection profile."""
    nz = profile[profile > 0]
    if not len(nz):
        return []
    thresh = max(2.0, float(np.percentile(nz, 85)) * VALLEY)
    cuts = []
    start = None
    for i, v in enumerate(profile):
        if v <= thresh and start is None:
            start = i
        elif v > thresh and start is not None:
            if i - start >= MIN_GAP and start > 0:
                cuts.append((start + i) // 2)
            start = None
    return cuts


def split(mask, box, axis):
    """Cut a box along `axis` at every seam. Returns [] if there is none."""
    x0, y0, x1, y1 = box
    sub = mask[y0:y1, x0:x1]
    cuts = seams(sub.sum(axis=1 if axis == 'y' else 0))
    if not cuts:
        return []
    edges = [0] + cuts + [sub.shape[0 if axis == 'y' else 1]]
    spans = [(a, b) for a, b in zip(edges, edges[1:]) if b > a]
    if len(spans) < 2:
        return []
    if axis == 'y':
        return [(x0, y0 + a, x1, y0 + b) for a, b in spans]
    return [(x0 + a, y0, x0 + b, y1) for a, b in spans]


def trim(mask, box):
    x0, y0, x1, y1 = box
    sub = mask[y0:y1, x0:x1]
    if not sub.any():
        return None
    ys, xs = np.where(sub)
    return (x0 + int(xs.min()), y0 + int(ys.min()),
            x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1)


def xy_cut(mask, box, depth=0):
    if box is None:
        return []
    if depth > MAX_DEPTH:
        return [box]
    for axis in ('y', 'x'):
        pieces = split(mask, box, axis)
        if pieces:
            out = []
            for p in pieces:
                out.extend(xy_cut(mask, trim(mask, p), depth + 1))
            return out
    return [box]


def split_count(mask, box, axis, n):
    """Cut a box into exactly `n` pieces at its `n - 1` shallowest points.

    The fallback for poses that overlap too heavily to leave a valley worth the
    name -- a body mid-fall reaching across the frame behind it. Cuts are taken
    greedily from the thinnest columns outwards, keeping them spread apart so
    the result stays close to the even spacing these sheets are drawn on.
    """
    x0, y0, x1, y1 = box
    sub = mask[y0:y1, x0:x1]
    prof = sub.sum(axis=1 if axis == 'y' else 0).astype(float)
    length = len(prof)
    if n < 2 or length < n * 2:
        return [box]
    apart = length / (n * 1.7)
    cuts = []
    for i in np.argsort(prof):
        i = int(i)
        if i < apart or i > length - apart:
            continue
        if all(abs(i - c) >= apart for c in cuts):
            cuts.append(i)
            if len(cuts) == n - 1:
                break
    edges = [0] + sorted(cuts) + [length]
    spans = [(a, b) for a, b in zip(edges, edges[1:]) if b > a]
    if axis == 'y':
        return [t for t in (trim(mask, (x0, y0 + a, x1, y0 + b)) for a, b in spans) if t]
    return [t for t in (trim(mask, (x0 + a, y0, x0 + b, y1)) for a, b in spans) if t]


# A cell this far from human proportions is holding more than one pose.
LIMB_RATIO = {'y': 3.6, 'x': 7.0}


def resplit_oversized(mask, cells):
    """Force a cut through cells that hold more than one pose.

    Two poses stacked with no daylight between them survive the first pass as a
    single cell. Two things give them away: being far larger than the sheet's
    median cell, or being too elongated for a human to fit -- which catches the
    sheets where *every* cell is a merged pair and the median is no help. Either
    way they are re-cut with a threshold slack enough to find the shallow valley
    where one pose ends and the next begins.
    """
    global VALLEY
    for axis, lo, hi in (('y', 1, 3), ('x', 0, 2)):
        other = 2 if axis == 'y' else 3
        for _ in range(2):
            sizes = sorted(c[hi] - c[lo] for c in cells)
            if not sizes:
                return cells
            med = sizes[len(sizes) // 2]
            out, changed = [], False
            for c in cells:
                span = c[hi] - c[lo]
                cross = c[other] - c[other - 2]
                if span > med * 1.7 or span > cross * LIMB_RATIO[axis]:
                    saved, VALLEY = VALLEY, 0.40
                    pieces = split(mask, c, axis)
                    VALLEY = saved
                    pieces = [p for p in (trim(mask, p) for p in pieces) if p]
                    if len(pieces) < 2 and span > cross * LIMB_RATIO[axis]:
                        pieces = split_count(mask, c, axis, max(2, round(span / cross / 1.8)))
                    if len(pieces) >= 2 and all(p[hi] - p[lo] >= med * 0.4 for p in pieces):
                        out.extend(pieces)
                        changed = True
                        continue
                out.append(c)
            cells = out
            if not changed:
                break
    return cells


def absorb_debris(cells):
    """Fold undersized cells into the nearest keeper by box distance.

    Cells that are wide, flat strips are captions the generator stamped onto the
    sheet ("SHEET 2 - DEATH (6 FRAMES)"), not stray casings, so they are dropped
    rather than glued onto whichever pose happened to be closest. A caption has
    to be thin as well as wide to qualify: a prone body behind an outstretched
    rifle is every bit as wide, and is a pose worth keeping.
    """
    cells = [c for c in cells
             if (c[2] - c[0]) < (c[3] - c[1]) * 4 or (c[3] - c[1]) >= ABSORB]
    keep = [c for c in cells if (c[2] - c[0]) >= ABSORB and (c[3] - c[1]) >= ABSORB]
    if not keep:
        return []
    small = [c for c in cells if c not in keep]
    keep = [list(c) for c in keep]

    def dist(a, b):
        dx = max(0, a[0] - b[2], b[0] - a[2])
        dy = max(0, a[1] - b[3], b[1] - a[3])
        return dx * dx + dy * dy

    for s in small:
        t = min(keep, key=lambda k: dist(s, k))
        t[0], t[1] = min(t[0], s[0]), min(t[1], s[1])
        t[2], t[3] = max(t[2], s[2]), max(t[3], s[3])
    return [tuple(k) for k in keep]


def reading_order(boxes):
    """Group into rows by vertical overlap, then left-to-right inside each row."""
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
    for row in rows:
        out.extend(sorted(row, key=lambda b: b[0]))
    return out


def slice_sheet(path):
    im = Image.open(path).convert('RGBA')
    mask = np.asarray(im)[:, :, 3] > ALPHA_CUT
    root = trim(mask, (0, 0, im.width, im.height))
    if root is None:
        return im, []
    cells = resplit_oversized(mask, xy_cut(mask, root))
    boxes = [b for b in absorb_debris(cells)
             if (b[2] - b[0]) >= MIN_SIDE and (b[3] - b[1]) >= MIN_SIDE]
    return im, reading_order(boxes)


def main(src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    index = {}
    for name in sorted(os.listdir(src_dir)):
        if not name.lower().endswith('.png'):
            continue
        im, boxes = slice_sheet(os.path.join(src_dir, name))
        stem = os.path.splitext(name)[0]
        frames = []
        for i, b in enumerate(boxes):
            crop = im.crop(b)
            fn = f'{stem}__{i:02d}.png'
            crop.save(os.path.join(out_dir, fn))
            frames.append({'file': fn, 'w': crop.width, 'h': crop.height, 'box': list(b)})
        index[name] = frames
        print(f'{len(boxes):3d} frames  {name}')
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
