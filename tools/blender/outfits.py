"""Outfit items players dress their character in, plus a thumbnail of each.

Every item is modelled once, on a canonical figure, round the point it hangs
from (its anchor):

    head  the skull: a sphere of radius 0.1 round the head pivot (rig.head)
    eyes  the eye line: (0, 0.015, 0.1) in the head's frame, eyes 0.04 apart
    neck  the collar: (0, 0.2, 0) in the body's frame (rig.pose)
    body  the egg body: centre (0, 0.12, 0), radii (0.085, 0.095, 0.075)
    held  the right hand's pivot (rig.handR), a fist r ~0.03: props stand up out of it

client/src/three/characters/outfitFit.json then says, per character, where
each anchor goes and how it stretches (and which items a character's own hat
or helmet rules out). The ids match shared/outfits.ts.

Output
- models/outfits.glb: one node per item id, origin on its anchor (and models/outfits-low.glb, the
  same simplified by gltfpack for Low graphics). Material
  names are `outfit:<key>`; the game swaps each for the wearing figure's own
  material of that key, so `main` is the player's colour and everything greys
  in jail and fades on bankruptcy with the figure. Accents that keep their
  colour use fixed keys (`red`, `pink`, `purple`, `leaf`, `sky`, as in
  client parts.tsx makeMaterials).
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
    tools/blender/run.sh outfits.py --preview out.png [--chars path/to/characters.glb] [--looks a,b,c|...] [--items a,b]
    tools/blender/run.sh outfits.py --sheet out.png [--items a,b,c]   (every item on the Chog, front and three-quarter)

--preview renders every character wearing a few outfits (needs an
uncompressed characters.glb, e.g. tools/blender/.cache/models/characters.glb).
A character's own garments show unless the look puts another item in their
slot; the look `bare` takes them all off. --sheet lays every item (or just
--items) out on one character (OUTFIT_ONLY, default chog), whole figure from
the front and three-quarters, labelled; SHEET_ZOOM / SHEET_AIM frame closer
(0.4 / 0.33 for heads), SHEET_COLOR is the player colour shown.
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
    'cap': 'head', 'beanie': 'head', 'tophat': 'head', 'crown': 'head', 'headphones': 'head', 'backcap': 'head',
    'bucket': 'head', 'party': 'head', 'halo': 'head', 'horns': 'head', 'bunny': 'head', 'cowboy': 'head',
    'chef': 'head', 'viking': 'head', 'wizard': 'head', 'flowers': 'head', 'propeller': 'head', 'headband': 'head',
    'shades': 'eyes', 'specs': 'eyes', 'aviators': 'eyes', 'hearts': 'eyes', 'stars': 'eyes', 'monocle': 'eyes',
    'eyepatch': 'eyes', 'visor': 'eyes', 'glasses3d': 'eyes', 'pixel': 'eyes',
    'chain': 'neck', 'scarf': 'neck', 'bowtie': 'neck', 'medal': 'neck', 'bandana': 'neck', 'cape': 'neck',
    'pearls': 'neck', 'lei': 'neck', 'tie': 'neck',
    'hoodie': 'body', 'jersey': 'body', 'suit': 'body', 'varsity': 'body', 'tux': 'body', 'puffer': 'body',
    'overalls': 'body', 'monad': 'body', 'tee': 'body', 'apron': 'body', 'ziphoodie': 'body',
    'coffee': 'held', 'flag': 'held', 'balloon': 'held', 'chip': 'held', 'trophy': 'held', 'dice': 'held',
    'cash': 'held', 'lollipop': 'held',
}
# Signature items: id -> (character, garment node, slot). Ids match shared/outfits.ts.
SIGNATURE = {
    'wawa_tee': ('snacky', 'Top', 'body'),
    'cuban_chain': ('snacky', 'Chain', 'neck'),
}
SLOTS.update({k: v[2] for k, v in SIGNATURE.items()})
GARMENT_SLOT = {'Top': 'body', 'Chain': 'neck'}
CHARS_CACHE = os.path.join(blib.HERE, '.cache', 'models', 'characters.glb')
LOW_RATIO = 0.5  # triangles kept in models/outfits-low.glb (Low graphics; gltfpack -si stops early where shapes would break)
# Thumbnail colours; `main` is white so the picker can tint it.
COLORS = {
    'main': ('#eeeeee', 0.45, 0.0), 'ink': ('#22222a', 0.5, 0.0), 'white': ('#f7f5ef', 0.6, 0.0),
    'gold': ('#f4c542', 0.3, 0.85), 'metal': ('#b9c2cf', 0.3, 0.75), 'glass': ('#1c2438', 0.12, 0.7),
    'wood': ('#7a4a24', 0.8, 0.0),
    # Fixed colours for the accents a player's colour shouldn't take (client parts.tsx makeMaterials has the same).
    'red': ('#e5383b', 0.45, 0.0), 'pink': ('#ff8fb8', 0.45, 0.0), 'purple': ('#836ef9', 0.4, 0.0),
    'leaf': ('#46a35a', 0.55, 0.0), 'sky': ('#3fd0f0', 0.35, 0.0),
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

    def box(self, key, p=(0, 0, 0), s=(1, 1, 1), r=(0, 0, 0), bevel=0.0):
        """A box; `bevel` rounds its edges (in game units), for dice and the like."""
        def make(M):
            verts = bmesh.ops.create_cube(self.bm, size=1, matrix=M)['verts']
            if bevel:
                edges = list({e for v in verts for e in v.link_edges})
                bmesh.ops.bevel(self.bm, geom=verts + edges, offset=bevel, segments=2, profile=0.5, affect='EDGES',
                                clamp_overlap=True)
        self._prim(make, key, gm(p, r, s), smooth=bool(bevel))

    def slab(self, key, outline, M, depth=0.003, smooth=False):
        """A flat shape (a star, a heart, a lens) cut from a sheet `depth` thick: `outline` is [(x, y), ...] round
        its centre in a plane facing +z, then moved by M. Fanned from the centre, so any star-shaped outline works."""
        bm = self.bm
        n = len(outline)
        layers = []
        for z in (depth / 2, -depth / 2):
            layers.append(([bm.verts.new(C @ (M @ Vector((x, y, z)))) for x, y in outline], bm.verts.new(C @ (M @ Vector((0, 0, z))))))
        (front, cf), (back, cb) = layers
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((cf, front[i], front[j])))
            faces.append(bm.faces.new((cb, back[j], back[i])))
            faces.append(bm.faces.new((front[j], front[i], back[i], back[j])))
        self._tag(faces, key, smooth)

    def strip(self, key, points, normals, width, thick=0.003):
        """A flat band (a strap, a ribbon) along game-frame points, lying on a surface whose outward normal at
        each point is normals[i] (or normals(p)), `width` across and `thick` through."""
        pts = [Vector(q) for q in points]
        rows = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            nrm = Vector(normals(p) if callable(normals) else normals[i]).normalized()
            side = t.cross(nrm).normalized() * (width / 2)
            nrm = nrm * (thick / 2)
            corners = [p + side + nrm, p - side + nrm, p - side - nrm, p + side - nrm]
            rows.append([tuple(c) for c in corners + corners[:1]])
        self.grid(key, rows)

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
        u = None
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            if u is None:
                ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
                u = t.cross(ref).normalized()
            else:
                # Carried along the bend (no flip where the tube turns past the reference axis).
                u = (u - t * u.dot(t)).normalized()
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


# ---- more items: shapes they share ----------------------------------------------

def star_pts(ro, ri=None, n=5, rot=math.pi / 2):
    """A star's outline round its centre, a point straight up."""
    ri = ri if ri is not None else ro * 0.45
    return [((ro if k % 2 == 0 else ri) * math.cos(rot + math.pi * k / n),
             (ro if k % 2 == 0 else ri) * math.sin(rot + math.pi * k / n)) for k in range(n * 2)]


def heart_pts(size, n=28):
    """A heart's outline round a point inside it (so it fans cleanly), `size` from the middle to a side."""
    out = []
    for k in range(n):
        t = TAU * k / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        out.append((x / 17 * size, (y + 2.5) / 17 * size))
    return out


def ellipse_pts(rx, ry, n=20):
    return [(rx * math.cos(TAU * k / n), ry * math.sin(TAU * k / n)) for k in range(n)]


