"""Hand-built, detailed characters (the rest are rebuilt from looks.tsx).

Each builder returns {part: [objects]} for the rig parts Figure.tsx animates:
Body (origin at the feet), Head (origin at the head pivot, 0.29 up), HandL
and HandR (origin at each hand). Coordinates are three.js-style (y up, the
character faces +z), as in looks.tsx. Objects flagged `fuse` are melted
together per material by characters.py (voxel remesh + smoothing): that is
what turns a pile of ellipsoids into a skull with cheeks, or forty clumps
into one head of hair.

Arms are not modelled: the game draws them from shoulder to hand each frame
(looks.tsx `arms`), so they follow every animation.
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import blib

THREE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def M(p=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    """A three.js-style transform: translate · Rx · Ry · Rz · scale (Euler order XYZ)."""
    if isinstance(s, (int, float)):
        s = (s, s, s)
    return (Matrix.Translation(Vector(p)) @ Matrix.Rotation(r[0], 4, 'X') @ Matrix.Rotation(r[1], 4, 'Y')
            @ Matrix.Rotation(r[2], 4, 'Z') @ Matrix.Diagonal((s[0], s[1], s[2], 1)))


def _finish(name, bm, mat, fuse, budget=None):
    bm.transform(THREE_TO_BLENDER)
    obj = blib.new_mesh_object(name, bm, mat, smooth=True)
    if fuse:
        obj['fuse'] = 1
    if budget:
        obj['budget'] = budget
    return obj


def ell(name, p, rad, mat, r=(0, 0, 0), parent=None, seg=(22, 14), deform=None, fuse=False):
    """An ellipsoid (radii `rad` along its own x, y, z), optionally bent by deform(Vector) in three space."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    bm.transform((parent or Matrix()) @ M(p, r, rad))
    if deform:
        for v in bm.verts:
            v.co = deform(v.co.copy())
    return _finish(name, bm, mat, fuse)


def cyl(name, p, radius, height, mat, r=(0, 0, 0), parent=None, seg=20, fuse=False, r_top=None):
    bm = bmesh.new()
    rt = radius if r_top is None else r_top
    ring = lambda rr, y: [bm.verts.new((rr * math.sin(2 * math.pi * i / seg), y, rr * math.cos(2 * math.pi * i / seg))) for i in range(seg)]
    a, b = ring(radius, -height / 2), ring(rt, height / 2)
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform((parent or Matrix()) @ M(p, r))
    return _finish(name, bm, mat, fuse)


def torus(name, p, major, minor, mat, r=(0, 0, 0), parent=None, seg=28, mseg=8):
    """A ring lying in its local x-y plane (like three's TorusGeometry)."""
    bm = bmesh.new()
    rows = []
    for i in range(seg):
        u = 2 * math.pi * i / seg
        rows.append([bm.verts.new(((major + minor * math.cos(v)) * math.cos(u), (major + minor * math.cos(v)) * math.sin(u), minor * math.sin(v)))
                     for v in (2 * math.pi * j / mseg for j in range(mseg))])
    for i in range(seg):
        a, b = rows[i], rows[(i + 1) % seg]
        for j in range(mseg):
            bm.faces.new((a[j], b[j], b[(j + 1) % mseg], a[(j + 1) % mseg]))
    bm.transform((parent or Matrix()) @ M(p, r))
    return _finish(name, bm, mat, False)


def rbox(name, p, size, mat, r=(0, 0, 0), parent=None, bevel=0.004, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.transform((parent or Matrix()) @ M(p, r, size))
    obj = _finish(name, bm, mat, False)
    obj.data.shade_flat()
    blib.add_bevel(obj, bevel, segs, limit='NONE')
    return obj


def _spline(points, n=10):
    """Catmull-Rom through the points, n samples per segment."""
    pts = [Vector(q) for q in points]
    if len(pts) < 3:
        return [pts[0].lerp(pts[-1], t / (n * 2)) for t in range(n * 2 + 1)]
    out = []
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def strand(name, points, r0, r1, mat, parent=None, fuse=False, ring=10, round_tip=True):
    """A tapered tube along a smooth path (hair clumps, brows, lash lines, a moustache)."""
    path = _spline(points)
    if parent is not None:
        path = [parent @ q for q in path]
    bm = bmesh.new()
    rings = []
    n = len(path)
    up = Vector((0, 1, 0))
    for i, c in enumerate(path):
        t = i / (n - 1)
        rad = r0 + (r1 - r0) * t
        d = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        side = d.cross(up)
        if side.length < 1e-4:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        nrm = side.cross(d).normalized()
        rings.append([bm.verts.new(c + (side * math.cos(a) + nrm * math.sin(a)) * rad)
                      for a in (2 * math.pi * j / ring for j in range(ring))])
    for a, b in zip(rings, rings[1:]):
        for j in range(ring):
            bm.faces.new((a[j], a[(j + 1) % ring], b[(j + 1) % ring], b[j]))
    # Caps: a flat start (buried in the scalp/face) and a pointed or rounded tip.
    bm.faces.new(list(reversed(rings[0])))
    tip = bm.verts.new(path[-1] + (path[-1] - path[-2]).normalized() * (r1 * 1.2 if round_tip else 0))
    for j in range(ring):
        bm.faces.new((rings[-1][j], rings[-1][(j + 1) % ring], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, mat, fuse)


def loop(name, points, r, mat, axis=(0, 1, 0), ring=8, n=6):
    """A closed tube through the points (a rim or piping); `axis` is roughly the loop's normal."""
    pts = [Vector(q) for q in points]
    N = len(pts)
    path = []
    for i in range(N):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % N], pts[(i + 2) % N]
        for k in range(n):
            t = k / n
            path.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    bm = bmesh.new()
    ax = Vector(axis)
    rings = []
    L = len(path)
    for i, c in enumerate(path):
        d = (path[(i + 1) % L] - path[i - 1]).normalized()
        side = d.cross(ax).normalized()
        nrm = side.cross(d).normalized()
        rings.append([bm.verts.new(c + (side * math.cos(a) + nrm * math.sin(a)) * r) for a in (2 * math.pi * j / ring for j in range(ring))])
    for i in range(L):
        a, b = rings[i], rings[(i + 1) % L]
        for j in range(ring):
            bm.faces.new((a[j], a[(j + 1) % ring], b[(j + 1) % ring], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, mat, False)


def on_ell(e, x, y, lift=0.0, back=False):
    """A frame on the front (or back) of ellipsoid e = (centre, radii) at (x, y): local z along the surface normal."""
    (cx, cy, cz), (a, b, c) = e
    u, v = (x - cx) / a, (y - cy) / b
    w = math.sqrt(max(0.0, 1 - u * u - v * v)) * (-1 if back else 1)
    n = Vector((u / a, v / b, w / c)).normalized()
    p = Vector((x, y, cz + c * w)) + n * lift
    return M(tuple(p), (math.atan2(-n.y, n.z), math.asin(max(-1, min(1, n.x))), 0))


def ell_z(e, x, y, back=False):
    (cx, cy, cz), (a, b, c) = e
    w = math.sqrt(max(0.0, 1 - ((x - cx) / a) ** 2 - ((y - cy) / b) ** 2))
    return cz + (-c if back else c) * w


def cut_above(y0):
    return lambda v: Vector((v.x, min(v.y, y0), v.z))


def cut_above_local(G, y0):
    """Flatten a shape above y0 in the frame `G` (a mouth's straight top lip)."""
    inv = G.inverted()
    def f(v):
        lv = inv @ v
        lv.y = min(lv.y, y0)
        return G @ lv
    return f


def frame_z(p, z, up=(0, 1, 0)):
    """A frame at p whose local z points along z (local y as close to `up` as it can be)."""
    z = Vector(z).normalized()
    y = Vector(up) - z * Vector(up).dot(z)
    if y.length < 1e-5:
        y = Vector((1, 0, 0)) - z * z.x
    y.normalize()
    x = y.cross(z)
    mt = Matrix((x, y, z)).transposed().to_4x4()
    mt.translation = Vector(p)
    return mt


def star(name, G, r_out, r_in, depth, mat, points=5):
    """A raised, faceted star lying in the local x-y plane of G (embroidery, emblems)."""
    bm = bmesh.new()
    n = points * 2
    ring = [((r_out if i % 2 == 0 else r_in) * math.cos(math.pi / 2 + math.pi * i / points),
             (r_out if i % 2 == 0 else r_in) * math.sin(math.pi / 2 + math.pi * i / points)) for i in range(n)]
    back = [bm.verts.new((x, y, -depth * 0.5)) for x, y in ring]
    front = [bm.verts.new((x, y, depth * 0.3)) for x, y in ring]
    cf, cb = bm.verts.new((0, 0, depth * 0.75)), bm.verts.new((0, 0, -depth * 0.5))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((back[i], back[j], front[j], front[i]))
        bm.faces.new((front[i], front[j], cf))
        bm.faces.new((back[j], back[i], cb))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(G)
    obj = _finish(name, bm, mat, False)
    obj.data.shade_flat()
    return obj


def crescent(name, G, rc, w, mat, open_dir=0.0):
    """A crescent moon in the local x-y plane of G: two tapered horns from the fat middle."""
    out = []
    for k, sgn in enumerate((-1, 1)):
        pts = [Vector((rc * math.cos(open_dir + math.pi + sgn * a), rc * math.sin(open_dir + math.pi + sgn * a), 0))
               for a in (0.0, 0.8, 1.6, 2.3)]
        out.append(strand(f'{name}{k}', pts, w, w * 0.15, mat, parent=G, ring=6, round_tip=False))
    return out


def sheet(name, surf, cx, hw, y0, y1, lift, thick, mat, nu=10, nv=8):
    """A thin panel laid on a surface: surf(x, y) -> point; hw(t) is its half width at t (0 top .. 1 bottom).

    Returns the panel and its outer border (for piping), in order round the edge."""
    def P(u, t):
        x, y = cx + u * hw(t), y0 + (y1 - y0) * t
        p = surf(x, y)
        e = 1e-4
        n = (surf(x + e, y) - surf(x - e, y)).cross(surf(x, y + e) - surf(x, y - e))
        if n.length < 1e-9:
            n = Vector((0, 0, 1))
        n.normalize()
        if n.z < 0:
            n = -n
        return p, n
    bm = bmesh.new()
    grid_o, grid_i, border = [], [], []
    for j in range(nv + 1):
        ro, ri = [], []
        for i in range(nu + 1):
            p, n = P(-1 + 2 * i / nu, j / nv)
            ro.append(bm.verts.new(p + n * lift))
            ri.append(bm.verts.new(p + n * (lift - thick)))
        grid_o.append(ro)
        grid_i.append(ri)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid_o[j][i], grid_o[j + 1][i], grid_o[j + 1][i + 1], grid_o[j][i + 1]))
            bm.faces.new((grid_i[j][i], grid_i[j][i + 1], grid_i[j + 1][i + 1], grid_i[j + 1][i]))
    ring = ([(0, i) for i in range(nu + 1)] + [(j, nu) for j in range(1, nv + 1)] +
            [(nv, i) for i in range(nu - 1, -1, -1)] + [(j, 0) for j in range(nv - 1, 0, -1)])
    for k in range(len(ring)):
        (j0, i0), (j1, i1) = ring[k], ring[(k + 1) % len(ring)]
        bm.faces.new((grid_o[j0][i0], grid_i[j0][i0], grid_i[j1][i1], grid_o[j1][i1]))
    for (j, i) in ring:
        p, n = P(-1 + 2 * i / nu, j / nv)
        border.append(p + n * (lift - thick * 0.3))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(name, bm, mat, False), border


def ell_surf(*es):
    """The front surface of a union of ellipsoids, as surf(x, y) for sheet()."""
    return lambda x, y: Vector((x, y, max(ell_z(e, x, y) for e in es)))


# --------------------------------------------------------------------------
# Shared bits: sneakers and hands
# --------------------------------------------------------------------------

def sneakers(cid, m, out, shoe='main'):
    for side in (-1, 1):
        x = side * 0.042
        out.append(ell(f'{cid}_Shoe{side}', (x, 0.024, 0.014), (0.034, 0.024, 0.054), m[shoe], seg=(20, 12)))
        out.append(ell(f'{cid}_Sole{side}', (x, 0.009, 0.016), (0.036, 0.011, 0.057), m['white'], seg=(20, 10), deform=cut_above(0.012)))
        out.append(ell(f'{cid}_Toe{side}', (x, 0.019, 0.054), (0.027, 0.016, 0.018), m['white'], seg=(14, 8)))
        # Laces: three little bars across the tongue.
        for k in range(3):
            out.append(rbox(f'{cid}_Lace{side}{k}', (x, 0.043 - k * 0.003, 0.012 + k * 0.012), (0.026, 0.004, 0.005), m['white'],
                            r=(-0.45, 0, 0), bevel=0.0015, segs=1))


def mitten(cid, part, m, mat, side):
    """A soft hand with a thumb, palm turned in."""
    out = [
        ell(f'{cid}_{part}Palm', (0, 0, 0), (0.024, 0.027, 0.02), m[mat], fuse=True),
        ell(f'{cid}_{part}Thumb', (-side * 0.018, 0.006, 0.012), (0.009, 0.014, 0.009), m[mat], r=(0.3, 0, side * 0.6), fuse=True),
        ell(f'{cid}_{part}Fingers', (0, -0.012, 0.004), (0.022, 0.018, 0.019), m[mat], fuse=True),
    ]
    # Three finger tips, so the hand reads as a hand and not a ball.
    for k, dx in enumerate((-0.012, 0.0, 0.012)):
        out.append(ell(f'{cid}_{part}Tip{k}', (dx, -0.026, 0.006 - abs(dx) * 0.2), (0.0085, 0.012, 0.0095), m[mat], fuse=True))
    return out


# --------------------------------------------------------------------------
# Snacky: messy dark hair, a big grin, black tee, jeans, a snack bar
# --------------------------------------------------------------------------

