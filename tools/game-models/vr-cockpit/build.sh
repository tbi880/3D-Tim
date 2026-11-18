#!/bin/sh
# Builds the cockpit cabin and the VR flight stick and web-optimises them (several minutes):
#   tools/game-models/vr-cockpit/build.sh [--only cockpit|stick] [--preview]
# -> public/assets/game/vr-cockpit-transformed.glb and vr-stick-transformed.glb, the files the game loads.
set -e
cd "$(dirname "$0")"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
rm -f build/*.glb
PYTHONUNBUFFERED=1 "$BLENDER" -b --python build_cockpit.py -- "$@" 2>&1 | grep -E '^\[|Error|Traceback|^  File|SIG' || true
cd build
for model in vr-cockpit vr-stick; do
    test -f "$model.glb" || continue
    # The cabin's colour atlas is 2048 px (the stick's textures are smaller and stay as they are).
    npx --yes gltfjsx@6.5.3 "$model.glb" --transform --resolution 2048 | tail -4
    # gltfjsx also writes a JSX component; the game's own components (src/game/scene/CockpitCabin.jsx,
    # src/game/xr/VRFlightStick.jsx) use the same meshes. The generated ones are kept beside this script for reference.
    name="$(echo "$model" | cut -c1 | tr a-z A-Z)$(echo "$model" | cut -c2-)"
    mv "$name.jsx" "../$name.generated.jsx"
    cp "$model-transformed.glb" "../../../../public/assets/game/$model-transformed.glb"
    ls -l "../../../../public/assets/game/$model-transformed.glb"
done