def rect_pts(w, h, r=0.0, n=3):
    """A rounded rectangle's outline (w × h, corner radius r)."""
    if not r:
        return [(w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2), (w / 2, -h / 2)]
    out = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def outline_tube(it, key, outline, M, radius, seg=6):
    """A frame (a tube) round a flat outline placed by M."""
    pts = [tuple(M @ Vector((x, y, 0))) for x, y in outline]
    it.tube(key, pts + pts[:1], radius, seg=seg, caps=False)


def flower(it, key, M, r=0.018, petals=5, centre='gold', seg=20):
    """A flat flower facing M's +z: one scalloped disc of petals and a bead in the middle."""
    prof = [(0.0, 0.003), (r * 0.6, 0.0028), (r, 0.0), (r * 0.6, -0.0025), (0.0, -0.003)]
    it.lathe(key, prof, M @ gm(r=(math.pi / 2, 0, 0)), seg=seg, wobble=lambda a: 0.72 + 0.28 * abs(math.cos(a * petals / 2)))
    it.sphere(centre, tuple(M @ Vector((0, 0, 0.003))), (r * 0.32, r * 0.32, r * 0.22), seg=8, rings=5)


def facing(p, n, spin=0.0):
    """A transform at p whose +z looks along n (and +y stays as near up as it can)."""
    z = Vector(n).normalized()
    ref = Vector((0, 1, 0)) if abs(z.y) < 0.95 else Vector((0, 0, -1))
    x = ref.cross(z).normalized()
    y = z.cross(x)
    R = Matrix((x, y, z)).transposed().to_4x4()
    return Matrix.Translation(Vector(p)) @ R @ Matrix.Rotation(spin, 4, 'Z')


# ---- more head items ------------------------------------------------------------

def backcap():
    """The cap turned round: the bill down the back, the snapback strap over the forehead."""
    it = Item('backcap')
    turn = gm(r=(-0.12, 0, 0)) @ gm(r=(0, math.pi, 0))
    prof = [(0.106 * math.sin(a), 0.106 * math.cos(a)) for a in [i * math.radians(74) / 10 for i in range(11)]]
    it.lathe('main', prof, turn, seg=28)
    it.sphere('main', tuple(turn @ Vector((0, 0.106, 0))), 0.011)
    for k in range(3):
        it.lathe('ink', [(0.1065 * math.sin(a), 0.1065 * math.cos(a)) for a in [i * math.radians(72) / 8 for i in range(1, 9)]],
                 turn @ gm(r=(0, k * math.pi / 3, 0)), seg=1, phi=(-0.012, 0.012))
    pts = []
    for i in range(13):
        ph = -0.95 + 1.9 * i / 12
        row = []
        for j in range(5):
            t = j / 4
            rr = 0.1 + t * (0.07 * math.cos(ph) ** 1.5)
            y = 0.03 - t * 0.016 - (abs(ph) ** 2) * 0.008 * t
            row.append((math.sin(ph) * rr, y, math.cos(ph) * rr))
        pts.append(row)
    top = [[tuple(turn @ Vector(q)) for q in row] for row in pts]
    bot = [[tuple(turn @ Vector((q[0], q[1] - 0.006, q[2]))) for q in row] for row in pts]
    it.grid('main', top)
    it.grid('ink', [list(reversed(r)) for r in bot])
    it.grid('main', [[top[i][-1], bot[i][-1]] for i in range(len(top))])
    # The strap across the gap over the forehead, and its buckle.
    tilt = gm(r=(-0.12, 0, 0))
    arc = [tuple(tilt @ Vector((math.sin(a) * 0.1075, 0.034, math.cos(a) * 0.1075))) for a in [-0.42 + 0.84 * i / 8 for i in range(9)]]
    it.strip('ink', arc, lambda p: (p[0], 0.0, p[2]), 0.012, 0.004)
    it.box('metal', tuple(tilt @ Vector((0, 0.034, 0.11))), (0.016, 0.01, 0.004), (0.12, 0, 0))
    return it.finish()


def bucket():
    it = Item('bucket')
    tilt = gm(r=(-0.1, 0, 0))
    it.lathe('main', [(0.0, 0.124), (0.05, 0.123), (0.076, 0.119), (0.09, 0.109), (0.098, 0.09), (0.105, 0.06), (0.11, 0.034)],
             tilt, seg=32)
    # The brim slopes down and out; dark underneath.
    it.lathe('main', [(0.11, 0.034), (0.133, 0.021), (0.156, 0.006), (0.16, 0.0)], tilt, seg=32)
    it.lathe('ink', [(0.16, 0.0), (0.155, -0.003), (0.131, 0.014), (0.106, 0.028)], tilt, seg=32)
    # A band round the crown and two rows of stitching on the brim.
    it.lathe('ink', [(0.108, 0.036), (0.1105, 0.04), (0.108, 0.058), (0.105, 0.061)], tilt, seg=32)
    for rr, y in ((0.128, 0.0245), (0.147, 0.0125)):
        it.torus('white', rr, 0.0016, tilt @ gm((0, y + 0.0012, 0)), seg=40, mseg=4)
    return it.finish()


def party():
    """A striped cone worn at a jaunty angle, a pompom on top."""
    it = Item('party')
    M = gm((0.03, 0.075, 0.005), (-0.12, 0, -0.32))
    h, r0, bands = 0.16, 0.058, 5
    for k in range(bands):
        t0, t1 = k / bands, (k + 1) / bands
        it.lathe('main' if k % 2 == 0 else 'white', [(r0 * (1 - t0), h * t0), (r0 * (1 - t1), h * t1)], M, seg=24)
    it.lathe('white', [(0.0, -0.002), (r0 * 0.98, -0.002), (r0, 0.0)], M, seg=24)
    it.torus('gold', r0 * 0.99, 0.004, M @ gm((0, 0.003, 0)), seg=24, mseg=5)
    tip = M @ Vector((0, h + 0.008, 0))
    for k in range(7):
        a = TAU * k / 7
        it.sphere('gold', tuple(tip + Vector((math.cos(a) * 0.009, 0.004 * math.sin(3 * a), math.sin(a) * 0.009))), 0.009, seg=8, rings=6)
    it.sphere('gold', tuple(tip + Vector((0, 0.008, 0))), 0.01, seg=8, rings=6)
    return it.finish()


def halo():
    it = Item('halo')
    M = gm((0, 0.25, -0.02), (0.18, 0, 0.06))
    it.torus('gold', 0.072, 0.009, M, seg=36, mseg=8)
    return it.finish()


def horns():
    """Little devil horns poking out of the top of the head."""
    it = Item('horns')
    for side in (1, -1):
        p0 = Vector((side * 0.052, 0.068, 0.05))
        pts = [p0 + Vector((side * 0.016 * t + side * 0.026 * t ** 2, 0.088 * t, 0.016 * t - 0.036 * t ** 3)) for t in [i / 8 for i in range(9)]]
        it.tube('red', [tuple(p) for p in pts], lambda t: 0.024 * (1 - t) ** 0.8 + 0.0015, seg=12)
    return it.finish()


def bunny():
    """Bunny ears, one of them flopped over (their headband is lost in the hair)."""
    it = Item('bunny')
    k = 1.35  # big enough to stand out of the Chog's spikes
    for side in (1, -1):
        base = Vector((side * 0.042, 0.098, 0.03))
        lean = side * -0.3
        R = gm(tuple(base), (-0.1, 0, lean))
        rot = (-0.1, 0, lean)
        if side == 1:
            # Upright.
            it.sphere('white', tuple(R @ Vector((0, 0.065 * k, 0))), (0.023 * k, 0.072 * k, 0.011 * k), r=rot, seg=16, rings=12)
            it.sphere('pink', tuple(R @ Vector((0, 0.065 * k, 0.0075 * k))), (0.013 * k, 0.052 * k, 0.005 * k), r=rot, seg=12, rings=10)
        else:
            # Flopped over halfway up.
            it.sphere('white', tuple(R @ Vector((0, 0.036 * k, 0))), (0.022 * k, 0.044 * k, 0.011 * k), r=rot, seg=14, rings=10)
            it.sphere('pink', tuple(R @ Vector((0, 0.038 * k, 0.0075 * k))), (0.012 * k, 0.03 * k, 0.005 * k), r=rot, seg=12, rings=8)
            tip = R @ Vector((0, 0.07 * k, 0))
            flop = (-0.1, 0, lean - 1.9)
            it.sphere('white', tuple(tip + Vector((-0.028 * k, -0.006 * k, 0))), (0.021 * k, 0.04 * k, 0.01 * k), r=flop, seg=14, rings=10)
            it.sphere('pink', tuple(tip + Vector((-0.028 * k, -0.006 * k, 0.0072 * k))), (0.011 * k, 0.027 * k, 0.004 * k), r=flop,
                      seg=12, rings=8)
    return it.finish()


