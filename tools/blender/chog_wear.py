"""Chog Genesis wearables (pass 2): the hats, outfits and held props a holder's own Chog wears.

chog_traits.py exports these next to the face parts, one node per shape:

  chog_Hair_<trim>     the mane cut back to fit under a hat: full, crown, cap, hood
  chog_Hat_<shape>     head space (the head pivot), hung on the head bone
  chog_Wear_<shape>    body space (the feet), on the body bone
  chog_Prop_<id>       hand space (the right hand's pivot), on the right hand bone

Shapes are shared: one cap for every cap value, one tee for every tee. What
tells "Horny Cap" from "JEET Cap" is paint: parts in material `chog:paint`
take their colour from the figure's own paint texture, painted per token by
client/src/three/characters/chogPaint.ts. The UVs written here address that
texture by the layout in shared/chogs/paint-layout.json:

  - a swatch part (`sw`) points every vertex at one 32 px square of its slot's
    swatch row (a brim, a gem, a sleeve trim);
  - a projected part (`pj`) is unrolled round the slot's vertical axis at a
    fixed scale (k px per unit, both ways): faces in front land in the slot's
    D area, where the painter puts the decal (the front of a cap, the chest of
    a tee), every other face in its P area, wrapped every `wrap` px, so a
    periodic pattern (ribbing, stripes, stars) carries on all round.

Everything else (gold, metal, ink...) uses the usual `chog:<key>` atlas
materials the figure already has.
"""

import json
import math
import os
import re

import bmesh
import bpy
from mathutils import Matrix, Vector

import blib
import characters
import detailed
from detailed import THREE_TO_BLENDER, M, _finish, ell, ell_z, rbox, strand, torus

CID = 'chog'
LAYOUT = json.load(open(os.path.join(blib.REPO, 'shared', 'chogs', 'paint-layout.json')))
B2T = THREE_TO_BLENDER.inverted()
TAU = 2 * math.pi


# ---- paint UVs -----------------------------------------------------------------

def _uv(px, py):
    """Canvas pixels (origin top-left) to UV. The client uploads the canvas unflipped (flipY = false)."""
    return (px / LAYOUT['w'], 1 - py / LAYOUT['h'])


def pj(obj, slot, yoff=0.0, fuse=False):
    """Paint `obj` by projection into `slot` ('hat' or 'body'); `yoff` lifts its y into the slot's space."""
    obj['uvp'] = slot
    obj['uvy'] = yoff
    if fuse:
        obj['fuse'] = 1
    return obj


def sw(obj, slot, k, fuse=False):
    """Paint `obj` with swatch k of `slot`."""
    obj['uvs'] = f'{slot}:{k}'
    if fuse:
        obj['fuse'] = 1
    return obj


def _layer(me):
    return me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')


def apply_uvs(obj):
    me = obj.data
    if 'uvs' in obj:
        slot, k = obj['uvs'].split(':')
        s = LAYOUT['swatch']
        uv = _uv(s * (int(k) + 0.5), LAYOUT[slot]['sw'] + s / 2)
        layer = _layer(me)
        for d in layer.data:
            d.uv = uv
    elif 'uvp' in obj:
        project(obj, obj['uvp'], float(obj.get('uvy', 0.0)))


def project(obj, slot, yoff=0.0):
    """Unroll obj round the slot's axis into its D (front) and P (wrapped) areas, at k px per unit."""
    A = LAYOUT[slot]
    K, G, W = LAYOUT['k'], LAYOUT['guard'], LAYOUT['wrap']
    dx, dy, dw, dh = A['d']
    qx, qy, qw, qh = A['p']
    az0, r = A['axisZ'], A['r']
    me = obj.data
    layer = _layer(me)
    co = [Vector((v.co.x, v.co.z + yoff, -v.co.y)) for v in me.vertices]
    for poly in me.polygons:
        loops = list(poly.loop_indices)
        pts = [co[me.loops[li].vertex_index] for li in loops]
        c = sum(pts, Vector()) / len(pts)
        ac = math.atan2(c.x, c.z - az0)
        ss = []
        for p in pts:
            a = math.atan2(p.x, p.z - az0)
            a += TAU * round((ac - a) / TAU)
            ss.append(r * a * K)
        if max(abs(s) for s in ss) < dw / 2 - 2:
            xs, top, h = [dx + dw / 2 + s for s in ss], dy, dh
        else:
            n = math.floor(r * ac * K / W)
            xs, top, h = [qx + G + s - n * W for s in ss], qy, qh
        for li, p, x in zip(loops, pts, xs):
            y = top + min(h - 1, max(1, (A['ytop'] - p.y) * K))
            layer.data[li].uv = _uv(x, y)


# ---- mesh helpers (three.js space: y up, the Chog faces +z) ----------------------------

def edit(obj, fn):
    """Run fn(bm) on obj's mesh in three space."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(B2T)
    fn(bm)
    bm.transform(THREE_TO_BLENDER)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def cut(bm, y0, tilt=0.0):
    """Keep what is above the plane y = y0 + tilt * z."""
    n = Vector((0, 1, -tilt))
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, y0, 0), plane_no=n, clear_inner=True)


def drop_faces(bm, pred):
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if pred(f.calc_center_median())], context='FACES')


def solidify(obj, t, offset=-1.0):
    m = obj.modifiers.new('Thick', 'SOLIDIFY')
    m.thickness = t
    m.offset = offset
    m.use_even_offset = True
    return obj


def dome(name, c, rad, mat, y0=None, tilt=0.0, seg=(48, 30), thick=0.004, holes=None, deform=None, e=None):
    """An ellipsoid (a superellipsoid with `e`), cut open below y0 + tilt*z, with faces where holes(p) dropped."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    if e:
        for v in bm.verts:
            d = v.co.normalized()
            r = ((abs(d.x) ** e + abs(d.y) ** e) ** (2.4 / e) + abs(d.z) ** 2.4) ** (1 / 2.4)
            v.co = d / r
    bm.transform(M(c, (0, 0, 0), rad))
    if deform:
        for v in bm.verts:
            v.co = deform(v.co.copy())
    if y0 is not None:
        cut(bm, y0, tilt)
    if holes:
        drop_faces(bm, holes)
    obj = _finish(name, bm, mat, False)
    if thick:
        solidify(obj, thick)
    return obj


def grid(name, mat, P, nu, nv, closed=False, thick=0.0, offset=0.0, smooth=True):
    """A surface through P(i/nu, j/nv) -> Vector (u round, v across), optionally closed in u, thickened."""
    bm = bmesh.new()
    cols = nu if closed else nu + 1
    vs = [[bm.verts.new(P(i / nu, j / nv)) for j in range(nv + 1)] for i in range(cols)]
    for i in range(nu):
        a, b = vs[i], vs[(i + 1) % cols]
        for j in range(nv):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _finish(name, bm, mat, False)
    if not smooth:
        obj.data.shade_flat()
    if thick:
        solidify(obj, thick, offset)
    return obj


def section(c, rad, y, tilt, th):
    """The point at azimuth th (0 = front, + to his left) where the plane y + tilt*z meets ellipsoid (c, rad)."""
    z = c[2] + rad[2] * math.cos(th)
    x = 0.0
    for _ in range(4):
        yy = y + tilt * z
        k = math.sqrt(max(0.0, 1 - ((yy - c[1]) / rad[1]) ** 2))
        x, z = rad[0] * k * math.sin(th), c[2] + rad[2] * k * math.cos(th)
    return Vector((x, y + tilt * z, z))


def band(name, mat, cz, ax, az, yb, tilt, h, bulge=0.004, flare=0.0, n=64, nv=6, thick=0.003, arc=None, e=2.0):
    """A band round the head (cuff, headband, crown ring): centre axis at z = cz, radii (ax, az) at the bottom
    edge y = yb + tilt*z, h tall, bowed out by `bulge` and widening by `flare` toward the top; squarer
    with e > 2 (to follow the face). `arc` = (th0, th1) for part of the way round; h may be a function of th."""
    sq = lambda c: math.copysign(abs(c) ** (2 / e), c)

    def P(u, t):
        th = arc[0] + (arc[1] - arc[0]) * u if arc else TAU * u
        hh = h(th) if callable(h) else h
        s = bulge * math.sin(math.pi * t) + flare * t
        x, z = (ax + s) * sq(math.sin(th)), cz + (az + s) * sq(math.cos(th))
        return Vector((x, yb + tilt * (cz + az * math.cos(th)) + hh * t, z))
    return grid(name, mat, P, n, nv, closed=arc is None, thick=thick, offset=-1.0)


def brim(name, mat, c, rad, y0, tilt, length, droop, th0=math.pi, thick=0.007, bill=0.0, n=64, nv=5, curl=0.0):
    """A brim from a crown's cut edge: all round (th0 = pi) or a bill in front (th0 < pi, `bill` pulls it forward)."""
    full = th0 >= math.pi - 1e-6

    def P(u, t):
        th = (TAU * u) if full else (-th0 + 2 * th0 * u)
        p = section(c, rad, y0, tilt, th)
        out = Vector((math.sin(th), 0, math.cos(th)))
        if bill:
            out = out.lerp(Vector((0, 0, 1)), bill).normalized()
        L = length if full else length * max(0.0, math.cos(th / th0 * math.pi / 2)) ** 0.45 + 0.004
        q = p - out * 0.004 + out * (L * t)
        q.y -= droop * t * (L / length) + curl * t * t + (0.0 if full else 0.012 * math.sin(th) ** 2 * t)
        return q
    return grid(name, mat, P, n, nv, closed=full, thick=thick, offset=0.0)


