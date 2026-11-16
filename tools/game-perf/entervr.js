const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/xr/vrState.js'));
const v = await import(url);
await v.enterVR();
await new Promise((r) => setTimeout(r, 4000));
const s = __r3.getState();
const xr = s.gl.xr;
const cam = xr.getCamera();
const size = s.gl.getDrawingBufferSize(new (s.camera.position.constructor)());
return { url, active: v.vr.active, presenting: xr.isPresenting, eyes: cam.cameras.map((c) => [c.viewport.x, c.viewport.y, c.viewport.z, c.viewport.w]), buffer: [size.x, size.y], samples: s.gl.getContext().getParameter(s.gl.getContext().SAMPLES), fbScale: xr.getFramebufferScaleFactor?.(), phase: __eod.session.phase, foveation: xr.getFoveation?.() };
