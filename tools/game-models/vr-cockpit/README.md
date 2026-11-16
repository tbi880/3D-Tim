# The VR cockpit cabin

The cabin the pilot sits in when the game runs in a headset
(`src/game/xr/VRCockpitShell.jsx`). It is modelled by a Blender script, baked into one
texture atlas and web-optimised with `npx gltfjsx --transform`.

```sh
tools/game-models/vr-cockpit/build.sh            # about three minutes
tools/game-models/vr-cockpit/build.sh --preview  # also renders build/preview-*.png from the pilot's eye
```

writes `public/assets/game/vr-cockpit-transformed.glb` (≈310 KB), the file the game loads.
Needs Blender 4.2 (`BLENDER=/path/to/blender` if it is not in /Applications) and `npx`.
In production the file has to be uploaded to the asset bucket like the other models.

## What the script does (`build_cockpit.py`)

1. **Models the cabin** in the game's cockpit frame (eye at the origin, -z ahead, metres):
   the tub with its layered dashboard edge (padded top, titanium blade, a shadow gap that
   holds the waist light, a pearl leather roll), the binnacle with the flight display and two
   auxiliary displays, the seat with its flight controls, the dais, the rear wall's padded
   panels, the canopy frame and the glass roof. All of it is plain Python at the top of the
   file: sizes are constants, surfaces are the `SURFACES` table.
2. **Places the flight display** from `src/game/xr/cockpitLayout.json`. VRHud reads the same
   file for where it draws the instrument panel, so the picture always sits on the model's
   display glass. Change the display there, then rebuild.
3. **Removes what the pilot cannot see**: every face that no head position in `HEAD_BOX`
   has a line of sight to (the outside of the tub, the backs and undersides of the seat,
   the display's back, ...) is deleted before texturing. About a quarter of the faces go.
4. **Bakes one atlas** for all opaque surfaces: colour with ambient occlusion, roughness /
   metalness, and the glow the ambient light strips cast on every surface. The glow is the
   material's emissive map; the game tints it with the ambient colour, so the whole cabin
   changes colour with the ship's state without a single light in the scene.
5. **Exports three meshes**, one draw call each: `cabin`, `lights` (the strips; u = metres
   along the strip, v = across it) and `glass` (the roof).

`gltfjsx --transform` then resizes the textures to 1024 px WebP and Draco-compresses the
geometry. The component it generates is kept as `Vr-cockpit.generated.jsx` for reference;
the game's component uses the same three meshes and adds the light shader.

| | before (built in code) | now |
| --- | --- | --- |
| draw calls | 11 | 3 |
| lights | 1 point light (+1 in Cockpit.jsx) | none |
| triangles | 37,156 | 12,919 |
| textures | 5 canvas textures, 2 bump maps | 3 × 1024 px (+ a 32 px strip profile) |

## Looking at it without a headset

With the dev server running, open
`https://localhost:5173/tools/game-models/vr-cockpit/preview.html` (drag to look around;
1 / 2 / 3 = power mode, B = afterburner, H = hull critical; `?yaw=&pitch=&x=&y=&z=` set the
view and the head position).

The real game can be put into VR on a desktop browser from the console with the WebXR
emulator that ships with @react-three/xr:

```js
const { XRDevice, metaQuest3 } = await import('/node_modules/iwer/build/iwer.module.js');
const device = new XRDevice(metaQuest3);
device.installRuntime({ forceInstall: true });
__eod.session.newGame();
(await import('/src/game/xr/vrState.js')).enterVR();
// device.quaternion.set(x, y, z, w) turns the head.
```