def puffs(name, mat, pts, r, seg=(14, 10)):
    """Little balls (curls, fur, pompoms)."""
    return [ell(f'{name}{k}', tuple(p), (r, r, r) if isinstance(r, float) else r, mat, seg=seg) for k, p in enumerate(pts)]


# ---- the mane, cut back for hats ------------------------------------------------------------

# Spike angles of detailed.chog_hair's two rings (front, back), in creation order.
SPIKES = ([-0.15, 0.6, -0.88, 1.25, -1.55, 1.9, -2.2], [0.25, -0.9, 1.15, -2.0, 2.3])
TRIMS = {
    'full': (0.0, 0.0),
    # Clear of a crown, a plunger or horns: only the top spike goes.
    'crown': (0.5, 0.8),
    # Out from under a cap or a beanie: the side and back spikes only.
    'cap': (1.5, 1.9),
    # Inside a hood: the hood round the face, no spikes.
    'hood': (9.0, 9.0),
}


def hair(m, trim):
    head = []
    detailed.chog_hair(CID, head, m, detailed.ChogFace())
    front, back = TRIMS[trim]
    out = []
    for o in head:
        # Under a hat or a hood most of it is hidden: a lighter surface will do.
        if trim in ('cap', 'hood'):
            o['budget'] = 5000
        hit = re.search(r'_HairSpike(\d)(\d)', o.name)
        if hit:
            ring, k = int(hit.group(1)), int(hit.group(2))
            a = SPIKES[ring][k]
            if abs(a) < (front if ring == 0 else back):
                bpy.data.objects.remove(o)
                continue
        out.append(o)
    return out


# ---- hats (head space; slot 'hat') ------------------------------------------------------------
# The mane under a hat is in shared/chogs/traits.ts (HAT_MANE), so the two stay together.

CAP_C, CAP_R, CAP_Y0, CAP_TILT = (0, 0.045, -0.03), (0.138, 0.128, 0.142), 0.022, 0.3


def hat_cap(m):
    """A baseball cap: a six-panel crown with a button, and a curved bill (swatch 0)."""
    p = m['paint']
    out = [pj(dome('CapCrown', CAP_C, CAP_R, p, CAP_Y0, CAP_TILT), 'hat'),
           sw(ell('CapButton', (0, CAP_C[1] + CAP_R[1] - 0.003, CAP_C[2]), (0.013, 0.007, 0.013), p, seg=(12, 6)), 'hat', 0),
           sw(brim('CapBill', p, CAP_C, CAP_R, CAP_Y0, CAP_TILT, 0.095, 0.022, th0=1.25, bill=0.55, curl=0.004), 'hat', 0)]
    # Panel seams from the button down: thin raised piping in the bill colour.
    for k, th in enumerate((-1.05, 1.05, math.pi - 1.05, math.pi + 1.05)):
        pts = []
        for t in (0.0, 0.35, 0.7, 0.98):
            a = math.acos(1 - t * 1.75)
            pts.append(Vector((CAP_R[0] * math.sin(a) * math.sin(th), CAP_C[1] + CAP_R[1] * math.cos(a), CAP_C[2] + CAP_R[2] * math.sin(a) * math.cos(th))))
        pts = [q for q in pts if q.y > CAP_Y0 + CAP_TILT * q.z + 0.005]
        if len(pts) >= 2:
            out.append(sw(strand(f'CapSeam{k}', pts, 0.0016, 0.0016, p, ring=5, n=6), 'hat', 0))
    return out


BUCKET_C, BUCKET_R, BUCKET_Y0, BUCKET_TILT = (0, 0.05, -0.035), (0.137, 0.118, 0.14), 0.034, 0.24


def hat_bucket(m):
    """A bucket hat: a flat-topped crown and a brim sloping down all round (swatch 0)."""
    p = m['paint']
    flat = lambda v: Vector((v.x, min(v.y, BUCKET_C[1] + BUCKET_R[1] * 0.86), v.z))
    return [pj(dome('BucketCrown', BUCKET_C, BUCKET_R, p, BUCKET_Y0, BUCKET_TILT, deform=flat), 'hat'),
            sw(brim('BucketBrim', p, BUCKET_C, BUCKET_R, BUCKET_Y0, BUCKET_TILT, 0.052, 0.03, curl=0.004), 'hat', 0)]


BEANIE_C, BEANIE_R = (0, 0.042, -0.035), (0.14, 0.138, 0.144)


def hat_beanie(m):
    """A knitted beanie with a turned-up cuff (both projected, so the ribbing runs on round)."""
    p = m['paint']
    y0, tilt = 0.03, 0.32
    out = [pj(dome('BeanieCrown', BEANIE_C, BEANIE_R, p, y0, tilt), 'hat')]
    out.append(pj(band('BeanieCuff', p, BEANIE_C[2], BEANIE_R[0] + 0.004, BEANIE_R[2] + 0.004, y0 - 0.006, tilt, 0.05, bulge=0.007), 'hat'))
    return out


def hat_headband(m):
    """A cloth band round the forehead, the knot and its two tails at the back."""
    p = m['paint']
    out = [pj(band('Headband', p, -0.035, 0.132, 0.142, 0.026, 0.26, 0.032, bulge=0.005, thick=0.004, e=2.8), 'hat')]
    knot = Vector((0, -0.02, -0.172))
    out.append(pj(ell('HeadbandKnot', tuple(knot), (0.02, 0.016, 0.012), p, seg=(12, 8)), 'hat'))
    for s in (-1, 1):
        out.append(pj(strand(f'HeadbandTail{s}', [knot, knot + Vector((s * 0.02, -0.035, -0.012)), knot + Vector((s * 0.045, -0.07, -0.006))],
                             0.012, 0.009, p, ring=8, n=5, up=(0, 0, -1), flat=0.3), 'hat'))
    return out


def hat_durag(m):
    """A durag: a cloth skull cap tied at the back, the tails hanging down the neck."""
    p = m['paint']
    c, r = (0, 0.04, -0.045), (0.133, 0.13, 0.135)
    out = [pj(dome('Durag', c, r, p, 0.03, 0.4), 'hat')]
    tie = Vector((0, 0.005, -0.178))
    for s in (-1, 1):
        out.append(pj(strand(f'DuragTail{s}', [tie, tie + Vector((s * 0.012, -0.05, -0.008)), tie + Vector((s * 0.03, -0.11, 0.004))],
                             0.016, 0.012, p, ring=8, n=5, up=(0, 0, -1), flat=0.25), 'hat'))
    out.append(pj(ell('DuragKnot', tuple(tie), (0.024, 0.016, 0.012), p, seg=(12, 8)), 'hat'))
    return out


def hat_dome(m):
    """A soft dome of a hat pulled down to the brows (the starry wizard hat)."""
    p = m['paint']
    return [pj(dome('Dome', (0, 0.05, -0.035), (0.142, 0.14, 0.146), p, 0.026, 0.3), 'hat')]


def hat_ushanka(m):
    """A Russian fur hat: a crown, a thick fur roll round the front and two ear flaps (fur: swatch 0)."""
    p = m['paint']
    c, r, y0, tilt = (0, 0.055, -0.035), (0.142, 0.128, 0.146), 0.04, 0.2
    out = [pj(dome('UshankaCrown', c, r, p, y0, tilt), 'hat')]
    out.append(sw(band('UshankaRoll', p, c[2], r[0] + 0.006, r[2] + 0.006, y0 - 0.008, tilt, 0.04, bulge=0.014, thick=0.004,
                       arc=(-2.0, 2.0), n=40), 'hat', 0))
    for s in (-1, 1):
        out.append(sw(ell(f'UshankaFlap{s}', (s * 0.142, -0.03, -0.04), (0.03, 0.085, 0.07), p, r=(0, 0, s * 0.12), seg=(18, 14)), 'hat', 0))
    return out


def hat_crown(m):
    """A gold crown of five points, three gems in front (swatches 0, 1) and pearls on the points."""
    g, p = m['gold'], m['paint']
    cz, rr, yb = -0.045, 0.108, 0.072
    pts = 5
    h = lambda th: 0.044 + 0.05 * max(0.0, math.cos(pts * th)) ** 2
    out = [band('CrownRing', g, cz, rr, rr, yb, -0.05, h, bulge=0.0, flare=0.016, n=120, nv=4, thick=0.004)]
    out.append(band('CrownBase', g, cz, rr + 0.002, rr + 0.002, yb - 0.002, -0.05, 0.014, bulge=0.004, n=60, nv=3, thick=0.003))
    for k in range(pts):
        th = k * TAU / pts
        top = Vector(((rr + 0.016) * math.sin(th), yb - 0.05 * (cz + rr * math.cos(th)) + 0.094, cz + (rr + 0.016) * math.cos(th)))
        out.append(ell(f'CrownPearl{k}', tuple(top), (0.007, 0.007, 0.007), g, seg=(10, 8)))
    for k, th in enumerate((0.0, -0.75, 0.75)):
        n = Vector((math.sin(th), 0, math.cos(th)))
        q = Vector((0, yb - 0.05 * (cz + rr * math.cos(th)) + 0.026, cz)) + n * (rr + 0.007)
        out.append(sw(ell(f'CrownGem{k}', tuple(q), (0.011, 0.012, 0.006) if k == 0 else (0.008, 0.009, 0.005), p,
                          r=(0, th, 0), seg=(12, 8)), 'hat', 0 if k == 0 else 1))
    return out


