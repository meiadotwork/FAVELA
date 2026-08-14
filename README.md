# FAVELA

A 2D cover shooter in HTML5. You hold one corner of one house against a crew
coming up the lane at you, and the whole fight is decided by where you stand,
how low you stand there, and when you put your shoulders past the corner.

No build step, no dependencies — open it over a local server and it runs.

```
python3 -m http.server 8080
# then open http://localhost:8080
```

A server is required (not `file://`): the game is ES modules and fetches its
asset manifest.

### One file, no server

```
python3 tools/bundle.py dist/favela.html --quality=70
```

Folds the whole game into a single HTML file — modules concatenated, CSS
inlined, every atlas and prop a data URI — which opens straight from the
filesystem and can be hosted anywhere a page can. Each module keeps its own
scope inside the bundle, publishing its exports to one shared namespace, so two
modules that both declare `ctx` at the top level still cannot collide.

## Controls

| | |
|---|---|
| Arrows / WASD | Move — and, pressed into the corner, lean out past it |
| Shift | Run |
| ↓ | Crouch, then go prone |
| ↑ | Stand back up |
| Space / left mouse | Fire |
| Mouse | Aim — move it and it takes over; leave it and the aim goes back to automatic |
| R | Reload |
| 1 2 3 / E | Rifle, pistol, shotgun |
| Z | Zoom the camera out and back |
| C | Cycle stance · P Pause · M Mute |
| F1 | Draw the mechanics |

On touch there is a direction ring on the left and a row of buttons on the
right — zoom, weapon, crouch, reload and the trigger, biggest and nearest the
corner. The ring is analog: how far you push it is how fast you walk, and
pushing it to the rim is the run, which is why there is no run button. Anywhere
on the left grabs the ring wherever your thumb lands, anywhere on the open right
is also the trigger, and the black bars either side of the picture count as the
edge they sit against, so a thumb resting off the canvas still works. Hold the
phone sideways.

## How the fight works

Everything below is in `src/tuning.js`, in metres and seconds. The art states
its own scale — the sheets are captioned 1.78 m at 110 px — so the simulation is
written in real units and converted to pixels in exactly one place. A 4 m/s
sprint is a sprint, and a 14 m shotgun range is a distance you can pace out.

**The map is one house and one corner.** The building is set back and drawn
behind you, and what actually stands in the lane is its corner: 0.9 m of wall at
full height that stops everything and that nobody walks through. Everything
arrives from up the lane, so the far side of that corner is safe ground and the
near side is the fight. The door is 2 m, the man is 1.70 m, and every other
measurement in the art and the simulation is stepped off those two.

**Leaning is the whole peek.** You cannot walk around a corner in a lane that
only has one dimension, so pressing into it leans you out instead: hold toward
the corner and your shoulders come past it over about a quarter of a second,
let go and they come back. The lean moves the body, not just the gun — hitbox,
muzzle and sprite all read the same position — so being able to shoot and being
able to be shot arrive together, which is the trade the whole map is built on.

**Stance is the other half.** Each stance sets four numbers: how tall your body
is, how high your muzzle sits, how fast you move, and how steady you shoot.
Crouching cuts your spread by a third and lying down by nearly two thirds, which
at twenty-five metres is the difference between hitting a prone man and not.
Changing stance takes time — 0.22 s to drop to a crouch, 0.85 s to get up off
the floor — and you cannot fire mid-change. Half-way through a transition your
body height is genuinely half-way too.

**Aim finds what is exposed.** The shot is steered onto the nearest enemy the
muzzle can actually reach, and the aim point is the highest-value part of him
that is not behind something: centre mass if he is in the open, the head and
shoulders if that is all that clears his wall. Heads take two and a half times
damage, so peeking is expensive for both sides. Move the mouse and you take the
aim over yourself; leave it alone and it goes back to automatic.

**Weapons answer that geometry differently.** The rifle is the long gun: full
damage to twenty-six metres, still lethal at sixty, three hundred rounds in
reserve, and it blooms as you hold the trigger. The pistol hits harder per shot
inside twelve metres and blooms faster. The shotgun throws eight pellets that
fall off hard past five metres — murderous across a doorway, useless down the
lane — and it feeds one shell at a time, so a reload can be cut short to get one
round off.