def snacky(m):
    cid = 'snacky'
    body, head = [], []
    # ---- body: tee, jeans, sneakers
    body.append(ell(f'{cid}_Torso', (0, 0.13, 0), (0.079, 0.074, 0.062), m['cloth'], fuse=True))
    body.append(ell(f'{cid}_Hem', (0, 0.083, 0), (0.083, 0.024, 0.065), m['cloth'], fuse=True))
    for side in (-1, 1):
        body.append(ell(f'{cid}_Sleeve{side}', (side * 0.082, 0.163, 0), (0.033, 0.027, 0.031), m['cloth'], r=(0, 0, -side * 0.55), fuse=True))
        body.append(torus(f'{cid}_SleeveHem{side}', (side * 0.097, 0.149, 0), 0.024, 0.0035, m['cloth'], r=(math.pi / 2, 0, -side * 0.55)))
    body.append(torus(f'{cid}_Collar', (0, 0.196, 0.004), 0.033, 0.006, m['ink'], r=(math.pi / 2 - 0.25, 0, 0)))
    body.append(cyl(f'{cid}_Neck', (0, 0.21, 0), 0.027, 0.05, m['skin']))
    # A print on the tee in the player's colour (so everyone can tell whose Snacky is whose).
    body.append(rbox(f'{cid}_Print', (0, 0.138, 0.061), (0.052, 0.034, 0.006), m['main'], r=(-0.2, 0, 0), bevel=0.004))
    body.append(rbox(f'{cid}_PrintStripe', (0, 0.138, 0.0645), (0.038, 0.006, 0.003), m['white'], r=(-0.2, 0, 0), bevel=0.0012))
    body.append(ell(f'{cid}_Hips', (0, 0.07, 0), (0.07, 0.03, 0.057), m['denim'], fuse=True))
    for side in (-1, 1):
        body.append(strand(f'{cid}_Leg{side}', [(side * 0.033, 0.075, 0), (side * 0.038, 0.052, 0.002), (side * 0.041, 0.03, 0.006)], 0.027, 0.024, m['denim'], fuse=True))
        body.append(torus(f'{cid}_Cuff{side}', (side * 0.041, 0.034, 0.006), 0.024, 0.005, m['denim'], r=(math.pi / 2, 0, 0)))
    sneakers(cid, m, body)

    # ---- head
    def jaw(v):
        # Narrow and round the lower face into a chin; a touch of fullness at the cheeks.
        if v.y < -0.02:
            t = min(1.0, (-v.y - 0.02) / 0.09)
            v.x *= 1 - 0.22 * t * t
            v.z = v.z * (1 - 0.08 * t) + 0.004 * t
        return v
    head.append(ell(f'{cid}_Skull', (0, 0, 0), (0.117, 0.113, 0.107), m['skin'], seg=(36, 24), deform=jaw, fuse=True))
    for side in (-1, 1):
        head.append(ell(f'{cid}_Ear{side}', (side * 0.111, -0.008, -0.004), (0.016, 0.027, 0.017), m['skin'], r=(0, -side * 0.3, 0), fuse=True))
        head.append(ell(f'{cid}_Cheek{side}', (side * 0.055, -0.036, 0.07), (0.028, 0.022, 0.026), m['skin'], fuse=True))
    head.append(ell(f'{cid}_Nose', (0, -0.02, 0.104), (0.014, 0.013, 0.014), m['skin'], fuse=True))
    head.append(ell(f'{cid}_NoseTip', (0, -0.027, 0.112), (0.011, 0.01, 0.009), m['skin'], fuse=True))

    # Eyes: big, warm brown, a bright catchlight; a little squint from the grin.
    for side in (-1, 1):
        G = M((side * 0.042, 0.004, 0.096), (0, side * 0.36, 0))
        head.append(ell(f'{cid}_Sclera{side}', (0, 0, 0), (0.021, 0.022, 0.011), m['white'], parent=G, seg=(20, 14)))
        blink_lid(cid, head, m, G, side, (0.021, 0.022, 0.011))
        head.append(ell(f'{cid}_Iris{side}', (0, -0.001, 0.0075), (0.0155, 0.017, 0.006), m['c3'], parent=G, seg=(18, 12)))
        head.append(ell(f'{cid}_Pupil{side}', (0, -0.001, 0.0115), (0.008, 0.009, 0.003), m['ink'], parent=G, seg=(14, 10)))
        head.append(ell(f'{cid}_Glint{side}', (-0.006, 0.007, 0.0135), (0.0045, 0.0045, 0.002), m['white'], parent=G, seg=(10, 6)))
        # Upper lid line and a smile crease under the eye.
        head.append(strand(f'{cid}_Lid{side}', [(-0.023, 0.006, 0.006), (-0.01, 0.02, 0.01), (0.01, 0.021, 0.01), (0.023, 0.009, 0.006)],
                           0.0032, 0.0022, m['ink'], parent=G, ring=6))
        # Brows: thick, dark, a little raised (he's having a good time).
        head.append(strand(f'{cid}_Brow{side}', [(side * 0.018, 0.06, 0.103), (side * 0.042, 0.061, 0.1), (side * 0.067, 0.05, 0.087)],
                           0.0075, 0.0045, m['hair'], ring=8))

    # The grin: an open mouth with a row of teeth and a hint of tongue.
    # A D-shaped grin: flat along the top lip, round below.
    MG = M((0, -0.05, 0.094), (-0.15, 0, 0))
    head.append(ell(f'{cid}_Mouth', (0, 0, 0), (0.038, 0.026, 0.013), m['c2'], parent=MG, seg=(26, 14), deform=cut_above_local(MG, 0.004)))
    head.append(ell(f'{cid}_Teeth', (0, 0.0, 0.0045), (0.031, 0.0065, 0.009), m['white'], parent=MG, seg=(22, 10)))
    head.append(ell(f'{cid}_Tongue', (0, -0.014, 0.004), (0.02, 0.008, 0.009), m['accent'], parent=MG, seg=(16, 8)))
    head.append(strand(f'{cid}_Lip', [(-0.039, 0.004, 0.006), (-0.02, -0.024, 0.011), (0.0, -0.028, 0.012), (0.02, -0.024, 0.011), (0.039, 0.004, 0.006)],
                       0.0035, 0.0035, m['skin'], parent=MG, ring=6))

    # Hair: a scalp cap pulled back off the face, then ~45 clumps — a messy
    # fringe falling over the forehead, volume on top, flicks over the ears.
    def hairline(v):
        # Push the cap inside the skull where the face, ears and neck show.
        face = v.z > 0.02 and v.y < 0.062 - 0.25 * max(0.0, abs(v.x) - 0.05)
        ears = abs(v.x) > 0.085 and v.y < -0.005 and v.z > -0.04
        nape = v.y < -0.06
        if face or ears or nape:
            return v * 0.86
        return v
    head.append(ell(f'{cid}_HairCap', (0, 0.012, -0.006), (0.123, 0.115, 0.118), m['hair'], seg=(36, 24), deform=hairline, fuse=True))
    rng = np.random.default_rng(7)
    clumps = []
    # Fringe: roots along the front hairline, falling forward and down, swept to his right.
    for k in range(11):
        x = -0.085 + 0.017 * k + rng.normal(0, 0.004)
        root = Vector((x, 0.078 - 0.12 * x * x, 0.07))
        sweep = -0.025 + rng.normal(0, 0.012)
        mid = root + Vector((sweep * 0.6, 0.004 + rng.normal(0, 0.006), 0.035))
        tip = root + Vector((sweep, -0.03 - rng.random() * 0.025, 0.05 - 0.03 * abs(x) / 0.09))
        clumps.append(([root, mid, tip], 0.024 + rng.random() * 0.008))
    # Top and crown: up and back, tousled.
    for k in range(18):
        a = rng.random() * 2 * math.pi
        rr = 0.02 + rng.random() * 0.075
        root = Vector((math.cos(a) * rr, 0.0, math.sin(a) * rr * 0.9 - 0.01))
        root.y = math.sqrt(max(0.0, 0.112 ** 2 - root.x ** 2 - root.z ** 2)) * 0.98
        out = root.normalized()
        # Mostly lying back and to the sides, a few tufts sticking up: messy, not spiky.
        front = root.z > 0.03
        flow = Vector((rng.normal(0, 0.45), 0.18 + rng.random() * 0.2, (0.5 if front else -0.65) + rng.normal(0, 0.25))).normalized()
        d = (out * 0.45 + flow * 0.55).normalized()
        length = 0.035 + rng.random() * 0.03
        mid = root + d * length * 0.55
        tip = root + d * length + Vector((rng.normal(0, 0.012), -0.018, rng.normal(0, 0.01)))
        clumps.append(([root, mid, tip], 0.028 + rng.random() * 0.01))
    # Sides and back: down and back, flicking out at the ends.
    for k in range(16):
        a = math.pi * (0.15 + 0.7 * rng.random()) * (1 if k % 2 else -1) + math.pi / 2  # mostly sides/back
        side = Vector((math.cos(a), 0.0, -abs(math.sin(a)) * 0.9 - 0.1)).normalized()
        root = Vector((side.x * 0.1, 0.05 + rng.random() * 0.03, side.z * 0.1))
        # Falling down the back and sides, hugging the head, the tips only just flicking out.
        mid = root + side * 0.01 + Vector((0, -0.04, 0))
        tip = mid + side * 0.008 + Vector((rng.normal(0, 0.006), -0.035 - rng.random() * 0.015, 0))
        clumps.append(([root, mid, tip], 0.024 + rng.random() * 0.008))
    for i, (pts, r0) in enumerate(clumps):
        head.append(strand(f'{cid}_Hair{i}', pts, r0, 0.004, m['hair'], fuse=True, ring=10))
    for o in head:
        if o.name.startswith(f'{cid}_Hair'):
            o['budget'] = 3600

    # ---- hands: a wristband on the left; the snack bar in the right
    hand_l = mitten(cid, 'HandL', m, 'skin', 1)
    # Wristband, square to the forearm (which runs up and in toward the shoulder).
    hand_l.append(torus(f'{cid}_Band', (-0.008, 0.021, 0), 0.0175, 0.005, m['ink'], r=(math.pi / 2, 0.45, 0)))
    hand_r = mitten(cid, 'HandR', m, 'skin', -1)
    S = M((-0.006, 0.032, 0.024), (-0.25, 0, 0.32))
    hand_r += [
        rbox(f'{cid}_Snack', (0, 0, 0), (0.031, 0.15, 0.012), m['gold'], parent=S, bevel=0.004),
        rbox(f'{cid}_SnackBand', (0, 0.012, 0.0005), (0.0325, 0.036, 0.0128), m['accent'], parent=S, bevel=0.003),
        rbox(f'{cid}_SnackTop', (0, 0.06, 0.0005), (0.0325, 0.022, 0.0128), m['c1'], parent=S, bevel=0.003),
        rbox(f'{cid}_SnackLabel', (0, 0.012, 0.0068), (0.02, 0.016, 0.0015), m['white'], parent=S, bevel=0.0007),
        rbox(f'{cid}_CrimpTop', (0, 0.079, 0), (0.034, 0.008, 0.0045), m['gold'], parent=S, bevel=0.0015),
        rbox(f'{cid}_CrimpBot', (0, -0.079, 0), (0.034, 0.008, 0.0045), m['gold'], parent=S, bevel=0.0015),
    ]
    return {'Body': body, 'Head': head, 'HandL': hand_l, 'HandR': hand_r}


# --------------------------------------------------------------------------
# Mr. Stare: a tall brown dome, enormous unblinking eyes, a long nose, a
# thin droopy moustache — and a bow tie for occasions
# --------------------------------------------------------------------------

def starer(m):
    cid = 'starer'
    body, head = [], []
    body.append(ell(f'{cid}_Trunk', (0, 0.118, 0), (0.077, 0.088, 0.066), m['skin'], seg=(32, 20), fuse=True))
    body.append(cyl(f'{cid}_Neck', (0, 0.196, 0.004), 0.048, 0.07, m['skin'], fuse=True, r_top=0.044))
    for side in (-1, 1):
        body.append(ell(f'{cid}_Shoulder{side}', (side * 0.06, 0.16, 0), (0.03, 0.026, 0.03), m['skin'], fuse=True))
        body.append(ell(f'{cid}_Leg{side}', (side * 0.036, 0.048, 0.002), (0.027, 0.036, 0.027), m['skin'], fuse=True))
    body.append(ell(f'{cid}_Belly', (0, 0.105, 0.04), (0.055, 0.06, 0.035), m['c1'], seg=(24, 16)))
    # Bow tie in the player's colour.
    BT = M((0, 0.186, 0.058), (-0.25, 0, 0))
    for side in (-1, 1):
        body.append(ell(f'{cid}_Bow{side}', (side * 0.021, 0, 0), (0.021, 0.016, 0.008), m['main'], parent=BT, r=(0, 0, side * 0.25), seg=(18, 12),
                        deform=None))
    body.append(ell(f'{cid}_Knot', (0, 0, 0.004), (0.009, 0.01, 0.008), m['main'], parent=BT, seg=(12, 8)))
    sneakers(cid, m, body)

    def dome(v):
        # Tall rounded crown, a flatter face, a broad jaw that runs into the neck.
        if v.z > 0:
            v.z *= 0.92
        if v.y < -0.05:
            t = min(1.0, (-v.y - 0.05) / 0.09)
            v.x *= 1 + 0.06 * t
        return v
    head.append(ell(f'{cid}_Skull', (0, 0.012, 0), (0.106, 0.138, 0.1), m['skin'], seg=(36, 26), deform=dome, fuse=True))
    head.append(ell(f'{cid}_Brow', (0, 0.07, 0.07), (0.075, 0.02, 0.03), m['skin'], fuse=True))
    head.append(ell(f'{cid}_Jowl', (0, -0.075, 0.055), (0.082, 0.05, 0.05), m['skin'], fuse=True))
    # The nose: a long ridge from between the eyes to a round, lighter tip.
    head.append(strand(f'{cid}_NoseRidge', [(0, 0.03, 0.088), (0, 0.0, 0.103), (0, -0.026, 0.113)], 0.013, 0.016, m['skin'], fuse=True, ring=12))
    head.append(ell(f'{cid}_NoseTip', (0, -0.036, 0.116), (0.022, 0.018, 0.019), m['c1'], seg=(22, 14)))
    for side in (-1, 1):
        head.append(ell(f'{cid}_Nostril{side}', (side * 0.009, -0.049, 0.118), (0.0045, 0.003, 0.003), m['c2'], seg=(10, 6)))
    # Eyes: huge, round, wide open, set in darker sockets. They do not blink.
    for side in (-1, 1):
        G = M((side * 0.047, 0.034, 0.078), (0, side * 0.28, 0))
        head.append(torus(f'{cid}_Socket{side}', (0, 0, 0.004), 0.034, 0.0075, m['c2'], parent=G, seg=32, mseg=8))
        head.append(ell(f'{cid}_Sclera{side}', (0, 0, 0), (0.033, 0.033, 0.024), m['white'], parent=G, seg=(26, 18)))
        head.append(ell(f'{cid}_Pupil{side}', (0, 0, 0.022), (0.0165, 0.0165, 0.006), m['ink'], parent=G, seg=(20, 12)))
        head.append(ell(f'{cid}_Glint{side}', (-0.006, 0.007, 0.0262), (0.004, 0.004, 0.0015), m['white'], parent=G, seg=(10, 6)))
    # The moustache: one thin dark line, peaked under the nose, drooping at the ends.
    head.append(strand(f'{cid}_Moustache', [(-0.052, -0.088, 0.078), (-0.03, -0.068, 0.1), (0, -0.058, 0.112),
                                            (0.03, -0.068, 0.1), (0.052, -0.088, 0.078)], 0.0055, 0.0045, m['ink'], ring=8))
    hand_l = mitten(cid, 'HandL', m, 'skin', 1)
    hand_r = mitten(cid, 'HandR', m, 'skin', -1)
    return {'Body': body, 'Head': head, 'HandL': hand_l, 'HandR': hand_r}


BUILDERS = {'snacky': snacky, 'starer': starer}

# Shoulder points and limb radius (mirrors `arms` in looks.tsx) — used only to
# draw arms in preview renders; the game builds the limbs itself.
ARMS = {'snacky': ((0.085, 0.165, 0.0), 0.019), 'starer': ((0.072, 0.16, 0.0), 0.018)}


# --------------------------------------------------------------------------
# The original eight, rebuilt in the same detailed style
# --------------------------------------------------------------------------