def hat_spartan(m):
    """A Corinthian helmet (swatch 0): brows and cheek guards round a T-shaped opening, a crest on top (swatch 1)."""
    p = m['paint']

    def opening(q):
        if q.z < 0.0:
            return False
        eyes = abs(q.x) < 0.094 and -0.064 < q.y < 0.024
        mouth = abs(q.x) < 0.04 and q.y <= -0.064
        return eyes or mouth
    out = [sw(dome('SpartanShell', (0, 0.02, -0.03), (0.148, 0.158, 0.156), p, -0.128, 0.0, seg=(64, 38), holes=opening, thick=0.006), 'hat', 0)]
    # The nose guard down the middle of the opening and a ridge over the brows.
    out.append(sw(rbox('SpartanNose', (0, -0.02, 0.122), (0.02, 0.09, 0.008), p, r=(-0.12, 0, 0), bevel=0.003), 'hat', 0))
    out.append(sw(strand('SpartanBrow', [(-0.12, 0.034, 0.07), (-0.06, 0.04, 0.115), (0, 0.042, 0.124), (0.06, 0.04, 0.115), (0.12, 0.034, 0.07)],
                         0.006, 0.006, p, ring=8, n=6), 'hat', 0))
    # A dark rim round the opening.
    shell_e = ((0, 0.02, -0.03), (0.148, 0.158, 0.156))
    rim = [(-0.04, -0.124), (-0.04, -0.066), (-0.094, -0.064), (-0.096, 0.024), (0.0, 0.026), (0.096, 0.024), (0.094, -0.064), (0.04, -0.066), (0.04, -0.124)]
    out.append(sw(strand('SpartanRim', [Vector((x, y, ell_z(shell_e, x, y) + 0.001)) for x, y in rim], 0.0045, 0.0045, p, ring=6, n=6), 'hat', 2))
    # The crest: a fan of red bristles front to back over the top.
    for k in range(11):
        a = -0.45 + k * 0.27
        root = Vector((0, 0.02 + 0.15 * math.cos(a), -0.03 - 0.15 * math.sin(a)))
        d = Vector((0, math.cos(a), -math.sin(a)))
        for sx in (-1, 0, 1):
            off = Vector((sx * 0.016, 0, 0))
            out.append(sw(strand(f'SpartanCrest{k}{sx}', [root + off * 0.5, root + d * 0.07 + off + Vector((0, 0.012, -0.012)),
                                                             root + d * (0.12 - abs(sx) * 0.03) + off * 1.6 + Vector((0, 0.02, -0.04))],
                                 0.03, 0.002, p, ring=8, n=4, up=(1, 0, 0), flat=0.5, round_tip=False, fuse=True), 'hat', 1))
    return out


def hat_clown_nose(m):
    """A red ball on the nose (swatch 0)."""
    f = detailed.ChogFace()
    G = f.on_face(0, -0.058, 0.012)
    return [sw(ell('ClownNose', (0, 0, 0), (0.021, 0.02, 0.019), m['paint'], parent=G, seg=(18, 12)), 'hat', 0),
            ell('ClownNoseShine', (-0.007, 0.008, 0.016), (0.005, 0.004, 0.002), m['white'], parent=G, seg=(8, 6))]


def hat_plunger(m):
    """A plunger stuck on top of the head: the red rubber cup (swatch 0) and the wooden handle (swatch 1)."""
    p = m['paint']
    tilt = 0.3
    base = Vector((0.01, 0.128, -0.025))
    up = Vector((math.sin(tilt), math.cos(tilt), -0.1)).normalized()
    cup = dome('PlungerCup', (0, 0, 0), (0.078, 0.07, 0.078), p, -0.004, 0.0, thick=0.006, seg=(36, 20))
    cup.matrix_world = THREE_TO_BLENDER @ M(tuple(base), (0, 0, -tilt)) @ B2T
    return [sw(cup, 'hat', 0),
            sw(torus('PlungerLip', tuple(base - up * 0.002), 0.076, 0.008, p, r=(math.pi / 2, 0, -tilt)), 'hat', 0),
            sw(strand('PlungerHandle', [base + up * 0.06, base + up * 0.26], 0.011, 0.011, p, ring=10, n=3), 'hat', 1)]


def hat_balaclava(m):
    """A knitted ski mask (ribbed, projected) over the face and head, with an eye hole each side."""
    p = m['paint']
    from detailed import CHOG_EYE_AT
    ex, ey = CHOG_EYE_AT

    def holes(q):
        return q.z > 0 and any(((q.x - s * ex) / 0.043) ** 2 + ((q.y - ey) / 0.04) ** 2 < 1 for s in (-1, 1))
    out = [pj(dome('Balaclava', (0, 0.0, -0.024), (0.136, 0.152, 0.146), p, -0.16, 0.0, e=3.0, seg=(68, 42), holes=holes, thick=0.005), 'hat')]
    for s in (-1, 1):
        pts = [Vector((s * ex + 0.045 * math.cos(a), ey + 0.042 * math.sin(a), 0)) for a in (TAU * k / 16 for k in range(16))]
        pts = [Vector((q.x, q.y, ell_z(((0, 0.0, -0.024), (0.136, 0.152, 0.146)), q.x, q.y) + 0.002)) for q in pts]
        out.append(pj(detailed.loop(f'BalaclavaRim{s}', pts, 0.0055, p, axis=(0, 0, 1), ring=8, n=3), 'hat'))
    return out


RAINBOW = 6


def hat_rainbow_wig(m):
    """A clown's afro in rainbow bands (swatches 0-5, red low on his right round over the top to purple)."""
    p = m['paint']
    groups = [[] for _ in range(RAINBOW)]
    C, R = Vector((0, 0.045, -0.06)), Vector((0.158, 0.152, 0.14))
    k = 0
    for ring, (z_off, scale) in enumerate(((0.0, 1.0), (-0.05, 0.92), (-0.1, 0.78))):
        for phi in [-2.45 + i * 0.35 for i in range(15)]:
            x, y = math.sin(phi) * R.x * scale, math.cos(phi) * R.y * scale
            # Keep the face clear.
            if ring == 0 and abs(phi) < 2.0 and y < 0.05 and abs(x) < 0.12:
                continue
            q = C + Vector((x, y, z_off * (1 if ring else 0) + (-0.04 * ring)))
            band_k = min(RAINBOW - 1, max(0, int((phi + 2.45) / 4.9 * RAINBOW)))
            groups[band_k].append(ell(f'Wig{k}', tuple(q), (0.052, 0.05, 0.05), p, seg=(12, 8)))
            k += 1
    out = []
    for i, g in enumerate(groups):
        for o in g:
            sw(o, 'hat', i, fuse=True)
            o['budget'] = 1000
        out += g
    # The back of the head.
    out.append(sw(ell('WigBack', (0, 0.03, -0.09), (0.15, 0.15, 0.1), p, seg=(24, 16)), 'hat', 4))
    return out


def hat_bob(m):
    """Bob Hair: a red cloth cap (projected) over a bob of yellow curls (swatch 0)."""
    p = m['paint']
    out = [pj(dome('BobCap', (0, 0.055, -0.04), (0.142, 0.128, 0.148), p, 0.04, 0.22), 'hat'),
           pj(band('BobRuffle', p, -0.04, 0.148, 0.154, 0.034, 0.22, 0.022, bulge=0.009, thick=0.003), 'hat')]
    curls = []
    for k in range(13):
        a = -2.25 + k * (4.5 / 12)
        if abs(a) < 1.0:
            continue
        for lvl, (y, rr) in enumerate(((0.035, 0.152), (-0.02, 0.15), (-0.07, 0.13))):
            curls.append((math.sin(a) * rr, y, -0.04 + math.cos(a) * rr * 1.02))
    for k in range(5):
        a = math.pi + (k - 2) * 0.45
        curls.append((math.sin(a) * 0.14, -0.04, -0.05 + math.cos(a) * 0.13))
    for o in puffs('BobCurl', p, curls, 0.036):
        out.append(sw(o, 'hat', 0, fuse=True))
    return out


