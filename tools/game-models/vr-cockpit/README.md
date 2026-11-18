# The cockpit cabin and the VR flight stick

The cabin the pilot sits in, in every first-person view: on a screen and in a headset
(`src/game/scene/CockpitCabin.jsx`; it was built for VR first and replaced the flat screen's
own cockpit model in 2026-11, hence the "vr" in the file names), and the flight stick drawn in
each hand in place of the headset's controller model (`src/game/xr/VRFlightStick.jsx`). Both are modelled by one
Blender script, baked into texture atlases and web-optimised with `npx gltfjsx --transform`.

```sh
tools/game-models/vr-cockpit/build.sh                 # both models, about seven minutes
tools/game-models/vr-cockpit/build.sh --only stick    # or --only cockpit
tools/game-models/vr-cockpit/build.sh --preview       # also renders build/preview-*.png from the pilot's eye
```

writes `public/assets/game/vr-cockpit-transformed.glb` (≈585 KB) and
`vr-stick-transformed.glb` (≈112 KB), the files the game loads.
Needs Blender 4.2 (`BLENDER=/path/to/blender` if it is not in /Applications) and `npx`.
In production the files have to be uploaded to the asset bucket like the other models.

## What the script does (`build_cockpit.py`)

1. **Models the cabin** in the game's cockpit frame (eye at the origin, -z ahead, metres).
   The look is a modern luxury-car cabin taken into space:
   - one band of display glass across the dashboard, flat in the middle where the game draws
     the flight display, curving round towards the pilot, with a turbine air vent at each tip;
   - a wraparound band of open-pore walnut with fine metal lines inlaid along it, under a
     metal blade and a shadow gap that holds the waist light;
   - diamond-quilted pearl leather on the seat and armrests (real geometry, so the seams
     catch the baked light), midnight-blue leather on the dash top and the padded rear wall,
     rose-champagne metal trim, gloss black, and a glass roof.
   All of it is plain Python at the top of the file: sizes are constants, surfaces are the
   `SURFACES` table, painted surfaces (the wood's grain) are in `PATTERNS`.
2. **Places the display glass** from `src/game/scene/cockpitLayout.json`. VRHud reads the same
   file for where it draws the instrument panel, so the picture always sits on the glass.
   Change the display there, then rebuild.
3. **Removes what the pilot cannot see**: every face that no head position in `HEAD_BOX`
   has a line of sight to (the outside of the tub, the backs and undersides of the seat,
   the back of the glass, ...) is deleted before texturing. About a fifth of the faces go.
4. **Bakes one atlas** for all opaque surfaces: colour with ambient occlusion (2048 px),
   roughness / metalness, and the glow the ambient light strips cast on every surface. The
   glow is the material's emissive map; the game tints it with the ambient colour, so the
   whole cabin changes colour with the ship's state without a single light in the scene.
5. **Exports three meshes**, one draw call each: `cabin`, `lights` (the strips; u = metres
   along the strip, v = across it) and `glass` (the roof).

The **flight stick** (`build_stick`) is modelled in WebXR's grip space (the hand closes round
the z axis, thumb end at -z, fingers round -y), at real size, symmetric so one model serves
both hands. It goes through the same bake, but its lights are part of its one mesh and shine
through its emissive map: one draw call per hand.

`gltfjsx --transform` then converts the textures to WebP (capped at 2048 px) and
Draco-compresses the geometry. The components it generates are kept as
`Vr-cockpit.generated.jsx` and `Vr-stick.generated.jsx` for reference; the game's components
use the same meshes and add the light shader and the ambient colour.

| | first VR cabin (built in code) | now |
| --- | --- | --- |
| draw calls | 11, plus the headset's controller models | 3, plus 1 per flight stick |
| lights | 1 point light (+1 in Cockpit.jsx) | none |
| triangles | 37,156 | 20,252 (+2,002 per stick) |
| textures | 5 canvas textures, 2 bump maps | 2048 px colour, 2 × 1024 px (+ a 32 px strip profile) |

## Looking at it without a headset

With the dev server running, open
`https://localhost:5173/tools/game-models/vr-cockpit/preview.html` (drag to look around;
1 / 2 / 3 = power mode, B = afterburner, H = hull critical; `?yaw=&pitch=&x=&y=&z=` set the
view and the head position, `?stick=1` shows a flight stick close up).

The real game can be put into VR on a desktop browser from the console with the WebXR
emulator that ships with @react-three/xr:

```js
const { XRDevice, metaQuest3 } = await import('/node_modules/iwer/build/iwer.module.js');
const device = new XRDevice(metaQuest3);
device.installRuntime({ forceInstall: true });
// Then start a game and press "Enter VR" in the pause menu (Esc).
// device.quaternion.set(x, y, z, w) turns the head; device.controllers.right.position moves a hand.
```
