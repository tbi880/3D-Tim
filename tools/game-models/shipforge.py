"""
shipforge - a small hard-surface modelling kit on top of Blender's bmesh.

The game's ships are described in build_models.py as a handful of hull "lofts" (cross
sections along a spine) plus boxes, engines and turrets. This module turns those
descriptions into game-ready meshes:

  * hulls are skinned as smooth curves through their sections and shaded smooth, with
    face-weighted normals and chamfered box edges, so nothing reads as a faceted polygon;
  * fine surface detail (plating, seams, vents, rivets, windows) comes from the shared
    tiling textures made by make_textures.py - every face gets box-projected UVs measured
    in metres - while larger detail (machinery, pipes, masts) is scattered real geometry;
  * faces that can never be seen (the buried halves of intersecting parts) are deleted;
  * ambient occlusion and the faction's colours are baked into vertex colours.

The result is ONE mesh with at most two materials: "hull" (lit, textured, tinted by the
vertex colours) and "glow" (engines, light strips: unlit and bright). The game replaces
both with its own shared materials (scene/models/shipMaterials.js), so a whole fleet
renders with two shader programs and a couple of draw calls per ship.

Coordinates used by ship descriptions ("game space"): +X starboard, +Y up, nose towards -Z.
That is exactly what the exported GLB contains, so the game needs no per-model rotation.

Run with Blender's Python (`blender -b -P build_models.py`) or with the `bpy` pip module.
"""
import math
import random

import bpy  # must be imported before bmesh / mathutils when using the pip module
import bmesh  # noqa: I001
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# Surface kinds a face can have. HULL..GROOVE are lit hull paint; GLOW and WINDOW emit light.
HULL, PANEL, ACCENT, GLOW, DARK, WINDOW, GROOVE = range(7)
EMISSIVE_SLOTS = (GLOW, WINDOW)

# Ready-made `matrix` arguments for ShipBuilder.loft: run the spine upwards / sideways instead of aft.
SPINE_UP = Matrix.Rotation(-math.pi / 2, 4, "X")
SPINE_STARBOARD = Matrix.Rotation(math.pi / 2, 4, "Y")

# Game space -> Blender space (Blender is Z-up; its glTF exporter converts back).
GAME_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# Edges sharper than this stay hard; anything gentler (hull curvature, chamfers) is smoothed.
SHARP_ANGLE = math.radians(58)


def hex_color(value):
    """'#rrggbb' -> linear RGB tuple (glTF stores colours in linear space)."""
    value = value.lstrip("#")
    srgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def palette(hull, panel, accent, glow, window, glow_strength=1.0, hull_metallic=0.75, hull_roughness=1.0):
    """
    One faction's colours. `glow_strength` dims the lamps (1 = full brightness, 0 = unpowered).
    The hull colours tint the shared plating texture; `hull_metallic`
    and `hull_roughness` scale that texture's metalness / roughness channels (pale hulls want
    a duller finish than dark ones, or the sun turns them into white glare).
    """
    hull_rgb = hex_color(hull)
    lit = glow_strength > 0
    return {
        "tints": {
            HULL: hull_rgb,
            PANEL: hex_color(panel),
            ACCENT: hex_color(accent),
            DARK: hex_color("#101216"),
            GROOVE: tuple(c * 0.3 for c in hull_rgb),
            # Unpowered ships (wrecks) keep their lamps as dark glass.
            GLOW: tuple(c * glow_strength for c in hex_color(glow)) if lit else hex_color("#0c0d10"),
            WINDOW: tuple(c * 0.8 * glow_strength for c in hex_color(window)) if lit else hex_color("#0c0d10"),
        },
        "lit": lit,
        "metallic": hull_metallic,
        "roughness": hull_roughness,
    }


def superellipse(angle, half_width, half_height, power):
    """Point on a rounded-rectangle cross section; power 2 = ellipse, higher = boxier, 1 = diamond."""
    c, s = math.cos(angle), math.sin(angle)
    exponent = 2.0 / power
    return (
        half_width * math.copysign(abs(c) ** exponent, c),
        half_height * math.copysign(abs(s) ** exponent, s),
    )