def cowboy():
    """A cattleman: creased crown, a wide brim curling up at the sides, a band in the player's colour."""
    it = Item('cowboy')
    tilt = gm((0, 0.006, 0), (-0.12, 0, 0))
    crown = []
    prof = [(0.104, 0.04), (0.1, 0.075), (0.094, 0.11), (0.084, 0.135), (0.06, 0.145), (0.03, 0.142), (0.0, 0.138)]
    for k in range(33):
        a = TAU * k / 32
        col = []
        for rr, y in prof:
            x, z = math.sin(a) * rr * 0.96, math.cos(a) * rr * 1.06
            # The crease along the top, and the pinch at the front.
            if y > 0.12:
                y -= 0.02 * max(0.0, 1 - (x / 0.05) ** 2) * (y - 0.12) / 0.025
            if z > 0 and y > 0.09:
                x *= 1 - 0.12 * (z / 0.11) * (y - 0.09) / 0.05
            col.append(tuple(tilt @ Vector((x, y, z))))
        crown.append(col)
    it.grid('wood', crown[:-1], closed_u=True)

    def brim_pt(a, t, dy=0.0):
        rr = 0.1 + t * 0.085
        s2 = math.sin(a) ** 2
        y = 0.042 + 0.06 * s2 * t ** 2.2 - 0.012 * (1 - s2) * t + dy
        return tuple(tilt @ Vector((math.sin(a) * rr * 0.96, y, math.cos(a) * rr * 1.06)))
    n = 40
    top = [[brim_pt(TAU * k / n, j / 4) for j in range(5)] for k in range(n)]
    bot = [[brim_pt(TAU * k / n, j / 4, -0.006) for j in range(5)] for k in range(n)]
    it.grid('wood', top, closed_u=True)
    it.grid('wood', [list(reversed(r)) for r in bot], closed_u=True)
    it.grid('wood', [[top[k][-1], bot[k][-1]] for k in range(n)], closed_u=True)
    it.lathe('main', [(0.105, 0.044), (0.107, 0.048), (0.1035, 0.068), (0.1, 0.07)], tilt @ gm(s=(0.96, 1, 1.06)), seg=32)
    return it.finish()


def chef():
    it = Item('chef')
    tilt = gm(r=(-0.08, 0, 0))
    it.lathe('white', [(0.103, 0.03), (0.105, 0.035), (0.11, 0.095)], tilt, seg=32)
    pleats = lambda a: 1 + 0.045 * math.cos(a * 9)  # noqa: E731
    it.lathe('white', [(0.11, 0.095), (0.128, 0.115), (0.138, 0.15), (0.128, 0.185), (0.095, 0.205), (0.05, 0.212), (0.0, 0.213)],
             tilt, seg=54, wobble=pleats)
    it.lathe('main', [(0.104, 0.034), (0.1065, 0.037), (0.108, 0.05), (0.105, 0.053)], tilt, seg=32)
    return it.finish()


def viking():
    """A steel helmet with a gold rim and crest, and two horns."""
    it = Item('viking')
    tilt = gm(r=(-0.1, 0, 0))
    it.lathe('metal', [(0.108 * math.sin(a), 0.112 * math.cos(a) + 0.012) for a in [i * math.radians(82) / 10 for i in range(11)]],
             tilt, seg=32)
    it.torus('gold', 0.108, 0.008, tilt @ gm((0, 0.03, 0)), seg=32, mseg=6)
    it.tube('gold', [tuple(tilt @ Vector((0, 0.124 * math.cos(a) + 0.009, 0.112 * math.sin(a)))) for a in [-1.2 + 2.4 * i / 14 for i in range(15)]],
            0.006, seg=6)
    for k in range(10):
        a = TAU * (k + 0.5) / 10
        it.sphere('gold', tuple(tilt @ Vector((math.sin(a) * 0.114, 0.03, math.cos(a) * 0.114))), 0.0045, seg=8, rings=5)
    for side in (1, -1):
        pts = [Vector((side * (0.1 + 0.07 * t), 0.07 + 0.02 * t + 0.11 * t ** 2.4, -0.01 + 0.02 * t)) for t in [i / 9 for i in range(10)]]
        it.tube('white', [tuple(tilt @ p) for p in pts], lambda t: 0.021 * (1 - t) ** 0.85 + 0.0015, seg=12)
    return it.finish()


def wizard():
    """A tall floppy cone with a wide brim, gold stars on it."""
    it = Item('wizard')
    tilt = gm((0, 0.0, 0), (-0.1, 0, 0.08))
    it.lathe('main', [(0.085, 0.05), (0.13, 0.044), (0.172, 0.034), (0.176, 0.03), (0.17, 0.028), (0.128, 0.039), (0.085, 0.045)],
             tilt, seg=36)
    axis = [Vector((0.0, 0.048 + 0.2 * t, -0.075 * t ** 2.6)) for t in [i / 14 for i in range(15)]]
    it.tube('main', [tuple(tilt @ p) for p in axis], lambda t: 0.098 * (1 - t) ** 1.15 + 0.004, seg=24)
    it.lathe('gold', [(0.0985, 0.05), (0.096, 0.064), (0.09, 0.066)], tilt, seg=32)
    for (a, y, size) in ((0.3, 0.1, 0.017), (-0.75, 0.135, 0.012), (1.6, 0.085, 0.013), (2.7, 0.12, 0.012), (-2.2, 0.09, 0.013)):
        t = (y - 0.048) / 0.2
        rr = 0.098 * (1 - t) ** 1.15 + 0.004
        c = Vector((math.sin(a) * rr, y, math.cos(a) * rr - 0.075 * t ** 2.6))
        n = Vector((math.sin(a), 0.35, math.cos(a))).normalized()
        it.slab('gold', star_pts(size * 1.25), tilt @ facing(tuple(c + n * 0.003), tuple(n), spin=0.2 * a), depth=0.003)
    return it.finish()


def flowers():
    """A crown of flowers on a green vine."""
    it = Item('flowers')
    tilt = gm((0, 0.07, 0.004), (-0.22, 0, 0))
    it.torus('leaf', 0.112, 0.005, tilt, seg=32, mseg=5)
    keys = ['pink', 'white', 'main', 'pink', 'gold', 'white', 'main', 'pink', 'white']
    n = len(keys)
    for k in range(n):
        a = TAU * k / n
        p = tilt @ Vector((math.sin(a) * 0.117, 0.004, math.cos(a) * 0.117))
        out = tilt.to_3x3() @ Vector((math.sin(a), 0.55, math.cos(a)))
        flower(it, keys[k], facing(tuple(p), tuple(out), spin=a), r=0.025, centre='gold' if keys[k] != 'gold' else 'white')
        la = a + TAU / n / 2
        lp = tilt @ Vector((math.sin(la) * 0.119, 0.0, math.cos(la) * 0.119))
        it.sphere('leaf', tuple(lp), (0.014, 0.006, 0.004), r=(0, la + math.pi / 2, 0.5), seg=8, rings=5)
    return it.finish()


def propeller():
    """The propeller beanie: panels in the player's colour and white, a little propeller on top."""
    it = Item('propeller')
    tilt = gm(r=(-0.12, 0, 0))
    prof = [(0.107 * math.sin(a), 0.108 * math.cos(a)) for a in [i * math.radians(76) / 10 for i in range(11)]]
    for k in range(6):
        a0 = TAU * k / 6
        it.lathe('main' if k % 2 == 0 else 'white', prof, tilt, seg=6, phi=(a0, a0 + TAU / 6))
    it.torus('ink', 0.106, 0.004, tilt @ gm((0, 0.027, 0)), seg=32, mseg=5)
    top = tilt @ Vector((0, 0.106, 0))
    it.cyl('metal', tuple(top + Vector((0, 0.012, 0))), (0.004, 0.026, 0.004), seg=10)
    it.sphere('gold', tuple(top + Vector((0, 0.027, 0))), 0.008, seg=10, rings=6)
    for side, key in ((1, 'red'), (-1, 'sky')):
        it.sphere(key, tuple(top + Vector((side * 0.034, 0.028, 0))), (0.032, 0.003, 0.011), r=(0, 0.4, side * 0.12), seg=12, rings=6)
    return it.finish()


