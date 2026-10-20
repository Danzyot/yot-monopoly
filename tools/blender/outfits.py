"""Outfit items players dress their character in, plus a thumbnail of each.

Every item is modelled once, on a canonical figure, round the point it hangs
from (its anchor):

    head  the skull: a sphere of radius 0.1 round the head pivot (rig.head)
    eyes  the eye line: (0, 0.015, 0.1) in the head's frame, eyes 0.04 apart
    neck  the collar: (0, 0.2, 0) in the body's frame (rig.pose)
    body  the egg body: centre (0, 0.12, 0), radii (0.085, 0.095, 0.075)

client/src/three/characters/outfitFit.json then says, per character, where
each anchor goes and how it stretches (and which items a character's own hat
or helmet rules out). The ids match shared/outfits.ts.

Output
- models/outfits.glb: one node per item id, origin on its anchor. Material
  names are `outfit:<key>`; the game swaps each for the wearing figure's own
  material of that key, so `main` is the player's colour and everything greys
  in jail and fades on bankruptcy with the figure.
- outfits/<id>.webp: a 128 px transparent thumbnail, `main` parts drawn white,
  and outfits/<id>-tint.webp: the mask of those parts, which the picker fills
  with the player's colour and multiplies over the thumbnail.

Signature items (SIGNATURE: a character's own clothes, e.g. CJ WAWA's tee)
are not modelled here: they are that character's garment nodes in
characters.glb (`<id>_Top`, `<id>_Chain`), which the game shows or hides. Only
their thumbnails are made here, from tools/blender/.cache/models/characters.glb,
so build the characters first.

    tools/blender/run.sh outfits.py
    tools/blender/run.sh outfits.py --signature-only   (just the signature thumbnails)
    tools/blender/run.sh outfits.py --preview out.png [--chars path/to/characters.glb] [--looks a,b,c|...]

--preview renders every character wearing a few outfits (needs an
uncompressed characters.glb, e.g. tools/blender/.cache/models/characters.glb).
A character's own garments show unless the look puts another item in their
slot; the look `bare` takes them all off.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402
import blib  # noqa: E402

FIT = os.path.join(blib.REPO, 'client', 'src', 'three', 'characters', 'outfitFit.json')
SLOTS = {
    'cap': 'head', 'beanie': 'head', 'tophat': 'head', 'crown': 'head', 'headphones': 'head',
    'shades': 'eyes', 'specs': 'eyes',
    'chain': 'neck', 'scarf': 'neck', 'bowtie': 'neck',
    'hoodie': 'body', 'jersey': 'body', 'suit': 'body', 'varsity': 'body',
}
# Signature items: id -> (character, garment node, slot). Ids match shared/outfits.ts.
SIGNATURE = {
    'wawa_tee': ('snacky', 'Top', 'body'),
    'cuban_chain': ('snacky', 'Chain', 'neck'),
}
SLOTS.update({k: v[2] for k, v in SIGNATURE.items()})
GARMENT_SLOT = {'Top': 'body', 'Chain': 'neck'}
CHARS_CACHE = os.path.join(blib.HERE, '.cache', 'models', 'characters.glb')
# Thumbnail colours; `main` is white so the picker can tint it.
COLORS = {
    'main': ('#eeeeee', 0.45, 0.0), 'ink': ('#22222a', 0.5, 0.0), 'white': ('#f7f5ef', 0.6, 0.0),
    'gold': ('#f4c542', 0.3, 0.85), 'metal': ('#b9c2cf', 0.3, 0.75), 'glass': ('#1c2438', 0.12, 0.7),
}
# Game frame (y up, z toward the camera) -> Blender (z up).
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()
TAU = math.tau


def mat_for(key):
    name = f'outfit:{key}'
    m = bpy.data.materials.get(name)
    if m:
        return m
    color, rough, metal = COLORS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*blib.hex_rgb(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def gm(p=(0, 0, 0), r=(0, 0, 0), s=(1, 1, 1)):
    """A game-frame transform: translate · rotate (three.js 'XYZ' euler) · scale."""
    if isinstance(s, (int, float)):
        s = (s, s, s)
    S = Matrix.Diagonal((*s, 1))
    R = Euler(r, 'XYZ').to_matrix().to_4x4()
    return Matrix.Translation(Vector(p)) @ R @ S


class Item:
    """One outfit item: primitives in the game frame, merged into one mesh with a slot per material key."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.keys = []

    def _tag(self, faces, key, smooth=True):
        if key not in self.keys:
            self.keys.append(key)
        i = self.keys.index(key)
        for f in faces:
            f.material_index = i
            f.smooth = smooth

    def _prim(self, make, key, M, smooth=True):
        before = set(self.bm.faces)
        make(C @ M @ CI)
        new = [f for f in self.bm.faces if f not in before]
        self._tag(new, key, smooth)

    # Unit primitives, stretched by s; their axis is the game's y.
    def sphere(self, key, p=(0, 0, 0), s=1.0, r=(0, 0, 0), seg=20, rings=12):
        self._prim(lambda M: bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=1, matrix=M),
                   key, gm(p, r, s))

    def cyl(self, key, p=(0, 0, 0), s=(1, 1, 1), r=(0, 0, 0), seg=20, top=1.0, smooth=True):
        """Radius s.x/s.z, height s.y, centred on p; `top` scales the top radius."""
        self._prim(lambda M: bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=1, radius2=top,
                                                   depth=1, matrix=M), key, gm(p, r, s), smooth)

    def box(self, key, p=(0, 0, 0), s=(1, 1, 1), r=(0, 0, 0)):
        self._prim(lambda M: bmesh.ops.create_cube(self.bm, size=1, matrix=M), key, gm(p, r, s), smooth=False)

    def grid(self, key, pts, closed_u=False, smooth=True):
        """A surface through a grid of game-frame points pts[i][j] (i along u, j along v)."""
        bm = self.bm
        rows = [[bm.verts.new(C @ Vector(q)) for q in row] for row in pts]
        faces = []
        nu = len(rows)
        for i in range(nu if closed_u else nu - 1):
            a, b = rows[i], rows[(i + 1) % nu]
            for j in range(len(a) - 1):
                faces.append(bm.faces.new((a[j], b[j], b[j + 1], a[j + 1])))
        self._tag(faces, key, smooth)
        return rows

    def lathe(self, key, profile, M=None, seg=24, phi=(0, TAU), wobble=None):
        """Revolve [(radius, y), ...] about the y axis (phi 0 = +z, the front)."""
        M = M or Matrix()
        closed = abs(phi[1] - phi[0] - TAU) < 1e-6
        n = seg if closed else seg + 1
        pts = []
        for k in range(n):
            a = phi[0] + (phi[1] - phi[0]) * k / seg
            w = wobble(a) if wobble else 1.0
            pts.append([tuple(M @ Vector((math.sin(a) * rr * w, y, math.cos(a) * rr * w))) for rr, y in profile])
        return self.grid(key, pts, closed_u=closed)

    def torus(self, key, major, minor, M=None, seg=28, mseg=8, arc=TAU, a0=0.0):
        """A ring lying flat (round the y axis), then moved by M."""
        M = M or Matrix()
        closed = abs(arc - TAU) < 1e-6
        n = seg if closed else seg + 1
        pts = []
        for i in range(n):
            a = a0 + arc * i / seg
            ring = []
            for j in range(mseg + 1):
                b = TAU * j / mseg
                rr = major + minor * math.cos(b)
                ring.append(tuple(M @ Vector((math.sin(a) * rr, minor * math.sin(b), math.cos(a) * rr))))
            pts.append(ring)
        self.grid(key, pts, closed_u=closed)

    def tube(self, key, points, radius, seg=8, caps=True):
        """A round tube along game-frame points."""
        pts = [Vector(q) for q in points]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            u = t.cross(ref).normalized()
            v = t.cross(u).normalized()
            rr = radius(i / (len(pts) - 1)) if callable(radius) else radius
            rings.append([tuple(p + (u * math.cos(TAU * k / seg) + v * math.sin(TAU * k / seg)) * rr) for k in range(seg + 1)])
        rows = self.grid(key, rings)
        if caps:
            for row, flip in ((rows[0], True), (rows[-1], False)):
                vs = row[:-1]
                f = self.bm.faces.new(list(reversed(vs)) if flip else vs)
                self._tag([f], key)

    def text(self, key, body, M, size=0.05, depth=0.003):
        """Letters (Blender's built-in font), facing +z, centred on M's origin."""
        cu = bpy.data.curves.new(f'{self.name}_{body}', 'FONT')
        cu.body = body
        cu.size = size
        cu.extrude = depth / 2
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        ob = bpy.data.objects.new(cu.name, cu)
        blib.link(ob)
        bpy.context.view_layer.update()
        me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
        before = set(self.bm.faces)
        # Text is built in the XY plane facing +Z (Blender), i.e. lying flat: stand it up to face the game's +z.
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bmesh.ops.transform(tmp, matrix=C @ M @ Matrix.Rotation(0, 4, 'X'), verts=tmp.verts)
        tmp_me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(tmp_me)
        tmp.free()
        self.bm.from_mesh(tmp_me)
        new = [f for f in self.bm.faces if f not in before]
        self._tag(new, key, smooth=False)
        ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
        bpy.data.objects.remove(ob)

    def finish(self):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, me)
        blib.link(obj)
        for k in self.keys:
            me.materials.append(mat_for(k))
        return obj


