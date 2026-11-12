"""
shipforge - a small hard-surface modelling kit on top of Blender's bmesh.

The game's ships are described in build_models.py as a handful of hull "lofts" (cross
sections along a spine) plus boxes, engines and turrets. This module turns those
descriptions into detailed meshes: every hull quad becomes an armour plate with a groove
around it, some plates get raised or recessed machinery, a few become lit windows, and
ambient occlusion is baked into vertex colours so the detail reads without textures.

Coordinates used by ship descriptions ("game space"): +X starboard, +Y up, nose towards -Z.
That is exactly what the exported GLB contains, so the game needs no per-model rotation.

Run with Blender's Python (`blender -b -P build_models.py`) or with the `bpy` pip module.
"""
import math
import random

import bpy  # must be imported before bmesh / mathutils when using the pip module
import bmesh  # noqa: I001
from mathutils import Matrix, Vector

# Material slots shared by every model.
HULL, PANEL, ACCENT, GLOW, DARK, WINDOW, GROOVE = range(7)

# Ready-made `matrix` arguments for ShipBuilder.loft: run the spine upwards / sideways instead of aft.
SPINE_UP = Matrix.Rotation(-math.pi / 2, 4, "X")
SPINE_STARBOARD = Matrix.Rotation(math.pi / 2, 4, "Y")

# Game space -> Blender space (Blender is Z-up; its glTF exporter converts back).
GAME_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def make_material(name, color, metallic, roughness, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1.0)
        shader.inputs["Emission Strength"].default_value = strength
    return material


def hex_color(value):
    """'#rrggbb' -> linear RGB tuple (glTF stores base colours in linear space)."""
    value = value.lstrip("#")
    srgb = [int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)


def palette(hull, panel, accent, glow, window, glow_strength=6.0, hull_metallic=0.4, hull_roughness=0.56):
    """The materials of one faction, in slot order.

    Pale hulls need a rougher, less metallic finish than dark ones: a large flat plate of
    bright metal mirrors the sun into a featureless white glare.
    """
    return [
        make_material("hull", hex_color(hull), hull_metallic, hull_roughness),
        make_material("panel", hex_color(panel), 0.6, 0.5),
        make_material("accent", hex_color(accent), 0.3, 0.45),
        make_material("glow", (0.0, 0.0, 0.0), 0.0, 0.5, hex_color(glow), glow_strength),
        make_material("dark", hex_color("#0b0c10"), 0.4, 0.7),
        make_material("window", (0.0, 0.0, 0.0), 0.0, 0.5, hex_color(window), glow_strength * 0.6),
        make_material("groove", tuple(c * 0.22 for c in hex_color(hull)), 0.5, 0.7),
    ]


def superellipse(angle, half_width, half_height, power):
    """Point on a rounded-rectangle cross section; power 2 = ellipse, higher = boxier, 1 = diamond."""
    c, s = math.cos(angle), math.sin(angle)
    exponent = 2.0 / power
    return (
        half_width * math.copysign(abs(c) ** exponent, c),
        half_height * math.copysign(abs(s) ** exponent, s),
    )


