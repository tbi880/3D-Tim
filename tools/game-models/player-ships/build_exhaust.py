"""
Builds speed-dependent engine exhaust for one player ship in Blender and exports it as an
FX-only GLB (merged into the original model afterwards by merge_exhaust.mjs).

Env: SHIP (key in exhaust_specs.json), SPECS (path), OUTDIR.

Thrust levels follow src/game/scene/ShipsLayer.jsx (getThrust):
    0.15 idle (throttle 0) .. 1.0 at max speed, 1.6 with the afterburner.
Plume length follows the game's old cone: (1.2 + 6 * thrust), normalised so that full
throttle is `len_frac` of the ship's length.
"""
import bpy, json, os, math, random
from mathutils import Vector, Matrix
import numpy as np
from PIL import Image

SHIP = os.environ['SHIP']
SPEC = json.load(open(os.environ['SPECS']))[SHIP]
OUTDIR = os.environ['OUTDIR']
os.makedirs(OUTDIR, exist_ok=True)

FPS = 30
LOOP_FRAMES = 60          # 2 s loops; every flicker frequency is a whole number of cycles
N_AROUND = 40
STATES = {'Idle': 0.15, 'Cruise': 0.575, 'Full': 1.0, 'Boost': 1.6}
FLICKER = {  # amplitude, cycles per loop
    'Idle': (0.10, (2, 5, 9)),
    'Cruise': (0.06, (3, 7, 11)),
    'Full': (0.05, (4, 9, 13)),
    'Boost': (0.075, (6, 11, 17)),
}
AX = {'x': 0, 'y': 1, 'z': 2}
BAND_V = {'core': 8 / 48, 'plume': 24 / 48, 'halo': 40 / 48}

# ---------------------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SPEC['rest'])
scene = bpy.context.scene
scene.render.fps = FPS
ship_objects = list(scene.objects)
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'

d = Vector(SPEC['dir']).normalized()
D = max(range(3), key=lambda i: abs(d[i]))
A, B = AX[SPEC['A']], AX[SPEC['B']]
# Nozzle frame: +Z along the exhaust, X along plane axis A, Y completes a right-handed frame.
X_l = Vector([1.0 if i == A else 0.0 for i in range(3)])
Y_l = d.cross(X_l).normalized()
FRAME = Matrix((X_l, Y_l, d)).transposed()   # columns


def plane_point(a, b, depth):
    p = [0.0, 0.0, 0.0]
    p[A], p[B], p[D] = a, b, depth
    return Vector(p)


# ---------------------------------------------------------------------------- 2D helpers
def hull(points):
    pts = sorted(set((round(x, 5), round(y, 5)) for x, y in points))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def poly_area_centroid(poly):
    a = cx = cy = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        c = x0 * y1 - x1 * y0
        a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    a *= 0.5
    return abs(a), (cx / (6 * a), cy / (6 * a))


def star_sample(poly, centre, n=N_AROUND):
    """Boundary point of a convex polygon in each of n directions from its centre."""
    out = []
    for k in range(n):
        th = 2 * math.pi * k / n
        dx, dy = math.cos(th), math.sin(th)
        best = None
        for i in range(len(poly)):
            x0, y0 = poly[i][0] - centre[0], poly[i][1] - centre[1]
            x1, y1 = poly[(i + 1) % len(poly)][0] - centre[0], poly[(i + 1) % len(poly)][1] - centre[1]
            ex, ey = x1 - x0, y1 - y0
            den = dx * ey - dy * ex
            if abs(den) < 1e-12:
                continue
            t = (x0 * ey - y0 * ex) / den
            s = (x0 * dy - y0 * dx) / den
            if t > 0 and -1e-9 <= s <= 1 + 1e-9 and (best is None or t < best):
                best = t
        out.append((dx * best, dy * best))
    return out


def shape_points(nz):
    s = nz['shape']
    if s == 'poly':
        return [tuple(p) for p in nz['pts']]
    if s == 'ellipse':
        cx, cy = nz['c']
        return [(cx + nz['rx'] * math.cos(t), cy + nz['ry'] * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 64, endpoint=False)]
    if s == 'rrect':
        cx, cy = nz['c']; w, h, r = nz['w'] / 2, nz['h'] / 2, nz['r']
        pts = []
        for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
            ox, oy = cx + qx * (w - r), cy + qy * (h - r)
            for a in np.linspace(a0, a0 + 90, 6):
                pts.append((ox + r * math.cos(math.radians(a)), oy + r * math.sin(math.radians(a))))
        return pts
    raise ValueError(s)


