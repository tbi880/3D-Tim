"""
Builds every ship model of "Echoes of Dawn" into public/assets/game/*.glb and writes
src/game/scene/models/modelManifest.json (sizes and engine positions).

    python3 tools/game-models/build_models.py            # all models
    python3 tools/game-models/build_models.py drone eclipse

Needs Blender's Python: either `pip install bpy`, or `blender -b -P tools/game-models/build_models.py`.
Each model is a function below. A MODELS entry is (builder, palette, length, seed, tile):
`length` is the nose-to-tail size in metres (None for a model drawn to scale: its builder sets `b.unit`), `tile` how many metres one repeat of the shared
plating texture covers (smaller = finer plates; about a fifth of the length suits most ships).
"""
import json
import math
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shipforge as sf  # noqa: E402
from shipforge import ACCENT, DARK, GLOW, GROOVE, HULL, PANEL, SPINE_STARBOARD, SPINE_UP, WINDOW  # noqa: E402,F401

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUTPUT_DIR = os.path.join(REPO, "public", "assets", "game")
MANIFEST_PATH = os.path.join(REPO, "src", "game", "scene", "models", "modelManifest.json")


def umbra_palette():
    """Umbra: graphite and oxblood, lit in magenta."""
    return sf.palette(hull="#34313c", panel="#3d1a26", accent="#8a1d3a", glow="#ff2a6d", window="#ff8fb0")


def dawn_palette():
    """Dawn fleet: pale ceramic and slate, lit in cyan."""
    return sf.palette(
        hull="#a3acb8", panel="#5d6c7e", accent="#2f6fd6", glow="#45cfff", window="#fff2c4",
        hull_metallic=0.4, hull_roughness=1.25,
    )


def neutral_palette():
    return sf.palette(hull="#8f9299", panel="#5f6168", accent="#c9a13a", glow="#ffd36b", window="#ffe9a8")


def wreck_palette():
    """Scorched hull plating with no power: nothing glows."""
    return sf.palette(hull="#4a4d52", panel="#2c2e33", accent="#3a3020", glow="#000000", window="#000000", glow_strength=0.0, hull_metallic=0.5, hull_roughness=1.3)


def strut(b, x_start, x_end, z, y_start, y_end, chord, thickness, mat=HULL, steps=2, mirror=True):
    """A flat pylon running sideways from x_start to x_end (wing roots, nacelle pylons). Returns its faces."""
    return b.loft([
        dict(z=x_start, x=-z, y=y_start, w=chord, h=thickness, p=3.0),
        dict(z=x_end, x=-z, y=y_end, w=chord * 0.8, h=thickness * 0.8, p=3.0),
    ], segments=6, steps=steps, mat=mat, mirror=mirror, matrix=SPINE_STARBOARD)


def tower(b, x, y_base, z, height, half_width, half_depth, taper=0.7, mat=HULL, steps=3, segments=8, mirror=False):
    """A block rising from (x, y_base, z); `taper` is the top size relative to the base. Returns its faces."""
    return b.loft([
        dict(z=y_base, x=x, y=-z, w=half_width, h=half_depth, p=5.0),
        dict(z=y_base + height, x=x, y=-z, w=half_width * taper, h=half_depth * taper, p=5.0),
    ], segments=segments, steps=steps, mat=mat, mirror=mirror, matrix=SPINE_UP)


# ---- Umbra small craft --------------------------------------------------------------------

def build_drone(b):
    """Umbra drone: a dagger with two forward-swept prongs."""
    body = b.loft([
        dict(z=-7.0, w=0.15, h=0.12),
        dict(z=-3.5, w=0.9, h=0.6, p=2.0),
        dict(z=1.0, w=1.5, h=1.0, p=3.0),
        dict(z=4.5, w=1.1, h=0.8, p=3.0),
    ], segments=8, steps=2)
    prongs = b.loft([
        dict(z=-6.0, x=3.6, w=0.1, h=0.1),
        dict(z=-2.0, x=3.2, w=0.45, h=0.3, p=1.6),
        dict(z=2.5, x=2.0, w=1.0, h=0.28, p=3.0),
        dict(z=4.2, x=1.2, w=0.9, h=0.25, p=3.0),
    ], segments=6, steps=2, mat=PANEL, mirror=True)
    b.loft([dict(z=0.5, y=1.0, w=0.12, h=0.3), dict(z=4.4, y=1.8, w=0.1, h=1.0)], segments=4, mat=PANEL)
    b.detail(body + prongs, plate_height=0.07, machinery=0.1, windows=0.0, recess=0.1)
    b.light_strip((0, 0.62, -3.2), (0, 1.02, -0.2), 0.09)
    b.engine((0, 0, 5.1), 0.75)


