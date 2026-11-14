"""
Hidden-geometry culling, visibility side.

A triangle is kept if, from at least one sample point on it, at least one ray leaves the
model without being stopped by an opaque surface - i.e. a camera anywhere outside the ship
could see that point. Single-sided surfaces only stop rays that hit their front face (their
back faces are culled when drawn, so they hide nothing from behind).

    python cull_vis.py <work-prefix> [directions]
"""
import sys, time
import numpy as np
from embreex import rtcore_scene as rtcs
from embreex.mesh_construction import TriangleMesh

prefix = sys.argv[1]
NDIR = int(sys.argv[2]) if len(sys.argv) > 2 else 320
V = np.fromfile(prefix + '.tris.bin', dtype=np.float32).reshape(-1, 3, 3).astype(np.float64)
flags = np.fromfile(prefix + '.flags.bin', dtype=np.uint8)
T = len(V)
occ = (flags & 1) > 0
ds = (flags & 2) > 0
cand = (flags & 4) > 0

e1, e2 = V[:, 1] - V[:, 0], V[:, 2] - V[:, 0]
N = np.cross(e1, e2)
area2 = np.linalg.norm(N, axis=1)
nhat = N / np.maximum(area2, 1e-30)[:, None]
lo, hi = V.reshape(-1, 3).min(0), V.reshape(-1, 3).max(0)
diag = float(np.linalg.norm(hi - lo))
EPS = diag * 2e-5
degenerate = area2 < (diag * 1e-7) ** 2

scene = rtcs.EmbreeScene()
occ_ids = np.nonzero(occ)[0]
TriangleMesh(scene, V[occ_ids].astype(np.float32))

# Fibonacci sphere directions, shuffled so every chunk covers the whole sphere.
i = np.arange(NDIR) + 0.5
phi = np.arccos(1 - 2 * i / NDIR)
theta = np.pi * (1 + 5 ** 0.5) * i
D = np.stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)], 1)
D = D[np.random.default_rng(1).permutation(NDIR)]

# Sample points (barycentric); big triangles get more of them.
base = np.array([[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7], [0.94, 0.03, 0.03], [0.03, 0.94, 0.03], [0.03, 0.03, 0.94], [0.485, 0.485, 0.03], [0.03, 0.485, 0.485], [0.485, 0.03, 0.485]])
extra = np.array([[0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8], [0.6, 0.3, 0.1], [0.1, 0.6, 0.3], [0.3, 0.1, 0.6], [0.3, 0.6, 0.1], [0.1, 0.3, 0.6], [0.6, 0.1, 0.3], [0.25, 0.25, 0.5], [0.5, 0.25, 0.25], [0.25, 0.5, 0.25]])
big = area2 * 0.5 > (diag * 0.004) ** 2

visible = np.zeros(T, bool)
unresolved = cand & ~degenerate
print(f'triangles {T}, candidates {cand.sum()}, occluders {occ.sum()}, big {big.sum()}, dirs {NDIR}', flush=True)


def escapes(orig, dirs):
    """True for rays that leave the model (passing through back faces of single-sided surfaces)."""
    alive = np.arange(len(orig))
    out = np.zeros(len(orig), bool)
    o = orig.astype(np.float32).copy()
    for _ in range(10):
        if len(alive) == 0:
            break
        res = scene.run(o[alive], dirs[alive].astype(np.float32), output=1)
        prim = res['primID']
        miss = res['geomID'] < 0
        out[alive[miss]] = True
        hit = ~miss
        a, h = alive[hit], occ_ids[prim[hit]]
        front = np.einsum('ij,ij->i', dirs[a], nhat[h]) < 0
        blocked = ds[h] | front
        through = ~blocked
        a2 = a[through]
        if len(a2) == 0:
            break
        t = res['tfar'][hit][through]
        o[a2] = (o[a2] + dirs[a2] * (t[:, None] + EPS)).astype(np.float32)
        alive = a2
    return out


t0 = time.time()
CH = 8
for c in range(0, NDIR, CH):
    U = np.nonzero(unresolved)[0]
    if len(U) == 0:
        break
    dirs = D[c:c + CH]
    for samples, sel in ((base, U), (extra, U[big[U]])):
        if len(sel) == 0:
            continue
        P = np.einsum('sk,tkj->tsj', samples, V[sel])                      # (n, s, 3)
        dots = nhat[sel] @ dirs.T                                          # (n, d)
        valid = ds[sel][:, None] | (dots > 0.02)
        ti, di = np.nonzero(valid)
        if len(ti) == 0:
            continue
        ns = len(samples)
        tri = np.repeat(ti, ns)
        si = np.tile(np.arange(ns), len(ti))
        dd = dirs[np.repeat(di, ns)]
        side = np.sign(np.einsum('ij,ij->i', dd, nhat[sel][tri]))[:, None]
        side[side == 0] = 1
        orig = P[tri, si] + nhat[sel][tri] * side * EPS + dd * EPS
        ok = escapes(orig, dd)
        hit_tris = sel[np.unique(tri[ok])]
        visible[hit_tris] = True
        unresolved[hit_tris] = False
    if c % 64 == 0:
        print(f'  dirs {c + CH:4d}: unresolved {unresolved.sum():7d}  visible {visible.sum():7d}  {time.time() - t0:5.1f}s', flush=True)

import os
if os.path.exists(prefix + '.raster.bin'):
    raster = np.fromfile(prefix + '.raster.bin', dtype=np.uint8) > 0
    print(f'raster pass adds {(raster & ~visible & cand).sum()} triangles the rays missed')
    visible |= raster
keep = visible | ~cand
keep[degenerate & cand] = False
keep.astype(np.uint8).tofile(prefix + '.visible.bin')
removed = (~keep).sum()
print(f'hidden triangles: {removed} of {cand.sum()} candidates ({100 * removed / max(1, cand.sum()):.1f}%), {time.time() - t0:.1f}s')