**The camera can be pulled back.** Zoom steps through 1x, 0.72x and 0.52x,
showing 20, 27 or 38 metres of lane. At the far setting you can see the whole
crew coming and pick the one to shoot first; at the near one you can see what
you are aiming at.

**Fire that misses still counts.** A round passing within about a metre
suppresses whoever it passes, and only along the stretch it actually flew — a
bullet that buries itself in the wall in front of a man has not gone past his
ear. Suppressed enemies stay down and stop shooting; suppress one for long
enough and he gives the box up as a bad job and works his way to another one,
which is what stops a firefight settling into a stalemate.

**The other side runs the same code.** Enemies are actors with a brain filling
in the intent instead of a keyboard. On this map they have nothing to hide
behind, so they walk to the range their weapon wants — twenty-four metres for a
rifle, seven for a shotgun, each man biased a little differently so a crew
spreads down the lane instead of forming a rank — and then get down and fight
from there, prone past twenty metres, where a man is a very small thing to hit.
They fire from a stop, never on the move. Given cover they use it the same way
you do, shooting over it and ducking, or stepping past a corner and back.
Their aim is detuned deliberately — error that decays the longer they have you
in sight but never reaches zero, drift so a burst walks across you instead of
stapling itself to one spot, damage at half, and no head multiplier. Perfect
tracking in their hands is not a fight, it is a formality.

Press **F1** and all of it is drawn: cover boxes with their top edges, damage
zones on every body, muzzle heights, the spread cone, and a line from each enemy
muzzle to you that goes green when it is clear and red where it is blocked.

## Layout

```
index.html, style.css
src/
  tuning.js    every number in the game, in metres and seconds
  world.js     the lane, the corner, and the bullet-blocking rule
  props.js     the house, painted to the same measurements
  actor.js     stance, movement, weapon handling, health
  combat.js    rounds in flight, hit tests, damage, suppression
  ai.js        the enemy brain
  fx.js        flashes, casings, blood, decals, shake, hitstop
  render.js    parallax favela, dirt, cover, actors
  hud.js       health, ammo, stance, spread, screens
  debug.js     the mechanics overlay
  input.js     keyboard, mouse and touch, flattened to named actions
  audio.js     synthesised gunfire
  assets.js    atlas loading and anchored sprite drawing
  game.js      the loop, the waves, the player's hand
tools/
  slicer.py         cuts the raw sprite sheets into frames
  build_assets.py   builds the runtime atlases and manifest
  bundle.py         folds the game into one self-contained HTML file
assets/        generated — atlases, buildings, assets.json
dist/          generated — the single-file build (not committed)
```

The simulation runs on a fixed 60 Hz step with the frame time accumulated, so
reload times, stance transitions and spread behave the same on any machine; a
slow frame draws late rather than stepping further. `window.FAVELA` is the whole
game state, reachable from the console while it runs.

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

Sound is synthesised at runtime — the drop had no audio, and a firefight is
mostly noise bursts.

## The house

The house is painted in `props.js` rather than loaded, because the reference for
it arrived as a picture in a conversation and not as a file in the repository.
It is drawn to the stated measurements — 2 m door, 5.6 m wall, 2.9 m to the roof
slab, a 0.8 m tank on top — from brick, plaster fields with the render come away
in patches, a louvred window, cobogo blocks, algae under the roof line and weeds
at the footing.

If the real artwork turns up, it wins: add it to `assets/props/` and name it in
the manifest as `"house": {"file": "props/casa.webp"}`, and the renderer draws
that instead, scaled to the same 5.6 m. Nothing else changes.

## Not in this build

The map was cleared back to the one house on purpose. The rest of the content is
not rebuilt: no character select, no numbered levels with weather, no residents
in the lane, no ladders or rooftops, no cars or caveirão, and no police raid
opening. The art for all of it is still in `assets/` and the manifest still
carries it, so it can go back on top when the shooting is right.

## Credit

Character sprites, building art and the mechanics notes are from the project's
own art drop. Everything in `src/` and `tools/` is written for this game.
