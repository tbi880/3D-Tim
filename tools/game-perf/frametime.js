// Frame interval over FRAMES frames, three runs.
const FRAMES = 150; const gl = __r3.getState().gl; const ctx = gl.getContext();
async function measure() { const o = gl.render; let f = 0, d = 0, t0 = 0; gl.render = function () { d++; if (d === 1) { if (!t0) t0 = performance.now(); f++; } const r = o.apply(this, arguments); d--; return r; }; await new Promise((r) => { const c = () => (f > FRAMES ? r() : setTimeout(c, 20)); c(); }); const ms = (performance.now() - t0) / (f - 1); gl.render = o; return ms; }
const runs = []; for (let i = 0; i < 3; i++) runs.push((await measure()).toFixed(2));
return `${window.__label ?? ''} buffer ${ctx.drawingBufferWidth}x${ctx.drawingBufferHeight} samples ${ctx.getParameter(ctx.SAMPLES)} logDepth ${gl.capabilities.logarithmicDepthBuffer}: ${runs.join(' / ')} ms/frame`;