def headband():
    """A terry sweatband round the forehead, white stripes at its edges."""
    it = Item('headband')
    M = gm((0, 0.03, 0.004), (0.2, 0, 0))
    it.lathe('main', [(0.1, 0.0), (0.107, 0.002), (0.109, 0.016), (0.107, 0.03), (0.1, 0.032)], M, seg=40)
    for y in (0.006, 0.026):
        it.torus('white', 0.1088, 0.0022, M @ gm((0, y, 0)), seg=40, mseg=4)
    return it.finish()


# ---- more eyes ------------------------------------------------------------------

def temples(it, key, x0=0.072, r=0.0035, y=0.006):
    for side in (1, -1):
        it.tube(key, [(side * x0, y, -0.004), (side * 0.093, y - 0.002, -0.04), (side * 0.104, y - 0.006, -0.1)], r)


def aviators():
    it = Item('aviators')
    for side in (1, -1):
        # A teardrop lens, fuller at the bottom and toward the outside.
        pts = []
        for k in range(24):
            t = TAU * k / 24
            x, y = math.sin(t), math.cos(t)
            if y < 0:
                y *= 1.22
                x *= 1 + 0.12 * -y
            pts.append((side * x * 0.031, y * 0.024))
        M = gm((side * 0.042, 0.002, 0.0))
        it.slab('glass', pts, M, depth=0.004, smooth=True)
        outline_tube(it, 'gold', pts, M, 0.0022)
    for y in (0.021, 0.008):
        it.tube('gold', [(-0.013, y, 0.0), (0, y + 0.002, 0.001), (0.013, y, 0.0)], 0.0018, caps=False)
    temples(it, 'gold', x0=0.073, r=0.0025, y=0.02)
    return it.finish()


def hearts():
    it = Item('hearts')
    for side in (1, -1):
        M = gm((side * 0.043, 0.0, 0.0))
        pts = heart_pts(0.034)
        it.slab('pink', pts, M, depth=0.004)
        outline_tube(it, 'main', pts, M, 0.0033)
    it.tube('main', [(-0.013, 0.012, 0.001), (0, 0.016, 0.002), (0.013, 0.012, 0.001)], 0.003, caps=False)
    temples(it, 'main', x0=0.074, y=0.012)
    return it.finish()


def stars():
    it = Item('stars')
    for side in (1, -1):
        M = gm((side * 0.043, 0.0, 0.0), (0, 0, side * -0.12))
        pts = star_pts(0.037, 0.019)
        it.slab('glass', pts, M, depth=0.004)
        outline_tube(it, 'main', pts, M, 0.003, seg=5)
    it.tube('main', [(-0.014, 0.008, 0.001), (0, 0.012, 0.002), (0.014, 0.008, 0.001)], 0.003, caps=False)
    temples(it, 'main', x0=0.072, y=0.01)
    return it.finish()


def monocle():
    """A gold monocle on the right eye, its chain hanging down the cheek."""
    it = Item('monocle')
    c = Vector((-0.041, 0.0, 0.004))
    it.torus('gold', 0.029, 0.0036, gm(tuple(c), (math.pi / 2, 0, 0)), seg=28, mseg=6)
    it.slab('glass', ellipse_pts(0.027, 0.027, 24), gm(tuple(c + Vector((0, 0, -0.001)))), depth=0.0015, smooth=True)
    a = c + Vector((-0.02, -0.021, 0))
    it.tube('gold', [tuple(a + Vector((-0.004 * t - 0.012 * t * t, -0.07 * t, -0.02 * t))) for t in [i / 8 for i in range(9)]], 0.0013)
    it.sphere('gold', tuple(a), 0.003, seg=8, rings=5)
    return it.finish()


def eyepatch():
    """A pirate's patch over the right eye on a thin black band."""
    it = Item('eyepatch')
    it.slab('ink', ellipse_pts(0.03, 0.026, 22), gm((-0.041, 0.0, 0.006), (0.05, -0.12, 0)), depth=0.005, smooth=True)
    it.tube('ink', [(-0.069, 0.008, -0.002), (-0.092, 0.012, -0.04), (-0.104, 0.016, -0.1)], 0.0022)
    it.tube('ink', [(-0.02, 0.024, 0.004), (0.015, 0.042, 0.001), (0.045, 0.054, -0.016), (0.058, 0.058, -0.05)], 0.0022)
    return it.finish()


def visor():
    """A VR headset: a shell in the player's colour, a glossy black screen, a glowing strip, a strap round the back."""
    it = Item('visor')
    it.sphere('main', (0, 0.004, 0.0), (0.09, 0.036, 0.032), seg=24, rings=12)
    it.sphere('glass', (0, 0.004, 0.012), (0.082, 0.03, 0.026), seg=24, rings=12)
    it.box('sky', (0, -0.006, 0.0375), (0.09, 0.0035, 0.002))
    for side in (1, -1):
        it.strip('ink', [(side * 0.085, 0.004, -0.008), (side * 0.098, 0.006, -0.05), (side * 0.104, 0.008, -0.1)],
                 [(side, 0, 0.2)] * 3, 0.016, 0.004)
    return it.finish()


def glasses3d():
    """Cardboard 3D glasses: red lens on the left eye, cyan on the right."""
    it = Item('glasses3d')
    it.slab('white', rect_pts(0.17, 0.052, 0.012), gm((0, 0.002, -0.001)), depth=0.0035)
    for side, key in ((1, 'red'), (-1, 'sky')):
        it.slab(key, rect_pts(0.06, 0.034, 0.006), gm((side * 0.042, 0.0, 0.002)), depth=0.002)
        it.box('white', (side * 0.086, 0.004, -0.05), (0.004, 0.012, 0.1), (0, side * -0.12, 0))
    return it.finish()


def pixel():
    """Deal-with-it pixel shades."""
    it = Item('pixel')
    rows = ['###############',
            '#WW####.#WW####',
            '.#W###...#W###.',
            '..###.....###..']
    px = 0.0115
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.':
                continue
            x = (i - (len(row) - 1) / 2) * px
            y = 0.018 - j * px
            it.box('white' if ch == 'W' else 'ink', (x, y, 0.002), (px, px, 0.006))
    for side in (1, -1):
        it.box('ink', (side * 0.09, 0.018, -0.05), (0.005, 0.008, 0.1), (0, side * -0.12, 0))
    return it.finish()


# ---- more neck items ------------------------------------------------------------
# The egg body's centre is (0, -0.08, 0) from the collar.
NECK_EGG = Vector((0, -0.08, 0))


def neck_egg(grow, y, ang):
    """A point on the egg body (y from the egg's centre), in the collar's frame."""
    return egg_point(grow, y, ang) + NECK_EGG


def medal():
    """A gold medal on a ribbon in the player's colour."""
    it = Item('medal')
    tilt = gm((0, 0.0, -0.004), (NECK_TILT, 0, 0))
    band = [tilt @ Vector((math.sin(a) * 0.06, 0, math.cos(a) * 0.06)) for a in [0.55 + (TAU - 1.1) * i / 20 for i in range(21)]]
    it.strip('main', [tuple(p) for p in band], lambda p: (p[0], 0, p[2]), 0.013, 0.0025)
    tip = Vector((0, -0.05, 0.074))
    for side in (1, -1):
        a = band[0] if side == 1 else band[-1]
        pts = [a.lerp(tip + Vector((side * 0.006, 0.006, 0)), t) for t in (0, 0.5, 1)]
        it.strip('main', [tuple(p) for p in pts], [(0, 0.3, 1)] * 3, 0.013, 0.0025)
    med = tip + Vector((0, -0.02, 0.004))
    it.cyl('gold', tuple(med), (0.019, 0.005, 0.019), (math.pi / 2 - 0.25, 0, 0), seg=24)
    it.slab('gold', star_pts(0.012), facing(tuple(med), (0, 0.25, 1)) @ gm((0, 0, 0.003)), depth=0.002)
    it.torus('gold', 0.004, 0.0015, gm(tuple(tip + Vector((0, -0.001, 0.001))), (0, 0, math.pi / 2)), seg=10, mseg=4)
    return it.finish()