def hat_horns(m):
    """Four little horns over the brow (swatch 0)."""
    p = m['paint']
    out = []
    for k, (x, lean) in enumerate(((-0.1, -0.5), (-0.04, -0.15), (0.04, 0.15), (0.1, 0.5))):
        root = Vector((x, 0.1 - abs(x) * 0.25, -0.01))
        out.append(sw(strand(f'Horn{k}', [root, root + Vector((lean * 0.03, 0.04, 0.005)), root + Vector((lean * 0.07, 0.07, 0.0))],
                             0.018, 0.0015, p, ring=10, n=5, round_tip=False, taper=1.3), 'hat', 0))
    return out


def hat_ram_horns(m):
    """Curled ram's horns either side of the head (swatch 0): up over the top, out and round."""
    p = m['paint']
    out = []
    end = 2.3 * math.pi
    for s in (-1, 1):
        c = Vector((s * 0.13, 0.115, -0.03))
        pts = []
        for i in range(15):
            ph = end * i / 14
            r = 0.058 * (1 - 0.55 * ph / end)
            pts.append(c + Vector((-s * r * math.cos(ph), r * math.sin(ph), -0.006 * ph)))
        out.append(sw(strand(f'Ram{s}', pts, 0.021, 0.007, p, ring=12, n=4), 'hat', 0))
    return out


def hat_thorns(m):
    """A crown of thorns: twisted vines (swatch 0) with spikes, round the brow."""
    p = m['paint']
    out = []
    cz, rr = -0.04, 0.142
    for v in range(2):
        pts = [Vector(((rr + 0.006 * math.sin(5 * th + v * 2)) * math.sin(th), 0.07 + 0.008 * math.cos(4 * th + v * 3) - 0.04 * (1 - math.cos(th)) / 2,
                       cz + (rr + 0.006 * math.sin(5 * th + v * 2)) * math.cos(th))) for th in [TAU * k / 24 for k in range(24)]]
        out.append(sw(detailed.loop(f'ThornVine{v}', pts, 0.0045, p, ring=6, n=3), 'hat', 0))
    for k in range(14):
        th = TAU * k / 14
        q = Vector((rr * math.sin(th), 0.07 - 0.04 * (1 - math.cos(th)) / 2, cz + rr * math.cos(th)))
        d = Vector((math.sin(th), 0.6 if k % 2 else -0.4, math.cos(th))).normalized()
        out.append(sw(strand(f'Thorn{k}', [q, q + d * 0.022], 0.004, 0.0005, p, ring=5, n=2, round_tip=False), 'hat', 0))
    return out


def hat_fedora(m):
    """A fedora: a pinched crown (swatch 0) with a band (swatch 1) and a brim all round."""
    p = m['paint']
    c, r = (0, 0.07, -0.035), (0.13, 0.11, 0.135)
    pinch = lambda v: Vector((v.x, v.y - 0.025 * max(0.0, 1 - (v.x / 0.06) ** 2) * max(0.0, (v.y - 0.12) / 0.06), v.z))
    return [sw(dome('FedoraCrown', c, r, p, 0.06, 0.12, deform=pinch), 'hat', 0),
            sw(band('FedoraBand', p, c[2], r[0] + 0.002, r[2] + 0.002, 0.058, 0.12, 0.022, bulge=0.002), 'hat', 1),
            sw(brim('FedoraBrim', p, c, r, 0.06, 0.12, 0.06, 0.008, curl=-0.006), 'hat', 0)]


def hat_gem(m):
    """A cut gem set in the forehead (swatch 0)."""
    f = detailed.ChogFace()
    G = f.on_face(0, 0.045, 0.004)
    gem = ell('Gem', (0, 0, 0), (0.024, 0.03, 0.011), m['paint'], parent=G, seg=(6, 4))
    gem.data.shade_flat()
    return [sw(gem, 'hat', 0)]


def hat_third_eye(m):
    """A third eye in the forehead."""
    f = detailed.ChogFace()
    G = f.on_face(0, 0.048, -0.002)
    return [ell('ThirdRim', (0, 0, 0), (0.024, 0.016, 0.008), m['ink'], parent=G, seg=(18, 10)),
            ell('ThirdWhite', (0, 0, 0.001), (0.021, 0.013, 0.009), m['white'], parent=G, seg=(18, 10)),
            ell('ThirdPupil', (0, 0, 0.006), (0.008, 0.009, 0.004), m['ink'], parent=G, seg=(12, 8))]


def hat_wreath(m):
    """A laurel wreath (swatch 0): leaves in pairs along a twig round the brow."""
    p = m['paint']
    out = []
    cz, rr = -0.04, 0.138
    path = lambda th: Vector((rr * math.sin(th), 0.075 - 0.035 * (1 - math.cos(th)) / 2, cz + rr * math.cos(th)))
    for s_ in (-1, 1):
        ths = [s_ * (0.35 + k * 0.32) for k in range(8)]
        out.append(sw(strand(f'WreathTwig{s_}', [path(th) for th in ths], 0.003, 0.002, p, ring=6, n=3), 'hat', 0))
        for k, th in enumerate(ths):
            q = path(th)
            t = (path(th + s_ * 0.05) - q).normalized()
            n = Vector((math.sin(th), 0, math.cos(th)))
            for side in (-1, 1):
                d = (t + Vector((0, side * 0.9, 0))).normalized()
                c = q + d * 0.016 + n * 0.004
                leaf = ell(f'WreathLeaf{s_}{k}{side}', (0, 0, 0), (0.0065, 0.018, 0.003), p,
                           parent=detailed.frame_z(c, n, up=tuple(d)), seg=(10, 6))
                out.append(sw(leaf, 'hat', 0))
    return out


def hat_banana(m):
    """A banana taped to the forehead (swatch 0) with two strips of grey tape (swatch 1)."""
    p = m['paint']
    f = detailed.ChogFace()
    pts = [Vector((x, y, f.face_z(x, y) + 0.012)) for x, y in ((0.035, 0.07), (0.012, 0.045), (-0.006, 0.03), (-0.03, 0.03))]
    out = [sw(strand('Banana', pts, 0.011, 0.005, p, ring=10, n=5), 'hat', 0)]
    for k, (x, y, r) in enumerate(((-0.002, 0.04, 0.7), (0.004, 0.04, -0.7))):
        G = f.on_face(x, y, 0.02)
        out.append(sw(rbox(f'BananaTape{k}', (0, 0, 0), (0.016, 0.06, 0.003), p, r=(0, 0, r), parent=G, bevel=0.001, segs=1), 'hat', 1))
    return out


def frame_y(p, d):
    """A frame at p (three space) whose local y points along d."""
    return Matrix.Translation(Vector(p)) @ Vector((0, 1, 0)).rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()


def hat_seal(m):
    """The Holy Seal: a golden ring netted across (swatch 1) floating over the head, tipped toward his left, four
    spokes out of it ending in knobs (swatch 0)."""
    p = m['paint']
    T = frame_y((0.05, 0.24, 0.06), (0, 0.32, 1.0)) @ M((0, 0, 0), (0, -0.42, 0))
    R = 0.052
    out = [sw(torus('SealRing', (0, 0, 0), R, 0.0078, p, r=(math.pi / 2, 0, 0), parent=T, seg=40, mseg=8), 'hat', 0),
           sw(torus('SealHub', (0, 0, 0), 0.012, 0.0045, p, r=(math.pi / 2, 0, 0), parent=T, seg=16, mseg=6), 'hat', 0)]
    # The net: bars across both ways, ending at the ring.
    for k, off in enumerate((-0.026, 0.0, 0.026)):
        half = math.sqrt(R * R - off * off)
        out.append(sw(rbox(f'SealBarX{k}', (0, 0, off), (2 * half, 0.0045, 0.0045), p, parent=T, bevel=0.0015, segs=1), 'hat', 1))
        out.append(sw(rbox(f'SealBarZ{k}', (off, 0, 0), (0.0045, 0.0045, 2 * half), p, parent=T, bevel=0.0015, segs=1), 'hat', 1))
    # In the seal's plane (local x-z): spokes out on the diagonals, a knob and a cross-guard on each.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = Vector((math.cos(a), 0, math.sin(a)))
        n = Vector((-d.z, 0, d.x))
        root, tip = T @ (d * (R + 0.004)), T @ (d * (R + 0.034))
        out.append(sw(strand(f'SealSpoke{k}', [root, tip], 0.0062, 0.005, p, ring=8, n=2, round_tip=False), 'hat', 0))
        out.append(sw(ell(f'SealKnob{k}', tuple(T @ (d * (R + 0.042))), (0.0105, 0.0105, 0.0105), p, seg=(12, 8)), 'hat', 0))
        g = d * (R + 0.022)
        out.append(sw(strand(f'SealGuard{k}', [T @ (g - n * 0.012), T @ (g + n * 0.012)], 0.0045, 0.0045, p, ring=6, n=2), 'hat', 0))
    return out


