# Lantern Station

The giant station of chapter 6 (`lanternStation` in `src/game/config/shipClasses.js`). The
source is a model from the web, `source/spacestation7.glb` (not committed: it is
`spacestation_7_-_procedural.glb` in the project library): ring, tower, an asteroid field and
a swarm of circling ships, 338 k triangles and 35 MB. The game file is
`public/assets/game/station/lantern-station-transformed.glb` (92 k triangles, 2 draw calls,
675 KB).

## Rebuilding it

Run from `tools/game-models` (`npm install` there once; the culling step also needs
`pip install embreex numpy`):

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P station/build_station.py
node player-ships/cull_io.mjs export station/build/lantern-station-clean.glb station/build/cull/station
python player-ships/cull_vis.py station/build/cull/station 1024
node player-ships/cull_io.mjs apply station/build/lantern-station-clean.glb station/build/cull/station station/build/lantern-station.glb
npx gltfjsx@6.5.3 station/build/lantern-station.glb --transform -o station/build/LanternStation.jsx
cp station/build/lantern-station-transformed.glb ../../public/assets/game/station/
```

1. **`build_station.py`** (Blender 4.2+, headless) deletes the asteroid field (88 k triangles)
   and the little ships circling the station with their animation (51 k), joins the rest into
   one mesh, drops the four UV layers that were copies of the first, centres the model on the
   ring, turns it so the undock lane leaves along −Z and scales it to metres (1200 m per
   unit: the ring is 4.7 km across). Then it adds the **guide lights** (below) and writes
   `build/lantern-station-clean.glb` and `build/layout.json`.
2. **Hidden faces** (the same tools as the player ships, `../player-ships/README.md`): a
   triangle is removed when no ray from any point on it, in any of 1024 directions, gets out
   of the station. That removes 55 % (114 k triangles), mostly the insides of the hull
   modules and the parts of the scattered machinery buried in the hull. Renders before and
   after differ in a dozen anti-aliased pixels. The ray test takes about 10 minutes; it only
   has to be redone when the geometry changes (re-running `apply` on a new clean file is
   enough if only materials or colours changed — `export` writes the same `station.tris.bin`).
3. **`npx gltfjsx --transform`** (Draco, WebP textures, 1024 px cap; the generated JSX is not
   used, the game loads the GLB through `ShipModel`). Material names and the guide lights'
   vertex colours survive it, which is all the game needs. The repo's `optimize.mjs` keeps
   higher-quality textures (1.5 MB instead of 675 KB) if the station ever looks blurry up close.

`build/` is not committed. After changing the lanes or the hull, copy the numbers from
`build/layout.json` into the game: `hitBoxes` → `LANTERN_HIT_BOXES` in
`config/shipClasses.js`, `lanes` → `ARRIVAL_MOUTH` / `UNDOCK_*` in `story/campaign.js`.

## Guide lights

Two lanes of beacons run from dock mouths on the tower's inner face, across the ring and out
through the gap in it, 4.3 km past the station's centre:

* **departure** lane (upper, 300 m above the ring plane): cool white pulses running **outwards**;
* **arrival** lane (lower, 120 m below it): amber pulses running **inwards**, towards the dock;
* a frame of steady green lamps around each dock mouth.

Each lane is two rows of beacons 460 m apart, one every 170 m (140 beacons, 176 lamps). All
of them, lamps and dark housings, are one mesh with one material (`guideLight`), so the
whole display is a single draw call. Nothing moves on the CPU: each vertex colour says where
its lamp sits along its lane (R), which lane (G) and whether it is a lamp or its housing (B),
and the game's shader (`src/game/scene/models/guideLightMaterial.js`) works out the pulses
from the time. The pulse speed, colours and brightness are at the top of that file.