def bandana():
    """A neckerchief knotted round the neck, its point down the chest, white polka dots."""
    it = Item('bandana')
    tilt = gm((0, -0.004, 0), (0.25, 0, 0))
    it.torus('main', 0.058, 0.01, tilt @ gm(s=(1.05, 1, 1)), seg=28, mseg=8)
    # The point: a patch of the chest narrowing to the middle at the bottom.
    pts = []
    for k in range(9):
        col = []
        for j in range(7):
            t = j / 6
            y = 0.072 - 0.055 * t
            half = 0.78 * (1 - t) + 0.02
            a = -half + 2 * half * k / 8
            col.append(tuple(neck_egg(1.17, y, a) + Vector((0, 0, 0.004))))
        pts.append(col)
    it.grid('main', pts)
    for (y, a) in ((0.06, -0.35), (0.06, 0.32), (0.045, 0.0), (0.03, -0.14), (0.03, 0.16), (0.062, 0.0)):
        p = neck_egg(1.17, y, a) + Vector((0, 0, 0.0045))
        it.sphere('white', tuple(p), (0.0042, 0.0042, 0.0018), r=(-0.5, a, 0), seg=8, rings=5)
    return it.finish()


def cape():
    """A hero's cape from the collar down the back, lined in red, a gold clasp in front."""
    it = Item('cape')
    tilt = gm((0, -0.002, 0), (NECK_TILT, 0, 0))
    it.torus('main', 0.061, 0.007, tilt @ gm(s=(1.04, 1, 1)), seg=28, mseg=6)
    rows, cols = 9, 18
    outer, inner = [], []
    for k in range(cols + 1):
        oc, ic = [], []
        for j in range(rows + 1):
            t = j / rows
            half = 1.35 + 0.15 * t
            a = math.pi - half + 2 * half * k / cols
            y = -0.004 - 0.17 * t
            ye = max(-0.075, min(0.07, y + 0.08))
            base = egg_point(1.0, ye, a) + NECK_EGG
            rr = Vector((base.x, 0, base.z)).length
            rad = max(rr * 1.18, 0.062 + 0.02 * t) + 0.012 + 0.025 * t
            fold = 1 + 0.06 * t * math.sin(a * 7)
            p = Vector((math.sin(a) * rad * fold * 1.05, y, math.cos(a) * rad * fold))
            if j == 0:
                p = tilt @ Vector((math.sin(a) * 0.064, 0, math.cos(a) * 0.064))
            n = Vector((p.x, 0, p.z)).normalized()
            oc.append(tuple(p))
            ic.append(tuple(p - n * 0.003))
        outer.append(oc)
        inner.append(list(reversed(ic)))
    it.grid('main', outer)
    it.grid('red', inner)
    it.grid('main', [[outer[k][-1], inner[k][0]] for k in range(cols + 1)])
    for side in (1, -1):
        it.sphere('gold', tuple(tilt @ Vector((side * 0.022, 0, 0.062))), (0.008, 0.008, 0.004), seg=10, rings=6)
    it.tube('gold', [tuple(tilt @ Vector((x, -0.004, 0.066))) for x in (-0.02, 0.0, 0.02)], 0.0015, caps=False)
    return it.finish()


def pearls():
    it = Item('pearls')
    tilt = gm((0, 0.0, -0.004), (NECK_TILT, 0, 0))
    n = 20
    for k in range(n):
        a = TAU * k / n
        it.sphere('white', tuple(tilt @ Vector((math.sin(a) * 0.061, 0, math.cos(a) * 0.061))), 0.0072, seg=10, rings=6)
    front = tilt @ Vector((0, 0, 0.061))
    it.sphere('pink', tuple(front + Vector((0, -0.017, 0.005))), (0.0085, 0.011, 0.007), seg=12, rings=8)
    it.sphere('gold', tuple(front + Vector((0, -0.007, 0.003))), 0.003, seg=8, rings=5)
    return it.finish()


def lei():
    """A Hawaiian garland of flowers."""
    it = Item('lei')
    tilt = gm((0, -0.004, -0.004), (NECK_TILT + 0.05, 0, 0))
    keys = ['pink', 'main', 'white', 'pink', 'main', 'gold', 'pink', 'main', 'white', 'pink', 'main', 'gold']
    n = len(keys)
    it.torus('leaf', 0.064, 0.005, tilt, seg=28, mseg=5)
    for k in range(n):
        a = TAU * k / n
        p = tilt @ Vector((math.sin(a) * 0.066, 0.004, math.cos(a) * 0.066))
        out = tilt.to_3x3() @ Vector((math.sin(a) * 0.6, 1.0, math.cos(a) * 0.6))
        flower(it, keys[k], facing(tuple(p), tuple(out), spin=a * 2), r=0.0145,
               centre='gold' if keys[k] != 'gold' else 'white', seg=15)
    return it.finish()


def tie():
    """A shirt collar and a necktie in the player's colour, white diagonal stripes."""
    it = Item('tie')
    tilt = gm((0, -0.002, 0), (NECK_TILT, 0, 0))
    it.torus('white', 0.059, 0.006, tilt @ gm(s=(1.04, 1.3, 1)), seg=28, mseg=6)
    for side in (1, -1):
        it.slab('white', [(0, 0.008), (side * 0.024, 0.004), (side * 0.006, -0.02)],
                facing(tuple(tilt @ Vector((side * 0.004, -0.004, 0.062))), (side * 0.25, 0.3, 1)), depth=0.003)
    knot = tilt @ Vector((0, -0.006, 0.064))
    it.sphere('main', tuple(knot), (0.0095, 0.0085, 0.0065), seg=10, rings=6)
    blade = [neck_egg(1.13, y, 0) + Vector((0, 0, 0.004)) for y in (0.064, 0.04, 0.015, -0.01)]
    blade[0] = knot + Vector((0, -0.006, 0))
    it.tube('main', [tuple(p) for p in blade], lambda t: 0.006 + 0.007 * t, seg=4)
    tip = blade[-1]
    it.sphere('main', tuple(tip + Vector((0, -0.006, 0.0))), (0.009, 0.009, 0.004), r=(0.3, 0, math.pi / 4), seg=4, rings=2)
    for y in (0.045, 0.022, 0.0):
        p = neck_egg(1.13, y, 0) + Vector((0, 0, 0.0115))
        it.box('white', tuple(p), (0.018 + 0.006 * (0.045 - y) / 0.045, 0.0025, 0.002), (0.3, 0, 0.6))
    return it.finish()


# ---- more body items ------------------------------------------------------------

def tux():
    """A tuxedo: satin lapels, white shirt with studs, a cummerbund in the player's colour, tails."""
    it = Item('tux')
    body_base(it, 'ink', 1.1)
    shell(it, 'white', 1.108, -0.03, 0.086, rows=6, seg=8, phi_fn=lambda t: (-0.62 * t ** 0.8, 0.62 * t ** 0.8))
    for side in (1, -1):
        shell(it, 'glass', 1.13, -0.03, 0.084, rows=6, seg=4,
              phi_fn=lambda t, s=side: (sorted((s * 0.62 * t ** 0.8, s * (0.62 * t ** 0.8 + 0.2 + 0.16 * t)))))
    for y in (0.055, 0.035, 0.015):
        it.sphere('ink', tuple(egg_point(1.12, y, 0.0)), (0.0035, 0.0035, 0.002), seg=8, rings=5)
    shell(it, 'main', 1.125, -0.042, -0.018, rows=2, seg=16, phi=(-1.1, 1.1))
    for y in (-0.034, -0.026):
        shell(it, 'ink', 1.128, y - 0.0008, y + 0.0008, rows=1, seg=16, phi=(-1.1, 1.1))
    # Two tails down the back.
    for side in (1, -1):
        pts = []
        for k in range(5):
            a = math.pi + side * (0.06 + 0.5 * k / 4)
            col = []
            for j in range(5):
                t = j / 4
                y = -0.04 - 0.06 * t
                p = egg_point(1.12, max(y, -0.06), a)
                p.y = y
                p = p + Vector((math.sin(a), 0, math.cos(a))) * (0.006 * t)
                col.append(tuple(p))
            pts.append(col)
        it.grid('ink', pts)
        it.grid('ink', [list(reversed(c)) for c in pts])
    sleeves(it, 'ink', band='white')
    return it.finish()


