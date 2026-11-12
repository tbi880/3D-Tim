"""
Generates the tiling surface textures every ship shares:

    hull_albedo.webp    panel-to-panel shade variation, grime in the seams (multiplied by the faction colour)
    hull_normal.webp    plating, seams, rivets, vents and hatches as a tangent-space normal map
    hull_orm.webp       R = cavity occlusion, G = roughness, B = metalness (the glTF channel layout)
    hull_emissive.webp  rows of lit windows (shown only where a model asks for them)
    rock_albedo.webp / rock_normal.webp   asteroid surface

Everything is built from one random panel layout, so the four hull maps line up, and
everything wraps around the edges, so the textures tile without seams.

Run:  python3 tools/game-models/make_textures.py      (needs numpy and Pillow)
"""
import os

import numpy as np
from PIL import Image

SIZE = 1024
GRID = 16  # the panel layout is drawn on a GRID x GRID lattice of cells
CELL = SIZE // GRID
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "assets", "game", "textures")


def fractal_noise(rng, size, falloff=1.6):
    """Tileable fractal noise in 0..1: white noise shaped in frequency space (periodic by construction)."""
    spectrum = np.fft.fft2(rng.standard_normal((size, size)))
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    frequency = np.sqrt(fx * fx + fy * fy)
    frequency[0, 0] = 1.0
    shaped = np.real(np.fft.ifft2(spectrum / frequency ** falloff))
    shaped -= shaped.min()
    return shaped / shaped.max()


def blur(image, radius):
    """Wrap-around box blur applied three times (close to a gaussian)."""
    if radius < 1:
        return image
    out = image.astype(np.float64)
    for _ in range(3):
        for axis in (0, 1):
            total = np.zeros_like(out)
            for shift in range(-radius, radius + 1):
                total += np.roll(out, shift, axis=axis)
            out = total / (2 * radius + 1)
    return out


def panel_layout(rng):
    """
    Covers the lattice with rectangles of mixed sizes (1x1 up to 4x4 cells), wrapping at the
    edges. Returns an int map (SIZE x SIZE) of panel ids and the list of rectangles in pixels.
    """
    owner = -np.ones((GRID, GRID), dtype=int)
    rects = []
    shapes = [(4, 4), (4, 2), (2, 4), (3, 2), (2, 3), (2, 2), (2, 1), (1, 2), (1, 1)]
    weights = np.array([1, 3, 3, 3, 3, 6, 6, 6, 5], dtype=float)
    for gy in range(GRID):
        for gx in range(GRID):
            if owner[gy, gx] >= 0:
                continue
            for index in rng.choice(len(shapes), size=len(shapes), replace=False, p=weights / weights.sum()):
                w, h = shapes[index]
                cells = [((gy + dy) % GRID, (gx + dx) % GRID) for dy in range(h) for dx in range(w)]
                if all(owner[c] < 0 for c in cells):
                    for c in cells:
                        owner[c] = len(rects)
                    rects.append((gx * CELL, gy * CELL, w * CELL, h * CELL))
                    break
    return np.kron(owner, np.ones((CELL, CELL), dtype=int)), rects


def fill_rect(image, x, y, w, h, value, add=False):
    """Writes a rectangle that may wrap around the texture edges."""
    ys = np.arange(y, y + h) % SIZE
    xs = np.arange(x, x + w) % SIZE
    if add:
        image[np.ix_(ys, xs)] += value
    else:
        image[np.ix_(ys, xs)] = value


def disc(image, cx, cy, radius, value, add=True):
    span = np.arange(-radius, radius + 1)
    yy, xx = np.meshgrid(span, span, indexing="ij")
    mask = (xx * xx + yy * yy) <= radius * radius
    ys = (cy + span) % SIZE
    xs = (cx + span) % SIZE
    patch = image[np.ix_(ys, xs)]
    image[np.ix_(ys, xs)] = np.where(mask, patch + value if add else value, patch)