def build_raider(b):
    """Umbra raider: twin hulls joined by a bridge, cannon between them."""
    hulls = b.loft([
        dict(z=-11.0, x=3.4, w=0.2, h=0.2),
        dict(z=-6.0, x=3.6, w=1.0, h=0.8, p=2.2),
        dict(z=2.0, x=3.8, w=1.6, h=1.3, p=3.2),
        dict(z=8.0, x=3.5, w=1.3, h=1.1, p=3.2),
    ], segments=8, steps=3, mirror=True)
    bridge = b.loft([
        dict(z=-3.0, w=2.6, h=0.5, p=4.0),
        dict(z=1.0, w=3.2, h=0.9, p=4.0),
        dict(z=6.0, w=2.8, h=0.7, p=4.0),
    ], segments=8, steps=2, mat=PANEL)
    b.loft([dict(z=2.0, x=3.8, y=1.2, w=0.15, h=0.3), dict(z=8.5, x=4.4, y=2.6, w=0.12, h=1.3)], segments=4, mat=PANEL, mirror=True)
    b.tube((0, -0.2, -3.0), (0, -0.2, -8.5), 0.32, 0.22, 8, DARK)
    b.detail(hulls + bridge, plate_height=0.09, machinery=0.14, windows=0.03, recess=0.1)
    b.light_strip((3.75, 1.35, -5.0), (3.9, 1.42, 1.0), 0.1, mirror=True)
    b.engine((3.5, 0, 8.9), 1.0, mirror=True)


def build_lancer(b):
    """Umbra lancer: a heavy bomber slung over two torpedo tubes."""
    body = b.loft([
        dict(z=-13.0, w=0.4, h=0.3, y=0.6),
        dict(z=-8.0, w=2.6, h=1.3, y=0.5, p=2.4),
        dict(z=0.0, w=4.2, h=2.0, y=0.4, p=3.4),
        dict(z=9.0, w=3.6, h=1.8, y=0.5, p=3.4),
        dict(z=13.0, w=2.2, h=1.2, y=0.6, p=3.0),
    ], segments=10, steps=3)
    wings = b.loft([
        dict(z=-2.0, x=4.0, w=0.3, h=0.3, y=0.3),
        dict(z=3.0, x=8.5, w=1.6, h=0.35, y=0.0, p=3.0),
        dict(z=9.0, x=10.0, w=1.0, h=0.3, y=-0.2, p=3.0),
    ], segments=6, steps=2, mat=PANEL, mirror=True)
    tubes = b.tube((5.2, -2.0, -9.0), (5.2, -2.0, 6.0), 1.25, 1.25, 10, HULL, (GLOW, DARK), mirror=True)
    b.detail(body + wings + tubes, plate_height=0.12, machinery=0.16, windows=0.04, recess=0.1)
    b.turret((0, 2.3, 2.0), 0.9)
    b.engine((1.6, 0.5, 13.6), 1.1, mirror=True)


# ---- Dawn fleet small craft ---------------------------------------------------------------

def build_kestrel(b):
    """The player's ship: a sleek escort with a long nose, cranked wings and twin engines."""
    fuselage = b.loft([
        dict(z=-12.0, w=0.2, h=0.15, y=-0.1),
        dict(z=-8.0, w=1.0, h=0.7, y=0.0, p=2.2),
        dict(z=-3.0, w=1.7, h=1.2, y=0.15, p=2.6),
        dict(z=3.0, w=2.2, h=1.35, y=0.2, p=3.0),
        dict(z=9.0, w=1.9, h=1.1, y=0.2, p=3.0),
    ], segments=10, steps=3)
    canopy = b.loft([
        dict(z=-6.5, w=0.5, h=0.2, y=0.75),
        dict(z=-4.0, w=0.9, h=0.6, y=1.05),
        dict(z=-0.5, w=0.85, h=0.5, y=1.25),
        dict(z=2.0, w=0.4, h=0.2, y=1.3),
    ], segments=8, steps=1, mat=DARK)
    wings = b.loft([
        dict(z=-1.0, x=2.0, w=0.4, h=0.28, y=0.0),
        dict(z=3.5, x=6.0, w=2.3, h=0.22, y=-0.25, p=3.0),
        dict(z=7.0, x=9.5, w=1.2, h=0.14, y=-0.6, p=3.0, mat=ACCENT),
        dict(z=8.4, x=10.4, w=0.4, h=0.1, y=-0.7, p=3.0),
    ], segments=6, steps=2, mirror=True)
    nacelles = b.loft([
        dict(z=1.0, x=3.4, w=0.5, h=0.5, y=0.1),
        dict(z=4.0, x=3.4, w=1.0, h=0.95, y=0.1, p=2.4),
        dict(z=10.0, x=3.4, w=0.95, h=0.9, y=0.1, p=2.4),
    ], segments=8, steps=2, mat=PANEL, mirror=True)
    b.loft([dict(z=5.0, x=3.4, y=1.0, w=0.12, h=0.2), dict(z=10.5, x=3.9, y=2.6, w=0.1, h=1.2)], segments=4, mirror=True)
    b.detail(fuselage + wings + nacelles, plate_height=0.06, machinery=0.08, windows=0.0, recess=0.06, panels=0.3)
    b.light_strip((3.4, 1.05, 4.2), (3.4, 1.05, 8.5), 0.07, mirror=True)
    # Canards carry the beam emitters out to either side of the nose.
    b.loft([
        dict(z=1.3, x=5.0, y=-0.62, w=0.95, h=0.09, p=3.0),
        dict(z=3.9, x=5.9, y=-0.74, w=0.5, h=0.06, p=3.0),
    ], segments=6, mat=PANEL, mirror=True, matrix=SPINE_STARBOARD)
    # Beam emitters under the nose (match `mounts` of playerBeam in config/weapons.js).
    b.tube((3.4, -0.75, -4.5), (3.4, -0.75, -7.2), 0.22, 0.16, 6, DARK, (GLOW, DARK), mirror=True)
    b.engine((3.4, 0.1, 10.8), 0.85, mirror=True)