depsgraph = bpy.context.evaluated_depsgraph_get()
bb = [o.matrix_world @ Vector(c) for o in ship_objects if o.type == 'MESH' for c in o.bound_box]
far = max(v.dot(d) for v in bb) + 5.0


def raycast_depth(poly, centre):
    samples = [centre] + [((centre[0] + p[0]) / 2, (centre[1] + p[1]) / 2) for p in poly[:: max(1, len(poly) // 4)]]
    hits = []
    for a, b in samples:
        origin = plane_point(a, b, 0)
        origin[D] = far * d[D]
        ok, loc, *_ = scene.ray_cast(depsgraph, origin, -d)
        if ok:
            hits.append(loc[D])
    if not hits:
        raise RuntimeError('nozzle ray missed the hull')
    return float(np.median(hits)), hits


# ---------------------------------------------------------------------------- nozzles
nozzles = []
for nz in SPEC['nozzles']:
    if nz['shape'] == 'mesh_hull':
        ob = bpy.data.objects[nz['object']]
        verts = [ob.matrix_world @ v.co for v in ob.data.vertices]
        verts = [v for v in verts if v[A] * nz['side'] > 0]
        if 'vside' in nz:
            verts = [v for v in verts if (v[B] - nz['vsplit']) * nz['vside'] > 0]
        proj = [v.dot(d) for v in verts]
        ext = max(proj) if nz['face'] == 'max' else min(proj)
        verts = [v for v, p in zip(verts, proj) if abs(p - ext) < nz['slab']]
        poly = hull([(v[A], v[B]) for v in verts])
        depth = ext * d[D]
        info = f'mesh face {depth:.3f}'
    else:
        poly = hull(shape_points(nz))
        area, centre = poly_area_centroid(poly)
        if 'depth' in nz:
            depth, info = nz['depth'], 'fixed depth'
        else:
            depth, hits = raycast_depth(poly, centre)
            info = f'ray hits {[round(h, 3) for h in hits]}'
    area, centre = poly_area_centroid(poly)
    fit = nz.get('fit', 1.0)
    poly = [(centre[0] + (x - centre[0]) * fit, centre[1] + (y - centre[1]) * fit) for x, y in poly]
    area *= fit * fit
    r_eff = math.sqrt(area / math.pi)
    origin = plane_point(centre[0], centre[1], depth) - d * (0.04 * r_eff)   # start just inside the nozzle
    # outline in the nozzle's local XY plane
    star = star_sample(poly, centre)
    local = []
    for a, b in star:
        w = plane_point(centre[0] + a, centre[1] + b, depth) - plane_point(centre[0], centre[1], depth)
        local.append((w.dot(X_l), w.dot(Y_l)))
    nozzles.append(dict(name=nz['name'], origin=origin, outline=local, r_eff=r_eff, fac=nz['fac']))
    print(f"NOZZLE {nz['name']}: centre {tuple(round(c, 3) for c in origin)} r_eff {r_eff:.3f} {info}")

# ---------------------------------------------------------------------------- texture + material
def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


hot, eng = np.array(SPEC['hot']), np.array(SPEC['engine'])
W_TEX, H_TEX = 256, 48
t = (np.arange(W_TEX) + 0.5) / W_TEX
img = np.zeros((H_TEX, W_TEX, 4))
core_c = hot[None] * (1 - smoothstep(0.12, 0.95, t))[:, None] + eng[None] * smoothstep(0.12, 0.95, t)[:, None]
core_a = (1 - t) ** 1.8
plume_mix = hot * 0.22 + eng * 0.78
plume_c = (plume_mix[None] * (1 - smoothstep(0, 0.8, t))[:, None] + (eng * 0.85)[None] * smoothstep(0, 0.8, t)[:, None]) * 0.75
plume_a = 0.5 * (1 - t) ** 2.4
halo_c = np.repeat((eng * 0.42)[None], W_TEX, 0)
halo_a = 0.18 * (1 - t) ** 2.5
for rows, c, a in ((range(0, 16), core_c, core_a), (range(16, 32), plume_c, plume_a), (range(32, 48), halo_c, halo_a)):
    for r in rows:
        img[r, :, :3] = srgb(c)
        img[r, :, 3] = a
# PIL rows go top-down, Blender's v goes bottom-up: flip so band v-centres line up.
tex_path = os.path.join(OUTDIR, f'{SHIP}_exhaust_gradient.png')
Image.fromarray((np.flipud(img) * 255 + 0.5).astype(np.uint8), 'RGBA').save(tex_path)

image = bpy.data.images.load(tex_path)
image.name = f'FX_{SHIP}_gradient'
mat = bpy.data.materials.new(f'FX_Exhaust_{SHIP}')
try:
    mat.use_nodes = True
except Exception:
    pass
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = image; tex.extension = 'EXTEND'; tex.interpolation = 'Linear'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = SPEC['strength']
bsdf.inputs['Roughness'].default_value = 1.0
bsdf.inputs['Metallic'].default_value = 0.0
if 'Specular IOR Level' in bsdf.inputs:
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND'), ('use_backface_culling', False)):
    try:
        setattr(mat, attr, val)
    except Exception:
        pass

# ---------------------------------------------------------------------------- meshes
RINGS = [0, 0.03, 0.08, 0.15, 0.25, 0.37, 0.5, 0.63, 0.76, 0.88, 0.96]


def width_profile(t, bulge):
    return (1 + bulge * math.sin(0.5 * math.pi * min(t / 0.3, 1))) * max(0.0, 1 - t ** 1.4) ** 0.7


def morph(t):
    x = min(max((t - 0.05) / 0.65, 0), 1)
    return 0.9 * x * x * (3 - 2 * x)


def plume_mesh(name, outline, r_eff, inset, bulge, band, cap=False):
    n = len(outline)
    circle = [(r_eff * math.cos(2 * math.pi * k / n), r_eff * math.sin(2 * math.pi * k / n)) for k in range(n)]
    verts, uvs_v, faces = [], [], []
    for t in RINGS:
        w, m = width_profile(t, bulge) * inset, morph(t)
        for k in range(n):
            x = (outline[k][0] * (1 - m) + circle[k][0] * m) * w
            y = (outline[k][1] * (1 - m) + circle[k][1] * m) * w
            verts.append((x, y, t)); uvs_v.append(t)
    tip = len(verts); verts.append((0, 0, 1.0)); uvs_v.append(1.0)
    for j in range(len(RINGS) - 1):
        for k in range(n):
            a, b = j * n + k, j * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    last = (len(RINGS) - 1) * n
    for k in range(n):
        faces.append((last + k, last + (k + 1) % n, tip))
    if cap:
        faces.append(tuple(reversed(range(n))))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = (uvs_v[me.loops[li].vertex_index], band)
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return me


def shock_mesh(name, outline, band):
    verts, faces, us = [], [], []
    n = len(outline)
    for i, (t0, s) in enumerate(((0.15, 0.42), (0.31, 0.36), (0.47, 0.30))):
        h = 0.035
        front = len(verts); verts.append((0, 0, t0 - h)); us.append(0.02)
        ring = len(verts)
        for k in range(n):
            verts.append((outline[k][0] * s, outline[k][1] * s, t0)); us.append(0.05)
        back = len(verts); verts.append((0, 0, t0 + h)); us.append(0.12)
        for k in range(n):
            a, b = ring + k, ring + (k + 1) % n
            faces.append((front, b, a)); faces.append((a, b, back))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = (us[me.loops[li].vertex_index], band)
    me.materials.append(mat)
    return me


root = bpy.data.objects.new('FX_Exhaust', None)
scene.collection.objects.link(root)
fx_objects = [root]
layers_by_nozzle = []
for i, nz in enumerate(nozzles):
    pivot = bpy.data.objects.new(f'FX_Nozzle_{nz["name"]}', None)
    pivot.empty_display_size = nz['r_eff']
    scene.collection.objects.link(pivot)
    pivot.parent = root
    pivot.matrix_world = Matrix.Translation(nz['origin']) @ FRAME.to_4x4()
    fx_objects.append(pivot)
    layers = {}
    for key, inset, bulge, band, cap in (('core', 0.55, 0.05, BAND_V['core'], True),
                                         ('plume', 0.92, 0.14, BAND_V['plume'], False),
                                         ('halo', 1.08, 0.25, BAND_V['halo'], False)):
        me = plume_mesh(f'FX_{key}_{nz["name"]}', nz['outline'], nz['r_eff'], inset, bulge, band, cap)
        ob = bpy.data.objects.new(f'FX_{key.capitalize()}_{nz["name"]}', me)
        scene.collection.objects.link(ob); ob.parent = pivot
        layers[key] = ob; fx_objects.append(ob)
    me = shock_mesh(f'FX_shock_{nz["name"]}', nz['outline'], BAND_V['core'])
    ob = bpy.data.objects.new(f'FX_Shock_{nz["name"]}', me)
    scene.collection.objects.link(ob); ob.parent = pivot
    layers['shock'] = ob; fx_objects.append(ob)
    layers_by_nozzle.append((nz, layers))


# ---------------------------------------------------------------------------- animation
def layer_scales(nz, T):
    Lp = SPEC['ship_len'] * SPEC['len_frac'] * nz['fac'] * (1.2 + 6 * T) / 7.2
    lo, b = min(T, 1.0), min(max((T - 1.0) / 0.6, 0.0), 1.0)
    Wp = 0.80 + 0.20 * lo + 0.12 * b
    return {
        'plume': (Wp, Lp),
        'core': (0.85 + 0.15 * lo + 0.06 * b, Lp * (0.30 + 0.14 * lo + 0.10 * b)),
        'halo': (Wp * (1 + 0.10 * lo + 0.12 * b), Lp * 0.72),
        'shock': (max(b, 0.001), Lp),
    }


GAIN = {'plume': (1.0, 0.35), 'core': (1.3, 0.30), 'halo': (0.8, 0.5), 'shock': (1.0, 0.35)}


def noise(f, cycles, phases):
    w = (0.5, 0.3, 0.2)
    return sum(wi * math.sin(2 * math.pi * c * f / LOOP_FRAMES + p) for wi, c, p in zip(w, cycles, phases))


def push(ob, clip, keys):
    ad = ob.animation_data or ob.animation_data_create()
    act = bpy.data.actions.new(f'{clip}__{ob.name}')
    ad.action = act
    for frame, s in keys:
        ob.scale = s
        ob.keyframe_insert(data_path='scale', frame=frame)
    slot = getattr(ad, 'action_slot', None)
    ad.action = None
    track = ad.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, 0, act)
    if slot is not None and hasattr(strip, 'action_slot'):
        try:
            strip.action_slot = slot
        except Exception:
            pass


rng = random.Random(7)
for nz, layers in layers_by_nozzle:
    phases = {key: [rng.uniform(0, 2 * math.pi) for _ in range(6)] for key in layers}
    for clip, T in STATES.items():
        amp, cycles = FLICKER[clip]
        sc = layer_scales(nz, T)
        for key, ob in layers.items():
            w, L = sc[key]
            gz, gxy = GAIN[key]
            ph = phases[key if key != 'shock' else 'plume']
            keys = []
            for f in range(0, LOOP_FRAMES + 1, 2):
                nzv = noise(f, cycles, ph[:3]); nxy = noise(f, cycles, ph[3:])
                s_xy = w * (1 + amp * gxy * nxy) if key != 'shock' else w
                keys.append((f, (s_xy, s_xy, L * (1 + amp * gz * nzv))))
            push(ob, f'Exhaust_{clip}', keys)
    # Scrub clip: time in seconds == thrust (0 .. 1.6), no flicker.
    for key, ob in layers.items():
        keys = []
        for k in range(17):
            T = k / 10
            w, L = layer_scales(nz, T)[key]
            keys.append((T * FPS, (w, w, L)))
        push(ob, 'Exhaust_Thrust', keys)
    # Rest pose (no clip playing): steady cruise.
    for key, ob in layers.items():
        w, L = layer_scales(nz, STATES['Cruise'])[key]
        ob.scale = (w, w, L)

scene.frame_start, scene.frame_end = 0, 60

# ---------------------------------------------------------------------------- save + export
blend_path = os.path.join(OUTDIR, f'{SHIP}_exhaust.blend')
bpy.ops.object.select_all(action='DESELECT')
for ob in fx_objects:
    ob.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUTDIR, f'{SHIP}_fx.glb'), export_format='GLB', use_selection=True,
    export_yup=True, export_animations=True, export_animation_mode='NLA_TRACKS',
    export_merge_animation='NLA_TRACK', export_optimize_animation_size=False,
    export_anim_slide_to_zero=False, export_force_sampling=False, export_materials='EXPORT',
    export_image_format='AUTO',
)
image.pack()
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
json.dump({'nozzles': [{'name': n['name'], 'origin': list(n['origin']), 'r_eff': n['r_eff']} for n in nozzles]},
          open(os.path.join(OUTDIR, f'{SHIP}_nozzles.json'), 'w'), indent=1)
print('BUILT', SHIP, len(nozzles), 'nozzles')
