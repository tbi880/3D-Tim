// Installs the WebXR emulator, starts a new game, exposes the R3F state as window.__r3.
if (!window.__xrd) {
  const m = await import('/node_modules/iwer/build/iwer.module.js');
  const d = new m.XRDevice(m.metaQuest3);
  d.installRuntime({ forceInstall: true });
  window.__xrd = d;
}
const fiberUrl = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('@react-three_fiber'));
const fiber = await import(fiberUrl);
const canvas = [...document.querySelectorAll('canvas')].find((c) => fiber._roots.has(c));
window.__r3 = fiber._roots.get(canvas).store;
__eod.session.newGame();
return { fiberUrl, canvas: [canvas.width, canvas.height], supported: await navigator.xr.isSessionSupported('immersive-vr') };