def build_dart(b):
    """Dawn interceptor: a single-engine needle with a delta wing."""
    body = b.loft([
        dict(z=-8.0, w=0.12, h=0.1),
        dict(z=-4.0, w=0.7, h=0.5, p=2.2),
        dict(z=1.0, w=1.0, h=0.8, p=2.6),
        dict(z=6.0, w=0.9, h=0.75, p=2.6),
    ], segments=8, steps=2)
    wing = b.loft([
        dict(z=-1.0, x=0.9, w=0.3, h=0.18),
        dict(z=4.0, x=4.2, w=1.8, h=0.12, y=-0.2, p=3.0),
        dict(z=6.2, x=5.6, w=0.5, h=0.08, y=-0.3, p=3.0),
    ], segments=6, steps=2, mirror=True)
    b.loft([dict(z=2.0, y=0.8, w=0.1, h=0.2), dict(z=6.2, y=1.9, w=0.08, h=0.9)], segments=4, mat=PANEL)
    b.detail(body + wing, plate_height=0.05, machinery=0.06, windows=0.0, recess=0.05, panels=0.3)
    b.paint(wing, ACCENT, lambda x, y, z: abs(x) > 4.6)
    b.engine((0, 0, 6.7), 0.65)



# ---- Capital ships ------------------------------------------------------------------------

def build_harrier(b):
    """Dawn frigate: hammerhead bow, raised bridge, twin nacelles on swept pylons."""
    hull = b.loft([
        dict(z=-14.0, w=0.7, h=0.4),
        dict(z=-11.5, w=2.6, h=0.9, p=3.2),
        dict(z=-9.5, w=3.5, h=1.1, p=3.6),
        dict(z=-7.8, w=1.9, h=1.2, p=3.0),
        dict(z=-2.0, w=2.5, h=1.8, p=3.2),
        dict(z=5.0, w=3.1, h=2.2, p=3.4),
        dict(z=11.0, w=2.8, h=2.0, p=3.4),
        dict(z=13.6, w=2.0, h=1.5, p=3.0),
    ], segments=16, steps=4)
    bridge = b.loft([
        dict(z=0.5, y=2.1, w=0.9, h=0.4),
        dict(z=2.5, y=2.8, w=1.2, h=0.9, p=3.5),
        dict(z=7.0, y=2.7, w=1.0, h=0.8, p=3.5),
        dict(z=9.5, y=2.2, w=0.6, h=0.4),
    ], segments=10, steps=2)
    nacelles = b.loft([
        dict(z=1.5, x=7.2, y=1.2, w=0.4, h=0.4),
        dict(z=4.0, x=7.2, y=1.2, w=1.2, h=1.1, p=2.6),
        dict(z=13.0, x=7.2, y=1.2, w=1.15, h=1.05, p=2.6),
        dict(z=15.0, x=7.2, y=1.2, w=0.95, h=0.9, p=2.6),
    ], segments=12, steps=4, mat=PANEL, mirror=True)
    pylons = strut(b, 2.6, 6.6, 8.0, 0.6, 1.2, 2.2, 0.28)
    keel = b.loft([dict(z=2.0, y=-2.2, w=0.3, h=0.3), dict(z=6.0, y=-3.2, w=0.45, h=1.1, p=3.0), dict(z=11.0, y=-2.6, w=0.3, h=0.6)], segments=6, steps=2)
    b.detail(hull + bridge, plate_height=0.08, machinery=0.14, windows=0.1, recess=0.07, panels=0.3)
    b.detail(nacelles + pylons + keel, plate_height=0.07, machinery=0.1, windows=0.0, recess=0.06, panels=0.2)
    b.paint(hull, ACCENT, lambda x, y, z: -11.3 < z < -9.6 and abs(y) < 0.6 and abs(x) > 2.4)
    b.light_strip((7.2, 2.35, 4.5), (7.2, 2.35, 12.0), 0.12, mirror=True)
    b.ball((0, 0, -14.3), 0.45, GLOW, 1)
    for z in (-4.5, 0.0):
        b.turret((1.6, 1.75 + (z + 4.5) * 0.04, z), 0.42, mirror=True)
    b.turret((0, -2.25, -1.0), 0.45, up=-1)
    b.engine((7.2, 1.2, 15.4), 0.85, mirror=True)
    b.engine((0, 0, 14.0), 1.15)


