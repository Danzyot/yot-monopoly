"""Drawing on a surface: thin patches laid over a face or an eyeball, in layers.

The 2D art's eyes are flat shapes stacked on each other (outline, white, pupil,
glint). Modelled as overlapping solids, which piece shows where two of them
cross depends on a fraction of a millimetre and on the angle they are seen
from, so the two eyes of a turned head stop matching. A patch here is instead
laid over the surface beneath it at a fixed height, so its outline is its own
and the stacking order is the drawing order, from any angle.

A surface maps 2D coordinates to points (three-space, head space: y up, z
toward the camera) and normals:

    FaceSurf(F)                 the face, (x, y) as on the face
    DomeSurf(F, c, rx, ry, h)   the face with a smooth dome raised over an eye
    BallSurf(G, rx, ry, d)      the front of an ellipsoid in frame G, (u, v) in that frame

and draws on it with

    patch(...)    a filled region, star-shaped about its centre (or a band between two outlines)
    stroke(...)   a brush line along a path, tapering to its ends
"""

import math

import bmesh
from mathutils import Vector

from detailed import _finish, _spline

EPS = 1e-5


class Surf:
    """A surface: p(a, b) -> Vector (head space). Normals are taken numerically, facing +z (out of the face)."""

    def p(self, a, b):
        raise NotImplementedError

    def n(self, a, b):
        e = 1e-4
        du = self.p(a + e, b) - self.p(a - e, b)
        dv = self.p(a, b + e) - self.p(a, b - e)
        n = du.cross(dv)
        if n.length < 1e-12:
            return Vector((0, 0, 1))
        n.normalize()
        return n if n.z >= 0 else -n

    def at(self, a, b, lift=0.0):
        return self.p(a, b) + self.n(a, b) * lift


class FaceSurf(Surf):
    def __init__(self, F):
        self.F = F

    def p(self, x, y):
        return Vector((x, y, self.F.face_z(x, y)))


