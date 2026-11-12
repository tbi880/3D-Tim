# Echoes of Dawn

A story-driven space combat game set after the site's *Project Dawn* scene, flown from the
cockpit or from a chase camera. Route: `/echoes_of_dawn` (page component:
`src/urls/EchoesOfDawn.jsx`).

You fly the escort ship **Kestrel**, the one ship that picked up the distress signal sent
from Captain Tim's flagship. The story runs as one continuous campaign with ten save points:

| Chapter | Sector | What happens |
| --- | --- | --- |
| Prologue · The Signal | The Collapse (black hole) | Helm and weapons check, scavenger drones, Tim's log buoy |
| 1 · Interdiction | The Veil belt (asteroids) | Pulled out of warp; destroy the Umbra warden; first live contact with Tim |
| 2 · The Graveyard | The Graveyard (wrecked picket line) | Scan transponders, survive an ambush, keep the frigate Harrier alive while her reactor restarts |
| 3 · The Forge | The Forge (Umbra shipyard) | Cut the captured Osprey out of the slipway, blow the reactors, get clear |
| 4 · Hold the Line | Cinder (lava planet) | Defend the Dawnbreaker while the Dawn core recharges |
| 5 · Eclipse | Cinder | Tim's fleet arrives; break the dreadnought's shield and paint it for the Dawn cannon |
| Epilogue · Home | Earth | The fleet jumps home |

Ships come in tiers, and distances are metres: fighters are 13–30 m, the corvette 130 m,
frigates 280 m, the warden 520 m, the Dawnbreaker 1.4 km, the Forge 3 km and the Eclipse
3.4 km. Fights with the big ones happen along their hulls, not at a point.

## Architecture

The game is split into layers that only depend downwards. The simulation knows nothing
about React or WebGL, which is what makes the headless test (below) possible.

```
config/   Tuning tables: ships, weapons, sectors, characters, difficulty. No logic.
core/     The simulation. World + Ship/Projectile data, and systems/ that move them
          (player flight, AI pilots, weapons, damage, projectiles, collisions, targeting).
story/    The campaign script (campaign.js) written with beat factories (beats.js) and
          played by StoryDirector / BeatRunner.
state/    GameSession (owns world + story + comms, implements the "stage" the story talks
          to, publishes HUD snapshots), checkpoint saves, and the zustand store for the UI.
input/    Keyboard / mouse / touch -> held controls + one-shot actions.
audio/    Web Audio synthesised sound effects + the site's music tracks.
scene/    React Three Fiber components. Pure observers: each frame they copy world state
          into three.js objects. Model loading lives in scene/models/.
ui/       DOM HUD, comms panel, menus, touch controls, and the 2D marker / radar drawing.
i18n/     English and Chinese text. All player-facing strings are keys in en.js / zh.js.
```

Data flow per frame: `scene/GameLoop` → `GameSession.update(dt, controls)` →
`World.update` (simulation) → `StoryDirector.update` (story) → throttled `ui.set(...)`
into the zustand store → React HUD. 3D layers read `session.world` directly in `useFrame`
and react to `world.events` (explosions, hits...).

### Models and assets

* Planets, the black hole and Captain Tim's ship reuse the site's existing GLB files
  (`ship-upgrade-transformed.glb` is the Dawnbreaker).
* Every other ship, the station and the cockpit are GLB files in `public/assets/game/`,
  and they all share six tiling textures in `public/assets/game/textures/` (plating
  albedo / normal / occlusion-roughness-metalness / window lights, rock albedo / normal).
  About 1.8 MB in total. **For production the whole `game/` folder must be uploaded to the
  asset bucket**, next to the site's other models. A ship whose files are missing is drawn
  as a plain block, and asteroids fall back to plain rock, so the game still runs.