def shroom(name, p, base, top, cap, spots=4, cap_k=0, stem_k=1, spot_k=2):
    """A toadstool from `base` up to `top` (a bent stem: swatch stem_k), its cap (radius, height; swatch cap_k) on the
    end, facing along the stem, spotted (swatch spot_k)."""
    base, top = Vector(base), Vector(top)
    d = (top - base).normalized()
    mid = base.lerp(top, 0.5) + Vector((0, 0.008, 0)) - d * 0.004
    r_cap, h_cap = cap
    out = [sw(strand(f'{name}Stem', [base, mid, top], r_cap * 0.26, r_cap * 0.2, p, ring=10, n=4, round_tip=False), 'hat', stem_k)]
    T = frame_y(top - d * 0.002, d)
    c = dome(f'{name}Cap', (0, 0, 0), (r_cap, h_cap, r_cap), p, -0.002, 0.0, seg=(24, 12), thick=0.003,
             deform=lambda v: Vector((v.x, v.y - 0.2 * h_cap * (v.x * v.x + v.z * v.z) / (r_cap * r_cap), v.z)))
    c.matrix_world = THREE_TO_BLENDER @ T @ B2T
    out.append(sw(c, 'hat', cap_k))
    for k in range(spots):
        ph = 0.7 + k * TAU / spots + (0.4 if k % 2 else 0.0)
        th = 0.55 + 0.35 * (k % 2)
        q = Vector((r_cap * math.sin(th) * math.cos(ph), h_cap * math.cos(th), r_cap * math.sin(th) * math.sin(ph)))
        n = Vector((q.x / r_cap ** 2, q.y / h_cap ** 2, q.z / r_cap ** 2)).normalized()
        out.append(sw(ell(f'{name}Spot{k}', (0, 0, 0), (r_cap * 0.22, r_cap * 0.19, 0.0025), p,
                          parent=T @ detailed.frame_z(q + n * 0.0005, n), seg=(10, 6)), 'hat', spot_k))
    return out


def hat_shrooms(m):
    """Poison Shroom: toadstools sprouting from the mane, a tall one on top, one out of each side and a little
    orange one low on his right (caps swatch 0 with spots 2, stems 1)."""
    p = m['paint']
    return (shroom('ShroomTop', p, (0.0, 0.215, -0.04), (0.014, 0.305, -0.02), (0.082, 0.052), spots=7)
            + shroom('ShroomL', p, (0.125, 0.16, -0.04), (0.19, 0.228, -0.01), (0.062, 0.04), spots=5)
            + shroom('ShroomR', p, (-0.135, 0.105, -0.04), (-0.192, 0.15, 0.0), (0.052, 0.034), spots=4)
            + shroom('ShroomTiny', p, (-0.14, 0.025, -0.04), (-0.176, 0.037, 0.0), (0.024, 0.016), spots=3, cap_k=2, spot_k=0))


def hat_laser_eye(m):
    """Blue Laser: a third eye in the brow, its iris glowing (the beam is a node of its own, brow_beam)."""
    f = detailed.ChogFace()
    G = f.on_face(0, 0.046, -0.002)
    return [ell('LaserEyeRim', (0, 0, 0), (0.026, 0.017, 0.008), m['ink'], parent=G, seg=(20, 10)),
            ell('LaserEyeWhite', (0, 0, 0.001), (0.023, 0.014, 0.009), m['white'], parent=G, seg=(20, 10)),
            ell('LaserEyeIris', (0, 0, 0.0055), (0.0105, 0.0105, 0.005), m['glow'], parent=G, seg=(14, 8))]


BROW_BEAM = Vector((0.62, 0.42, 0.8)).normalized()


def brow_beam(m):
    """The Blue Laser's beam out of the third eye, up and away to his left."""
    f = detailed.ChogFace()
    start = f.on_face(0, 0.046, 0.006) @ Vector((0, 0, 0))
    return [strand('BrowBeam', [start, start + BROW_BEAM * 0.3], 0.0068, 0.0068, m['glow'], ring=10, round_tip=False, n=3)]


HATS = {
    'cap': hat_cap, 'bucket': hat_bucket, 'beanie': hat_beanie, 'headband': hat_headband, 'durag': hat_durag, 'dome': hat_dome,
    'ushanka': hat_ushanka, 'crown': hat_crown, 'spartan': hat_spartan, 'clownNose': hat_clown_nose, 'plunger': hat_plunger,
    'balaclava': hat_balaclava, 'rainbowWig': hat_rainbow_wig, 'bob': hat_bob, 'horns': hat_horns, 'ramHorns': hat_ram_horns,
    'thorns': hat_thorns, 'fedora': hat_fedora, 'gem': hat_gem, 'thirdEye': hat_third_eye, 'wreath': hat_wreath, 'banana': hat_banana,
    'seal': hat_seal, 'shrooms': hat_shrooms, 'laserEye': hat_laser_eye,
}


# ---- hoods (head space; the costumes' own, painted in the hat slot: no costume comes with a Head) ----

HOOD_C, HOOD_R = (0, 0.02, -0.038), (0.156, 0.17, 0.162)


def hood_opening(q, w=0.116, top=0.094, bottom=-0.13):
    if q.z < 0.0:
        return False
    u, v = abs(q.x) / w, (q.y - (top + bottom) / 2) / ((top - bottom) / 2)
    return u ** 3 + abs(v) ** 3 < 1


def hood_base(name, m, k=0):
    """The hood (swatch k) round the face, with a rolled rim."""
    p = m['paint']
    out = [sw(dome(f'{name}', HOOD_C, HOOD_R, p, -0.16, 0.0, seg=(52, 32), holes=hood_opening, thick=0.008), 'hat', k)]
    rim = []
    for i in range(40):
        a = TAU * i / 40
        x = 0.118 * math.copysign(abs(math.sin(a)) ** (2 / 3), math.sin(a))
        y = -0.018 + 0.114 * math.copysign(abs(math.cos(a)) ** (2 / 3), math.cos(a))
        rim.append(Vector((x, y, ell_z((HOOD_C, HOOD_R), x, y) - 0.002)))
    out.append(sw(detailed.loop(f'{name}Rim', rim, 0.008, p, axis=(0, 0, 1), ring=8, n=2), 'hat', k))
    return out


def hood_plain(m):
    return hood_base('Hood', m)


def hood_shark(m):
    """Shark: a row of white teeth (swatch 1) round the opening and a fin on top."""
    p = m['paint']
    out = hood_base('SharkHood', m)
    for i in range(22):
        a = -1.9 + i * (3.8 / 21)
        x = 0.112 * math.copysign(abs(math.sin(a)) ** (2 / 3), math.sin(a))
        y = -0.018 + 0.108 * math.copysign(abs(math.cos(a)) ** (2 / 3), math.cos(a))
        q = Vector((x, y, ell_z((HOOD_C, HOOD_R), x, y) - 0.004))
        d = Vector((-x, -(y + 0.018), 0)).normalized()
        out.append(sw(strand(f'SharkTooth{i}', [q, q + d * 0.024], 0.008, 0.0008, p, ring=5, n=2, round_tip=False, up=(0, 0, 1), flat=0.5), 'hat', 1))
    fin = [Vector((0, 0.18, -0.07)), Vector((0, 0.235, -0.11)), Vector((0, 0.25, -0.15))]
    out.append(sw(strand('SharkFin', fin, 0.03, 0.002, p, ring=10, n=4, up=(1, 0, 0), flat=0.3, round_tip=False), 'hat', 0))
    return out


def hood_banana(m):
    """Banana: the hood drawn up to a stalk (swatch 1)."""
    p = m['paint']
    out = hood_base('BananaHood', m)
    out.append(sw(strand('BananaTop', [(0, 0.15, -0.04), (0.01, 0.22, -0.05), (0.03, 0.27, -0.03)], 0.06, 0.008, p, ring=12, n=5, round_tip=False), 'hat', 0))
    out.append(sw(strand('BananaStalk', [(0.03, 0.265, -0.03), (0.04, 0.29, -0.02)], 0.009, 0.008, p, ring=8, n=2), 'hat', 1))
    return out


def hood_dragon(m):
    """Dragon: spines down the middle (swatch 1) and two little horns."""
    p = m['paint']
    out = hood_base('DragonHood', m)
    for k in range(6):
        a = -0.2 + k * 0.42
        root = Vector((0, 0.02 + 0.168 * math.cos(a), -0.038 - 0.16 * math.sin(a)))
        d = Vector((0, math.cos(a), -math.sin(a)))
        out.append(sw(strand(f'DragonSpine{k}', [root - d * 0.01, root + d * 0.035], 0.016, 0.001, p, ring=8, n=2, round_tip=False,
                             up=(1, 0, 0), flat=0.4), 'hat', 1))
    for s in (-1, 1):
        root = Vector((s * 0.1, 0.13, 0.0))
        out.append(sw(strand(f'DragonHorn{s}', [root, root + Vector((s * 0.02, 0.04, -0.02))], 0.012, 0.001, p, ring=8, n=2, round_tip=False), 'hat', 1))
    return out


def hood_toad(m):
    """Toad: two big eyes on top (white swatch 1, pupils swatch 2)."""
    p = m['paint']
    out = hood_base('ToadHood', m)
    for s in (-1, 1):
        c = Vector((s * 0.085, 0.165, -0.005))
        out.append(sw(ell(f'ToadBump{s}', tuple(c), (0.045, 0.04, 0.04), p, seg=(18, 12)), 'hat', 0))
        out.append(sw(ell(f'ToadEye{s}', tuple(c + Vector((0, 0.004, 0.03))), (0.032, 0.022, 0.014), p, seg=(16, 10)), 'hat', 1))
        out.append(sw(ell(f'ToadPupil{s}', tuple(c + Vector((0, 0.004, 0.042))), (0.02, 0.011, 0.006), p, seg=(12, 8)), 'hat', 2))
    return out


