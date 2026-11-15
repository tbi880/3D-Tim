# Player ship models

Source models (from the web) are in `source/`. Each player ship in
`public/assets/game/player/` was made in this order:

1. **Exhaust** (Blender, `bpy` 5.x): `build_exhaust.py` reads the nozzle shapes and colours
   from `exhaust_specs.json` and builds layered flames (core, plume, halo, shock diamonds for
   the afterburner) with five clips — `Exhaust_Idle`, `Exhaust_Cruise`, `Exhaust_Full`,
   `Exhaust_Boost` (2 s loops at thrust 0.15 / 0.575 / 1 / 1.6, as `getThrust` in
   `src/game/scene/ShipsLayer.jsx`) and `Exhaust_Thrust` (time in seconds = thrust).
   `merge_exhaust.mjs` adds them to the untouched original → `public/assets/game/player/<ship>.glb`.
   The `.blend` files are in `blender/`.
2. **Hidden faces**: `node cull_io.mjs export <ship>.glb work/<ship>`, optionally
   `node cull_raster.mjs work <ship>`, then `python cull_vis.py work/<ship> 1024`
   (`pip install embreex numpy`) and `node cull_io.mjs apply <ship>.glb work/<ship> <culled>.glb`.
   A triangle is removed only if no ray from any of up to 22 points on it, in any of 1024
   directions, leaves the ship (single-sided surfaces let rays through from behind;
   transparent ones never hide anything and are never removed), and it showed in no pixel
   of the raster pass. The showcase animations that moved the whole ship are dropped here.
3. **One draw call for the flames**: `node fx_skin.mjs <culled>.glb <skinned>.glb` turns the
   per-layer meshes into one skinned mesh; each layer node becomes a bone and keeps its clips.
4. **Web optimisation**: `node ../optimize.mjs <skinned>.glb` → `<ship>-transformed.glb`.
5. **Hangar pictures**: `node render_previews.mjs` renders every ship from three views
   (bow, broadside, stern) into `src/game/ui/hangar/<classId>-<view>.webp` (≈190 KB for all
   fifteen), shown in the hangar. The models themselves load behind the game's loading screen.

Checked by rendering the original and the result from ten views in three.js r182 with the
game's post-processing: identical apart from texture-compression noise (≈45 dB PSNR).