def build_corvette(b):
    """Umbra reaver: a flat blade with two spikes reaching past the bow."""
    hull = b.loft([
        dict(z=-6.5, w=0.25, h=0.15),
        dict(z=-3.0, w=1.5, h=0.6, p=2.4),
        dict(z=1.5, w=2.3, h=1.0, p=3.2),
        dict(z=5.5, w=2.0, h=0.9, p=3.2),
        dict(z=6.8, w=1.5, h=0.7, p=3.0),
    ], segments=14, steps=4)
    spikes = b.loft([
        dict(z=-9.0, x=2.2, w=0.06, h=0.06),
        dict(z=-5.0, x=2.7, w=0.35, h=0.3, p=1.8),
        dict(z=0.0, x=3.0, w=0.7, h=0.45, p=2.6),
        dict(z=4.5, x=2.6, w=0.6, h=0.4, p=2.6),
    ], segments=8, steps=3, mat=PANEL, mirror=True)
    fin = b.loft([dict(z=1.0, y=0.9, w=0.12, h=0.2), dict(z=4.5, y=1.9, w=0.14, h=1.0, p=3.0), dict(z=6.5, y=2.3, w=0.08, h=0.9)], segments=6, steps=2, mat=PANEL)
    b.detail(hull + spikes + fin, plate_height=0.05, machinery=0.14, windows=0.06, recess=0.1)
    b.light_strip((2.75, 0.36, -4.5), (3.0, 0.5, 0.0), 0.06, mirror=True)
    b.turret((0, 0.95, -0.5), 0.3)
    b.turret((1.2, -0.85, 2.5), 0.26, up=-1, mirror=True)
    b.engine((0.9, 0, 7.1), 0.55, mirror=True)


def build_warden(b):
    """Umbra warden: a cruiser built around an interdiction core held between two jaws."""
    spine = b.loft([
        dict(z=-13.0, w=2.2, h=2.0, p=3.0),
        dict(z=-6.0, w=3.2, h=3.0, p=3.6),
        dict(z=8.0, w=4.2, h=3.8, p=3.8),
        dict(z=20.0, w=4.6, h=4.0, p=3.8),
        dict(z=26.0, w=3.6, h=3.2, p=3.4),
    ], segments=20, steps=5)
    jaws = b.loft([
        dict(z=-27.0, x=3.6, w=0.15, h=0.2),
        dict(z=-22.0, x=4.8, w=0.8, h=1.2, p=2.2),
        dict(z=-14.0, x=5.6, w=1.6, h=2.4, p=3.2),
        dict(z=-4.0, x=5.0, w=1.9, h=2.8, p=3.4),
        dict(z=4.0, x=4.2, w=1.5, h=2.2, p=3.4),
    ], segments=12, steps=5, mat=PANEL, mirror=True)
    citadel = tower(b, 0, 3.6, 12.0, 4.5, 1.8, 3.2, taper=0.6, steps=3, segments=10)
    spire = tower(b, 0, 8.0, 12.5, 2.6, 0.5, 0.8, taper=0.4, mat=PANEL, steps=2)
    keel = b.loft([dict(z=2.0, y=-3.8, w=0.6, h=0.5), dict(z=12.0, y=-6.0, w=0.9, h=2.4, p=3.2), dict(z=22.0, y=-4.6, w=0.6, h=1.2)], segments=8, steps=3, mat=PANEL)
    pods = b.loft([
        dict(z=10.0, x=6.4, w=0.5, h=0.6),
        dict(z=14.0, x=6.6, w=1.5, h=1.6, p=3.0),
        dict(z=25.0, x=6.4, w=1.4, h=1.5, p=3.0),
    ], segments=10, steps=3, mirror=True)
    b.detail(spine + citadel, plate_height=0.11, machinery=0.16, windows=0.1, recess=0.08)
    b.detail(jaws + keel + pods + spire, plate_height=0.1, machinery=0.14, windows=0.04, recess=0.1)
    # Interdiction core between the jaws.
    b.ball((0, 0, -18.0), 2.3, GLOW, 2)
    b.ring((0, 0, -18.0), 3.3, 0.28, PANEL, 24, axis="z")
    b.ring((0, 0, -18.0), 3.3, 0.28, PANEL, 24, axis="y")
    b.tube((0, 0, -13.0), (0, 0, -15.8), 0.9, 0.5, 8, DARK)
    b.light_strip((5.75, 2.45, -14.0), (5.15, 2.85, -4.0), 0.13, mirror=True)
    b.light_strip((4.25, 2.6, 8.0), (4.65, 2.8, 20.0), 0.13, mirror=True)
    for z in (-2.0, 6.0, 18.0):
        b.turret((2.2, 3.4 + z * 0.02, z), 0.6, mirror=True)
    b.turret((0, -4.2, -2.0), 0.7, up=-1)
    for x, y in ((1.9, 1.6), (1.9, -1.6)):
        b.engine((x, y, 26.6), 1.25, mirror=True)
    b.engine((6.4, 0, 25.6), 1.0, mirror=True)


