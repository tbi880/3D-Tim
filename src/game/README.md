# Echoes of Dawn

A first-person, story-driven space combat game set after the site's *Project Dawn* scene.
Route: `/echoes_of_dawn` (page component: `src/urls/EchoesOfDawn.jsx`).

You fly the escort ship **Kestrel**, the one ship that picked up the distress signal sent
from Captain Tim's flagship. The story runs as one continuous campaign with save points:

| Chapter | Sector | What happens |
| --- | --- | --- |
| Prologue · The Signal | The Collapse (black hole) | Helm and weapons check, scavenger drones, Tim's log buoy |
| 1 · Interdiction | The Veil belt (asteroids) | Pulled out of warp; destroy the Umbra warden; first live contact with Tim |
| 2 · Hold the Line | Cinder (lava planet) | Defend the Dawnbreaker while the Dawn core recharges |
| 3 · Eclipse | Cinder | Tim's fleet arrives; break the dreadnought's shield and paint it for the Dawn cannon |
| Epilogue · Home | Earth | The fleet jumps home |

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
          into three.js objects. Procedural ship models live in scene/models/.
ui/       DOM HUD, comms panel, menus, touch controls, and the 2D marker / radar drawing.
i18n/     English and Chinese text. All player-facing strings are keys in en.js / zh.js.
```

Data flow per frame: `scene/GameLoop` → `GameSession.update(dt, controls)` →
`World.update` (simulation) → `StoryDirector.update` (story) → throttled `ui.set(...)`
into the zustand store → React HUD. 3D layers read `session.world` directly in `useFrame`
and react to `world.events` (explosions, hits...).

### Models and assets

* Scenery and Captain Tim's ship reuse the site's existing GLB files through `AnyModel`
  (black hole, planets, `ship-upgrade-transformed.glb` as the Dawnbreaker), loaded from
  `bucketURL` like every other scene. **No new files need uploading to the bucket.**
* All other ships are built in code (`scene/models/shipModels.js`), two draw calls each.
* Music reuses `music/bgm2|5|6.mp3`; sound effects are synthesised.

## Common changes

**Tune the game** – edit `config/gameConfig.js`, `config/shipClasses.js`, `config/weapons.js`.

**Add a ship** – add an entry to `SHIP_CLASSES`; add a builder with the same `model` id to
`MODEL_BUILDERS` in `scene/models/shipModels.js`; add its name to both i18n files.

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
| Power: balanced / attack / defense | 1 / 2 / 3 |
| Skip comms line | Enter |
| Pause | Esc / P |
| Mute | M |

Touch devices get an on-screen stick and buttons (`ui/TouchControls.jsx`).
