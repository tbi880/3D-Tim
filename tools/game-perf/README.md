# Measuring the game in emulated VR

What the game draws in a headset, counted on this Mac: draw calls and triangles per object,
and frame time at a headset's resolution. No headset needed, and none of it tells you the
frame rate a headset will reach: for that, pause the game inside the headset, where the
pause menu shows the last flight's frame rate, resolution, draw calls and triangles.

With the dev server running (`npm run dev`), from this folder:

```
./vr.sh                     # own Chrome window -> new game -> emulated stereo VR, 1920x1920 per eye, 4x MSAA
node cdp.mjs drawcalls.js   # per object: draw calls and triangles a frame (both eyes), most calls first
node cdp.mjs frametime.js   # milliseconds a frame, three runs (the window runs without vsync)
node cdp.mjs -e "return __eod.session.phase" --shot /tmp/view.jpg    # any expression in the page; --shot saves a screenshot
```

How it works: `launch.sh` starts Chrome with a throwaway profile and the DevTools protocol on
port 9333; `cdp.mjs` evaluates a script in the game's tab over that protocol (Node's own
WebSocket, nothing to install). `setup.js` installs Meta's WebXR emulator (`iwer`, already a
dependency of `@react-three/xr`) and exposes the renderer as `window.__r3`; `entervr.js`
starts the VR session. The page's `window.__eod` (the running game, dev builds only) does the
rest: `__eod.session.world.spawnShip('raider', { position, facing })` for a fight, and so on.

Reading the numbers:

- `drawcalls.js` wraps `renderer.renderBufferDirect`, so its counts are exact, and they are
  the same on any GPU. Rows with a fraction of a call a frame are the distant bodies'
  pictures being retaken (`scene/effects/Impostor.js`).
- Frame time on an Apple GPU says how costs compare, not what a headset will do: a
  headset's GPU is several times slower and spends its time differently. Runs differ by a
  millisecond or two, so compare within one page load (hide an object, measure, show it
  again) and distrust small differences.
- A window that is not in front pauses the game (`blur`); `vr.sh` resumes it, and so should
  anything that waits a while before measuring.