def build_eclipse(b):
    """The Eclipse: a dreadnought whose crescent blades cradle a spinal lance."""
    hull = b.loft([
        dict(z=-10.0, w=2.2, h=1.8, p=3.0),
        dict(z=-4.0, w=4.8, h=3.4, p=3.6),
        dict(z=4.0, w=6.4, h=4.4, p=3.8),
        dict(z=12.0, w=6.0, h=4.2, p=3.8),
        dict(z=17.0, w=4.4, h=3.2, p=3.4),
    ], segments=28, steps=7)
    blades = b.loft([
        dict(z=-17.5, x=4.6, w=0.1, h=0.25),
        dict(z=-13.0, x=6.6, w=0.7, h=1.8, p=2.2),
        dict(z=-6.0, x=8.8, w=1.4, h=3.6, p=3.0),
        dict(z=2.0, x=9.4, w=1.8, h=4.4, p=3.4),
        dict(z=9.0, x=8.2, w=1.5, h=3.4, p=3.4),
        dict(z=13.0, x=6.6, w=0.9, h=2.0, p=3.0),
    ], segments=16, steps=6, mat=PANEL, mirror=True)
    wing_roots = strut(b, 5.2, 8.6, 3.0, 0.0, 0.0, 5.0, 1.1, steps=3)
    citadel = tower(b, 0, 4.2, 7.0, 3.6, 2.4, 4.2, taper=0.7, steps=4, segments=12)
    upper = tower(b, 0, 7.6, 8.0, 2.4, 1.3, 2.4, taper=0.6, steps=3, segments=10)
    spires = tower(b, 1.0, 9.8, 8.6, 2.2, 0.18, 0.18, taper=0.3, mat=PANEL, steps=1, segments=6, mirror=True)
    keel = b.loft([
        dict(z=-3.0, y=-3.8, w=0.8, h=0.6),
        dict(z=4.0, y=-6.2, w=1.4, h=2.6, p=3.2),
        dict(z=12.0, y=-5.6, w=1.2, h=2.0, p=3.2),
        dict(z=16.0, y=-4.0, w=0.8, h=0.9),
    ], segments=10, steps=4, mat=PANEL)
    sponsons = b.loft([
        dict(z=6.0, x=6.9, y=-2.2, w=0.6, h=0.7),
        dict(z=9.0, x=7.4, y=-2.2, w=1.5, h=1.5, p=3.2),
        dict(z=16.0, x=7.0, y=-2.2, w=1.4, h=1.4, p=3.2),
    ], segments=10, steps=3, mirror=True)
    b.detail(hull, plate_height=0.1, machinery=0.16, windows=0.12, recess=0.08)
    b.detail(blades + wing_roots + keel + sponsons, plate_height=0.1, machinery=0.14, windows=0.05, recess=0.1)
    b.detail(citadel + upper, plate_height=0.08, machinery=0.12, windows=0.2, recess=0.06)
    # Spinal lance: emitter ball and focusing ring between the blade tips.
    b.tube((0, 0, -10.0), (0, 0, -12.6), 1.3, 0.9, 12, DARK)
    b.ball((0, 0, -13.4), 1.15, GLOW, 2)
    b.ring((0, 0, -13.4), 2.0, 0.22, PANEL, 28, axis="z")
    # Trench lights.
    b.light_strip((8.95, 3.75, -6.0), (9.55, 4.55, 2.0), 0.1, mirror=True)
    b.light_strip((9.55, 4.55, 2.0), (8.3, 3.55, 9.0), 0.1, mirror=True)
    b.light_strip((4.9, 3.5, -4.0), (6.5, 4.5, 4.0), 0.09, mirror=True)
    b.light_strip((6.5, 4.5, 4.0), (6.1, 4.3, 12.0), 0.09, mirror=True)
    for z in (-6.0, -1.0, 12.5):
        b.turret((2.6, 3.3 + (z + 6) * 0.06, z), 0.55, mirror=True)
    for z in (-2.0, 6.0):
        b.turret((9.0 + (0.4 if z > 0 else 0), 4.6, z), 0.5, mirror=True)
    b.turret((0, -6.3, 0.0), 0.7, up=-1)
    for y in (-1.7, 1.7):
        b.engine((0, y, 17.5), 1.2)
        b.engine((2.8, y, 17.5), 1.2, mirror=True)
    b.engine((7.0, -2.2, 16.6), 0.95, mirror=True)
    # Where the four shield generators sit (see spawnEclipse in story/campaign.js).
    b.mark("generatorFore", (3.6, 4.05, -1.5))
    b.mark("generatorAft", (4.2, 4.75, 13.0))
    b.mark("lance", (0, 0, -13.4))