# ---- shapes on the canonical body -------------------------------------------

EGG = (0.085, 0.095, 0.075)


def shell(it, key, grow, y0, y1, rows=10, seg=28, phi=(0, TAU), wobble=None, phi_fn=None):
    """Part of the egg body's surface, grown by `grow`, between heights y0..y1 (relative to the body centre).

    phi_fn(t) -> (phi0, phi1) narrows the patch per row (t = 0 at y0, 1 at y1).
    """
    a, b, c = (e * grow for e in EGG)
    pts = []
    n = seg if not phi_fn and abs(phi[1] - phi[0] - TAU) < 1e-6 else seg + 1
    closed = n == seg
    for k in range(n):
        col = []
        for j in range(rows + 1):
            t = j / rows
            y = y0 + (y1 - y0) * t
            rr = math.sqrt(max(0.0, 1 - (y / b) ** 2))
            p0, p1 = phi_fn(t) if phi_fn else phi
            ang = p0 + (p1 - p0) * k / seg
            w = wobble(ang, t) if wobble else 1.0
            col.append((math.sin(ang) * a * rr * w, y, math.cos(ang) * c * rr * w))
        pts.append(col)
    it.grid(key, pts, closed_u=closed)


def egg_point(grow, y, ang):
    a, b, c = (e * grow for e in EGG)
    rr = math.sqrt(max(0.0, 1 - (y / b) ** 2))
    return Vector((math.sin(ang) * a * rr, y, math.cos(ang) * c * rr))