def eyes(cid, head, m, y=0.005, gap=0.042, z=0.096, size=(0.021, 0.024), iris='c3', yaw=0.36,
         slit=False, lids=True, pupil=1.0, blink=True):
    """A pair of toon eyes: white, coloured iris, pupil, catchlight and an upper lid line."""
    for side in (-1, 1):
        G = M((side * gap, y, z), (0, side * yaw, 0))
        rx, ry = size
        head.append(ell(f'{cid}_Sclera{side}', (0, 0, 0), (rx, ry, rx * 0.55), m['white'], parent=G, seg=(20, 14)))
        head.append(ell(f'{cid}_Iris{side}', (0, -ry * 0.05, rx * 0.36), (rx * 0.74, ry * 0.72, rx * 0.28), m[iris], parent=G, seg=(18, 12)))
        pr = (rx * 0.22, ry * 0.6) if slit else (rx * 0.38 * pupil, ry * 0.4 * pupil)
        head.append(ell(f'{cid}_Pupil{side}', (0, -ry * 0.05, rx * 0.55), (pr[0], pr[1], rx * 0.14), m['ink'], parent=G, seg=(14, 10)))
        head.append(ell(f'{cid}_Glint{side}', (-rx * 0.28, ry * 0.3, rx * 0.64), (rx * 0.21, rx * 0.21, rx * 0.08), m['white'], parent=G, seg=(10, 6)))
        if blink:
            blink_lid(cid, head, m, G, side, (rx, ry, rx * 0.55))
        if lids:
            head.append(strand(f'{cid}_Lid{side}', [(-rx * 1.08, ry * 0.2, rx * 0.25), (-rx * 0.5, ry * 0.92, rx * 0.45),
                                                     (rx * 0.5, ry * 0.95, rx * 0.45), (rx * 1.08, ry * 0.35, rx * 0.25)],
                               0.0028, 0.002, m['ink'], parent=G, ring=6))


# What colour each character's eyelids are: the skin around the eyes.
LID_MATS = {'spiky': 'main', 'cat': 'main', 'alien': 'main'}


def blink_lid(cid, head, m, G, side, rad):
    """An eyelid the game closes to blink: a shell just over the eye, hinged along its top.

    build_detailed splits it off as LidL / LidR, re-centred on the hinge (kept in the
    node's extras), and the game folds it up out of sight between blinks."""
    rx, ry, rz = rad
    o = ell(f'{cid}_BlinkLid{side}', (0, 0, rz * 0.12), (rx * 1.14, ry * 1.12, rz * 1.22), m[LID_MATS.get(cid, 'skin')],
            parent=G, seg=(20, 12))
    o['hinge'] = tuple(G @ Vector((0, ry * 1.08, rz * 0.4)))
    o['side'] = side
    head.append(o)


def legs(cid, m, out, mat, top=0.075, x=0.034, r=0.025):
    out.append(ell(f'{cid}_Hips', (0, top - 0.005, 0), (0.066, 0.028, 0.054), m[mat], fuse=True))
    for side in (-1, 1):
        out.append(strand(f'{cid}_Leg{side}', [(side * x, top, 0), (side * (x + 0.004), 0.05, 0.002), (side * (x + 0.007), 0.03, 0.006)],
                          r, r * 0.9, m[mat], fuse=True))


def boots(cid, m, out, mat, cuff=None):
    for side in (-1, 1):
        x = side * 0.042
        out.append(ell(f'{cid}_Boot{side}', (x, 0.026, 0.012), (0.033, 0.027, 0.052), m[mat], seg=(20, 12)))
        out.append(ell(f'{cid}_BootSole{side}', (x, 0.008, 0.013), (0.035, 0.009, 0.054), m['ink'], seg=(18, 8), deform=cut_above(0.01)))
        if cuff:
            out.append(torus(f'{cid}_BootCuff{side}', (x, 0.047, 0.004), 0.027, 0.006, m[cuff], r=(math.pi / 2, 0, 0)))


def spiky(m):
    cid = 'spiky'
    body, head = [], []
    body.append(ell(f'{cid}_Trunk', (0, 0.122, 0), (0.07, 0.074, 0.06), m['main'], fuse=True))
    for k, (y, rz) in enumerate([(0.15, 0.0), (0.12, 0.5), (0.12, -0.5)]):
        body.append(strand(f'{cid}_BackQuill{k}', [(rz * 0.05, y, -0.04), (rz * 0.07, y - 0.01, -0.085), (rz * 0.08, y - 0.03, -0.11)],
                           0.022, 0.003, m['main'], fuse=True, round_tip=False))
    body.append(ell(f'{cid}_Belly', (0, 0.115, 0.038), (0.05, 0.056, 0.03), m['skin']))
    legs(cid, m, body, 'main', top=0.07)
    sneakers(cid, m, body, shoe='accent')
    for side in (-1, 1):
        body.append(rbox(f'{cid}_Strap{side}', (side * 0.042, 0.04, 0.022), (0.05, 0.01, 0.03), m['white'], r=(-0.3, 0, 0), bevel=0.003))
    head.append(ell(f'{cid}_Skull', (0, 0, 0), (0.108, 0.103, 0.1), m['main'], seg=(32, 22), fuse=True))
    # Quills: big swept-back spines, the silhouette that reads from the table camera.
    for k, (ax, ay, len_, r0) in enumerate([(0.0, 0.075, 0.15, 0.04), (-0.05, 0.055, 0.14, 0.036), (0.05, 0.055, 0.14, 0.036),
                                             (-0.075, 0.0, 0.12, 0.034), (0.075, 0.0, 0.12, 0.034), (-0.035, -0.045, 0.12, 0.032),
                                             (0.035, -0.045, 0.12, 0.032), (0.0, 0.02, 0.16, 0.04), (0.0, -0.06, 0.1, 0.03)]):
        root = Vector((ax, ay, -0.02))
        tip = Vector((ax * 1.6, ay * 0.6 - 0.03, -0.04 - len_))
        mid = root.lerp(tip, 0.5) + Vector((0, 0.02, 0))
        head.append(strand(f'{cid}_Quill{k}', [root, mid, tip], r0, 0.003, m['main'], fuse=True, round_tip=False))
    # Side spines fanning out past the cheeks and a crest over the crown, so the
    # spiky outline also reads from the front.
    for k, (ax, ay, dx, dy, len_, r0) in enumerate([(0.085, 0.045, 1.0, 0.55, 0.09, 0.03), (0.09, -0.005, 1.0, 0.1, 0.085, 0.028),
                                                    (0.08, -0.05, 0.9, -0.35, 0.07, 0.024)]):
        for side in (-1, 1):
            root = Vector((side * ax, ay, -0.03))
            d = Vector((side * dx, dy, -0.75)).normalized()
            tip = root + d * len_
            mid = root.lerp(tip, 0.5) + Vector((0, 0.012, 0))
            head.append(strand(f'{cid}_SideQuill{k}{side}', [root, mid, tip], r0, 0.003, m['main'], fuse=True, round_tip=False))
    for k, (ax, tilt) in enumerate([(-0.03, -0.35), (0.0, 0.0), (0.03, 0.35)]):
        root = Vector((ax, 0.085, -0.01))
        tip = root + Vector((tilt * 0.06, 0.06, -0.05))
        head.append(strand(f'{cid}_Crest{k}', [root, root.lerp(tip, 0.5) + Vector((0, 0.008, 0.006)), tip], 0.026, 0.003, m['main'],
                           fuse=True, round_tip=False))
    for side in (-1, 1):
        head.append(strand(f'{cid}_Ear{side}', [(side * 0.062, 0.07, 0.01), (side * 0.075, 0.1, 0.0), (side * 0.08, 0.125, -0.012)],
                           0.024, 0.004, m['main'], fuse=True, round_tip=False))
        head.append(ell(f'{cid}_EarIn{side}', (side * 0.068, 0.088, 0.016), (0.012, 0.018, 0.005), m['skin'], r=(0, 0, -side * 0.3)))
    head.append(ell(f'{cid}_Muzzle', (0, -0.036, 0.07), (0.064, 0.044, 0.046), m['skin'], seg=(24, 16)))
    head.append(ell(f'{cid}_Nose', (0, -0.016, 0.114), (0.017, 0.013, 0.012), m['ink'], seg=(14, 10)))
    head.append(ell(f'{cid}_NoseGlint', (-0.005, -0.011, 0.123), (0.004, 0.003, 0.002), m['white'], seg=(8, 6)))
    head.append(strand(f'{cid}_Smile', [(-0.03, -0.05, 0.1), (-0.012, -0.062, 0.112), (0.012, -0.062, 0.112), (0.034, -0.046, 0.1)],
                       0.0032, 0.0025, m['ink'], ring=6))
    eyes(cid, head, m, y=0.022, gap=0.034, z=0.088, size=(0.024, 0.03), iris='c1', yaw=0.3)
    hl = mitten(cid, 'HandL', m, 'white', 1) + [torus(f'{cid}_CuffL', (0, 0.022, 0), 0.023, 0.007, m['white'], r=(math.pi / 2, 0.45, 0))]
    hr = mitten(cid, 'HandR', m, 'white', -1) + [torus(f'{cid}_CuffR', (0, 0.022, 0), 0.023, 0.007, m['white'], r=(math.pi / 2, -0.45, 0))]
    return {'Body': body, 'Head': head, 'HandL': hl, 'HandR': hr}


def robot(m):
    cid = 'robot'
    body, head = [], []
    body.append(rbox(f'{cid}_Chest', (0, 0.128, 0), (0.15, 0.12, 0.11), m['main'], bevel=0.022))
    # Chest screen in a metal bezel: a round gauge on the left, two status lights on the right.
    body.append(rbox(f'{cid}_Bezel', (0, 0.137, 0.0545), (0.096, 0.064, 0.005), m['metal'], bevel=0.005))
    body.append(rbox(f'{cid}_Panel', (0, 0.137, 0.056), (0.086, 0.054, 0.006), m['glass'], bevel=0.006))
    gx, gy = -0.017, 0.136
    body.append(torus(f'{cid}_Gauge', (gx, gy, 0.0595), 0.0145, 0.0022, m['metal'], seg=24, mseg=6))
    body.append(strand(f'{cid}_GaugeArc', [(gx + 0.0098 * math.sin(t), gy + 0.0098 * math.cos(t), 0.0596) for t in (-2.0, -1.0, 0.0, 1.0, 2.0)],
                       0.0016, 0.0016, m['glow'], ring=5))
    na = -0.75
    body.append(rbox(f'{cid}_Needle', (gx - math.sin(na) * 0.005, gy + math.cos(na) * 0.005, 0.0602), (0.0022, 0.012, 0.0014), m['accent'],
                     r=(0, 0, na), bevel=0.0006, segs=1))
    body.append(ell(f'{cid}_GaugeHub', (gx, gy, 0.0605), (0.003, 0.003, 0.0016), m['accent'], seg=(10, 6)))
    for k, (y, key) in enumerate([(0.149, 'glow'), (0.125, 'accent')]):
        body.append(ell(f'{cid}_Light{k}', (0.021, y, 0.0598), (0.0075, 0.0075, 0.0032), m[key], seg=(12, 8)))
        body.append(rbox(f'{cid}_Readout{k}', (0.036, y, 0.0592), (0.008, 0.0028, 0.0012), m['glow'], bevel=0.0005, segs=1))
    # Belly plate with vent slots, four corner rivets, seams round the sides and a hatch on the back.
    body.append(rbox(f'{cid}_BellyPlate', (0, 0.0915, 0.0545), (0.096, 0.022, 0.004), m['metal'], bevel=0.003))
    for k in range(3):
        body.append(rbox(f'{cid}_Vent{k}', (0, 0.0975 - k * 0.006, 0.0568), (0.06, 0.0028, 0.002), m['ink'], bevel=0.0008, segs=1))
    for sx in (-1, 1):
        for k, y in enumerate((0.168, 0.09)):
            body.append(ell(f'{cid}_Rivet{sx}{k}', (sx * 0.0615, y, 0.054), (0.0045, 0.0045, 0.0035), m['metal'], seg=(10, 6)))
        body.append(rbox(f'{cid}_SideSeam{sx}', (sx * 0.0752, 0.128, 0), (0.002, 0.0024, 0.07), m['ink'], bevel=0.0006, segs=1))
    body.append(rbox(f'{cid}_Hatch', (0, 0.135, -0.0555), (0.084, 0.064, 0.004), m['metal'], bevel=0.004))
    for k in range(2):
        body.append(rbox(f'{cid}_HatchVent{k}', (0, 0.143 - k * 0.012, -0.0578), (0.05, 0.0035, 0.002), m['ink'], bevel=0.0008, segs=1))
    body.append(cyl(f'{cid}_Neck', (0, 0.2, 0), 0.025, 0.04, m['metal']))
    body.append(torus(f'{cid}_NeckRing', (0, 0.197, 0), 0.025, 0.003, m['ink'], r=(math.pi / 2, 0, 0), seg=20, mseg=6))
    body.append(cyl(f'{cid}_Waist', (0, 0.064, 0), 0.05, 0.03, m['metal']))
    body.append(torus(f'{cid}_WaistRing', (0, 0.058, 0), 0.05, 0.0028, m['ink'], r=(math.pi / 2, 0, 0), seg=24, mseg=6))
    for side in (-1, 1):
        body.append(ell(f'{cid}_ShoulderJoint{side}', (side * 0.08, 0.165, 0), (0.024, 0.024, 0.024), m['metal']))
        body.append(torus(f'{cid}_ShoulderRing{side}', (side * 0.091, 0.165, 0), 0.017, 0.0042, m['main'], r=(0, math.pi / 2, 0), seg=20, mseg=6))
        body.append(cyl(f'{cid}_ShoulderNut{side}', (side * 0.102, 0.165, 0), 0.008, 0.005, m['metal'], r=(0, 0, math.pi / 2), seg=6))
        body.append(cyl(f'{cid}_Leg{side}', (side * 0.034, 0.045, 0), 0.016, 0.04, m['metal']))
        body.append(rbox(f'{cid}_Foot{side}', (side * 0.042, 0.018, 0.012), (0.054, 0.034, 0.08), m['main'], bevel=0.012))
        body.append(rbox(f'{cid}_Tread{side}', (side * 0.042, 0.004, 0.012), (0.058, 0.008, 0.084), m['ink'], bevel=0.003))
        body.append(rbox(f'{cid}_ToeCap{side}', (side * 0.042, 0.016, 0.0485), (0.05, 0.02, 0.014), m['metal'], bevel=0.006))
        body.append(cyl(f'{cid}_FootAnkle{side}', (side * 0.042, 0.038, 0.006), 0.018, 0.01, m['metal'], seg=16))
    head.append(rbox(f'{cid}_Head', (0, 0, 0), (0.2, 0.16, 0.17), m['metal'], bevel=0.03))
    # A frame in the player's colour round the visor, a mouth grille, rivets and side seams.
    head.append(rbox(f'{cid}_VisorFrame', (0, 0.006, 0.0815), (0.18, 0.09, 0.008), m['main'], bevel=0.01))
    head.append(rbox(f'{cid}_Visor', (0, 0.006, 0.084), (0.168, 0.078, 0.012), m['glass'], bevel=0.012))
    for side in (-1, 1):
        head.append(ell(f'{cid}_Eye{side}', (side * 0.038, 0.01, 0.091), (0.022, 0.017, 0.005), m['glow'], seg=(18, 10)))
        head.append(ell(f'{cid}_EyeShine{side}', (side * 0.038 - 0.008, 0.016, 0.0948), (0.005, 0.0035, 0.0015), m['white'], seg=(10, 6)))
        # Ear bolts: a flared collar, a ring, a hex nut and a domed cap.
        head.append(cyl(f'{cid}_Bolt{side}', (side * 0.107, 0, 0), 0.034, 0.018, m['main'], r=(0, 0, -side * math.pi / 2), r_top=0.027, seg=24))
        head.append(torus(f'{cid}_BoltRing{side}', (side * 0.117, 0, 0), 0.022, 0.0035, m['metal'], r=(0, math.pi / 2, 0), seg=24, mseg=6))
        head.append(cyl(f'{cid}_BoltNut{side}', (side * 0.121, 0, 0), 0.016, 0.012, m['metal'], r=(0, 0, math.pi / 2), seg=6))
        head.append(ell(f'{cid}_BoltCap{side}', (side * 0.1275, 0, 0), (0.004, 0.009, 0.009), m['accent'], seg=(12, 8)))
        head.append(rbox(f'{cid}_HeadSeam{side}', (side * 0.1004, 0.046, 0), (0.002, 0.0024, 0.11), m['ink'], bevel=0.0006, segs=1))
        for k, y in enumerate((0.066, -0.064)):
            head.append(ell(f'{cid}_HeadRivet{side}{k}', (side * 0.077, y, 0.0795), (0.0045, 0.0045, 0.0035), m['metal'], seg=(10, 6)))
    head.append(rbox(f'{cid}_MouthPlate', (0, -0.055, 0.0845), (0.072, 0.026, 0.004), m['ink'], bevel=0.003))
    for k in range(5):
        head.append(rbox(f'{cid}_Grille{k}', (-0.024 + k * 0.012, -0.055, 0.0865), (0.005, 0.017, 0.002), m['metal'], bevel=0.001, segs=1))
    head.append(rbox(f'{cid}_TopPlate', (0, 0.083, 0), (0.12, 0.012, 0.11), m['main'], bevel=0.005))
    # Antenna: a dome, a rod with two collars, a glowing bulb in an orbit ring.
    head.append(ell(f'{cid}_AntennaBase', (0, 0.089, 0), (0.024, 0.012, 0.024), m['main'], seg=(18, 10)))
    head.append(cyl(f'{cid}_Antenna', (0, 0.125, 0), 0.005, 0.06, m['metal'], seg=10))
    for k, y in enumerate((0.104, 0.13)):
        head.append(torus(f'{cid}_AntennaCollar{k}', (0, y, 0), 0.0065, 0.0025, m['ink'], r=(math.pi / 2, 0, 0), seg=12, mseg=6))
    head.append(ell(f'{cid}_AntennaBall', (0, 0.165, 0), (0.017, 0.017, 0.017), m['glow'], seg=(16, 10)))
    head.append(torus(f'{cid}_AntennaOrbit', (0, 0.165, 0), 0.026, 0.0025, m['accent'], r=(math.pi / 2 - 0.4, 0, 0.3), seg=28, mseg=6))

    def claw(part, side):
        return [ell(f'{cid}_{part}Palm', (0, 0, 0), (0.024, 0.022, 0.022), m['metal']),
                torus(f'{cid}_{part}Wrist', (0, 0.018, 0), 0.02, 0.005, m['main'], r=(math.pi / 2, 0, 0), seg=20, mseg=6),
                rbox(f'{cid}_{part}FingerA', (0.008, -0.022, 0.008), (0.01, 0.024, 0.01), m['main'], r=(0.2, 0, 0.2), bevel=0.003),
                rbox(f'{cid}_{part}FingerB', (-0.008, -0.022, 0.008), (0.01, 0.024, 0.01), m['main'], r=(0.2, 0, -0.2), bevel=0.003)]
    return {'Body': body, 'Head': head, 'HandL': claw('HandL', 1), 'HandR': claw('HandR', -1)}