def build_forge(b):
    """The Forge: an Umbra shipyard. A keel dock (origin) with three slipway arches above it."""
    arch_y = 7.0
    dock = b.loft([
        dict(z=-15.0, w=1.2, h=1.1, p=4.0),
        dict(z=-12.0, w=1.8, h=1.6, p=5.0),
        dict(z=9.0, w=1.8, h=1.6, p=5.0),
        dict(z=10.5, w=3.6, h=3.4, p=3.0),
        dict(z=15.0, w=3.6, h=3.4, p=3.0),
        dict(z=16.0, w=2.4, h=2.2, p=3.0),
    ], segments=20, steps=5)
    b.detail(dock, plate_height=0.07, machinery=0.2, windows=0.14, recess=0.1)
    for z in (-8.0, 0.0, 8.0):
        arch = b.ring((0, arch_y, z), 6.0, 0.5, PANEL, 40, axis="z")
        b.detail(arch, plate_height=0.05, machinery=0.2, windows=0.04, recess=0.1)
        b.ring((0, arch_y, z), 6.0, 0.08, GLOW, 40, axis="z")
        # Braces from the dock up to the arch.
        b.tube((1.2, 1.2, z), (3.6, arch_y - 4.6, z), 0.22, 0.22, 6, HULL, mirror=True)
    for angle_x, angle_y in ((4.25, 4.25), (4.25, -4.25)):
        girder = b.tube((angle_x, arch_y + angle_y, -8.0), (angle_x, arch_y + angle_y, 8.0), 0.2, 0.2, 6, HULL, mirror=True)
        b.detail(girder, plate_height=0.02, machinery=0.0, windows=0.0, recess=0.0)
    b.tube((0, arch_y + 6.0, -8.0), (0, arch_y + 6.0, 8.0), 0.2, 0.2, 6, HULL)
    # Cranes reaching into the slipway.
    for z in (-4.0, 4.0):
        b.tube((4.25, arch_y + 4.25, z), (2.2, arch_y + 2.0, z), 0.12, 0.08, 5, PANEL, mirror=True)
    tower_faces = tower(b, 0, 1.6, 12.8, 5.0, 1.0, 1.2, taper=0.6, steps=4)
    b.detail(tower_faces, plate_height=0.05, machinery=0.15, windows=0.25, recess=0.05)
    b.tube((0, 6.6, 12.8), (0, 9.5, 12.8), 0.07, 0.03, 5, PANEL)
    arms = strut(b, 3.4, 8.0, 12.8, 0.0, 0.0, 1.4, 0.35, steps=3)
    b.detail(arms, plate_height=0.04, machinery=0.15, windows=0.05, recess=0.1)
    b.light_strip((1.85, 1.2, -12.0), (1.85, 1.2, 9.0), 0.07, mirror=True)
    b.engine((1.4, 0, 16.3), 0.7, mirror=True)
    b.mark("slipway", (0, arch_y, 0))
    b.mark("tractorA", (0, arch_y + 5.3, -8.0))
    b.mark("tractorB", (5.3, arch_y, 0.0))
    b.mark("tractorC", (-5.3, arch_y, 8.0))
    b.mark("reactorPort", (-8.6, 0, 12.8))
    b.mark("reactorStarboard", (8.6, 0, 12.8))
    b.mark("turretFore", (0, 2.0, -11.0))
    b.mark("turretMid", (0, -2.0, 0.0))
    b.mark("turretAft", (0, 4.0, 15.0))


def gate_palette():
    """The stargate: old dark steel and brass, lit pale blue. Older than either fleet."""
    return sf.palette(hull="#59606c", panel="#2c3038", accent="#b0842f", glow="#9fe8ff", window="#ffe2a0",
                      hull_metallic=0.6, hull_roughness=1.15)


# The stargate is drawn in units of an eighth of a kilometre (`b.unit`), so the game can rely
# on its measurements: the ring's middle line is 8.6 units out, the opening 7.5 units.
STARGATE_UNIT = 125.0


def build_stargate(b):
    """
    The stargate of the battle royale: a ring 2.4 km across that ships fly through along z.
    Twelve emitter blocks, each with a prong reaching into the opening, joined by lighter
    trusses; four stabiliser fins outside. The field across the opening is not part of the
    model: the game draws it (scene/models/GatePortal.jsx) over a disc of radius 7.5 units.
    """
    b.unit = STARGATE_UNIT
    blocks = 12
    ring_radius = 8.6
    for i in range(blocks):
        angle = i / blocks * math.tau
        cos, sin = math.cos(angle), math.sin(angle)
        # An emitter block, long side along the ring. Its local x is the radial direction.
        block = b.box((ring_radius * cos, ring_radius * sin, 0), (2.0, 2.5, 1.9), HULL, rot=(0, 0, angle), bevel=0.22)
        b.detail(block, plate_height=0.05, panels=0.35, machinery=0.22, windows=0.1, recess=0.12)
        # Collar plates fore and aft, and the housing the prong grows from.
        for z in (-1.05, 1.05):
            b.box((ring_radius * cos, ring_radius * sin, z), (1.5, 1.9, 0.3), PANEL, rot=(0, 0, angle), bevel=0.08)
        b.box(((ring_radius - 1.15) * cos, (ring_radius - 1.15) * sin, 0), (0.7, 1.3, 1.1), DARK, rot=(0, 0, angle), bevel=0.1)
        # The prong: a spike into the opening with a lit tip, and two running lights along it.
        root = ring_radius - 1.3
        tip = ring_radius - 2.25
        b.tube((root * cos, root * sin, 0), (tip * cos, tip * sin, 0), 0.34, 0.1, 8, PANEL)
        b.ball((tip * cos, tip * sin, 0), 0.16, GLOW, 1)
        for z in (-0.42, 0.42):
            b.light_strip(((root + 0.2) * cos, (root + 0.2) * sin, z), ((root + 0.95) * cos, (root + 0.95) * sin, z), 0.05)
        # A brass band across the block's outer face.
        b.box(((ring_radius + 1.02) * cos, (ring_radius + 1.02) * sin, 0), (0.12, 1.7, 0.5), ACCENT, rot=(0, 0, angle), bevel=0.03)

        # The truss to the next block: a lighter span, sunk a little into both.
        middle = angle + math.tau / blocks / 2
        mcos, msin = math.cos(middle), math.sin(middle)
        span = b.box((ring_radius * mcos, ring_radius * msin, 0), (1.15, 2.6, 1.05), PANEL, rot=(0, 0, middle), bevel=0.14)
        b.detail(span, plate_height=0.04, panels=0.2, machinery=0.3, windows=0.0, recess=0.2)
        for z in (-0.7, 0.7):
            b.box(((ring_radius + 0.25) * mcos, (ring_radius + 0.25) * msin, z), (0.3, 2.9, 0.22), HULL, rot=(0, 0, middle), bevel=0.05)

    # Rails all the way round: two outside, and the lit one that rims the opening.
    for z in (-0.62, 0.62):
        b.ring((0, 0, z), ring_radius + 0.95, 0.09, DARK, 72, axis="z")
    b.ring((0, 0, 0), ring_radius - 1.02, 0.07, GLOW, 96, axis="z")

    # Stabiliser fins on the diagonals, swept back along the flight axis.
    for i in range(4):
        angle = math.tau / 8 + i * math.tau / 4
        cos, sin = math.cos(angle), math.sin(angle)
        fin = b.box((10.35 * cos, 10.35 * sin, 0), (2.3, 0.5, 3.2), HULL, rot=(0, 0, angle), bevel=0.12)
        b.detail(fin, plate_height=0.04, panels=0.3, machinery=0.12, windows=0.06, recess=0.1)
        b.box((11.3 * cos, 11.3 * sin, 0), (0.5, 0.26, 2.0), ACCENT, rot=(0, 0, angle), bevel=0.05)
        for z in (-1.2, 1.2):
            b.ball((11.62 * cos, 11.62 * sin, z), 0.11, WINDOW, 1)
        b.light_strip((9.75 * cos, 9.75 * sin, -1.3), (9.75 * cos, 9.75 * sin, 1.3), 0.045)


