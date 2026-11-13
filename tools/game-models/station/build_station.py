"""
Lantern Station: turns a station model from the web (source/spacestation7.glb) into the game's
station, with the undock / dock guide lights added. Blender 4.2+, run headless:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P build_station.py

Steps (the rest of the pipeline is in README.md):
  1. Delete the asteroid field and the little ships that circle the station (and the
     animation that spins them): the game draws its own rocks and ships.
  2. Join the station into one mesh, drop UV layers the material does not read (or that
     duplicate another one), centre it on the ring, turn it so the undock lane leaves along
     -Z (the game's "forward") and scale it to metres.
  3. Add the guide lights: two lanes of beacons running from dock mouths on the tower,
     across the ring and out through the gap in it. Departures use the upper lane, arrivals
     the lower one. Every lamp carries its place in the sequence in its vertex colour; the
     game's shader turns that into lights that chase outwards along the departure lane and
     inwards along the arrival lane (scene/models/guideLightMaterial.js).
  4. Export build/lantern-station-clean.glb and build/layout.json (dock mouths, lane ends
     and hit boxes, in game coordinates: metres, Y up, nose -Z).

Vertex colour of the "guideLight" material (one draw call for every lamp and housing):
    R  position along the lane, 0 at the dock mouth .. 1 at the far end
    G  1 = departure lane, 0 = arrival lane, 0.5 = steady marker (dock mouth frames)
    B  1 = lamp, 0 = the dark housing it sits in
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'source', 'spacestation7.glb')
BUILD = os.path.join(HERE, 'build')

# ---- Placement -----------------------------------------------------------------------------
# The source is in arbitrary units: the ring has a radius of about 1.97, centred on the origin,
# with the tower on +Y and the gap in the ring on -Y. 1200 m per unit makes the ring 4.7 km
# across, a little bigger than the Eclipse is long, with the hanging spine reaching 4 km down.
METRES_PER_UNIT = 1200.0
RING_CENTRE = Vector((0.021, 0.048, 0.2))
# Turned half a turn about the vertical axis: the gap (and the undock lane) ends up on +Y in
# Blender, which is -Z in glTF / three.js.
TURN = Matrix.Rotation(math.pi, 4, 'Z')

# Objects (glTF node names) that are not part of the station.
NOT_STATION = ('Asteroids_7', 'Cube_RScatter_6')

# ---- Guide lights (metres, Blender axes after the transform: +Y = out along the lane) --------
LANE_HALF_WIDTH = 230.0       # each lane is two rows of beacons, this far either side of its axis
DEPARTURE_HEIGHT = 300.0      # lane axis height above the ring plane
ARRIVAL_HEIGHT = -120.0
LANE_END = 4300.0             # the last beacons, about 1.9 km beyond the ring
BEACON_SPACING = 170.0
FIRST_BEACON = 90.0           # distance of the first beacon from the dock mouth
LAMP_RADIUS = 7.0
HOUSING_RADIUS = 10.0
HOUSING_LENGTH = 34.0
MOUTH_HALF_SIZE = (150.0, 70.0)   # dock mouth frame: half width, half height
MOUTH_FRAME_LAMPS = 18


def log(*args):
    print('[station]', *args, flush=True)


def import_source():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SOURCE)


def delete_extras():
    """Removes the asteroids and the circling ships, with everything under them."""
    removed = 0
    for name in NOT_STATION:
        root = bpy.data.objects.get(name)
        if not root:
            raise RuntimeError(f'{name} not found: has the source model changed?')
        for obj in [root, *root.children_recursive]:
            if obj.type == 'MESH':
                removed += len(obj.data.polygons)
            bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    log(f'removed asteroids and circling ships: {removed} faces')


def join_station():
    meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    station = bpy.context.view_layer.objects.active
    station.name = station.data.name = 'LanternStation'
    # Unparent (keeping the world transform), then bake centre, turn and scale into the mesh.
    world = station.matrix_world.copy()
    station.parent = None
    station.matrix_world = Matrix.Identity(4)
    transform = Matrix.Scale(METRES_PER_UNIT, 4) @ TURN @ Matrix.Translation(-RING_CENTRE) @ world
    station.data.transform(transform)
    if transform.determinant() < 0:
        station.data.flip_normals()
    for obj in list(bpy.data.objects):
        if obj.type == 'EMPTY':
            bpy.data.objects.remove(obj, do_unlink=True)
    log(f'station: {len(station.data.polygons)} faces')
    return station


def prune_uv_layers(station):
    """Keeps only the UV layers the material samples, and merges layers that are identical."""
    mesh = station.data
    material = mesh.materials[0]
    nodes = material.node_tree.nodes
    first = mesh.uv_layers[0].name

    def coords(name):
        layer = mesh.uv_layers[name].data
        values = [0.0] * (len(layer) * 2)
        layer.foreach_get('uv', values)
        return values

    log('UV layers:', [layer.name for layer in mesh.uv_layers], 'sampled:', sorted({n.uv_map for n in nodes if n.type == 'UVMAP'}))
    # A layer that matches the first one adds nothing: point its users at the first.
    reference = coords(first)
    for node in nodes:
        if node.type == 'UVMAP' and node.uv_map != first and coords(node.uv_map) == reference:
            node.uv_map = first
    used = {first} | {node.uv_map for node in nodes if node.type == 'UVMAP'}
    for name in [layer.name for layer in mesh.uv_layers if layer.name not in used]:
        mesh.uv_layers.remove(mesh.uv_layers[name])
    log('UV layers kept:', [layer.name for layer in mesh.uv_layers])


# ---- Guide lights ----------------------------------------------------------------------------

class LightBuilder:
    """Collects lamp and housing geometry into one bmesh with the vertex-colour encoding above."""

    def __init__(self):
        self.bm = bmesh.new()
        self.colour = self.bm.loops.layers.float_color.new('Col')
        self.lamps = 0

    def _paint(self, faces, rgb):
        for face in faces:
            for loop in face.loops:
                loop[self.colour] = (*rgb, 1.0)

    def _add(self, geometry, rgb):
        faces = [element for element in geometry if isinstance(element, bmesh.types.BMFace)]
        self._paint(faces, rgb)

    def lamp(self, centre, phase, kind):
        result = bmesh.ops.create_icosphere(self.bm, subdivisions=1, radius=LAMP_RADIUS, matrix=Matrix.Translation(centre))
        self._paint({face for vert in result['verts'] for face in vert.link_faces}, (phase, kind, 1.0))
        self.lamps += 1

    def beacon(self, centre, phase, kind):
        """A lamp on top of a small dark six-sided housing that points down."""
        housing_centre = centre - Vector((0, 0, HOUSING_LENGTH * 0.5 + LAMP_RADIUS * 0.6))
        result = bmesh.ops.create_cone(
            self.bm, cap_ends=True, segments=6, radius1=HOUSING_RADIUS * 0.45, radius2=HOUSING_RADIUS,
            depth=HOUSING_LENGTH, matrix=Matrix.Translation(housing_centre),
        )
        self._paint({face for vert in result['verts'] for face in vert.link_faces}, (phase, kind, 0.0))
        self.lamp(centre, phase, kind)

    def to_object(self, name):
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        # The exporter writes the active colour attribute as COLOR_0.
        mesh.color_attributes.active_color = mesh.color_attributes['Col']
        mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def guide_light_material():
    """Placeholder look for other viewers; the game swaps it for its own shader by name."""
    material = bpy.data.materials.new('guideLight')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes['Principled BSDF']
    links = material.node_tree.links
    attribute = nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'Col'
    split = nodes.new('ShaderNodeSeparateColor')
    glow = nodes.new('ShaderNodeMath')
    glow.operation = 'MULTIPLY'
    glow.inputs[1].default_value = 4.0
    links.new(attribute.outputs['Color'], split.inputs['Color'])
    # Lamps (B = 1) glow white; housings (B = 0) stay dark.
    links.new(split.outputs['Blue'], glow.inputs[0])
    links.new(glow.outputs['Value'], bsdf.inputs['Emission Strength'])
    bsdf.inputs['Emission Color'].default_value = (1, 0.95, 0.85, 1)
    bsdf.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    return material


def find_dock_mouth(tree, height):
    """Where the lane axis at `height` meets the tower's inner face (casting from the ring centre)."""
    origin = Vector((0, 0, height))
    hit, _normal, _index, distance = tree.ray_cast(origin, Vector((0, -1, 0)))
    if hit is None:
        raise RuntimeError(f'no tower face found at height {height}')
    return hit