* The game GLBs are generated, not hand-made (`tools/game-models`, needs `pip install bpy
  numpy pillow`, or run with `blender -b -P`):
  * `npm run game:models` runs `build_models.py`, which describes each ship as hull
    sections plus parts; `shipforge.py` turns that into a mesh - smooth hulls with
    face-weighted normals, chamfered edges, scattered machinery, box-projected UVs,
    ambient occlusion and faction colours baked into vertex colours - and deletes every
    face that can never be seen (the buried halves of intersecting parts, typically a
    quarter of the mesh). It also writes `scene/models/modelManifest.json` (size, engine
    positions, mount points, triangle count).
  * `npm run game:textures` runs `make_textures.py`, which draws the shared textures.
* A generated model is **one mesh with two materials**, named `hull` and `glow`. The game
  replaces both with its own (`scene/models/shipMaterials.js`), so every ship of every
  faction draws with the same two shader programs and the same textures: two draw calls
  per ship. Vertex colour RGB is the paint, alpha marks where lit windows show.
* Models are shown with `scene/models/GltfModel.jsx`, not the site's `AnyModel`: `AnyModel`
  marks every material transparent, which makes overlapping hulls flicker in a battle.
* Music reuses `music/bgm2|5|6.mp3`; sound effects are synthesised.

### Rendering notes

* The canvas uses a **logarithmic depth buffer** (`glOptions` on `CanvasProvider`): the
  scene spans a 3 m cockpit and a planet 400 km away, which an ordinary depth buffer cannot
  resolve without z-fighting. Custom shaders must include three.js's `logdepthbuf` chunks
  (see `effects/ParticleSystem.js`).
* Ships are tested for hits against one or more boxes (`halfExtents` / `hitBoxes` in
  `config/shipClasses.js`), not a sphere, so you can fly between a dreadnought's hulls.
* **Lighting**: one sun per sector, very little flat ambient light, and an environment map
  rendered from the sector's own sky (nebula colours plus the sun) for reflections and
  fill - see `SectorEnvironment` in `SectorBackdrop.jsx`. A studio HDRI would make the
  fleet look like a product photo.
* **Planets** have true sizes and distances (`radiusKm`, `distanceKm` in
  `config/sectors.js`). Each frame they are drawn on the line from the camera to their real
  position, 400 km out and shrunk by the same ratio, which looks identical to the real
  thing but keeps the numbers inside what a GPU can represent.
* **Explosions** (`ExplosionsLayer.jsx`, `scene/effects/`) are built from pooled, instanced
  parts: fire-and-smoke puffs (`FireballSystem`), sparks (`ParticleSystem`), wreckage
  (`DebrisSystem`, shapes in `wreckageShapes.js`: torn plating, hull sections, frame and
  machinery, textured and painted like the ship they came from; small pieces fly far,
  large ones barely drift), flashes, shock rings and two point lights that are always
  mounted. A destroyed capital ship does not vanish: for `EFFECTS.breakupSeconds` its
  powerless hull drifts, burns and starts to tumble (`effects/breakup.js` gives both the
  hull and the fires their pose), then the main explosion replaces it with wreckage.
* **Shields** (`effects/ShieldShell.js`) are invisible until hit, then glow around the
  point of impact only. **Exhaust** for every ship but the player's is a shader-drawn
  plume, one mesh per ship (`effects/ExhaustPlume.js`); a model with an empty `engines`
  list (the Dawnbreaker) has none.
* Ships arriving by warp are invulnerable and untargetable until they land
  (`ship.arriving`); `ShipsLayer` draws the streak, `ExplosionsLayer` the flash and ring.

## Common changes

**Tune the game** – edit `config/gameConfig.js`, `config/shipClasses.js`, `config/weapons.js`.

**Add a ship** – add an entry to `SHIP_CLASSES` and its name to both i18n files, then give
it a model: either write a builder in `tools/game-models/build_models.py`, register it in
`MODELS` and run `npm run game:models`, or use an existing file (next point).