def monotone_curve(knots, values):
    """
    Smooth interpolation through (knot, value) pairs that never overshoots (Fritsch-Carlson),
    so a hull that narrows towards the nose cannot bulge or turn inside out between sections.
    Returns a function of the knot coordinate.
    """
    count = len(knots)
    spans = [knots[i + 1] - knots[i] for i in range(count - 1)]
    slopes = [(values[i + 1] - values[i]) / spans[i] for i in range(count - 1)]
    tangents = [slopes[0]] + [
        0.0 if slopes[i - 1] * slopes[i] <= 0 else (slopes[i - 1] + slopes[i]) / 2 for i in range(1, count - 1)
    ] + [slopes[-1]]
    for i in range(count - 1):
        if slopes[i] == 0:
            tangents[i] = tangents[i + 1] = 0.0
            continue
        a, b = tangents[i] / slopes[i], tangents[i + 1] / slopes[i]
        length = a * a + b * b
        if length > 9:
            factor = 3 / math.sqrt(length)
            tangents[i], tangents[i + 1] = factor * a * slopes[i], factor * b * slopes[i]

    def evaluate(span_index, t):
        h = spans[span_index]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * values[span_index] + (t3 - 2 * t2 + t) * h * tangents[span_index]
                + (-2 * t3 + 3 * t2) * values[span_index + 1] + (t3 - t2) * h * tangents[span_index + 1])

    return evaluate