def cat(m):
    cid = 'cat'
    body, head = [], []
    body.append(ell(f'{cid}_Trunk', (0, 0.118, 0), (0.07, 0.075, 0.06), m['main'], fuse=True))
    body.append(ell(f'{cid}_Belly', (0, 0.108, 0.04), (0.045, 0.054, 0.028), m['white'], fuse=True))
    # A ruff of white chest fur: pointed tufts spilling over the top of the belly.
    for k, (x, y, ln) in enumerate([(-0.024, 0.163, 0.03), (0.0, 0.168, 0.036), (0.024, 0.163, 0.03), (-0.013, 0.15, 0.028), (0.013, 0.15, 0.028)]):
        z0 = ell_z(((0, 0.118, 0), (0.07, 0.075, 0.06)), x, y) - 0.006
        body.append(strand(f'{cid}_ChestTuft{k}', [(x, y, z0), (x * 1.15, y - ln * 0.5, z0 + 0.012), (x * 1.25, y - ln, z0 + 0.014)],
                           0.013, 0.002, m['white'], fuse=True, round_tip=False))
    legs(cid, m, body, 'main', top=0.07)
    for side in (-1, 1):
        x = side * 0.042
        body.append(ell(f'{cid}_Paw{side}', (x, 0.018, 0.014), (0.032, 0.02, 0.042), m['white'], seg=(20, 12)))
        # Three toes across the front of each paw, a pink bean under each and a big pad behind.
        for t in range(3):
            tx = x + (t - 1) * 0.0165
            body.append(ell(f'{cid}_Toe{side}{t}', (tx, 0.02, 0.043 - abs(t - 1) * 0.004), (0.0105, 0.0125, 0.0135), m['white'], seg=(12, 8)))
            body.append(ell(f'{cid}_ToeBean{side}{t}', (tx, 0.0115, 0.0555 - abs(t - 1) * 0.004), (0.0052, 0.0042, 0.0025), m['accent'],
                            r=(0.5, 0, 0), seg=(10, 6)))
        body.append(ell(f'{cid}_ToePad{side}', (x, 0.0085, 0.062), (0.0095, 0.0045, 0.003), m['accent'], r=(0.6, 0, 0), seg=(12, 6)))
    # A long tail with a fluffy white tip and two white rings.
    tail_pts = [(0, 0.09, -0.055), (0.03, 0.1, -0.11), (0.05, 0.17, -0.11), (0.03, 0.23, -0.08), (0.0, 0.24, -0.06)]
    body.append(strand(f'{cid}_Tail', tail_pts, 0.018, 0.013, m['main'], ring=12))
    path = _spline(tail_pts)
    n = len(path)
    body.append(strand(f'{cid}_TailTip', path[int(n * 0.8):], 0.0155, 0.0145, m['white'], ring=12))
    for k, t in enumerate((0.45, 0.63)):
        i = int(t * (n - 1))
        d = path[i + 1] - path[i - 1]
        body.append(torus(f'{cid}_TailRing{k}', (0, 0, 0), 0.018 - 0.005 * t - 0.002, 0.005, m['white'], parent=frame_z(path[i], d),
                          seg=18, mseg=6))
    # Collar with a little gold bell.
    body.append(torus(f'{cid}_Collar', (0, 0.19, 0.002), 0.041, 0.0075, m['c1'], r=(math.pi / 2 - 0.1, 0, 0), seg=28, mseg=8))
    body.append(ell(f'{cid}_Bell', (0, 0.174, 0.05), (0.0115, 0.011, 0.0115), m['gold'], seg=(16, 10)))
    body.append(torus(f'{cid}_BellBand', (0, 0.176, 0.05), 0.0114, 0.0015, m['gold'], r=(math.pi / 2, 0, 0), seg=18, mseg=5))
    body.append(torus(f'{cid}_BellLoop', (0, 0.1865, 0.048), 0.0038, 0.0014, m['gold'], seg=12, mseg=5))
    body.append(ell(f'{cid}_BellSlit', (0, 0.169, 0.0598), (0.0075, 0.0016, 0.0025), m['ink'], seg=(10, 6)))
    body.append(ell(f'{cid}_BellHole', (0, 0.1675, 0.0585), (0.0028, 0.0028, 0.0022), m['ink'], seg=(8, 6)))
    head.append(ell(f'{cid}_Skull', (0, 0, 0), (0.114, 0.098, 0.103), m['main'], seg=(32, 22), fuse=True))
    for side in (-1, 1):
        head.append(ell(f'{cid}_Fluff{side}', (side * 0.09, -0.04, 0.035), (0.04, 0.032, 0.04), m['main'], fuse=True))
        # Cheek tufts: pointed fur fanning out and down past the jaw.
        for k, (y, dy, ln) in enumerate([(-0.022, 0.004, 0.05), (-0.042, -0.012, 0.055), (-0.06, -0.026, 0.042)]):
            root = Vector((side * 0.095, y, 0.028))
            tip = root + Vector((side * ln, dy, -0.012))
            head.append(strand(f'{cid}_CheekTuft{side}{k}', [root, root.lerp(tip, 0.5) + Vector((0, 0.004, 0)), tip], 0.016, 0.002, m['main'],
                               fuse=True, round_tip=False))
        head.append(strand(f'{cid}_Ear{side}', [(side * 0.06, 0.06, 0.0), (side * 0.072, 0.11, -0.004), (side * 0.08, 0.15, -0.008)],
                           0.04, 0.003, m['main'], fuse=True, round_tip=False))
        head.append(ell(f'{cid}_EarIn{side}', (side * 0.066, 0.096, 0.026), (0.018, 0.03, 0.006), m['accent'], r=(-0.1, 0, -side * 0.18)))
        # Wisps of white fur curling out of each ear.
        for k, (dx, ln) in enumerate([(-0.006, 0.03), (0.005, 0.036)]):
            head.append(strand(f'{cid}_EarTuft{side}{k}', [(side * (0.064 + dx), 0.074, 0.029), (side * (0.068 + dx * 1.4), 0.074 + ln * 0.5, 0.031),
                                                           (side * (0.075 + dx * 2), 0.074 + ln, 0.025)], 0.0045, 0.0008, m['white'], ring=6,
                               round_tip=False))
        for k, dy in enumerate((-0.006, 0.006, 0.018)):
            head.append(strand(f'{cid}_Whisker{side}{k}', [(side * 0.04, -0.045 + dy * 0.3, 0.1), (side * 0.09, -0.04 + dy, 0.098), (side * 0.14, -0.035 + dy * 1.6, 0.085)],
                               0.0016, 0.0009, m['ink'], ring=5))
        # Whisker pads: two plump white cheeks either side of the nose, freckled with whisker roots.
        head.append(ell(f'{cid}_WhiskerPad{side}', (side * 0.017, -0.047, 0.1), (0.021, 0.016, 0.015), m['white'], seg=(16, 10)))
        for k, (fx, fy) in enumerate([(0.016, -0.04), (0.024, -0.045), (0.018, -0.051)]):
            head.append(ell(f'{cid}_Freckle{side}{k}', on_ell(((side * 0.017, -0.047, 0.1), (0.021, 0.016, 0.015)), side * fx, fy).translation[:],
                            (0.0018, 0.0018, 0.0012), m['ink'], seg=(6, 4)))
    # A little tuft on the crown.
    for k, dx in enumerate((-0.012, 0.0, 0.012)):
        head.append(strand(f'{cid}_Crown{k}', [(dx, 0.09, 0.02), (dx * 1.3, 0.106, 0.034), (dx * 2.0 + 0.004, 0.112, 0.05)],
                           0.009, 0.0015, m['main'], fuse=True, round_tip=False))
    head.append(ell(f'{cid}_Muzzle', (0, -0.045, 0.08), (0.054, 0.034, 0.036), m['white'], seg=(24, 14)))
    head.append(ell(f'{cid}_Nose', (0, -0.026, 0.115), (0.012, 0.008, 0.008), m['accent'], seg=(14, 8)))
    head.append(ell(f'{cid}_NoseGlint', (-0.004, -0.0225, 0.1225), (0.003, 0.002, 0.0012), m['white'], seg=(8, 6)))
    head.append(strand(f'{cid}_Mouth', [(-0.018, -0.056, 0.113), (-0.008, -0.062, 0.116), (0, -0.054, 0.118), (0.008, -0.062, 0.116), (0.018, -0.056, 0.113)],
                       0.0022, 0.0022, m['ink'], ring=5))
    eyes(cid, head, m, y=0.012, gap=0.04, z=0.09, size=(0.024, 0.028), iris='c1', yaw=0.38, slit=True)
    return {'Body': body, 'Head': head, 'HandL': mitten(cid, 'HandL', m, 'main', 1), 'HandR': mitten(cid, 'HandR', m, 'main', -1)}