def puffer():
    """A quilted puffer jacket with a stand-up collar and a zip."""
    it = Item('puffer')
    shell(it, 'main', 1.1, -0.074, 0.086, rows=12, seg=28)
    for y in (-0.062, -0.037, -0.012, 0.013, 0.038, 0.062):
        egg_ring(it, 'main', 1.105, y, 0.0135, seg=28)
    it.lathe('main', [(0.05, 0.08), (0.055, 0.1), (0.05, 0.106), (0.044, 0.1)], gm((0, 0, 0.002)), seg=24)
    zip_pts = [tuple(on_egg(1.105, y, 0.0, 0.0145) @ Vector((0, 0, 0))) for y in (0.07, 0.04, 0.01, -0.02, -0.05, -0.075)]
    it.tube('metal', [(0, 0.104, 0.046)] + zip_pts, 0.0018, seg=6)
    it.box('metal', tuple(Vector(zip_pts[0]) + Vector((0, -0.006, 0.003))), (0.006, 0.012, 0.0025), (0.4, 0, 0))
    for side in (1, -1):
        it.sphere('main', (side * 0.081, 0.045, 0.0), (0.037, 0.034, 0.036), seg=16, rings=10)
        it.torus('main', 0.03, 0.007, gm((side * 0.1, 0.036, 0), (0, 0, side * 0.9)), seg=16, mseg=6)
    return it.finish()


def egg_normal(grow):
    """The outward normal of the grown egg at a point on it."""
    a, b, c = (e * grow for e in EGG)
    return lambda p: (p[0] / a ** 2, p[1] / b ** 2, p[2] / c ** 2)


def overalls():
    """Dungarees in the player's colour over a white tee: bib, straps, gold buttons, a pocket."""
    it = Item('overalls')
    shell(it, 'white', 1.08, -0.005, 0.086, rows=6, seg=28)
    egg_ring(it, 'white', 1.08, 0.086, 0.004)
    sleeves(it, 'white', r=0.03)
    shell(it, 'main', 1.1, -0.074, 0.005, rows=7, seg=28)
    egg_ring(it, 'main', 1.1, -0.074, 0.006)
    shell(it, 'main', 1.105, 0.0, 0.062, rows=4, seg=8, phi=(-0.5, 0.5))
    shell(it, 'main', 1.12, 0.012, 0.045, rows=2, seg=6, phi=(-0.26, 0.26))
    it.tube('ink', [tuple(egg_point(1.125, 0.045, a)) for a in [-0.26 + 0.52 * i / 6 for i in range(7)]], 0.0013, caps=False)
    for side in (1, -1):
        a0 = side * 0.42
        path = [egg_point(1.11, 0.058, a0), egg_point(1.115, 0.08, side * 0.7), egg_point(1.12, 0.09, side * 1.5),
                egg_point(1.115, 0.08, side * (math.pi - 0.75)), egg_point(1.11, 0.05, side * (math.pi - 0.42)),
                egg_point(1.105, 0.012, math.pi - side * 0.12)]
        it.strip('main', [tuple(p) for p in path], egg_normal(1.11), 0.013, 0.003)
        it.sphere('gold', tuple(on_egg(1.11, 0.056, a0, 0.003) @ Vector((0, 0, 0))), (0.005, 0.005, 0.0025), seg=10, rings=6)
    return it.finish()


def jersey_like(name, key, number, trim='white'):
    """A sports jersey: hem stripes, a V-neck, the number on the chest and back."""
    it = Item(name)
    shell(it, key, 1.09, -0.074, 0.086, rows=12, seg=32)
    egg_ring(it, trim, 1.09, -0.074, 0.006)
    for y in (-0.055, -0.043):
        shell(it, trim, 1.097, y - 0.003, y + 0.003, rows=1, seg=32)
    for side in (1, -1):
        it.tube(trim, [tuple(egg_point(1.1, 0.084, side * 0.75)), tuple(egg_point(1.11, 0.05, side * 0.02))], 0.004)
    egg_ring(it, trim, 1.09, 0.084, 0.004)
    size = 0.07 if len(number) == 1 else 0.045
    it.text(trim, number, on_egg(1.09, 0.008, 0.0, 0.001), size=size, depth=0.003)
    it.text(trim, number, on_egg(1.09, 0.008, math.pi, 0.001), size=size, depth=0.003)
    sleeves(it, key, band=trim, r=0.03)
    return it


def monad():
    """Monad purple, 143 on the front and back."""
    return jersey_like('monad', 'purple', '143').finish()


def tee():
    """A tee in the player's colour, a white crew neck and a red heart."""
    it = Item('tee')
    shell(it, 'main', 1.08, -0.074, 0.086, rows=12, seg=28)
    egg_ring(it, 'main', 1.08, -0.074, 0.005)
    egg_ring(it, 'white', 1.08, 0.084, 0.0045)
    it.slab('red', heart_pts(0.017), on_egg(1.08, 0.03, 0.42, 0.0025), depth=0.003)
    sleeves(it, 'main', band='white', r=0.03)
    return it.finish()


def apron():
    """A chef's white apron: bib, a pocket and the waist ties in the player's colour."""
    it = Item('apron')
    pts = []
    for k in range(11):
        col = []
        for j in range(9):
            t = j / 8
            y = -0.085 + 0.145 * t
            s = min(1.0, max(0.0, (t - 0.5) / 0.15))
            half = 1.05 - 0.6 * s * s * (3 - 2 * s)
            a = -half + 2 * half * k / 10
            p = egg_point(1.14, max(y, -0.035), a)
            p.y = y
            col.append(tuple(p))
        pts.append(col)
    it.grid('white', pts)
    shell(it, 'main', 1.155, -0.035, -0.008, rows=2, seg=6, phi=(-0.3, 0.3))
    it.tube('white', [tuple(egg_point(1.162, -0.008, a)) for a in [-0.3 + 0.6 * i / 6 for i in range(7)]], 0.0014, caps=False)
    for side in (1, -1):
        a0 = side * 0.45
        it.tube('main', [tuple(egg_point(1.14, 0.058, a0)), tuple(egg_point(1.13, 0.085, side * 0.6)), tuple(egg_point(1.12, 0.094, side * 1.5)),
                         tuple(egg_point(1.12, 0.09, side * 2.6)), tuple(egg_point(1.12, 0.094, math.pi))], 0.0026)
    it.tube('main', [tuple(egg_point(1.15, 0.005, a)) for a in [1.04 + (TAU - 2.08) * i / 16 for i in range(17)]], 0.0035, caps=False)
    back = egg_point(1.17, 0.005, math.pi)
    for side in (1, -1):
        it.sphere('main', tuple(back + Vector((side * 0.012, 0.002, -0.004))), (0.012, 0.007, 0.004), r=(0, 0, side * 0.3), seg=10, rings=6)
        it.tube('main', [tuple(back), tuple(back + Vector((side * 0.008, -0.025, -0.003)))], 0.003)
    return it.finish()


def ziphoodie():
    """The hoodie zipped open over a white tee."""
    it = Item('ziphoodie')
    shell(it, 'white', 1.085, -0.07, 0.086, rows=8, seg=8, phi=(-0.3, 0.3))
    shell(it, 'main', 1.1, -0.074, 0.086, rows=12, seg=30, phi=(0.17, TAU - 0.17))
    it.tube('main', [tuple(egg_point(1.1, -0.074, a)) for a in [0.17 + (TAU - 0.34) * i / 30 for i in range(31)]], 0.007)
    for side in (1, -1):
        it.tube('metal', [tuple(egg_point(1.102, y, side * 0.17)) for y in [-0.074 + 0.16 * i / 8 for i in range(9)]], 0.0022, seg=6)
    it.torus('main', 0.056, 0.016, gm((0, 0.088, -0.006), (-0.25, 0, 0), (1.05, 1, 1)), seg=24, mseg=8)
    it.sphere('main', (0, 0.1, -0.065), (0.058, 0.05, 0.038))
    for side in (1, -1):
        p0 = egg_point(1.1, 0.068, side * 0.26)
        it.tube('white', [tuple(p0), tuple(egg_point(1.13, 0.03, side * 0.3)), tuple(egg_point(1.15, 0.008, side * 0.31))], 0.0022)
        it.sphere('white', tuple(egg_point(1.17, 0.006, side * 0.31)), 0.0035, seg=8, rings=6)
    sleeves(it, 'main', band='main')
    return it.finish()


# ---- held in the right hand -------------------------------------------------------
# The hand's pivot is the origin (a ball r ~0.03), fingers down (-y), palm toward the body (+x for the right
# hand, the only one that holds anything); props stand up out of the fist, a little in front of it, as the
# Chog Genesis props do (chog_wear.py).
GRIP = Vector((0.004, 0.01, 0.024))