# ---- Modules and props --------------------------------------------------------------------

def build_shield_generator(b):
    """Eclipse shield generator: an emitter orb cradled on a pylon."""
    base = tower(b, 0, -1.6, 0, 1.3, 0.9, 0.9, taper=0.55, steps=2, segments=8)
    b.detail(base, plate_height=0.03, machinery=0.2, windows=0.0, recess=0.1)
    b.ball((0, 0.55, 0), 0.75, GLOW, 2)
    b.ring((0, 0.55, 0), 1.05, 0.1, PANEL, 20, axis="y")
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        b.tube((dx * 0.55, -0.4, dz * 0.55), (dx * 1.0, 0.75, dz * 1.0), 0.1, 0.05, 5, HULL)


def build_tractor_emitter(b):
    """Forge tractor emitter: a projector orb in a three-pronged claw."""
    b.ball((0, 0, 0), 0.6, GLOW, 2)
    b.ring((0, 0, 0), 0.95, 0.12, HULL, 20, axis="z")
    b.ring((0, 0, 0), 0.95, 0.12, HULL, 20, axis="x")
    core = b.ring((0, 0, 0), 0.95, 0.16, PANEL, 20, axis="y")
    b.detail(core, plate_height=0.02, machinery=0.2, windows=0.0, recess=0.1)
    for dx, dz in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        b.tube((dx * 0.7, 0, dz * 0.7), (dx * 1.25, 0, dz * 1.25), 0.1, 0.04, 5, PANEL)


def build_reactor(b):
    """Forge reactor: a caged plasma core."""
    b.ball((0, 0, 0), 1.0, GLOW, 2)
    for axis in ("x", "y", "z"):
        cage = b.ring((0, 0, 0), 1.3, 0.13, HULL, 24, axis=axis)
        b.detail(cage, plate_height=0.02, machinery=0.15, windows=0.0, recess=0.1)
    b.tube((0, -1.3, 0), (0, -1.9, 0), 0.5, 0.7, 8, PANEL)
    b.tube((0, 1.3, 0), (0, 1.9, 0), 0.5, 0.7, 8, PANEL)


def build_station_turret(b):
    """Forge defence turret: an armoured dome with a triple battery."""
    base = tower(b, 0, -0.9, 0, 0.7, 1.0, 1.0, taper=0.8, steps=1, segments=10)
    dome = b.loft([dict(z=-1.0, y=0.25, w=0.5, h=0.3, p=3.0), dict(z=0.0, y=0.3, w=0.85, h=0.5, p=3.4), dict(z=1.0, y=0.25, w=0.7, h=0.4, p=3.4)], segments=10, steps=2, mat=PANEL)
    b.detail(base + dome, plate_height=0.03, machinery=0.15, windows=0.05, recess=0.1)
    for x in (-0.4, 0.0, 0.4):
        b.tube((x, 0.3, -0.9), (x, 0.3, -2.6), 0.1, 0.08, 6, DARK, (GLOW, DARK))


def build_buoy(b):
    """Log buoy: a small probe with a dish, solar vanes and a beacon light."""
    body = b.loft([dict(z=-1.2, w=0.3, h=0.3), dict(z=-0.6, w=0.7, h=0.7, p=2.4), dict(z=0.8, w=0.7, h=0.7, p=2.4), dict(z=1.3, w=0.4, h=0.4)], segments=8, steps=2)
    b.detail(body, plate_height=0.03, machinery=0.2, windows=0.0, recess=0.1)
    b.box((2.0, 0, 0.1), (2.4, 0.04, 1.1), ACCENT, mirror=True)
    b.tube((0.7, 0, 0.1), (0.9, 0, 0.1), 0.06, 0.06, 5, PANEL, mirror=True)
    b.tube((0, 0.7, 0), (0, 2.2, 0), 0.04, 0.02, 5, PANEL)
    b.ball((0, 2.3, 0), 0.16, GLOW, 1)
    b.tube((0, 0, -1.2), (0, 0, -1.7), 0.1, 0.75, 12, PANEL, (PANEL, DARK))