def knight(m):
    cid = 'knight'
    body, head = [], []
    TU = ((0, 0.115, 0), (0.078, 0.08, 0.064))
    BP = ((0, 0.14, 0.012), (0.07, 0.06, 0.056))
    body.append(ell(f'{cid}_Tunic', TU[0], TU[1], m['main'], fuse=True))
    body.append(ell(f'{cid}_Breastplate', BP[0], BP[1], m['metal'], seg=(28, 18), deform=lambda v: Vector((v.x, max(v.y, 0.1), v.z))))
    # Plate edge: a rolled rim along the bottom of the breastplate, and gold rivets down its sides.
    ry = math.sqrt(1 - ((0.1 - 0.14) / 0.06) ** 2)
    body.append(loop(f'{cid}_PlateRim', [(0.07 * ry * math.sin(a), 0.1, 0.012 + 0.056 * ry * math.cos(a)) for a in (2 * math.pi * k / 10 for k in range(10))],
                     0.0035, m['metal'], ring=6, n=4))
    for sx in (-1, 1):
        for k, y in enumerate((0.165, 0.137, 0.11)):
            body.append(ell(f'{cid}_Rivet{sx}{k}', tuple(on_ell(BP, sx * 0.054, y).translation), (0.0038, 0.0038, 0.003), m['accent'], seg=(10, 6)))
    # The surcoat: a panel in the player's colour over the breastplate, trimmed in gold, with a star on it;
    # it carries on below the belt as a tabard flap.
    panel, edge = sheet(f'{cid}_Surcoat', ell_surf(BP), 0, lambda t: 0.032 + 0.01 * t, 0.182, 0.1, 0.0012, 0.004, m['main'], nu=8, nv=8)
    body.append(panel)
    body.append(loop(f'{cid}_SurcoatTrim', edge[::2], 0.0024, m['accent'], axis=(0, 0, 1), ring=6, n=3))
    body.append(star(f'{cid}_Emblem', on_ell(BP, 0, 0.142, lift=0.004), 0.019, 0.008, 0.005, m['accent']))
    flap, fedge = sheet(f'{cid}_Tabard', lambda x, y: Vector((x, y, ell_z(TU, x, max(y, 0.086)))), 0, lambda t: 0.034 - 0.006 * t,
                        0.088, 0.034, 0.002, 0.004, m['main'], nu=8, nv=6)
    body.append(flap)
    body.append(loop(f'{cid}_TabardTrim', fedge[::2], 0.0024, m['accent'], axis=(0, 0, 1), ring=6, n=3))
    body.append(torus(f'{cid}_Belt', (0, 0.09, 0), 0.071, 0.008, m['ink'], r=(math.pi / 2, 0, 0)))
    body.append(rbox(f'{cid}_Buckle', (0, 0.09, 0.074), (0.024, 0.019, 0.005), m['accent'], bevel=0.002))
    body.append(rbox(f'{cid}_BuckleIn', (0, 0.09, 0.0765), (0.013, 0.009, 0.002), m['ink'], bevel=0.001, segs=1))
    for side in (-1, 1):
        body.append(ell(f'{cid}_Pauldron{side}', (side * 0.074, 0.172, 0), (0.036, 0.022, 0.036), m['metal'], r=(0, 0, -side * 0.35)))
        body.append(ell(f'{cid}_Lame{side}', (side * 0.084, 0.157, 0), (0.032, 0.016, 0.034), m['metal'], r=(0, 0, -side * 0.6)))
        body.append(torus(f'{cid}_PauldronTrim{side}', (side * 0.074, 0.172, 0), 0.0345, 0.0028, m['accent'], r=(math.pi / 2, -side * 0.35, 0),
                          seg=24, mseg=6))
        body.append(ell(f'{cid}_PauldronRivet{side}', (side * 0.07, 0.195, 0.012), (0.004, 0.004, 0.004), m['accent'], seg=(10, 6)))
    legs(cid, m, body, 'metal', top=0.07)
    boots(cid, m, body, 'metal', cuff='accent')
    HE = ((0, 0.008, 0), (0.11, 0.122, 0.108))
    head.append(ell(f'{cid}_Helm', HE[0], HE[1], m['metal'], seg=(32, 22), fuse=True))
    head.append(ell(f'{cid}_HelmRidge', (0, 0.06, 0.0), (0.012, 0.075, 0.11), m['metal'], fuse=True))
    # The visor: a raised plate edged in gold, with two eye slits, breaths and a centre ridge.
    plate, pedge = sheet(f'{cid}_Faceplate', ell_surf(HE), 0, lambda t: 0.074 - 0.02 * t * t, 0.05, -0.068, 0.0015, 0.007, m['metal'],
                         nu=10, nv=8)
    head.append(plate)
    head.append(loop(f'{cid}_FaceTrim', pedge[::2], 0.0026, m['accent'], axis=(0, 0, 1), ring=6, n=3))
    for side in (-1, 1):
        head.append(rbox(f'{cid}_Slit{side}', (0, 0, 0), (0.046, 0.008, 0.01), m['ink'], r=(0, 0, side * 0.1),
                         parent=on_ell(HE, side * 0.036, 0.014, lift=-0.002), bevel=0.0025))
        for row, y in enumerate((-0.028, -0.043)):
            for k, x in enumerate((0.022, 0.034, 0.046)):
                head.append(ell(f'{cid}_Breath{side}{row}{k}', tuple(on_ell(HE, side * x, y, lift=0.001).translation),
                                (0.0034, 0.0034, 0.0025), m['ink'], seg=(8, 6)))
        head.append(ell(f'{cid}_Hinge{side}', tuple(on_ell(HE, side * 0.098, 0.01, lift=0.001).translation), (0.008, 0.008, 0.008), m['accent'],
                        seg=(12, 8)))
    head.append(strand(f'{cid}_VisorRidge', [tuple(on_ell(HE, 0, y, lift=0.006).translation) for y in (0.045, 0.0, -0.035, -0.066)],
                       0.0045, 0.0035, m['metal'], ring=8))
    head.append(torus(f'{cid}_Rim', (0, -0.075, 0.0), 0.095, 0.008, m['accent'], r=(math.pi / 2, 0, 0)))
    # The plume: a gold holder and a fan of curling feathers.
    head.append(cyl(f'{cid}_PlumeHolder', (0, 0.124, 0.016), 0.012, 0.022, m['accent'], r=(-0.35, 0, 0), seg=14, r_top=0.009))
    rng = np.random.default_rng(3)
    for k in range(12):
        lane = (k % 3) - 1
        f = k / 11
        root = Vector((lane * 0.006, 0.13, 0.02 - f * 0.012))
        tip = Vector((lane * 0.022 + rng.normal(0, 0.004), 0.185 - f * 0.07 - abs(lane) * 0.01, -0.01 - f * 0.11))
        mid = root.lerp(tip, 0.45) + Vector((lane * 0.006, 0.035 - f * 0.01, 0.01))
        head.append(strand(f'{cid}_Plume{k}', [root, mid, tip], 0.016 - abs(lane) * 0.003, 0.0055, m['c1'], ring=7))
    # Gauntlets: flared cuffs with a gold rim.
    def gauntlet(part, side):
        return mitten(cid, part, m, 'metal', side) + [
            cyl(f'{cid}_{part}Gauntlet', (0, 0.028, 0), 0.021, 0.022, m['metal'], seg=18, r_top=0.028),
            torus(f'{cid}_{part}GauntletRim', (0, 0.039, 0), 0.028, 0.003, m['accent'], r=(math.pi / 2, 0, 0), seg=20, mseg=6),
            strand(f'{cid}_{part}Knuckles', [(-0.02, -0.006, 0.014), (0, -0.004, 0.02), (0.02, -0.006, 0.014)], 0.004, 0.004, m['accent'], ring=6)]
    hl = gauntlet('HandL', 1)
    SH = M((0.012, 0.0, 0.03), (0, 0.5, 0))
    hl += [cyl(f'{cid}_Shield', (0, 0, 0), 0.065, 0.012, m['main'], r=(math.pi / 2, 0, 0), parent=SH, seg=28),
           torus(f'{cid}_ShieldRim', (0, 0, 0.0), 0.065, 0.007, m['accent'], parent=SH),
           star(f'{cid}_ShieldStar', SH @ M((0, 0, 0.0075)), 0.036, 0.015, 0.006, m['accent'])]
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        hl.append(ell(f'{cid}_ShieldRivet{k}', (0.053 * math.cos(a), 0.053 * math.sin(a), 0.0068), (0.0035, 0.0035, 0.0025), m['accent'],
                      parent=SH, seg=(8, 6)))
    hr = gauntlet('HandR', -1)
    SW = M((-0.004, 0.0, 0.012), (0.2, 0, 0.15))
    hr += [rbox(f'{cid}_Blade', (0, 0.088, 0), (0.016, 0.136, 0.005), m['metal'], parent=SW, bevel=0.002),
           ell(f'{cid}_BladeTip', (0, 0.156, 0), (0.008, 0.02, 0.0025), m['metal'], parent=SW, seg=(12, 8)),
           rbox(f'{cid}_Fuller', (0, 0.08, 0), (0.0035, 0.1, 0.0058), m['ink'], parent=SW, bevel=0.001, segs=1),
           rbox(f'{cid}_Guard', (0, 0.018, 0), (0.05, 0.009, 0.011), m['accent'], parent=SW, bevel=0.003),
           ell(f'{cid}_GuardGem', (0, 0.018, 0), (0.006, 0.006, 0.0075), m['c1'], parent=SW, seg=(10, 8)),
           cyl(f'{cid}_Grip', (0, -0.005, 0), 0.0065, 0.035, m['wood'], parent=SW, seg=10),
           ell(f'{cid}_Pommel', (0, -0.027, 0), (0.011, 0.011, 0.008), m['accent'], parent=SW, seg=(14, 10)),
           ell(f'{cid}_PommelGem', (0, -0.027, 0.0065), (0.0045, 0.0045, 0.0025), m['c1'], parent=SW, seg=(8, 6))]
    for side in (-1, 1):
        hr.append(ell(f'{cid}_Quillon{side}', (side * 0.028, 0.021, 0), (0.0055, 0.0065, 0.0055), m['accent'], parent=SW, seg=(10, 8)))
    for k, y in enumerate((-0.014, -0.003, 0.008)):
        hr.append(torus(f'{cid}_GripWrap{k}', (0, y, 0), 0.0068, 0.0018, m['ink'], r=(math.pi / 2, 0, 0.0), parent=SW, seg=12, mseg=5))
    return {'Body': body, 'Head': head, 'HandL': hl, 'HandR': hr}


def wizard(m):
    cid = 'wizard'
    body, head = [], []
    body.append(cyl(f'{cid}_Robe', (0, 0.095, 0), 0.092, 0.19, m['main'], seg=32, r_top=0.05, fuse=True))
    body.append(ell(f'{cid}_Shoulders', (0, 0.17, 0), (0.07, 0.035, 0.058), m['main'], fuse=True))
    body.append(torus(f'{cid}_Hem', (0, 0.006, 0), 0.09, 0.008, m['accent'], r=(math.pi / 2, 0, 0), seg=36))
    body.append(torus(f'{cid}_HemPiping', (0, 0.047, 0), 0.0822, 0.0028, m['accent'], r=(math.pi / 2, 0, 0), seg=36, mseg=6))
    body.append(torus(f'{cid}_Sash', (0, 0.11, 0), 0.071, 0.007, m['accent'], r=(math.pi / 2, 0, 0)))
    R = lambda y: 0.092 - 0.042 * y / 0.19
    tilt = math.atan(0.042 / 0.19)

    def robe(a, y, lift=0.0):
        rr = R(y) + lift
        return M((rr * math.sin(a), y, rr * math.cos(a)), (0, a, 0)) @ M(r=(-tilt, 0, 0))
    # Embroidery round the hem: stars and crescent moons between the hem and a line of piping.
    for k in range(10):
        a = 2 * math.pi * k / 10
        if k % 2 == 0:
            body.append(star(f'{cid}_HemStar{k}', robe(a, 0.027, 0.0005), 0.0105, 0.0045, 0.004, m['accent']))
        else:
            body += crescent(f'{cid}_HemMoon{k}', robe(a, 0.027, 0.0015), 0.008, 0.0032, m['accent'], open_dir=0.5)
    # Two big motifs on the skirt, a gold trim down the front, and the sash knotted at the side.
    body.append(star(f'{cid}_RobeStar', robe(-0.62, 0.075, 0.0005), 0.015, 0.0065, 0.005, m['accent']))
    body += crescent(f'{cid}_RobeMoon', robe(0.66, 0.078, 0.002), 0.012, 0.0045, m['accent'], open_dir=0.4)
    body.append(strand(f'{cid}_FrontTrim', [(0, y, R(y) + 0.0005) for y in (0.104, 0.07, 0.035, 0.012)], 0.0035, 0.0035, m['accent'], ring=6))
    ka = 0.62
    kp = Vector((0.073 * math.sin(ka), 0.11, 0.073 * math.cos(ka)))
    body.append(ell(f'{cid}_SashKnot', tuple(kp), (0.011, 0.012, 0.008), m['accent'], r=(0, ka, 0), seg=(14, 10)))
    for k, (da, dy) in enumerate([(-0.12, 0.052), (0.1, 0.045)]):
        a2 = ka + da
        end = Vector(((R(0.11 - dy) + 0.004) * math.sin(a2), 0.11 - dy, (R(0.11 - dy) + 0.004) * math.cos(a2)))
        mid = kp.lerp(end, 0.5) + Vector((math.sin(a2), 0, math.cos(a2))) * 0.003
        body.append(strand(f'{cid}_SashTail{k}', [kp, mid, end], 0.0055, 0.0045, m['accent'], ring=8))
        body.append(ell(f'{cid}_Tassel{k}', tuple(end + Vector((0, -0.006, 0))), (0.0055, 0.009, 0.0055), m['accent'], seg=(10, 8)))
    for side in (-1, 1):
        body.append(ell(f'{cid}_Slipper{side}', (side * 0.035, 0.012, 0.06), (0.024, 0.014, 0.034), m['ink'], seg=(16, 10)))
        body.append(strand(f'{cid}_SlipperCurl{side}', [(side * 0.035, 0.016, 0.088), (side * 0.035, 0.024, 0.1), (side * 0.035, 0.032, 0.094)],
                           0.0075, 0.003, m['ink'], ring=8))
    head.append(ell(f'{cid}_Face', (0, -0.005, 0.0), (0.098, 0.096, 0.094), m['skin'], seg=(30, 20), fuse=True))
    head.append(ell(f'{cid}_Nose', (0, -0.015, 0.095), (0.02, 0.022, 0.02), m['skin'], fuse=True))
    eyes(cid, head, m, y=0.012, gap=0.036, z=0.084, size=(0.016, 0.018), iris='c3', yaw=0.36)
    # Bushy brows: two locks each, flicking up at the ends.
    for side in (-1, 1):
        head.append(strand(f'{cid}_Brow{side}', [(side * 0.014, 0.038, 0.091), (side * 0.04, 0.05, 0.088), (side * 0.07, 0.044, 0.072)],
                           0.0115, 0.003, m['white'], ring=8))
        head.append(strand(f'{cid}_BrowTuft{side}', [(side * 0.03, 0.046, 0.088), (side * 0.058, 0.056, 0.08), (side * 0.078, 0.066, 0.066)],
                           0.008, 0.0015, m['white'], ring=8, round_tip=False))
    # Beard: two layers of long white locks from cheeks and chin over a full core, tips curling in.
    rng = np.random.default_rng(11)
    beard = [ell(f'{cid}_BeardCore', (0, -0.085, 0.072), (0.058, 0.055, 0.034), m['white'], fuse=True)]
    for layer, (cnt, spread, rz, ln, rad) in enumerate([(13, 1.2, 0.07, 0.0, 0.026), (9, 0.9, 0.085, 0.02, 0.022)]):
        for k in range(cnt):
            a = -spread + k * (2 * spread / (cnt - 1))
            root = Vector((math.sin(a) * 0.078, -0.03 - 0.022 * math.cos(a) - layer * 0.012, math.cos(a) * rz))
            drop = 0.155 + ln + rng.random() * 0.025 + 0.03 * math.cos(a)
            tip = Vector((math.sin(a) * 0.04, -drop, 0.07 + 0.03 * math.cos(a) + layer * 0.01))
            mid = root.lerp(tip, 0.5) + Vector((math.sin(a) * 0.012, 0, 0.018))
            curl = tip + Vector((-math.sin(a) * 0.012, 0.006, 0.006))
            beard.append(strand(f'{cid}_Beard{layer}{k}', [root, mid, tip, curl], rad, 0.004, m['white'], fuse=True))
    # Long hair falling from under the hat at the sides and back.
    for k in range(9):
        a = math.pi / 2 + k * (math.pi / 8)
        root = Vector((math.sin(a) * 0.09, 0.045, math.cos(a) * 0.09))
        tip = Vector((math.sin(a) * 0.098, -0.045 - 0.012 * abs(math.cos(a)), math.cos(a) * 0.096))
        beard.append(strand(f'{cid}_Locks{k}', [root, root.lerp(tip, 0.5) + Vector((math.sin(a) * 0.012, 0, math.cos(a) * 0.012)), tip],
                            0.026, 0.014, m['white'], fuse=True))
    for o in beard:
        o['budget'] = 2600
    head += beard
    for side in (-1, 1):
        head.append(strand(f'{cid}_Moustache{side}', [(0, -0.038, 0.106), (side * 0.024, -0.044, 0.104), (side * 0.046, -0.06, 0.092),
                                                      (side * 0.054, -0.082, 0.082)], 0.0135, 0.004, m['white'], ring=10))
    # The hat: a wide brim and a tall cone that flops over at the tip.
    head.append(ell(f'{cid}_Brim', (0, 0.06, 0), (0.15, 0.014, 0.15), m['main'], seg=(36, 10), fuse=True))
    cone_pts = [(0, 0.06, 0), (0, 0.14, -0.01), (0.02, 0.23, -0.035), (0.06, 0.27, -0.03)]
    head.append(strand(f'{cid}_Cone', cone_pts, 0.095, 0.006, m['main'], fuse=True, ring=24))
    cpath = _spline(cone_pts)

    def cone(t, ang, lift=0.0):
        f = t * (len(cpath) - 1)
        i = min(int(f), len(cpath) - 2)
        c = cpath[i].lerp(cpath[i + 1], f - i)
        d = (cpath[i + 1] - cpath[i]).normalized()
        out = Vector((math.sin(ang), 0, math.cos(ang)))
        out = (out - d * out.dot(d)).normalized()
        return frame_z(c + out * (0.095 + (0.006 - 0.095) * t + lift), out, up=d)
    # A band of the hat's own deep blue between two gold cords, buckled at the front.
    head.append(cyl(f'{cid}_HatBand', (0, 0.0785, -0.001), 0.0935, 0.025, m['c3'], seg=36, r_top=0.0858))
    for k, (y, rr) in enumerate([(0.067, 0.0928), (0.0905, 0.0852)]):
        head.append(torus(f'{cid}_HatCord{k}', (0, y, -0.001), rr, 0.0028, m['accent'], r=(math.pi / 2, 0, 0), seg=36, mseg=6))
    head.append(rbox(f'{cid}_Buckle', (0, 0.079, 0.0915), (0.026, 0.022, 0.004), m['accent'], r=(-0.3, 0, 0), bevel=0.002))
    head.append(rbox(f'{cid}_BuckleIn', (0, 0.079, 0.093), (0.015, 0.012, 0.003), m['c3'], r=(-0.3, 0, 0), bevel=0.001, segs=1))
    for k, (t, ang, ro, ri) in enumerate([(0.24, 0.35, 0.017, 0.007), (0.47, 0.15, 0.011, 0.0047), (0.2, -1.4, 0.012, 0.005),
                                          (0.3, math.pi - 0.4, 0.014, 0.006), (0.18, math.pi + 0.9, 0.011, 0.0047)]):
        head.append(star(f'{cid}_HatStar{k}', cone(t, ang, 0.0005), ro, ri, 0.005, m['accent']))
    head += crescent(f'{cid}_HatMoon', cone(0.33, -0.5, 0.0018), 0.013, 0.0048, m['accent'], open_dir=0.5)
    head += crescent(f'{cid}_HatMoonB', cone(0.42, math.pi + 0.5, 0.0018), 0.01, 0.004, m['accent'], open_dir=0.5)
    # The staff: knotted wood, a leather grip, and a claw of four prongs holding a glowing orb.
    hr = mitten(cid, 'HandR', m, 'skin', -1)
    ST = M((-0.004, 0.02, 0.012), (0.1, 0, 0.08))
    hr += [cyl(f'{cid}_Staff', (0, 0.025, 0), 0.0075, 0.27, m['wood'], parent=ST, seg=10),
           cyl(f'{cid}_StaffHead', (0, 0.157, 0), 0.0075, 0.016, m['wood'], parent=ST, seg=12, r_top=0.011),
           cyl(f'{cid}_StaffGrip', (0, 0.042, 0), 0.0092, 0.03, m['c3'], parent=ST, seg=12),
           cyl(f'{cid}_Ferrule', (0, -0.108, 0), 0.0085, 0.012, m['accent'], parent=ST, seg=12),
           ell(f'{cid}_Orb', (0, 0.188, 0), (0.021, 0.021, 0.021), m['glow'], parent=ST, seg=(18, 12))]
    for k, y in enumerate((0.027, 0.057, 0.149)):
        hr.append(torus(f'{cid}_StaffRing{k}', (0, y, 0), 0.0095 if k < 2 else 0.0085, 0.0025, m['accent'], parent=ST, r=(math.pi / 2, 0, 0),
                        seg=14, mseg=6))
    for k, y in enumerate((0.09, -0.05)):
        hr.append(ell(f'{cid}_Knot{k}', (0.006 if k else -0.006, y, 0.002), (0.004, 0.007, 0.004), m['wood'], parent=ST, seg=(8, 6)))
    for k in range(4):
        ph = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(ph), math.sin(ph)
        hr.append(strand(f'{cid}_Prong{k}', [(c * 0.008, 0.16, s * 0.008), (c * 0.019, 0.172, s * 0.019), (c * 0.025, 0.19, s * 0.025),
                                            (c * 0.014, 0.206, s * 0.014)], 0.0042, 0.0018, m['wood'], parent=ST, ring=7))
    return {'Body': body, 'Head': head, 'HandL': mitten(cid, 'HandL', m, 'skin', 1), 'HandR': hr}