def coffee():
    """Coffee to go: a white cup, a sleeve in the player's colour, a dark lid."""
    it = Item('coffee')
    c = GRIP + Vector((0, 0.024, 0.006))
    it.cyl('white', tuple(c), (0.0185, 0.054, 0.0185), seg=20, top=1.2)
    it.cyl('main', tuple(c + Vector((0, 0.002, 0))), (0.0208, 0.022, 0.0208), seg=20, top=1.09)
    it.cyl('ink', tuple(c + Vector((0, 0.029, 0))), (0.0235, 0.006, 0.0235), seg=20, top=0.92)
    it.cyl('ink', tuple(c + Vector((0, 0.034, 0))), (0.016, 0.005, 0.016), seg=16, top=0.8)
    return it.finish()


def flag():
    """A pennant on a wooden pole, waving outward."""
    it = Item('flag')
    base = GRIP
    it.cyl('wood', tuple(base + Vector((0, 0.07, 0))), (0.0042, 0.2, 0.0042), seg=10)
    it.sphere('gold', tuple(base + Vector((0, 0.174, 0))), 0.008, seg=10, rings=6)
    wave = lambda u: 0.009 * math.sin(u * 5.5) * u  # noqa: E731
    front, back = [], []
    for k in range(9):
        u = k / 8
        col_f, col_b = [], []
        for j in range(5):
            v = j / 4
            p = base + Vector((-0.004 - 0.095 * u, 0.165 - 0.06 * v - 0.01 * u * u, wave(u)))
            col_f.append(tuple(p + Vector((0, 0, 0.0012))))
            col_b.append(tuple(p - Vector((0, 0, 0.0012))))
        front.append(col_f)
        back.append(list(reversed(col_b)))
    it.grid('main', front)
    it.grid('main', back)
    it.grid('main', [[front[-1][j], back[-1][4 - j]] for j in range(5)])
    for side in (1, -1):
        u = 0.45
        c = base + Vector((-0.004 - 0.095 * u, 0.135 - 0.01 * u * u, wave(u) + side * 0.0032))
        it.slab('white', star_pts(0.014), facing(tuple(c), (0, 0, side)), depth=0.0015)
    return it.finish()


def balloon():
    """A balloon in the player's colour on a string, floating up and out."""
    it = Item('balloon')
    top = GRIP + Vector((-0.12, 0.26, -0.03))
    it.tube('white', [tuple(GRIP.lerp(top, t) + Vector((0.012 * math.sin(t * 6), 0, 0))) for t in [i / 10 for i in range(11)]], 0.0011, seg=5)
    c = top + Vector((-0.012, 0.052, -0.004))
    it.sphere('main', tuple(c), (0.044, 0.053, 0.044), r=(0, 0, 0.22), seg=22, rings=16)
    it.cyl('main', tuple(top + Vector((-0.002, 0.004, 0))), (0.0065, 0.009, 0.0065), (0, 0, 0.22), seg=10, top=0.4)
    it.sphere('white', tuple(c + Vector((-0.016, 0.022, 0.03))), (0.008, 0.012, 0.004), r=(0.4, -0.5, 0.4), seg=8, rings=6)
    return it.finish()


def chip():
    """A poker chip held up: the player's colour, white edge spots and an inner ring."""
    it = Item('chip')
    c = GRIP + Vector((0, 0.03, 0.008))
    it.cyl('main', tuple(c), (0.025, 0.0065, 0.025), (math.pi / 2, 0, 0), seg=28)
    for k in range(8):
        a = TAU * k / 8
        it.box('white', tuple(c + Vector((math.cos(a) * 0.0235, math.sin(a) * 0.0235, 0))), (0.0055, 0.0085, 0.0068), (0, 0, a))
    for side in (1, -1):
        it.torus('white', 0.0155, 0.0013, gm(tuple(c + Vector((0, 0, side * 0.0033))), (math.pi / 2, 0, 0)), seg=24, mseg=4)
        it.slab('white', star_pts(0.0085), facing(tuple(c + Vector((0, 0, side * 0.0033))), (0, 0, side)), depth=0.0012)
    return it.finish()


def trophy():
    """A little gold cup on a wooden base, a band in the player's colour."""
    it = Item('trophy')
    c = GRIP + Vector((0, -0.018, 0.004))
    it.box('wood', tuple(c + Vector((0, -0.002, 0))), (0.03, 0.014, 0.026), bevel=0.002)
    it.lathe('gold', [(0.0, 0.005), (0.012, 0.005), (0.012, 0.009), (0.0055, 0.013), (0.0045, 0.032), (0.006, 0.04),
                      (0.02, 0.048), (0.026, 0.075), (0.024, 0.077), (0.019, 0.05), (0.0, 0.047)], gm(tuple(c)), seg=22)
    it.lathe('main', [(0.0218, 0.056), (0.0236, 0.064), (0.0228, 0.066), (0.021, 0.058)], gm(tuple(c)), seg=22)
    for side in (1, -1):
        # A half ring on each side, from the cup's waist round to its rim.
        it.torus('gold', 0.011, 0.0022, gm(tuple(c + Vector((side * 0.022, 0.063, 0))), (math.pi / 2, 0, 0)), seg=14, mseg=5,
                 arc=math.pi, a0=0 if side == 1 else math.pi)
    return it.finish()


PIPS = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)], 4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
        5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)], 6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)]}


def die(it, c, rot, size=0.028):
    R = gm(tuple(c), rot)
    it.box('white', tuple(c), (size, size, size), rot, bevel=size * 0.16)
    h, q = size / 2, size * 0.27
    # Opposite faces add up to seven.
    for n, (axis, sgn) in zip((1, 6, 2, 5, 3, 4), (('z', 1), ('z', -1), ('y', 1), ('y', -1), ('x', 1), ('x', -1))):
        for u, v in PIPS[n]:
            local = {'z': (u * q, v * q, sgn * h), 'y': (u * q, sgn * h, v * q), 'x': (sgn * h, u * q, v * q)}[axis]
            it.sphere('ink', tuple(R @ Vector(local)), size * 0.085, seg=6, rings=4)


def dice():
    it = Item('dice')
    die(it, GRIP + Vector((0.008, 0.024, 0.008)), (0.35, -0.5, 0.2))
    die(it, GRIP + Vector((-0.022, 0.042, 0.0)), (-0.4, 0.7, -0.5))
    return it.finish()


def cash():
    """A fan of banknotes held in a band in the player's colour."""
    it = Item('cash')
    base = GRIP + Vector((0, 0.0, 0.006))
    for k, ang in enumerate((0.42, 0.14, -0.14, -0.42)):
        M = gm(tuple(base + Vector((0, 0, 0.0025 * k))), (0, 0, ang))
        it.box('leaf', tuple(M @ Vector((0, 0.04, 0))), (0.032, 0.066, 0.0016), (0, 0, ang))
        it.slab('white', ellipse_pts(0.0075, 0.011, 14), M @ gm((0, 0.046, 0.0012)), depth=0.0008)
    it.box('main', tuple(base + Vector((0, 0.022, 0.004))), (0.03, 0.009, 0.015))
    return it.finish()


def lollipop():
    """A swirly lollipop: the player's colour with a white spiral."""
    it = Item('lollipop')
    # Leaning out, away from the cheek.
    c = GRIP + Vector((-0.03, 0.088, 0.002))
    it.tube('white', [tuple(GRIP + Vector((0.004, -0.015, 0))), tuple(c)], 0.0032, seg=8)
    it.cyl('main', tuple(c), (0.028, 0.009, 0.028), (math.pi / 2, 0, 0), seg=28)
    turns = 2.6 * TAU
    for side in (1, -1):
        spiral = []
        for i in range(45):
            t = turns * i / 44
            rr = 0.003 + 0.0235 * t / turns
            spiral.append(tuple(c + Vector((math.cos(t * side) * rr, math.sin(t * side) * rr, side * 0.0045))))
        it.tube('white', spiral, 0.0026, seg=6)
    return it.finish()


BUILDERS = [cap, beanie, tophat, crown, headphones, backcap, bucket, party, halo, horns, bunny, cowboy, chef, viking, wizard,
            flowers, propeller, headband,
            shades, specs, aviators, hearts, stars, monocle, eyepatch, visor, glasses3d, pixel,
            chain, scarf, bowtie, medal, bandana, cape, pearls, lei, tie,
            hoodie, jersey, suit, varsity, tux, puffer, overalls, monad, tee, apron, ziphoodie,
            coffee, flag, balloon, chip, trophy, dice, cash, lollipop]


# ---- thumbnails -------------------------------------------------------------