def build_wreck(b):
    """Half a Dawn frigate, torn open amidships: scenery for the Graveyard."""
    hull = b.loft([
        dict(z=-14.0, w=0.7, h=0.4),
        dict(z=-11.5, w=2.6, h=0.9, p=3.2),
        dict(z=-9.5, w=3.5, h=1.1, p=3.6),
        dict(z=-7.8, w=1.9, h=1.2, p=3.0),
        dict(z=-2.0, w=2.5, h=1.8, p=3.2),
        dict(z=2.2, w=2.9, h=2.1, p=3.4),
    ], segments=16, steps=4, cap_mat=DARK)
    b.detail(hull, plate_height=0.08, machinery=0.12, windows=0.0, recess=0.25, panels=0.45)
    # Ribs and conduits hanging out of the torn end.
    for x, y, length in ((-1.8, 0.9, 2.6), (1.2, -1.1, 3.4), (0.3, 1.4, 1.8), (-0.6, -0.4, 4.2), (2.1, 0.5, 1.5)):
        b.tube((x, y, 2.2), (x * 1.15, y * 1.2, 2.2 + length), 0.16, 0.05, 5, PANEL)
    b.box((1.9, 1.2, 4.6), (1.8, 0.12, 2.6), HULL, rot=(0.5, 0.3, 0.4))
    b.box((-2.6, -1.8, 5.4), (1.4, 0.1, 1.9), PANEL, rot=(-0.4, 0.2, -0.6))


# ---- Registry -----------------------------------------------------------------------------

# id -> (builder, palette factory, nose-to-tail length in metres, random seed)
MODELS = {
    "drone": (build_drone, umbra_palette, 13, 11, 8),
    "raider": (build_raider, umbra_palette, 22, 12, 9),
    "lancer": (build_lancer, umbra_palette, 30, 13, 10),
    "kestrel": (build_kestrel, dawn_palette, 24, 21, 9),
    "dart": (build_dart, dawn_palette, 16, 22, 8),
    "harrier": (build_harrier, dawn_palette, 280, 23, 36),
    "corvette": (build_corvette, umbra_palette, 130, 14, 22),
    "warden": (build_warden, umbra_palette, 520, 15, 60),
    "eclipse": (build_eclipse, umbra_palette, 3400, 16, 220),
    "forge": (build_forge, umbra_palette, 3000, 17, 220),
    "shieldGenerator": (build_shield_generator, umbra_palette, 150, 18, 30),
    "tractorEmitter": (build_tractor_emitter, umbra_palette, 110, 19, 24),
    "reactor": (build_reactor, umbra_palette, 170, 20, 30),
    "stationTurret": (build_station_turret, umbra_palette, 90, 24, 20),
    "buoy": (build_buoy, neutral_palette, 12, 25, 6),
    "wreck": (build_wreck, wreck_palette, 190, 26, 30),
    "stargate": (build_stargate, gate_palette, None, 28, 150),
}

# Models whose origin is meaningful and must not be moved to the bounding-box centre.
KEEP_ORIGIN = {"forge", "stargate"}


def compress(path):
    """
    Draco-compresses a GLB in place with gltf-transform (about 10x smaller). The site's
    loader already decodes Draco. Texture coordinates keep 16 bits because they run over
    many repeats of the tiling textures. Skipped quietly when Node / npx is not available.
    """
    npx = shutil.which("npx")
    if not npx:
        return
    try:
        subprocess.run(
            [npx, "--yes", "@gltf-transform/cli@4", "draco", path, path,
             "--quantize-position", "14", "--quantize-texcoord", "16", "--quantize-normal", "10", "--quantize-color", "8"],
            check=True, capture_output=True, timeout=300, cwd=os.environ.get("GLTF_TRANSFORM_CWD") or None)
    except (subprocess.SubprocessError, OSError) as error:
        print(f"  (not compressed: {error})")


def build(model_id):
    builder_fn, palette_fn, length, seed, tile = MODELS[model_id]
    sf.reset_scene()
    builder = sf.ShipBuilder(model_id, seed)
    builder_fn(builder)
    size = builder.normalise(length, recentre=model_id not in KEEP_ORIGIN)
    entry = {"file": f"game/{model_id}-transformed.glb",  # optimised copy, see optimize.mjs
              "size": size, "engines": builder.engines}
    if builder.markers:
        entry["markers"] = builder.markers
    obj, hidden = builder.to_object(palette_fn(), tile)
    path = os.path.join(OUTPUT_DIR, f"{model_id}.glb")
    sf.export_glb(obj, path)
    compress(path)
    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    entry["triangles"] = triangles
    print(f"  {model_id}: {size} m, {triangles} triangles ({hidden} hidden faces removed), {os.path.getsize(path) // 1024} KB")
    return entry


def main():
    requested = [arg for arg in sys.argv[1:] if arg in MODELS] or list(MODELS)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    manifest = {}
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as handle:
            manifest = json.load(handle)
    for model_id in requested:
        manifest[model_id] = build(model_id)
    with open(MANIFEST_PATH, "w") as handle:
        json.dump({key: manifest[key] for key in sorted(manifest)}, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