def astronaut(m):
    cid = 'astronaut'
    body, head = [], []
    SUIT = ((0, 0.12, 0), (0.078, 0.078, 0.064))
    body.append(ell(f'{cid}_Suit', SUIT[0], SUIT[1], m['white'], fuse=True))
    # Chest control pack: a little screen, a dial and three buttons.
    PK = M((0, 0.135, 0.058), (-0.15, 0, 0))
    body.append(rbox(f'{cid}_ChestPack', (0, 0, 0), (0.064, 0.044, 0.016), m['main'], parent=PK, bevel=0.006))
    body.append(rbox(f'{cid}_PackScreen', (-0.01, 0.008, 0.0085), (0.032, 0.014, 0.003), m['glass'], parent=PK, bevel=0.0015, segs=1))
    body.append(rbox(f'{cid}_PackTrace', (-0.012, 0.008, 0.0102), (0.02, 0.0022, 0.001), m['glow'], parent=PK, bevel=0.0004, segs=1))
    body.append(torus(f'{cid}_PackDial', (-0.014, -0.01, 0.0085), 0.0062, 0.0018, m['metal'], parent=PK, seg=16, mseg=6))
    body.append(ell(f'{cid}_PackKnob', (-0.014, -0.01, 0.009), (0.0038, 0.0038, 0.0025), m['accent'], parent=PK, seg=(10, 6)))
    for k, key in enumerate(('accent', 'glow', 'c1')):
        body.append(ell(f'{cid}_Button{k}', (0.02, 0.012 - k * 0.0115, 0.0085), (0.0048, 0.0048, 0.0028), m[key], parent=PK, seg=(10, 6)))
    # Life-support pack: a coloured lid with vents, twin tanks, hoses round to the chest pack.
    body.append(rbox(f'{cid}_Backpack', (0, 0.135, -0.065), (0.11, 0.1, 0.04), m['white'], bevel=0.012))
    body.append(rbox(f'{cid}_PackLid', (0, 0.166, -0.0865), (0.094, 0.03, 0.006), m['main'], bevel=0.003))
    for k in range(3):
        body.append(rbox(f'{cid}_PackVent{k}', (-0.02 + k * 0.02, 0.166, -0.0895), (0.012, 0.016, 0.002), m['ink'], bevel=0.0008, segs=1))
    for side in (-1, 1):
        body.append(cyl(f'{cid}_Tank{side}', (side * 0.028, 0.118, -0.092), 0.013, 0.05, m['metal'], seg=16))
        for k, y in enumerate((0.093, 0.143)):
            body.append(ell(f'{cid}_TankCap{side}{k}', (side * 0.028, y, -0.092), (0.013, 0.006, 0.013), m['main'], seg=(16, 8)))
        hose = [(side * 0.052, 0.112, -0.07), (side * 0.08, 0.106, -0.02), (side * 0.07, 0.112, 0.034), (side * 0.035, 0.124, 0.058)]
        body.append(strand(f'{cid}_Hose{side}', hose, 0.0055, 0.0055, m['accent' if side > 0 else 'metal'], ring=8))
        for k, q in enumerate((hose[0], hose[-1])):
            body.append(ell(f'{cid}_HoseEnd{side}{k}', q, (0.0085, 0.0085, 0.0085), m['metal'], seg=(12, 8)))
    # Mission patch (just shapes, no flag) and a name tab.
    G = on_ell(SUIT, -0.05, 0.11, lift=0.0005)
    body.append(ell(f'{cid}_Patch', (0, 0, 0), (0.0135, 0.0135, 0.0025), m['main'], parent=G, seg=(18, 6)))
    body.append(ell(f'{cid}_PatchIn', (0, 0, 0.0012), (0.0095, 0.0095, 0.0022), m['c1'], parent=G, seg=(16, 6)))
    body.append(ell(f'{cid}_PatchStar', (0, 0, 0.0028), (0.0055, 0.0055, 0.0016), m['white'], parent=G, r=(0, 0, 0.6), seg=(4, 2)))
    G = on_ell(SUIT, 0.05, 0.112, lift=0.0005)
    body.append(rbox(f'{cid}_NameTab', (0, 0, 0), (0.024, 0.012, 0.003), m['accent'], parent=G, bevel=0.0012, segs=1))
    body.append(rbox(f'{cid}_NameLine', (0, 0, 0.0018), (0.016, 0.0022, 0.001), m['white'], parent=G, bevel=0.0004, segs=1))
    # Suit seams: a yoke ring across the chest and a belt hugging the suit, with a buckle.
    body.append(torus(f'{cid}_Yoke', (0, 0.158, 0), 0.069, 0.0024, m['main'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.82)), seg=36, mseg=6))
    body.append(torus(f'{cid}_Belt', (0, 0.088, 0), 0.072, 0.007, m['main'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.82)), seg=32))
    body.append(rbox(f'{cid}_Buckle', (0, 0.088, 0.064), (0.022, 0.014, 0.005), m['metal'], bevel=0.002))
    for side in (-1, 1):
        body.append(torus(f'{cid}_Joint{side}', (side * 0.09, 0.155, 0), 0.02, 0.006, m['main'], r=(0, math.pi / 2, 0)))
    legs(cid, m, body, 'white', top=0.07, r=0.027)
    boots(cid, m, body, 'white', cuff='main')
    for side in (-1, 1):
        x = side * 0.042
        body.append(torus(f'{cid}_BootRing{side}', (x, 0.056, 0.004), 0.025, 0.0035, m['metal'], r=(math.pi / 2, 0, 0), seg=20, mseg=6))
        body.append(ell(f'{cid}_BootToe{side}', (x, 0.02, 0.046), (0.028, 0.018, 0.022), m['main'], seg=(16, 10)))
    HELM = ((0, 0, 0), (0.125, 0.122, 0.12))
    VIS = ((0, 0, 0.058), (0.094, 0.078, 0.07))
    head.append(ell(f'{cid}_Helmet', HELM[0], HELM[1], m['white'], seg=(34, 24)))
    head.append(ell(f'{cid}_Visor', VIS[0], VIS[1], m['glass'], seg=(30, 20)))
    # The visor rim: a tube along where the visor meets the helmet.
    rim = []
    for i in range(20):
        a = 2 * math.pi * i / 20
        lo, hi = 0.0, 1.0
        for _ in range(24):
            s = (lo + hi) / 2
            q = Vector((0.125 * s * math.cos(a), 0.122 * s * math.sin(a), 0.12 * math.sqrt(1 - s * s)))
            f = (q.x / 0.094) ** 2 + (q.y / 0.078) ** 2 + ((q.z - 0.058) / 0.07) ** 2
            lo, hi = (s, hi) if f < 1 else (lo, s)
        nrm = Vector((q.x / 0.125 ** 2, q.y / 0.122 ** 2, q.z / 0.12 ** 2)).normalized()
        rim.append(q + nrm * 0.002)
    head.append(loop(f'{cid}_VisorRim', rim, 0.0075, m['main'], axis=(0, 0, 1), ring=8, n=3))
    # Reflections: a curved streak and two dots on the glass.
    vz = lambda x, y: ell_z(VIS, x, y) + 0.0012
    head.append(strand(f'{cid}_VisorStreak', [(x, y, vz(x, y)) for x, y in ((-0.068, -0.004), (-0.06, 0.022), (-0.04, 0.04), (-0.018, 0.046))],
                       0.0045, 0.002, m['white'], ring=6))
    for k, (x, y, r) in enumerate(((-0.07, -0.022, 0.004), (0.05, -0.035, 0.0028))):
        head.append(ell(f'{cid}_VisorGlint{k}', (x, y, vz(x, y)), (r, r, 0.0015), m['white'], seg=(10, 6)))
    head.append(torus(f'{cid}_Collar', (0, -0.105, 0), 0.07, 0.014, m['main'], r=(math.pi / 2, 0, 0)))
    head.append(torus(f'{cid}_CollarRing', (0, -0.119, 0), 0.066, 0.006, m['metal'], r=(math.pi / 2, 0, 0)))
    for side in (-1, 1):
        head.append(cyl(f'{cid}_EarLight{side}', (side * 0.122, 0.0, 0), 0.026, 0.02, m['main'], r=(0, 0, math.pi / 2)))
        head.append(torus(f'{cid}_EarRing{side}', (side * 0.1315, 0.0, 0), 0.018, 0.003, m['metal'], r=(0, math.pi / 2, 0), seg=20, mseg=6))
        head.append(cyl(f'{cid}_EarLamp{side}', (side * 0.132, 0.0, 0), 0.014, 0.008, m['accent'], r=(0, 0, math.pi / 2)))
    # Head lamp over the visor.
    G = on_ell(HELM, 0.0, 0.098, lift=0.002)
    head.append(rbox(f'{cid}_HeadLamp', (0, 0, 0), (0.036, 0.016, 0.012), m['main'], parent=G, bevel=0.004))
    head.append(ell(f'{cid}_HeadLens', (0, 0, 0.006), (0.011, 0.0055, 0.003), m['glow'], parent=G, seg=(12, 8)))
    head.append(ell(f'{cid}_AntennaBase', (0.047, 0.108, -0.02), (0.012, 0.006, 0.012), m['main'], r=(0, 0, -0.3), seg=(14, 8)))
    head.append(cyl(f'{cid}_Antenna', (0.055, 0.13, -0.02), 0.004, 0.06, m['metal'], r=(0, 0, -0.3), seg=8))
    head.append(ell(f'{cid}_AntennaTip', (0.066, 0.16, -0.02), (0.01, 0.01, 0.01), m['accent'], seg=(12, 8)))
    return {'Body': body, 'Head': head, 'HandL': mitten(cid, 'HandL', m, 'main', 1), 'HandR': mitten(cid, 'HandR', m, 'main', -1)}