def build_hull(rng):
    ids, rects = panel_layout(rng)
    count = len(rects)

    # Seams: wherever two neighbouring pixels belong to different panels.
    seam = ((ids != np.roll(ids, 1, axis=0)) | (ids != np.roll(ids, 1, axis=1))
            | (ids != np.roll(ids, -1, axis=0)) | (ids != np.roll(ids, -1, axis=1))).astype(float)
    seam = np.clip(blur(seam, 1) * 2.2, 0, 1)

    # Each plate sits at one of a few heights, so its edges catch the light.
    level = rng.choice([0.0, 0.0, 0.25, 0.5, 0.8], size=count)
    height = level[ids].astype(float)
    shade = rng.uniform(0.9, 1.0, size=count)[ids]
    rough = rng.uniform(0.36, 0.62, size=count)[ids]
    metal = np.full((SIZE, SIZE), 0.88)
    occlusion = np.ones((SIZE, SIZE))
    windows = np.zeros((SIZE, SIZE, 3))

    for index, (x, y, w, h) in enumerate(rects):
        kind = rng.random()
        margin = 10
        if w < 2 * CELL and h < 2 * CELL and kind < 0.5:
            continue
        if kind < 0.16:
            # Louvred vent: parallel slots.
            horizontal = w >= h
            slots = max(3, (h if horizontal else w - 2 * margin) // 14)
            for slot in range(int(slots)):
                if horizontal:
                    fill_rect(height, x + margin, y + margin + slot * 14, w - 2 * margin, 6, -0.9, add=True)
                    fill_rect(occlusion, x + margin, y + margin + slot * 14, w - 2 * margin, 6, 0.35)
                else:
                    fill_rect(height, x + margin + slot * 14, y + margin, 6, h - 2 * margin, -0.9, add=True)
                    fill_rect(occlusion, x + margin + slot * 14, y + margin, 6, h - 2 * margin, 0.35)
                if (slot + 2) * 14 > (h if horizontal else w) - 2 * margin:
                    break
        elif kind < 0.3:
            # Raised access hatch with a bolt in each corner.
            fill_rect(height, x + margin + 6, y + margin + 6, w - 2 * margin - 12, h - 2 * margin - 12, 0.45, add=True)
            fill_rect(rough, x + margin + 6, y + margin + 6, w - 2 * margin - 12, h - 2 * margin - 12, 0.3)
            for bx, by in ((x + margin + 12, y + margin + 12), (x + w - margin - 12, y + margin + 12),
                           (x + margin + 12, y + h - margin - 12), (x + w - margin - 12, y + h - margin - 12)):
                disc(height, bx, by, 3, 0.5)
        elif kind < 0.44:
            # A row of rivets just inside each long edge.
            for step in range(margin, w - margin + 1, 12):
                disc(height, x + step, y + 7, 2, 0.45)
                disc(height, x + step, y + h - 7, 2, 0.45)
        elif kind < 0.56:
            # Conduit: a raised pipe crossing the plate.
            if w >= h:
                fill_rect(height, x + 4, y + h // 2 - 4, w - 8, 8, 0.7, add=True)
            else:
                fill_rect(height, x + w // 2 - 4, y + 4, 8, h - 8, 0.7, add=True)
        elif kind < 0.7:
            # Painted (less metallic, rougher) plate.
            fill_rect(metal, x + 3, y + 3, w - 6, h - 6, 0.45)
            fill_rect(rough, x + 3, y + 3, w - 6, h - 6, 0.68)

        # Window rows on roughly a third of the plates big enough to hold them.
        if h >= CELL and w >= 2 * CELL and rng.random() < 0.38:
            tint = [(1.0, 0.86, 0.6), (1.0, 0.93, 0.78), (0.72, 0.86, 1.0)][rng.integers(3)]
            for row_y in range(y + 16, y + h - 14, 22):
                for win_x in range(x + 12, x + w - 16, 15):
                    if rng.random() < 0.6:
                        fill_rect(windows, win_x, row_y, 9, 6, np.array(tint) * rng.uniform(0.5, 1.0))
                    fill_rect(height, win_x, row_y, 9, 6, -0.35, add=True)

    height -= seam * 1.1
    height = blur(height, 1)
    wear = fractal_noise(rng, SIZE, 1.3)
    scratches = np.clip((fractal_noise(rng, SIZE, 0.6) - 0.62) * 6, 0, 1)
    height += (fractal_noise(rng, SIZE, 0.9) - 0.5) * 0.12

    # Tangent-space normals (image "up" is +V, see the note in ShipMaterials).
    strength = 2.2
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    normal = np.dstack((-dx * strength, dy * strength, np.ones_like(height)))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)

    grime = blur(seam, 4)
    albedo = shade * (0.92 + 0.16 * wear) * (1 - 0.5 * seam) * (1 - 0.25 * grime)
    occlusion = occlusion * (1 - 0.55 * seam) * (1 - 0.2 * grime)
    rough = np.clip(rough + 0.25 * seam + 0.18 * (wear - 0.5) - 0.2 * scratches, 0.2, 0.95)
    metal = np.clip(metal - 0.25 * seam, 0, 1)
    return {
        "hull_albedo": np.dstack([np.clip(albedo, 0, 1)] * 3),
        "hull_normal": normal * 0.5 + 0.5,
        "hull_orm": np.dstack((np.clip(occlusion, 0, 1), rough, metal)),
        "hull_emissive": np.clip(windows, 0, 1),
    }


def build_rock(rng):
    size = SIZE // 2
    base = fractal_noise(rng, size, 1.5)
    ridged = 1 - np.abs(fractal_noise(rng, size, 1.2) * 2 - 1)
    height = base * 0.7 + ridged * 0.5
    # Craters: a dimple with a raised rim.
    span = np.arange(size)
    for _ in range(26):
        cx, cy, radius = rng.integers(size), rng.integers(size), rng.integers(8, 42)
        ddx = np.minimum(np.abs(span - cx), size - np.abs(span - cx))[None, :]
        ddy = np.minimum(np.abs(span - cy), size - np.abs(span - cy))[:, None]
        distance = np.sqrt(ddx * ddx + ddy * ddy) / radius
        height += np.where(distance < 1, -0.22 * (1 - distance ** 2), 0) + 0.1 * np.exp(-((distance - 1.05) * 6) ** 2)
    strength = 9.0
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5
    normal = np.dstack((-dx * strength, dy * strength, np.ones_like(height)))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    tone = np.clip(0.55 + 0.5 * (base - 0.5) + 0.25 * (ridged - 0.5), 0, 1)
    albedo = np.dstack((tone, tone * 0.95, tone * 0.88))
    return {"rock_albedo": albedo, "rock_normal": normal * 0.5 + 0.5}


def save(name, data, quality):
    path = os.path.join(OUTPUT_DIR, f"{name}.webp")
    Image.fromarray((np.clip(data, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(path, "WEBP", quality=quality, method=6)
    print(f"  {name}.webp  {os.path.getsize(path) // 1024} KB")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    rng = np.random.default_rng(7)
    textures = {**build_hull(rng), **build_rock(rng)}
    for name, data in textures.items():
        save(name, data, 92 if name.endswith("normal") else 84)


if __name__ == "__main__":
    main()