class DomeSurf(Surf):
    """The face with domes raised on it: each (cx, cy, rx, ry, h, rot) a smooth bump h high over that ellipse."""

    def __init__(self, F, domes=(), base=None):
        self.F = F
        self.base = base or FaceSurf(F)
        self.domes = list(domes)

    def height(self, x, y):
        h = 0.0
        for cx, cy, rx, ry, hh, rot in self.domes:
            c, s = math.cos(rot), math.sin(rot)
            u, v = (x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c
            q = 1 - (u / rx) ** 2 - (v / ry) ** 2
            if q > 0:
                # Steep at the foot (the outline sits round it), round over the top.
                h += hh * q ** 0.55
        return h

    def p(self, x, y):
        b = self.base.p(x, y)
        h = self.height(x, y)
        return b + self.base.n(x, y) * h if h else b


class BallSurf(Surf):
    """The front of the ellipsoid (rx, ry, d) at the origin of frame G (z out), as (u, v) in G."""

    def __init__(self, G, rx, ry, d):
        self.G, self.rx, self.ry, self.d = G, rx, ry, d

    def p(self, u, v):
        q = max(0.0, 1 - (u / self.rx) ** 2 - (v / self.ry) ** 2)
        return self.G @ Vector((u, v, self.d * math.sqrt(q)))


class MeshSurf(Surf):
    """The front of a built mesh (a Blender object, transforms applied), found by casting rays at it from the
    front: (x, y) -> the surface point in front. Off the mesh: `fallback` (a Surf)."""

    def __init__(self, obj, fallback):
        from mathutils.bvhtree import BVHTree
        me = obj.data
        self.tree = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
        self.fallback = fallback

    def p(self, x, y):
        # Three (x, y, z) is Blender (x, -z, y): cast from in front (three +z) back along three -z.
        hit = self.tree.ray_cast(Vector((x, -1.0, y)), Vector((0, 1, 0)))
        if hit[0] is None:
            return self.fallback.p(x, y)
        b = hit[0]
        return Vector((b.x, b.z, -b.y))


# ---- outlines -------------------------------------------------------------------------

def ellipse(cx, cy, rx, ry, rot=0.0):
    """Inside-test of an ellipse."""
    c, s = math.cos(rot), math.sin(rot)

    def inside(x, y):
        u, v = (x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c
        return (u / rx) ** 2 + (v / ry) ** 2 <= 1
    return inside


def boundary(inside, c, rmax, n=64, iters=22):
    """The outline of a region star-shaped about c: its radius at n angles (from +x, counter-clockwise)."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        d = (math.cos(a), math.sin(a))
        lo, hi = 0.0, rmax
        if inside(c[0] + d[0] * hi, c[1] + d[1] * hi):
            out.append(hi)
            continue
        for _ in range(iters):
            mid = (lo + hi) / 2
            if inside(c[0] + d[0] * mid, c[1] + d[1] * mid):
                lo = mid
            else:
                hi = mid
        out.append(lo)
    return out


def patch(name, S, c, rout, lift, mat, rin=None, nr=4, n=None):
    """A thin skin over S at `lift`: the region round c out to rout (radii per angle, or a function of the angle),
    or the band between rin and rout. The vertices bunch toward the outline, where the surface bends most."""
    if callable(rout):
        n = n or 64
        rout = [rout(2 * math.pi * i / n) for i in range(n)]
    n = len(rout)
    if callable(rin):
        rin = [rin(2 * math.pi * i / n) for i in range(n)]
    bm = bmesh.new()
    vert = lambda a, b: bm.verts.new(S.at(a, b, lift))
    rings = []
    ks = [1 - (1 - j / nr) ** 1.6 for j in range(0 if rin else 1, nr + 1)]
    for k in ks:
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            r0 = rin[i] if rin else 0.0
            r = r0 + (rout[i] - r0) * k
            ring.append(vert(c[0] + r * math.cos(a), c[1] + r * math.sin(a)))
        rings.append(ring)
    if not rin:
        ctr = vert(c[0], c[1])
        for i in range(n):
            bm.faces.new((ctr, rings[0][i], rings[0][(i + 1) % n]))
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    _face_out(bm, S, c)
    return _finish(name, bm, mat, False)


def region(name, S, inside, c, rmax, lift, mat, n=64, nr=4):
    """A filled region given by its inside-test, star-shaped about c."""
    return patch(name, S, c, boundary(inside, c, rmax, n), lift, mat, nr=nr)


def oval(name, S, cx, cy, rx, ry, lift, mat, rot=0.0, n=48, nr=4):
    return region(name, S, ellipse(cx, cy, rx, ry, rot), (cx, cy), max(rx, ry) * 1.05, lift, mat, n=n, nr=nr)


def band(name, S, cx, cy, rx, ry, t_in, t_out, lift, mat, rot=0.0, n=64):
    """An elliptical ring: from (rx, ry) - t_in out to (rx, ry) + t_out."""
    def r_at(a, ex, ey):
        # The radius of the ellipse (ex, ey) along direction a (in the rotated frame).
        u, v = math.cos(a - rot), math.sin(a - rot)
        return 1 / math.sqrt((u / ex) ** 2 + (v / ey) ** 2)
    rin = [r_at(2 * math.pi * i / n, rx - t_in, ry - t_in) for i in range(n)]
    rout = [r_at(2 * math.pi * i / n, rx + t_out, ry + t_out) for i in range(n)]
    return patch(name, S, (cx, cy), rout, lift, mat, rin=rin, nr=2)


def emergence(B, S, n=64):
    """Where the ball B comes out of the surface S (both in head space): the meeting points, round the ball's
    rim at n angles, as 2D points in S's coordinates (x, y: S is the face)."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        du, dv = B.rx * math.cos(a), B.ry * math.sin(a)
        above = lambda t: (lambda p: p.z > S.p(p.x, p.y).z)(B.p(du * t, dv * t))
        lo, hi = 0.0, 1.0
        if not above(lo):
            pts.append(None)
            continue
        for _ in range(26):
            mid = (lo + hi) / 2
            if above(mid):
                lo = mid
            else:
                hi = mid
        p = B.p(du * lo, dv * lo)
        pts.append((p.x, p.y))
    return pts


def outline_band(name, S, pts, t_in, t_out, lift, mat):
    """A band along a closed outline (2D points on S, in order round a centre): t_in inside it, t_out outside."""
    n = len(pts)
    cx, cy = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    bm = bmesh.new()
    inner, outer = [], []
    for x, y in pts:
        d = Vector((x - cx, y - cy))
        r = d.length
        d.normalize()
        a, b = (cx + d.x * max(0.0, r - t_in), cy + d.y * max(0.0, r - t_in)), (x + d.x * t_out, y + d.y * t_out)
        inner.append(bm.verts.new(S.at(a[0], a[1], lift)))
        outer.append(bm.verts.new(S.at(b[0], b[1], lift)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((inner[i], outer[i], outer[j], inner[j]))
    _face_out(bm, S, (cx, cy))
    return _finish(name, bm, mat, False)


def stroke(name, S, pts, w, lift, mat, taper=0.7, w1=None, n=8, caps=True):
    """A brush line through 2D points: `w` wide in the middle, narrowing by `taper` toward each end
    (w1: a different width at the end, for a line that thins one way), with round caps."""
    path = [Vector((q[0], q[1], 0)) for q in _spline([(p[0], p[1], 0) for p in pts], n)]
    m = len(path)
    bm = bmesh.new()
    left, right = [], []
    widths = []
    for i, q in enumerate(path):
        t = i / (m - 1)
        base = w if w1 is None else w + (w1 - w) * t
        ww = base * (1 - taper * (2 * t - 1) ** 2)
        d = (path[min(i + 1, m - 1)] - path[max(i - 1, 0)])
        d.z = 0
        d.normalize()
        perp = Vector((-d.y, d.x, 0))
        a, b = q + perp * ww / 2, q - perp * ww / 2
        left.append(bm.verts.new(S.at(a.x, a.y, lift)))
        right.append(bm.verts.new(S.at(b.x, b.y, lift)))
        widths.append(ww)
    for i in range(m - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    if caps:
        for end, sgn in ((0, -1), (m - 1, 1)):
            q = path[end]
            d = (path[end] - path[end - sgn]) if end else (path[0] - path[1])
            d.z = 0
            d.normalize()
            perp = Vector((-d.y, d.x, 0))
            r = widths[end] / 2
            fan = [left[end]]
            for k in range(1, 6):
                a = math.pi * k / 6
                o = q + perp * (r * math.cos(a)) + d * (r * math.sin(a))
                fan.append(bm.verts.new(S.at(o.x, o.y, lift)))
            fan.append(right[end])
            ctr = bm.verts.new(S.at(q.x, q.y, lift))
            for k in range(len(fan) - 1):
                bm.faces.new((ctr, fan[k], fan[k + 1]))
    _face_out(bm, S, path[m // 2])
    return _finish(name, bm, mat, False)


def _face_out(bm, S, c):
    """Turn every face of a patch to face out of the surface (the game draws front faces only)."""
    bm.normal_update()
    want = S.n(c[0], c[1])
    flip = [f for f in bm.faces if f.normal.dot(want) < 0]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