**Add or rebalance a player ship** – the hangar lists `PLAYER_SHIPS` (`config/playerShips.js`);
each is an ordinary class in `config/shipClasses.js` with two extra fields: `handling`
(multipliers for turn rate, acceleration, afterburner duration and afterburner speed) and
`weaponDamage`. Names and descriptions are `ship.<id>` and `playerShip.<id>.*` in the i18n
files. The Swift, Shrike and Bulwark borrow the Kestrel's model for now: to give one its own,
add it to `MODEL_OVERRIDES` (next point) and remove its line from `MODEL_ALIASES` in
`scene/models/ShipModel.jsx`. The player's exhaust is the simple `EnginePlumes` in
`ShipsLayer.jsx` and reads the `engines` of whichever model is shown.

**Swap in a downloaded model** (Sketchfab etc.) – put the GLB in `public/assets/game/` and
add an entry to `MODEL_OVERRIDES` in `scene/models/ShipModel.jsx` with its `file`, the
`scale` that turns its units into metres, the `rotation` that points its nose to −Z, and
its `engines`. Nothing else changes; the hit boxes stay in `shipClasses.js`.

**Add a sector** – add an entry to `config/sectors.js`. Planets are placed by direction,
real radius and real distance; the comment at the top of the file gives the formula for how
big that looks.

**Gun batteries** – a module class whose weapon has a `lockTime` (see `eclipseCannon`) must
track its target that long before firing and loses the lock outside its `range`. While one
is on the player the HUD shows a warning (`world.playerCannonLock`). The Eclipse's are
mounted in `spawnEclipse` (`story/campaign.js`) and die to a single torpedo.

**Tune difficulty** – `DIFFICULTY` in `config/gameConfig.js`. Each level scales damage taken
by the player and by allies, Umbra toughness, fire rate and beam damage, allied damage and
the player's shield recharge. `npm run game:simulate -- --difficulty=admiral` flies the
campaign at a given level; add `--ship=swift` (or `shrike`, `bulwark`) to fly another ship.

**Change the story** – edit `story/campaign.js`. It reads top to bottom:

```js
say('tim', 'hold.tim.fighters', { wait: false }),          // comms line (text in i18n)
spawn('drone', { count: 4, group: 'wave', at: around(TAG.DAWNBREAKER, 2000) }),
waitForGroup('wave'),
checkpoint('my-checkpoint'),                               // save point
```

Rules for checkpoints: enemies are never saved, so place checkpoints at lulls; ships that
must survive a reload need `persistent: true` and a tag; anything non-serialisable
(background sequences, progress bars, objective counters) is declared again right after
the checkpoint. Add a `checkpoint.<id>` label to both i18n files.

**Add a language** – copy `i18n/en.js`, register it in `i18n/index.js`.

## Testing

```
npm run game:simulate
```

flies the whole campaign in Node with an autopilot, then reloads every checkpoint and
flies on to the next one. It fails if the story dead-locks, a checkpoint will not load, or
the autopilot dies implausibly often. Run it after touching `story/` or `config/`.

In development (`stageOfENV = "dev"`) the running game is exposed as `window.__eod`
(`{ session, input, sound }`) for poking at from the browser console.

## Controls

| Action | Keys |
| --- | --- |
| Steer | Mouse (virtual stick) / arrow keys |
| Throttle | W / S |
| Roll | A / D |
| Afterburner | Shift |
| Beam arrays (hold) | Left mouse / F |
| Torpedo | Right mouse / Space |
| Next target / nearest to crosshair | T / R |
| Cockpit / chase view | V / C |
| Power: balanced / attack / defense | 1 / 2 / 3 |
| Skip comms line | Enter |
| Pause | Esc / P |
| Mute | M |

**Phones and tablets** (`ui/TouchControls.jsx`, shown when the primary pointer is a
finger): a stick under the left thumb steers, the bar beside it sets the throttle, and the
right thumb has LOCK, BURN, TORP and FIRE. Beams fire automatically at whatever is inside
the aiming ring (the *Auto-fire* setting, on by default on touch). The top bar has pause,
skip, view and power. The HUD needs the long side of the screen, so portrait shows a
"turn your phone" notice. Hints that name keys have a `.touch` twin in the i18n files.