def hood_gangster(m):
    """Gangster: the hood up (swatch 0) and a bandana over the mouth (projected: the paisley)."""
    p = m['paint']
    out = hood_base('GangHood', m)
    f = detailed.ChogFace()

    def P(u, t):
        y = -0.038 - 0.085 * t
        hw = 0.122 - 0.11 * t ** 1.6
        x = (-1 + 2 * u) * hw
        return Vector((x, y - 0.012 * (1 - (x / 0.122) ** 2) * t, max(f.face_z(x * 0.95, y), 0.0) + 0.006 + 0.004 * t))
    # Low on the face: lifted into the slot's rows (they stop 0.22 below its top).
    out.append(pj(grid('Bandana', p, P, 20, 8, thick=0.003), 'hat', yoff=0.16))
    return out


def hood_astro(m):
    """Astronaut: the helmet's metal ring (swatch 1) round an open white helmet."""
    p = m['paint']
    out = hood_base('AstroHelmet', m)
    rim = []
    for i in range(40):
        a = TAU * i / 40
        x = 0.124 * math.copysign(abs(math.sin(a)) ** (2 / 3), math.sin(a))
        y = -0.018 + 0.12 * math.copysign(abs(math.cos(a)) ** (2 / 3), math.cos(a))
        rim.append(Vector((x, y, ell_z((HOOD_C, HOOD_R), x, y) + 0.004)))
    out.append(sw(detailed.loop('AstroRing', rim, 0.011, p, axis=(0, 0, 1), ring=10, n=2), 'hat', 1))
    return out


HOODS = {'hood': hood_plain, 'sharkHood': hood_shark, 'bananaHood': hood_banana, 'dragonHood': hood_dragon, 'toadHood': hood_toad,
         'gangsterHood': hood_gangster, 'astroHelmet': hood_astro}


# ---- outfits (body space; slot 'body') ----------------------------------------------------------

TRUNK_C, TRUNK_R = (0, 0.12, 0), (0.073, 0.084, 0.063)


def pear(v):
    if v.y < 0.12:
        t = min(1.0, (0.12 - v.y) / 0.084)
        v.x *= 1 + 0.08 * t
        v.z *= 1 + 0.06 * t
    return v


def torso_z(x, y, d=0.0):
    """The front of the onesie's trunk (pear-shaped below the chest), pushed out by d."""
    t = min(1.0, max(0.0, (0.12 - y) / 0.084))
    kx, kz = 1 + 0.08 * t, 1 + 0.06 * t
    return ell_z(((0, TRUNK_C[1], 0), (TRUNK_R[0] * kx + d, TRUNK_R[1] + d, TRUNK_R[2] * kz + d)), x, y)


def on_torso(x, y, lift):
    e = 1e-4
    n = Vector((-(torso_z(x + e, y) - torso_z(x - e, y)) / (2 * e), -(torso_z(x, y + e) - torso_z(x, y - e)) / (2 * e), 1)).normalized()
    return detailed.frame_z(Vector((x, y, torso_z(x, y))) + n * lift, n)


def torso_line(pts, lift):
    return [Vector((x, y, torso_z(x, y) + lift)) for x, y in pts]


def shell(name, m, d=0.006, hem=0.05, shoulders=True, sleeves=0.0, flare=None, hood=False):
    """The garment's body: the trunk (and shoulders) blown up by d, fused, open below the hem.
    `sleeves` > 0 adds short sleeves that long; `flare` = (y, extra) a skirt flaring out to the hem; `hood` a hood down at the back."""
    p = m['paint']
    (cx, cy, cz), (rx, ry, rz) = TRUNK_C, TRUNK_R
    objs = [ell(f'{name}Trunk', (cx, cy, cz), (rx + d, ry + d, rz + d), p, seg=(36, 24), deform=pear)]
    if shoulders:
        for s in (-1, 1):
            objs.append(ell(f'{name}Shoulder{s}', (s * 0.056, 0.165, 0), (0.027 + d, 0.023 + d, 0.027 + d), p, r=(0, 0, -s * 0.5)))
    if sleeves:
        for s in (-1, 1):
            a, b = Vector((s * 0.058, 0.168, 0.0)), Vector((s * 0.096, 0.137, 0.006))
            objs.append(strand(f'{name}Sleeve{s}', [a, a.lerp(b, 0.5), a.lerp(b, min(1.0, sleeves / 0.05))], 0.027, 0.0255, p, ring=14, n=3, round_tip=False))
    if flare:
        y, extra = flare
        objs.append(ell(f'{name}Skirt', (0, y, 0), (rx + d + extra, 0.07, rz + d + extra * 0.9), p, seg=(36, 20)))
    if hood:
        objs.append(ell(f'{name}Hood', (0, 0.19, -0.058), (0.078, 0.04, 0.05), p, seg=(24, 14)))
    for o in objs:
        o['fuse'] = 1
        o['budget'] = 2400
        o['cut'] = [hem, 0.0]
        pj(o, 'body')
    return objs


def collar(name, m, k, y=0.178, r=0.042, minor=0.0065, tilt=0.42):
    return sw(torus(name, (0, y, 0.004), r, minor, m['paint'], r=(math.pi / 2 + tilt, 0, 0), seg=32, mseg=8), 'body', k)


def wear_tee(m):
    return shell('Tee', m, sleeves=0.034) + [collar('TeeCollar', m, 0)]


def wear_tank(m):
    """A sleeveless top: the onesie's shoulders and arms come out through the arm holes (trim: swatch 0)."""
    out = shell('Tank', m, d=0.005, shoulders=False)
    for s in (-1, 1):
        out.append(sw(torus(f'TankHole{s}', (s * 0.06, 0.163, 0.0), 0.024, 0.0045, m['paint'], r=(0, math.pi / 2 - s * 0.35, s * 0.5), seg=24, mseg=6), 'body', 0))
    out.append(sw(strand('TankNeck', torso_line([(-0.036, 0.2), (-0.018, 0.165), (0, 0.15), (0.018, 0.165), (0.036, 0.2)], 0.006), 0.004, 0.004,
                         m['paint'], ring=6, n=4), 'body', 0))
    return out


def wear_hoodie(m):
    """A hoodie: long sleeves (the arms take its colour), the hood down at the back, a pocket (swatch 1) and drawstrings (swatch 2)."""
    p = m['paint']
    out = shell('Hoodie', m, d=0.007, hood=True)
    out.append(sw(rbox('HoodiePocket', (0, 0.083, torso_z(0, 0.083, 0.007) + 0.002), (0.085, 0.038, 0.008), p, r=(0.25, 0, 0), bevel=0.006, segs=2), 'body', 1))
    for s in (-1, 1):
        out.append(sw(strand(f'HoodieString{s}', torso_line([(s * 0.016, 0.18), (s * 0.017, 0.155), (s * 0.02, 0.128)], 0.009), 0.0028, 0.0028, p, ring=6, n=4), 'body', 2))
        out.append(sw(ell(f'HoodieAglet{s}', tuple(torso_line([(s * 0.02, 0.126)], 0.01)[0]), (0.004, 0.006, 0.004), p, seg=(8, 6)), 'body', 2))
    return out


def wear_track(m):
    """A track jacket: stand-up collar (swatch 0), zip (swatch 1), a stripe over each shoulder (swatch 2)."""
    p = m['paint']
    out = shell('Track', m, d=0.006)
    out.append(sw(strand('TrackZip', torso_line([(0, 0.19), (0, 0.15), (0, 0.11), (0, 0.06)], 0.0075), 0.0022, 0.0022, p, ring=6, n=4), 'body', 1))
    out.append(sw(rbox('TrackPull', tuple(torso_line([(0.0, 0.155)], 0.009)[0]), (0.006, 0.014, 0.003), p, bevel=0.001, segs=1), 'body', 1))
    out.append(sw(collar('TrackCollar', m, 0, y=0.185, r=0.044, minor=0.009, tilt=0.3), 'body', 0))
    for s in (-1, 1):
        for k, off in enumerate((-0.005, 0.005)):
            pts = [Vector((s * 0.035, 0.192, 0.0 + off)), Vector((s * 0.062, 0.19, 0.0 + off)), Vector((s * 0.08, 0.17, 0.004 + off)), Vector((s * 0.09, 0.15, 0.008 + off))]
            out.append(sw(strand(f'TrackStripe{s}{k}', pts, 0.0026, 0.0026, p, ring=6, n=4), 'body', 2))
    return out


def lapel_v(name, m, k, depth=0.115, top_w=0.034, lift=0.0075, width=0.009):
    """The two lapels of a jacket as flat ribbons along a V from the collar to `depth`."""
    out = []
    for s in (-1, 1):
        pts = torso_line([(s * top_w, 0.198), (s * top_w * 0.75, 0.17), (s * 0.006, depth)], lift)
        out.append(sw(strand(f'{name}{s}', pts, width, width * 0.7, m['paint'], ring=8, n=4, up=(0, 0, 1), flat=0.3), 'body', k))
    return out