def egg_ring(it, key, grow, y, minor, seg=28):
    """A rolled band (hem, cuff, collar) round the egg at height y."""
    pts = []
    for k in range(seg):
        ang = TAU * k / seg
        o = egg_point(grow, y, ang)
        nrm = Vector((o.x, 0, o.z)).normalized()
        ring = []
        for j in range(7):
            b = TAU * j / 6
            ring.append(tuple(o + nrm * minor * math.cos(b) + Vector((0, minor * math.sin(b), 0))))
        pts.append(ring)
    it.grid(key, pts, closed_u=True)


def on_egg(grow, y, ang, lift=0.0):
    """A transform sitting on the egg's surface at (y, ang), facing out."""
    p = egg_point(grow, y, ang)
    a, b, c = (e * grow for e in EGG)
    nrm = Vector((p.x / a ** 2, p.y / b ** 2, p.z / c ** 2)).normalized()
    p = p + nrm * lift
    z = nrm
    x = Vector((0, 1, 0)).cross(z).normalized()
    y_ = z.cross(x)
    R = Matrix((x, y_, z)).transposed().to_4x4()
    return Matrix.Translation(p) @ R


def sleeves(it, key, band=None, y=0.045, r=0.032):
    for side in (1, -1):
        it.sphere(key, (side * 0.08, y, 0.0), (r, r * 0.95, r))
        if band:
            it.torus(band, r * 0.92, 0.004, gm((side * 0.098, y - 0.012, 0), (0, 0, side * 0.9)), seg=16, mseg=5)


# ---- items ------------------------------------------------------------------

def cap():
    it = Item('cap')
    tilt = gm(r=(-0.12, 0, 0))
    # Six-panel dome: the top of a 0.106 sphere down to ~74°.
    prof = [(0.106 * math.sin(a), 0.106 * math.cos(a)) for a in [i * math.radians(74) / 10 for i in range(11)]]
    it.lathe('main', prof, tilt @ gm(), seg=28)
    it.sphere('main', (0, 0.106, 0), 0.011)
    # Seams.
    for k in range(3):
        it.lathe('ink', [(0.1065 * math.sin(a), 0.1065 * math.cos(a)) for a in [i * math.radians(72) / 8 for i in range(1, 9)]],
                 tilt @ gm(r=(0, k * math.pi / 3, 0)), seg=1, phi=(-0.012, 0.012))
    # Brim: a gently curved bill out the front.
    pts = []
    for i in range(13):
        ph = -0.95 + 1.9 * i / 12
        row = []
        for j in range(5):
            t = j / 4
            rr = 0.1 + t * (0.078 * math.cos(ph) ** 1.5)
            y = 0.03 - t * 0.012 - (abs(ph) ** 2) * 0.008 * t
            row.append((math.sin(ph) * rr, y, math.cos(ph) * rr))
        pts.append(row)
    top = [[tuple(tilt @ Vector(q)) for q in row] for row in pts]
    bot = [[tuple(tilt @ Vector((q[0], q[1] - 0.006, q[2]))) for q in row] for row in pts]
    it.grid('main', top)
    it.grid('ink', [list(reversed(r)) for r in bot])
    it.grid('main', [[top[i][-1], bot[i][-1]] for i in range(len(top))])
    # Logo patch on the front panel.
    it.cyl('white', (0, 0.06, 0.09), (0.02, 0.003, 0.02), (math.radians(90 - 50), 0, 0))
    return it.finish()


def beanie():
    it = Item('beanie')
    tilt = gm(r=(-0.18, 0, 0))
    prof = [(0.11 * math.sin(a), 0.112 * math.cos(a) * 1.08) for a in [i * math.radians(68) / 10 for i in range(11)]]
    it.lathe('main', prof, tilt, seg=32)
    # Ribbed turn-up.
    rib = lambda a: 1 + 0.025 * math.cos(a * 30)
    it.lathe('main', [(0.104, 0.025), (0.112, 0.028), (0.114, 0.06), (0.106, 0.064)], tilt, seg=60, wobble=rib)
    it.sphere('white', tuple(tilt @ Vector((0, 0.125, 0))), 0.03, seg=16, rings=10)
    return it.finish()