class ShipBuilder:
    """Accumulates geometry for one model. All positions are in game space."""

    def __init__(self, name, seed=1):
        self.name = name
        self.rng = random.Random(seed)
        self.bm = bmesh.new()
        self.engines = []  # [x, y, z, radius] of every engine exhaust, for in-game plumes
        self.markers = {}  # named points (mount positions) reported in the manifest

    # ---- Primitives -------------------------------------------------------------------

    def loft(self, sections, segments=12, mat=HULL, steps=1, mirror=False, cap_mat=None, matrix=None):
        """
        Skins a hull through cross sections.

        Each section is a dict: z (along the spine), w / h (half width / height), and
        optionally x / y (centre offset), p (boxiness, default 2.6) and roll (radians).
        `steps` inserts interpolated rings between sections, which sets the plate size.
        With `mirror`, a second copy is built on the other side of the centre line.
        `matrix` re-orients the whole loft (see SPINE_UP / SPINE_STARBOARD), e.g. for towers.
        Returns the side faces (candidates for detailing).
        """
        rings = []
        for index in range(len(sections) - 1):
            a, b = sections[index], sections[index + 1]
            for step in range(steps):
                rings.append(self._blend_section(a, b, step / steps))
        rings.append(dict(sections[-1]))

        faces = []
        for side in ((1, -1) if mirror else (1,)):
            loops = []
            for section in rings:
                loop = []
                for i in range(segments):
                    # Half-step offset puts flat faces (not edges) on top, bottom and sides.
                    angle = (i + 0.5) / segments * math.tau
                    px, py = superellipse(angle, section["w"], section["h"], section.get("p", 2.6))
                    roll = section.get("roll", 0.0)
                    if roll:
                        px, py = px * math.cos(roll) - py * math.sin(roll), px * math.sin(roll) + py * math.cos(roll)
                    point = Vector((px + section.get("x", 0.0), py + section.get("y", 0.0), section["z"]))
                    if matrix is not None:
                        point = matrix @ point
                    point.x *= side
                    loop.append(self.bm.verts.new(point))
                loops.append(loop)
            flip = side < 0
            for a, b in zip(loops, loops[1:]):
                for i in range(segments):
                    j = (i + 1) % segments
                    quad = (a[i], a[j], b[j], b[i]) if not flip else (a[j], a[i], b[i], b[j])
                    faces.append(self._face(quad, mat))
            cap = mat if cap_mat is None else cap_mat
            self._face(loops[0] if flip else loops[0][::-1], cap)
            self._face(loops[-1][::-1] if flip else loops[-1], cap)
        return faces

    @staticmethod
    def _blend_section(a, b, t):
        keys = set(a) | set(b)
        defaults = {"x": 0.0, "y": 0.0, "p": 2.6, "roll": 0.0}
        return {k: a.get(k, defaults.get(k, 0.0)) * (1 - t) + b.get(k, defaults.get(k, 0.0)) * t for k in keys}

    def box(self, centre, size, mat=HULL, rot=(0.0, 0.0, 0.0), mirror=False):
        """Axis-aligned (optionally rotated, XYZ euler) box. Returns its faces."""
        faces = []
        for side in ((1, -1) if mirror else (1,)):
            created = bmesh.ops.create_cube(self.bm, size=1.0)
            verts = created["verts"]
            bmesh.ops.scale(self.bm, verts=verts, vec=size)
            rotation = Matrix.Rotation(rot[2] * side, 4, "Z") @ Matrix.Rotation(rot[1] * side, 4, "Y") @ Matrix.Rotation(rot[0], 4, "X")
            bmesh.ops.transform(self.bm, verts=verts, matrix=Matrix.Translation((centre[0] * side, centre[1], centre[2])) @ rotation)
            new_faces = list({f for v in verts for f in v.link_faces})
            for face in new_faces:
                face.material_index = mat
            faces.extend(new_faces)
        return faces

    def tube(self, start, end, radius_start, radius_end, segments=10, mat=HULL, cap_mats=(None, None), mirror=False):
        """Cylinder / cone between two points. Returns its side faces."""
        faces = []
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
                faces.append(self._face((rings[0][i], rings[0][j], rings[1][j], rings[1][i]), mat))
            self._face(rings[0][::-1], mat if cap_mats[0] is None else cap_mats[0])
            self._face(rings[1], mat if cap_mats[1] is None else cap_mats[1])
        return faces

    def ball(self, centre, radius, mat=GLOW, subdivisions=2):
        """A faceted sphere (emitters, reactor cores, domes). Returns its faces."""
        created = bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions, radius=radius)
        bmesh.ops.translate(self.bm, verts=created["verts"], vec=centre)
        faces = list({f for v in created["verts"] for f in v.link_faces})
        for face in faces:
            face.material_index = mat
        return faces

    def ring(self, centre, radius, thickness, mat=HULL, segments=32, axis="z"):
        """A torus around `axis` ('x', 'y' or 'z'). Returns its faces."""
        tube_segments = 8
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
            for j in range(tube_segments):
                k = (j + 1) % tube_segments
                faces.append(self._face((a[j], a[k], b[k], b[j]), mat))
        return faces

    def _face(self, verts, mat):
        face = self.bm.faces.new(verts)
        face.material_index = mat
        return face

    # ---- Parts ------------------------------------------------------------------------

    def engine(self, position, radius, length=None, mirror=False):
        """A nozzle pointing aft (+Z) with a glowing core. Records the exhaust position."""
        length = length or radius * 1.6
        for side in ((1, -1) if mirror else (1,)):
            x, y, z = position[0] * side, position[1], position[2]
            self.tube((x, y, z - length), (x, y, z), radius * 0.8, radius, 12, DARK, (DARK, DARK))
            self.tube((x, y, z - length * 0.2), (x, y, z + radius * 0.08), radius * 0.72, radius * 0.72, 12, GLOW, (GLOW, GLOW))
            self.engines.append([round(x, 3), round(y, 3), round(z, 3), round(radius, 3)])

    def turret(self, position, size, up=1, mirror=False):
        """A squat turret with twin barrels; `up` is +1 for dorsal, -1 for ventral."""
        for side in ((1, -1) if mirror else (1,)):
            x, y, z = position[0] * side, position[1], position[2]
            self.tube((x, y, z), (x, y + up * size * 0.5, z), size, size * 0.8, 8, PANEL)
            self.box((x, y + up * size * 0.75, z - size * 0.2), (size * 1.3, size * 0.55, size * 1.5), HULL)
            for offset in (-0.3, 0.3):
                self.tube((x + offset * size, y + up * size * 0.75, z - size * 0.8),
                          (x + offset * size, y + up * size * 0.75, z - size * 2.4), size * 0.13, size * 0.1, 6, DARK)

    def mark(self, name, position):
        """Names a point on the model (e.g. where a module is mounted); it is written to the manifest."""
        self.markers[name] = list(position)

    def light_strip(self, start, end, width, mat=GLOW, mirror=False):
        """A thin emissive bar between two points (trench lights, running lights)."""
        self.tube(start, end, width, width, 4, mat, (mat, mat), mirror=mirror)

    # ---- Surface detail ---------------------------------------------------------------

    def detail(self, faces, plate_height, panels=0.25, machinery=0.14, windows=0.05, recess=0.08, min_size=None):
        """
        Turns plain hull quads into armour.

        Every face becomes a raised plate with a groove around it. Then, at random:
        `panels` are recoloured, `machinery` gets a raised block, `recess` a dark pit, and
        `windows` a lit slit. `plate_height` sets the relief (use about 1% of ship length).
        """
        rng = self.rng
        faces = [f for f in faces if f.is_valid and (min_size is None or math.sqrt(f.calc_area()) >= min_size)]
        if not faces:
            return
        sizes = {f: math.sqrt(f.calc_area()) for f in faces}
        plates = []
        # Inset one face at a time so the groove width can follow the face size.
        for face in faces:
            thickness = min(sizes[face] * 0.045, plate_height * 0.8)
            result = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=thickness, depth=plate_height * rng.uniform(0.4, 1.0))
            for rim in result["faces"]:
                rim.material_index = GROOVE
            plates.append(face)

        for face in plates:
            roll = rng.random()
            size = math.sqrt(face.calc_area())
            if roll < machinery:
                result = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=size * rng.uniform(0.12, 0.3), depth=plate_height * rng.uniform(1.0, 2.6))
                for rim in result["faces"]:
                    rim.material_index = PANEL
                face.material_index = PANEL if rng.random() < 0.6 else HULL
            elif roll < machinery + recess:
                result = bmesh.ops.inset_individual(self.bm, faces=[face], thickness=size * rng.uniform(0.15, 0.3), depth=-plate_height * rng.uniform(1.0, 2.0))
                for rim in result["faces"]:
                    rim.material_index = DARK
                face.material_index = DARK
            elif roll < machinery + recess + windows:
                bmesh.ops.inset_individual(self.bm, faces=[face], thickness=size * 0.36, depth=-plate_height * 0.3)
                face.material_index = WINDOW
            elif roll < machinery + recess + windows + panels:
                face.material_index = PANEL if face.material_index == HULL else face.material_index

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
        is left exactly as authored (used by the cockpit). Returns the final [x, y, z] size.
        """
        low, high = self.bounds()
        scale = 1.0 if length is None else length / (high.z - low.z)
        centre = (low + high) / 2 if recentre and length is not None else Vector((0, 0, 0))
        bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=-centre)
        bmesh.ops.scale(self.bm, verts=self.bm.verts, vec=(scale, scale, scale))

        def convert(point):
            return [round((point[i] - centre[i]) * scale, 2) for i in range(3)]

        self.engines = [convert(engine) + [round(engine[3] * scale, 2)] for engine in self.engines]
        self.markers = {name: convert(point) for name, point in self.markers.items()}
        low, high = self.bounds()
        return [round(high.x - low.x, 2), round(high.y - low.y, 2), round(high.z - low.z, 2)]

    def to_object(self, materials, bake_ao=True):
        """Finishes the mesh: flat shading, faction materials, baked ambient occlusion."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.transform(self.bm, verts=self.bm.verts, matrix=GAME_TO_BLENDER)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in materials:
            mesh.materials.append(material)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if bake_ao:
            bake_ambient_occlusion(obj)
        return obj


def bake_ambient_occlusion(obj, samples=24):
    """Bakes AO into the mesh's vertex colours; the game multiplies them into the hull colour."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    mesh = obj.data
    attribute = mesh.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    mesh.color_attributes.active_color = attribute
    mesh.color_attributes.render_color_index = 0
    for other in bpy.context.scene.objects:
        other.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")
    # Lift the shadows a little: pure-black crevices look like holes under game lighting.
    for item in attribute.data:
        r, g, b, a = item.color
        item.color = (0.35 + 0.65 * r, 0.35 + 0.65 * g, 0.35 + 0.65 * b, a)


def export_glb(obj, path):
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
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_color_quantization=8,
    )


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
