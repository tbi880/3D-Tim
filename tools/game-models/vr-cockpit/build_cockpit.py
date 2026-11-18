"""
Builds the cockpit cabin and the VR flight stick for "Echoes of Dawn" (Blender 4.2, run headless):

    /Applications/Blender.app/Contents/MacOS/Blender -b --python build_cockpit.py -- [--only cockpit|stick] [--preview] [--no-bake]

Writes build/vr-cockpit.glb (the cabin of every first-person view, on a screen and in a
headset; first built for VR, hence the name) and build/vr-stick.glb (the flight stick shown in
place of each VR controller). With --preview it also renders build/preview-*.png from the
pilot's eye. The GLBs are then web-optimised with `npx gltfjsx --transform` (see README.md).

The cabin's frame is the game's cockpit frame, in three.js axes - the pilot's eye at the
origin, -z ahead, +y up, metres. The game draws the cabin `cabinScale` times larger
(src/game/scene/cockpitLayout.json), and that same file gives the place, tilt and size of the
flight display the dashboard's glass carries.

The cabin file holds three meshes, one draw call each:
    cabin   - every opaque surface, one material: its colour (with ambient occlusion and the
              wood's grain), its roughness / metalness and the glow the ambient lights cast
              on it are baked into one texture atlas. The game tints that glow with the
              ambient colour.
    lights  - the ambient light strips; u runs along each strip in metres (the game's light
              shader sends pulses along it).
    glass   - the tinted glass roof.
The stick is one mesh: its lights are part of it and shine through the same baked glow.

Faces of the cabin the pilot can never see (from anywhere the head can reach, HEAD_BOX) are
removed before the atlas is laid out, so no texture or triangle is spent on them.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, 'build')
LAYOUT = json.load(open(os.path.join(HERE, '..', '..', '..', 'src', 'game', 'scene', 'cockpitLayout.json')))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

# ---- The cabin's envelope --------------------------------------------------------------------
HALF_WIDTH = 2.375
FRONT_CENTRE_Z, FRONT_DEPTH = -0.69, 1.31      # the dashboard: half an ellipse ahead of the pilot
REAR_CENTRE_Z, REAR_DEPTH = 0.625, 0.94        # the rear wall: half an ellipse behind
FLOOR_Y, WAIST_Y, WALL_TOP_Y, ROOF_Y = -1.25, -0.6, 1.22, 1.6

# ---- Where the pilot's head can be (for removing faces that are never seen) ------------------
HEAD_BOX = [(-0.32, 0.0, 0.32), (-0.22, 0.05, 0.4), (-0.32, 0.0, 0.26)]

# ---- Surfaces: colour (sRGB hex), roughness, metalness ---------------------------------------
SURFACES = {
    'graphite': ('#17191e', 0.95, 0.0),    # soft-touch microfibre
    'pearl':    ('#bcab92', 0.5, 0.0),     # pearl nappa leather
    'midnight': ('#1d2538', 0.55, 0.0),    # midnight-blue nappa leather
    'wood':     ('#3a2618', 0.58, 0.0),    # open-pore walnut (its grain is painted by PATTERNS)
    'rose':     ('#c9a587', 0.28, 1.0),    # satin rose-champagne metal
    'shell':    ('#0c0e12', 0.3, 0.0),     # satin composite (seat shell, frame)
    'piano':    ('#050608', 0.1, 0.0),     # gloss black
    'screen':   ('#020304', 0.06, 0.0),    # display glass
    'carpet':   ('#121318', 1.0, 0.0),
    'lamp':     ('#000000', 0.4, 0.0),     # a light that is part of the surface (the stick's)
}
# Surfaces that carry no detail get fewer texels in the atlas.
PLAIN_SURFACES = {'carpet': 0.3, 'graphite': 0.7, 'piano': 0.7, 'screen': 0.5}
SMOOTH_ANGLE = math.radians(50)
# Baked glow: how bright a surface right beside a light strip gets (1 = full ambient colour),
# and the faint glow every surface keeps so the cabin still reads where no strip reaches.
GLOW_REFERENCE_PERCENTILE = 99.0
GLOW_FLOOR = 0.035

X = Vector((1, 0, 0))
UP = Vector((0, 1, 0))
BACK = Vector((0, 0, 1))


def V(x, y, z):
    return Vector((x, y, z))


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hex_linear(code):
    return srgb_to_linear([int(code[i:i + 2], 16) / 255 for i in (1, 3, 5)])


# ---- Geometry accumulators -------------------------------------------------------------------
class Mesh:
    """Faces in the model's frame, each with a surface name. `pattern` gives every vertex a
    place on its surface in metres (along, across), which patterned surfaces (wood) are painted by."""

    def __init__(self):
        self.verts, self.faces, self.surfaces, self.uvs, self.pattern = [], [], [], [], []

    def add(self, verts, faces, surface, pattern=None):
        base = len(self.verts)
        self.verts.extend(verts)
        self.pattern.extend(pattern or [(0.0, 0.0)] * len(verts))
        for face in faces:
            self.faces.append(tuple(base + i for i in face))
            self.surfaces.append(surface)


cabin = Mesh()        # the opaque body of the model being built
glass = Mesh()
lights = Mesh()       # the visible light strips
bake_lights = Mesh()  # what lights the bake: the strips lifted off their surfaces, and hidden emitters
# The bake lights each strip from this far above its surface, so its glow spreads round it
# as a soft halo (a strip lying flush would light almost nothing beside itself).
bake_lift = 0.02


def start_model(lift):
    """Empties the scene and the accumulators for the next model."""
    global cabin, glass, lights, bake_lights, bake_lift
    cabin, glass, lights, bake_lights, bake_lift = Mesh(), Mesh(), Mesh(), Mesh(), lift
    bpy.ops.wm.read_factory_settings(use_empty=True)


def loft(mesh, rows, surfaces, towards, closed=False, probe=None):
    """A skin over `rows` (stations x profile points). `surfaces[j]` is the surface of the
    band between profile points j and j+1 (None leaves it open). The winding is chosen so
    the band `probe` (station, band) faces `towards(point)`."""
    n, m = len(rows), len(rows[0])
    i0, j0 = probe or (n // 2, next(j for j, s in enumerate(surfaces) if s))
    a, b, c = rows[i0][j0], rows[i0][j0 + 1], rows[(i0 + 1) % n][j0]
    flip = (b - a).cross(c - a).dot(towards(a)) < 0
    by_surface = {}
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        for j in range(m - 1):
            if surfaces[j] is None:
                continue
            quad = (i * m + j, i * m + j + 1, i2 * m + j + 1, i2 * m + j)
            by_surface.setdefault(surfaces[j], []).append(quad[::-1] if flip else quad)
    verts = [p for row in rows for p in row]
    # Pattern coordinates: metres along the stations, metres across the profile.
    pattern, along = [], 0.0
    for i, row in enumerate(rows):
        if i > 0:
            along += (row[m // 2] - rows[i - 1][m // 2]).length
        across = 0.0
        for j, p in enumerate(row):
            if j > 0:
                across += (p - row[j - 1]).length
            pattern.append((along, across))
    for surface, faces in by_surface.items():
        used = sorted({i for face in faces for i in face})
        remap = {old: new for new, old in enumerate(used)}
        mesh.add([verts[i] for i in used], [tuple(remap[i] for i in face) for face in faces], surface, [pattern[i] for i in used])


def fan(mesh, centre, rim, surface, towards):
    """A flat cap: triangles from `centre` to each edge of `rim`, facing `towards`."""
    flip = (rim[0] - centre).cross(rim[1] - centre).dot(towards) < 0
    faces = [(0, 2 + i, 1 + i) if flip else (0, 1 + i, 2 + i) for i in range(len(rim) - 1)]
    mesh.add([centre] + rim, faces, surface)


def rbox(size, centre, surface, radius=0.0, rot_x=0.0, rot_y=0.0, matrix=None, mesh=None, segments=2):
    """A box with rounded edges, turned about x then y, then moved to `centre`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if radius > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, segments=segments, profile=0.5, affect='EDGES')
    bm.verts.index_update()
    transform = matrix or (Matrix.Translation(centre) @ Matrix.Rotation(rot_y, 4, 'Y') @ Matrix.Rotation(rot_x, 4, 'X'))
    # Pattern coordinates: along the box's longest side, across its second longest.
    along, across = sorted(range(3), key=lambda axis: -size[axis])[:2]
    (mesh or cabin).add([transform @ v.co for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces], surface,
                        [(v.co[along], v.co[across]) for v in bm.verts])
    bm.free()