class ShipBuilder:
    """Accumulates geometry for one model. All positions are in game space."""

    def __init__(self, name, seed=1):
        self.name = name
        self.rng = random.Random(seed)
        self.bm = bmesh.new()
        self.uv_layer = self.bm.loops.layers.uv.new("UVMap")
        self.window_layer = self.bm.faces.layers.int.new("window")
        self.engines = []  # [x, y, z, radius] of every engine exhaust, for in-game plumes
        self.markers = {}  # named points (mount positions) reported in the manifest
        # Metres per unit, for a model drawn to a fixed scale; None for one sized by its length.
        self.unit = None

    # ---- Primitives -------------------------------------------------------------------

    def loft(self, sections, segments=12, mat=HULL, steps=1, mirror=False, cap_mat=None, matrix=None):
        """
        Skins a hull through cross sections.

        Each section is a dict: z (along the spine), w / h (half width / height), and
        optionally x / y (centre offset), p (boxiness, default 2.6), roll (radians) and
        mat (paint for the stretch from this section to the next, overriding `mat`).
        The skin is a smooth curve through the sections, not straight lines between them.
        `segments` and `steps` set how finely it is tessellated around and along the spine
        (both are doubled internally; think of them as "how detailed", not exact counts).
        With `mirror`, a second copy is built on the other side of the centre line.
        `matrix` re-orients the whole loft (see SPINE_UP / SPINE_STARBOARD), e.g. for towers.
        Returns the side faces (candidates for detailing).
        """
        around = max(12, segments * 2)
        keys = ("z", "w", "h", "x", "y", "p", "roll")
        defaults = {"x": 0.0, "y": 0.0, "p": 2.6, "roll": 0.0}
        columns = {key: [section.get(key, defaults.get(key, 0.0)) for section in sections] for key in keys}
        rings = []
        if len(sections) == 2:
            # A straight part needs no rings in between.
            rings = [{key: columns[key][i] for key in keys} for i in (0, 1)]
            ring_mats = [sections[0].get("mat", mat)]
        else:
            # Knots: distance along the spine (kept strictly increasing for stacked sections).
            knots = [0.0]
            for i in range(1, len(sections)):
                knots.append(knots[-1] + max(abs(columns["z"][i] - columns["z"][i - 1]), 1e-4))
            curves = {key: monotone_curve(knots, columns[key]) for key in keys}
            per_span = max(4, min(10, steps * 2))
            ring_mats = []
            for span in range(len(sections) - 1):
                for step in range(per_span):
                    rings.append({key: curves[key](span, step / per_span) for key in keys})
                    ring_mats.append(sections[span].get("mat", mat))
            rings.append({key: columns[key][-1] for key in keys})

        faces = []
        for side in ((1, -1) if mirror else (1,)):
            loops = []
            for section in rings:
                loop = []
                for i in range(around):
                    # Half-step offset puts flat faces (not edges) on top, bottom and sides.
                    angle = (i + 0.5) / around * math.tau
                    px, py = superellipse(angle, max(section["w"], 1e-3), max(section["h"], 1e-3), section["p"])
                    roll = section["roll"]
                    if roll:
                        px, py = px * math.cos(roll) - py * math.sin(roll), px * math.sin(roll) + py * math.cos(roll)
                    point = Vector((px + section["x"], py + section["y"], section["z"]))
                    if matrix is not None:
                        point = matrix @ point
                    point.x *= side
                    loop.append(self.bm.verts.new(point))
                loops.append(loop)
            flip = side < 0
            for (a, b), ring_mat in zip(zip(loops, loops[1:]), ring_mats):
                for i in range(around):
                    j = (i + 1) % around
                    quad = (a[i], a[j], b[j], b[i]) if not flip else (a[j], a[i], b[i], b[j])
                    faces.append(self._face(quad, ring_mat))
            cap = mat if cap_mat is None else cap_mat
            self._face(loops[0] if flip else loops[0][::-1], cap)
            self._face(loops[-1][::-1] if flip else loops[-1], cap)
        return faces

    def box(self, centre, size, mat=HULL, rot=(0.0, 0.0, 0.0), mirror=False, bevel=None):
        """
        Axis-aligned (optionally rotated, XYZ euler) box with chamfered edges. `bevel` is the
        chamfer width (default: a small fraction of the box; 0 for none). Returns its faces.
        """
        faces = []
        if bevel is None:
            bevel = min(size) * 0.09
        for side in ((1, -1) if mirror else (1,)):
            rotation = Matrix.Rotation(rot[2] * side, 4, "Z") @ Matrix.Rotation(rot[1] * side, 4, "Y") @ Matrix.Rotation(rot[0], 4, "X")
            transform = Matrix.Translation((centre[0] * side, centre[1], centre[2])) @ rotation
            faces.extend(self._cuboid(transform, size, mat, bevel))
        return faces

    def _cuboid(self, transform, size, mat, bevel):
        first_new = len(self.bm.faces)
        created = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = created["verts"]
        bmesh.ops.scale(self.bm, verts=verts, vec=size)
        bmesh.ops.transform(self.bm, verts=verts, matrix=transform)
        if bevel > 0:
            edges = list({edge for vert in verts for edge in vert.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=1, profile=0.5, affect="EDGES")
        self.bm.faces.ensure_lookup_table()
        faces = self.bm.faces[first_new:]
        for face in faces:
            face.material_index = mat
        return list(faces)

    def tube(self, start, end, radius_start, radius_end, segments=10, mat=HULL, cap_mats=(None, None), mirror=False,
             capped=True, inward=False):
        """
        Cylinder / cone between two points. `capped=False` leaves the ends open and
        `inward=True` makes the wall face its own axis - together they build the inside of
        a hollow part such as an engine bell. Returns its side faces.
        """
        faces = []
        segments = segments if segments <= 6 else max(16, segments * 2)
        for side in ((1, -1) if mirror else (1,)):
            p0 = Vector((start[0] * side, start[1], start[2]))
            p1 = Vector((end[0] * side, end[1], end[2]))
            axis = (p1 - p0).normalized()
            helper = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
            u = axis.cross(helper).normalized()
            v = axis.cross(u)
            rings = []
            for point, radius in ((p0, radius_start), (p1, radius_end)):
                rings.append([self.bm.verts.new(point + (u * math.cos(a) + v * math.sin(a)) * radius)
                              for a in (i / segments * math.tau for i in range(segments))])
            for i in range(segments):
                j = (i + 1) % segments
                quad = (rings[0][i], rings[0][j], rings[1][j], rings[1][i])
                faces.append(self._face(quad[::-1] if inward else quad, mat))
            if capped:
                self._face(rings[0][::-1], mat if cap_mats[0] is None else cap_mats[0])
                self._face(rings[1], mat if cap_mats[1] is None else cap_mats[1])
        return faces

    def ball(self, centre, radius, mat=GLOW, subdivisions=2):
        """A sphere (emitters, reactor cores, domes). Returns its faces."""
        created = bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions + 1, radius=radius)
        bmesh.ops.translate(self.bm, verts=created["verts"], vec=centre)
        faces = list({f for v in created["verts"] for f in v.link_faces})
        for face in faces:
            face.material_index = mat
        return faces

    def ring(self, centre, radius, thickness, mat=HULL, segments=32, axis="z"):
        """A torus around `axis` ('x', 'y' or 'z'). Returns its faces."""
        tube_segments = 10
        segments = max(48, segments)
        rings = []
        for i in range(segments):
            a = i / segments * math.tau
            loop = []
            for j in range(tube_segments):
                b = (j + 0.5) / tube_segments * math.tau
                r = radius + thickness * math.cos(b)
                local = Vector((r * math.cos(a), r * math.sin(a), thickness * math.sin(b)))
                if axis == "y":
                    local = Vector((local.x, local.z, local.y))
                elif axis == "x":
                    local = Vector((local.z, local.x, local.y))
                loop.append(self.bm.verts.new(local + Vector(centre)))
            rings.append(loop)
        faces = []
        for i in range(segments):
            a, b = rings[i], rings[(i + 1) % segments]
            core = sum((vert.co for vert in a + b), Vector()) / (2 * tube_segments)
            for j in range(tube_segments):
                k = (j + 1) % tube_segments
                face = self._face((a[j], a[k], b[k], b[j]), mat)
                face.normal_update()
                # Whatever the axis, the skin must face away from the middle of the tube.
                if face.normal.dot(face.calc_center_median() - core) < 0:
                    face.normal_flip()
                faces.append(face)
        return faces

    def _face(self, verts, mat):
        face = self.bm.faces.new(verts)
        face.material_index = mat
        return face

    # ---- Parts ------------------------------------------------------------------------

    def engine(self, position, radius, length=None, mirror=False):
        """A bell nozzle pointing aft (+Z) with a glowing throat. Records the exhaust position."""
        length = length or radius * 1.6
        for side in ((1, -1) if mirror else (1,)):
            x, y, z = position[0] * side, position[1], position[2]
            throat = z - length * 0.5
            # Housing, then a hollow bell: outer skin, inner wall and a lip joining them.
            self.tube((x, y, z - length), (x, y, throat), radius * 0.6, radius * 0.74, 12, PANEL)
            self.tube((x, y, throat), (x, y, z), radius * 0.76, radius, 12, DARK, capped=False)
            self.tube((x, y, throat), (x, y, z), radius * 0.66, radius * 0.9, 12, DARK, capped=False, inward=True)
            self.ring((x, y, z), radius * 0.95, radius * 0.055, PANEL, 24, axis="z")
            self.ring((x, y, throat), radius * 0.76, radius * 0.06, HULL, 24, axis="z")
            # The throat glows.
            self.tube((x, y, throat - radius * 0.05), (x, y, throat + radius * 0.04), radius * 0.68, radius * 0.68, 12, GLOW, (GLOW, GLOW))
            self.engines.append([round(x, 3), round(y, 3), round(z, 3), round(radius, 3)])

    def turret(self, position, size, up=1, mirror=False):
        """A squat turret with twin barrels; `up` is +1 for dorsal, -1 for ventral."""
        for side in ((1, -1) if mirror else (1,)):
            x, y, z = position[0] * side, position[1], position[2]
            self.tube((x, y, z), (x, y + up * size * 0.45, z), size * 1.05, size * 0.9, 10, PANEL)
            self.box((x, y + up * size * 0.78, z - size * 0.15), (size * 1.35, size * 0.6, size * 1.7), HULL, bevel=size * 0.14)
            self.box((x, y + up * size * 0.78, z + size * 0.8), (size * 0.8, size * 0.42, size * 0.5), PANEL, bevel=size * 0.06)
            for offset in (-0.32, 0.32):
                bx, by = x + offset * size, y + up * size * 0.78
                self.tube((bx, by, z - size * 0.9), (bx, by, z - size * 1.5), size * 0.17, size * 0.17, 8, PANEL)
                self.tube((bx, by, z - size * 1.5), (bx, by, z - size * 2.6), size * 0.11, size * 0.1, 8, DARK)

    def mark(self, name, position):
        """Names a point on the model (e.g. where a module is mounted); it is written to the manifest."""
        self.markers[name] = list(position)

    def light_strip(self, start, end, width, mat=GLOW, mirror=False):
        """A thin emissive bar between two points (trench lights, running lights)."""
        self.tube(start, end, width, width, 4, mat, (mat, mat), mirror=mirror)

    # ---- Surface detail ---------------------------------------------------------------

    def detail(self, faces, plate_height, panels=0.25, machinery=0.14, windows=0.05, recess=0.08, min_size=None):
        """
        Dresses plain hull faces.

        The plating itself comes from the texture; this decides what varies across the hull:
        `panels` is the share repainted in the secondary colour and `recess` the share of
        dark service panels (both in coherent blocks, not face by face), `windows` the share
        that shows the texture's lit window rows, and `machinery` how densely real geometry
        (blocks, pipes, masts) is scattered. `plate_height` is the size reference for that
        geometry - about 1% of the ship's length.
        """
        rng = self.rng
        faces = [f for f in faces if f.is_valid and (min_size is None or math.sqrt(f.calc_area()) >= min_size)]
        if not faces:
            return
        block = plate_height * 22
        offsets = [rng.uniform(0, 1000) for _ in range(3)]

        def block_roll(centre, stretch, salt):
            # Blocks are long along the hull (z) so colour breaks follow the ship's lines.
            key = (math.floor((abs(centre.x) + offsets[0]) / block), math.floor((centre.y + offsets[1]) / block),
                   math.floor((centre.z + offsets[2]) / (block * stretch)), salt)
            return random.Random(hash(key)).random()

        for face in faces:
            centre = face.calc_center_median()
            roll = block_roll(centre, 2.5, 1)
            if roll < recess * 0.5:
                face.material_index = DARK
            elif roll < recess * 0.5 + panels * 0.7 and face.material_index == HULL:
                face.material_index = PANEL
            # Window decks: long horizontal bands.
            if windows > 0 and block_roll(centre, 6.0, 2) < min(0.9, windows * 3.5) and face.material_index != DARK:
                face[self.window_layer] = 1

        area = sum(f.calc_area() for f in faces)
        count = int(min(900, area / (plate_height * 9) ** 2 * machinery * 0.5))
        self.greebles(faces, count, plate_height * 5)

    def greebles(self, faces, count, size):
        """
        Scatters `count` pieces of machinery over the given faces, sitting on the surface and
        lined up with the hull: blocks, low housings, pipe runs and the odd mast.
        """
        rng = self.rng
        faces = [f for f in faces if f.is_valid and len(f.verts) == 4]
        if not faces or count <= 0:
            return
        weights = [f.calc_area() for f in faces]
        for face in rng.choices(faces, weights=weights, k=count):
            normal = face.normal.copy()
            corners = [v.co.copy() for v in face.verts]
            # A random point on the quad, and the direction of its longer side as "along".
            s, t = rng.random(), rng.random()
            point = (corners[0] * (1 - s) + corners[1] * s) * (1 - t) + (corners[3] * (1 - s) + corners[2] * s) * t
            along = corners[1] - corners[0] if (corners[1] - corners[0]).length > (corners[3] - corners[0]).length else corners[3] - corners[0]
            along = (along - normal * along.dot(normal)).normalized()
            across = normal.cross(along)
            basis = Matrix((
                (across.x, normal.x, along.x, 0), (across.y, normal.y, along.y, 0), (across.z, normal.z, along.z, 0), (0, 0, 0, 1),
            ))
            kind = rng.random()
            scale = size * rng.uniform(0.5, 1.6)
            mat = rng.choice((HULL, PANEL, PANEL, DARK))
            if kind < 0.5:
                # Block housing (half sunk so its base is hidden).
                dims = (scale * rng.uniform(0.5, 1.4), scale * rng.uniform(0.25, 0.7), scale * rng.uniform(0.7, 2.4))
                self._cuboid(Matrix.Translation(point + normal * dims[1] * 0.3) @ basis, dims, mat, min(dims) * 0.16)
            elif kind < 0.75:
                # Pipe run along the hull.
                half = along * scale * rng.uniform(1.2, 3.2)
                lift = normal * scale * 0.14
                self.tube(tuple(point - half + lift), tuple(point + half + lift), scale * 0.13, scale * 0.13, 8, mat)
            elif kind < 0.93:
                # Low round housing.
                self.tube(tuple(point - normal * scale * 0.1), tuple(point + normal * scale * 0.3), scale * 0.5, scale * 0.38, 8, mat)
            else:
                # Short mast.
                self.tube(tuple(point), tuple(point + normal * scale * rng.uniform(1.0, 2.2)), scale * 0.07, scale * 0.03, 6, DARK)

    def paint(self, faces, mat, predicate=None):
        """Recolours faces (optionally only those whose centre passes `predicate(x, y, z)`)."""
        for face in faces:
            if not face.is_valid:
                continue
            centre = face.calc_center_median()
            if predicate is None or predicate(centre.x, centre.y, centre.z):
                face.material_index = mat

    # ---- Output -----------------------------------------------------------------------

    def bounds(self):
        xs = [v.co.x for v in self.bm.verts]
        ys = [v.co.y for v in self.bm.verts]
        zs = [v.co.z for v in self.bm.verts]
        return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))

    def normalise(self, length, recentre=True):
        """
        Scales the model so it is `length` metres from nose to tail and, unless `recentre`
        is False, moves its bounding-box centre to the origin. With `length=None` the model
        is left exactly as authored. A builder that set `unit` (metres
        per unit) is scaled by exactly that instead. Returns the final [x, y, z] size.
        """
        low, high = self.bounds()
        if self.unit is not None:
            scale = self.unit
        else:
            scale = 1.0 if length is None else length / (high.z - low.z)
        centre = (low + high) / 2 if recentre and (length is not None or self.unit is not None) else Vector((0, 0, 0))
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=-centre)
        bmesh.ops.scale(self.bm, verts=self.bm.verts, vec=(scale, scale, scale))

        def convert(point):
            return [round((point[i] - centre[i]) * scale, 2) for i in range(3)]

        self.engines = [convert(engine) + [round(engine[3] * scale, 2)] for engine in self.engines]
        self.markers = {name: convert(point) for name, point in self.markers.items()}
        low, high = self.bounds()
        return [round(high.x - low.x, 2), round(high.y - low.y, 2), round(high.z - low.z, 2)]

    def remove_hidden_faces(self, directions=40):
        """
        Deletes faces no outside observer can ever see - mostly the halves of parts that are
        buried inside other parts. A face survives if a ray from its centre or from near any
        of its corners escapes the model in at least one direction. Returns how many went.
        """
        self.bm.normal_update()
        tree = BVHTree.FromBMesh(self.bm, epsilon=0.0)
        low, high = self.bounds()
        reach = (high - low).length * 2
        lift = reach * 2e-5
        golden = math.pi * (3 - math.sqrt(5))
        sphere = []
        for i in range(directions * 2):
            y = 1 - 2 * (i + 0.5) / (directions * 2)
            radius = math.sqrt(1 - y * y)
            sphere.append(Vector((math.cos(golden * i) * radius, y, math.sin(golden * i) * radius)))

        hidden = []
        for face in self.bm.faces:
            normal = face.normal
            centre = face.calc_center_median()
            rays = [d for d in sphere if d.dot(normal) > 0.08]
            samples = [centre] + [centre.lerp(vert.co, 0.85) for vert in face.verts]
            if not any(tree.ray_cast(sample + normal * lift, direction, reach)[0] is None for sample in samples for direction in rays):
                hidden.append(face)
        bmesh.ops.delete(self.bm, geom=hidden, context="FACES")
        return len(hidden)

    def _project_uvs(self, tile):
        """Box-projects every face onto the texture, `tile` metres per repeat."""
        uv_layer = self.uv_layer
        for face in self.bm.faces:
            n = face.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for loop in face.loops:
                p = loop.vert.co
                if ay >= ax and ay >= az:
                    loop[uv_layer].uv = (p.x / tile, p.z / tile)
                elif ax >= az:
                    loop[uv_layer].uv = (p.z / tile, p.y / tile)
                else:
                    loop[uv_layer].uv = (p.x / tile, p.y / tile)

    def to_object(self, colours, tile=10.0, bake_ao=True):
        """
        Finishes the mesh: hidden faces out, UVs, smooth shading with face-weighted normals,
        then ambient occlusion and the faction colours baked into vertex colours.
        """
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        removed = self.remove_hidden_faces()
        loose = [v for v in self.bm.verts if not v.link_faces]
        bmesh.ops.delete(self.bm, geom=loose, context="VERTS")
        self.bm.normal_update()
        self._project_uvs(tile)

        # Remember each face's paint, then collapse the slots to the two real materials.
        slot_layer = self.bm.faces.layers.int.new("slot")
        for face in self.bm.faces:
            face[slot_layer] = face.material_index
            face.material_index = 1 if face.material_index in EMISSIVE_SLOTS and colours["lit"] else 0
            face.smooth = True

        bmesh.ops.transform(self.bm, verts=self.bm.verts, matrix=GAME_TO_BLENDER)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()

        hull = bpy.data.materials.new("hull")
        hull.use_nodes = True
        shader = hull.node_tree.nodes["Principled BSDF"]
        shader.inputs["Metallic"].default_value = colours["metallic"]
        shader.inputs["Roughness"].default_value = colours["roughness"]
        glow = bpy.data.materials.new("glow")
        glow.use_nodes = True
        mesh.materials.append(hull)
        mesh.materials.append(glow)

        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        mesh.set_sharp_from_angle(angle=SHARP_ANGLE)
        weighted = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        weighted.keep_sharp = True
        weighted.weight = 60

        occlusion = bake_ambient_occlusion(obj) if bake_ao else None
        write_vertex_colours(mesh, colours["tints"], occlusion)
        return obj, removed


