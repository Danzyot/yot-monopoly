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


# --------------------------------------------------------------------------
# Shared bits: sneakers and hands
# --------------------------------------------------------------------------

def sneakers(cid, m, out):
    for side in (-1, 1):
        x = side * 0.042
        out.append(ell(f'{cid}_Shoe{side}', (x, 0.024, 0.014), (0.034, 0.024, 0.054), m['main'], seg=(20, 12)))
        out.append(ell(f'{cid}_Sole{side}', (x, 0.009, 0.016), (0.036, 0.011, 0.057), m['white'], seg=(20, 10), deform=cut_above(0.012)))
        out.append(ell(f'{cid}_Toe{side}', (x, 0.019, 0.054), (0.027, 0.016, 0.018), m['white'], seg=(14, 8)))
        # Laces: three little bars across the tongue.
        for k in range(3):
            out.append(rbox(f'{cid}_Lace{side}{k}', (x, 0.043 - k * 0.003, 0.012 + k * 0.012), (0.026, 0.004, 0.005), m['white'],
                            r=(-0.45, 0, 0), bevel=0.0015, segs=1))


def mitten(cid, part, m, mat, side):
    """A soft hand with a thumb, palm turned in."""
    return [
        ell(f'{cid}_{part}Palm', (0, 0, 0), (0.024, 0.027, 0.02), m[mat], fuse=True),
        ell(f'{cid}_{part}Thumb', (-side * 0.018, 0.006, 0.012), (0.009, 0.014, 0.009), m[mat], r=(0.3, 0, side * 0.6), fuse=True),
        ell(f'{cid}_{part}Fingers', (0, -0.012, 0.004), (0.022, 0.018, 0.019), m[mat], fuse=True),
    ]


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
        root = Vector((side.x * 0.105, 0.05 + rng.random() * 0.03, side.z * 0.105))
        mid = root + side * 0.02 + Vector((0, -0.035, -0.008))
        tip = mid + side * 0.022 + Vector((rng.normal(0, 0.008), -0.03 - rng.random() * 0.02, -0.01))
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