def shirt_v(name, m, k, depth=0.112, top_w=0.03, lift=0.0055):
    """The shirt showing in a jacket's V (swatch k)."""
    f = lambda x, y: Vector((x, y, torso_z(x, y) + lift))
    panel, _ = detailed.sheet(name, f, 0, lambda t: top_w * (1 - t) + 0.002, 0.2, depth, 0.0, 0.002, m['paint'], nu=6, nv=6)
    return sw(panel, 'body', k)


def wear_suit(m):
    """A suit or tuxedo: jacket (projected), lapels (swatch 0), shirt (swatch 1), tie (swatch 2), buttons (swatch 3)."""
    p = m['paint']
    out = shell('Suit', m, d=0.0065, hem=0.045)
    out.append(shirt_v('SuitShirt', m, 1, depth=0.1, top_w=0.036, lift=0.0095))
    out += lapel_v('SuitLapel', m, 0, depth=0.098, top_w=0.04, lift=0.0105, width=0.011)
    out.append(sw(strand('SuitTie', torso_line([(0, 0.19), (0.0, 0.15), (0.001, 0.112)], 0.0118), 0.0045, 0.0078, p, ring=8, n=4, up=(0, 0, 1), flat=0.35), 'body', 2))
    out.append(sw(ell('SuitKnot', tuple(torso_line([(0, 0.176)], 0.012)[0]), (0.0075, 0.0065, 0.004), p, seg=(10, 8)), 'body', 2))
    for k, y in enumerate((0.088, 0.068)):
        out.append(sw(ell(f'SuitButton{k}', tuple(torso_line([(0.003, y)], 0.0085)[0]), (0.0042, 0.0042, 0.0022), p, seg=(10, 6)), 'body', 3))
    return out


def wear_vest(m):
    """A puffer vest: quilted (the pattern), no sleeves, a high collar (swatch 0) and a zip (swatch 1)."""
    p = m['paint']
    out = shell('Vest', m, d=0.012, hem=0.055, shoulders=False)
    for s in (-1, 1):
        out.append(sw(torus(f'VestHole{s}', (s * 0.062, 0.163, 0.0), 0.026, 0.006, p, r=(0, math.pi / 2 - s * 0.35, s * 0.5), seg=24, mseg=6), 'body', 0))
    out.append(sw(collar('VestCollar', m, 0, y=0.188, r=0.046, minor=0.011, tilt=0.25), 'body', 0))
    out.append(sw(strand('VestZip', torso_line([(0, 0.19), (0, 0.13), (0, 0.06)], 0.0135), 0.002, 0.002, p, ring=6, n=4), 'body', 1))
    return out


def wear_robe(m):
    """A robe to the shins: open down the front over a shirt (swatch 1), the collar (swatch 0) round the shoulders, a sash (swatch 2)."""
    p = m['paint']
    out = shell('Robe', m, d=0.008, hem=0.012, flare=(0.055, 0.02))
    out.append(shirt_v('RobeShirt', m, 1, depth=0.03, top_w=0.03, lift=0.011))
    # The trim (fur on a king) round the neck and down both edges of the opening.
    for s_ in (-1, 1):
        pts = torso_line([(s_ * 0.05, 0.2), (s_ * 0.034, 0.17), (s_ * 0.018, 0.12), (s_ * 0.012, 0.07), (s_ * 0.016, 0.03)], 0.012)
        out.append(sw(strand(f'RobeTrim{s_}', pts, 0.011, 0.009, p, ring=10, n=4, up=(0, 0, 1), flat=0.6, fuse=True), 'body', 0))
    out.append(sw(strand('RobeSash', torso_line([(0.06, 0.17), (0.02, 0.12), (-0.03, 0.08), (-0.07, 0.05)], 0.016), 0.007, 0.007, p, ring=8, n=4,
                         up=(0, 0, 1), flat=0.35), 'body', 2))
    return out


def wear_chinese(m):
    """A Chinese jacket: a mandarin collar (swatch 0), frog fastenings down the front (swatch 1)."""
    p = m['paint']
    out = shell('Chinese', m, d=0.0065)
    out.append(sw(band('ChineseCollar', p, 0.002, 0.044, 0.046, 0.176, 0.25, 0.02, bulge=0.002, thick=0.003), 'body', 0))
    out.append(sw(strand('ChineseSeam', torso_line([(0, 0.18), (0, 0.12), (0, 0.06)], 0.0072), 0.0018, 0.0018, p, ring=6, n=4), 'body', 0))
    for k, y in enumerate((0.165, 0.14, 0.115, 0.09)):
        out.append(sw(strand(f'ChineseFrog{k}', torso_line([(-0.013, y), (0.013, y)], 0.0078), 0.0028, 0.0028, p, ring=6, n=2), 'body', 1))
    return out


def wear_yukata(m):
    """A yukata or gi: the collar crossing left over right (swatch 0), an obi (swatch 1)."""
    p = m['paint']
    out = shell('Yukata', m, d=0.0065)
    out.append(sw(strand('YukataCollarR', torso_line([(-0.036, 0.198), (-0.012, 0.15), (0.03, 0.098)], 0.0078), 0.008, 0.008, p, ring=8, n=4,
                         up=(0, 0, 1), flat=0.35), 'body', 0))
    out.append(sw(strand('YukataCollarL', torso_line([(0.036, 0.198), (0.016, 0.16), (0.004, 0.13)], 0.0072), 0.008, 0.008, p, ring=8, n=4,
                         up=(0, 0, 1), flat=0.35), 'body', 0))
    out.append(sw(band('YukataObi', p, 0.0, 0.071, 0.062, 0.068, 0.0, 0.024, bulge=0.004, flare=-0.002, thick=0.003), 'body', 1))
    return out


def wear_polo(m):
    """A camp-collar shirt (the Hawaiian): two collar points (swatch 0) and a placket of buttons (swatch 1)."""
    p = m['paint']
    out = shell('Polo', m, sleeves=0.036)
    for s in (-1, 1):
        G = on_torso(s * 0.022, 0.175, 0.008)
        flap = ell(f'PoloCollar{s}', (0, 0, 0), (0.022, 0.016, 0.003), p, parent=G @ M((0, 0, 0), (0, 0, s * 0.6)), seg=(10, 6))
        out.append(sw(flap, 'body', 0))
    for k, y in enumerate((0.15, 0.12, 0.09)):
        out.append(sw(ell(f'PoloButton{k}', tuple(torso_line([(0.0, y)], 0.0068)[0]), (0.0035, 0.0035, 0.002), p, seg=(8, 6)), 'body', 1))
    return out


def wear_onesie(m):
    """A costume onesie: long sleeves and a belly panel (swatch 1)."""
    p = m['paint']
    out = shell('Onesie', m, d=0.008, hem=0.035)
    f = lambda x, y: Vector((x, y, torso_z(x, y, 0.008) + 0.002))
    panel, _ = detailed.sheet('OnesieBelly', f, 0, lambda t: 0.046 * math.sin(math.pi * (0.1 + 0.8 * t)), 0.16, 0.045, 0.0, 0.002, p, nu=10, nv=8)
    out.append(sw(panel, 'body', 1))
    return out


def wear_astro(m):
    """A space suit: puffy, a chest unit (swatch 1, buttons 2 and 3), a backpack (swatch 0)."""
    p = m['paint']
    out = shell('Astro', m, d=0.011, hem=0.04)
    G = on_torso(0, 0.11, 0.016)
    out.append(sw(rbox('AstroUnit', (0, 0, 0), (0.06, 0.036, 0.012), p, parent=G, bevel=0.004, segs=2), 'body', 1))
    for k, (dx, c) in enumerate(((-0.016, 2), (0.0, 3), (0.016, 2))):
        out.append(sw(ell(f'AstroKnob{k}', (dx, 0.004, 0.007), (0.005, 0.005, 0.003), p, parent=G, seg=(8, 6)), 'body', c))
    out.append(sw(rbox('AstroPack', (0, 0.13, -0.085), (0.11, 0.1, 0.04), p, bevel=0.012, segs=2), 'body', 0))
    return out


def wear_armor(m):
    """Golden armour: a breastplate and round pauldrons, all gold."""
    g = m['gold']
    out = []
    for o in [ell('ArmorTrunk', TRUNK_C, (TRUNK_R[0] + 0.009, TRUNK_R[1] + 0.006, TRUNK_R[2] + 0.009), g, seg=(36, 24), deform=pear)]:
        o['cut'] = [0.06, 0.0]
        out.append(o)
    for s in (-1, 1):
        out.append(dome(f'ArmorPauldron{s}', (s * 0.066, 0.168, 0.0), (0.044, 0.034, 0.042), g, y0=0.155, tilt=0.0, thick=0.004, seg=(24, 14)))
        out.append(torus(f'ArmorRidge{s}', (s * 0.066, 0.16, 0.0), 0.042, 0.004, g, r=(math.pi / 2, 0, -s * 0.15), seg=28, mseg=6))
    out.append(strand('ArmorRidgeMid', torso_line([(0, 0.18), (0, 0.13), (0, 0.075)], 0.012), 0.004, 0.004, g, ring=6, n=4))
    for k, y in enumerate((0.14, 0.1)):
        out.append(strand(f'ArmorBand{k}', torso_line([(-0.06, y + 0.01), (0, y), (0.06, y + 0.01)], 0.011), 0.0032, 0.0032, g, ring=6, n=4))
    return out