def tophat():
    it = Item('tophat')
    tilt = gm((0, 0.0, 0), (-0.08, 0, 0.1))
    it.lathe('ink', [(0.0, 0.078), (0.12, 0.072), (0.135, 0.082), (0.13, 0.088), (0.07, 0.088)], tilt, seg=32)
    it.lathe('ink', [(0.068, 0.086), (0.066, 0.15), (0.073, 0.215), (0.0, 0.215)], tilt, seg=32)
    it.lathe('main', [(0.0695, 0.088), (0.0685, 0.118)], tilt, seg=32)
    return it.finish()


def crown():
    it = Item('crown')
    seg, pts = 10, []
    # A gold band whose top edge rises into ten points (five tall, five short).
    for k in range(seg * 4 + 1):
        a = TAU * k / (seg * 4)
        f = (k % 4) / 4
        peak = 1 - abs(f - 0.5) * 2  # 0 at the dips, 1 at the points
        tall = 0.06 if (k // 4) % 2 == 0 else 0.038
        y1 = 0.1 + peak * tall
        col = []
        for rr, y in ((0.072, 0.068), (0.077, 0.068), (0.08, 0.1), (0.082, y1), (0.077, y1), (0.074, 0.1), (0.072, 0.068)):
            col.append((math.sin(a) * rr, y, math.cos(a) * rr))
        pts.append(col)
    it.grid('gold', pts[:-1], closed_u=True, smooth=False)
    for k in range(5):
        a = TAU * (k * 2 * 4 + 2) / (seg * 4)
        it.sphere('gold', (math.sin(a) * 0.082, 0.162, math.cos(a) * 0.082), 0.007, seg=10, rings=6)
        a2 = TAU * k / 5
        it.sphere('main', (math.sin(a2) * 0.081, 0.085, math.cos(a2) * 0.081), (0.011, 0.011, 0.011), seg=12, rings=8)
    return it.finish()


def headphones():
    it = Item('headphones')
    # Band over the top, ear to ear.
    # Over the top, ear to ear (a ring stood up in the x-y plane; a = π/2..3π/2 is its upper half).
    up = gm((0, -0.005, 0), (math.pi / 2, 0, 0))
    it.torus('ink', 0.118, 0.009, up, seg=24, mseg=8, arc=math.pi, a0=math.pi / 2)
    it.torus('main', 0.126, 0.011, up, seg=12, mseg=8, arc=math.pi * 0.45, a0=math.pi * 0.775)
    for side in (1, -1):
        it.cyl('main', (side * 0.122, -0.01, 0), (0.042, 0.03, 0.045), (0, 0, math.pi / 2), seg=24)
        it.cyl('ink', (side * 0.104, -0.01, 0), (0.038, 0.012, 0.041), (0, 0, math.pi / 2), seg=24)
        it.cyl('ink', (side * 0.138, -0.01, 0), (0.024, 0.004, 0.026), (0, 0, math.pi / 2), seg=16)
    return it.finish()


def shades():
    it = Item('shades')
    for side in (1, -1):
        cx = side * 0.042
        # Wayfarer-ish lenses with a frame round each.
        it.cyl('glass', (cx, 0, 0.0), (0.033, 0.004, 0.026), (math.pi / 2, 0, 0), seg=20, smooth=True)
        it.torus('main', 1.0, 0.16, gm((cx, 0, 0.0), (math.pi / 2, 0, 0), (0.034, 0.03, 0.027)), seg=24, mseg=6)
        it.tube('main', [(side * 0.075, 0.008, -0.004), (side * 0.093, 0.006, -0.04), (side * 0.104, 0.0, -0.1)], 0.0045)
    it.box('main', (0, 0.012, 0.0), (0.022, 0.007, 0.006))
    it.box('main', (0, 0.026, -0.001), (0.15, 0.008, 0.008))
    return it.finish()


def specs():
    it = Item('specs')
    for side in (1, -1):
        cx = side * 0.04
        it.torus('gold', 0.026, 0.0035, gm((cx, 0, 0), (math.pi / 2, 0, 0)), seg=24, mseg=6)
        it.tube('gold', [(side * 0.066, 0.004, -0.002), (side * 0.09, 0.004, -0.04), (side * 0.103, 0.0, -0.1)], 0.003)
    it.tube('gold', [(-0.014, 0.004, 0.0), (-0.006, 0.01, 0.002), (0.006, 0.01, 0.002), (0.014, 0.004, 0.0)], 0.003, caps=False)
    return it.finish()


NECK_TILT = 0.38


def chain():
    it = Item('chain')
    tilt = gm((0, 0.0, -0.004), (NECK_TILT, 0, 0))
    n = 30
    for k in range(n):
        a = TAU * k / n
        p = tilt @ Vector((math.sin(a) * 0.06, 0, math.cos(a) * 0.06))
        # Links alternate flat and upright along the loop.
        it.torus('gold', 0.0062, 0.0021, gm(tuple(p), (NECK_TILT + (math.pi / 2 if k % 2 else 0), a + math.pi / 2, 0)) @
                 gm(r=(0, 0, math.pi / 2)), seg=8, mseg=4)
    front = tilt @ Vector((0, 0, 0.06))
    it.tube('gold', [tuple(front), tuple(front + Vector((0, -0.014, 0.004)))], 0.002)
    med = front + Vector((0, -0.03, 0.008))
    it.cyl('gold', tuple(med), (0.017, 0.005, 0.017), (math.pi / 2 - 0.35, 0, 0), seg=20)
    it.sphere('main', tuple(med + Vector((0, 0.001, 0.003))), (0.008, 0.008, 0.005), seg=12, rings=8)
    return it.finish()


def scarf():
    it = Item('scarf')
    tilt = gm((0, -0.003, 0), (0.22, 0, 0))
    it.torus('main', 0.058, 0.019, tilt @ gm(s=(1.05, 1, 1)), seg=28, mseg=10)
    for dy in (-0.009, 0.009):
        it.torus('white', 0.058 + 0.0175 * math.cos(math.asin(dy / 0.019)), 0.0025, tilt @ gm((0, dy, 0), s=(1.05, 1, 1)), seg=28, mseg=4)
    # A tail hanging down the front, a little off-centre.
    top = tilt @ Vector((0.03, -0.01, 0.06))
    for i, (dy, col) in enumerate(((0, 'main'),)):
        it.box(col, tuple(top + Vector((0.004, -0.04, 0.012))), (0.03, 0.08, 0.012), (0.12, 0, 0.12))
    for k, y in enumerate((-0.035, -0.055)):
        it.box('white', tuple(top + Vector((0.004 - y * 0.12, y - 0.0, 0.012 - y * 0.12))), (0.0315, 0.006, 0.0125), (0.12, 0, 0.12))
    for f in range(4):
        x = -0.011 + f * 0.0073
        it.box('main', tuple(top + Vector((0.004 + x + 0.01, -0.087, 0.018))), (0.004, 0.014, 0.004), (0.12, 0, 0.12))
    return it.finish()


def bowtie():
    it = Item('bowtie')
    c = Vector((0, -0.006, 0.06))
    it.sphere('main', tuple(c + Vector((0, 0, 0.004))), (0.009, 0.01, 0.007), seg=12, rings=8)
    for side in (1, -1):
        it.cyl('main', tuple(c + Vector((side * 0.019, 0, 0))), (0.016, 0.03, 0.007), (0, 0, side * math.pi / 2), seg=4,
               top=0.3, smooth=False)
    return it.finish()


def body_base(it, key, grow=1.1, hood=False):
    shell(it, key, grow, -0.074, 0.086, rows=12, seg=32)
    egg_ring(it, key, grow, -0.074, 0.007)


def hoodie():
    it = Item('hoodie')
    body_base(it, 'main', 1.1)
    # Hood bunched behind the neck, an opening ring in front.
    it.torus('main', 0.056, 0.016, gm((0, 0.088, -0.006), (-0.25, 0, 0), (1.05, 1, 1)), seg=24, mseg=8)
    it.sphere('main', (0, 0.1, -0.065), (0.058, 0.05, 0.038))
    # Kangaroo pocket and drawstrings.
    shell(it, 'main', 1.135, -0.058, -0.012, rows=3, seg=8, phi=(-0.55, 0.55))
    egg_ring_patch = [tuple(egg_point(1.14, -0.012, a)) for a in [-0.55 + 1.1 * i / 8 for i in range(9)]]
    it.tube('ink', egg_ring_patch, 0.002, caps=False)
    for side in (1, -1):
        p0 = egg_point(1.1, 0.068, side * 0.22)
        it.tube('white', [tuple(p0), tuple(egg_point(1.13, 0.03, side * 0.24)), tuple(egg_point(1.15, 0.008, side * 0.25))], 0.0022)
        it.sphere('white', tuple(egg_point(1.17, 0.006, side * 0.25)), 0.0035, seg=8, rings=6)
    sleeves(it, 'main', band='main')
    return it.finish()


def jersey():
    it = Item('jersey')
    shell(it, 'main', 1.09, -0.074, 0.086, rows=12, seg=32)
    egg_ring(it, 'white', 1.09, -0.074, 0.006)
    # Two stripes near the hem.
    for y in (-0.055, -0.043):
        shell(it, 'white', 1.097, y - 0.003, y + 0.003, rows=1, seg=32)
    # V-neck trim.
    for side in (1, -1):
        it.tube('white', [tuple(egg_point(1.1, 0.084, side * 0.75)), tuple(egg_point(1.11, 0.05, side * 0.02))], 0.004)
    egg_ring(it, 'white', 1.09, 0.084, 0.004)
    # Number on the chest and back.
    it.text('white', '7', on_egg(1.09, 0.008, 0.0, 0.001) @ gm(r=(0.0, 0, 0)), size=0.07, depth=0.003)
    it.text('white', '7', on_egg(1.09, 0.008, math.pi, 0.001), size=0.07, depth=0.003)
    sleeves(it, 'main', band='white', r=0.03)
    return it.finish()


def suit():
    it = Item('suit')
    body_base(it, 'ink', 1.1)
    # Shirt front: a white V narrowing down the chest.
    shell(it, 'white', 1.108, -0.005, 0.086, rows=6, seg=8, phi_fn=lambda t: (-0.62 * t ** 0.9, 0.62 * t ** 0.9))
    # Lapels either side of the V.
    for side in (1, -1):
        shell(it, 'ink', 1.13, -0.005, 0.084, rows=6, seg=4,
              phi_fn=lambda t, s=side: (sorted((s * 0.62 * t ** 0.9, s * (0.62 * t ** 0.9 + 0.22 + 0.15 * t)))))
    # Tie in the player's colour.
    knot = on_egg(1.118, 0.072, 0, 0.002)
    it.sphere('main', tuple(knot @ Vector((0, 0, 0))), (0.009, 0.008, 0.006), seg=10, rings=6)
    blade = [egg_point(1.122, y, 0) for y in (0.064, 0.03, 0.006)]
    it.tube('main', [tuple(p) for p in blade], lambda t: 0.006 + 0.006 * t, seg=4)
    # Pocket square and buttons.
    sq = on_egg(1.105, 0.025, 0.85, 0.001)
    it.box('main', tuple(sq @ Vector((0, 0.003, 0))), (0.018, 0.012, 0.003), tuple(sq.to_euler('XYZ')))
    for y in (-0.03, -0.05):
        it.sphere('ink', tuple(egg_point(1.12, y, 0.0)), (0.004, 0.004, 0.002), seg=8, rings=6)
    sleeves(it, 'ink')
    return it.finish()


def varsity():
    it = Item('varsity')
    body_base(it, 'main', 1.1)
    # Ribbed white/ink trim: collar, hem and cuffs.
    egg_ring(it, 'ink', 1.1, 0.086, 0.007)
    egg_ring(it, 'white', 1.105, -0.064, 0.006)
    egg_ring(it, 'ink', 1.11, -0.074, 0.0075)
    # Snap buttons down the front.
    for y in (0.055, 0.025, -0.005, -0.035):
        it.sphere('white', tuple(egg_point(1.11, y, 0)), (0.004, 0.004, 0.002), seg=8, rings=6)
    it.tube('ink', [tuple(egg_point(1.102, y, 0)) for y in (0.08, 0.04, 0.0, -0.04, -0.07)], 0.0015, caps=False)
    # Big letter on the chest.
    it.text('white', 'Y', on_egg(1.1, 0.025, 0.42, 0.001), size=0.05, depth=0.003)
    # White leather sleeves.
    sleeves(it, 'white', band='ink', r=0.034)
    return it.finish()


BUILDERS = [cap, beanie, tophat, crown, headphones, shades, specs, chain, scarf, bowtie, hoodie, jersey, suit, varsity]


# ---- thumbnails -------------------------------------------------------------

VIEW = {'head': (0.55, 0.45, 1.0), 'eyes': (0.35, 0.15, 1.0), 'neck': (0.4, 0.55, 1.0), 'body': (0.45, 0.3, 1.0)}


def setup_render(sc, size):
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.78, 0.85, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sc.world = world
    for name, energy, rot in (('Key', 3.2, (40, 0, 35)), ('Rim', 1.6, (60, 0, 200))):
        sun = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        sun.data.energy = energy
        sun.data.angle = math.radians(12)
        sun.rotation_euler = tuple(math.radians(r) for r in rot)
        blib.link(sun)


def frame_camera(cam, obj, view):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    centre = sum(pts, Vector()) / 8
    radius = max((p - centre).length for p in pts)
    d = C @ Vector(view).normalized()
    fov = cam.data.angle
    dist = radius / math.sin(fov / 2) * 0.98
    cam.location = centre + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()


def thumbnails(objs, size=128):
    from PIL import Image
    sc = bpy.context.scene
    setup_render(sc, size * 2)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 60
    blib.link(cam)
    sc.camera = cam
    out_dir = os.path.join(blib.PUBLIC, 'outfits')
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(blib.HERE, '.cache', 'outfits')
    os.makedirs(tmp, exist_ok=True)
    # Mask materials: the tintable parts glow white, everything else cuts a hole.
    glow = bpy.data.materials.new('mask_main')
    glow.use_nodes = True
    nt = glow.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], o.inputs[0])
    hold = bpy.data.materials.new('mask_hold')
    hold.use_nodes = True
    nt = hold.node_tree
    nt.nodes.clear()
    ho = nt.nodes.new('ShaderNodeHoldout')
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(ho.outputs[0], o.inputs[0])
    tinted = {}
    for obj in objs:
        for other in objs:
            other.hide_render = other is not obj
        frame_camera(cam, obj, VIEW[SLOTS[obj.name]])
        png = os.path.join(tmp, f'{obj.name}.png')
        sc.render.filepath = png
        bpy.ops.render.render(write_still=True)
        Image.open(png).resize((size, size), Image.LANCZOS).save(os.path.join(out_dir, f'{obj.name}.webp'), quality=90)
        names = [m.name for m in obj.data.materials]
        tinted[obj.name] = 'outfit:main' in names
        if tinted[obj.name]:
            saved = list(obj.data.materials)
            for i, m in enumerate(saved):
                obj.data.materials[i] = glow if m.name == 'outfit:main' else hold
            sc.cycles.samples = 8
            sc.cycles.use_denoising = False
            mpng = os.path.join(tmp, f'{obj.name}-tint.png')
            sc.render.filepath = mpng
            bpy.ops.render.render(write_still=True)
            sc.cycles.samples = 48
            sc.cycles.use_denoising = True
            for i, m in enumerate(saved):
                obj.data.materials[i] = m
            alpha = Image.open(mpng).convert('RGBA').getchannel('A').resize((size, size), Image.LANCZOS)
            mask = Image.new('RGBA', (size, size), (255, 255, 255, 0))
            mask.putalpha(alpha)
            mask.save(os.path.join(out_dir, f'{obj.name}-tint.webp'), quality=90)
        blib.log('thumb', obj.name, '(tinted)' if tinted[obj.name] else '')
    for other in objs:
        other.hide_render = False
    bpy.data.objects.remove(cam)
    return tinted