def build_lane(builder, mouth, height, kind):
    """Two rows of beacons from the dock mouth out to LANE_END, plus a frame around the mouth."""
    start = mouth.y + FIRST_BEACON
    count = int((LANE_END - start) // BEACON_SPACING) + 1
    for index in range(count):
        y = start + index * BEACON_SPACING
        phase = index / (count - 1)
        for side in (-1, 1):
            builder.beacon(Vector((side * LANE_HALF_WIDTH, y, height)), phase, kind)
    # Steady lamps framing the dock mouth, set a little proud of the hull.
    half_w, half_h = MOUTH_HALF_SIZE
    perimeter = 4 * (half_w + half_h)
    for index in range(MOUTH_FRAME_LAMPS):
        along = index / MOUTH_FRAME_LAMPS * perimeter
        if along < 2 * half_w:
            x, z = -half_w + along, half_h
        elif along < 2 * half_w + 2 * half_h:
            x, z = half_w, half_h - (along - 2 * half_w)
        elif along < 4 * half_w + 2 * half_h:
            x, z = half_w - (along - 2 * half_w - 2 * half_h), -half_h
        else:
            x, z = -half_w, -half_h + (along - 4 * half_w - 2 * half_h)
        builder.lamp(Vector((x, mouth.y + 25, height + z)), 0.0, 0.5)
    return {'mouth': to_game(Vector((0, mouth.y + FIRST_BEACON * 0.5, height))), 'end': to_game(Vector((0, LANE_END, height))), 'beacons': count * 2}


def add_guide_lights(station):
    tree = BVHTree.FromObject(station, bpy.context.evaluated_depsgraph_get())
    builder = LightBuilder()
    lanes = {}
    for name, height, kind in (('departure', DEPARTURE_HEIGHT, 1.0), ('arrival', ARRIVAL_HEIGHT, 0.0)):
        mouth = find_dock_mouth(tree, height)
        lanes[name] = build_lane(builder, mouth, height, kind)
        log(f'{name} lane: dock mouth at y={mouth.y:.0f} m, {lanes[name]["beacons"]} beacons')
    lights = builder.to_object('GuideLights')
    lights.data.materials.append(guide_light_material())
    log(f'guide lights: {builder.lamps} lamps, {len(lights.data.polygons)} faces')
    return lanes


# ---- Layout for the game -----------------------------------------------------------------------

def to_game(v):
    """Blender (Z up) to glTF / three.js (Y up): (x, y, z) -> (x, z, -y), rounded to metres."""
    return [round(v.x), round(v.z), round(-v.y)]


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(fraction * (len(ordered) - 1))))]