def wear_duck(m):
    """A rubber duck pool float round the waist (swatch 0), the duck's head at his right with an orange bill (swatch 1)."""
    p = m['paint']
    out = [sw(torus('DuckRing', (0, 0.075, 0.004), 0.092, 0.03, p, r=(math.pi / 2, 0, 0), seg=40, mseg=14), 'body', 0)]
    c = Vector((-0.07, 0.12, 0.08))
    out.append(sw(ell('DuckNeck', tuple(c + Vector((0.01, -0.03, -0.01))), (0.028, 0.035, 0.028), p, seg=(16, 12)), 'body', 0))
    out.append(sw(ell('DuckHead', tuple(c), (0.034, 0.032, 0.032), p, seg=(18, 12)), 'body', 0))
    out.append(sw(ell('DuckBill', tuple(c + Vector((-0.012, -0.006, 0.03))), (0.02, 0.009, 0.016), p, seg=(14, 8)), 'body', 1))
    for s in (-1, 1):
        out.append(ell(f'DuckEye{s}', tuple(c + Vector((s * 0.018 - 0.006, 0.01, 0.022))), (0.0045, 0.006, 0.003), m['ink'], seg=(8, 6)))
    return out


WEARS = {
    'tee': wear_tee, 'tank': wear_tank, 'hoodie': wear_hoodie, 'track': wear_track, 'suit': wear_suit, 'vest': wear_vest, 'robe': wear_robe,
    'chinese': wear_chinese, 'yukata': wear_yukata, 'polo': wear_polo, 'onesie': wear_onesie, 'astro': wear_astro,
    'armor': wear_armor, 'duck': wear_duck,
}


# ---- held props (right-hand space; atlas colours only) --------------------------------------------------
# The hand's palm is at the origin, fingers down (-y), palm toward the body (+x for the right hand); props
# stand up out of the fist, a little in front of it.

GRIP = Vector((0.004, 0.01, 0.024))


def prop_candle(m, mat):
    """A price candle: the body and its wick."""
    return [rbox('CandleBody', tuple(GRIP + Vector((0, 0.02, 0))), (0.02, 0.06, 0.02), m[mat], bevel=0.002, segs=1),
            rbox('CandleWick', tuple(GRIP + Vector((0, 0.02, 0))), (0.004, 0.1, 0.004), m[mat], bevel=0.001, segs=1)]


def prop_green_candle(m):
    return prop_candle(m, 'denim')


def prop_red_candle(m):
    return prop_candle(m, 'c1')


def prop_coin(m):
    """A gold coin held up, a B on its face."""
    G = M(tuple(GRIP + Vector((0, 0.026, 0.006))), (math.pi / 2, 0, 0))
    out = [detailed.cyl('Coin', (0, 0, 0), 0.022, 0.005, m['gold'], parent=G, seg=28)]
    out.append(torus('CoinRim', (0, 0, 0.003), 0.019, 0.0016, m['gold'], parent=M(tuple(GRIP + Vector((0, 0.026, 0.006))))))
    return out


def prop_cigar(m):
    """A fat cigar between the fingers, its tip glowing."""
    a, b = GRIP + Vector((-0.02, 0.0, 0.0)), GRIP + Vector((0.035, 0.02, 0.008))
    return [strand('Cigar', [a, b], 0.0065, 0.0065, m['wood'], ring=10, n=2, round_tip=False),
            rbox('CigarBand', tuple(a.lerp(b, 0.25)), (0.006, 0.015, 0.015), m['gold'], r=(0, 0, 0.35), bevel=0.002, segs=1),
            ell('CigarTip', tuple(b + (b - a).normalized() * 0.001), (0.0062, 0.0062, 0.0062), m['c1'], seg=(10, 8))]


def prop_heart(m):
    """A little red heart."""
    G = M(tuple(GRIP + Vector((0, 0.03, 0.006))))
    return [ell('HeartL', (-0.011, 0.006, 0), (0.014, 0.013, 0.008), m['c1'], parent=G, seg=(14, 10)),
            ell('HeartR', (0.011, 0.006, 0), (0.014, 0.013, 0.008), m['c1'], parent=G, seg=(14, 10)),
            rbox('HeartTip', (0, -0.006, 0), (0.024, 0.024, 0.014), m['c1'], r=(0, 0, math.pi / 4), parent=G, bevel=0.005, segs=2)]


def prop_knife(m):
    """A pocket knife: dark handle, steel blade up."""
    return [rbox('KnifeHandle', tuple(GRIP + Vector((0, 0.002, 0))), (0.012, 0.04, 0.008), m['ink'], bevel=0.003, segs=2),
            rbox('KnifeBlade', tuple(GRIP + Vector((0.002, 0.045, 0))), (0.01, 0.05, 0.003), m['metal'], bevel=0.001, segs=1),
            ell('KnifeTip', tuple(GRIP + Vector((0.0, 0.07, 0))), (0.005, 0.006, 0.0016), m['metal'], seg=(8, 6))]


def prop_cup(m):
    """A coffee to go: a white cup, a dark lid, a green badge."""
    c = GRIP + Vector((0, 0.022, 0.004))
    return [detailed.cyl('Cup', tuple(c), 0.018, 0.05, m['white'], seg=20, r_top=0.022),
            detailed.cyl('CupLid', tuple(c + Vector((0, 0.028, 0))), 0.023, 0.007, m['ink'], seg=20),
            detailed.cyl('CupBadge', tuple(c + Vector((0, 0.002, 0.019))), 0.008, 0.002, m['denim'], r=(math.pi / 2, 0, 0), seg=16)]


def prop_frog(m, name='Fwog'):
    """A little green frog sitting in the hand."""
    c = GRIP + Vector((0, 0.022, 0.006))
    g = m['denim']
    out = [ell(f'{name}Body', tuple(c), (0.02, 0.016, 0.017), g, seg=(16, 12)),
           ell(f'{name}Head', tuple(c + Vector((0, 0.016, 0.004))), (0.019, 0.013, 0.015), g, seg=(16, 12))]
    for s in (-1, 1):
        e = c + Vector((s * 0.01, 0.027, 0.008))
        out.append(ell(f'{name}Eye{s}', tuple(e), (0.0065, 0.0065, 0.0065), m['white'], seg=(10, 8)))
        out.append(ell(f'{name}Pupil{s}', tuple(e + Vector((0, 0, 0.005))), (0.0032, 0.0036, 0.002), m['ink'], seg=(8, 6)))
    out.append(strand(f'{name}Mouth', [c + Vector((-0.01, 0.012, 0.018)), c + Vector((0, 0.009, 0.0195)), c + Vector((0.01, 0.012, 0.018))],
                      0.0014, 0.0014, m['ink'], ring=5, n=3))
    return out


def prop_pepe(m):
    """Pepe: the frog with red lips."""
    out = prop_frog(m, 'Pepe')
    c = GRIP + Vector((0, 0.022, 0.006))
    out.append(ell('PepeLips', tuple(c + Vector((0, 0.009, 0.017))), (0.012, 0.0035, 0.004), m['c1'], seg=(12, 6)))
    return out


PROPS = {'greenCandle': prop_green_candle, 'redCandle': prop_red_candle, 'coin': prop_coin, 'cigar': prop_cigar, 'heart': prop_heart,
         'knife': prop_knife, 'cup': prop_cup, 'fwog': prop_frog, 'pepe': prop_pepe}


# ---- assembly --------------------------------------------------------------------------------------

def assemble(name, objs):
    """Realize, fuse what is flagged (per material and paint), cut hems, write the paint UVs, join into one node."""
    blib.realize(objs)
    groups: dict[tuple, list] = {}
    loose = []
    for o in objs:
        if o.get('fuse'):
            key = (o.data.materials[0].name, o.get('uvp', ''), o.get('uvs', ''), round(float(o.get('uvy', 0.0)), 4))
            groups.setdefault(key, []).append(o)
        else:
            loose.append(o)
    pieces = []
    for key, os_ in groups.items():
        props = {k: os_[0][k] for k in ('uvp', 'uvs', 'uvy', 'cut') if k in os_[0]}
        budget = max(int(o.get('budget', characters.FACE_BUDGET)) for o in os_)
        fine = any('Hair' in o.name for o in os_)
        piece = characters.fuse(os_, f'{name}_{len(pieces)}', budget=budget, voxel=0.0018 if fine else characters.VOXEL)
        for k, v in props.items():
            piece[k] = v
        pieces.append(piece)
    for o in pieces + loose:
        if 'cut' in o:
            y0, tilt = o['cut']
            edit(o, lambda bm: cut(bm, y0, tilt))
        apply_uvs(o)
    return blib.join(pieces + loose, name)
