"""The Speedway map's setting: the table in the infield of a race track at dusk.

A round paved plaza under the table with a chequered band, a mown infield, a
ring of track with red-and-white rumble kerbs, painted run-off, gravel traps
and tyre walls, a barrier wall with sponsor boards and catch fencing, the
start/finish gantry over the grid, a pit lane with lit garages and a race
control tower, three covered grandstands with a crowd, floodlight towers,
trees, rolling hills and a dusk sky. A low sun and the floodlights are baked
by Cycles into one lightmap, like the Classic room.

    tools/blender/run.sh speedway_set.py              # full quality
    tools/blender/run.sh speedway_set.py --draft      # quick bake for iterating
    tools/blender/run.sh speedway_set.py --preview    # path-traced stills from the game's cameras, no bake

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the ground at y = -4.6. Angles run round the
table: a = 0 is +x (right), -pi/2 the back (away from the default camera).
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import blib  # noqa: E402
import table as table_mod  # noqa: E402
import tex  # noqa: E402
from blib import V, box, cylinder, flat, glow, lathe, mix_hex, sphere, textured  # noqa: E402

DRAFT = '--draft' in sys.argv
PREVIEW = '--preview' in sys.argv
F = -4.6
TAU = 2 * math.pi

# ---- layout (radii from the table centre) --------------------------------
PLAZA_R = 9.9       # paved plaza the table stands on
INFIELD_R = 12.7    # mown grass out to the inner kerb
TRACK_IN = 13.3
TRACK_OUT = 19.1
WALL_R = 23.6       # barrier round the run-off
PITWALL_R = 20.4    # along the pit straight the wall comes in close...
PITLANE_R = 24.6    # ...and the pit lane runs to the garage fronts
GARAGE_BACK = 29.5
APRON_R = 36.0      # stands, paddock and aprons stop here; grass beyond
FIELD_R = 82.0      # the lit ground ends at the foot of the (unlit) hills

START_A = -2.2      # start/finish line: back-left, in view of the table camera
PIT = (-2.55, -0.80)
STANDS = {'R': (-0.62, 0.42), 'F': (0.85, 2.25), 'L': (2.65, 3.55)}
GRAVEL = [(-0.52, 0.32), (1.15, 1.95), (2.75, 3.45)]
TOWERS = [-2.64, -0.71, 0.63, 2.45]

# Sun: low in the front-right (the same side as the game's key light), warm.
SUN_AZ = math.atan2(5, 6)
SUN_EL = math.radians(21)
SUN_DIR = Vector((math.cos(SUN_EL) * math.cos(SUN_AZ), math.sin(SUN_EL), math.cos(SUN_EL) * math.sin(SUN_AZ)))  # game frame, toward the sun

rng = np.random.default_rng(7)

# ---- palette ---------------------------------------------------------------
ASPHALT = '#4b4e56'
CONCRETE = '#c9c4ba'
CONCRETE_DK = '#9d9a93'
GRASS_A = '#5fa43f'
GRASS_B = '#6db54a'
GRASS_FAR = '#5f9c40'
GRAVEL_C = '#d9c49a'
RUNOFF_A = '#3f9a6a'
RUNOFF_B = '#2f7fb8'
KERB_RED = '#d8282c'
KERB_WHITE = '#f3f0ea'
WHITE = '#f2f0ea'
STEEL = '#8e959e'
STEEL_DK = '#4a4f57'
TYRE = '#26272a'
TEAM = ['#d8282c', '#2a62d6', '#f2c230', '#1e9b57', '#ff7a1a', '#7a3fd0']
SHIRTS = ['#e6194b', '#3cb4ff', '#ffd23f', '#3ddc84', '#f5f5f5', '#ff8c1a', '#b15cff', '#1d3c8f', '#d8282c', '#ffffff']
SKIN = ['#f1c7a5', '#d9a07a', '#a8694a', '#6e4630', '#f5d5b8']


def P(r, a, y=0.0):
    """Game-space point at radius r, angle a, height y above the ground."""
    return (r * math.cos(a), F + y, r * math.sin(a))


def yaw_at(a):
    """rot_y that turns local +x along the ring (increasing a) and local +z toward the table."""
    return -(a + math.pi / 2)


def segs_for(r, a0, a1, step):
    return max(1, int(math.ceil(abs(a1 - a0) * r / step)))


def game_normal(n):
    return Vector((n.x, n.z, -n.y))


# ---------------------------------------------------------------------------
# Geometry batch: many small parts straight into one bmesh (one object)
# ---------------------------------------------------------------------------

class Batch:
    """Builds lots of parts (seats, crowd, kerbs, fence) into one mesh without an object per part."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _paint(self, verts, mat):
        i = self.slot(mat)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = i

    def box(self, c, size, mat, yaw=0.0, bottom=False, drop_bottom=True):
        """An axis box (w along local x, h up, d along local z) at game point c, turned by yaw."""
        w, h, d = size
        M = Matrix.Translation(V(*c)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Diagonal((w, d, h, 1))
        if bottom:
            M = M @ Matrix.Translation((0, 0, 0.5))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        self._paint(r['verts'], mat)
        if drop_bottom and bottom:
            # Nobody sees the underside of things standing on the ground.
            dead = [f for f in {f for v in r['verts'] for f in v.link_faces} if f.normal.z < -0.99]
            bmesh.ops.delete(self.bm, geom=dead, context='FACES_ONLY')

    def ico(self, c, r, mat, scale=(1, 1, 1), subdiv=1):
        M = Matrix.Translation(V(*c)) @ Matrix.Diagonal((scale[0], scale[2], scale[1], 1))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=M)
        self._paint(res['verts'], mat)

    def cone(self, c, r0, r1, h, mat, segs=8, caps=True):
        """A cone/frustum standing on game point c."""
        M = Matrix.Translation(V(*c)) @ Matrix.Translation((0, 0, h / 2))
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r0, radius2=r1,
                                    depth=h, matrix=M)
        self._paint(res['verts'], mat)

    def lathe(self, c, profile, mat, segs=12, cap_top=True):
        """Revolve [(radius, height)] about the up axis at game point c (shared verts, smooth)."""
        rings = []
        for rr, yy in profile:
            if rr <= 1e-5:
                rings.append([self.bm.verts.new(V(c[0], c[1] + yy, c[2]))])
                continue
            rings.append([self.bm.verts.new(V(c[0] + math.cos(TAU * i / segs) * rr, c[1] + yy,
                                                c[2] + math.sin(TAU * i / segs) * rr)) for i in range(segs)])
        idx = self.slot(mat)
        new = []
        # Winding: a profile running up/outward faces outward, one running inward at the top faces up.
        for ra, rb in zip(rings, rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                if len(ra) == 1:
                    new.append(self.bm.faces.new((ra[0], rb[i], rb[j])))
                elif len(rb) == 1:
                    new.append(self.bm.faces.new((ra[i], rb[0], ra[j])))
                else:
                    new.append(self.bm.faces.new((ra[i], rb[i], rb[j], ra[j])))
        if cap_top and len(rings[-1]) > 1:
            new.append(self.bm.faces.new(list(reversed(rings[-1]))))
        for f in new:
            f.material_index = idx
            f.smooth = True

    def beam(self, p0, p1, t, mat):
        """A square bar of thickness t from game point p0 to p1."""
        a, b = V(*p0), V(*p1)
        d = b - a
        M = (Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
             @ Matrix.Diagonal((t, t, d.length, 1)))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M)
        self._paint(r['verts'], mat)

    def strip(self, rows, mat, out=None, closed=False, uvs=None, max_len=4.5):
        """Quads between rows of game points (rows[j][i]); mat may be f(i, j).

        out(centre) -> game vector the faces should face (flipped to match).
        Long strips are cut into pieces about max_len long: one long thin
        lightmap island would make the packer shrink the whole atlas to fit it.
        """
        if not closed and uvs is None and max_len:
            r0 = rows[0]
            cuts, run = [0], 0.0
            for i in range(1, len(r0)):
                run += math.dist(r0[i - 1], r0[i])
                if run >= max_len and i < len(r0) - 1:
                    cuts.append(i)
                    run = 0.0
            if len(cuts) > 1:
                cuts.append(len(r0) - 1)
                out_faces = []
                for c0, c1 in zip(cuts, cuts[1:]):
                    def sub_mat(i, j, c0=c0):
                        return mat(i + c0, j) if callable(mat) else mat
                    out_faces += self.strip([row[c0:c1 + 1] for row in rows], sub_mat, out=out, max_len=None)
                return out_faces
        vs = [[self.bm.verts.new(V(*p)) for p in row] for row in rows]
        n = len(rows[0])
        faces = []
        for j in range(len(rows) - 1):
            for i in range(n if closed else n - 1):
                i2 = (i + 1) % n
                f = self.bm.faces.new((vs[j][i], vs[j][i2], vs[j + 1][i2], vs[j + 1][i]))
                f.material_index = self.slot(mat(i, j) if callable(mat) else mat)
                if uvs:
                    for loop, (jj, ii) in zip(f.loops, ((j, i), (j, i2), (j + 1, i2), (j + 1, i))):
                        loop[self.uv].uv = uvs(ii, jj)
                faces.append(f)
        if out is not None:
            self._orient(faces, out)
        return faces

    def quad(self, pts, mat, out=None, uvs=None):
        vs = [self.bm.verts.new(V(*p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.slot(mat)
        if uvs:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
        if out is not None:
            self._orient([f], out)
        return f

    def _orient(self, faces, out):
        for f in faces:
            f.normal_update()
            c = f.calc_center_median()
            g = Vector((c.x, c.z, -c.y))
            want = out(g) if callable(out) else Vector(out)
            if game_normal(f.normal).dot(want) < 0:
                f.normal_flip()

    def done(self, smooth=False):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        if smooth:
            me.shade_smooth()
        obj = bpy.data.objects.new(self.name, me)
        blib.link(obj)
        return obj


def radial(c):
    """Outward from the table (horizontal)."""
    v = Vector((c.x, 0.0, c.z))
    return v.normalized() if v.length > 1e-6 else Vector((1, 0, 0))


def inward(c):
    return -radial(c)


UP = (0, 1, 0)


def arc_rows(radii_heights, a0, a1, step, r_ref=None):
    """Rows of points along an arc for each (r, y) in a profile: rows[j] = profile point j along the arc."""
    r_ref = r_ref or max(r for r, _ in radii_heights)
    n = segs_for(r_ref, a0, a1, step)
    return [[P(r, a0 + (a1 - a0) * i / n, y) for i in range(n + 1)] for r, y in radii_heights], n


# ---------------------------------------------------------------------------
# Textures (procedural, like tex.py)
# ---------------------------------------------------------------------------

def tex_detail(size=512, seed=21):
    """Neutral grain for every tinted ground surface (grass, asphalt, gravel, concrete); tiles."""
    r = np.random.default_rng(seed)
    broad = tex.noise(size, size, (3, 3), 4, seed)
    mid = tex.noise(size, size, (24, 24), 3, seed + 1)
    fine = r.random((size, size)).astype(np.float32)
    v = 0.93 + 0.08 * (broad - 0.5) + 0.1 * (mid - 0.5) + 0.07 * (fine - 0.5)
    v = np.where(fine > 0.993, v - 0.14, v)
    v = np.where(fine < 0.004, v + 0.06, v)
    return np.repeat(np.clip(v, 0, 1)[..., None], 3, axis=2)


def tex_track(w=1024, h=512, seed=31):
    """The racing surface: u runs along the track (tiles), v across it (0 = inner edge at the bottom row)."""
    r = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    v = 1 - (y + 0.5) / h
    n1 = tex.noise(h, w, (4, 8), 4, seed)
    n2 = tex.noise(h, w, (32, 64), 3, seed + 1)
    agg = r.random((h, w)).astype(np.float32)
    shade = 0.93 + 0.1 * (n1 - 0.5) + 0.08 * (n2 - 0.5) + 0.09 * (agg - 0.5)
    img = tex.rgb(ASPHALT)[None, None, :] * shade[..., None]
    # Rubbered-in racing line: dark where the cars run (the inside of a constant bend), lighter off line.
    band = np.exp(-((v - 0.3) / 0.14) ** 2) * 0.3 + np.exp(-((v - 0.62) / 0.1) ** 2) * 0.1
    img *= (1 - band)[..., None]
    img *= (1 + 0.06 * np.clip((v - 0.75) / 0.2, 0, 1))[..., None]
    # Skid marks: thin dark streaks along the line, wrapping round the tile.
    for _ in range(30):
        vc = float(np.clip(r.normal(0.33, 0.13), 0.08, 0.92))
        length = int(r.uniform(90, 520))
        x0 = r.uniform(0, w)
        half = r.uniform(1.0, 2.6)
        dark = r.uniform(0.1, 0.3)
        drift = r.uniform(-14, 14)
        xs = (x0 + np.arange(length)).astype(int) % w
        t = np.arange(length) / length
        yc = (1 - vc) * h + drift * t
        fade = np.sin(np.pi * t) ** 0.6
        for k in range(-3, 4):
            ys = np.clip((yc + k).astype(int), 0, h - 1)
            prof = np.clip(1 - np.abs(k) / (half + 0.5), 0, 1)
            img[ys, xs] *= (1 - dark * prof * fade)[:, None]
    # White edge lines, a little worn.
    wear = tex.noise(h, w, (8, 64), 2, seed + 5)
    white = tex.rgb('#ecebe6')
    for v0, v1 in ((0.012, 0.05), (0.95, 0.988)):
        m = (v >= v0) & (v <= v1)
        k = np.where(wear > 0.72, 0.7, 0.95)[..., None]
        img = np.where(m[..., None], img * (1 - k) + white * k, img)
    return np.clip(img, 0, 1)


DECAL_CHEQUER = (0.0, 0.75, 1.0, 1.0)  # u0, v0, u1, v1 of the 32x4 chequer strip


def decal_panel(k):
    """UV rectangle of sponsor panel design k (six 4:1 panels under the chequer strip)."""
    k %= 6
    col, row = k % 2, k // 2
    v1 = 0.75 - row * 0.25
    return (col * 0.5, v1 - 0.25, col * 0.5 + 0.5, v1)


def tex_decals(w=1024, h=512):
    """Chequer strip + six blank sponsor-style panels (bold shapes, no names or logos)."""
    img = np.ones((h, w, 3), np.float32)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    chq = (((x // 32) + (y // 32)) % 2 == 0) & (y < 128)
    img[y < 128] = tex.rgb('#f4f3ee')
    img[chq] = tex.rgb('#18181b')
    for k in range(6):
        col, row = k % 2, k // 2
        x0, y0 = col * 512, 128 + row * 128
        cx = (x[y0:y0 + 128, x0:x0 + 512] - x0) / 128.0   # 0..4 along
        cy = (y[y0:y0 + 128, x0:x0 + 512] - y0) / 128.0   # 0..1 down
        cell = img[y0:y0 + 128, x0:x0 + 512]
        bg, fg = [('#d8282c', '#ffffff'), ('#f6c431', '#18181b'), ('#1f5fbf', '#ffffff'),
                  ('#1e9b57', '#ffffff'), ('#1c1c22', '#ff8a1f'), ('#f4f3ee', '#d8282c')][k]
        cell[:] = tex.rgb(bg)
        f = tex.rgb(fg)
        if k == 0:    # chevrons
            for i in range(3):
                m = np.abs((cx - 0.35 - i * 0.42) - np.abs(cy - 0.5) * 0.8) < 0.11
                cell[m & (np.abs(cy - 0.5) < 0.34)] = f
            cell[(cx > 1.9) & (cx < 3.7) & (np.abs(cy - 0.5) < 0.12)] = f
        elif k == 1:  # roundel and bars
            d = np.hypot(cx - 0.6, cy - 0.5)
            cell[d < 0.36] = f
            cell[d < 0.22] = tex.rgb('#ffffff')
            cell[d < 0.12] = tex.rgb('#d8282c')
            for i, (a, b) in enumerate([(1.2, 3.7), (1.2, 2.9)]):
                cell[(cx > a) & (cx < b) & (np.abs(cy - (0.36 + i * 0.28)) < 0.08)] = f
        elif k == 2:  # star and stripes
            ang = np.arctan2(cy - 0.5, cx - 0.62)
            rad = np.hypot(cx - 0.62, cy - 0.5)
            star = rad < 0.2 + 0.17 * (0.5 + 0.5 * np.cos(5 * (ang + np.pi / 2))) ** 3
            cell[star] = f
            for i in range(2):
                cell[(cx > 1.25) & (cx < 3.75) & (np.abs(cy - (0.38 + i * 0.25)) < 0.06)] = f
        elif k == 3:  # wave
            wave = 0.5 + 0.22 * np.sin(cx * 2.2)
            cell[np.abs(cy - wave) < 0.11] = f
            cell[np.abs(cy - wave - 0.24) < 0.035] = tex.rgb('#f6c431')
        elif k == 4:  # hazard stripes and a dot
            cell[((cx + cy) * 3.0 % 1 < 0.5) & (cx > 2.6)] = f
            cell[np.hypot(cx - 0.6, cy - 0.5) < 0.28] = f
            cell[(cx > 1.1) & (cx < 2.3) & (np.abs(cy - 0.5) < 0.1)] = tex.rgb('#ffffff')
        else:         # tricolour bars
            for i, c in enumerate(['#d8282c', '#2a62d6', '#f6c431']):
                cell[(cx > 0.25 + i * 0.3) & (cx < 0.47 + i * 0.3) & (np.abs(cy - 0.5) < 0.36)] = tex.rgb(c)
            cell[(cx > 1.4) & (cx < 3.7) & (np.abs(cy - 0.5) < 0.16)] = tex.rgb('#1d2b4a')
        # A thin white border keeps panels crisp against each other.
        edge = (cx < 0.03) | (cx > 3.97) | (cy < 0.03) | (cy > 0.97)
        cell[edge] = tex.rgb('#ffffff')
    return np.clip(img, 0, 1)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def ground_material(img):
    """Grain texture x the vertex colour (each ground surface is tinted per face)."""
    m = textured('Ground', img, rough=0.9)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tn = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tn.outputs['Color'], mix.inputs[6])
    nt.links.new(vc.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    return m


def unmix_ground(m):
    """For export: texture straight into Base Color (the vertex colours ride along as COLOR_0)."""
    nt = m.node_tree
    tn = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    nt.links.new(tn.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])


def paint(obj, fn):
    """Fill the 'Color' attribute per face from fn(game_centre) -> hex."""
    me = obj.data
    if 'Color' not in me.color_attributes:
        me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    ca = me.color_attributes['Color']
    cols = np.ones((len(me.loops), 4), np.float32)
    mw = obj.matrix_world
    cache = {}
    for poly in me.polygons:
        c = mw @ poly.center
        h = fn(Vector((c.x, c.z, -c.y)))
        if h not in cache:
            cache[h] = (*blib.hex_rgb(h), 1.0)
        cols[poly.loop_start:poly.loop_start + poly.loop_total] = cache[h]
    ca.data.foreach_set('color', cols.ravel())


def backdrop_material():
    """Unlit scenery with its colours in the 'Color' attribute (sky, hills): emits that colour."""
    m = bpy.data.materials.get('Backdrop')
    if m:
        return m
    m = bpy.data.materials.new('Backdrop')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(vc.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    m['unlit'] = 1
    m['kind'] = 'glow'
    return m


def backdrop_only(obj):
    """Seen by the camera but no light source or shadow in the bake (the sky, the hills)."""
    obj['backdrop'] = 1
    obj.visible_diffuse = False
    obj.visible_glossy = False
    obj.visible_transmission = False
    obj.visible_volume_scatter = False
    obj.visible_shadow = False


# ---------------------------------------------------------------------------
# Ground
# ---------------------------------------------------------------------------

def ring_obj(name, radii, a0, a1, mat, step=0.7, n=None, uv='planar', tile=3.0, y=0.0):
    """A flat annulus sector through the given radii (one object, shared verts).

    uv='planar' maps world x/z (tiling grain); 'track' runs u along the ring
    (`tile` repeats per turn) and v across it from the first radius to the last.
    """
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    n = n or segs_for(radii[-1], a0, a1, step)
    rows, param = [], {}
    for r in radii:
        if r < 1e-4:
            c = bm.verts.new(V(0, F + y, 0))
            param[c] = (0.0, 0.0)
            rows.append([c] * (n + 1))
            continue
        row = []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            v = bm.verts.new(V(*P(r, a, y)))
            param[v] = (r, a)
            row.append(v)
        rows.append(row)
    for j in range(len(radii) - 1):
        for i in range(n):
            quad = [rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]]
            f = bm.faces.new(list(dict.fromkeys(quad)))
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            for loop in f.loops:
                r, a = param[loop.vert]
                if uv == 'planar':
                    co = loop.vert.co
                    loop[uvl].uv = (co.x / tile, co.y / tile)
                else:
                    loop[uvl].uv = ((a + math.pi) / TAU * tile, (r - radii[0]) / (radii[-1] - radii[0]))
    obj = blib.new_mesh_object(name, bm, mat)
    obj['ground'] = 1
    return obj


def sectors(a0, a1, width=math.radians(30)):
    """Split [a0, a1] into pieces no wider than `width` (lightmap islands that pack well)."""
    n = max(1, int(math.ceil((a1 - a0) / width - 1e-6)))
    return [(a0 + (a1 - a0) * k / n, a0 + (a1 - a0) * (k + 1) / n) for k in range(n)]


def in_any(a, spans):
    for s0, s1 in spans:
        aa = a
        while aa < s0:
            aa += TAU
        while aa > s0 + TAU:
            aa -= TAU
        if s0 <= aa <= s1:
            return True
    return False


def complement(spans, a_start=-math.pi):
    """Angular gaps between sorted spans over one turn starting at a_start."""
    norm = sorted(((s0 - a_start) % TAU + a_start, (s0 - a_start) % TAU + a_start + (s1 - s0)) for s0, s1 in spans)
    out, cur = [], a_start
    for s0, s1 in norm:
        if s0 > cur + 1e-4:
            out.append((cur, s0))
        cur = max(cur, s1)
    if cur < a_start + TAU - 1e-4:
        out.append((cur, a_start + TAU))
    return out


def rad(c):
    return math.hypot(c.x, c.z)


def ang(c):
    return math.atan2(c.z, c.x)


def build_ground(objs, gmat, track_mat):
    """Every flat surface, split into sectors so the lightmap can favour the ones in view."""
    def band(name, radii, a0, a1, color_fn, step=0.8, mat=None, uv='planar', tile=3.0, width=math.radians(30), n=None):
        for k, (s0, s1) in enumerate(sectors(a0, a1, width)):
            o = ring_obj(f'{name}{k}', radii, s0, s1, mat or gmat, step=step, n=n, uv=uv, tile=tile)
            if color_fn is not None:
                paint(o, color_fn)
            objs.append(o)

    full = (-math.pi, math.pi)
    # Plaza under the table: concrete, a chequered band of 160 squares, a white rim.
    band('GPlazaIn', [0.0, 4.0, 8.3], *full, lambda c: CONCRETE, step=1.4)

    def plaza(c):
        r = rad(c)
        if 8.95 < r < 9.55:
            k = int(math.floor((ang(c) + math.pi) / (TAU / 160)))
            return '#1c1c1f' if (k + (r > 9.25)) % 2 else '#f3f1ea'
        return '#f3f1ea' if r > 9.6 else CONCRETE
    band('GPlaza', [8.3, 8.95, 9.25, 9.55, 9.65, PLAZA_R], *full, plaza, width=TAU / 16, n=10)
    # A stone edge between the plaza and the grass.
    edge = Batch('PlazaEdge')
    rows, _ = arc_rows([(PLAZA_R, 0.0), (PLAZA_R, 0.1), (PLAZA_R + 0.06, 0.16), (PLAZA_R + 0.25, 0.16), (PLAZA_R + 0.3, 0.1), (PLAZA_R + 0.3, 0.0)],
                       -math.pi, math.pi, 0.6)
    stone = flat('#e9e6df', 0.6)
    edge.strip(rows[0:2], stone, out=inward)
    edge.strip(rows[1:5], stone, out=UP)
    edge.strip(rows[4:6], stone, out=radial)
    objs.append(edge.done())

    # Infield grass, mown in rings.
    g0 = PLAZA_R + 0.3
    w = (INFIELD_R - g0) / 3
    band('GInfield', [g0 + w * k for k in range(4)], *full, lambda c: GRASS_B if int((rad(c) - g0) / w) % 2 else GRASS_A, step=0.7)
    # The track itself (own texture; u along the track repeats 12 times round).
    band('Track', [TRACK_IN, (TRACK_IN + TRACK_OUT) / 2, TRACK_OUT], *full, None, step=0.55, mat=track_mat, uv='track', tile=12)

    # Outside the track: run-off by sector.
    pit0, pit1 = PIT
    exits = [(pit0 - 0.16, pit0), (pit1, pit1 + 0.16)]

    def runoff(c):
        r, a = rad(c), ang(c)
        if in_any(a, exits):
            return ASPHALT
        if r < 19.8:
            return ASPHALT       # a strip of tarmac past the white line (under the kerb by the gravel)
        if r < 21.0:
            # Painted run-off, green with blue blocks.
            k = int(math.floor((a + math.pi) * 21.0 / 1.6))
            return RUNOFF_B if k % 3 == 0 else RUNOFF_A
        if in_any(a, GRAVEL) and r < WALL_R:
            return GRAVEL_C
        return GRASS_A if int((r - 21.0) / 0.9) % 2 else GRASS_B
    for s0, s1 in complement([PIT]):
        band('GRunoff', [TRACK_OUT, 19.8, 21.0, 21.9, 22.8, WALL_R, WALL_R + 0.45], s0, s1, runoff, step=0.7)
    # Pit straight: tarmac to the pit wall and the lane, garage floors, the paddock.
    band('GPitStrip', [TRACK_OUT, PITWALL_R, PITWALL_R + 0.4, PITLANE_R], pit0, pit1,
         lambda c: ASPHALT if rad(c) < PITWALL_R + 0.4 else '#5d6068', step=0.7)
    band('GGarageFloor', [PITLANE_R, GARAGE_BACK], pit0, pit1, lambda c: CONCRETE_DK, step=1.0)
    band('GPaddock', [GARAGE_BACK, APRON_R], pit0, pit1, lambda c: ASPHALT, step=1.2)
    # Outside the barrier: concrete aprons under the stands, grass in the gaps.
    for key, (s0, s1) in STANDS.items():
        band(f'GApron{key}', [WALL_R + 0.45, APRON_R], s0, s1, lambda c: CONCRETE, step=1.2)
    for s0, s1 in complement([PIT] + list(STANDS.values())):
        band('GGap', [WALL_R + 0.45 + 1.2 * k for k in range(9)] + [APRON_R], s0, s1,
             lambda c: GRASS_A if int((rad(c) - WALL_R) / 1.2) % 2 else GRASS_B, step=1.2)
    # The wider grounds: a service road, then fields out to the hills.
    band('GRoad', [APRON_R, APRON_R + 2.6], *full, lambda c: ASPHALT, step=1.4)
    band('GVerge', [APRON_R + 2.6 + 2.4 * k for k in range(6)] + [52.0], *full,
         lambda c: GRASS_FAR if int((rad(c) - APRON_R) / 2.4) % 2 else GRASS_A, step=1.8)
    band('GField', [52.0 + 5.0 * k for k in range(6)] + [FIELD_R], *full,
         lambda c: GRASS_FAR if int((rad(c) - 52.0) / 5.0) % 2 else '#679f43', step=3.0)

# ---------------------------------------------------------------------------
# Kerbs, lines and markings
# ---------------------------------------------------------------------------

def kerb(b, r_in, r_out, a0, a1, track_outward, block=0.95):
    """Red/white rumble blocks with a sawtooth top that catches the light."""
    n = segs_for((r_in + r_out) / 2, a0, a1, block)
    da = (a1 - a0) / n
    w = r_out - r_in
    prof = [(0.0, 0.0), (0.1, 0.06), (0.78, 0.075), (1.0, 0.0)]  # grass side -> track side
    red, white = flat(KERB_RED, 0.5), flat(KERB_WHITE, 0.5)
    for k in range(n):
        mat = red if k % 2 else white
        sa, ea = a0 + k * da, a0 + (k + 1) * da
        rows = []
        for t, h in prof:
            r = r_in + t * w if track_outward else r_out - t * w
            lift = 0.03 if 0 < t < 1 else 0.0
            rows.append([P(r, sa, h), P(r, ea, h + lift)])
        b.strip(rows, mat, out=UP)
        # The step at the end of the block (only across the raised middle).
        mid = prof[1:3]
        top = [P(r_in + t * w if track_outward else r_out - t * w, ea, h + 0.03) for t, h in mid]
        low = [P(r_in + t * w if track_outward else r_out - t * w, ea, h) for t, h in mid]
        b.strip([low, top], mat, out=(-math.sin(ea), 0, math.cos(ea)))


def build_kerbs(objs):
    b = Batch('Kerbs')
    kerb(b, INFIELD_R, TRACK_IN, -math.pi, math.pi, True)
    for g0, g1 in GRAVEL:
        kerb(b, TRACK_OUT, TRACK_OUT + 0.7, g0 - 0.06, g1 + 0.06, False)
    objs.append(b.done())


def build_markings(objs, decal_mat):
    """Start line chequers, grid slots, pit lane lines and pit boxes."""
    paint_w = flat('#f4f3ee', 0.5)
    yellow = flat('#f2c230', 0.5)
    b = Batch('Markings')
    d = Batch('DecalLines')
    y = 0.012
    # Chequered start/finish line across the track.
    half = 0.36 / 16.2
    u0, v0, u1, v1 = DECAL_CHEQUER
    d.quad([P(TRACK_IN + 0.15, START_A - half, y), P(TRACK_OUT - 0.15, START_A - half, y),
            P(TRACK_OUT - 0.15, START_A + half, y), P(TRACK_IN + 0.15, START_A + half, y)], decal_mat, out=UP,
           uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    # Grid slots behind the line (cars race toward increasing angle): staggered white brackets.
    for k in range(6):
        r = 15.0 if k % 2 == 0 else 17.4
        a = START_A - (1.4 + k * 2.5) / r
        da = 0.06 / r
        b.quad([P(r - 0.9, a - da, y), P(r + 0.9, a - da, y), P(r + 0.9, a + da, y), P(r - 0.9, a + da, y)], paint_w, out=UP)
        for s in (-1, 1):
            rr = r + s * 0.86
            b.quad([P(rr - 0.05, a, y), P(rr + 0.05, a, y), P(rr + 0.05, a - 0.75 / r, y), P(rr - 0.05, a - 0.75 / r, y)], paint_w, out=UP)
    # Pit lane: fast-lane line and a yellow box in front of each garage.
    pit0, pit1 = PIT
    rows, n = arc_rows([(22.35, y), (22.5, y)], pit0, pit1, 0.8)
    b.strip(rows, paint_w, out=UP)
    rows, n = arc_rows([(20.95, y), (21.07, y)], pit0, pit1, 0.8)
    b.strip(rows, flat('#f2c230', 0.5), out=UP)
    ng = 14
    for k in range(ng):
        a = pit0 + (k + 0.5) * (pit1 - pit0) / ng
        half_a = 1.15 / 23.5
        for (ra, rb, aa, ab) in [(22.8, 24.4, a - half_a, a - half_a + 0.08 / 23.5), (22.8, 24.4, a + half_a - 0.08 / 23.5, a + half_a),
                                 (22.8, 22.9, a - half_a, a + half_a)]:
            b.quad([P(ra, aa, y), P(rb, aa, y), P(rb, ab, y), P(ra, ab, y)], yellow, out=UP)
    objs.append(b.done())
    objs.append(d.done())


# ---------------------------------------------------------------------------
# Barriers: walls with sponsor boards, catch fencing, tyre walls
# ---------------------------------------------------------------------------

def wall_arc(b, r, a0, a1, face_in=True, h=0.95, t=0.4, mat=None):
    """A concrete barrier along an arc, its inner face at r."""
    mat = mat or flat('#e7e4dc', 0.7)
    cap = flat(KERB_RED, 0.55)
    rows, n = arc_rows([(r, 0.0), (r, h - 0.08), (r + 0.06, h), (r + t - 0.06, h), (r + t, h - 0.08), (r + t, 0.0)], a0, a1, 0.9, r)
    b.strip(rows[0:2], mat, out=inward)
    b.strip(rows[1:5], lambda i, j: cap if (i // 2) % 2 == 0 else flat(WHITE, 0.6), out=UP)
    b.strip(rows[4:6], mat, out=radial)
    # End caps.
    for a, s in ((a0, -1), (a1, 1)):
        prof = [P(rr, a, yy) for rr, yy in [(r, 0.0), (r, h - 0.08), (r + 0.06, h), (r + t - 0.06, h), (r + t, h - 0.08), (r + t, 0.0)]]
        tang = Vector((-math.sin(a), 0, math.cos(a))) * s
        vs = [b.bm.verts.new(V(*p)) for p in prof]
        f = b.bm.faces.new(vs)
        f.material_index = b.slot(mat)
        f.normal_update()
        if game_normal(f.normal).dot(tang) < 0:
            f.normal_flip()


def boards(d, r, a0, a1, y0=0.12, h=0.7, w=3.2, gap=0.35, seed=0, face=1):
    """Sponsor panels standing just inside radius r, facing the table (face=1) or outward (-1)."""
    n = int(abs(a1 - a0) * r // (w + gap))
    if n < 1:
        return
    span = n * (w + gap)
    start = (a0 + a1) / 2 - span / r / 2
    for k in range(n):
        sa = start + (k * (w + gap) + gap / 2) / r
        ea = sa + w / r
        u0, v0, u1, v1 = decal_panel(seed + k)
        rr = r - 0.02 * face
        pts = [P(rr, sa, y0), P(rr, ea, y0), P(rr, ea, y0 + h), P(rr, sa, y0 + h)]
        uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        if face < 0:
            uvs = [(u1, v0), (u0, v0), (u0, v1), (u1, v1)]
        d.quad(pts, d.mats[0] if d.mats else None, out=inward if face > 0 else radial, uvs=uvs)


def fence(b, r, a0, a1, base_h, height=3.0, spacing=2.6, lean_in=True):
    """Catch fencing on a wall: posts with an inward-cranked top and a few cables."""
    post = flat(STEEL, 0.4)
    wire = flat('#6d737b', 0.5)
    n = max(1, int(round(abs(a1 - a0) * r / spacing)))
    pts = []
    crank = 0.6
    for k in range(n + 1):
        a = a0 + (a1 - a0) * k / n
        pts.append(a)
        b.box(P(r, a, base_h), (0.09, height, 0.09), post, yaw=yaw_at(a), bottom=True, drop_bottom=False)
        # Cranked top leaning toward the track.
        if lean_in:
            b.beam(P(r, a, base_h + height - 0.04), P(r - 0.4, a, base_h + height + crank), 0.08, post)
    # Cables: thin ribbons (front and back) chord to chord between posts, following the crank at the top.
    levels = [0.3 + k * (height + crank - 0.35) / 4 for k in range(5)]
    for lv in levels:
        y = base_h + lv
        rr = r - (0.4 * max(0.0, lv - height) / crank if lean_in else 0)
        b.strip([[P(rr, a, y - 0.025) for a in pts], [P(rr, a, y + 0.025) for a in pts]], wire, out=inward)
        b.strip([[P(rr + 0.03, a, y - 0.025) for a in pts], [P(rr + 0.03, a, y + 0.025) for a in pts]], wire, out=radial)


def tyre_stack(b, c, n=3, mats=None, segs=9):
    """A stack of n tyres (the top one painted), each a bulge pinched in at the joins."""
    prof = []
    for k in range(n):
        y0 = k * 0.3
        prof += [(0.29, y0 + 0.0), (0.345, y0 + 0.15)]
    prof += [(0.29, n * 0.3), (0.17, n * 0.3), (0.17, n * 0.3 - 0.12), (0.0, n * 0.3 - 0.12)]
    tyre = mats[0] if mats else flat(TYRE, 0.85)
    paintm = mats[1] if mats and len(mats) > 1 else tyre
    # Split: lower tyres black, top tyre painted.
    lower = prof[:2 * (n - 1) + 1]
    upper = prof[2 * (n - 1):]
    b.lathe(c, lower, tyre, segs=segs, cap_top=False)
    b.lathe(c, upper, paintm, segs=segs, cap_top=False)


def build_barriers(objs, decal_mat):
    walls = Batch('Walls')
    fen = Batch('Fence')
    tyres = Batch('Tyres')
    dec = Batch('Boards')
    dec.slot(decal_mat)
    pit0, pit1 = PIT
    # Main wall round the run-off, open where the pit lane leaves and rejoins.
    a_start, a_end = pit1 + 0.02, pit0 + TAU - 0.02
    for s0, s1 in sectors(a_start, a_end, math.radians(40)):
        wall_arc(walls, WALL_R, s0, s1)
        boards(dec, WALL_R, s0, s1, seed=int(s0 * 10) % 6)
        fence(fen, WALL_R + 0.2, s0, s1, 0.95)
    # Short walls closing the lane's far side at each end of the garages.
    for a in (pit0, pit1):
        walls.box(P((WALL_R + PITLANE_R) / 2 + 0.2, a, 0.0), (0.4, 0.95, PITLANE_R - WALL_R + 0.4), flat('#e7e4dc', 0.7), yaw=yaw_at(a), bottom=True)
    # Pit wall between the track and the lane, with boards facing the track.
    for s0, s1 in sectors(pit0 + 0.03, pit1 - 0.03, math.radians(40)):
        wall_arc(walls, PITWALL_R, s0, s1, h=1.0)
        boards(dec, PITWALL_R, s0, s1, seed=3 + int(s0 * 10) % 6)
        fence(fen, PITWALL_R + 0.2, s0, s1, 1.0, height=2.6)
    # Yellow and black impact cushions on the ends of the pit wall.
    for a in (pit0 + 0.03, pit1 - 0.03):
        s = -1 if a < -1.6 else 1
        for k in range(3):
            aa = a - s * (0.3 + k * 0.55) / PITWALL_R
            walls.box(P(PITWALL_R + 0.2, aa, 0.0), (0.5, 0.85, 0.75), flat('#f2c230' if k % 2 == 0 else '#1c1c1f', 0.6),
                      yaw=yaw_at(aa), bottom=True)
    # Tyre walls in front of the barrier behind each gravel trap, top tyres painted red/white.
    tyre = flat(TYRE, 0.85)
    for g0, g1 in GRAVEL:
        n = int((g1 - g0) * (WALL_R - 0.4) / 0.7)
        for k in range(n):
            a = g0 + (g1 - g0) * (k + 0.5) / n
            top = flat(KERB_RED if k % 2 else KERB_WHITE, 0.6)
            tyre_stack(tyres, P(WALL_R - 0.38, a), 3, [tyre, top])
    # Little tyre bundles round the gantry's infield leg and at the lane exits.
    for a, r in [(START_A - 0.06, 12.35), (START_A + 0.06, 12.35), (START_A, 11.85)]:
        tyre_stack(tyres, P(r, a), 2, [tyre, flat(KERB_WHITE, 0.6)])
    objs += [walls.done(), fen.done(), tyres.done(smooth=False), dec.done()]


# ---------------------------------------------------------------------------
# Start/finish gantry
# ---------------------------------------------------------------------------

def build_gantry(objs, decal_mat):
    a = START_A
    r_in, r_out = 12.35, PITWALL_R + 0.2
    span = r_out - r_in
    mid = (r_in + r_out) / 2
    g = blib.empty('Gantry', P(mid, a), yaw_at(a) + math.pi / 2)  # local x runs outward across the track
    white = flat('#eeeeea', 0.45)
    red = flat(KERB_RED, 0.45)
    dark = flat('#24262b', 0.5)
    parts = []
    beam_y0, beam_h = 4.3, 1.15
    for s, name in ((-1, 'In'), (1, 'Out')):
        x = s * span / 2
        parts.append(box(f'GantryLeg{name}', (0.62, beam_y0 + beam_h, 0.62), (x, (beam_y0 + beam_h) / 2, 0), white, bevel=0.1))
        parts.append(box(f'GantryLegBand{name}', (0.66, 0.5, 0.66), (x, 1.2, 0), red, bevel=0.06))
        parts.append(box(f'GantryFoot{name}', (1.1, 0.35, 1.1), (x, 0.17, 0), flat(CONCRETE_DK, 0.7), bevel=0.06))
    parts.append(box('GantryBeam', (span + 0.9, beam_h, 0.7), (0, beam_y0 + beam_h / 2, 0), white, bevel=0.1))
    parts.append(box('GantryCap', (span + 1.1, 0.18, 0.86), (0, beam_y0 + beam_h + 0.09, 0), red, bevel=0.05))
    # Start lights hanging over the middle of the track, facing the grid (local -z = toward smaller angles).
    lx = (TRACK_IN + TRACK_OUT) / 2 - mid
    parts.append(box('StartLightBox', (3.4, 0.75, 0.42), (lx, beam_y0 - 0.42, -0.1), dark, bevel=0.08))
    for k in range(5):
        for j in range(2):
            disc = cylinder(f'StartLamp{k}{j}', 0.13, 0.08, (0, 0, 0), glow('#ff2a1f', 6.0, 'StartLamp'), segs=12)
            disc.rotation_euler = (math.pi / 2, 0, 0)
            disc.location = V(lx - 1.36 + k * 0.68, beam_y0 - 0.25 - j * 0.32, -0.33)
            parts.append(disc)
    for p in parts:
        p.parent = g
    objs.extend(parts)
    objs.append(g)
    # Chequered banners on both faces of the beam.
    d = Batch('GantryBanner')
    u0, v0, u1, v1 = DECAL_CHEQUER
    for s in (-1, 1):
        rr0, rr1 = r_in + 0.3, r_out - 0.3
        off = s * 0.36
        # Points across the track at the beam's faces (offset along the tangent).
        def at(r, y):
            x, yy, z = P(r, a, y)
            return (x - math.sin(a) * off, yy, z + math.cos(a) * off)
        pts = [at(rr0, beam_y0 + 0.12), at(rr1, beam_y0 + 0.12), at(rr1, beam_y0 + beam_h - 0.12), at(rr0, beam_y0 + beam_h - 0.12)]
        tang = Vector((-math.sin(a), 0, math.cos(a))) * s
        d.quad(pts, decal_mat, out=tang, uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    objs.append(d.done())


# ---------------------------------------------------------------------------
# Pit building, pit wall stands, race control
# ---------------------------------------------------------------------------

def build_pits(objs, decal_mat):
    pit0, pit1 = PIT
    b = Batch('PitBuilding')
    lights = Batch('PitGlow')   # glowing parts stay out of the baked meshes
    bits = Batch('PitBits')     # pillars, mullions, tool chests: one lightmap square per few
    d = Batch('PitBoards')
    d.slot(decal_mat)
    glass_warm = glow('#ffe3b0', 1.6, 'GarageLight')
    window = glow('#ffd79a', 1.1, 'HospitalityWindow')
    white = flat('#ecebe6', 0.6)
    grey = flat('#b9b6ae', 0.7)
    dark = flat('#3a3d44', 0.6)
    ng = 14
    da = (pit1 - pit0) / ng
    rf, rb = PITLANE_R, GARAGE_BACK
    H1, H2 = 3.6, 6.8
    for k in range(ng):
        a0, a1 = pit0 + k * da, pit0 + (k + 1) * da
        am = (a0 + a1) / 2
        team = flat(TEAM[k % len(TEAM)], 0.5)
        # Pillar on the left of each bay (and one closing the row).
        for a in ([a0, a1] if k == ng - 1 else [a0]):
            bits.box(P(rf + 0.2, a, 0.0), (0.42, H1, 0.55), white, yaw=yaw_at(a), bottom=True)
        # Lintel above the door, the team's colour.
        rows, _ = arc_rows([(rf, 2.75), (rf, H1)], a0, a1, 1.0, rf)
        b.strip(rows, team, out=inward)
        # Half-raised door.
        rows, _ = arc_rows([(rf + 0.35, 1.95), (rf + 0.35, 2.75)], a0 + 0.2 / rf, a1 - 0.2 / rf, 1.0, rf)
        b.strip(rows, flat('#dcdad4', 0.5), out=inward)
        # The lit interior: back wall glows, side walls and ceiling catch it.
        rows, _ = arc_rows([(rb - 0.3, 0.0), (rb - 0.3, 2.75)], a0, a1, 1.0, rb)
        lights.strip(rows, glass_warm, out=inward)
        for a, s in ((a0 + 0.21 / rf, 1), (a1 - 0.21 / rf, -1)):
            b.quad([P(rf + 0.3, a, 0.0), P(rb - 0.3, a, 0.0), P(rb - 0.3, a, 2.75), P(rf + 0.3, a, 2.75)], grey,
                   out=(-math.sin(a) * s, 0, math.cos(a) * s))
        rows, _ = arc_rows([(rf + 0.3, 2.75), (rb - 0.3, 2.75)], a0, a1, 1.0, rb)
        b.strip(rows, grey, out=(0, -1, 0))
        # A tool chest and a spare-wheel rack inside, in team colours.
        bits.box(P(rb - 0.9, a0 + 0.7 / rf, 0.0), (0.9, 1.0, 0.55), team, yaw=yaw_at(am), bottom=True)
        bits.box(P(rb - 0.75, a1 - 0.8 / rf, 0.0), (0.8, 1.6, 0.4), dark, yaw=yaw_at(am), bottom=True)
        # First floor: glazed hospitality band set back from the facade, mullions.
        rows, _ = arc_rows([(rf + 0.9, H1 + 0.25), (rf + 0.9, H2 - 0.45)], a0, a1, 1.0, rf)
        lights.strip(rows, window, out=inward)
        bits.box(P(rf + 0.85, a0, H1 + 0.25), (0.14, H2 - H1 - 0.7, 0.2), white, yaw=yaw_at(a0), bottom=True, drop_bottom=False)
        bits.box(P(rf + 0.85, am, H1 + 0.25), (0.1, H2 - H1 - 0.7, 0.16), white, yaw=yaw_at(am), bottom=True, drop_bottom=False)
        # A board on the facade over every other bay.
        if k % 2 == 0:
            u0, v0, u1, v1 = decal_panel(k // 2)
            pa, pb = am - 1.3 / rf, am + 1.3 / rf
            d.quad([P(rf - 0.03, pa, 2.82), P(rf - 0.03, pb, 2.82), P(rf - 0.03, pb, 3.47), P(rf - 0.03, pa, 3.47)],
                   decal_mat, out=inward, uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    # Slabs: first-floor slab with a balcony edge, roof with a deep overhang, back and end walls.
    for r0, r1, y0, y1, mat in [(rf - 0.2, rb, H1, H1 + 0.25, white), (rf - 0.9, rb + 0.2, H2 - 0.45, H2 - 0.1, white)]:
        rows, _ = arc_rows([(r0, y0), (r0, y1), (r1, y1)], pit0, pit1, 1.2, r1)
        b.strip(rows[0:2], mat, out=inward)
        b.strip(rows[1:3], mat, out=UP)
        rows, _ = arc_rows([(r0, y0), (r1, y0)], pit0, pit1, 1.2, r1)
        b.strip(rows, grey, out=(0, -1, 0))
    # Balcony rail.
    rows, _ = arc_rows([(rf - 0.12, H1 + 0.25), (rf - 0.12, H1 + 1.15)], pit0, pit1, 1.2, rf)
    b.strip(rows, flat('#9fc6e6', 0.2), out=inward)
    rows, _ = arc_rows([(rb + 0.2, 0.0), (rb + 0.2, H2 - 0.1)], pit0, pit1, 1.2, rb)
    b.strip(rows, grey, out=radial)
    for a, s in ((pit0, -1), (pit1, 1)):
        tang = Vector((-math.sin(a), 0, math.cos(a))) * s
        b.quad([P(rf - 0.2, a, 0.0), P(rb + 0.2, a, 0.0), P(rb + 0.2, a, H2 - 0.1), P(rf - 0.2, a, H2 - 0.1)], white, out=tang)
    # Roof parapet in red.
    rows, _ = arc_rows([(rf - 0.9, H2 - 0.1), (rf - 0.9, H2 + 0.35), (rf - 0.6, H2 + 0.35), (rf - 0.6, H2 - 0.1)], pit0, pit1, 1.2, rf)
    b.strip(rows[0:2], flat(KERB_RED, 0.5), out=inward)
    b.strip(rows[1:3], flat(KERB_RED, 0.5), out=UP)
    b.strip(rows[2:4], flat(KERB_RED, 0.5), out=radial)
    objs += [b.done(), bits.done(), lights.done(), d.done()]

    # Pit-wall stands for the teams: a desk, posts, a little roof and screens.
    for k, a in enumerate([pit0 + 0.25, pit0 + 0.62, pit0 + 1.0, pit0 + 1.38]):
        g = blib.empty(f'PitStand{k}', P(PITWALL_R + 0.95, a), yaw_at(a))
        team = flat(TEAM[k], 0.5)
        parts = [
            box(f'PitStandDesk{k}', (2.2, 1.0, 0.7), (0, 0.5, 0), flat('#2c2f36', 0.6), bevel=0.05),
            box(f'PitStandRoof{k}', (2.6, 0.14, 1.3), (0, 2.45, 0.1), team, bevel=0.04),
            box(f'PitStandPost{k}a', (0.1, 1.5, 0.1), (-1.1, 1.75, -0.3), flat(STEEL, 0.4)),
            box(f'PitStandPost{k}b', (0.1, 1.5, 0.1), (1.1, 1.75, -0.3), flat(STEEL, 0.4)),
        ]
        for j in range(3):
            parts.append(box(f'PitStandScreen{k}{j}', (0.5, 0.34, 0.04), (-0.65 + j * 0.65, 1.32, 0.12), glow('#7fc4ff', 1.0, 'Screen')))
        for p in parts:
            p.parent = g
        objs += parts + [g]

    # Race control: a round tower behind the start line with a glazed cab.
    a = START_A - 0.05
    c = P(GARAGE_BACK + 2.4, a)
    objs.append(lathe('ControlShaft', [(0, 0), (1.5, 0), (1.5, 9.0), (1.2, 9.4), (0, 9.4)], 24, c, flat('#ecebe6', 0.6)))
    objs.append(lathe('ControlCabBase', [(0, 9.3), (2.6, 9.3), (2.9, 9.8), (0, 9.8)], 32, c, flat(KERB_RED, 0.5)))
    objs.append(lathe('ControlGlass', [(2.75, 9.8), (3.0, 11.6)], 32, c, glow('#ffd79a', 1.1, 'HospitalityWindow'), cap_top=False, cap_bottom=False))
    objs.append(lathe('ControlRoof', [(0, 11.5), (3.4, 11.5), (3.3, 11.9), (1.0, 12.3), (0, 12.3)], 32, c, flat('#ecebe6', 0.5)))
    objs.append(cylinder('ControlMast', 0.08, 2.6, (c[0], c[1] + 12.3, c[2]), flat(STEEL, 0.4), segs=6))
    objs.append(sphere('ControlBeacon', 0.16, (c[0], c[1] + 15.0, c[2]), glow('#ff3b2f', 4.0, 'Beacon'), segs=8, rings=6))

    # Team trucks in the paddock behind the garages.
    for k, a in enumerate([pit0 + 0.3, pit0 + 0.7, pit0 + 1.1, pit0 + 1.5]):
        g = blib.empty(f'Truck{k}', P(33.4, a), yaw_at(a))
        team = flat(TEAM[(k + 2) % len(TEAM)], 0.45)
        parts = [
            box(f'TruckTrailer{k}', (7.4, 2.1, 1.5), (-0.8, 1.35, 0), team, bevel=0.1),
            box(f'TruckStripe{k}', (7.42, 0.3, 1.52), (-0.8, 1.0, 0), flat(WHITE, 0.5), bevel=0.04),
            box(f'TruckCab{k}', (1.6, 1.9, 1.5), (3.8, 1.25, 0), flat(WHITE, 0.4), bevel=0.2),
            box(f'TruckWindscreen{k}', (0.05, 0.6, 1.2), (4.6, 1.75, 0), flat('#2a3442', 0.2)),
        ]
        for x in (-3.6, -2.8, 2.0, 3.9):
            for s in (-1, 1):
                w = cylinder(f'TruckWheel{k}{x}{s}', 0.36, 0.3, (0, 0, 0), flat(TYRE, 0.8), segs=12)
                w.rotation_euler = (math.pi / 2, 0, 0)
                w.location = V(x, 0.36, s * 0.75 - 0.15)
                parts.append(w)
        for p in parts:
            p.parent = g
        objs += parts + [g]


# ---------------------------------------------------------------------------
# Grandstands with a crowd
# ---------------------------------------------------------------------------

def grandstand(objs, key, a0, a1, decal_mat, seat_cols, roof_col, rows=8, seed=0):
    r_rng = np.random.default_rng(100 + seed)
    r0 = WALL_R + 1.1
    depth, rise, base = 0.82, 0.46, 0.75
    b = Batch(f'Stand{key}')
    crowd = Batch(f'Crowd{key}')
    concrete = flat('#d6d2c8', 0.75)
    riser = flat('#b8b4ab', 0.75)
    step = 1.1
    # Front wall with boards, treads and risers, back wall, ends.
    rows_ = [(r0, 0.0), (r0, base)]
    for i in range(rows):
        ri = r0 + i * depth
        hi = base + i * rise
        rows_ += [(ri + depth, hi)] if i == rows - 1 else [(ri + depth, hi), (ri + depth, hi + rise)]
    r_end = r0 + rows * depth
    h_top = base + (rows - 1) * rise
    rows_ += [(r_end, h_top + 1.3), (r_end + 0.3, h_top + 1.3), (r_end + 0.3, 0.0)]
    pts, n = arc_rows(rows_, a0, a1, step, r_end)
    for j in range(len(pts) - 1):
        (ra, ya), (rb_, yb) = rows_[j], rows_[j + 1]
        if abs(ya - yb) < 1e-6:
            b.strip(pts[j:j + 2], concrete, out=UP)
        elif rb_ > ra + 0.2:   # the back wall's top
            b.strip(pts[j:j + 2], concrete, out=UP)
        else:
            out = radial if (j == len(pts) - 2) else inward
            b.strip(pts[j:j + 2], riser if out is inward and j > 0 else concrete, out=out)
    # End walls (stepped outline) as one polygon each.
    for a, s in ((a0, -1), (a1, 1)):
        outline = [P(r, a, y) for r, y in rows_]
        vs = [b.bm.verts.new(V(*p)) for p in outline]
        f = b.bm.faces.new(vs)
        f.material_index = b.slot(concrete)
        f.normal_update()
        if game_normal(f.normal).dot(Vector((-math.sin(a), 0, math.cos(a))) * s) < 0:
            f.normal_flip()
    # Seats: an L-shaped bench per row in sections, with aisles between.
    sec_len = 6.4
    for i in range(rows):
        ri = r0 + i * depth
        hi = base + i * rise
        rm = ri + 0.45
        nsec = max(1, int((a1 - a0) * rm / sec_len))
        for sidx in range(nsec):
            sa = a0 + (a1 - a0) * sidx / nsec + 0.45 / rm
            ea = a0 + (a1 - a0) * (sidx + 1) / nsec - 0.45 / rm
            col = flat(seat_cols[(sidx + (i // 3)) % len(seat_cols)], 0.45)
            prof = [(ri + 0.12, hi), (ri + 0.12, hi + 0.2), (ri + 0.5, hi + 0.22), (ri + 0.56, hi + 0.5), (ri + 0.64, hi + 0.5), (ri + 0.64, hi)]
            p2, _ = arc_rows(prof, sa, ea, step, rm)
            crowd.strip(p2[0:2], col, out=inward)
            crowd.strip(p2[1:3], col, out=UP)
            crowd.strip(p2[2:4], col, out=inward)
            crowd.strip(p2[3:5], col, out=UP)
            crowd.strip(p2[4:6], col, out=radial)
            # The crowd: about half the seats taken, a few standing up and cheering.
            nseat = int((ea - sa) * rm / 0.56)
            for q in range(nseat):
                if r_rng.random() > 0.52:
                    continue
                a = sa + (ea - sa) * (q + 0.5) / nseat + r_rng.normal(0, 0.03) / rm
                stand = r_rng.random() < 0.18
                shirt = flat(SHIRTS[int(r_rng.random() * len(SHIRTS))], 0.7)
                skin = flat(SKIN[int(r_rng.random() * len(SKIN))], 0.6)
                rr = ri + (0.36 if not stand else 0.28)
                y0 = hi + (0.2 if not stand else 0.0)
                bh = 0.42 if not stand else 0.72
                crowd.box(P(rr, a, y0), (0.3, bh, 0.22), shirt, yaw=yaw_at(a), bottom=True)
                crowd.ico(P(rr, a, y0 + bh + 0.13), 0.13, skin, subdiv=1)
                if stand and r_rng.random() < 0.6:
                    # Arms up.
                    for s in (-1, 1):
                        tx = -math.sin(a) * 0.17 * s
                        tz = math.cos(a) * 0.17 * s
                        x, y, z = P(rr, a, y0 + bh + 0.1)
                        crowd.box((x + tx, y, z + tz), (0.07, 0.36, 0.07), shirt, yaw=yaw_at(a), bottom=True, drop_bottom=False)
    # Roof: a cantilever over the upper rows from columns behind the top row, striped
    # white and the stand's colour on top, a coloured fascia (the front rows stay open to the sky).
    y_f, y_b = h_top + 3.6, h_top + 2.7
    rf_, rb_ = r0 + depth * 2.6, r_end + 0.7
    white = flat('#f1f0ec', 0.5)
    stripe = flat(mix_hex(roof_col, '#ffffff', 0.25), 0.5)
    under = flat('#c9c7c1', 0.7)
    fascia = flat(roof_col, 0.45)
    pts, n = arc_rows([(rf_, y_f - 0.45), (rf_, y_f), (rb_, y_b), (rb_, y_b - 0.3), (rf_, y_f - 0.45)], a0 - 0.01, a1 + 0.01, 1.4, rb_)
    b.strip(pts[0:2], fascia, out=inward)
    b.strip(pts[1:3], lambda i, j: stripe if (i // 2) % 2 else white, out=UP)
    b.strip(pts[2:4], white, out=radial)
    b.strip(pts[3:5], under, out=(0, -1, 0))
    ncol = max(2, int((a1 - a0) * r_end / 7.0) + 1)
    for k in range(ncol):
        a = a0 + (a1 - a0) * k / (ncol - 1)
        b.box(P(r_end + 0.45, a, 0.0), (0.4, y_b - 0.3, 0.4), flat(STEEL, 0.4), yaw=yaw_at(a), bottom=True)
        # A raking strut up to the middle of the roof.
        t = 0.45
        b.beam(P(r_end + 0.45, a, y_b - 1.8), P(rf_ + (rb_ - rf_) * t, a, y_f + (y_b - y_f) * t - 0.3), 0.18, flat(STEEL, 0.4))
    objs += [b.done(), crowd.done()]
    # Boards along the front wall.
    d = Batch(f'StandBoards{key}')
    d.slot(decal_mat)
    boards(d, r0, a0 + 0.02, a1 - 0.02, y0=0.04, h=0.62, w=2.5, gap=0.2, seed=seed)
    objs.append(d.done())


# ---------------------------------------------------------------------------
# Floodlight towers
# ---------------------------------------------------------------------------

TOWER_R = 27.2
TOWER_H = 18.0


def build_towers(objs):
    heads = []
    for k, a in enumerate(TOWERS):
        r = TOWER_R if not (PIT[0] <= a <= PIT[1]) else GARAGE_BACK + 2.2
        c = P(r, a)
        objs.append(lathe(f'TowerBase{k}', [(0, 0), (1.1, 0), (1.1, 0.5), (0.8, 0.7), (0, 0.7)], 12, c, flat(CONCRETE_DK, 0.7)))
        objs.append(lathe(f'TowerMast{k}', [(0, 0.6), (0.5, 0.6), (0.26, TOWER_H), (0, TOWER_H)], 10, c, flat(STEEL, 0.4)))
        # The head: a tilted frame of lamps facing the table.
        hp = (c[0], c[1] + TOWER_H + 0.9, c[2])
        g = blib.empty(f'TowerHead{k}', hp, yaw_at(a))
        g.rotation_euler = (math.radians(28), 0, yaw_at(a))
        parts = [box(f'TowerFrame{k}', (4.2, 2.6, 0.35), (0, 0, -0.15), flat(STEEL_DK, 0.5), bevel=0.06),
                 box(f'TowerCatwalk{k}', (4.4, 0.08, 0.8), (0, -1.4, 0.2), flat(STEEL, 0.4))]
        for i in range(4):
            for j in range(3):
                x, y = -1.5 + i * 1.0, -0.8 + j * 0.8
                parts.append(box(f'TowerLampHousing{k}{i}{j}', (0.8, 0.66, 0.3), (x, y, 0.15), flat('#30343b', 0.4)))
                parts.append(box(f'TowerLamp{k}{i}{j}', (0.64, 0.5, 0.04), (x, y, 0.31), glow('#fff6dc', 8.0, 'Floodlamp')))
        for p in parts:
            p.parent = g
        objs += parts + [g]
        # Where its light goes: the near side of the track and the infield.
        heads.append((hp, P(6.0, a, 0.0)))
    return heads


# ---------------------------------------------------------------------------
# Cars
# ---------------------------------------------------------------------------

def race_car(objs, name, r, a, color, number_col='#ffffff'):
    """A chunky toy single-seater, nose toward increasing angle."""
    g = blib.empty(name, P(r, a), yaw_at(a))
    g.scale = (0.85, 0.85, 0.85)
    body = flat(color, 0.35)
    trim = flat(number_col, 0.4)
    carbon = flat('#22242a', 0.5)
    parts = [
        box(f'{name}Tub', (1.9, 0.36, 0.62), (0.0, 0.42, 0), body, bevel=0.14, segments=3),
        box(f'{name}Sidepods', (1.0, 0.3, 1.04), (-0.25, 0.36, 0), body, bevel=0.13, segments=3),
        box(f'{name}Engine', (0.9, 0.34, 0.46), (-0.55, 0.7, 0), body, bevel=0.14, segments=3),
        box(f'{name}Stripe', (1.92, 0.06, 0.2), (0.0, 0.61, 0), trim, bevel=0.02),
        box(f'{name}FrontWing', (0.36, 0.06, 1.5), (1.42, 0.2, 0), carbon, bevel=0.02),
        box(f'{name}WingPlateL', (0.4, 0.22, 0.04), (1.42, 0.28, -0.74), body, bevel=0.015),
        box(f'{name}WingPlateR', (0.4, 0.22, 0.04), (1.42, 0.28, 0.74), body, bevel=0.015),
        box(f'{name}RearWing', (0.32, 0.34, 1.16), (-1.15, 0.92, 0), body, bevel=0.04),
        box(f'{name}RearPylon', (0.2, 0.4, 0.1), (-1.05, 0.62, 0), carbon),
        box(f'{name}Cockpit', (0.5, 0.1, 0.36), (0.1, 0.62, 0), carbon, bevel=0.04),
    ]
    nose = cylinder(f'{name}Nose', 0.22, 0.85, (0, 0, 0), body, segs=10, r_top=0.11)
    nose.rotation_euler = (0, math.pi / 2, 0)  # along local +x
    nose.location = V(0.7, 0.38, 0)
    parts.append(nose)
    parts.append(sphere(f'{name}Helmet', 0.16, (0.0, 0.76, 0), flat('#f2c230' if color != '#f2c230' else '#2a62d6', 0.3), segs=12, rings=8))
    for x, rr, wid in ((0.95, 0.27, 0.26), (-0.85, 0.32, 0.34)):
        for s in (-1, 1):
            # Cylinders run along local +z from their location once turned: centre them on the axle.
            zc = s * 0.68
            w = cylinder(f'{name}Wheel{x}{s}', rr, wid, (0, 0, 0), flat(TYRE, 0.8), segs=14, bevel=0.04)
            w.rotation_euler = (math.pi / 2, 0, 0)
            w.location = V(x, rr, zc - wid / 2)
            parts.append(w)
            hub = cylinder(f'{name}Hub{x}{s}', rr * 0.5, 0.03, (0, 0, 0), flat('#c9ccd2', 0.3), segs=12)
            hub.rotation_euler = (math.pi / 2, 0, 0)
            hub.location = V(x, rr, zc + s * wid / 2 - (0.0 if s > 0 else 0.03))
            parts.append(hub)
    for p in parts:
        p.parent = g
    objs.extend(parts)
    objs.append(g)


def build_cars(objs):
    # Two cars on the grid (the slots behind the line), two in the pit lane.
    for k, col in enumerate(['#d8282c', '#2a62d6']):
        rr = 15.0 if k % 2 == 0 else 17.4
        race_car(objs, f'GridCar{k}', rr, START_A - (1.4 + k * 2.5 + 1.35) / rr, col)
    for k, (i, col) in enumerate([(4, '#f2c230'), (9, '#1e9b57')]):
        a = PIT[0] + (i + 0.5) * (PIT[1] - PIT[0]) / 14
        race_car(objs, f'PitCar{k}', 23.55, a, col)


# ---------------------------------------------------------------------------
# Infield: winners' podium and a TV camera platform
# ---------------------------------------------------------------------------

def build_infield(objs, decal_mat):
    r = (PLAZA_R + INFIELD_R) / 2 + 0.15
    # Podium on the left, facing the table.
    a = 2.78
    g = blib.empty('Podium', P(r, a), yaw_at(a))
    white = flat('#f3f1ea', 0.5)
    parts = []
    for x, h, top in ((0.0, 0.95, '#e8b931'), (-1.05, 0.65, '#c7ccd4'), (1.05, 0.45, '#c9824a')):
        parts.append(box(f'PodiumStep{x}', (1.0, h, 0.95), (x, h / 2, 0), white, bevel=0.06))
        parts.append(box(f'PodiumTop{x}', (1.04, 0.08, 0.99), (x, h, 0), flat(top, 0.35), bevel=0.03))
    parts.append(box('PodiumBack', (3.6, 1.7, 0.12), (0, 0.85, -0.65), flat(KERB_RED, 0.5), bevel=0.04))
    gold = flat('#e8b931', 0.25)
    parts.append(lathe('PodiumTrophy', [(0.0, 0.0), (0.2, 0.0), (0.2, 0.08), (0.07, 0.14), (0.06, 0.32), (0.26, 0.5), (0.3, 0.78),
                                        (0.24, 0.8), (0.0, 0.62)], 20, (0, 1.03, 0.05), gold, cap_top=False))
    for p in parts:
        p.parent = g
    objs.extend(parts)
    objs.append(g)
    d = Batch('PodiumBoard')
    u0, v0, u1, v1 = decal_panel(1)
    # A board on the backdrop's face, toward the table.
    def at(x, y):
        tx, tz = -math.sin(a), math.cos(a)
        c = P(r + 0.58, a, y)
        return (c[0] + tx * x, c[1], c[2] + tz * x)
    d.quad([at(-1.7, 1.15), at(1.7, 1.15), at(1.7, 1.6), at(-1.7, 1.6)], decal_mat, out=inward, uvs=[(u1, v0), (u0, v0), (u0, v1), (u1, v1)])
    objs.append(d.done())

    # Camera platform on the right: a scaffold, a deck, a camera under an umbrella.
    a = 0.42
    g = blib.empty('CamTower', P(r, a), yaw_at(a))
    steel = flat(STEEL, 0.4)
    parts = []
    for sx in (-0.6, 0.6):
        for sz in (-0.5, 0.5):
            parts.append(box(f'CamLeg{sx}{sz}', (0.1, 2.2, 0.1), (sx, 1.1, sz), steel))
    for y in (0.7, 1.45):
        parts.append(box(f'CamRail{y}', (1.3, 0.06, 0.06), (0, y, 0.5), steel))
        parts.append(box(f'CamRailB{y}', (1.3, 0.06, 0.06), (0, y, -0.5), steel))
    parts.append(box('CamDeck', (1.5, 0.12, 1.3), (0, 2.25, 0), flat('#3a3d44', 0.6), bevel=0.03))
    parts.append(box('CamBody', (0.36, 0.34, 0.7), (0, 2.75, 0.05), flat('#22242a', 0.4), bevel=0.06))
    lens = cylinder('CamLens', 0.12, 0.35, (0, 0, 0), flat('#111214', 0.3), segs=12)
    lens.rotation_euler = (math.pi / 2, 0, 0)
    lens.location = V(0, 2.78, 0.38)
    parts.append(lens)
    parts.append(box('CamTripod', (0.12, 0.3, 0.12), (0, 2.45, 0), steel))
    parts.append(cylinder('CamPole', 0.035, 1.4, (0.5, 2.3, -0.4), steel, segs=6))
    parts.append(lathe('CamUmbrella', [(0.0, 0.0), (1.0, 0.0), (0.0, 0.32)], 8, (0.5, 3.45, -0.4), flat('#f2c230', 0.5),
                       cap_top=False, cap_bottom=True, smooth_shade=False))
    for p in parts:
        p.parent = g
    objs.extend(parts)
    objs.append(g)


# ---------------------------------------------------------------------------
# Trees, hedges, marshal posts
# ---------------------------------------------------------------------------

def build_greenery(objs):
    b = Batch('Trees')
    leaves = [flat(c, 0.8) for c in ('#3f8a3a', '#4c9a3e', '#367a36', '#5aa845', '#2f6d34')]
    trunk = flat('#6b4a2e', 0.9)
    spots = []
    # Clumps in the gaps between the stands and the pits, near the towers.
    for a in TOWERS:
        for k in range(4):
            spots.append((TOWER_R + 1.5 + rng.random() * 6.0, a + rng.normal(0, 0.06)))
    # A loose belt of trees round the outside of the service road.
    a = -math.pi
    while a < math.pi:
        r = 41.0 + rng.random() * 9.0
        spots.append((r, a))
        if rng.random() < 0.5:
            spots.append((r + 3 + rng.random() * 5, a + rng.normal(0, 0.03)))
        a += 0.09 + rng.random() * 0.07
    for k, (r, a) in enumerate(spots):
        x, y, z = P(r, a)
        s = 0.8 + rng.random() * 0.6
        if rng.random() < 0.35:
            # Conifer: stacked cones.
            col = leaves[int(rng.random() * 3)]
            b.cone((x, y, z), 0.25 * s, 0.15 * s, 1.0 * s, trunk, segs=6)
            for j in range(3):
                b.cone((x, y + (0.9 + j * 1.1) * s, z), (1.5 - j * 0.38) * s, 0.05, 1.9 * s, col, segs=8)
        else:
            col = leaves[int(rng.random() * len(leaves))]
            b.cone((x, y, z), 0.28 * s, 0.18 * s, 2.0 * s, trunk, segs=6)
            for j in range(3):
                off = (rng.normal(0, 0.5) * s, (2.6 + rng.random() * 0.9) * s, rng.normal(0, 0.5) * s)
                # Rounder canopies close in, cheaper ones out by the road.
                b.ico((x + off[0], y + off[1], z + off[2]), (1.2 + rng.random() * 0.5) * s, col, scale=(1, 0.9, 1),
                      subdiv=2 if r < 36 else 1)
    objs.append(b.done(smooth=True))
    # Hedges along the road, either side of each stand.
    h = Batch('Hedges')
    hedge = flat('#3d8337', 0.85)
    for key, (s0, s1) in STANDS.items():
        for k, (aa, bb) in enumerate(sectors(s0, s1, math.radians(6))):
            am = (aa + bb) / 2
            h.box(P(APRON_R - 0.6, am), ((bb - aa) * (APRON_R - 0.6) - 0.2, 0.9, 0.9), hedge, yaw=yaw_at(am), bottom=True)
    objs.append(h.done())
    # Marshal posts: orange huts on the run-off, a flag pole each.
    for k, a in enumerate([-0.35, 0.6, 1.6, 2.6, 3.3]):
        g = blib.empty(f'Marshal{k}', P(WALL_R - 0.9 if not in_any(a, GRAVEL) else WALL_R - 1.9, a), yaw_at(a))
        parts = [
            box(f'MarshalHut{k}', (1.3, 1.5, 1.0), (0, 0.75, 0), flat('#ff7a1a', 0.5), bevel=0.08),
            box(f'MarshalRoof{k}', (1.6, 0.14, 1.3), (0, 1.57, 0), flat(WHITE, 0.5), bevel=0.04),
            box(f'MarshalWindow{k}', (1.0, 0.45, 0.04), (0, 1.05, 0.5), flat('#2a3442', 0.2)),
        ]
        for p in parts:
            p.parent = g
        objs += parts + [g]


# ---------------------------------------------------------------------------
# Backdrop: hills and sky (unlit, not baked)
# ---------------------------------------------------------------------------

SKY_TOP = '#3c4f8f'
SKY_MID = '#8f86b8'
SKY_HORIZON = '#f2b48a'
SKY_SUN = '#ffd08a'
HAZE = '#c7a7a6'


def lin(h):
    return np.array(blib.hex_rgb(h), np.float32)


HILLS = [
    # r0, r1, peak height, seed, colour low, colour high, haze
    (FIELD_R, 120.0, 14.0, 3, '#4f8c3f', '#86a468', 0.12),
    (126.0, 160.0, 34.0, 9, '#6f8a8c', '#a99db4', 0.45),
]


def hill_y(layer, r, a):
    r0, r1, hmax, seed = HILLS[layer][:4]
    ph = np.random.default_rng(seed).random(6) * TAU
    t = min(1.0, max(0.0, (r - r0) / (r1 - r0)))
    ridge = 0.55 + 0.25 * math.sin(a * 3 + ph[0]) + 0.15 * math.sin(a * 7 + ph[1]) + 0.08 * math.sin(a * 17 + ph[2])
    # Rises from the field to a crest about two thirds back, then falls away out of sight.
    prof = math.sin(math.pi * min(1.0, t / 0.68) * 0.5) ** 1.4 * (1 - max(0.0, (t - 0.68) / 0.32) ** 2)
    return hmax * ridge * prof


def shade_backdrop(obj, color_fn, smooth=True):
    """Vertex colours for unlit scenery: color_fn(game_normal, game_position) -> linear rgb.

    smooth shades each vertex from its normal (soft hills and clouds); otherwise each face is flat.
    """
    me = obj.data
    if smooth:
        ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
        cols = np.ones((len(me.vertices), 4), np.float32)
        for v in me.vertices:
            col = color_fn(game_normal(v.normal), Vector((v.co.x, v.co.z, -v.co.y)))
            cols[v.index] = (*np.clip(col, 0, 1), 1)
    else:
        ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        cols = np.ones((len(me.loops), 4), np.float32)
        for poly in me.polygons:
            c = poly.center
            col = color_fn(game_normal(poly.normal), Vector((c.x, c.z, -c.y)))
            cols[poly.loop_start:poly.loop_start + poly.loop_total] = (*np.clip(col, 0, 1), 1)
    ca.data.foreach_set('color', cols.ravel())
    obj['keep_colors'] = 1
    backdrop_only(obj)


def build_hills(objs):
    """Two rings of rolling hills with tree clumps, coloured with their own light and haze (unlit)."""
    mat = backdrop_material()
    out = []
    sun = lin('#ffcf9a')
    hz = lin(HAZE)
    for layer, (r0, r1, hmax, seed, low, high, haze) in enumerate(HILLS):
        nseg, nr = 128, 6
        bm = bmesh.new()
        vs = []
        for j in range(nr + 1):
            r = r0 + (r1 - r0) * j / nr
            vs.append([bm.verts.new(V(*P(r, TAU * i / nseg, hill_y(layer, r, TAU * i / nseg)))) for i in range(nseg)])
        for j in range(nr):
            for i in range(nseg):
                i2 = (i + 1) % nseg
                f = bm.faces.new((vs[j][i], vs[j][i2], vs[j + 1][i2], vs[j + 1][i]))
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
        o = blib.new_mesh_object(f'Hills{layer}', bm, mat)
        lo, hi = lin(low), lin(high)

        def col(n, c, lo=lo, hi=hi, hmax=hmax, haze=haze):
            gy = c.y - F
            lam = max(0.0, n.dot(SUN_DIR))
            base = lo + (hi - lo) * min(1.0, gy / (hmax * 0.8))
            k = base * (0.62 + 0.7 * lam * sun)
            h = haze + 0.12 * min(1.0, gy / hmax)
            return k * (1 - h) + hz * h
        shade_backdrop(o, col)
        out.append(o)
    # Clumps of trees on the near hills.
    b = Batch('HillTrees')
    b.slot(mat)
    tr = np.random.default_rng(5)
    for k in range(26):
        # Woods: clumps of round treetops on the slopes.
        ca, cr_ = tr.random() * TAU, FIELD_R + 4 + tr.random() * 20
        for j in range(int(4 + tr.random() * 5)):
            r = cr_ + tr.normal(0, 2.5)
            a = ca + tr.normal(0, 3.5) / r
            s = 1.5 + tr.random() * 1.1
            b.ico(P(r, a, hill_y(0, r, a) + s * 0.55), s, mat, scale=(1, 0.85, 1), subdiv=1)
    o = b.done()
    dark, lit = lin('#2a5230'), lin('#78984a')
    shade_backdrop(o, lambda n, c: (dark + (lit - dark) * (0.15 + 0.85 * max(0.0, n.dot(SUN_DIR)))) * 0.85 + hz * 0.15)
    out.append(o)
    objs.extend(out)
    return out


def build_sky():
    """A dome with the dusk gradient (warm toward the sun) and a few lit clouds; unlit, never baked."""
    mat = backdrop_material()
    R = 175.0
    nseg, nring = 48, 14
    bm = bmesh.new()
    rows = []
    for j in range(nring + 1):
        el = -0.25 + (math.pi / 2 + 0.25) * (j / nring) ** 1.35
        if j == nring:
            rows.append([bm.verts.new(V(0, F + R * math.sin(el) * 0.6, 0))])
            break
        rows.append([bm.verts.new(V(R * math.cos(el) * math.cos(TAU * i / nseg), F + R * math.sin(el) * 0.6,
                                    R * math.cos(el) * math.sin(TAU * i / nseg))) for i in range(nseg)])
    for j in range(nring):
        ra, rb = rows[j], rows[j + 1]
        for i in range(nseg):
            i2 = (i + 1) % nseg
            if len(rb) == 1:
                bm.faces.new((ra[i], rb[0], ra[i2]))
            else:
                bm.faces.new((ra[i], rb[i], rb[i2], ra[i2]))
    # Face inward.
    for f in bm.faces:
        f.normal_update()
        c = f.calc_center_median()
        if f.normal.dot(c - V(0, F, 0)) > 0:
            f.normal_flip()
    o = blib.new_mesh_object('SkyDome', bm, mat)
    me = o.data
    me.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
    ca = me.color_attributes['Color']
    top, mid, hor, sun, haze = lin(SKY_TOP), lin(SKY_MID), lin(SKY_HORIZON), lin(SKY_SUN), lin(HAZE)
    sd = Vector((SUN_DIR.x, 0, SUN_DIR.z)).normalized()
    cols = np.ones((len(me.vertices), 4), np.float32)
    for v in me.vertices:
        g = Vector((v.co.x, v.co.z - F, -v.co.y))
        d = g.normalized()
        h = max(0.0, d.y)
        toward = max(0.0, Vector((d.x, 0, d.z)).normalized().dot(sd)) if abs(d.y) < 0.999 else 0.0
        warm = hor * (1 - toward) + sun * toward
        warm = haze * (1 - 0.6 - 0.4 * toward) + warm * (0.6 + 0.4 * toward)
        if h < 0.18:
            col = warm + (mid - warm) * (h / 0.18) ** 1.2 * 0.6
        elif h < 0.5:
            lo = warm + (mid - warm) * 0.6
            col = lo + (mid - lo) * ((h - 0.18) / 0.32)
        else:
            col = mid + (top - mid) * min(1.0, (h - 0.5) / 0.45)
        col = col * (1 + 0.5 * toward ** 6 * max(0.0, 1 - h * 3))
        cols[v.index] = (*np.clip(col, 0, 1), 1)
    ca.data.foreach_set('color', cols.ravel())
    o['keep_colors'] = 1
    backdrop_only(o)
    parts = [o]
    # The sun, just above the hills, and its glow.
    e = SUN_EL - math.radians(5)
    sun_c = Vector((math.cos(SUN_AZ) * math.cos(e), math.sin(e), math.sin(SUN_AZ) * math.cos(e))) * (R * 0.8)
    s = sphere('SkySun', 5.0, (sun_c.x, F + sun_c.y, sun_c.z), mat, segs=16, rings=10)
    s.data.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    cc = s.data.color_attributes['Color']
    cc.data.foreach_set('color', np.tile(np.array([*blib.hex_rgb('#fff1c8'), 1], np.float32), len(s.data.loops)))
    s['keep_colors'] = 1
    backdrop_only(s)
    parts.append(s)
    # Clouds: flattened blobs lit pink-gold from below on the sun side.
    cb = Batch('SkyClouds')
    cb.slot(mat)
    cr = np.random.default_rng(12)
    for k in range(8):
        a = cr.random() * TAU
        el = math.radians(9 + cr.random() * 16)
        dist = R - 18 - cr.random() * 20
        cx, cy, cz = math.cos(a) * math.cos(el) * dist, math.sin(el) * dist * 0.6, math.sin(a) * math.cos(el) * dist
        for j in range(3):
            w = 7 + cr.random() * 7
            cb.ico((cx + cr.normal(0, 5), F + cy + cr.normal(0, 1), cz + cr.normal(0, 5)), w, mat, scale=(1.4, 0.32, 1.0), subdiv=2)
    co = cb.done()
    lit_c, shade_c = lin('#ffc6a6'), lin('#9187b2')

    def cloud(n, c):
        d = Vector((c.x, 0, c.z)).normalized()
        toward = max(0.0, d.dot(sd))
        lam = max(0.0, n.dot(SUN_DIR)) * (0.55 + 0.45 * toward) + max(0.0, -n.y) * 0.3 * toward + 0.15 * max(0.0, n.y)
        return shade_c + (lit_c - shade_c) * min(1.0, lam * 1.3)
    shade_backdrop(co, cloud)
    parts.append(co)
    return parts


# ---------------------------------------------------------------------------
# Lights (bake only)
# ---------------------------------------------------------------------------

def add_light(name, kind, pos, color, power, size=1.0):
    L = bpy.data.lights.new(name, kind)
    L.energy = power
    L.color = color
    if kind in ('POINT', 'SPOT'):
        L.shadow_soft_size = size
    o = bpy.data.objects.new(name, L)
    blib.link(o)
    o.location = V(*pos)
    return o


def aim(obj, target):
    d = V(*target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_lighting(heads):
    world = bpy.data.worlds.new('Dusk')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*blib.hex_rgb('#6f7fb0'), 1)
    bg.inputs['Strength'].default_value = 0.75
    bpy.context.scene.world = world
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.6
    sun.color = blib.hex_rgb('#ffc690')
    sun.angle = math.radians(3.0)
    so = bpy.data.objects.new('Sun', sun)
    blib.link(so)
    sd = V(*SUN_DIR)
    so.rotation_euler = (-sd).to_track_quat('-Z', 'Y').to_euler()
    # Floodlights: cool white, wide, aimed at the near side of the track.
    for k, (hp, tgt) in enumerate(heads):
        L = add_light(f'Flood{k}', 'SPOT', hp, blib.hex_rgb('#e8efff'), 42000, size=1.6)
        L.data.spot_size = math.radians(80)
        L.data.spot_blend = 0.7
        aim(L, tgt)


# ---------------------------------------------------------------------------

def build_all(with_sky=False):
    """Everything in the set. Returns (objs, lamp heads, backdrop objects)."""
    objs: list = []
    gmat = ground_material(blib.image_from_array('ground', tex_detail(512)))
    track_mat = textured('Track', blib.image_from_array('track', tex_track(1024, 512)), rough=0.8)
    decal_mat = textured('Decals', blib.image_from_array('decals', tex_decals(1024, 512)), rough=0.6)
    build_ground(objs, gmat, track_mat)
    build_kerbs(objs)
    build_markings(objs, decal_mat)
    build_barriers(objs, decal_mat)
    build_gantry(objs, decal_mat)
    build_pits(objs, decal_mat)
    grandstand(objs, 'R', *STANDS['R'], decal_mat, ['#2a62d6', '#f1f0ec', '#2a62d6'], '#2a62d6', seed=1)
    grandstand(objs, 'F', *STANDS['F'], decal_mat, ['#d8282c', '#f2c230', '#d8282c'], '#d8282c', seed=2)
    grandstand(objs, 'L', *STANDS['L'], decal_mat, ['#1e9b57', '#f1f0ec', '#1e9b57'], '#1e9b57', seed=3)
    heads = build_towers(objs)
    build_cars(objs)
    build_infield(objs, decal_mat)
    build_greenery(objs)
    back = build_hills(objs)
    if with_sky:
        back += build_sky()
    return objs, heads, back, gmat


def occluders():
    finish = flat('#5a3a22', 0.45, name='OccluderWood')
    occ = table_mod.build(finish, finish)
    occ.append(box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='OccluderBoard')))
    return occ


def parts(me):
    """Connected pieces of a mesh as lists of polygon indices."""
    parent = list(range(len(me.vertices)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    groups = {}
    for p in me.polygons:
        groups.setdefault(find(p.vertices[0]), []).append(p.index)
    return list(groups.values())


COLLAPSE = ('Crowd', 'Trees', 'Tyres', 'Fence', 'Hedges', 'TowerLamp', 'Truck', 'PitStand', 'Marshal', 'GridCar', 'PitCar',
            'PitBits', 'Kerbs')


def uv_islands(me, uv):
    """Faces of a mesh grouped into UV islands (faces sharing a vertex with the same UV)."""
    parent = list(range(len(me.polygons)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    vi = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', vi)
    owner = {}
    for p in me.polygons:
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            k = (int(vi[li]), round(float(uv[li, 0]), 6), round(float(uv[li, 1]), 6))
            q = owner.setdefault(k, p.index)
            if q != p.index:
                a, b = find(q), find(p.index)
                if a != b:
                    parent[a] = b
    groups = {}
    for p in me.polygons:
        groups.setdefault(find(p.index), []).extend(range(p.loop_start, p.loop_start + p.loop_total))
    return [np.array(g, np.int64) for g in groups.values()]


def shelf_pack(objs, width, margin):
    """Pack every lightmap island of objs into [0, width] x [0, 1], as large as will fit.

    Blender's packer leaves most of the atlas empty with thousands of small
    islands; this turns each island to its smallest bounding box, sorts them
    by height and fills shelves, searching for the largest scale that fits.
    """
    isl = []
    for o in objs:
        me = o.data
        layer = me.uv_layers['Lightmap'].data
        uv = np.zeros((len(layer), 2), np.float64)
        layer.foreach_get('uv', uv.ravel())
        for loops in uv_islands(me, uv):
            pts = uv[loops]
            c = pts.mean(axis=0)
            best = None
            for deg in range(0, 90, 6):
                t = math.radians(deg)
                R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
                q = (pts - c) @ R.T
                ext = q.max(axis=0) - q.min(axis=0)
                if best is None or ext[0] * ext[1] < best[0]:
                    best = (ext[0] * ext[1], q)
            q = best[1] - best[1].min(axis=0)
            if q[:, 1].max() > q[:, 0].max():
                q = q[:, ::-1].copy()   # lie wide
            isl.append([o.name, loops, q, q[:, 0].max(), q[:, 1].max(), uv])
    isl.sort(key=lambda t: -t[4])

    def place(s):
        x = y = shelf = 0.0
        out = []
        for _, _, _, w, h, _ in isl:
            w, h = w * s + margin, h * s + margin
            if x + w > width:
                x, y = 0.0, y + shelf
                shelf = 0.0
            if shelf == 0.0:
                shelf = h
            out.append((x, y))
            x += w
        return out if y + shelf <= 1.0 else None
    lo, hi = 0.0, 1.0
    while place(hi) is not None:
        hi *= 2
    for _ in range(30):
        mid = (lo + hi) / 2
        if place(mid) is not None:
            lo = mid
        else:
            hi = mid
    pos = place(lo)
    for (name, loops, q, w, h, uv), (x, y) in zip(isl, pos):
        uv[loops] = q * lo + (x + margin / 2, y + margin / 2)
    done = set()
    for name, _, _, _, _, uv in isl:
        if name not in done:
            done.add(name)
            bpy.data.objects[name].data.uv_layers['Lightmap'].data.foreach_set('uv', uv.astype(np.float32).ravel())
    used = sum((w * lo + margin) * (h * lo + margin) for _, _, _, w, h, _ in isl)
    blib.log(f'lightmap: {len(isl)} islands packed, {used / width:.0%} of the space used')


def unwrap(objs, weight, size, collapse, margin_px=2.5, cell_px=4):
    """Lightmap UVs for all objs in one atlas, like blib.lightmap_unwrap, with one twist.

    Objects named in `collapse` are made of many small pieces (spectators,
    trees, tyres, fence posts). Packed as islands they would drown the atlas
    in margins, so nearby pieces share one stand-in face — their most
    upward-facing one — which gets a tiny square of its own in a strip down
    the atlas's right edge (neighbours next to each other). Every other face
    of those pieces samples that square, shaded a little by its own normal in
    the vertex colours.
    """
    for o in objs:
        blib.ensure_uvs(o)
        o.data.uv_layers.active = o.data.uv_layers['Lightmap']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    clusters_of = {}
    for o in objs:
        me = o.data
        if not o.name.startswith(collapse):
            k = float(weight(o))
            uv = me.uv_layers['Lightmap'].data
            arr = np.zeros(len(uv) * 2, np.float32)
            uv.foreach_get('uv', arr)
            uv.foreach_set('uv', arr * k)
            me.polygons.foreach_set('select', np.ones(len(me.polygons), bool))
            continue
        cell = 1.6
        groups = {}
        for piece in parts(me):
            c = sum((me.polygons[i].center for i in piece), Vector()) / len(piece)
            groups.setdefault((int(c.x // cell), int(c.y // cell), int(c.z // (cell * 2))), []).extend(piece)
        reps = []
        for piece in groups.values():
            best = max(piece, key=lambda i: me.polygons[i].area * (0.05 + max(0.0, me.polygons[i].normal.z)))
            reps.append((best, piece))
        clusters_of[o.name] = reps
        me.polygons.foreach_set('select', np.zeros(len(me.polygons), bool))
        shade_by_normal(o)
    # Room for the stand-in squares: a strip as narrow as will hold them all.
    n_cells = sum(len(r) for r in clusters_of.values())
    rows = size // cell_px
    cols = max(1, -(-n_cells // rows))
    strip = cols * cell_px / size
    shelf_pack([o for o in objs if o.name not in clusters_of], 1 - strip, margin_px / size)
    # Hand out the squares in order round the table, so neighbours sit side by side (mipmaps blend alike light).
    cells = []
    for name, reps in clusters_of.items():
        me = bpy.data.objects[name].data
        for best, piece in reps:
            c = me.polygons[best].center
            cells.append((math.atan2(-c.y, c.x), math.hypot(c.x, c.y), name, best, piece))
    cells.sort(key=lambda t: (round(t[0] * 40), t[1]))
    px = 1.0 / size
    for k, (_, _, name, best, piece) in enumerate(cells):
        me = bpy.data.objects[name].data
        uv = me.uv_layers['Lightmap'].data
        u0 = 1 - strip + (k // rows) * cell_px * px + 0.5 * px
        v0 = (k % rows) * cell_px * px + 0.5 * px
        side = (cell_px - 1) * px
        poly = me.polygons[best]
        n = poly.loop_total
        for j, li in enumerate(range(poly.loop_start, poly.loop_start + n)):
            if n == 4:
                du, dv = [(0, 0), (1, 0), (1, 1), (0, 1)][j]
            else:
                a = TAU * j / n
                du, dv = 0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a)
            uv[li].uv = (u0 + du * side, v0 + dv * side)
        mid = (u0 + side / 2, v0 + side / 2)
        for p in piece:
            if p == best:
                continue
            pp = me.polygons[p]
            for li in range(pp.loop_start, pp.loop_start + pp.loop_total):
                uv[li].uv = mid
    for o in objs:
        o.data.polygons.foreach_set('select', np.ones(len(o.data.polygons), bool))
    blib.log(f'lightmap: {n_cells} stand-in squares in a {strip * size:.0f}px strip')


def shade_by_normal(o):
    """Darken faces turned away from the low sun a little (the lightmap gives the piece one light level)."""
    me = o.data
    ca = me.color_attributes.get('Color')
    if ca is None:
        return
    cols = np.zeros(len(me.loops) * 4, np.float32)
    ca.data.foreach_get('color', cols)
    cols = cols.reshape(-1, 4)
    nrm = np.zeros(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get('vector', nrm)
    nrm = nrm.reshape(-1, 3)
    g = np.stack([nrm[:, 0], nrm[:, 2], -nrm[:, 1]], axis=1)   # game frame
    sun = np.array(SUN_DIR)
    f = np.clip(0.66 + 0.34 * (g @ sun) + 0.08 * g[:, 1], 0.42, 1.0)
    cols[:, :3] *= f[:, None]
    ca.data.foreach_set('color', cols.ravel())


def report():
    """Triangles per kind of object (after modifiers), to keep an eye on the budget."""
    import re
    tally = {}
    for o in blib.mesh_objects():
        key = re.sub(r'[\d_]+.*$', '', o.name) or o.name
        tally[key] = tally.get(key, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1]):
        blib.log(f'{v:7d}  {k}')
    blib.log(f'{sum(tally.values()):7d}  total')


def preview():
    """Path-traced stills from the game's cameras (no bake) for judging the layout and light."""
    sc = blib.reset()
    objs, heads, back, gmat = build_all(with_sky=True)
    occluders()
    blib.realize()
    report()
    setup_lighting(heads)
    out_dir = os.environ.get('PREVIEW_DIR', '/tmp')
    sc.render.resolution_x, sc.render.resolution_y = 960, 600
    sc.cycles.samples = int(os.environ.get('PREVIEW_SPP', '24'))
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'AgX'
    cams = {
        'table': ((0, 13.65, 12.1), (0, 0, 0)),
        'cine': ((0.6, 1.55, 7.2), (0.2, 0.35, 4.8)),
        'follow': ((-1.0, 2.6, -8.4), (-0.6, 0.2, -4.6)),
        'side': ((8.4, 2.6, 1.0), (4.6, 0.2, 0.6)),
        'over': ((34, 30, 46), (0, -3, -4)),
    }
    which = os.environ.get('PREVIEW_CAMS', ','.join(cams)).split(',')
    for name in which:
        pos, tgt = cams[name]
        cam = bpy.data.objects.new(f'Cam{name}', bpy.data.cameras.new(f'Cam{name}'))
        blib.link(cam)
        cam.data.sensor_fit = 'VERTICAL'
        cam.data.angle_y = math.radians(45)
        cam.data.clip_end = 1000
        cam.location = V(*pos)
        aim(cam, tgt)
        sc.camera = cam
        sc.render.filepath = os.path.join(out_dir, f'prev-{name}.png')
        bpy.ops.render.render(write_still=True)
        blib.log('wrote', sc.render.filepath)


def main():
    if PREVIEW:
        preview()
        return
    blib.reset()
    objs, heads, back, gmat = build_all(with_sky=False)
    occluders()
    blib.realize()
    occ_names = ('Table', 'BoardOccluder')
    every = blib.mesh_objects()
    backdrop = [o for o in every if o.get('backdrop')]
    occ_objs = [o for o in every if o.name.startswith(occ_names)]
    room = [o for o in every if o not in backdrop and o not in occ_objs]
    blib.flatten_colors(room)
    lit = [o for o in room if not blib.is_unlit(o)]
    unlit = [o for o in room if blib.is_unlit(o)]
    setup_lighting(heads)
    blib.cull_hidden([o for o in lit if not o.get('ground')], F, eps=0.04)

    view_a = (math.radians(-165), math.radians(-15))   # what the table camera sees (the back half)

    fixed = {'Crowd': 1.6, 'Trees': 0.8, 'Hedges': 0.5, 'Tyres': 1.6, 'Fence': 1.6, 'GPlazaIn': 0.7, 'GField': 0.2, 'GVerge': 0.35, 'GRoad': 0.4,
             'Kerbs': 2.2, 'PlazaEdge': 2.0, 'Markings': 1.6, 'Walls': 1.3, 'Boards': 1.3,
             'Stand': 0.7, 'PitBuilding': 1.0, 'GridCar': 1.6, 'Gantry': 1.4}

    def weight(o):
        """Lightmap texels per unit: most where the table camera looks (the back half, near the table)."""
        for k, w in fixed.items():
            if o.name.startswith(k):
                return w
        lo, hi = Vector(o.bound_box[0]), Vector(o.bound_box[6])
        cx, cz = (lo.x + hi.x) / 2, -(lo.y + hi.y) / 2
        seen = view_a[0] <= math.atan2(cz, cx) <= view_a[1]
        if o.get('ground'):
            near = o.name.startswith(('GPlaza', 'GInfield', 'Track', 'GRunoff', 'GPitStrip'))
            return (2.6 if seen else 1.1) if near else (1.0 if seen else 0.5)
        if math.hypot(cx, cz) < 30:
            return 1.4 if seen else 0.8
        return 0.6
    size, spp = (1024, 16) if DRAFT else (2048, 128)
    # Outdoors a few bounces are plenty, and they keep a 2048² bake to under an hour.
    sc = bpy.context.scene
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    unwrap(lit, weight, size,
           collapse=COLLAPSE)
    scale = blib.bake_lightmap(lit, size=size, samples=spp,
                               out_file=os.path.join(blib.PUBLIC, 'models', 'speedway', 'set-light.webp'))

    # One mesh for the plain colours, one per textured surface, one for everything that glows.
    flat_objs = [o for o in lit if all(m.name == 'Flat' for m in o.data.materials)]
    tex_objs = [o for o in lit if o not in flat_objs]
    groups = {}
    for o in tex_objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = [blib.join(flat_objs, 'SetFlat')]
    for name, os_ in groups.items():
        out.append(blib.join(os_, f'Set{name}'))
    unmix_ground(gmat)
    for o in occ_objs:
        bpy.data.objects.remove(o)
    # Glowing bits and the backdrop: their own colours, unlit, folded into one mesh and material.
    glow_objs = unlit + backdrop + build_sky()
    shared = bpy.data.materials.new('Glow')
    shared.use_nodes = True
    nt = shared.node_tree
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    nt.links.new(vc.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    for o in glow_objs:
        me = o.data
        if not o.get('keep_colors'):
            m = me.materials[0]
            c = m.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value
            if 'Color' not in me.color_attributes:
                me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
            ca = me.color_attributes['Color']
            ca.data.foreach_set('color', np.tile(np.array([c[0], c[1], c[2], 1], np.float32), len(ca.data)))
        if me.color_attributes['Color'].domain == 'POINT':
            # Joined meshes need one domain: copy per-vertex colours to corners.
            src = me.color_attributes['Color']
            vals = np.zeros(len(me.vertices) * 4, np.float32)
            src.data.foreach_get('color', vals)
            vals = vals.reshape(-1, 4)
            me.color_attributes.remove(src)
            dst = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
            vi = np.zeros(len(me.loops), np.int32)
            me.loops.foreach_get('vertex_index', vi)
            dst.data.foreach_set('color', vals[vi].ravel())
        me.materials.clear()
        me.materials.append(shared)
        for uv in list(me.uv_layers):
            me.uv_layers.remove(uv)
    out.append(blib.join(glow_objs, 'RoomGlowSet'))
    # The plain-colour mesh needs no texture UVs: drop them so its lightmap UVs become TEXCOORD_0.
    flat_mesh = out[0]
    if 'UVMap' in flat_mesh.data.uv_layers:
        flat_mesh.data.uv_layers.remove(flat_mesh.data.uv_layers['UVMap'])
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in out if o)
    blib.log(f'{tris} triangles in {len(out)} meshes')
    blib.export_glb([o for o in out if o], 'models/speedway/set.glb', normals=False)
    blib.record('speedwaySet', {
        'url': '/models/speedway/set.glb',
        'lightmap': '/models/speedway/set-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })


if __name__ == '__main__':
    main()
