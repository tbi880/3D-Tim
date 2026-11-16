#!/bin/bash
# A fresh window, a new game, and emulated stereo VR at a headset's resolution (W x H for both eyes, default
# 3840x1920). The dev server must be running. Afterwards: node cdp.mjs drawcalls.js, node cdp.mjs frametime.js.
cd "$(dirname "$0")"
pkill -f "eod-perf-chrome"; sleep 1
./launch.sh
until curl -s http://127.0.0.1:9333/json >/dev/null 2>&1; do sleep 0.5; done
# Wait for the game object and for the page to finish loading its assets.
until [ "$(node cdp.mjs -e "return Boolean(window.__eod) && document.readyState === 'complete' && performance.getEntriesByType('resource').some((e) => e.name.includes('@react-three_fiber'))" 2>/dev/null)" = "true" ]; do sleep 1; done
sleep 3
node cdp.mjs setup.js > /dev/null; sleep 5
node cdp.mjs -e "__xrd.stereoEnabled = true; return 1" > /dev/null
node cdp.mjs entervr.js > /dev/null
# The emulator sizes the canvas to the window: give it a headset's pixels instead.
node cdp.mjs -e "const c=__r3.getState().gl.domElement; c.width=${W:-3840}; c.height=${H:-1920}; return 1" > /dev/null
# Past the fade-in; a window that is not in front pauses the game, so resume it.
node cdp.mjs -e "__eod.session.resume(); for (let i=0;i<70;i++) __eod.session.update(1/30, __eod.input.controls); return __eod.session.phase + ' presenting=' + __r3.getState().gl.xr.isPresenting"