def bake_ambient_occlusion(obj, samples=24):
    """Bakes ambient occlusion per face corner and returns it as a float array (one value per loop)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    mesh = obj.data
    attribute = mesh.color_attributes.new("AO", "FLOAT_COLOR", "CORNER")
    mesh.color_attributes.active_color = attribute
    for other in bpy.context.scene.objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")
    data = np.empty(len(mesh.loops) * 4, dtype=np.float32)
    mesh.color_attributes["AO"].data.foreach_get("color", data)
    occlusion = data.reshape(-1, 4)[:, 0].copy()
    mesh.color_attributes.remove(mesh.color_attributes["AO"])
    return occlusion


def write_vertex_colours(mesh, tints, occlusion):
    """
    Writes the colour attribute the game reads: RGB = paint colour x ambient occlusion
    (emissive faces keep their full colour), A = 1 where the face has no windows and 0
    where the window lights of the texture should show.
    """
    polygon_count = len(mesh.polygons)
    slots = np.empty(polygon_count, dtype=np.int32)
    windows = np.empty(polygon_count, dtype=np.int32)
    totals = np.empty(polygon_count, dtype=np.int32)
    mesh.attributes["slot"].data.foreach_get("value", slots)
    mesh.attributes["window"].data.foreach_get("value", windows)
    mesh.polygons.foreach_get("loop_total", totals)

    table = np.array([tints[slot] for slot in range(7)], dtype=np.float32)
    rgb = np.repeat(table[slots], totals, axis=0)
    emissive = np.repeat(np.isin(slots, EMISSIVE_SLOTS), totals)
    if occlusion is not None:
        # Lift the shadows a little: pure-black crevices look like holes under game lighting.
        shade = np.where(emissive, 1.0, 0.3 + 0.7 * occlusion)
        rgb = rgb * shade[:, None]
    alpha = 1.0 - np.repeat(windows, totals).astype(np.float32)
    colour = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    colour.data.foreach_set("color", np.column_stack((rgb, alpha)).astype(np.float32).ravel())
    mesh.color_attributes.active_color = colour
    mesh.color_attributes.render_color_index = mesh.color_attributes.find("Col")
    mesh.attributes.remove(mesh.attributes["slot"])
    mesh.attributes.remove(mesh.attributes["window"])


def export_glb(obj, path):
    """Writes the object as an uncompressed GLB (build_models.py compresses it afterwards)."""
    for other in bpy.context.scene.objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_normals=True,
        export_texcoords=True,
    )


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
