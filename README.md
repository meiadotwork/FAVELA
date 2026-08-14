# FAVELA

A 2D cover shooter in HTML5. You pick one of four characters and hold the alley
against rival crews and police raids across six levels, each at a different time
of day and in different weather.

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

**Aim is automatic**, as specified. The shot is steered onto the nearest target
ahead of you, so the decisions are where to stand and when to stand up, not
where to point. Enemies get a detuned version of the same aim — they miss, fire
in bursts, and hit for half — because perfect tracking in their hands is not a
fight, it is a formality.

**Police levels open with the code**: three firework pops over the hill, the
lookouts' signal that the police are coming up, then the sirens.

Roughly every third house is climbable — a ladder at one end, a roof to fight
down from.

## Layout

```
index.html, style.css
src/
  game.js      screens, waves, the main loop
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

Two things in there are worth knowing about, because the raw art fought back:

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

Sound is synthesised at runtime — the drop had no audio, and a firefight is
mostly noise bursts and sirens.

## Credit

Character sprites, building art and the mechanics notes are from the project's
own art drop. Everything in `src/` and `tools/` is written for this game.