VIEW = {'head': (0.55, 0.45, 1.0), 'eyes': (0.35, 0.15, 1.0), 'neck': (0.4, 0.55, 1.0), 'body': (0.45, 0.3, 1.0),
        'held': (-0.35, 0.2, 1.0)}


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
CANON = {'head': (0, 0, 0), 'eyes': (0, 0.015, 0.1), 'neck': (0, 0.2, 0), 'body': (0, 0.12, 0), 'held': (0, 0, 0)}
# Where the rig group each slot hangs from sits on a figure at rest (Outfit.tsx ATTACH).
SLOT_BASE = {'head': PIVOTS['Head'], 'eyes': PIVOTS['Head'], 'neck': PIVOTS['Body'], 'body': PIVOTS['Body'],
             'held': PIVOTS['HandR']}


def placement(fit, cid, iid, look):
    """Where item `iid` goes on character `cid` wearing `look`, as Outfit.tsx outfitPlacement: (p, s) in its rig group's frame."""
    slot = SLOTS[iid]
    anc = fit['chars'].get(cid, {}).get(slot) or fit['canonical'][slot]
    tweak = fit['items'].get(iid, {}).get(cid, {})
    p = [a + b for a, b in zip(anc['p'], tweak.get('p', [0, 0, 0]))]
    ts = tweak.get('s', 1)
    s = [v * (ts if isinstance(ts, (int, float)) else ts[i]) for i, v in enumerate(anc['s'])]
    if slot == 'neck' and any(SLOTS.get(x) == 'body' and x not in SIGNATURE and x not in fit['hide'].get(cid, []) for x in look):
        s = [v * k for v, k in zip(s, fit['neckOverBody'])]
    return p, s


def pose_figure(by_name, cid, look, fit, ox, oz, copy):
    """Stand character `cid` at (ox, 0, oz) in its rest pose, dressed for `look`: its own garments on unless the look
    puts another item in their slot (or is `bare`), and the cut of its mane the look's hat calls for (outfitFit.json
    `mane`; OUTFIT_MANE=full shows the whole mane under every hat). `copy` places copies, leaving the originals."""
    def put(src, piv, shown):
        o = src.copy() if copy else src
        if copy:
            blib.link(o)
        o.parent = None
        o.location = blib.V(piv[0] + ox, piv[1], piv[2] + oz)
        o.rotation_euler = (0, 0, 0)
        o.rotation_quaternion = (1, 0, 0, 0)
        o.scale = (1, 1, 1)
        o.hide_render = not shown
    for part, piv in PIVOTS.items():
        src = by_name.get(f'{cid}_{part}')
        if not src:
            continue
        slot = GARMENT_SLOT.get(part)
        off = bool(slot) and (look == ['bare'] or any(
            SLOTS.get(x) == slot and SIGNATURE.get(x, (cid, part))[:2] != (cid, part) for x in look))
        put(src, piv, not off)
    hat = next((x for x in look if SLOTS.get(x) == 'head' and x not in fit['hide'].get(cid, [])), None)
    cut = os.environ.get('OUTFIT_MANE') or fit.get('mane', {}).get(cid, {}).get(hat, 'full')
    for name, src in by_name.items():
        if name.startswith(f'{cid}_Hair_') and src.type == 'MESH':
            put(src, PIVOTS['Head'], name == f'{cid}_Hair_{cut}')


def wear(items, fit, cid, look, ox, oz):
    """Copies of the look's items placed on character `cid` standing at (ox, 0, oz)."""
    placed = []
    for iid in look:
        if iid in fit['hide'].get(cid, []) or iid not in items:
            continue
        p, s = placement(fit, cid, iid, look)
        base = SLOT_BASE[SLOTS[iid]]
        o = items[iid].copy()
        blib.link(o)
        o.location = blib.V(base[0] + p[0] + ox, base[1] + p[1], base[2] + p[2] + oz)
        o.scale = (s[0], s[2], s[1])
        o.hide_render = False
        placed.append(o)
    return placed


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
    by_name = {o.name: o for o in bpy.data.objects}
    for row, look in enumerate(looks):
        for col, cid in enumerate(ids):
            ox, oz = (col - (len(ids) - 1) / 2) * 0.36, -row * 5.0
            pose_figure(by_name, cid, look, fit, ox, oz, copy=row > 0)
            wear(items, fit, cid, look, ox, oz)
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


def sheet(items, out, chars_glb, ids, cid='chog', tile=300):
    """One picture of every item in `ids` worn by `cid` (the whole figure, from the front and three-quarters),
    labelled, in a grid: for checking a batch of items for clipping and looks in one go."""
    from PIL import Image, ImageDraw, ImageFont
    fit = json.load(open(FIT))
    bpy.ops.import_scene.gltf(filepath=chars_glb)
    by_name = {o.name: o for o in bpy.data.objects}
    for o in by_name.values():
        o.hide_render = True
    for o in items.values():
        o.hide_render = True
    # Side by side, far apart (a row behind would peek over the shoulders of the one in front).
    for k, iid in enumerate(ids):
        pose_figure(by_name, cid, [iid], fit, k * 3.0, 0, copy=k > 0)
        wear(items, fit, cid, [iid], k * 3.0, 0)
    # The items' colour parts in a player's colour (SHEET_COLOR), not the thumbnails' white.
    mat_for('main').node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (
        *blib.hex_rgb(os.environ.get('SHEET_COLOR', '#ff8a3d')), 1)
    sc = bpy.context.scene
    setup_render(sc, tile)
    sc.render.film_transparent = False
    sc.cycles.samples = 24
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = float(os.environ.get('SHEET_ZOOM', '0.78'))
    blib.link(cam)
    sc.camera = cam
    tmp = os.path.join(blib.HERE, '.cache', 'outfits', 'sheet')
    os.makedirs(tmp, exist_ok=True)
    views = [(0, 0.12, 1), (-0.85, 0.22, 0.75)]
    cols, label = 4, 30
    rows = (len(ids) + cols - 1) // cols
    img = Image.new('RGB', (cols * 2 * tile, rows * (tile + label)), (235, 237, 242))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=22)
    except TypeError:
        font = ImageFont.load_default()
    for k, iid in enumerate(ids):
        for v, view in enumerate(views):
            d = C @ Vector(view).normalized()
            cam.location = blib.V(k * 3.0, float(os.environ.get('SHEET_AIM', '0.31')), 0) + d * 1.2
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(tmp, f'{iid}-{v}.png')
            bpy.ops.render.render(write_still=True)
            x, y = (k % cols) * 2 * tile + v * tile, (k // cols) * (tile + label)
            img.paste(Image.open(sc.render.filepath).convert('RGB'), (x, y))
        x, y = (k % cols) * 2 * tile, (k // cols) * (tile + label) + tile
        draw.text((x + 10, y + 3), f'{iid} ({SLOTS[iid]})', fill=(30, 30, 40), font=font)
        blib.log('sheet', iid)
    img.save(out)
    blib.log('sheet', out)


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


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


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
    # --items a,b: build just these (for --preview / --sheet; an export always builds every item).
    some = sys.argv[sys.argv.index('--items') + 1].split(',') if '--items' in sys.argv else None
    looking = '--preview' in sys.argv or '--sheet' in sys.argv
    objs = [b() for b in BUILDERS if not (looking and some) or b.__name__ in some]
    for o in objs:
        blib.log(o.name, f'{tris(o)} tris', ', '.join(m.name.split(':')[1] for m in o.data.materials))
    blib.log('every item', f'{sum(tris(o) for o in objs)} tris')
    if '--sheet' in sys.argv:
        out = sys.argv[sys.argv.index('--sheet') + 1]
        sheet({o.name: o for o in objs}, out, CHARS_CACHE, [o.name for o in objs], cid=os.environ.get('OUTFIT_ONLY', 'chog'))
        return
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
    # The Low-graphics copy: simplified by gltfpack, like the characters' -low files.
    low = os.path.join(blib.PUBLIC, 'models', 'outfits-low.glb')
    blib.gltfpack(low, ['-si', str(LOW_RATIO)], src=os.path.join(blib.HERE, '.cache', 'models', 'outfits.glb'))
    blib.log('wrote models/outfits-low.glb', f'{os.path.getsize(low) // 1024} KB')
    entry = {'url': '/models/outfits.glb', 'low': '/models/outfits-low.glb'}
    record_thumbs(entry, objs, thumbnails(objs))
    # The items out of the signature items' pictures (a halo or a balloon would reach into them).
    for o in objs:
        o.hide_render = True
    sig = signature_objects()
    record_thumbs(entry, sig, thumbnails(sig))
    blib.record('outfits', entry)


if __name__ == '__main__':
    main()