# ---- preview: every character wearing a few outfits ---------------------------

PIVOTS = {'Body': (0, 0, 0), 'Head': (0, 0.29, 0), 'HandL': (0.11, 0.115, 0.015), 'HandR': (-0.11, 0.115, 0.015),
          'FootL': (0.042, 0.0, 0.012), 'FootR': (-0.042, 0.0, 0.012), 'Top': (0, 0, 0), 'Chain': (0, 0, 0)}
CANON = {'head': (0, 0, 0), 'eyes': (0, 0.015, 0.1), 'neck': (0, 0.2, 0), 'body': (0, 0.12, 0)}


def preview(items, out, chars_glb, looks):
    fit = json.load(open(FIT))
    bpy.ops.import_scene.gltf(filepath=chars_glb)
    ids = list(fit['chars'].keys())
    if os.environ.get('OUTFIT_ONLY'):
        # OUTFIT_ONLY=chog,snacky: just these characters (the rest stay out of the shot).
        only = os.environ['OUTFIT_ONLY'].split(',')
        for o in bpy.data.objects:
            if o.name.split('_', 1)[0] in ids and o.name.split('_', 1)[0] not in only:
                o.hide_render = True
        ids = [c for c in ids if c in only]
    sc = bpy.context.scene
    placed = []
    by_name = {o.name: o for o in bpy.data.objects}
    for row, look in enumerate(looks):
        for col, cid in enumerate(ids):
            ox, oz = (col - (len(ids) - 1) / 2) * 0.36, -row * 5.0
            for part, piv in PIVOTS.items():
                src = by_name.get(f'{cid}_{part}')
                if not src:
                    continue
                o = src if row == 0 else src.copy()
                if row:
                    blib.link(o)
                # A garment comes off when another item takes its slot (or the look is bare).
                slot = GARMENT_SLOT.get(part)
                o.hide_render = bool(slot) and (look == ['bare'] or any(
                    SLOTS.get(x) == slot and SIGNATURE.get(x, (cid, part))[:2] != (cid, part) for x in look))
                o.parent = None
                o.location = blib.V(piv[0] + ox, piv[1], piv[2] + oz)
                o.rotation_euler = (0, 0, 0) if o.rotation_mode != 'QUATERNION' else o.rotation_euler
                o.rotation_quaternion = (1, 0, 0, 0)
                o.scale = (1, 1, 1)
            # A mane of its own (chog_Hair_<cut>): the cut worn under this look's hat, the rest out of the shot.
            # OUTFIT_MANE=full shows the whole mane under every hat (how it was before the cuts).
            hat = next((x for x in look if SLOTS.get(x) == 'head' and x not in fit['hide'].get(cid, [])), None)
            cut = os.environ.get('OUTFIT_MANE') or fit.get('mane', {}).get(cid, {}).get(hat, 'full')
            for name, src in by_name.items():
                if not name.startswith(f'{cid}_Hair_') or src.type != 'MESH':
                    continue
                o = src if row == 0 else src.copy()
                if row:
                    blib.link(o)
                o.parent = None
                o.hide_render = name != f'{cid}_Hair_{cut}'
                piv = PIVOTS['Head']
                o.location = blib.V(piv[0] + ox, piv[1], piv[2] + oz)
                o.rotation_euler = (0, 0, 0)
                o.rotation_quaternion = (1, 0, 0, 0)
                o.scale = (1, 1, 1)
            for iid in look:
                if iid in fit['hide'].get(cid, []) or iid not in items:
                    continue
                slot = SLOTS[iid]
                anc = fit['chars'][cid][slot]
                tweak = fit['items'].get(iid, {}).get(cid, {})
                p = [a + b for a, b in zip(anc['p'], tweak.get('p', [0, 0, 0]))]
                s = anc['s']
                ts = tweak.get('s', 1)
                s = [v * (ts if isinstance(ts, (int, float)) else ts[i]) for i, v in enumerate(s)]
                if slot == 'neck' and any(SLOTS[x] == 'body' and x not in fit['hide'].get(cid, []) for x in look):
                    s = [v * k for v, k in zip(s, fit['neckOverBody'])]
                base = (0, 0.29, 0) if slot in ('head', 'eyes') else (0, 0, 0)
                o = items[iid].copy()
                blib.link(o)
                o.location = blib.V(base[0] + p[0] + ox, base[1] + p[1], base[2] + p[2] + oz)
                o.scale = (s[0], s[2], s[1])
                o.hide_render = False
                placed.append(o)
    for o in items.values():
        o.hide_render = True
    setup_render(sc, 0)
    sc.render.film_transparent = False
    sc.render.resolution_x, sc.render.resolution_y = (2200, 420) if len(ids) > 3 else (420 * len(ids), 420)
    sc.cycles.samples = 16
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 0.36 * len(ids) + 0.1 if len(ids) > 3 else 0.7 * len(ids)
    # A few characters: their heads up close.
    aim = 0.24 if len(ids) > 3 else 0.4
    blib.link(cam)
    sc.camera = cam
    view = os.environ.get('OUTFIT_VIEW', '0.3,0.45,1').split(',')
    d = C @ Vector(tuple(float(v) for v in view)).normalized()
    # One image per look: the rows sit far apart, so the camera frames one at a time.
    for row in range(len(looks)):
        cam.location = blib.V(0, aim, -row * 5.0) + d * 3
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = out.replace('.png', f'-{row}.png')
        bpy.ops.render.render(write_still=True)
        blib.log('preview', sc.render.filepath)


