"""
Builds the VR cockpit cabin for "Echoes of Dawn" (Blender 4.2, run headless):

    /Applications/Blender.app/Contents/MacOS/Blender -b --python build_cockpit.py -- [--preview] [--no-bake]

Writes build/vr-cockpit.glb (and, with --preview, build/preview-*.png seen from the pilot's eye).
The GLB is then web-optimised with `npx gltfjsx vr-cockpit.glb --transform` (see README.md).

Frame: the game's cockpit frame, in three.js axes - the pilot's eye at the origin, -z ahead,
+y up, metres. The game draws the cabin `cabinScale` times larger (src/game/xr/cockpitLayout.json),
and that same file gives the place, tilt and size of the flight display the dashboard carries.

The file holds three meshes, one draw call each:
    cabin   - every opaque surface, one material: its colour (with ambient occlusion), its
              roughness / metalness and the glow the ambient lights cast on it are baked into
              one texture atlas. The game tints that glow with the ambient colour.
    lights  - the ambient light strips; u runs along each strip in metres (the game's light
              shader sends pulses along it).
    glass   - the tinted glass roof.

Faces the pilot can never see (from anywhere the head can reach, HEAD_BOX) are removed
before the atlas is laid out, so no texture or triangle is spent on them.
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
LAYOUT = json.load(open(os.path.join(HERE, '..', '..', '..', 'src', 'game', 'xr', 'cockpitLayout.json')))
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
    'pearl':    ('#b9a88f', 0.55, 0.0),    # pearl leather
    'midnight': ('#1d2538', 0.6, 0.0),     # midnight-blue leather (the rear wall's pads)
    'titanium': ('#b9a98f', 0.32, 1.0),    # satin champagne titanium
    'shell':    ('#0c0e12', 0.3, 0.0),     # satin composite (seat shell, frame)
    'piano':    ('#050608', 0.1, 0.0),     # gloss black
    'screen':   ('#020304', 0.06, 0.0),    # display glass
    'carpet':   ('#121318', 1.0, 0.0),
}
# Surfaces that carry no detail get fewer texels in the atlas.
PLAIN_SURFACES = {'carpet': 0.3, 'graphite': 0.7, 'piano': 0.7, 'screen': 0.5}
SMOOTH_ANGLE = math.radians(50)
ATLAS = 2048
LIGHT_ATLAS = 1024
# Baked glow: how bright a surface right beside a light strip gets (1 = full ambient colour),
# and the faint glow every surface keeps so the cabin still reads where no strip reaches.
GLOW_REFERENCE_PERCENTILE = 99.0
GLOW_FLOOR = 0.035

X = Vector((1, 0, 0))
UP = Vector((0, 1, 0))


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
    """Triangles/quads in the cockpit frame, each face with a surface name."""

    def __init__(self):
        self.verts, self.faces, self.surfaces, self.uvs = [], [], [], []

    def add(self, verts, faces, surface):
        base = len(self.verts)
        self.verts.extend(verts)
        for face in faces:
            self.faces.append(tuple(base + i for i in face))
            self.surfaces.append(surface)


cabin = Mesh()
glass = Mesh()
lights = Mesh()       # the visible light strips
bake_lights = Mesh()  # extra emitters that only light the bake (hidden from the pilot)


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
    for surface, faces in by_surface.items():
        used = sorted({i for face in faces for i in face})
        remap = {old: new for new, old in enumerate(used)}
        mesh.add([verts[i] for i in used], [tuple(remap[i] for i in face) for face in faces], surface)


def rbox(size, centre, surface, radius=0.0, rot_x=0.0, rot_y=0.0, matrix=None, mesh=None, segments=2):
    """A box with rounded edges, turned about x then y, then moved to `centre`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if radius > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, segments=segments, profile=0.5, affect='EDGES')
    bm.verts.index_update()
    transform = matrix or (Matrix.Translation(centre) @ Matrix.Rotation(rot_y, 4, 'Y') @ Matrix.Rotation(rot_x, 4, 'X'))
    (mesh or cabin).add([transform @ v.co for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces], surface)
    bm.free()


