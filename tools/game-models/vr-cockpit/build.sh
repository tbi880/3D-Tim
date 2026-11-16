#!/bin/sh
# Builds the VR cabin and web-optimises it (about three minutes):
#   tools/game-models/vr-cockpit/build.sh [--preview]
# -> public/assets/game/vr-cockpit-transformed.glb, the file the game loads.
set -e
cd "$(dirname "$0")"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
rm -f build/vr-cockpit.glb build/vr-cockpit-transformed.glb
PYTHONUNBUFFERED=1 "$BLENDER" -b --python build_cockpit.py -- "$@" 2>&1 | grep -E '^\[|Error|Traceback|^  File|SIG' || true
test -f build/vr-cockpit.glb
cd build
# gltfjsx also writes a JSX component; the game's own component is src/game/xr/VRCockpitShell.jsx
# (the same three meshes). The generated one is kept beside this script for reference.
npx --yes gltfjsx@6.5.3 vr-cockpit.glb --transform | tail -4
mv Vr-cockpit.jsx ../Vr-cockpit.generated.jsx
cp vr-cockpit-transformed.glb ../../../../public/assets/game/vr-cockpit-transformed.glb
ls -l ../../../../public/assets/game/vr-cockpit-transformed.glb