def signature_objects(chars_glb=CHARS_CACHE):
    """The signature items as objects named by item id: copies of the garment nodes in characters.glb.

    Their `main` parts take the thumbnail's white `outfit:main` (so the picker tints them);
    the rest keep the character's own colours. Everything else imported stays out of the render."""
    if not os.path.exists(chars_glb):
        raise SystemExit(f'{chars_glb} missing: build the characters first (run.sh characters.py)')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=chars_glb)
    imported = [o for o in bpy.data.objects if o not in before]
    by_name = {o.name: o for o in imported}
    for o in imported:
        o.hide_render = True
    out = []
    for iid, (cid, node, _slot) in SIGNATURE.items():
        src = by_name[f'{cid}_{node}']
        o = src.copy()
        o.data = src.data.copy()
        o.name = iid
        o.parent = None
        o.matrix_world = src.matrix_world.copy()
        o.hide_render = False
        blib.link(o)
        for i, m in enumerate(o.data.materials):
            if m and m.name.split(':')[-1].split('.')[0] == 'main':
                o.data.materials[i] = mat_for('main')
        out.append(o)
    return out


def record_thumbs(entry, objs, tinted):
    for o in objs:
        entry[o.name] = f'/outfits/{o.name}.webp'
        entry.pop(f'{o.name}-tint', None)
        if tinted[o.name]:
            entry[f'{o.name}-tint'] = f'/outfits/{o.name}-tint.webp'