def beam(p0, p1, width, depth, surface, radius=0.0):
    """A bar from p0 to p1 (`width` across x-ish, `depth` the other way)."""
    axis = p1 - p0
    y = axis.normalized()
    x = y.cross(V(0, 0, 1)).normalized() if abs(y.z) < 0.99 else X.copy()
    z = x.cross(y)
    frame = Matrix((x, y, z)).transposed().to_4x4()
    frame.translation = (p0 + p1) / 2
    rbox((width, axis.length, depth), None, surface, radius, matrix=frame)


def cylinder(centre_bottom, radius, height, surface, segments=20, top=True, radius_top=None):
    r1 = radius if radius_top is None else radius_top
    rows = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        d = V(math.cos(a), 0, math.sin(a))
        rows.append([centre_bottom + d * radius, centre_bottom + d * r1 + UP * height])
    loft(cabin, rows, [surface], lambda p: V(p.x - centre_bottom.x, 0, p.z - centre_bottom.z), closed=True)
    if top:
        rim = [row[1] for row in rows]
        fan(cabin, centre_bottom + UP * height, rim + rim[:1], surface, UP)


def fan(mesh, centre, rim, surface, towards):
    """A flat cap: triangles from `centre` to each edge of `rim`, facing `towards`."""
    flip = (rim[0] - centre).cross(rim[1] - centre).dot(towards) < 0
    faces = [(0, 2 + i, 1 + i) if flip else (0, 1 + i, 2 + i) for i in range(len(rim) - 1)]
    mesh.add([centre] + rim, faces, surface)


# The bake lights each strip from this far above its surface, so its glow spreads round it
# as a soft halo (a strip lying flush would light almost nothing beside itself).
BAKE_LIFT = 0.02