def frame_between(p0, p1):
    """A frame whose y axis runs from p0 to p1, centred between them."""
    y = (p1 - p0).normalized()
    x = y.cross(BACK).normalized() if abs(y.z) < 0.99 else X.copy()
    frame = Matrix((x, y, x.cross(y))).transposed().to_4x4()
    frame.translation = (p0 + p1) / 2
    return frame


def beam(p0, p1, width, depth, surface, radius=0.0):
    """A bar from p0 to p1 (`width` across x-ish, `depth` the other way)."""
    rbox((width, (p1 - p0).length, depth), None, surface, radius, matrix=frame_between(p0, p1))


def ring(centre, axis, profile, surfaces, facing, segments=24, mesh=None):
    """A surface of revolution about `axis` through `centre`. `profile` is (radius, along the
    axis) points; `facing` says which way its first band faces: 'out' or 'in' (radially),
    'axis' or 'against' (along the axis or against it)."""
    axis = axis.normalized()
    side = axis.cross(UP) if abs(axis.dot(UP)) < 0.95 else axis.cross(X)
    side.normalize()
    other = side.cross(axis)
    rows = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        radial = side * math.cos(a) + other * math.sin(a)
        rows.append([centre + radial * r + axis * h for r, h in profile])

    def towards(p):
        radial = (p - centre) - axis * (p - centre).dot(axis)
        return {'out': radial, 'in': -radial, 'axis': axis, 'against': -axis}[facing]

    loft(mesh or cabin, rows, surfaces, towards, closed=True, probe=(0, 0))


def disc(centre, normal, radius, surface, segments=24, mesh=None):
    normal = normal.normalized()
    side = normal.cross(UP) if abs(normal.dot(UP)) < 0.95 else normal.cross(X)
    side.normalize()
    other = side.cross(normal)
    rim = [centre + (side * math.cos(2 * math.pi * i / segments) + other * math.sin(2 * math.pi * i / segments)) * radius for i in range(segments + 1)]
    fan(mesh or cabin, centre, rim, surface, normal)


def circle(centre, normal, radius, count=32):
    """Points of a circle, for a closed light strip."""
    normal = normal.normalized()
    side = normal.cross(UP) if abs(normal.dot(UP)) < 0.95 else normal.cross(X)
    side.normalize()
    other = side.cross(normal)
    return [centre + (side * math.cos(2 * math.pi * i / count) + other * math.sin(2 * math.pi * i / count)) * radius for i in range(count)]


def tube(path, half_width, half_height, surface, side=X):
    """A bar of rectangular section swept along `path` (which lies across `side`), capped."""
    rows, lifts = [], []
    for i, p in enumerate(path):
        tangent = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        lift = tangent.cross(side).normalized()
        a, b = side * half_width, lift * half_height
        rows.append([p - a - b, p + a - b, p + a + b, p - a + b, p - a - b])
        lifts.append(lift)
    middle = len(rows) // 2
    loft(cabin, rows, [surface] * 4, lambda p: -lifts[middle], probe=(middle, 0))
    fan(cabin, path[0], rows[0], surface, path[0] - path[1])
    fan(cabin, path[-1], rows[-1], surface, path[-1] - path[-2])


