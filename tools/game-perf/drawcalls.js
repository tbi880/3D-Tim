// Counts draw calls per object over FRAMES rendered frames by wrapping renderBufferDirect.
const FRAMES = 60;
const s = __r3.getState();
const gl = s.gl;
if (window.__xrd && !window.__xrd.stereoEnabled) { window.__xrd.stereoEnabled = true; await new Promise((r) => setTimeout(r, 500)); }
const orig = gl.renderBufferDirect;
const rows = new Map();
let frames = 0;
const label = (o) => {
  const parts = [];
  for (let p = o; p && p.type !== 'Scene'; p = p.parent) parts.push(p.name || p.type);
  return parts.reverse().join('/');
};
gl.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
  const idx = geometry.index;
  const pos = geometry.attributes.position;
  let count = idx ? idx.count : (pos ? pos.count : 0);
  if (geometry.drawRange && Number.isFinite(geometry.drawRange.count)) count = Math.min(count, geometry.drawRange.count);
  if (group) count = Math.min(count, group.count);
  let inst = 1;
  if (object.isInstancedMesh) inst = object.count;
  else if (geometry.isInstancedBufferGeometry) inst = Math.min(geometry.instanceCount ?? Infinity, geometry._maxInstanceCount ?? Infinity);
  if (!Number.isFinite(inst)) inst = 1;
  const tris = object.isPoints ? 0 : object.isLine ? 0 : (count / 3) * inst;
  const key = label(object) + ' | ' + (material.name || material.type) + (material.transparent ? ' [T]' : '') + (object.isPoints ? ' [points ' + count + ']' : '');
  const row = rows.get(key) ?? { calls: 0, tris: 0 };
  row.calls += 1; row.tris += tris;
  rows.set(key, row);
  return orig.apply(this, arguments);
};
await new Promise((resolve) => {
  const session = gl.xr.getSession();
  const raf = session ? session.requestAnimationFrame.bind(session) : requestAnimationFrame;
  const tick = () => { frames += 1; if (frames >= FRAMES) resolve(); else raf(tick); };
  raf(tick);
});
gl.renderBufferDirect = orig;
const list = [...rows.entries()].map(([k, v]) => ({ k, calls: +(v.calls / FRAMES).toFixed(1), tris: Math.round(v.tris / FRAMES) })).sort((a, b) => b.calls - a.calls || b.tris - a.tris);
const total = list.reduce((a, r) => ({ calls: a.calls + r.calls, tris: a.tris + r.tris }), { calls: 0, tris: 0 });
const eyes = gl.xr.isPresenting ? gl.xr.getCamera().cameras.length : 1;
return `eyes=${eyes} perFrame calls=${total.calls.toFixed(1)} tris=${total.tris} rows=${list.length} ships=${__eod.session.world.ships?.length} programs=${gl.info.programs.length} tex=${gl.info.memory.textures} geo=${gl.info.memory.geometries}\n` + list.map((r) => `${String(r.calls).padStart(6)} ${String(r.tris).padStart(9)}  ${r.k}`).join('\n');