def strip(points, normals, width, closed=False, lift=0.0015, mesh=None):
    """A flat light strip along `points`, facing `normals`; u = metres along it."""
    if mesh is None:
        strip(points, normals, width, closed, BAKE_LIFT, bake_lights)
        mesh = lights
    start = 0.0
    count = len(points)
    if closed:
        points = points + [points[0]]
        normals = normals + [normals[0]]
    verts, uvs, along = [], [], start
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
def build_tub():
    y = WAIST_Y
    rows, surfaces = [], None
    for s in OUTLINE:
        d, k = dash_depth(s.w), knee_kick(s.w)
        profile = [
            (d - k + 0.10, FLOOR_Y + 0.002, 'piano'),      # gloss border round the carpet
            (d - k + 0.035, FLOOR_Y + 0.004, 'graphite'),  # cove (the footwell light sits here)
            (d - k + 0.008, FLOOR_Y + 0.03, 'graphite'),
            (d - k, FLOOR_Y + 0.07, 'graphite'),           # knee wall
            (d - 0.05, y - 0.30, 'graphite'),
            (d - 0.022, y - 0.292, 'pearl'),               # the pearl leather roll
            (d + 0.010, y - 0.262, 'pearl'),
            (d + 0.024, y - 0.205, 'pearl'),
            (d + 0.018, y - 0.150, 'pearl'),
            (d - 0.004, y - 0.115, 'piano'),               # the shadow gap that holds the waist light
            (d - 0.030, y - 0.108, 'piano'),
            (d - 0.045, y - 0.104, 'piano'),
            (d - 0.045, y - 0.072, 'titanium'),            # the titanium blade over the gap
            (d - 0.004, y - 0.068, 'titanium'),
            (d + 0.006, y - 0.056, 'titanium'),
            (d + 0.002, y - 0.040, 'titanium'),
            (d - 0.012, y - 0.034, 'graphite'),            # the padded top edge
            (d - 0.035, y - 0.012, 'graphite'),
            (d - 0.075, y - 0.001, 'graphite'),
            (d - 0.12, y, 'graphite'),                     # the dash top
            ((d - 0.12 + 0.08) / 2, y + 0.012 * s.w, 'graphite'),
            (0.08, y, 'piano'),                            # the cowl at the canopy's foot
            (0.055, y + 0.04, 'piano'),
            (0.02, y + 0.052, 'piano'),
            (0.0, y + 0.045, None),
        ]
        rows.append([s.at(inset, height) for inset, height, _ in profile])
        surfaces = [surface for _, _, surface in profile[:-1]]
    loft(cabin, [row[:22] for row in rows], surfaces[:21], inward, closed=True, probe=(10, 3))
    # The cowl runs along the front and the sides, and stops where the rear wall starts.
    regions = [s.region for s in OUTLINE]
    first_rear, last_rear = regions.index('rear'), len(regions) - 1 - regions[::-1].index('rear')
    cowl = rows[last_rear:] + rows[:first_rear + 1]
    loft(cabin, [row[21:] for row in cowl], ['piano'] * 3, inward, probe=(len(cowl) // 2, 0))

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


# ---- The rear wall: padded midnight-blue panels between light slots ----------------------------------
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
            (0.09, WAIST_Y - 0.01, 'titanium'),      # the waist rail
            (0.075, WAIST_Y + 0.03, 'titanium'),
            (pad + 0.012, WAIST_Y + 0.055, 'midnight'),
            (pad, WAIST_Y + 0.12, 'midnight'),
            (pad - 0.008 * (edge >= 0.5), 0.17, 'titanium'),  # a titanium belt through the panels
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
    def back(local, centre):
        """A point of the backrest: `local` turned by the backrest's tilt, about `centre`."""
        return Matrix.Rotation(BACK_TILT, 3, 'X') @ Vector(local) + Vector(centre)

    # Cushion: composite pan, graphite bolsters, six pearl ribs.
    rbox((0.62, 0.09, 0.60), (0, -0.815, -0.02), 'shell', 0.035)
    for side in (-1, 1):
        rbox((0.11, 0.13, 0.56), (0.255 * side, -0.735, -0.03), 'graphite', 0.045)
    for i in range(6):
        rbox((0.37, 0.05, 0.078), (0, -0.722, -0.235 + i * 0.083), 'pearl', 0.022)

    # Backrest: composite shell, graphite bolsters, eight pearl ribs.
    rbox((0.58, 0.80, 0.06), (0, -0.32, 0.39), 'shell', 0.028, rot_x=BACK_TILT)
    for side in (-1, 1):
        rbox((0.12, 0.66, 0.15), (0.25 * side, -0.36, 0.30), 'graphite', 0.05, rot_x=BACK_TILT)
    for i in range(8):
        rbox((0.37, 0.066, 0.05), back((0, -0.255 + i * 0.071, -0.045), (0, -0.33, 0.34)), 'pearl', 0.022, rot_x=BACK_TILT)

    # Titanium blades down the edges of the backrest shell.
    for side in (-1, 1):
        rbox((0.014, 0.56, 0.075), back((0.297 * side, 0.02, 0.0), (0, -0.32, 0.375)), 'titanium', 0.004, rot_x=BACK_TILT)

    # Headrest: pearl pad in a composite shell on two titanium posts.
    rbox((0.34, 0.24, 0.05), (0, 0.24, 0.435), 'shell', 0.022, rot_x=0.1)
    rbox((0.28, 0.18, 0.07), (0, 0.24, 0.385), 'pearl', 0.03, rot_x=0.1)
    for side in (-1, 1):
        rbox((0.022, 0.14, 0.022), (0.08 * side, 0.09, 0.41), 'titanium', 0.005)

    # Armrests with the flight controls: throttle on the left, stick on the right.
    for side in (-1, 1):
        x = 0.42 * side
        rbox((0.12, 0.045, 0.46), (x, -0.512, 0.03), 'graphite', 0.02)
        rbox((0.086, 0.02, 0.40), (x, -0.494, 0.04), 'pearl', 0.009)
        rbox((0.105, 0.04, 0.52), (x, -0.552, 0.0), 'shell', 0.016)
        beam(V(0.33 * side, -0.80, 0.08), V(0.40 * side, -0.56, 0.08), 0.05, 0.14, 'titanium', 0.012)
        rbox((0.13, 0.05, 0.15), (x, -0.515, -0.275), 'piano', 0.018)
        rbox((0.134, 0.012, 0.154), (x, -0.545, -0.275), 'titanium', 0.005)
        # Light along the armrest's inner edge.
        strip([V(x - 0.056 * side, -0.496, z) for z in (-0.19, 0.0, 0.24)], [V(-side * 0.6, 0.8, 0)] * 3, 0.007)
    # Stick.
    beam(V(0.42, -0.49, -0.27), V(0.42, -0.40, -0.285), 0.022, 0.022, 'titanium', 0.006)
    beam(V(0.42, -0.41, -0.283), V(0.42, -0.31, -0.30), 0.042, 0.048, 'graphite', 0.014)
    rbox((0.046, 0.022, 0.05), (0.42, -0.30, -0.302), 'titanium', 0.008, rot_x=-0.17)
    # Throttle.
    beam(V(-0.42, -0.49, -0.25), V(-0.42, -0.40, -0.29), 0.018, 0.03, 'titanium', 0.005)
    rbox((0.10, 0.04, 0.045), (-0.42, -0.385, -0.295), 'graphite', 0.016)
    rbox((0.012, 0.042, 0.047), (-0.365, -0.385, -0.295), 'titanium', 0.004)

    # Light piping down each backrest bolster and across the headrest.
    for side in (-1, 1):
        strip([back((0, -0.27 + 0.54 * i / 8, -0.0755), (0.25 * side, -0.36, 0.30)) for i in range(9)],
              [back((0, 0, -1), (0, 0, 0))] * 9, 0.008)
    strip([V(x, 0.135, 0.352) for x in (-0.11, 0, 0.11)], [V(0, -0.3, -1)] * 3, 0.007)

    # Pedestal, the plate under the cushion, and the dais it stands on.
    rbox((0.50, 0.025, 0.50), (0, -0.872, -0.02), 'titanium', 0.01)
    cylinder(V(0, FLOOR_Y + 0.03, 0.0), 0.15, 0.36, 'titanium', top=False, radius_top=0.10)
    dais = 0.62
    rows = []
    for i in range(48):
        a = 2 * math.pi * i / 48
        d = V(math.cos(a), 0, math.sin(a))
        rows.append([d * (dais + 0.03) + UP * (FLOOR_Y + 0.003), d * dais + UP * (FLOOR_Y + 0.035), d * 0.12 + UP * (FLOOR_Y + 0.035)])
    loft(cabin, rows, ['titanium', 'piano'], lambda p: UP, closed=True, probe=(0, 1))
    circle = [V(math.cos(2 * math.pi * i / 64), 0, math.sin(2 * math.pi * i / 64)) for i in range(64)]
    strip([d * (dais + 0.06) + UP * (FLOOR_Y + 0.003) for d in circle], [UP] * 64, 0.02, closed=True)
    # Hidden emitters: a glow under the cushion and round the pedestal's foot.
    strip([d * 0.2 + UP * -0.88 + V(0, 0, -0.02) for d in circle], [-UP] * 64, 0.03, closed=True, mesh=bake_lights)
    # Two light lines in the floor, from the dais to the footwell.
    for side in (-1, 1):
        strip([V(0.26 * side, FLOOR_Y + 0.003, -0.70), V(0.30 * side, FLOOR_Y + 0.003, -0.9), V(0.36 * side, FLOOR_Y + 0.003, -1.08)], [UP] * 3, 0.012)


# ---- The flight display (the game draws its picture) and the binnacle it stands on -----------
def build_display():
    display = LAYOUT['display']
    centre = Vector(display['position'])
    width, height = display['meters']
    tilt = Matrix.Rotation(display['tilt'], 4, 'X')
    normal = (tilt @ Vector((0, 0, 1, 0))).to_3d()
    up = (tilt @ Vector((0, 1, 0, 0))).to_3d()

    def slab(size, behind, surface, radius, c=centre, frame=tilt):
        m = Matrix.Translation(c - (frame @ Vector((0, 0, 1, 0))).to_3d() * behind) @ frame
        rbox(size, None, surface, radius, matrix=m)

    # Glass a few millimetres behind the picture, in a titanium rim.
    slab((width + 0.05, height + 0.05, 0.02), 0.014, 'screen', 0.006)
    slab((width + 0.066, height + 0.066, 0.018), 0.026, 'titanium', 0.006)
    # The binnacle: a graphite pod with a pearl pad and a titanium line on its face.
    foot = centre - up * (height / 2 + 0.03)
    top = foot.y - 0.004
    rbox((1.0, 0.27, 0.30), (0, top - 0.135, -0.72), 'graphite', 0.04)
    rbox((0.90, 0.12, 0.03), (0, top - 0.135, -0.566), 'pearl', 0.014)
    rbox((0.94, 0.012, 0.02), (0, top - 0.055, -0.566), 'titanium', 0.004)
    beam(foot + V(0, -0.02, -0.06), centre - normal * 0.04, 0.3, 0.04, 'titanium', 0.012)
    # A glow line under the display.
    strip([V(x, top + 0.001, foot.z + 0.035) for x in (-0.37, 0, 0.37)], [V(0, 0.8, 0.6)] * 3, 0.007)

    # Two auxiliary glass displays on stalks, turned towards the pilot.
    for side in (-1, 1):
        frame = Matrix.Rotation(-0.38 * side, 4, 'Y') @ tilt
        c = V(0.62 * side, -0.525, -0.75)
        n = (frame @ Vector((0, 0, 1, 0))).to_3d()
        r = (frame @ Vector((1, 0, 0, 0))).to_3d()
        u = (frame @ Vector((0, 1, 0, 0))).to_3d()
        slab((0.30, 0.19, 0.016), 0.008, 'screen', 0.006, c, frame)
        slab((0.312, 0.202, 0.014), 0.018, 'titanium', 0.006, c, frame)
        beam(V(0.66 * side, WAIST_Y - 0.01, -0.93), c - n * 0.02 - u * 0.03, 0.03, 0.03, 'titanium', 0.008)
        # What they show: level bars on the left, a compass ring on the right.
        if side < 0:
            for i, length in enumerate((0.20, 0.14, 0.22, 0.10, 0.17)):
                y = 0.058 - i * 0.029
                strip([c + r * -0.12 + u * y, c + r * (-0.12 + length) + u * y], [n] * 2, 0.009)
        else:
            strip([c + r * math.cos(a) * 0.062 + u * math.sin(a) * 0.062 for a in np.linspace(0, 2 * math.pi, 33)[:-1]], [n] * 32, 0.006, closed=True)
            strip([c + r * math.cos(a) * 0.036 + u * math.sin(a) * 0.036 for a in np.linspace(0.6, 4.2, 14)], [n] * 14, 0.008)
            for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
                d = r * math.cos(a) + u * math.sin(a)
                strip([c + d * 0.07, c + d * 0.084], [n] * 2, 0.005)


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
    if mesh.uvs:
        layer = data.uv_layers.new(name='UVMap')
        uv = np.array([mesh.uvs[v] for v in (loop.vertex_index for loop in data.loops)], dtype=np.float32)
        layer.data.foreach_set('uv', uv.ravel())
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


def unwrap(obj):
    """One atlas for the whole cabin; islands nearer the pilot get more texels."""
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    def weigh(bm):
        uv = bm.loops.layers.uv.verify()
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
            nearest = min(face.calc_center_median().length for face in faces)
            plain = PLAIN_SURFACES.get(obj.material_slots[faces[0].material_index].material.name, 1.0)
            weight = min(1.6, max(0.45, 1.0 / max(nearest, 0.1))) * plain
            loops = [loop for face in faces for loop in face.loops]
            centre = sum((loop[uv].uv for loop in loops), Vector((0, 0))) / len(loops)
            for loop in loops:
                loop[uv].uv = centre + (loop[uv].uv - centre) * weight
        print(f'[uv] {len(islands)} islands')

    bm_index = lambda bm: (bm.faces.ensure_lookup_table(), bm.faces.index_update())
    edit(obj, lambda bm: (bm_index(bm), weigh(bm)))
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
    kernels, and the whole bake is under a minute on the CPU anyway."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'


def bake(cabin_obj, light_objs):
    scene = bpy.context.scene
    use_cycles()
    scene.cycles.use_denoising = False
    scene.world = bpy.data.worlds.new('dark')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    select_only(cabin_obj)
    materials = [slot.material for slot in cabin_obj.material_slots]

    def run(kind, size, samples, setup, **options):
        image = new_image(kind, size)
        for material in materials:
            bake_target(setup(material), image)
        scene.cycles.samples = samples
        bpy.ops.object.bake(type=options.pop('type'), margin=12, use_clear=True, **options)
        print(f'[bake] {kind}')
        return pixels(image)

    def surface(material):
        code, roughness, metallic = SURFACES[material.name]
        return hex_linear(code), roughness, metallic

    for obj in light_objs:
        obj.hide_render = True
    colour = run('colour', ATLAS, 1, lambda m: emission_material(m, surface(m)[0]), type='EMIT')
    orm = run('orm', ATLAS, 1, lambda m: emission_material(m, (1.0, surface(m)[1], surface(m)[2])), type='EMIT')
    scene.world.light_settings.distance = 0.9
    occlusion = run('occlusion', ATLAS, 96, lambda m: principled_material(m, (0.8, 0.8, 0.8), 1.0, 0.0)[0], type='AO')
    light_objs[1].hide_render = False
    emission_material(light_objs[1].material_slots[0].material, (1, 1, 1), 6.0)
    glow = run('glow', LIGHT_ATLAS, 384, lambda m: principled_material(m, (0.6, 0.6, 0.6), 1.0, 0.0)[0],
               type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})

    # Colour: the surface colour, darkened where the cabin shades itself.
    shade = 0.25 + 0.75 * occlusion[..., :1] ** 1.1
    base = colour * shade
    # Glow: what the ambient strips cast on each surface (in the surface's own colour, plus a
    # little sheen on glossy ones), soft-clipped, over a faint floor.
    colour_small, orm_small = resize(colour, LIGHT_ATLAS), resize(orm, LIGHT_ATLAS)
    irradiance = glow.mean(axis=2, keepdims=True)
    lit = irradiance[irradiance > 1e-5]
    reference = np.percentile(lit, GLOW_REFERENCE_PERCENTILE) if lit.size else 1.0
    level = 1 - np.exp(-2.2 * irradiance / reference)
    sheen = 0.05 * (1 - orm_small[..., 1:2]) ** 2
    emissive = (colour_small + sheen) * (GLOW_FLOOR + (1 - GLOW_FLOOR) * level) * resize(shade, LIGHT_ATLAS) ** 0.5
    print(f'[bake] glow reference {reference:.4f}, mean level {level.mean():.3f}')
    return (save_png('cabin-colour', linear_to_srgb(base), True),
            save_png('cabin-orm', orm, False),
            save_png('cabin-glow', linear_to_srgb(emissive), True))


def texture_node(nodes, image):
    node = nodes.new('ShaderNodeTexImage')
    node.image = image
    return node


def final_materials(cabin_obj, light_obj, glass_obj, images):
    colour, orm, glow = images
    material = bpy.data.materials.new('cabin')
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
    cabin_obj.data.materials.clear()
    cabin_obj.data.materials.append(material)
    cabin_obj.data.polygons.foreach_set('material_index', [0] * len(cabin_obj.data.polygons))

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


def main():
    os.makedirs(BUILD, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_tub()
    build_rear_wall()
    build_canopy()
    build_seat()
    build_display()

    cabin_obj = make_object('cabin', cabin, list(SURFACES))
    light_obj = make_object('lights', lights, ['light'])
    hidden_light_obj = make_object('bakeLights', bake_lights, ['light'])
    glass_obj = make_object('glass', glass, ['glass'])
    for obj in (cabin_obj, light_obj, hidden_light_obj, glass_obj):
        edit(obj, lambda bm: [setattr(e, 'smooth', len(e.link_faces) == 2 and e.calc_face_angle(0.0) < SMOOTH_ANGLE) for e in bm.edges])
    edit(cabin_obj, lambda bm: bmesh.ops.triangulate(bm, faces=bm.faces[:]))
    glass_obj.hide_render = True
    hidden_light_obj.hide_render = True

    for name, (code, roughness, metallic) in SURFACES.items():
        principled_material(bpy.data.materials[name], hex_linear(code), roughness, metallic)
    emission_material(bpy.data.materials['light'], (0.25, 0.48, 1.0), 4.0)
    if '--preview' in ARGS:
        preview('full')

    remove_unseen(cabin_obj, cabin_obj)
    remove_unseen(light_obj, cabin_obj)
    triangles = sum(len(p.vertices) - 2 for obj in (cabin_obj, light_obj, glass_obj) for p in obj.data.polygons)
    print(f'[build] {triangles} triangles after culling')

    if '--no-bake' not in ARGS:
        unwrap(cabin_obj)
        images = bake(cabin_obj, [light_obj, hidden_light_obj])
        final_materials(cabin_obj, light_obj, glass_obj, images)
    bpy.data.objects.remove(hidden_light_obj)
    glass_obj.hide_render = False
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in (cabin_obj, light_obj, glass_obj))
    bpy.ops.export_scene.gltf(filepath=os.path.join(BUILD, 'vr-cockpit.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_image_format='AUTO')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'vr-cockpit.blend'))
    print('[build] wrote build/vr-cockpit.glb')


main()