def pirate(m):
    cid = 'pirate'
    body, head = [], []
    body.append(ell(f'{cid}_Coat', (0, 0.118, 0), (0.08, 0.08, 0.064), m['main'], fuse=True))
    body.append(ell(f'{cid}_CoatTail', (0, 0.07, -0.01), (0.083, 0.03, 0.064), m['main'], fuse=True))
    body.append(ell(f'{cid}_Shirt', (0, 0.15, 0.045), (0.03, 0.045, 0.024), m['white'], seg=(16, 12)))
    for row in (-1, 1):
        for k in range(3):
            body.append(ell(f'{cid}_Button{row}{k}', (row * 0.035, 0.155 - k * 0.026, 0.06 - k * 0.002), (0.0065, 0.0065, 0.004), m['accent'], seg=(10, 6)))
    body.append(torus(f'{cid}_Belt', (0, 0.092, 0), 0.075, 0.009, m['ink'], r=(math.pi / 2, 0, 0)))
    body.append(rbox(f'{cid}_Buckle', (0, 0.092, 0.074), (0.024, 0.02, 0.006), m['accent'], bevel=0.003))
    legs(cid, m, body, 'ink', top=0.068)
    boots(cid, m, body, 'ink', cuff='wood')
    head.append(ell(f'{cid}_Face', (0, -0.005, 0), (0.1, 0.098, 0.096), m['skin'], seg=(30, 20), fuse=True))
    head.append(ell(f'{cid}_Nose', (0, -0.018, 0.098), (0.016, 0.017, 0.016), m['skin'], fuse=True))
    # One eye and a patch.
    G = M((0.036, 0.012, 0.086), (0, 0.36, 0))
    head.append(ell(f'{cid}_Sclera', (0, 0, 0), (0.017, 0.019, 0.009), m['white'], parent=G, seg=(18, 12)))
    blink_lid(cid, head, m, G, 1, (0.017, 0.019, 0.009))
    head.append(ell(f'{cid}_Iris', (0, -0.001, 0.006), (0.012, 0.013, 0.005), m['c3'], parent=G, seg=(16, 10)))
    head.append(ell(f'{cid}_Pupil', (0, -0.001, 0.0095), (0.006, 0.007, 0.003), m['ink'], parent=G, seg=(12, 8)))
    head.append(ell(f'{cid}_Glint', (-0.004, 0.006, 0.011), (0.0035, 0.0035, 0.0015), m['white'], parent=G, seg=(8, 6)))
    head.append(ell(f'{cid}_Patch', (-0.036, 0.012, 0.088), (0.021, 0.019, 0.008), m['ink'], r=(0, -0.36, 0), seg=(16, 10)))
    head.append(strand(f'{cid}_Strap', [(-0.1, 0.04, 0.0), (-0.06, 0.03, 0.08), (0.0, 0.05, 0.1), (0.07, 0.06, 0.07), (0.1, 0.055, 0.0)],
                       0.0035, 0.0035, m['ink'], ring=6))
    # A big bushy beard and moustache.
    rng = np.random.default_rng(5)
    for k in range(11):
        a = -1.2 + k * (2.4 / 10)
        root = Vector((math.sin(a) * 0.078, -0.03 - 0.025 * math.cos(a), math.cos(a) * 0.072))
        tip = Vector((math.sin(a) * 0.055, -0.1 - rng.random() * 0.02, 0.07 + 0.02 * math.cos(a)))
        head.append(strand(f'{cid}_Beard{k}', [root, root.lerp(tip, 0.5) + Vector((0, 0, 0.012)), tip], 0.024, 0.006, m['hair'], fuse=True))
    for side in (-1, 1):
        head.append(strand(f'{cid}_Moustache{side}', [(0, -0.04, 0.104), (side * 0.03, -0.042, 0.1), (side * 0.055, -0.03, 0.085)],
                           0.011, 0.004, m['hair'], ring=8))
    # Tricorn: a brim turned up in three places, a crown, a gold edge, a gold coin badge.
    def tricorn(v):
        a = math.atan2(v.x, v.z)
        up = max(0.0, math.cos(3 * a)) ** 2
        r = math.hypot(v.x, v.z)
        return Vector((v.x, v.y + up * 0.05 * min(1.0, r / 0.12), v.z))
    head.append(ell(f'{cid}_Brim', (0, 0.065, 0), (0.15, 0.012, 0.14), m['ink'], seg=(40, 10), deform=tricorn))
    head.append(ell(f'{cid}_Crown', (0, 0.1, -0.005), (0.085, 0.05, 0.08), m['ink'], seg=(28, 16), deform=lambda v: Vector((v.x, max(v.y, 0.066), v.z))))
    head.append(ell(f'{cid}_Coin', (0, 0.125, 0.07), (0.018, 0.018, 0.004), m['accent'], r=(-0.5, 0, 0), seg=(18, 8)))
    hr = mitten(cid, 'HandR', m, 'skin', -1)
    hr.append(cyl(f'{cid}_Doubloon', (-0.004, 0.006, 0.026), 0.017, 0.005, m['accent'], r=(math.pi / 2, 0, 0.2), seg=20))
    return {'Body': body, 'Head': head, 'HandL': mitten(cid, 'HandL', m, 'skin', 1), 'HandR': hr}


def ninja(m):
    cid = 'ninja'
    body, head = [], []
    SUIT = ((0, 0.12, 0), (0.074, 0.076, 0.062))
    body.append(ell(f'{cid}_Suit', SUIT[0], SUIT[1], m['main'], fuse=True))
    # A crossed kimono collar lying on the chest, left over right.
    sp = lambda x, y, lift=0.004: (x, y, ell_z(SUIT, x, y) + lift)
    body.append(strand(f'{cid}_Lapel', [sp(-0.034, 0.182), sp(-0.014, 0.152), sp(0.012, 0.122), sp(0.026, 0.104)], 0.0055, 0.0055, m['ink'], ring=6))
    body.append(strand(f'{cid}_LapelUnder', [sp(0.034, 0.182), sp(0.016, 0.16), sp(0.002, 0.146, 0.002)], 0.0045, 0.0045, m['ink'], ring=6))
    # Obi: a wide sash hugging the waist, a cord above it, and a proper knot with loops and tails.
    body.append(torus(f'{cid}_Sash', (0, 0.09, 0), 0.07, 0.012, m['accent'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.84)), seg=32))
    body.append(torus(f'{cid}_Cord', (0, 0.105, 0), 0.0715, 0.003, m['ink'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.85)), seg=32, mseg=6))
    kx, kz = 0.03, 0.066
    body.append(ell(f'{cid}_Knot', (kx, 0.09, kz), (0.012, 0.011, 0.008), m['accent'], seg=(12, 8)))
    for side in (-1, 1):
        body.append(torus(f'{cid}_KnotLoop{side}', (kx + side * 0.014, 0.093, kz - 0.002), 0.0085, 0.0042, m['accent'], r=(0, side * 0.35, side * 0.5),
                          seg=16, mseg=6))
        body.append(strand(f'{cid}_SashTail{side}', [(kx, 0.086, kz + 0.002), (kx + side * 0.007, 0.064, kz + 0.007), (kx + side * 0.01, 0.045, kz + 0.005),
                                                      (kx + side * 0.016, 0.03, kz + 0.002)], 0.0065, 0.0058, m['accent'], ring=6))
    # Shoulder wraps: cloth bands hugging the top of each shoulder, front to back.
    for side in (-1, 1):
        for k, x in enumerate((0.05, 0.062)):
            f = math.sqrt(1 - (x / 0.074) ** 2)
            pts = [(side * x, 0.12 + (0.076 * f + 0.003) * math.sin(a), (0.062 * f + 0.003) * math.cos(a)) for a in (0.45, 1.0, 1.57, 2.14, 2.69)]
            body.append(strand(f'{cid}_ShoulderWrap{side}{k}', pts, 0.0042, 0.0042, m['ink'], ring=6))
    # Katana across the back: sheath with mouth and end fittings, a cord band, a wrapped hilt.
    KT = M((0, 0.14, -0.07), (0, 0, 0.75))
    body += [rbox(f'{cid}_Sheath', (0, 0, 0), (0.016, 0.2, 0.012), m['ink'], parent=KT, bevel=0.004),
             rbox(f'{cid}_SheathMouth', (0, 0.094, 0), (0.019, 0.01, 0.015), m['gold'], parent=KT, bevel=0.002),
             rbox(f'{cid}_SheathEnd', (0, -0.094, 0), (0.019, 0.014, 0.015), m['gold'], parent=KT, bevel=0.003),
             rbox(f'{cid}_SheathBand', (0, 0.055, 0), (0.019, 0.008, 0.015), m['accent'], parent=KT, bevel=0.002),
             rbox(f'{cid}_Tsuba', (0, 0.104, 0), (0.03, 0.006, 0.026), m['gold'], parent=KT, bevel=0.002),
             rbox(f'{cid}_Hilt', (0, 0.135, 0), (0.012, 0.055, 0.011), m['c2'], parent=KT, bevel=0.003),
             rbox(f'{cid}_Pommel', (0, 0.164, 0), (0.0145, 0.008, 0.0135), m['gold'], parent=KT, bevel=0.002)]
    for k in range(4):
        for face in (-1, 1):
            body.append(rbox(f'{cid}_HiltWrap{k}{face}', (0, 0.115 + k * 0.013, face * 0.0056), (0.0065, 0.0065, 0.0016), m['ink'], parent=KT,
                             r=(0, 0, math.pi / 4), bevel=0.0005, segs=1))
    legs(cid, m, body, 'main', top=0.07)
    for side in (-1, 1):
        body.append(ell(f'{cid}_Tabi{side}', (side * 0.042, 0.02, 0.014), (0.03, 0.02, 0.046), m['ink'], seg=(18, 10)))
        body.append(torus(f'{cid}_TabiWrap{side}', (side * 0.042, 0.042, 0.008), 0.0235, 0.0045, m['white'], r=(math.pi / 2, 0, 0), seg=20, mseg=6))
    HOOD =((0, 0, 0), (0.11, 0.106, 0.104))
    MASK = ((0, -0.04, 0.03), (0.098, 0.06, 0.084))
    head.append(ell(f'{cid}_Hood', HOOD[0], HOOD[1], m['main'], seg=(32, 22), fuse=True))
    head.append(ell(f'{cid}_Mask', MASK[0], MASK[1], m['main'], fuse=True))
    # Cloth folds across the mask: soft sagging ridges in the same cloth.
    mz = lambda x, y: max(ell_z(HOOD, x, y), ell_z(MASK, x, y))
    for k, (y0, w, sag) in enumerate(((-0.036, 0.062, 0.006), (-0.058, 0.055, 0.008), (-0.078, 0.04, 0.006))):
        pts = []
        for t in (-1, -0.5, 0, 0.5, 1):
            x, y = t * w, y0 - sag * (1 - t * t)
            pts.append((x, y, mz(x, y) - 0.0004))
        head.append(strand(f'{cid}_MaskFold{k}', pts, 0.003, 0.0022, m['main'], ring=6))
    head.append(ell(f'{cid}_EyeBand', (0, 0.012, 0.074), (0.074, 0.026, 0.034), m['skin'], seg=(24, 12)))
    eyes(cid, head, m, y=0.012, gap=0.033, z=0.098, size=(0.017, 0.013), iris='c3', yaw=0.34, lids=False)
    for side in (-1, 1):
        head.append(strand(f'{cid}_Brow{side}', [(side * 0.012, 0.03, 0.104), (side * 0.035, 0.026, 0.102), (side * 0.055, 0.031, 0.093)],
                           0.0045, 0.003, m['ink'], ring=6))
    head.append(torus(f'{cid}_Band', (0, 0.045, 0), 0.108, 0.011, m['accent'], r=(math.pi / 2 - 0.12, 0, 0), seg=36))
    head.append(ell(f'{cid}_BandPlate', (0, 0.05, 0.107), (0.03, 0.016, 0.006), m['metal'], r=(-0.12, 0, 0), seg=(16, 8)))
    head.append(rbox(f'{cid}_BandMark', (0, 0.0507, 0.1125), (0.026, 0.0028, 0.002), m['ink'], r=(-0.12, 0, 0.3), bevel=0.0006, segs=1))
    for side in (-1, 1):
        head.append(ell(f'{cid}_BandStud{side}', (side * 0.022, 0.0505, 0.1112), (0.0028, 0.0028, 0.0018), m['ink'], r=(-0.12, 0, 0), seg=(8, 6)))
    # Headband knot at the back: a knot, two loops and long tails that flutter out.
    head.append(ell(f'{cid}_BandKnot', (0, 0.033, -0.112), (0.014, 0.013, 0.01), m['accent'], seg=(14, 10)))
    for side in (-1, 1):
        head.append(torus(f'{cid}_BandLoop{side}', (side * 0.017, 0.037, -0.11), 0.009, 0.0048, m['accent'], r=(0.2, side * 0.3, side * 0.45),
                          seg=16, mseg=6))
        head.append(strand(f'{cid}_BandTail{side}', [(side * 0.004, 0.03, -0.114), (side * 0.022, 0.008, -0.13), (side * 0.036, -0.022, -0.146),
                                                      (side * 0.05, -0.05, -0.142), (side * 0.068, -0.07, -0.15)],
                           0.0085, 0.006, m['accent'], ring=6))
    wrap = lambda part, side: [torus(f'{cid}_{part}Wrap', (0, 0.02, 0), 0.0215, 0.0055, m['ink'], r=(math.pi / 2, side * 0.45, 0), seg=18, mseg=6)]
    return {'Body': body, 'Head': head, 'HandL': mitten(cid, 'HandL', m, 'main', 1) + wrap('HandL', 1),
            'HandR': mitten(cid, 'HandR', m, 'main', -1) + wrap('HandR', -1)}