def box_around(points, low=0.02, high=0.98):
    """[cx, cy, cz, hx, hy, hz] in game axes around the bulk of `points` (Blender axes)."""
    lo, hi = [], []
    for axis in range(3):
        values = [p[axis] for p in points]
        lo.append(percentile(values, low))
        hi.append(percentile(values, high))
    centre = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
    half = ((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2)
    return [*to_game(centre), round(half[0]), round(half[2]), round(half[1])]


def hit_boxes(station):
    """Boxes hugging the hull: the ring in 15-degree segments, the tower and the spine in slices."""
    verts = [v.co.copy() for v in station.data.vertices]
    ring_inner, ring_outer = 1.72 * METRES_PER_UNIT, 2.25 * METRES_PER_UNIT
    ring, tower, spine = [], [], []
    for v in verts:
        r = math.hypot(v.x, v.y)
        near_tower = abs(v.x) < 0.68 * METRES_PER_UNIT and v.y < -1.0 * METRES_PER_UNIT
        if v.z < -0.45 * METRES_PER_UNIT:
            # Below the ring only the spine counts; the thin pipes hanging off the ring do not.
            if near_tower:
                spine.append(v)
        elif near_tower and v.y < -1.35 * METRES_PER_UNIT:
            tower.append(v)
        elif ring_inner < r < ring_outer:
            ring.append(v)
    boxes = []
    segments = {}
    for v in ring:
        segments.setdefault(int((math.degrees(math.atan2(v.y, v.x)) + 180) // 15), []).append(v)
    for key in sorted(segments):
        if len(segments[key]) > 200:
            boxes.append(box_around(segments[key]))
    boxes.append(box_around(tower, 0.01, 0.99))
    spine.sort(key=lambda v: v.z)
    slices = 4
    for index in range(slices):
        part = spine[index * len(spine) // slices:(index + 1) * len(spine) // slices]
        boxes.append(box_around(part, 0.02, 0.98))
    return boxes


def export(station, lanes):
    os.makedirs(BUILD, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(BUILD, 'lantern-station-clean.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_apply=True,
        export_vertex_color='ACTIVE', export_animations=False, export_yup=True,
    )
    corners = [Vector(c) for c in station.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    layout = {
        'note': 'Generated by tools/game-models/station/build_station.py. Game axes: metres, Y up, undock lane along -Z.',
        'size': [round(hi.x - lo.x), round(hi.z - lo.z), round(hi.y - lo.y)],
        'lanes': lanes,
        'hitBoxes': hit_boxes(station),
    }
    with open(os.path.join(BUILD, 'layout.json'), 'w') as handle:
        json.dump(layout, handle, indent=1)
    log('wrote', path)
    log('layout', json.dumps(layout))


def main():
    import_source()
    delete_extras()
    station = join_station()
    prune_uv_layers(station)
    lanes = add_guide_lights(station)
    export(station, lanes)


main()