def quilt(frame, width, height, pitch, depth, surface, stretch=1.4, steps=3):
    """A diamond-quilted panel in the plane of `frame` (x across, y up, z out): pillows of
    `depth` between seams `pitch` apart. Built on the diamonds' own lattice, so every seam
    runs along edges of the mesh and stays crisp."""
    half_w, half_h = width / 2, height / 2
    reach = math.ceil(half_w / pitch + half_h / (stretch * pitch)) + 1
    index, verts, faces = {}, [], []

    def flat(i, j):
        a, b = i / steps, j / steps
        return pitch * (a + b) / 2, stretch * pitch * (a - b) / 2

    def vert(i, j):
        if (i, j) not in index:
            x, y = flat(i, j)
            a, b = (i / steps) % 1.0, (j / steps) % 1.0
            pillow = max(0.0, math.sin(math.pi * a) * math.sin(math.pi * b)) ** 0.4
            cx, cy = max(-half_w, min(half_w, x)), max(-half_h, min(half_h, y))
            # The pillows flatten out towards the panel's border.
            edge = min(half_w - abs(cx), half_h - abs(cy))
            index[(i, j)] = len(verts)
            verts.append(frame @ V(cx, cy, depth * pillow * min(1.0, edge / (pitch * 0.6))))
        return index[(i, j)]

    for i in range(-reach * steps, reach * steps):
        for j in range(-reach * steps, reach * steps):
            corners = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            if not any(abs(x) < half_w and abs(y) < half_h for x, y in (flat(*corner) for corner in corners)):
                continue
            face = [vert(*corner) for corner in corners]
            area = (verts[face[1]] - verts[face[0]]).cross(verts[face[2]] - verts[face[0]]).length \
                + (verts[face[2]] - verts[face[0]]).cross(verts[face[3]] - verts[face[0]]).length
            if area > 1e-9:
                faces.append(face)
    out = (frame.to_3x3() @ BACK)
    a, b, c = (verts[i] for i in faces[len(faces) // 2][:3])
    if (b - a).cross(c - a).dot(out) < 0:
        faces = [face[::-1] for face in faces]
    cabin.add(verts, faces, surface)


def quilted_pad(frame, width, height, pitch, depth, surface, piping='midnight', cord=0.011):
    """A quilted panel framed by a leather cord (which also covers the panel's ragged edge)."""
    quilt(frame, width, height, pitch, depth, surface)
    for x, y, w, h in ((0, height / 2, width + cord, cord), (0, -height / 2, width + cord, cord),
                       (width / 2, 0, cord, height + cord), (-width / 2, 0, cord, height + cord)):
        rbox((w, h, cord), None, piping, cord * 0.45, matrix=frame @ Matrix.Translation((x, y, cord * 0.35)))


def strip(points, normals, width, closed=False, lift=0.0015, mesh=None):
    """A flat light strip along `points`, facing `normals`; u = metres along it."""
    if mesh is None:
        strip(points, normals, width, closed, bake_lift, bake_lights)
        mesh = lights
    count = len(points)
    if closed:
        points = points + [points[0]]
        normals = normals + [normals[0]]
    verts, uvs, along = [], [], 0.0
    for i, (p, n) in enumerate(zip(points, normals)):
        before = points[i - 1] if i > 0 else (points[count - 1] if closed else p)
        after = points[i + 1] if i + 1 < len(points) else (points[1] if closed else p)
        if i > 0:
            along += (p - points[i - 1]).length
        n = n.normalized()
        side = (after - before).cross(n).normalized() * (width / 2)
        verts += [p + n * lift - side, p + n * lift + side]
        uvs += [(along, 0.0), (along, 1.0)]
    base = len(mesh.verts)
    mesh.verts.extend(verts)
    mesh.pattern.extend([(0.0, 0.0)] * len(verts))
    mesh.uvs.extend(uvs)
    for i in range(len(points) - 1):
        a = base + i * 2
        mesh.faces.append((a, a + 1, a + 3, a + 2))
        mesh.surfaces.append('light')


def catmull_rom(points, per_span=10):
    """Centripetal Catmull-Rom through `points`."""
    pts = [points[0] * 2 - points[1]] + list(points) + [points[-1] * 2 - points[-2]]
    out = []
    for k in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[k - 1], pts[k], pts[k + 1], pts[k + 2]
        t0 = 0.0
        t1 = t0 + max((p1 - p0).length, 1e-6) ** 0.5
        t2 = t1 + max((p2 - p1).length, 1e-6) ** 0.5
        t3 = t2 + max((p3 - p2).length, 1e-6) ** 0.5
        for s in range(per_span):
            t = t1 + (t2 - t1) * s / per_span
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            out.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
    out.append(points[-1].copy())
    return out


def inward(p):
    """Towards the vertical axis through the pilot's eye."""
    return V(-p.x, 0, -p.z)


# ---- The plan of the cabin: one closed loop round the pilot ------------------------------------
class Station:
    """A point of the cabin's outline: `w` is 1 dead ahead and 0 at the sides and behind."""

    def __init__(self, x, z, nx, nz, w, region):
        length = math.hypot(nx, nz)
        self.x, self.z, self.nx, self.nz, self.w, self.region = x, z, nx / length, nz / length, w, region

    def at(self, inset, y):
        return V(self.x + self.nx * inset, y, self.z + self.nz * inset)

    @property
    def normal(self):
        return V(self.nx, 0, self.nz)


def front_station(a):
    return Station(math.sin(a) * HALF_WIDTH, FRONT_CENTRE_Z - math.cos(a) * FRONT_DEPTH,
                   -math.sin(a) / HALF_WIDTH, math.cos(a) / FRONT_DEPTH, math.cos(a) ** 2, 'front')


def rear_station(b):
    return Station(math.sin(b) * HALF_WIDTH, REAR_CENTRE_Z + math.cos(b) * REAR_DEPTH,
                   -math.sin(b) / HALF_WIDTH, -math.cos(b) / REAR_DEPTH, 0.0, 'rear')


def outline(front=72, side=6, rear=48):
    stations = [front_station(-math.pi / 2 + math.pi * i / front) for i in range(front + 1)]
    for i in range(1, side):
        stations.append(Station(HALF_WIDTH, FRONT_CENTRE_Z + (REAR_CENTRE_Z - FRONT_CENTRE_Z) * i / side, -1, 0, 0.0, 'side'))
    stations += [rear_station(math.pi / 2 - math.pi * i / rear) for i in range(rear + 1)]
    for i in range(1, side):
        stations.append(Station(-HALF_WIDTH, REAR_CENTRE_Z + (FRONT_CENTRE_Z - REAR_CENTRE_Z) * i / side, 1, 0, 0.0, 'side'))
    return stations


OUTLINE = outline()


def dash_depth(w):
    """How far the dashboard reaches in from the shell: a ledge at the sides, deep ahead."""
    return 0.22 + 0.98 * w ** 1.5


def knee_kick(w):
    """How far the wall under the dashboard slants away from the pilot towards the floor."""
    return 0.08 + 0.27 * w


# ---- The tub: floor edge, knee wall, the layered dashboard edge, the dash top -----------------
# The wood band round the waist, bottom to top: (inset from the dash edge, height below the
# waist). Fine metal lines are inlaid along it at PINSTRIPES (fractions of its height).
WOOD_BAND = [(-0.022, -0.292), (0.010, -0.262), (0.024, -0.205), (0.018, -0.150), (-0.004, -0.115)]
PINSTRIPES = [0.2, 0.32, 0.44, 0.56, 0.68, 0.8]
PINSTRIPE_WIDTH = 0.016


def wood_band_profile():
    """The band's profile points with their surfaces: wood, with a metal line at every pinstripe."""
    lengths = [0.0]
    for (a, b), (c, d) in zip(WOOD_BAND, WOOD_BAND[1:]):
        lengths.append(lengths[-1] + math.hypot(c - a, d - b))

    def at(t):
        target = t * lengths[-1]
        k = max(i for i in range(len(WOOD_BAND) - 1) if lengths[i] <= target + 1e-9)
        f = (target - lengths[k]) / (lengths[k + 1] - lengths[k])
        return tuple(WOOD_BAND[k][axis] + (WOOD_BAND[k + 1][axis] - WOOD_BAND[k][axis]) * f for axis in (0, 1))

    cuts = {length / lengths[-1]: 'wood' for length in lengths[:-1]}
    for stripe in PINSTRIPES:
        cuts[stripe] = 'rose'
        cuts[stripe + PINSTRIPE_WIDTH] = 'wood'
    return [(*at(t), cuts[t]) for t in sorted(cuts)]


def build_tub():
    y = WAIST_Y
    band = wood_band_profile()
    rows, surfaces = [], None
    for s in OUTLINE:
        d, k = dash_depth(s.w), knee_kick(s.w)
        profile = [
            (d - k + 0.10, FLOOR_Y + 0.002, 'piano'),      # gloss border round the carpet
            (d - k + 0.035, FLOOR_Y + 0.004, 'graphite'),  # cove (the footwell light sits here)
            (d - k + 0.008, FLOOR_Y + 0.03, 'graphite'),
            (d - k, FLOOR_Y + 0.07, 'graphite'),           # knee wall
            (d - 0.05, y - 0.30, 'graphite'),
            *[(d + inset, y + below, surface) for inset, below, surface in band],   # the wood band
            (d - 0.004, y - 0.115, 'piano'),               # the shadow gap that holds the waist light
            (d - 0.030, y - 0.108, 'piano'),
            (d - 0.045, y - 0.104, 'piano'),
            (d - 0.045, y - 0.072, 'rose'),                # the metal blade over the gap
            (d - 0.004, y - 0.068, 'rose'),
            (d + 0.006, y - 0.056, 'rose'),
            (d + 0.002, y - 0.040, 'rose'),
            (d - 0.012, y - 0.034, 'midnight'),            # the padded leather top edge
            (d - 0.035, y - 0.012, 'midnight'),
            (d - 0.075, y - 0.001, 'midnight'),
            (d - 0.12, y, 'midnight'),                     # the dash top
            ((d - 0.12 + 0.08) / 2, y + 0.012 * s.w, 'midnight'),
            (0.08, y, 'piano'),                            # the cowl at the canopy's foot
            (0.055, y + 0.04, 'piano'),
            (0.02, y + 0.052, 'piano'),
            (0.0, y + 0.045, None),
        ]
        rows.append([s.at(inset, height) for inset, height, _ in profile])
        surfaces = [surface for _, _, surface in profile[:-1]]
    cowl_from = len(surfaces) - 3
    loft(cabin, [row[:cowl_from + 1] for row in rows], surfaces[:cowl_from], inward, closed=True, probe=(10, 3))
    # The cowl runs along the front and the sides, and stops where the rear wall starts.
    regions = [s.region for s in OUTLINE]
    first_rear, last_rear = regions.index('rear'), len(regions) - 1 - regions[::-1].index('rear')
    cowl = rows[last_rear:] + rows[:first_rear + 1]
    loft(cabin, [row[cowl_from:] for row in cowl], ['piano'] * 3, inward, probe=(len(cowl) // 2, 0))

    # The carpet, inside the gloss border.
    rim = [row[0] for row in rows]
    fan(cabin, V(0, FLOOR_Y + 0.002, -0.3), rim + rim[:1], 'carpet', UP)

    # Ambient light: the waist line in the shadow gap and the footwell line, both closed loops.
    strip([s.at(dash_depth(s.w) - 0.045, y - 0.088) for s in OUTLINE], [s.normal for s in OUTLINE], 0.024, closed=True)
    strip([s.at(dash_depth(s.w) - knee_kick(s.w) + 0.02, FLOOR_Y + 0.017) for s in OUTLINE],
          [s.normal * 0.7 + UP * 0.7 for s in OUTLINE], 0.02, closed=True)
    # A fine inlaid line across the dash top, ahead of the pilot only.
    ahead = [s for s in OUTLINE if s.region == 'front' and s.w > 0.3]
    strip([s.at(dash_depth(s.w) - 0.2, y + 0.012 * s.w * 0.35) for s in ahead], [UP] * len(ahead), 0.008, lift=0.003)

    # A turbine air vent set into the wood band either side of the pilot, proud of the wood
    # like a small jet nacelle (its barrel ends just in front of the band). The display glass
    # carries two more at its tips (build_display).
    for angle in (-1.25, 1.25):
        station = front_station(angle)
        turbine_vent(station.at(dash_depth(station.w) + 0.066, WAIST_Y - 0.2), station.normal)


def turbine_vent(centre, axis):
    """A round air vent facing along `axis`: a metal bezel, turbine blades round a hub, and a
    ring of light inside. Its face is at `centre`; the barrel reaches 36 mm behind it."""
    ring(centre, axis, [(0.071, -0.07), (0.070, 0.012), (0.060, 0.016), (0.055, 0.007), (0.055, -0.036)],
         ['rose', 'rose', 'rose', 'piano'], 'out')
    disc(centre - axis * 0.036, axis, 0.055, 'piano')
    ring(centre, axis, [(0.018, -0.036), (0.018, 0.006), (0.013, 0.011)], ['rose', 'rose'], 'out', segments=16)
    disc(centre + axis * 0.011, axis, 0.013, 'rose', segments=16)
    side = axis.cross(UP).normalized()
    upward = side.cross(axis)
    blades = 10
    for k in range(blades):
        a = 2 * math.pi * k / blades
        radial = side * math.cos(a) + upward * math.sin(a)
        tangent = axis.cross(radial)
        # Each blade is a thin plate along a radius, pitched like a turbine's.
        thickness = (axis * math.cos(0.75) + tangent * math.sin(0.75)).normalized()
        frame = Matrix((radial, thickness, radial.cross(thickness))).transposed().to_4x4()
        frame.translation = centre + radial * 0.036 - axis * 0.012
        rbox((0.036, 0.0016, 0.02), None, 'rose', matrix=frame)
    strip(circle(centre - axis * 0.034, axis, 0.047), [axis] * 32, 0.009, closed=True)


# ---- The rear wall: padded midnight-blue panels between light slots ---------------------------
PANELS = 9


def build_rear_wall():
    per_panel = 10
    rows, slots = [], []
    for i in range(PANELS * per_panel + 1):
        t = i / (PANELS * per_panel)
        u = (t * PANELS) % 1.0
        s = rear_station(math.pi / 2 - math.pi * t)
        edge = min(u, 1 - u) * per_panel            # 0 at a slot, 1 one station away from it
        pad = 0.085 if edge < 0.5 else 0.06 - 0.03 * math.sin(math.pi * u) ** 0.6
        profile = [
            (0.09, WAIST_Y - 0.01, 'rose'),          # the waist rail
            (0.075, WAIST_Y + 0.03, 'rose'),
            (pad + 0.012, WAIST_Y + 0.055, 'midnight'),
            (pad, WAIST_Y + 0.12, 'midnight'),
            (pad - 0.008 * (edge >= 0.5), 0.17, 'rose'),  # a metal belt through the panels
            (pad - 0.012 * (edge >= 0.5), 0.2, 'midnight'),
            (pad, 0.9, 'midnight'),
            (pad + 0.012, 0.965, 'graphite'),
            (0.05, 1.0, 'piano'),                    # the gloss band under the roof
            (0.04, WALL_TOP_Y - 0.03, 'piano'),
            (0.0, WALL_TOP_Y, None),
        ]
        surfaces = [surface for _, _, surface in profile[:-1]]
        rows.append([s.at(inset, height) for inset, height, _ in profile])
        if edge < 0.5 and 0 < i < PANELS * per_panel:
            slots.append(s)
    loft(cabin, rows, surfaces, inward, probe=(5, 3))
    for s in slots:
        strip([s.at(0.085, WAIST_Y + 0.09), s.at(0.085, 0.5), s.at(0.085, 0.93)], [s.normal] * 3, 0.014)
    # The roof-edge light along the gloss band.
    arc = [rear_station(math.pi / 2 - math.pi * i / 48) for i in range(49)]
    strip([s.at(0.045, 1.1) for s in arc], [s.normal for s in arc], 0.014)
    # Glass: the band between the wall and the roof, and the roof itself.
    loft(glass, [[s.at(0.0, WALL_TOP_Y), s.at(0.0, ROOF_Y)] for s in arc], ['glass'], inward)
    fan(glass, V(0, ROOF_Y, REAR_CENTRE_Z), [s.at(0.0, ROOF_Y) for s in arc], 'glass', -UP)


# ---- The canopy frame: the rear arch and two roof rails ---------------------------------------
def build_canopy():
    arch = [V(x, y, REAR_CENTRE_Z) for x, y in [
        (-HALF_WIDTH, FLOOR_Y), (-HALF_WIDTH, 0.2), (-HALF_WIDTH, 1.19), (-2.15, 1.525), (-1.75, ROOF_Y),
        (0, ROOF_Y), (1.75, ROOF_Y), (2.15, 1.525), (HALF_WIDTH, 1.19), (HALF_WIDTH, 0.2), (HALF_WIDTH, FLOOR_Y)]]
    rail = [(2.325, -0.56, -1.19), (2.25, 0.125, -1.0), (2.0, 0.94, -0.56), (1.65, 1.425, 0.06), (1.5, ROOF_Y, REAR_CENTRE_Z)]
    paths = [(catmull_rom(arch, 8), 0.075)] + [(catmull_rom([V(x * side, y, z) for x, y, z in rail], 10), 0.05) for side in (-1, 1)]
    for path, half in paths:
        rows, centres, normals = [], [], []
        for i, p in enumerate(path):
            tangent = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            eye = (-p - tangent * (-p).dot(tangent)).normalized()
            side = tangent.cross(eye)
            rows.append([p - side * (half + 0.03) - eye * 0.03, p - side * half + eye * 0.03,
                         p + side * half + eye * 0.03, p + side * (half + 0.03) - eye * 0.03])
            centres.append(p + eye * 0.03)
            normals.append(eye)
        loft(cabin, rows, ['piano', 'shell', 'piano'], lambda p: -p, probe=(len(rows) // 2, 1))
        strip(centres, normals, 0.014)


# ---- The seat (human size), its pedestal and the dais ----------------------------------------
BACK_TILT = 0.14


def build_seat():
    tilt = Matrix.Rotation(BACK_TILT, 4, 'X')

    def back(local, centre):
        """A point of the backrest: `local` turned by the backrest's tilt, about `centre`."""
        return tilt.to_3x3() @ Vector(local) + Vector(centre)

    # Cushion: composite pan, pearl leather bolsters, a diamond-quilted centre.
    rbox((0.62, 0.09, 0.60), (0, -0.815, -0.02), 'shell', 0.035)
    for side in (-1, 1):
        rbox((0.11, 0.13, 0.56), (0.255 * side, -0.735, -0.03), 'pearl', 0.045)
    rbox((0.40, 0.06, 0.52), (0, -0.745, -0.03), 'pearl', 0.02)
    quilted_pad(Matrix.Translation((0, -0.714, -0.03)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), 0.36, 0.48, 0.06, 0.012, 'pearl')

    # Backrest: gloss shell, pearl bolsters, a diamond-quilted centre.
    rbox((0.58, 0.80, 0.06), (0, -0.32, 0.39), 'piano', 0.028, rot_x=BACK_TILT)
    for side in (-1, 1):
        rbox((0.12, 0.66, 0.15), (0.25 * side, -0.36, 0.30), 'pearl', 0.05, rot_x=BACK_TILT)
    rbox((0.40, 0.62, 0.05), back((0, 0, -0.03), (0, -0.34, 0.345)), 'pearl', 0.02, rot_x=BACK_TILT)
    quilted_pad(Matrix.Translation(back((0, 0, -0.056), (0, -0.34, 0.345))) @ tilt @ Matrix.Rotation(math.pi, 4, 'Y'),
                0.36, 0.56, 0.06, 0.012, 'pearl')

    # Metal blades down the edges of the backrest shell.
    for side in (-1, 1):
        rbox((0.014, 0.56, 0.075), back((0.297 * side, 0.02, 0.0), (0, -0.32, 0.375)), 'rose', 0.004, rot_x=BACK_TILT)

    # Headrest: a soft pearl pillow in a gloss shell on two metal posts.
    rbox((0.34, 0.24, 0.05), (0, 0.24, 0.435), 'piano', 0.022, rot_x=0.1)
    rbox((0.29, 0.19, 0.08), (0, 0.24, 0.385), 'pearl', 0.036, rot_x=0.1, segments=3)
    for side in (-1, 1):
        rbox((0.022, 0.14, 0.022), (0.08 * side, 0.09, 0.41), 'rose', 0.005)

    # Armrests: a quilted pearl pad over a wood inlay, and a glass touch pad at the front.
    # (No stick or throttle here: the pilot holds those, see build_stick.)
    for side in (-1, 1):
        x = 0.42 * side
        rbox((0.12, 0.045, 0.46), (x, -0.512, 0.03), 'graphite', 0.02)
        quilted_pad(Matrix.Translation((x, -0.4885, 0.07)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), 0.08, 0.32, 0.04, 0.006, 'pearl', cord=0.008)
        rbox((0.126, 0.014, 0.50), (x, -0.538, 0.01), 'wood', 0.005)
        rbox((0.105, 0.04, 0.52), (x, -0.562, 0.0), 'shell', 0.016)
        beam(V(0.33 * side, -0.80, 0.08), V(0.40 * side, -0.56, 0.08), 0.05, 0.14, 'rose', 0.012)
        rbox((0.10, 0.012, 0.11), (x, -0.4895, -0.155), 'screen', 0.004)
        rbox((0.108, 0.01, 0.118), (x, -0.4925, -0.155), 'rose', 0.004)
        strip(circle(V(x, -0.4835, -0.155), UP, 0.03), [UP] * 32, 0.004, closed=True, lift=0.0008)
        strip([V(x - 0.012, -0.4835, -0.155), V(x + 0.012, -0.4835, -0.155)], [UP] * 2, 0.004, lift=0.0008)
        # Light along the armrest's inner edge.
        strip([V(x - 0.058 * side, -0.5, z) for z in (-0.19, 0.0, 0.24)], [V(-side * 0.8, 0.6, 0)] * 3, 0.007)

    # Light piping down each backrest bolster and across the headrest.
    for side in (-1, 1):
        strip([back((0, -0.27 + 0.54 * i / 8, -0.0755), (0.25 * side, -0.36, 0.30)) for i in range(9)],
              [back((0, 0, -1), (0, 0, 0))] * 9, 0.008)
    strip([V(x, 0.128, 0.352) for x in (-0.11, 0, 0.11)], [V(0, -0.3, -1)] * 3, 0.007)

    # Pedestal, the plate under the cushion, and the dais it stands on.
    rbox((0.50, 0.025, 0.50), (0, -0.872, -0.02), 'rose', 0.01)
    ring(V(0, FLOOR_Y + 0.03, 0.0), UP, [(0.15, 0.0), (0.10, 0.36)], ['rose'], 'out', segments=20)
    dais = 0.62
    ring(V(0, FLOOR_Y, 0), UP, [(dais + 0.03, 0.003), (dais, 0.035), (0.12, 0.035)], ['rose', 'piano'], 'out', segments=48)
    strip(circle(V(0, FLOOR_Y + 0.003, 0), UP, dais + 0.06, 64), [UP] * 64, 0.02, closed=True)
    # Hidden emitter: a glow under the cushion.
    strip(circle(V(0, -0.88, -0.02), UP, 0.2, 64), [-UP] * 64, 0.03, closed=True, mesh=bake_lights)
    # Two light lines in the floor, from the dais to the footwell.
    for side in (-1, 1):
        strip([V(0.26 * side, FLOOR_Y + 0.003, -0.70), V(0.30 * side, FLOOR_Y + 0.003, -0.9), V(0.36 * side, FLOOR_Y + 0.003, -1.08)], [UP] * 3, 0.012)


# ---- The display glass (the game draws the flight display on its middle) and its binnacle ----
# One band of glass across the dashboard: flat where the game draws the flight display, with
# a wing either side that curves round towards the pilot.
GLASS_MARGIN = 0.035        # glass beyond the picture, above and below
GLASS_WING = 0.56           # length of each wing, metres along the glass
GLASS_WING_TURN = 0.52      # how far a wing has turned towards the pilot at its tip, radians
GLASS_BEHIND = 0.004        # the glass sits this far behind the picture


def build_display():
    display = LAYOUT['display']
    width, height = display['meters']
    tilt = Matrix.Rotation(display['tilt'], 4, 'X')
    normal = (tilt @ Vector((0, 0, 1, 0))).to_3d()
    up = (tilt @ Vector((0, 1, 0, 0))).to_3d()
    centre = Vector(display['position']) - normal * GLASS_BEHIND
    flat_half = width / 2 + 0.04
    half_height = height / 2 + GLASS_MARGIN
    reach = flat_half + GLASS_WING
    radius = GLASS_WING / GLASS_WING_TURN

    def frame_at(s):
        """The glass's frame `s` metres along it from its middle (x along, y up it, z out of it)."""
        side = 1 if s >= 0 else -1
        turn = max(0.0, abs(s) - flat_half) / radius
        plan = V(side * (min(abs(s), flat_half) + radius * math.sin(turn)), 0, radius * (1 - math.cos(turn)))
        return Matrix.Translation(centre + plan) @ Matrix.Rotation(-side * turn, 4, 'Y') @ tilt

    # Stations along the glass: the wings, the flat middle, and a rounded end at each tip.
    round_from = reach - half_height
    wing = [flat_half + (round_from - flat_half) * (i + 1) / 10 for i in range(10)]
    tip = [(round_from + half_height * math.sin(b), math.cos(b)) for b in np.linspace(0.2, 1.42, 7)]
    stations = [(s, 1.0) for s in wing] + tip
    stations = [(-s, k) for s, k in reversed(stations)] + [(-flat_half, 1.0), (flat_half, 1.0)] + stations
    rows = []
    for s, narrowing in stations:
        h = half_height * narrowing
        frame = frame_at(s)
        rows.append([frame @ V(0, v, w) for v, w in ((-h - 0.008, -0.024), (-h - 0.008, -0.004), (-h - 0.002, 0.0),
                                                      (h + 0.002, 0.0), (h + 0.008, -0.004), (h + 0.008, -0.024))])
    loft(cabin, rows, ['rose', 'rose', 'screen', 'rose', 'rose'], lambda p: normal, probe=(len(rows) // 2, 2))
    for row, outwards in ((rows[0], -1), (rows[-1], 1)):
        fan(cabin, sum(row, Vector()) / len(row), row + row[:1], 'rose', (frame_at(outwards * reach) @ Vector((outwards, 0, 0, 0))).to_3d())
    # A turbine vent stands out of each rounded tip of the glass.
    for side in (-1, 1):
        frame = frame_at(side * round_from)
        turbine_vent(frame @ V(0, 0, 0.04), (frame @ Vector((0, 0, 1, 0))).to_3d())

    # The binnacle under the middle of the glass: a leather pod with a wood face and a metal line.
    foot = centre - up * (half_height + 0.008) - normal * 0.012
    top = foot.y - 0.002
    rbox((1.0, 0.27, 0.30), (0, top - 0.135, -0.72), 'midnight', 0.04)
    rbox((0.90, 0.12, 0.03), (0, top - 0.135, -0.566), 'wood', 0.012)
    rbox((0.94, 0.012, 0.02), (0, top - 0.055, -0.566), 'rose', 0.004)
    beam(foot + V(0, -0.02, -0.06), centre - normal * 0.04, 0.3, 0.04, 'rose', 0.012)
    # A glow line under the glass.
    strip([V(x, top + 0.001, foot.z + 0.018) for x in (-0.37, 0, 0.37)], [V(0, 0.8, 0.6)] * 3, 0.007)

    # What the wings show: level bars on the left, a compass ring on the right.
    for side in (-1, 1):
        frame = frame_at(side * (flat_half + 0.2))
        c, n = frame.translation, (frame @ Vector((0, 0, 1, 0))).to_3d()
        r, u = (frame @ Vector((1, 0, 0, 0))).to_3d(), (frame @ Vector((0, 1, 0, 0))).to_3d()
        if side < 0:
            for i, length in enumerate((0.20, 0.14, 0.22, 0.10, 0.17)):
                y = 0.058 - i * 0.029
                strip([c + r * -0.1 + u * y, c + r * (-0.1 + length * 0.9) + u * y], [n] * 2, 0.009)
        else:
            strip([c + r * math.cos(a) * 0.062 + u * math.sin(a) * 0.062 for a in np.linspace(0, 2 * math.pi, 33)[:-1]], [n] * 32, 0.006, closed=True)
            strip([c + r * math.cos(a) * 0.036 + u * math.sin(a) * 0.036 for a in np.linspace(0.6, 4.2, 14)], [n] * 14, 0.008)
            for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
                d = r * math.cos(a) + u * math.sin(a)
                strip([c + d * 0.07, c + d * 0.084], [n] * 2, 0.005)


# ---- The flight stick the pilot holds (drawn in place of each VR controller) -----------------
def build_stick():
    """A wireless flight stick, in WebXR's grip space: the hand closes round the z axis, the
    thumb end of the fist is at -z, the fingers wrap round -y and +y faces the pilot.
    Symmetric left to right, so one model serves both hands. Real size (not scaled with the cabin)."""
    def light(points, normals, width, closed=False):
        strip(points, normals, width, closed, lift=0.0005)

    # The grip: soft-touch core, a pearl leather pad under the palm, a wood inlay under the fingers.
    rbox((0.034, 0.040, 0.104), (0, 0, 0.024), 'graphite', 0.015, segments=3)
    rbox((0.024, 0.008, 0.078), (0, 0.0185, 0.026), 'pearl', 0.0035)
    rbox((0.014, 0.006, 0.066), (0, -0.0195, 0.032), 'wood', 0.0025)
    for side in (-1, 1):
        light([V(0.0172 * side, 0.002, z) for z in (-0.012, 0.03, 0.066)], [X * side] * 3, 0.0022)

    # The head: a gloss housing leaning towards the thumb, with a glass thumb pad ringed in light.
    lean = -0.5
    head = Matrix.Translation((0, 0.006, -0.05)) @ Matrix.Rotation(lean, 4, 'X')
    rbox((0.046, 0.05, 0.042), None, 'piano', 0.017, matrix=head, segments=3)
    face = (head @ Vector((0, 1, 0, 0))).to_3d()
    pad = head @ V(0, 0.0252, -0.002)
    ring(pad, face, [(0.0185, -0.004), (0.0185, 0.0012), (0.0165, 0.002)], ['rose', 'rose'], 'out', segments=20)
    disc(pad + face * 0.0016, face, 0.0166, 'screen', segments=20)
    light(circle(pad + face * 0.0016, face, 0.0125, 24), [face] * 24, 0.0018, closed=True)
    light(circle(pad + face * 0.0016, face, 0.004, 12), [face] * 12, 0.002, closed=True)
    # A metal collar where the head meets the grip, and a cap on the head's top.
    rbox((0.04, 0.046, 0.006), (0, 0.001, -0.027), 'rose', 0.0025)
    crown = head @ V(0, 0, -0.0215)
    top = (head @ Vector((0, 0, -1, 0))).to_3d()
    ring(crown, top, [(0.014, -0.002), (0.014, 0.0015), (0.011, 0.0025)], ['rose', 'rose'], 'out', segments=16)
    disc(crown + top * 0.0025, top, 0.011, 'piano', segments=16)

    # The trigger under the forefinger.
    beam(V(0, -0.0225, -0.04), V(0, -0.031, -0.014), 0.012, 0.007, 'rose', 0.003)

    # The guard: a blade of metal sweeping from the head round the knuckles to the foot, with a
    # line of light along its outer face.
    guard = catmull_rom([V(0, -0.02, -0.066), V(0, -0.05, -0.052), V(0, -0.066, -0.01), V(0, -0.064, 0.04), V(0, -0.046, 0.078), V(0, -0.02, 0.09)], 7)
    tube(guard, 0.0055, 0.0028, 'rose')
    outer = []
    for i, p in enumerate(guard):
        tangent = (guard[min(i + 1, len(guard) - 1)] - guard[max(i - 1, 0)]).normalized()
        outward = tangent.cross(X).normalized()
        outer.append(outward if outward.y < 0 else -outward)
    light([p + n * 0.0028 for p, n in zip(guard, outer)][3:-3], outer[3:-3], 0.003)

    # The foot: a metal collar, and below it a ring of light that floats free of the stick -
    # the link to the ship, since nothing else joins them.
    ring(V(0, 0, 0.076), BACK, [(0.0215, 0.0), (0.0215, 0.007), (0.017, 0.011)], ['rose', 'rose'], 'out', segments=20)
    disc(V(0, 0, 0.087), BACK, 0.017, 'piano', segments=20)
    light(circle(V(0, 0, 0.087), BACK, 0.011, 20), [BACK] * 20, 0.003, closed=True)
    halo = V(0, 0, 0.101)
    ring(halo, BACK, [(0.024, -0.003), (0.03, -0.003), (0.032, 0.0), (0.03, 0.003), (0.024, 0.003), (0.022, 0.0), (0.024, -0.003)],
         ['rose'] * 6, 'against', segments=28)
    points = circle(halo, BACK, 0.032, 28)
    light(points, [p - halo for p in points], 0.0026, closed=True)
    light(circle(halo - BACK * 0.003, BACK, 0.027, 28), [-BACK] * 28, 0.0024, closed=True)


# ---- Into Blender ----------------------------------------------------------------------------
def to_blender(p):
    return (p.x, -p.z, p.y)


def make_object(name, mesh, surfaces):
    data = bpy.data.meshes.new(name)
    data.from_pydata([to_blender(p) for p in mesh.verts], [], mesh.faces)
    slots = {surface: i for i, surface in enumerate(surfaces)}
    for surface in surfaces:
        data.materials.append(bpy.data.materials.get(surface) or bpy.data.materials.new(surface))
    data.polygons.foreach_set('material_index', [slots[s] for s in mesh.surfaces])
    data.polygons.foreach_set('use_smooth', [True] * len(data.polygons))
    vertex_of_loop = [loop.vertex_index for loop in data.loops]

    def uv_layer(layer_name, values):
        layer = data.uv_layers.new(name=layer_name)
        layer.data.foreach_set('uv', np.array([values[v] for v in vertex_of_loop], dtype=np.float32).ravel())
        return layer

    if mesh.uvs:
        uv_layer('UVMap', mesh.uvs)
    else:
        # 'atlas' is laid out later (unwrap) and is what the textures use; 'pattern' only
        # places painted surfaces during the bake and is dropped before export.
        atlas = uv_layer('atlas', mesh.pattern)
        uv_layer('pattern', mesh.pattern)
        data.uv_layers.active = atlas
        atlas.active_render = True
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def edit(obj, change):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    change(bm)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def crease(bm):
    """Smooth shading, with a hard edge wherever two faces meet sharply."""
    for edge in bm.edges:
        edge.smooth = len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) < SMOOTH_ANGLE


def head_points():
    xs, ys, zs = HEAD_BOX
    return [V(x, y, z) for x in xs for y in ys for z in zs]


def remove_unseen(obj, occluder, two_sided=False):
    """Deletes the faces of `obj` no head position can see (occluded by `occluder`, or facing away)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(occluder, depsgraph)
    eyes = [Vector(to_blender(p)) for p in head_points()]

    def cull(bm):
        hidden = []
        for face in bm.faces:
            centre = face.calc_center_median()
            samples = [centre] + [centre.lerp(v.co, 0.85) for v in face.verts]
            samples += [centre.lerp((a.co + b.co) / 2, 0.85) for a, b in zip(face.verts, list(face.verts)[1:] + [face.verts[0]])]
            seen = False
            for p in samples:
                start = p + face.normal * 4e-4
                for eye in eyes:
                    ray = eye - start
                    if not two_sided and ray.dot(face.normal) <= 0:
                        continue
                    distance = ray.length
                    if tree.ray_cast(start, ray / distance, distance - 1e-3)[0] is None:
                        seen = True
                        break
                if seen:
                    break
            if not seen:
                hidden.append(face)
        before = len(bm.faces)
        bmesh.ops.delete(bm, geom=hidden, context='FACES')
        print(f'[cull] {obj.name}: {before} -> {len(bm.faces)} faces')

    edit(obj, cull)


def select_only(obj):
    for other in bpy.context.scene.objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def unwrap(obj, near_first):
    """One atlas for the whole body. With `near_first`, islands nearer the pilot get more texels."""
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    def weigh(bm):
        bm.faces.ensure_lookup_table()
        bm.faces.index_update()
        uv = bm.loops.layers.uv['atlas']
        parent = list(range(len(bm.faces)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        owner = {}
        for face in bm.faces:
            for loop in face.loops:
                key = (loop.vert.index, round(loop[uv].uv.x, 5), round(loop[uv].uv.y, 5))
                if key in owner:
                    parent[find(face.index)] = find(owner[key])
                else:
                    owner[key] = face.index
        islands = {}
        for face in bm.faces:
            islands.setdefault(find(face.index), []).append(face)
        for faces in islands.values():
            weight = PLAIN_SURFACES.get(obj.material_slots[faces[0].material_index].material.name, 1.0)
            if near_first:
                nearest = min(face.calc_center_median().length for face in faces)
                weight *= min(1.6, max(0.45, 1.0 / max(nearest, 0.1)))
            loops = [loop for face in faces for loop in face.loops]
            centre = sum((loop[uv].uv for loop in loops), Vector((0, 0))) / len(loops)
            for loop in loops:
                loop[uv].uv = centre + (loop[uv].uv - centre) * weight
        print(f'[uv] {len(islands)} islands')

    edit(obj, weigh)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')


# ---- Materials and baking --------------------------------------------------------------------
def emission_material(material, colour, strength=1.0):
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeEmission')
    shader.inputs['Color'].default_value = (*colour, 1)
    shader.inputs['Strength'].default_value = strength
    links.new(shader.outputs[0], out.inputs['Surface'])
    return nodes


def principled_material(material, colour, roughness, metallic, alpha=1.0):
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Base Color'].default_value = (*colour, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Alpha'].default_value = alpha
    links.new(shader.outputs[0], out.inputs['Surface'])
    return nodes, shader


def paint_wood(material):
    """Open-pore walnut as a colour: long streaks of grain along the surface, darker pores."""
    nodes = emission_material(material, (0, 0, 0))
    links = material.node_tree.links
    place = nodes.new('ShaderNodeUVMap')
    place.uv_map = 'pattern'

    def noise(scale, detail, stretch):
        mapping = nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = stretch
        links.new(place.outputs['UV'], mapping.inputs['Vector'])
        node = nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Distortion'].default_value = 0.6
        links.new(mapping.outputs['Vector'], node.inputs['Vector'])
        return node.outputs['Fac']

    def ramp(source, stops):
        node = nodes.new('ShaderNodeValToRGB')
        for element, (position, colour) in zip(node.color_ramp.elements, stops):
            element.position = position
            element.color = (*colour, 1)
        links.new(source, node.inputs['Fac'])
        return node.outputs['Color']

    grain = ramp(noise(3.0, 5.0, (0.8, 46.0, 1.0)), [(0.32, hex_linear('#23150c')), (0.72, hex_linear('#5b3a22'))])
    pores = ramp(noise(2.0, 3.0, (5.0, 380.0, 1.0)), [(0.42, (0.5, 0.5, 0.5)), (0.6, (1.0, 1.0, 1.0))])
    mix = nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1.0
    links.new(grain, mix.inputs['Color1'])
    links.new(pores, mix.inputs['Color2'])
    links.new(mix.outputs['Color'], nodes['Emission'].inputs['Color'])
    return nodes


# Surfaces whose colour is painted instead of flat.
PATTERNS = {'wood': paint_wood}


def bake_target(nodes, image):
    node = nodes.new('ShaderNodeTexImage')
    node.image = image
    node.select = True
    nodes.active = node


def new_image(name, size):
    image = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    return image


def pixels(image):
    data = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(image.size[1], image.size[0], 4)[..., :3].astype(np.float64)


def resize(array, size):
    """Box-filters a square image down to `size`."""
    factor = array.shape[0] // size
    return array if factor == 1 else array.reshape(size, factor, size, factor, -1).mean(axis=(1, 3))


def save_png(name, array, srgb):
    """Writes build/<name>.png from values in 0..1 (already encoded as they should be stored)."""
    size = array.shape[0]
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(array, 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = os.path.join(BUILD, f'{name}.png')
    image.file_format = 'PNG'
    image.save()
    return image


def use_cycles():
    """Cycles on the CPU: headless Blender 4.2 sometimes crashes compiling its Metal (GPU)
    kernels, and the whole bake is a few minutes on the CPU anyway."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'


def bake(name, body, emitters, atlas, light_atlas, occlusion_reach):
    """Bakes the body's three textures: colour (with occlusion), roughness / metalness, glow."""
    scene = bpy.context.scene
    use_cycles()
    scene.cycles.use_denoising = False
    scene.world = bpy.data.worlds.new('dark')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    select_only(body)
    materials = [slot.material for slot in body.material_slots]

    def run(kind, size, samples, setup, **options):
        image = new_image(kind, size)
        for material in materials:
            bake_target(setup(material), image)
        scene.cycles.samples = samples
        bpy.ops.object.bake(type=options.pop('type'), margin=12, use_clear=True, **options)
        print(f'[bake] {name} {kind}')
        return pixels(image)

    def surface(material):
        code, roughness, metallic = SURFACES[material.name]
        return hex_linear(code), roughness, metallic

    def paint(material):
        return PATTERNS[material.name](material) if material.name in PATTERNS else emission_material(material, surface(material)[0])

    emitters.hide_render = True
    colour = run('colour', atlas, 1, paint, type='EMIT')
    orm = run('orm', atlas, 1, lambda m: emission_material(m, (1.0, surface(m)[1], surface(m)[2])), type='EMIT')
    lamp = run('lamp', light_atlas, 1, lambda m: emission_material(m, (1, 1, 1) if m.name == 'lamp' else (0, 0, 0)), type='EMIT')
    scene.world.light_settings.distance = occlusion_reach
    occlusion = run('occlusion', atlas, 96, lambda m: principled_material(m, (0.8, 0.8, 0.8), 1.0, 0.0)[0], type='AO')
    emitters.hide_render = False
    emission_material(emitters.material_slots[0].material, (1, 1, 1), 6.0)
    glow = run('glow', light_atlas, 384, lambda m: principled_material(m, (0.6, 0.6, 0.6), 1.0, 0.0)[0],
               type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})

    # Colour: the surface colour, darkened where the model shades itself.
    shade = 0.25 + 0.75 * occlusion[..., :1] ** 1.1
    base = colour * shade
    # Glow: what the ambient strips cast on each surface (in the surface's own colour, plus a
    # little sheen on glossy ones), soft-clipped, over a faint floor. Lamps glow fully.
    colour_small, orm_small = resize(colour, light_atlas), resize(orm, light_atlas)
    irradiance = glow.mean(axis=2, keepdims=True)
    lit = irradiance[irradiance > 1e-5]
    reference = np.percentile(lit, GLOW_REFERENCE_PERCENTILE) if lit.size else 1.0
    level = 1 - np.exp(-2.2 * irradiance / reference)
    sheen = 0.05 * (1 - orm_small[..., 1:2]) ** 2
    emissive = (colour_small + sheen) * (GLOW_FLOOR + (1 - GLOW_FLOOR) * level) * resize(shade, light_atlas) ** 0.5
    emissive = np.maximum(emissive, lamp)
    print(f'[bake] {name} glow reference {reference:.4f}, mean level {level.mean():.3f}')
    return (save_png(f'{name}-colour', linear_to_srgb(base), True),
            save_png(f'{name}-orm', orm, False),
            save_png(f'{name}-glow', linear_to_srgb(emissive), True))


def texture_node(nodes, image):
    node = nodes.new('ShaderNodeTexImage')
    node.image = image
    return node


def textured_material(name, body, images):
    """The body's one material: the three baked textures."""
    colour, orm, glow = images
    material = bpy.data.materials.new(name)
    nodes, shader = principled_material(material, (1, 1, 1), 1, 0)
    links = material.node_tree.links
    links.new(texture_node(nodes, colour).outputs['Color'], shader.inputs['Base Color'])
    split = nodes.new('ShaderNodeSeparateColor')
    links.new(texture_node(nodes, orm).outputs['Color'], split.inputs['Color'])
    links.new(split.outputs['Green'], shader.inputs['Roughness'])
    links.new(split.outputs['Blue'], shader.inputs['Metallic'])
    links.new(texture_node(nodes, glow).outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = 1.0
    material.use_backface_culling = True
    body.data.materials.clear()
    body.data.materials.append(material)
    body.data.polygons.foreach_set('material_index', [0] * len(body.data.polygons))


def light_and_glass_materials(light_obj, glass_obj):
    # The strips carry their brightness across the strip (v) as a small texture: bright along
    # the middle, soft towards the edges. (It also keeps their UVs through web optimisation,
    # which drops the UVs of untextured materials.)
    across = np.linspace(-1, 1, 32)
    profile = np.repeat((0.12 + 0.88 * np.clip(1.25 - np.abs(across) ** 2 * 1.25, 0, 1))[:, None, None], 3, axis=2)
    profile = np.repeat(profile, 32, axis=1)
    light = light_obj.material_slots[0].material
    light.name = 'ambientLight'
    nodes, shader = principled_material(light, (0, 0, 0), 1, 0)
    light.node_tree.links.new(texture_node(nodes, save_png('light-profile', profile, True)).outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = 1.0
    light.use_backface_culling = True

    pane = glass_obj.material_slots[0].material
    principled_material(pane, hex_linear('#a9c8ff'), 0.08, 0.2, alpha=0.1)
    pane.blend_method = 'BLEND'
    pane.use_backface_culling = True


def preview(tag):
    """Renders the cabin from the pilot's eye in a few directions (build/preview-*.png)."""
    scene = bpy.context.scene
    use_cycles()
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1100, 800
    world = bpy.data.worlds.new('preview')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.012, 0.014, 0.02, 1)
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 1.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(150))
    scene.collection.objects.link(sun)
    camera = bpy.data.objects.new('eye', bpy.data.cameras.new('eye'))
    camera.data.lens_unit = 'FOV'
    camera.data.angle = math.radians(100)
    camera.data.clip_start = 0.01
    scene.collection.objects.link(camera)
    scene.camera = camera
    views = {'ahead': (-22, 0), 'down': (-62, 0), 'left': (-15, 75), 'right-back': (-5, -140), 'up-back': (40, 160)}
    for name, (pitch, yaw) in views.items():
        # Blender camera looks down its -Z; the pilot looks along +Y here (three's -z).
        camera.rotation_euler = (math.radians(90 + pitch), 0, math.radians(yaw))
        scene.render.filepath = os.path.join(BUILD, f'preview-{tag}-{name}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(sun)
    bpy.data.objects.remove(camera)


def finish(name, body_name, in_cabin, atlas, light_atlas, occlusion_reach):
    """Turns the accumulated geometry into build/<name>.glb.
    `in_cabin`: the model is seen from the pilot's seat only - unseen faces are removed, nearer
    surfaces get more texels, and the lights and glass are meshes of their own. Otherwise the
    lights become part of the body (surface 'lamp')."""
    if not in_cabin:
        cabin.add(lights.verts, lights.faces, 'lamp')
    body = make_object(body_name, cabin, list(SURFACES))
    emitters = make_object('bakeLights', bake_lights, ['light'])
    extras = [make_object('lights', lights, ['light']), make_object('glass', glass, ['glass'])] if in_cabin else []
    if in_cabin:
        for layer in list(extras[1].data.uv_layers):   # the glass has no texture
            extras[1].data.uv_layers.remove(layer)
    for obj in (body, emitters, *extras):
        edit(obj, crease)
        obj.hide_render = obj is not body
    edit(body, lambda bm: bmesh.ops.triangulate(bm, faces=bm.faces[:]))

    for surface, (code, roughness, metallic) in SURFACES.items():
        principled_material(bpy.data.materials[surface], hex_linear(code), roughness, metallic)
    emission_material(bpy.data.materials['light'], (0.25, 0.48, 1.0), 4.0)
    if '--preview' in ARGS and in_cabin:
        extras[0].hide_render = False
        preview(name)
        extras[0].hide_render = True

    if in_cabin:
        remove_unseen(body, body)
        remove_unseen(extras[0], body)
    triangles = sum(len(p.vertices) - 2 for obj in (body, *extras) for p in obj.data.polygons)
    print(f'[build] {name}: {triangles} triangles')

    if '--no-bake' not in ARGS:
        unwrap(body, near_first=in_cabin)
        images = bake(name, body, emitters, atlas, light_atlas, occlusion_reach)
        textured_material(body_name, body, images)
        if in_cabin:
            light_and_glass_materials(*extras)
    body.data.uv_layers.remove(body.data.uv_layers['pattern'])
    bpy.data.objects.remove(emitters)
    for obj in bpy.context.scene.objects:
        obj.hide_render = False
        obj.select_set(obj in (body, *extras))
    bpy.ops.export_scene.gltf(filepath=os.path.join(BUILD, f'{name}.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_image_format='AUTO')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, f'{name}.blend'))
    print(f'[build] wrote build/{name}.glb')


def main():
    os.makedirs(BUILD, exist_ok=True)
    only = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else None
    if only in (None, 'cockpit'):
        start_model(lift=0.02)
        build_tub()
        build_rear_wall()
        build_canopy()
        build_seat()
        build_display()
        finish('vr-cockpit', 'cabin', in_cabin=True, atlas=2048, light_atlas=1024, occlusion_reach=0.9)
    if only in (None, 'stick'):
        start_model(lift=0.004)
        build_stick()
        finish('vr-stick', 'stick', in_cabin=False, atlas=1024, light_atlas=512, occlusion_reach=0.04)


main()