def main():
    blib.reset()
    if '--signature-only' in sys.argv:
        # Re-render only the signature thumbnails, keeping every other entry as it is.
        with open(blib.MANIFEST) as f:
            entry = {k: v.split('?')[0] for k, v in json.load(f)['outfits'].items()}
        sig = signature_objects()
        record_thumbs(entry, sig, thumbnails(sig))
        blib.record('outfits', entry)
        return
    objs = [b() for b in BUILDERS]
    for o in objs:
        blib.log(o.name, f'{len(o.data.polygons)} faces', ', '.join(m.name.split(':')[1] for m in o.data.materials))
    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        chars = sys.argv[sys.argv.index('--chars') + 1] if '--chars' in sys.argv else os.path.join(
            blib.HERE, '.cache', 'models', 'characters.glb')
        looks = [s.split(',') for s in sys.argv[sys.argv.index('--looks') + 1].split('|')] if '--looks' in sys.argv else [
            ['cap', 'shades', 'chain', 'hoodie'], ['tophat', 'specs', 'bowtie', 'suit'],
            ['beanie', 'scarf', 'varsity'], ['crown', 'jersey'], ['headphones']]
        preview({o.name: o for o in objs}, out, chars, looks)
        return
    blib.export_glb(objs, 'models/outfits.glb', images='NONE')
    entry = {'url': '/models/outfits.glb'}
    record_thumbs(entry, objs, thumbnails(objs))
    sig = signature_objects()
    record_thumbs(entry, sig, thumbnails(sig))
    blib.record('outfits', entry)


if __name__ == '__main__':
    main()
