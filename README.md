# FAVELA

A 2D cover shooter in HTML5. You pick one of four characters and hold the alley
against rival crews and police raids across six levels, each at a different time
of day and in different weather. The rival crews field a hooded pistoleiro and a
shotgun carrier; the police come in behind an armoured caveirão.

No build step, no dependencies — open it over a local server and it runs.

```
python3 -m http.server 8080
# then open http://localhost:8080
```

A server is required (not `file://`): the game is ES modules and fetches its
asset manifest.

## Controls

| | |
|---|---|
| Arrows / WASD | Move |
| Shift | Run |
| ↓ | Crouch, then go prone |
| ↑ | Stand back up — or climb, at a ladder |
| Space | Fire (aim is automatic) |
| C | Cycle stance |
| P | Pause · M Mute |

On touch, the left half of the screen is a virtual stick, the right half fires,
and the corner buttons are run and stance.

## How the fight works

The mechanics come from `game mechanics.txt` in the art drop.

**Stance is the whole game.** Standing walks and runs, crouching only creeps,
prone barely moves at all. Stance sets two numbers — how tall your body is and
how high your muzzle sits — and cover is a box with a top edge. A bullet is
stopped when it crosses a box below that edge. Everything follows from those
three numbers:

- Crouch behind a low wall and incoming fire hits the wall — but so does yours.
- Stand up and your muzzle clears the wall, and so does the enemy's line to you.
- Cars are bulletproof to the sill and glass above it, so a standing shot passes
  through the windows while a crouched one hits the body.
- A house corner juts into the lane at full height: you step past it to shoot and
  step back behind it to be safe.
- The caveirão is armoured throughout, with no glass band. Nothing goes through it.

Weapons differ in how they answer that geometry. The rifle is a steady stream,
the pistol hits harder per shot, and the shotgun throws six pellets that spread
wide and fall short — murderous across a doorway, close to useless down the
length of the alley.

**Aim is automatic**, as specified. The shot is steered onto the nearest target
ahead of you, so the decisions are where to stand and when to stand up, not
where to point. Enemies get a detuned version of the same aim — they miss, fire
in bursts, and hit for half — because perfect tracking in their hands is not a
fight, it is a formality.

**Police levels open with the code**: three firework pops over the hill, the
lookouts' signal that the police are coming up, then the sirens. A caveirao is
parked in the alley on those levels — armoured throughout, the one piece of
cover nothing shoots through.

**The street is inhabited.** Residents walk the lane on their own business and
run for it when a shot goes off nearby, heads down, dropping whatever they were
carrying. They cannot be shot — bullets pass through them — so the street
emptying is atmosphere and a warning, never a target.

Roughly every third house is climbable — a ladder at one end, a roof to fight
down from.

## Layout

```
index.html, style.css
src/
  game.js      screens, waves, the main loop
  civilians.js residents of the lane, and what makes them run
  level.js     level layout, cover boxes, the bullet-blocking rule
  actors.js    stances, shooting, enemy AI
  render.js    parallax favela, cover, weather, HUD
  assets.js    atlas loading and anchored sprite drawing
  audio.js     synthesised gunfire, fireworks, sirens
  input.js     keyboard and touch, flattened to named actions
tools/
  slicer.py         cuts the raw sprite sheets into frames
  build_assets.py   builds the runtime atlases and manifest
assets/        generated — atlases, buildings, assets.json
```

## Rebuilding the art

`assets/` is generated from the raw drop (sprite sheets and cut-out buildings)
and is committed, so the game runs without the toolchain. To rebuild:

```
pip install pillow numpy scipy
python3 tools/build_assets.py /path/to/raw-drop assets
```

Five things in there are worth knowing about, because the raw art fought back:

**The sheets have no grid.** Each is a loose arrangement of poses — 5×2 here, a
single stacked column there — and the poses overlap, a rifle barrel routinely
reaching into the frame beside it. So there is no empty gutter to cut at.
`slicer.py` cuts recursively at whichever axis shows a seam, and finds seams by
density rather than by blank space: the valleys of the projection profile, where
only a barrel crosses, against the solid mass of a body. Poses that overlap too
heavily even for that — a body mid-fall — are cut into the number of frames the
sheet's own caption says it holds.

**The sheets are not drawn to a common scale.** The same character stands 856px
tall on one sheet and 496px on another. Height cannot reconcile them, because a
crouch is legitimately shorter than a stride. Matching the square root of opaque
area does: it survives the change of pose, so every sheet lands on one scale and
the crouch keeps its crouch.

**Props are sized from real dimensions.** The art states its own scale — the
character sheets are captioned "1.78 m · 110 px" and every impact effect gives
the width it covers — so vehicles and effects are scaled from metres rather than
eyeballed, and a car parked next to a man is the size a car actually is. The
car's cover geometry comes from its sprite, so the sill that stops a bullet is
the sill drawn on the bodywork.

**The residents had to be told apart.** They arrive on crowded sheets, many
different people with several frames each and nothing marking where one ends and
the next begins. They are cut by connected components rather than the grid slicer
— none of them is carrying a rifle that reaches into the next frame — and then
split into individuals by the mean colour of head, torso and legs, since every
resident is dressed differently and their frames sit together on the sheet.
Frames shorter than that person's standing height are their panic poses, which is
how the flee animation is found without labelling anything.

Sound is synthesised at runtime — the drop had no audio, and a firefight is
mostly noise bursts and sirens.

**The captioned sheets are read, not parsed.** The two gang characters arrive on
one sheet each with every animation on it and a caption per row. Finding those
groups automatically failed: the captions sit level with the frames they label
rather than above them, so a gap-based cut returns one box holding both the
lettering and the body, and the rows overlap vertically, so grouping by row
cascades into a single blob. What is reliable is the sheet's own documentation —
the row order is fixed and every row states its frame count — so the bands are
read off the sheet once into a table in `build_assets.py`, and each band is cut
into exactly the number of frames its caption claims. The lettering is rubbed off
first, a glyph or a whole underlined line at a time, with the threshold set below
a muzzle flash so the shooting frames keep their fire. The death rows are the
exception: their poses are strewn across two staggered sub-rows that overlap in
x, so no vertical cut separates them, and they are taken as whole blobs instead.

If those sheets are ever re-exported, laying them out like the effects sheet —
one animation per row, caption clear above the frames, uniform cell pitch — would
let them cut with no table at all.

## Credit

Character sprites, building art and the mechanics notes are from the project's
own art drop. Everything in `src/` and `tools/` is written for this game.