def chef(m):
    cid = 'chef'
    body, head = [], []
    J = ((0, 0.12, 0), (0.08, 0.08, 0.066))
    B = ((0, 0.09, 0.03), (0.07, 0.058, 0.04))
    body.append(ell(f'{cid}_Jacket', J[0], J[1], m['white'], fuse=True))
    body.append(ell(f'{cid}_Belly', B[0], B[1], m['white'], fuse=True))
    # Double-breasted front: the flap's edge piped in red, two rows of buttons.
    body.append(strand(f'{cid}_Piping', [(0.043, y, ell_z(J, 0.043, y) + 0.0008) for y in (0.176, 0.155, 0.135, 0.118)], 0.0026, 0.0026,
                       m['accent'], ring=6))
    for row in (-1, 1):
        for k in range(3):
            G = on_ell(J, row * 0.027, 0.17 - k * 0.02, lift=0.0008)
            body.append(ell(f'{cid}_Button{row}{k}', (0, 0, 0), (0.0062, 0.0062, 0.0032), m['ink'], parent=G, seg=(12, 8)))
            body.append(torus(f'{cid}_ButtonRim{row}{k}', (0, 0, 0.0008), 0.0058, 0.0013, m['c1'], parent=G, seg=12, mseg=5))
    # Neckerchief with a knot and two tails.
    body.append(torus(f'{cid}_Kerchief', (0, 0.19, 0.01), 0.04, 0.012, m['main'], r=(math.pi / 2 - 0.3, 0, 0)))
    body.append(ell(f'{cid}_KerchiefKnot', (0, 0.176, 0.057), (0.013, 0.011, 0.009), m['main'], seg=(14, 10)))
    for side in (-1, 1):
        body.append(strand(f'{cid}_KerchiefTail{side}', [(side * 0.004, 0.172, 0.06), (side * 0.01, 0.156, 0.066), (side * 0.013, 0.142, 0.066)],
                           0.009, 0.004, m['main'], ring=8))
    # Apron: a panel over the belly with a pocket, a red hem and a waist tie in the player's colour.
    surf = lambda x, y: Vector((x, y, max(ell_z(J, x, max(y, 0.07)), ell_z(B, x, max(y, 0.07)))))
    apron, aedge = sheet(f'{cid}_Apron', surf, 0, lambda t: 0.058 + 0.008 * t, 0.116, 0.042, 0.0015, 0.004, m['white'], nu=12, nv=8)
    body.append(apron)
    body.append(loop(f'{cid}_ApronTrim', aedge[::2], 0.0022, m['accent'], axis=(0, 0, 1), ring=6, n=3))
    psurf = lambda x, y: surf(x, y) + Vector((0, 0, 0.0018))
    pocket, pedge = sheet(f'{cid}_Pocket', psurf, 0.026, lambda t: 0.017, 0.096, 0.07, 0.0016, 0.003, m['white'], nu=6, nv=5)
    body.append(pocket)
    body.append(strand(f'{cid}_PocketTrim', [psurf(x, 0.096) + Vector((0, 0, 0.0016)) for x in (0.009, 0.026, 0.043)], 0.0022, 0.0022,
                       m['accent'], ring=6))
    tie = []
    for k in range(14):
        a = 2 * math.pi * k / 14
        x = 0.077 * math.sin(a)
        z = 0.0635 * math.cos(a)
        if z > 0:
            z = max(z, surf(x, 0.118).z)
        tie.append((x, 0.118, z + 0.003))
    body.append(loop(f'{cid}_ApronTie', tie, 0.0045, m['main'], ring=8, n=3))
    body.append(ell(f'{cid}_TieKnot', (0, 0.118, -0.07), (0.01, 0.009, 0.007), m['main'], seg=(12, 8)))
    for side in (-1, 1):
        body.append(strand(f'{cid}_TieEnd{side}', [(side * 0.004, 0.115, -0.071), (side * 0.012, 0.098, -0.07), (side * 0.016, 0.08, -0.066)],
                           0.0045, 0.0035, m['main'], ring=6))
    legs(cid, m, body, 'c1', top=0.068)
    boots(cid, m, body, 'ink')
    head.append(ell(f'{cid}_Face', (0, -0.006, 0), (0.1, 0.098, 0.096), m['skin'], seg=(30, 20), fuse=True))
    head.append(ell(f'{cid}_Nose', (0, -0.016, 0.1), (0.022, 0.02, 0.02), m['skin'], fuse=True))
    for side in (-1, 1):
        head.append(ell(f'{cid}_Rosy{side}', (side * 0.055, -0.034, 0.078), (0.018, 0.012, 0.006), m['c2'], r=(0, side * 0.6, 0), seg=(14, 8)))
        head.append(strand(f'{cid}_Moustache{side}', [(0, -0.042, 0.106), (side * 0.025, -0.045, 0.104), (side * 0.05, -0.04, 0.092),
                                                        (side * 0.062, -0.022, 0.085), (side * 0.054, -0.012, 0.088)], 0.009, 0.004, m['ink'], ring=8))
        head.append(strand(f'{cid}_Brow{side}', [(side * 0.016, 0.042, 0.092), (side * 0.04, 0.05, 0.088), (side * 0.064, 0.042, 0.076)],
                           0.006, 0.004, m['ink'], ring=6))
    eyes(cid, head, m, y=0.014, gap=0.036, z=0.087, size=(0.016, 0.017), iris='c3', yaw=0.36)
    head.append(strand(f'{cid}_Smile', [(-0.025, -0.064, 0.094), (0, -0.074, 0.1), (0.025, -0.064, 0.094)], 0.0035, 0.003, m['ink'], ring=6))
    # The toque: a band, a pleated crown (a ring of soft ribs) and a puffed top.
    toque = [cyl(f'{cid}_HatBand', (0, 0.085, -0.004), 0.082, 0.05, m['white'], seg=32, fuse=True),
             ell(f'{cid}_Puff', (0, 0.182, -0.004), (0.088, 0.046, 0.088), m['white'], fuse=True)]
    for k in range(14):
        a = 2 * math.pi * k / 14
        toque.append(ell(f'{cid}_Pleat{k}', (0.076 * math.sin(a), 0.152, 0.076 * math.cos(a) - 0.004), (0.022, 0.05, 0.019), m['white'],
                         r=(0, a, 0), fuse=True))
    for o in toque:
        o['budget'] = 2400
    head += toque
    head.append(torus(f'{cid}_HatSeam', (0, 0.109, -0.004), 0.0825, 0.0035, m['white'], r=(math.pi / 2, 0, 0), seg=32, mseg=6))
    head.append(torus(f'{cid}_HatStripe', (0, 0.07, -0.004), 0.083, 0.0035, m['main'], r=(math.pi / 2, 0, 0), seg=32, mseg=6))
    hr = mitten(cid, 'HandR', m, 'skin', -1)
    SP = M((-0.004, 0.02, 0.016), (0.25, 0, 0.2))
    hr += [cyl(f'{cid}_SpoonHandle', (0, 0.03, 0), 0.0062, 0.11, m['wood'], parent=SP, seg=8, r_top=0.0045),
           ell(f'{cid}_SpoonBowl', (0, 0.097, 0.003), (0.017, 0.025, 0.0065), m['wood'], parent=SP, seg=(14, 10)),
           torus(f'{cid}_SpoonBand', (0, -0.016, 0), 0.0066, 0.0016, m['accent'], parent=SP, r=(math.pi / 2, 0, 0), seg=10, mseg=5)]
    # A whisk in the other hand.
    hl = mitten(cid, 'HandL', m, 'skin', 1)
    WH = M((0.004, 0.02, 0.016), (0.25, 0, -0.2))
    hl += [cyl(f'{cid}_WhiskHandle', (0, 0.01, 0), 0.0068, 0.07, m['c1'], parent=WH, seg=10),
           cyl(f'{cid}_WhiskCollar', (0, 0.049, 0), 0.0072, 0.01, m['metal'], parent=WH, seg=10, r_top=0.0052),
           ell(f'{cid}_WhiskEnd', (0, -0.026, 0), (0.0075, 0.005, 0.0075), m['metal'], parent=WH, seg=(10, 6))]
    wire = [(0, 0.052), (0.009, 0.068), (0.017, 0.092), (0.015, 0.112), (0, 0.122), (-0.015, 0.112), (-0.017, 0.092), (-0.009, 0.068)]
    for k in range(4):
        R4 = WH @ M(r=(0, k * math.pi / 4, 0))
        pts = [R4 @ Vector((x, y, 0)) for x, y in wire]
        hl.append(loop(f'{cid}_Wire{k}', pts, 0.0011, m['metal'], axis=tuple(R4.to_3x3() @ Vector((0, 0, 1))), ring=5, n=4))
    return {'Body': body, 'Head': head, 'HandL': hl, 'HandR': hr}


def alien(m):
    cid = 'alien'
    body, head = [], []
    TRUNK = ((0, 0.115, 0), (0.06, 0.08, 0.052))
    body.append(ell(f'{cid}_Trunk', TRUNK[0], TRUNK[1], m['main'], fuse=True))
    body.append(ell(f'{cid}_SuitBand', (0, 0.12, 0.0), (0.062, 0.03, 0.054), m['metal'], seg=(24, 10)))
    # Glowing piping either side of the band, a V of piping up to a collar, a ringed badge.
    for k, y in enumerate((0.111, 0.129)):
        body.append(torus(f'{cid}_Piping{k}', (0, y, 0), 0.0605, 0.0019, m['glow'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.87)), seg=32, mseg=5))
    tp = lambda x, y: (x, y, ell_z(TRUNK, x, y) + 0.0008)
    for side in (-1, 1):
        body.append(strand(f'{cid}_VTrim{side}', [tp(side * 0.026, 0.181), tp(side * 0.014, 0.158), tp(side * 0.004, 0.14)], 0.0019, 0.0019, m['glow'], ring=5))
    body.append(torus(f'{cid}_Collar', (0, 0.184, 0), 0.03, 0.006, m['metal'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.87)), seg=24, mseg=6))
    body.append(torus(f'{cid}_BadgeRing', (0, 0.124, 0.0548), 0.0125, 0.0024, m['gold'], seg=18, mseg=6))
    body.append(ell(f'{cid}_Badge', (0, 0.124, 0.053), (0.012, 0.012, 0.004), m['glow'], seg=(12, 8)))
    for side in (-1, 1):
        body.append(ell(f'{cid}_ShoulderPad{side}', (side * 0.046, 0.172, 0), (0.024, 0.011, 0.03), m['metal'], r=(0, 0, -side * 0.5), seg=(16, 10)))
        body.append(ell(f'{cid}_PadGlow{side}', (side * 0.052, 0.178, 0.022), (0.004, 0.004, 0.003), m['glow'], seg=(8, 6)))
    # Belt with a gadget on the hip: a box with a glowing lens and two buttons.
    body.append(torus(f'{cid}_Belt', (0, 0.086, 0), 0.057, 0.005, m['ink'], r=(math.pi / 2, 0, 0), parent=M(s=(1, 1, 0.86)), seg=28, mseg=6))
    G = on_ell(TRUNK, 0.038, 0.082, lift=0.006)
    body.append(rbox(f'{cid}_Gadget', (0, 0, 0), (0.024, 0.026, 0.012), m['metal'], parent=G, bevel=0.004))
    body.append(cyl(f'{cid}_GadgetLens', (0, 0.004, 0.006), 0.0065, 0.004, m['ink'], r=(math.pi / 2, 0, 0), parent=G, seg=14))
    body.append(ell(f'{cid}_GadgetGlow', (0, 0.004, 0.0085), (0.0048, 0.0048, 0.0018), m['glow'], parent=G, seg=(12, 6)))
    for k, x in enumerate((-0.005, 0.005)):
        body.append(ell(f'{cid}_GadgetKey{k}', (x, -0.008, 0.006), (0.0025, 0.002, 0.0015), m['accent'], parent=G, seg=(8, 6)))
    legs(cid, m, body, 'main', top=0.07, r=0.02)
    for side in (-1, 1):
        body.append(ell(f'{cid}_Foot{side}', (side * 0.04, 0.016, 0.016), (0.028, 0.016, 0.045), m['main'], seg=(18, 10)))
        body.append(ell(f'{cid}_FootSole{side}', (side * 0.04, 0.006, 0.016), (0.03, 0.008, 0.047), m['metal'], seg=(18, 8), deform=cut_above(0.008)))
        body.append(ell(f'{cid}_FootGlow{side}', (side * 0.04, 0.02, 0.058), (0.005, 0.004, 0.003), m['glow'], seg=(8, 6)))
    def chin(v):
        if v.y < 0:
            t = min(1.0, -v.y / 0.11)
            v.x *= 1 - 0.38 * t
            v.z *= 1 - 0.12 * t
        return v
    skull = ell(f'{cid}_Skull', (0, 0.01, 0), (0.125, 0.12, 0.11), m['main'], seg=(40, 28), deform=chin, fuse=True)
    skull['budget'] = 3200
    head.append(skull)
    # Subtle cranial ridges, sunk into the skull so the fuse melts them into soft bumps.
    for k, (phi, rr) in enumerate(((0.0, 0.0075), (-0.42, 0.0055), (0.42, 0.0055))):
        pts = []
        for th in (0.7, 0.3, -0.1, -0.5, -0.85):
            u = Vector((math.sin(phi), math.cos(phi) * math.cos(th), math.cos(phi) * math.sin(th)))
            q = Vector((0.125 * u.x, 0.01 + 0.12 * u.y, 0.11 * u.z))
            nrm = Vector((u.x / 0.125, u.y / 0.12, u.z / 0.11)).normalized()
            pts.append(q - nrm * (rr - 0.0024))
        head.append(strand(f'{cid}_Ridge{k}', pts, rr, rr, m['main'], fuse=True, ring=8))
    for side in (-1, 1):
        G = M((side * 0.047, 0.004, 0.097), (0, side * 0.42, -side * 0.38))
        head.append(ell(f'{cid}_Eye{side}', (0, 0, 0), (0.034, 0.022, 0.016), m['ink'], parent=G, seg=(22, 14)))
        blink_lid(cid, head, m, G, side, (0.034, 0.022, 0.016))
        head.append(ell(f'{cid}_EyeGlint{side}', (-0.012, 0.008, 0.014), (0.007, 0.005, 0.002), m['white'], parent=G, seg=(10, 6)))
        head.append(ell(f'{cid}_EyeGlint2{side}', (0.012, -0.006, 0.014), (0.003, 0.003, 0.0015), m['white'], parent=G, seg=(8, 6)))
        # Antennae: a curved stalk from a ringed socket, ending in a glowing bulb in a little cup.
        head.append(strand(f'{cid}_Antenna{side}', [(side * 0.04, 0.11, 0.0), (side * 0.05, 0.145, -0.012), (side * 0.068, 0.172, -0.008),
                                                    (side * 0.08, 0.188, 0.0)], 0.0075, 0.0038, m['main'], ring=8))
        head.append(torus(f'{cid}_AntennaSocket{side}', (side * 0.043, 0.1225, -0.002), 0.0095, 0.0032, m['metal'], r=(math.pi / 2, side * 0.34, 0),
                          seg=16, mseg=6))
        head.append(ell(f'{cid}_AntennaCup{side}', (side * 0.083, 0.192, 0.002), (0.011, 0.0065, 0.011), m['metal'], r=(0.3, 0, -side * 0.6), seg=(14, 8)))
        head.append(ell(f'{cid}_AntennaBall{side}', (side * 0.088, 0.202, 0.004), (0.0155, 0.0155, 0.0155), m['glow'], seg=(16, 12)))
        head.append(ell(f'{cid}_AntennaGlint{side}', (side * 0.088 - 0.006, 0.21, 0.015), (0.0042, 0.0042, 0.002), m['white'], r=(-0.5, 0, 0), seg=(8, 6)))
    head.append(strand(f'{cid}_Mouth', [(-0.012, -0.074, 0.084), (0, -0.079, 0.088), (0.012, -0.074, 0.084)], 0.0025, 0.0025, m['ink'], ring=5))

    def three_fingers(part, side):
        out = [ell(f'{cid}_{part}Palm', (0, 0, 0), (0.02, 0.022, 0.018), m['main'], fuse=True)]
        for k, a in enumerate((-0.4, 0.0, 0.4)):
            out.append(strand(f'{cid}_{part}Finger{k}', [(math.sin(a) * 0.012, -0.012, 0.004), (math.sin(a) * 0.02, -0.03, 0.008)],
                              0.0065, 0.005, m['main'], fuse=True, ring=8))
        out.append(torus(f'{cid}_{part}Wrist', (0, 0.017, 0), 0.0175, 0.0042, m['metal'], r=(math.pi / 2, 0, 0), seg=18, mseg=6))
        return out
    return {'Body': body, 'Head': head, 'HandL': three_fingers('HandL', 1), 'HandR': three_fingers('HandR', -1)}


BUILDERS.update({'spiky': spiky, 'robot': robot, 'cat': cat, 'knight': knight, 'wizard': wizard,
                 'astronaut': astronaut, 'pirate': pirate, 'ninja': ninja, 'chef': chef, 'alien': alien})
ARMS.update({cid: ((0.08, 0.165, 0.0), 0.017) for cid in ('spiky', 'cat', 'knight', 'astronaut', 'pirate', 'ninja', 'chef')})
ARMS.update({'robot': ((0.085, 0.165, 0.0), 0.012), 'wizard': ((0.065, 0.17, 0.0), 0.02), 'alien': ((0.062, 0.16, 0.0), 0.013)})


# Hips and leg radius (mirrors `legs` in looks.tsx): the game draws each leg
# live from the hip to its stepping foot; used here only for previews.
LEGS = {
    'snacky': ((0.033, 0.075, 0.0), 0.025), 'starer': ((0.036, 0.062, 0.002), 0.024),
    'spiky': ((0.034, 0.07, 0.0), 0.022), 'robot': ((0.034, 0.068, 0.0), 0.014),
    'cat': ((0.034, 0.07, 0.0), 0.022), 'knight': ((0.034, 0.07, 0.0), 0.024),
    'astronaut': ((0.034, 0.07, 0.0), 0.026), 'pirate': ((0.034, 0.068, 0.0), 0.024),
    'ninja': ((0.034, 0.07, 0.0), 0.023), 'chef': ((0.034, 0.068, 0.0), 0.024),
    'alien': ((0.034, 0.07, 0.0), 0.018),
}
