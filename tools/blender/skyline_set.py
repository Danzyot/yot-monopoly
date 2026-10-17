"""The Metropolis map's set: a penthouse roof terrace high above the city at night.

A round teak deck under the table, stone pavers out to a brick parapet with a
railing hung with fairy lights, festoon strings on poles, a lounge corner with
a fire pit, planters, a stair bulkhead with its door ajar and a water tower on
top, HVAC units and ducts, a neon sign; round it, the neighbouring rooftops
below and a city of lit towers fading into the haze. Moonlight, the warm
bulbs, the fire and the neon are baked into one lightmap; windows, bulbs and
neon are unlit (`RoomGlow…`) and show at full strength.

    tools/blender/run.sh skyline_set.py            # full quality
    tools/blender/run.sh skyline_set.py --draft    # quick bake for iterating
    tools/blender/run.sh skyline_set.py --preview  # Cycles renders of the game views, no bake

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the deck (the floor the table stands on) at
y = -4.6. One unit is about 17 cm at the table's scale; the city round the
roof is drawn smaller than life so it fits in the camera's range.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import blib  # noqa: E402
import table as table_mod  # noqa: E402
import tex  # noqa: E402
from blib import V, box, cylinder, flat, glow, lathe, sphere, textured, tube  # noqa: E402

DRAFT = '--draft' in sys.argv
PREVIEW = '--preview' in sys.argv
F = -4.6            # deck top: the table stands here
G = F - 0.3         # the pavers round the deck
R = 18.5            # parapet inner faces at x, z = ±R
PT = 0.9            # parapet thickness
PH = 2.0            # parapet height above the pavers
DECK_R = 13.0
STREET = -230.0     # the street, far below (in the haze)
PITCH = 56.0        # city block pitch (44 block + 12 street)
BLOCK = 44.0
# Toward the moon (matches the drawn moon in environments/Skyline.tsx).
MOON = (-150.0, 160.0, -240.0)
OUT = 'models/skyline'
SCRATCH = os.environ.get('SKYLINE_PREVIEW_DIR', '/tmp')

rng = np.random.default_rng(42)

# ---- palette ---------------------------------------------------------------
TEAK_DARK = '#4a2c1a'
TEAK = '#8a5634'
STEEL = '#2e333b'
STEEL_MID = '#5a616b'
GALV = '#a7adb4'
UNIT = '#b9bec4'
CONCRETE = '#a59d92'
COPING = '#cfc6b6'
CUSHION = '#eee6d6'
NAVY = '#22304f'
BRASS = '#d1a24a'
LEAF = ['#2f6b3a', '#3b7f43', '#4a8f4a', '#2a5c34', '#55a052']
WARM = '#ffcf8a'    # bulb colour
NEON_PINK = '#ff3fa8'
NEON_CYAN = '#38ecff'
NEON_GOLD = '#ffcf3a'


def add_light(name, kind, pos, color, power, size=0.2, rot=None, shape=None, spot=None):
    L = bpy.data.lights.new(name, kind)
    L.energy = power
    L.color = blib.hex_rgb(color) if isinstance(color, str) else color
    if kind == 'AREA':
        L.shape = shape or 'DISK'
        L.size = size
        if shape == 'RECTANGLE':
            L.size_y = size * 0.5
    elif kind in ('POINT', 'SPOT'):
        L.shadow_soft_size = size
    if kind == 'SPOT' and spot:
        L.spot_size = math.radians(spot)
        L.spot_blend = 0.8
    o = bpy.data.objects.new(name, L)
    blib.link(o)
    o.location = V(*pos)
    if rot is not None:
        o.rotation_euler = rot
    return o


def aim(obj, target):
    """Point a light (its -Z) from where it stands at a game-space target."""
    d = V(*target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return obj


def group(name, pos, yaw, parts):
    """Parent parts (built in local coordinates) to an empty at pos, turned yaw about up."""
    g = blib.empty(name, pos, yaw)
    for p in parts:
        p.parent = g
    return parts + [g]


def ico(name, r, pos, mat, subdiv=2, jitter=0.12, scale=(1, 1, 1), seed=0):
    """A lumpy ball (shrub, canopy): an icosphere with its vertices nudged in and out."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    rr = np.random.default_rng(seed)
    for v in bm.verts:
        v.co *= 1 + (rr.random() - 0.5) * 2 * jitter
    obj = blib.new_mesh_object(name, bm, mat, smooth=True)
    obj.location = V(*pos)
    obj.scale = (scale[0], scale[2], scale[1])
    return obj


# --------------------------------------------------------------------------
# Textures (procedural, numpy; row 0 at the top)
# --------------------------------------------------------------------------

def tex_pavers(size=1024, n=4, seed=21):
    """Square stone pavers, n×n to a tile, each a little different, with dark joints."""
    r = np.random.default_rng(seed)
    h = w = size
    cell = size // n
    base = tex.rgb('#a39b90')
    img = np.empty((h, w, 3), np.float32)
    for j in range(n):
        for i in range(n):
            tone = 0.84 + r.random() * 0.22
            hue = np.array([1.0, 0.98 + r.random() * 0.03, 0.95 + r.random() * 0.07], np.float32)
            img[j * cell:(j + 1) * cell, i * cell:(i + 1) * cell] = base * tone * hue
    fine = tex.noise(h, w, (64, 64), 3, seed)
    wear = tex.noise(h, w, (4, 4), 3, seed + 1)
    img *= ((0.9 + 0.16 * fine) * (0.88 + 0.18 * wear))[..., None]
    spots = r.random((h, w))
    img[spots > 0.988] *= 0.78
    img[spots < 0.008] *= 1.12
    y, x = np.mgrid[0:h, 0:w]
    jy, jx = y % cell, x % cell
    joint = (jy < 5) | (jx < 5)
    edge = ((jy >= 5) & (jy < 9)) | ((jx >= 5) & (jx < 9))
    img[edge & ~joint] *= 1.07
    img[joint] = tex.rgb('#4a4640') * (0.8 + 0.3 * fine[joint])[..., None]
    return np.clip(img, 0, 1)


def tex_brick(size=512, courses=12, per=4, seed=31):
    """Running-bond red brick with pale mortar, tileable."""
    r = np.random.default_rng(seed)
    h = w = size
    ch = h // courses
    bw = w // per
    mortar = tex.rgb('#b3a796')
    cols = [tex.rgb(c) for c in ('#8c4632', '#9b5139', '#7b3d2c', '#a65c40', '#6f3628', '#94503a')]
    fine = tex.noise(h, w, (48, 48), 3, seed)
    img = np.broadcast_to(mortar, (h, w, 3)).copy() * (0.85 + 0.2 * fine)[..., None]
    for row in range(courses):
        off = (row % 2) * bw // 2
        y0, y1 = row * ch + 3, (row + 1) * ch - 2
        for k in range(per):
            x0 = off + k * bw + 3
            xs = np.arange(x0, x0 + bw - 5) % w
            c = cols[int(r.random() * len(cols))] * (0.88 + r.random() * 0.2)
            patch = c * (0.86 + 0.22 * fine[y0:y1][:, xs])[..., None]
            img[y0:y1][:, xs] = patch
            img[y1 - 2:y1][:, xs] *= 0.82
    return np.clip(img, 0, 1)


# Window atlas: four facade styles side by side, each 8 bays × 32 floors, tiling
# vertically; a dark strip at the right edge for roofs.
ATLAS = 1024
ATLAS_COLW = 254
BAY = 4.0           # window bay width (city units)
STOREY = 5.0
ATLAS_FLOORS = 32


def tex_windows(seed=41):
    r = np.random.default_rng(seed)
    S = ATLAS
    img = np.zeros((S, S, 3), np.float32)
    img[:] = tex.rgb('#06080e')
    styles = [
        # wall, unlit glass, lit colours, lit share, window margins (x, y) in px of a 31.75×32 cell
        ('#121624', '#1a2436', ['#ffd08a', '#ffe7b8', '#ffc56e', '#d6e6ff'], 0.42, (4, 6)),
        ('#0c1626', '#162c47', ['#c4e2ff', '#e9f5ff', '#9fd0ff', '#ffe2a8'], 0.3, (1, 3)),
        ('#22191a', '#1f1c24', ['#ffb35c', '#ffd49a', '#ff9e4a', '#ffe8c2'], 0.38, (8, 8)),
        ('#16161e', '#1c1d2a', ['#ffe3a6', '#fff2d2', '#ffd27a', '#c8dcff'], 0.3, (11, 4)),
    ]
    cw = ATLAS_COLW / 8
    chh = S / ATLAS_FLOORS
    yy, xx = np.mgrid[0:int(chh), 0:int(cw) + 1].astype(np.float32)
    for k, (wall, glass, lits, share, (mx, my)) in enumerate(styles):
        x0 = k * ATLAS_COLW
        img[:, x0:x0 + ATLAS_COLW] = tex.rgb(wall)
        for f in range(ATLAS_FLOORS):
            floor_lit = r.random()
            # Whole floors lit (late-night offices) now and then; otherwise scattered windows.
            p = 0.92 if floor_lit < 0.07 else share * (0.6 + 0.8 * r.random())
            for b in range(8):
                wx0 = int(x0 + b * cw + mx)
                wx1 = int(x0 + (b + 1) * cw - mx)
                wy0 = int(f * chh + my)
                wy1 = int((f + 1) * chh - my)
                if wx1 <= wx0 or wy1 <= wy0:
                    continue
                if r.random() < p:
                    c = tex.rgb(lits[int(r.random() * len(lits))]) * (0.55 + 0.45 * r.random())
                    # Brighter toward the sill, a blind across the top of some.
                    grad = np.linspace(0.8, 1.05, wy1 - wy0)[:, None, None]
                    img[wy0:wy1, wx0:wx1] = c * grad
                    if r.random() < 0.35:
                        bh = int((wy1 - wy0) * (0.2 + 0.5 * r.random()))
                        img[wy0:wy0 + bh, wx0:wx1] = c * 0.45
                else:
                    g = tex.rgb(glass) * (0.7 + 0.6 * r.random())
                    img[wy0:wy1, wx0:wx1] = g
            # Spandrel line under each floor.
            img[int(f * chh):int(f * chh) + 1, x0:x0 + ATLAS_COLW] *= 0.6
    img[:, 4 * ATLAS_COLW:] = tex.rgb('#0b0e18')
    return np.clip(img, 0, 1)


def tex_ads(size=512, seed=51):
    """Four glowing billboard panels (no words, no brands): dice, a top hat, a sunset skyline, a house."""
    h = w = size // 2
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    out = np.zeros((size, size, 3), np.float32)

    def frame(img, col):
        b = (u < 0.03) | (u > 0.97) | (v < 0.04) | (v > 0.96)
        img[b] = tex.rgb(col)
        return img

    # A: two dice tumbling on magenta.
    a = tex.lerp(tex.rgb('#ff2f8e'), tex.rgb('#5b1aa8'), v)
    for (cx, cy, s, rot) in [(0.36, 0.52, 0.22, 0.3), (0.66, 0.46, 0.2, -0.25)]:
        dx, dy = u - cx, v - cy
        rx = dx * math.cos(rot) - dy * math.sin(rot)
        ry = dx * math.sin(rot) + dy * math.cos(rot)
        q = np.maximum(np.abs(rx) - s * 0.8, 0) ** 2 + np.maximum(np.abs(ry) - s * 0.8, 0) ** 2
        die = (np.maximum(np.abs(rx), np.abs(ry)) < s) & (q < (s * 0.2) ** 2)
        a[die] = tex.rgb('#fff6ee')
        for px, py in [(-0.5, -0.5), (0.5, 0.5), (0, 0), (-0.5, 0.5), (0.5, -0.5)]:
            pip = (rx - px * s * 0.95) ** 2 + (ry - py * s * 0.95) ** 2 < (s * 0.16) ** 2
            a[pip & die] = tex.rgb('#2a1240')
    out[:h, :w] = frame(a, '#ffe0f2')
    # B: a gold top hat with sparkles on teal.
    b = tex.lerp(tex.rgb('#0fd6c8'), tex.rgb('#0b4d7a'), v)
    brim = ((u - 0.5) / 0.3) ** 2 + ((v - 0.72) / 0.06) ** 2 < 1
    crown = (np.abs(u - 0.5) < 0.17 - (0.72 - v) * 0.05) & (v > 0.3) & (v < 0.72)
    top = ((u - 0.5) / 0.17) ** 2 + ((v - 0.3) / 0.04) ** 2 < 1
    band = crown & (v > 0.6) & (v < 0.68)
    b[brim | crown | top] = tex.rgb('#ffcc33')
    b[band] = tex.rgb('#b3261e')
    rr = np.random.default_rng(seed)
    for _ in range(14):
        sx, sy = rr.random(), rr.random() * 0.9 + 0.05
        if abs(sx - 0.5) < 0.25 and 0.25 < sy < 0.8:
            continue
        d = np.abs(u - sx) * np.abs(v - sy)
        b[(d < 0.00018) & (np.abs(u - sx) < 0.05) & (np.abs(v - sy) < 0.05)] = tex.rgb('#ffffff')
    out[:h, w:] = frame(b, '#d9fffb')
    # C: sunset over a skyline.
    c = tex.lerp(tex.rgb('#ffb23a'), tex.rgb('#e2306c'), np.clip(v * 1.4, 0, 1))
    sun = (u - 0.5) ** 2 + (v - 0.55) ** 2 < 0.2 ** 2
    c[sun] = tex.rgb('#fff1a8')
    stripes = sun & (np.sin(v * 90) > 0.6) & (v > 0.55)
    c[stripes] = tex.rgb('#ff8a3a')
    skyline = np.zeros(w, np.float32)
    xx = 0
    while xx < w:
        bw = int(14 + rr.random() * 30)
        skyline[xx:xx + bw] = 0.55 + rr.random() * 0.3
        xx += bw
    c[v > skyline[None, :].repeat(h, 0)] = tex.rgb('#2a0f3a')
    out[h:, :w] = frame(c, '#ffe7c4')
    # D: a gold house with a glow ring on deep green.
    d = tex.lerp(tex.rgb('#11a35a'), tex.rgb('#06402f'), v)
    ring = np.abs(np.hypot(u - 0.5, v - 0.52) - 0.33) < 0.02
    d[ring] = tex.rgb('#b8ffd9')
    body = (np.abs(u - 0.5) < 0.18) & (v > 0.48) & (v < 0.74)
    roof = (v < 0.5) & (v > 0.26) & (np.abs(u - 0.5) < (v - 0.26) * 1.0)
    d[body | roof] = tex.rgb('#ffd23a')
    door = (np.abs(u - 0.5) < 0.05) & (v > 0.6) & (v < 0.74)
    d[door] = tex.rgb('#0b5a34')
    out[h:, w:] = frame(d, '#e4ffe9')
    return np.clip(out, 0, 1)


def tex_streets(size=512, seed=61):
    """One city block and its streets from far above: dark roofs, sodium-lit streets, traffic."""
    r = np.random.default_rng(seed)
    S = size
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    img = np.broadcast_to(tex.rgb('#07080d'), (S, S, 3)).copy()
    blk = BLOCK / PITCH
    street = (x > blk) | (y > blk)
    img[street] = tex.rgb('#2b1d14')
    glowband = ((np.abs(x - blk) < 0.02) | (np.abs(x - 1) < 0.02) | (np.abs(y - blk) < 0.02) | (np.abs(y - 1) < 0.02))
    img[glowband & street] = tex.rgb('#7a4a1c')
    for _ in range(60):
        if r.random() < 0.5:
            px, py = blk + 0.015 + r.random() * 0.002, r.random()
        else:
            px, py = r.random(), blk + 0.015
        d = np.hypot(x - px, y - py)
        img += (np.exp(-d / 0.006) * 0.9)[..., None] * tex.rgb('#ffb04a')
    for _ in range(40):
        col = tex.rgb('#fff2d6') if r.random() < 0.5 else tex.rgb('#ff3a2a')
        if r.random() < 0.5:
            lx, ly = blk + 0.04 + r.random() * 0.12, r.random()
            m = (np.abs(x - lx) < 0.003) & (np.abs(y - ly) < 0.03)
        else:
            lx, ly = r.random(), blk + 0.04 + r.random() * 0.12
            m = (np.abs(y - ly) < 0.003) & (np.abs(x - lx) < 0.03)
        img[m] = col
    for _ in range(80):
        px, py = r.random() * blk, r.random() * blk
        img[(np.abs(x - px) < 0.004) & (np.abs(y - py) < 0.004)] = tex.rgb('#ffd590') * (0.4 + 0.6 * r.random())
    return np.clip(img, 0, 1)


# --------------------------------------------------------------------------
# Vertex-coloured meshes built quad by quad (city, glows)
# --------------------------------------------------------------------------

class Quads:
    """Collects coloured (optionally UV-mapped) quads in game space; build() makes one object."""

    def __init__(self):
        self.verts, self.faces, self.uvs, self.cols = [], [], [], []

    def quad(self, pts, col, uv=None):
        i = len(self.verts)
        self.verts += [(float(p[0]), -float(p[2]), float(p[1])) for p in pts]  # V() as plain tuples
        self.faces.append((i, i + 1, i + 2, i + 3))
        c = blib.hex_rgb(col) if isinstance(col, str) else col
        self.cols.append((c[0], c[1], c[2], 1.0))
        self.uvs.append(uv or [(0, 0)] * 4)

    def rect(self, c, u, v, col, uv=None):
        """A rectangle centred on c spanning ±u, ±v; its normal is u × v."""
        cx, cy, cz = c
        pts = [(cx - u[0] - v[0], cy - u[1] - v[1], cz - u[2] - v[2]),
               (cx + u[0] - v[0], cy + u[1] - v[1], cz + u[2] - v[2]),
               (cx + u[0] + v[0], cy + u[1] + v[1], cz + u[2] + v[2]),
               (cx - u[0] + v[0], cy - u[1] + v[1], cz - u[2] + v[2])]
        self.quad(pts, col, uv)

    def build(self, name, mat):
        if not self.faces:
            return None
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.uv_layers.new(name='UVMap')
        me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        # Look both up again: adding a layer can move the other's storage.
        uvl = me.uv_layers['UVMap']
        ca = me.color_attributes['Color']
        uv = np.zeros((len(me.loops), 2), np.float32)
        col = np.zeros((len(me.loops), 4), np.float32)
        for p in me.polygons:
            k = p.index
            for j, li in enumerate(range(p.loop_start, p.loop_start + p.loop_total)):
                uv[li] = self.uvs[k][j]
                col[li] = self.cols[k]
        uvl.data.foreach_set('uv', uv.ravel())
        ca.data.foreach_set('color', col.ravel())
        me.update()
        obj = bpy.data.objects.new(name, me)
        blib.link(obj)
        blib.assign(obj, mat)
        return obj


def glow_flat():
    """One unlit material for everything glowing in a plain colour: its colour lives in the vertices."""
    m = bpy.data.materials.get('GlowFlat')
    if m:
        return m
    m = bpy.data.materials.new('GlowFlat')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(vc.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0
    m.cycles.emission_sampling = 'NONE'  # city windows light nothing on the roof
    m['unlit'] = 1
    m['kind'] = 'glowflat'
    return m


def shade(n):
    """Fake moonlight for unlit city faces: a factor by which way a face looks."""
    nx, ny, nz = n
    if ny > 0.5:
        return 0.55
    return 0.78 + 0.22 * max(0.0, -nx * 0.55 - nz * 0.83)


def scale_col(col, k):
    c = blib.hex_rgb(col) if isinstance(col, str) else col
    return (c[0] * k, c[1] * k, c[2] * k)


SIDES = [((1, 0, 0), (0, 0, -1)), ((-1, 0, 0), (0, 0, 1)), ((0, 0, 1), (1, 0, 0)), ((0, 0, -1), (-1, 0, 0))]


# --------------------------------------------------------------------------
# Roof: pavers, parapet, railing with fairy lights, the building below
# --------------------------------------------------------------------------

def build_roof(objs, city_tex):
    pav = textured('Pavers', blib.image_from_array('pavers', tex_pavers(1024)), rough=0.9)
    # A grid out to the parapet, holed where the deck covers it.
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    n = 37
    step = 2 * R / n
    vs = [[bm.verts.new(V(-R + i * step, G, -R + j * step)) for i in range(n + 1)] for j in range(n + 1)]
    for j in range(n):
        for i in range(n):
            quad = (vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i])
            if max(math.hypot(v.co.x, v.co.y) for v in quad) < DECK_R - 0.4:
                continue
            f = bm.faces.new(quad)
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            for loop in f.loops:
                co = loop.vert.co
                loop[uv].uv = (co.x / 12.8, co.y / 12.8)
    objs.append(blib.new_mesh_object('Pavers', bm, pav))

    brick = textured('Brick', blib.image_from_array('brick', tex_brick(512)), rough=0.85)
    coping = flat(COPING, 0.7)
    o = R + PT
    for name, size, pos in [
        ('ParapetB', (2 * o, PH, PT), (0, G + PH / 2, -R - PT / 2)),
        ('ParapetF', (2 * o, PH, PT), (0, G + PH / 2, R + PT / 2)),
        ('ParapetL', (PT, PH, 2 * R), (-R - PT / 2, G + PH / 2, 0)),
        ('ParapetR', (PT, PH, 2 * R), (R + PT / 2, G + PH / 2, 0)),
    ]:
        objs.append(box(name, size, pos, brick))
    cy = G + PH + 0.16
    for name, size, pos in [
        ('CopingB', (2 * o + 0.3, 0.32, PT + 0.36), (0, cy, -R - PT / 2)),
        ('CopingF', (2 * o + 0.3, 0.32, PT + 0.36), (0, cy, R + PT / 2)),
        ('CopingL', (PT + 0.36, 0.32, 2 * R - 0.6), (-R - PT / 2, cy, 0)),
        ('CopingR', (PT + 0.36, 0.32, 2 * R - 0.6), (R + PT / 2, cy, 0)),
    ]:
        objs.append(box(name, size, pos, coping, bevel=0.06))
    # A dark skirting strip where the pavers meet the brick.
    for name, size, pos in [
        ('SkirtB', (2 * R, 0.25, 0.08), (0, G + 0.12, -R + 0.04)),
        ('SkirtF', (2 * R, 0.25, 0.08), (0, G + 0.12, R - 0.04)),
        ('SkirtL', (0.08, 0.25, 2 * R), (-R + 0.04, G + 0.12, 0)),
        ('SkirtR', (0.08, 0.25, 2 * R), (R - 0.04, G + 0.12, 0)),
    ]:
        objs.append(box(name, size, pos, flat('#4c4741', 0.8)))

    # The tower we stand on, falling away below the parapet (windows, unlit).
    q = Quads()
    for n_, u_ in SIDES:
        c = (n_[0] * o, (G + STREET) / 2, n_[2] * o)
        span = 2 * o
        tower_face(q, c, n_, u_, span, G, STREET, style=3, voff=G - 1.2, shade_k=0.9)
    own = q.build('CityOwn', city_tex)
    own['city'] = 1
    objs.append(own)
    build_railing(objs, cy + 0.16)


def build_railing(objs, y0):
    """Steel railing on the coping, fairy lights draped post to post (not behind the bulkhead)."""
    steel = flat(STEEL, 0.5)
    bulb = glow(WARM, 10.0, 'FairyBulb')
    wire = flat('#1a1a1a', 0.6)
    top = y0 + 1.6
    posts = 0
    for side in range(4):
        n_, u_ = SIDES[side]
        cx, cz = n_[0] * (R + PT / 2), n_[2] * (R + PT / 2)
        k = 16
        span = 2 * R / k
        for i in range(k + 1):
            t = -R + i * span
            x, z = cx + u_[0] * t, cz + u_[2] * t
            if x > 9.6 and z < -11.6:   # the bulkhead stands here
                continue
            objs.append(box(f'RailPost{posts}', (0.14, 1.6, 0.14), (x, y0 + 0.8, z), steel))
            posts += 1
            if i == k:
                continue
            nx, nz = cx + u_[0] * (t + span), cz + u_[2] * (t + span)
            if nx > 9.6 and nz < -11.6:
                continue
            # Top and middle rails.
            mx, mz = (x + nx) / 2, (z + nz) / 2
            along_x = abs(u_[0]) > 0.5
            size_top = (span, 0.1, 0.2) if along_x else (0.2, 0.1, span)
            size_mid = (span, 0.06, 0.06) if along_x else (0.06, 0.06, span)
            objs.append(box(f'RailTop{posts}', size_top, (mx, top, mz), steel, bevel=0.03, segments=1))
            objs.append(box(f'RailMid{posts}', size_mid, (mx, y0 + 0.75, mz), steel))
            # The fairy-light swag: a sagging wire with three bulbs.
            pts = []
            for s in range(7):
                f = s / 6
                pts.append((x + (nx - x) * f - n_[0] * 0.12, top - 0.12 - 0.42 * 4 * f * (1 - f), z + (nz - z) * f - n_[2] * 0.12))
            objs.append(tube(f'FairyWire{posts}', pts, 0.018, wire))
            for s, f in enumerate((0.25, 0.5, 0.75)):
                p = (x + (nx - x) * f - n_[0] * 0.12, top - 0.12 - 0.42 * 4 * f * (1 - f) - 0.13, z + (nz - z) * f - n_[2] * 0.12)
                objs.append(sphere(f'FairyBulb{posts}_{s}', 0.11, p, bulb, segs=8, rings=5))
            add_light(f'FairyL{posts}', 'POINT', (mx - n_[0] * 0.2, top - 0.5, mz - n_[2] * 0.2), WARM, 13, size=0.3)


# --------------------------------------------------------------------------
# The deck under the table
# --------------------------------------------------------------------------

def planar_uv(obj, scale):
    me = obj.data
    uvl = me.uv_layers['UVMap'] if 'UVMap' in me.uv_layers else me.uv_layers.new(name='UVMap')
    mw = obj.matrix_world
    for li, loop in enumerate(me.loops):
        co = mw @ me.vertices[loop.vertex_index].co
        uvl.data[li].uv = (co.x / scale, co.y / scale)


def face_out(obj):
    """Point a revolved sheet's faces up (flat parts) or away from the axis (bands): the bake lights the front."""
    for p in obj.data.polygons:
        n, c = p.normal, p.center
        want = n.z if abs(n.z) > 0.7 else n.x * c.x + n.y * c.y
        if want < 0:
            p.flip()
    return obj


def build_deck(objs):
    img = blib.image_from_array('deck', tex.planks(1024, rows=8, base='#b07a48', seed=11))
    deck = textured('Deck', img, rough=0.6)
    lip = DECK_R + 0.1
    top = lathe('DeckTop', [(7.4, F), (lip, F)], 128, (0, 0, 0), deck, cap_top=False, cap_bottom=False)
    face_out(top)
    planar_uv(top, 8.0)
    objs.append(top)
    under = face_out(lathe('DeckUnder', [(0, F - 0.01), (7.45, F - 0.01)], 48, (0, 0, 0), deck, cap_top=False, cap_bottom=False))
    planar_uv(under, 8.0)
    objs.append(under)
    # The lip, a recessed fascia with an LED strip tucked under it.
    objs.append(face_out(lathe('DeckLip', [(lip, F - 0.1), (lip + 0.03, F - 0.05), (lip, F)], 128, (0, 0, 0), flat(TEAK_DARK, 0.6),
                      cap_top=False, cap_bottom=False)))
    objs.append(face_out(lathe('DeckFascia', [(DECK_R - 0.15, G), (DECK_R - 0.15, F - 0.18), (lip, F - 0.1)], 128, (0, 0, 0),
                      flat('#3a2416', 0.6), cap_top=False, cap_bottom=False)))
    objs.append(face_out(lathe('DeckLED', [(DECK_R - 0.12, F - 0.19), (DECK_R - 0.12, F - 0.12)], 128, (0, 0, 0),
                      glow('#ffd9a0', 6.0, 'DeckLED'), cap_top=False, cap_bottom=False)))
    # A brass inlay ring and eight brass studs (they read from overhead).
    brass = flat(BRASS, 0.35)
    objs.append(face_out(lathe('DeckInlay', [(11.85, F + 0.004), (12.05, F + 0.004)], 128, (0, 0, 0), brass, cap_top=False, cap_bottom=False)))
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        objs.append(cylinder(f'DeckStud{k}', 0.22, 0.03, (math.cos(a) * 11.95, F, math.sin(a) * 11.95), brass, segs=12))


# --------------------------------------------------------------------------
# Festoon strings on poles round the deck
# --------------------------------------------------------------------------

def planter_pot(name, pos, r=1.15, h=2.3, mat=None):
    mat = mat or flat('#8f8a82', 0.85)
    return lathe(name, [(r * 0.78, 0), (r * 0.8, 0.12), (r, h - 0.25), (r * 1.08, h - 0.2), (r * 1.08, h), (r * 0.95, h),
                        (r * 0.93, h - 0.12), (0, h - 0.12)], 24, pos, mat)


def build_festoons(objs):
    steel = flat(STEEL, 0.45)
    wire = flat('#1c1b1a', 0.6)
    bulb = glow(WARM, 14.0, 'FestoonBulb')
    socket = flat('#26231f', 0.5)
    poles = []
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        x, z = math.cos(a) * 15.4, math.sin(a) * 15.4
        poles.append((x, z))
        objs.append(planter_pot(f'PolePot{k}', (x, G, z)))
        objs.append(cylinder(f'PoleSoil{k}', 1.12, 0.05, (x, G + 2.15, z), flat('#2b1f17', 0.95), segs=20))
        objs.append(ico(f'PoleShrub{k}', 1.05, (x, G + 2.75, z), flat(LEAF[k % 5], 0.8), subdiv=2, jitter=0.1,
                        scale=(1, 0.75, 1), seed=k))
        objs.append(cylinder(f'Pole{k}', 0.11, 11.6, (x, G + 1.5, z), steel, segs=10))
        objs.append(sphere(f'PoleCap{k}', 0.2, (x, G + 13.15, z), steel, segs=10, rings=6))
        objs.append(blib.torus(f'PoleRing{k}', 0.16, 0.04, (x, G + 12.5, z), steel, seg=10, mseg=4))
    top = G + 12.5
    nb = 0
    for k in range(8):
        (x0, z0), (x1, z1) = poles[k], poles[(k + 1) % 8]
        sag = 1.9
        pts = []
        n = 12
        for i in range(n + 1):
            t = i / n
            pts.append((x0 + (x1 - x0) * t, top - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t))
        objs.append(tube(f'FestoonWire{k}', pts, 0.03, wire))
        for i in range(1, 10):
            t = i / 10
            p = (x0 + (x1 - x0) * t, top - sag * 4 * t * (1 - t), z0 + (z1 - z0) * t)
            objs.append(cylinder(f'Socket{nb}', 0.07, 0.22, (p[0], p[1] - 0.22, p[2]), socket, segs=8))
            objs.append(sphere(f'FestoonBulb{nb}', 0.19, (p[0], p[1] - 0.38, p[2]), bulb, scale=(1, 1.2, 1), segs=10, rings=6))
            add_light(f'FestoonL{nb}', 'POINT', (p[0], p[1] - 0.4, p[2]), WARM, 50, size=0.25)
            nb += 1


# --------------------------------------------------------------------------
# Stair bulkhead (back right) with a water tower and a mast on its roof
# --------------------------------------------------------------------------

HUT = (10.2, R, -R, -12.0)   # x0, x1, z0, z1
HUT_H = 15.0


def build_hut(objs):
    x0, x1, z0, z1 = HUT
    top = G + HUT_H
    brick = blib._mats['Brick']
    door_x0, door_x1, door_h = 12.4, 17.0, 10.8
    # Walls: left, back is the parapet's corner, front in pieces round the door.
    objs.append(box('HutLeft', (0.8, HUT_H, z1 - z0), (x0 + 0.4, G + HUT_H / 2, (z0 + z1) / 2), brick))
    objs.append(box('HutRight', (0.8, HUT_H, z1 - z0), (x1 + PT - 0.4, G + HUT_H / 2, (z0 + z1) / 2), brick))
    objs.append(box('HutBack', (x1 + PT - x0, HUT_H, 0.8), ((x0 + x1 + PT) / 2, G + HUT_H / 2, z0 - PT + 0.4), brick))
    fz = z1 - 0.4
    objs.append(box('HutFrontL', (door_x0 - x0, HUT_H, 0.8), ((x0 + door_x0) / 2, G + HUT_H / 2, fz), brick))
    objs.append(box('HutFrontR', (x1 + PT - door_x1, HUT_H, 0.8), ((door_x1 + x1 + PT) / 2, G + HUT_H / 2, fz), brick))
    objs.append(box('HutFrontT', (door_x1 - door_x0, HUT_H - door_h, 0.8), ((door_x0 + door_x1) / 2, G + door_h + (HUT_H - door_h) / 2, fz), brick))
    objs.append(box('HutRoof', (x1 + PT - x0, 0.5, z1 - z0 + PT), ((x0 + x1 + PT) / 2, top - 0.25, (z0 - PT + z1) / 2), flat('#55504a', 0.9)))
    # Cornice and a stone plinth.
    stone = flat(COPING, 0.7)
    objs.append(box('HutCorniceF', (x1 + PT - x0 + 0.6, 0.55, 0.6), ((x0 + x1 + PT) / 2, top + 0.1, z1 + 0.1), stone, bevel=0.08))
    objs.append(box('HutCorniceL', (0.6, 0.55, z1 - z0 + PT + 0.6), (x0 - 0.1, top + 0.1, (z0 - PT + z1) / 2), stone, bevel=0.08))
    objs.append(box('HutPlinthF', (x1 + PT - x0 + 0.1, 0.7, 0.9), ((x0 + x1 + PT) / 2, G + 0.35, z1 - 0.4), flat('#5d5850', 0.8)))
    objs.append(box('HutPlinthL', (0.9, 0.7, z1 - z0), (x0 + 0.4, G + 0.35, (z0 + z1) / 2), flat('#5d5850', 0.8)))
    # Door frame, a step, the left leaf shut and the right leaf ajar.
    frame = flat('#2c3a35', 0.5)
    for name, size, pos in [
        ('DoorJambL', (0.35, door_h, 0.95), (door_x0 + 0.17, G + door_h / 2, fz)),
        ('DoorJambR', (0.35, door_h, 0.95), (door_x1 - 0.17, G + door_h / 2, fz)),
        ('DoorHead', (door_x1 - door_x0, 0.4, 0.95), ((door_x0 + door_x1) / 2, G + door_h - 0.2, fz)),
    ]:
        objs.append(box(name, size, pos, frame, bevel=0.04))
    objs.append(box('DoorStep', (door_x1 - door_x0 + 1.2, 0.3, 1.4), ((door_x0 + door_x1) / 2, G + 0.15, z1 + 0.5), stone, bevel=0.05))
    leaf_w = (door_x1 - door_x0 - 0.7) / 2
    door = flat('#2f5a4c', 0.45)
    lx = door_x0 + 0.35 + leaf_w / 2
    objs.append(box('DoorLeafL', (leaf_w, door_h - 0.45, 0.2), (lx, G + (door_h - 0.45) / 2, z1 - 0.3), door, bevel=0.04))
    objs.append(box('DoorKickL', (leaf_w - 0.3, 1.2, 0.05), (lx, G + 0.9, z1 - 0.18), flat(GALV, 0.4)))
    objs.append(box('DoorPanelL', (leaf_w * 0.55, 2.6, 0.05), (lx, G + 7.2, z1 - 0.18), glow('#ffd59a', 3.0, 'DoorGlass')))
    hinge = (door_x1 - 0.35, z1 - 0.3)
    open_a = math.radians(-58)
    parts = [box('DoorLeafR', (leaf_w, door_h - 0.45, 0.2), (-leaf_w / 2, (door_h - 0.45) / 2, 0), door, bevel=0.04),
             box('DoorKickR', (leaf_w - 0.3, 1.2, 0.05), (-leaf_w / 2, 0.9, 0.12), flat(GALV, 0.4)),
             box('DoorPanelR', (leaf_w * 0.55, 2.6, 0.05), (-leaf_w / 2, 7.2, 0.12), glow('#ffd59a', 3.0, 'DoorGlass')),
             box('DoorBar', (leaf_w * 0.8, 0.14, 0.18), (-leaf_w / 2, 4.4, 0.2), flat(GALV, 0.3))]
    objs.extend(group('DoorR', (hinge[0], G, hinge[1]), open_a, parts))
    # Inside: a warm stairwell glow seen through the gap, lighting a wedge of deck.
    objs.append(blib.plane('StairGlow', door_x1 - door_x0, door_h, ((door_x0 + door_x1) / 2, G + door_h / 2, z1 - 3.2),
                           glow('#ffcf8e', 2.5, 'StairGlow')))
    objs.append(box('StairFloor', (door_x1 - door_x0, 0.1, 3.0), ((door_x0 + door_x1) / 2, G + 0.05, z1 - 1.7), flat('#6a5d4e', 0.8)))
    L = add_light('Doorway', 'AREA', ((door_x0 + door_x1) / 2 + 0.8, G + 5.0, z1 - 1.0), '#ffc887', 900, size=3.6,
                  shape='RECTANGLE')
    aim(L, (door_x0 - 2, G, z1 + 9))
    # Awning and a caged lamp over the door.
    objs.append(box('Awning', (door_x1 - door_x0 + 1.6, 0.25, 2.0), ((door_x0 + door_x1) / 2, G + door_h + 1.2, z1 + 0.9),
                    flat('#22302b', 0.5), bevel=0.05))
    for s in (-1, 1):
        objs.append(tube(f'AwningRod{s}', [((door_x0 + door_x1) / 2 + s * 2.6, G + door_h + 2.8, z1),
                                           ((door_x0 + door_x1) / 2 + s * 2.6, G + door_h + 1.3, z1 + 1.8)], 0.04, steel_mat()))
    objs.append(sphere('DoorLamp', 0.3, ((door_x0 + door_x1) / 2, G + door_h + 0.75, z1 + 1.2), glow('#ffe1b0', 8.0, 'DoorLamp'),
                       segs=12, rings=8))
    L = add_light('DoorLampL', 'SPOT', ((door_x0 + door_x1) / 2, G + door_h + 0.6, z1 + 1.4), '#ffd49a', 1400, size=0.4, spot=120)
    aim(L, ((door_x0 + door_x1) / 2, G, z1 + 4))
    # A ladder up the left wall, a meter box, conduit.
    rail = flat('#3b4048', 0.4)
    lz = (z0 + z1) / 2 + 1.5
    for s in (-1, 1):
        objs.append(box(f'LadderRail{s}', (0.12, HUT_H + 1.5, 0.12), (x0 - 0.45, G + (HUT_H + 1.5) / 2, lz + s * 0.8), rail))
    for i in range(14):
        objs.append(box(f'LadderRung{i}', (0.08, 0.08, 1.6), (x0 - 0.45, G + 1.0 + i * 1.08, lz), rail))
    for s in (-1, 1):
        objs.append(box(f'LadderStay{s}', (0.5, 0.1, 0.1), (x0 - 0.2, G + 3 + (s + 1) * 4.5, lz + 0.8), rail))
    objs.append(box('MeterBox', (2.0, 2.6, 0.6), (x0 + 2.2, G + 4.2, z1 + 0.25), flat('#8f969c', 0.5), bevel=0.06))
    objs.append(box('MeterSign', (0.8, 0.5, 0.05), (x0 + 2.2, G + 4.7, z1 + 0.57), flat('#e8c23a', 0.6)))
    objs.append(tube('Conduit', [(x0 + 2.2, G + 2.9, z1 + 0.2), (x0 + 2.2, G + 0.6, z1 + 0.2), (x0 + 2.2, G + 0.25, z1 + 1.2)],
                     0.08, flat(GALV, 0.4)))
    build_water_tower(objs, ((x0 + x1) / 2 + 0.3, top, (z0 + z1) / 2 - 0.2))
    # A radio mast with a red light on the back corner.
    mx, mz = x1 - 0.5, z0 + 0.6
    objs.append(cylinder('Mast', 0.16, 16.0, (mx, top, mz), flat('#8c939c', 0.4), segs=8, r_top=0.08))
    for i in range(3):
        objs.append(cylinder(f'MastRing{i}', 0.32, 0.12, (mx, top + 4 + i * 4, mz), flat('#8c939c', 0.4), segs=8))
    objs.append(sphere('MastBeacon', 0.3, (mx, top + 16.2, mz), glow('#ff2a2a', 10.0, 'Beacon'), segs=10, rings=6))
    # A mushroom exhaust fan on the roof.
    objs.append(lathe('ExhaustFan', [(0.9, 0), (0.9, 0.9), (1.5, 1.1), (1.4, 1.5), (0.4, 1.9), (0, 1.9)], 20,
                      (x0 + 1.8, top, z1 - 1.6), flat(GALV, 0.4)))


def steel_mat():
    return flat(STEEL, 0.45)


def build_water_tower(objs, base):
    bx, by, bz = base
    steel = flat('#3a3e45', 0.5)
    legs_h = 4.2
    rr = 2.4
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        x, z = bx + math.cos(a) * rr, bz + math.sin(a) * rr
        objs.append(box(f'TankLeg{k}', (0.32, legs_h, 0.32), (x, by + legs_h / 2, z), steel))
        objs.append(box(f'TankFoot{k}', (0.8, 0.2, 0.8), (x, by + 0.1, z), steel))
    for k in range(4):
        a0 = math.pi / 4 + k * math.pi / 2
        a1 = a0 + math.pi / 2
        p0 = (bx + math.cos(a0) * rr, by + 0.5, bz + math.sin(a0) * rr)
        p1 = (bx + math.cos(a1) * rr, by + legs_h - 0.3, bz + math.sin(a1) * rr)
        objs.append(tube(f'TankBrace{k}a', [p0, p1], 0.06, steel))
        objs.append(tube(f'TankBrace{k}b', [(p0[0], p1[1], p0[2]), (p1[0], p0[1], p1[2])], 0.06, steel))
    objs.append(box('TankDeck', (6.4, 0.3, 6.4), (bx, by + legs_h + 0.15, bz), flat('#4a3a2c', 0.8), bevel=0.04))
    # Stave tank: alternate staves a shade apart, steel hoops round it.
    y0 = by + legs_h + 0.3
    th = 6.4
    tank = lathe('Tank', [(0, y0), (3.0, y0), (3.05, y0 + 0.3), (3.05, y0 + th), (0, y0 + th)], 28, (bx, 0, bz),
                 flat('#7b5236', 0.85), cap_top=False, cap_bottom=False, hard_angle=20)
    tank.data.materials.append(flat('#6a4630', 0.85))
    for p in tank.data.polygons:
        if abs(p.normal.z) < 0.5:
            p.material_index = p.index % 2
    objs.append(tank)
    for i, y in enumerate((y0 + 0.9, y0 + 2.6, y0 + 4.3, y0 + 5.8)):
        objs.append(blib.torus(f'TankHoop{i}', 3.1, 0.07, (bx, y, bz), flat('#2b2b2e', 0.4), seg=32, mseg=5))
    objs.append(lathe('TankRoof', [(3.35, y0 + th - 0.1), (3.35, y0 + th + 0.15), (0.5, y0 + th + 2.6), (0.25, y0 + th + 2.75),
                                   (0, y0 + th + 2.75)], 28, (bx, 0, bz), flat('#3c4049', 0.6), cap_top=False, cap_bottom=True))
    objs.append(sphere('TankFinial', 0.3, (bx, y0 + th + 3.0, bz), flat('#3c4049', 0.5), segs=10, rings=6))
    objs.append(box('TankHatch', (1.0, 0.8, 0.2), (bx - 1.4, y0 + th + 1.0, bz + 2.0), flat('#3c4049', 0.6), rot_y=0.6))


# --------------------------------------------------------------------------
# HVAC: two condensers along the right parapet, ducts into the bulkhead
# --------------------------------------------------------------------------

def condenser(name, pos, yaw):
    body = flat(UNIT, 0.5)
    dark = flat('#24282e', 0.6)
    parts = [box(f'{name}Body', (3.6, 3.6, 4.4), (0, 0.5 + 1.8, 0), body, bevel=0.12),
             box(f'{name}RailA', (3.9, 0.5, 0.35), (0, 0.25, -1.6), flat(STEEL_MID, 0.6)),
             box(f'{name}RailB', (3.9, 0.5, 0.35), (0, 0.25, 1.6), flat(STEEL_MID, 0.6))]
    # Louvres on the side the table sees.
    for i in range(9):
        parts.append(box(f'{name}Louvre{i}', (0.08, 0.16, 3.6), (-1.82, 1.0 + i * 0.32, 0), dark))
    parts.append(lathe(f'{name}Shroud', [(1.55, 0), (1.55, 0.35), (1.45, 0.35), (1.45, 0.1), (0, 0.1)], 28,
                       (0, 4.1, 0), flat('#d0d4d8', 0.5), cap_top=False, cap_bottom=False))
    for i, rr in enumerate((1.4, 1.0, 0.6)):
        parts.append(blib.torus(f'{name}Grille{i}', rr, 0.035, (0, 4.42, 0), dark, seg=24, mseg=4))
    for k in range(4):
        blade = box(f'{name}Blade{k}', (1.2, 0.05, 0.4), (0.65, 4.25, 0), flat('#3a3f46', 0.5))
        parts.append(blade)
    hub = cylinder(f'{name}Hub', 0.3, 0.2, (0, 4.2, 0), dark, segs=12)
    parts.append(hub)
    objs = group(name, pos, yaw, parts)
    # Spin the blades round the hub.
    for k in range(4):
        b = parts[3 + 9 + 1 + 3 + k]
        a = k * math.pi / 2 + 0.3
        b.location = V(math.cos(a) * 0.7, 4.25, math.sin(a) * 0.7)
        b.rotation_euler = (0.25, 0, -a)
    return objs


def build_hvac(objs):
    # Between the two right-hand festoon poles.
    objs += condenser('CondA', (16.3, G, -2.3), 0.0)
    objs += condenser('CondB', (16.3, G, 2.3), 0.0)
    galv = flat(GALV, 0.4)
    seam = flat('#868c93', 0.5)
    # A rectangular duct along the parapet from the units into the bulkhead.
    dy = G + 3.2
    dx = 17.6
    objs.append(box('Duct', (1.3, 1.3, 7.4), (dx, dy, -8.3), galv))
    for i in range(3):
        objs.append(box(f'DuctFlange{i}', (1.45, 1.45, 0.14), (dx, dy, -5.4 - i * 2.6), seam))
    objs.append(box('DuctRise', (1.3, 3.0, 1.3), (dx, G + 1.5 + 0.25, -5.2), galv))
    objs.append(box('DuctFoot', (1.6, 0.25, 1.6), (dx, G + 0.12, -5.2), seam))
    objs.append(box('DuctHood', (1.7, 0.4, 1.7), (dx, dy + 0.85, -5.2), seam, bevel=0.05))
    for z in (-7.6, -10.4):
        objs.append(box(f'DuctStand{z}', (1.1, dy - 0.65 - G, 0.18), (dx, G + (dy - 0.65 - G) / 2, z), flat(STEEL_MID, 0.6)))
    # Refrigerant lines from each unit along the floor to the bulkhead.
    cu = flat('#2a2a2a', 0.6)
    for k, z in enumerate((-2.3, 2.3)):
        x = 15.9 - k * 0.3
        objs.append(tube(f'Line{k}', [(14.6, G + 0.8, z - 1.2), (x, G + 0.2, z - 1.2), (x, G + 0.2, -5.2 + k * 0.1),
                                      (x + 0.3 * (1 - k), G + 0.2, -11.6), (x + 0.3 * (1 - k), G + 1.5, -11.95)], 0.09, cu))
    # Gooseneck vents.
    for k, (x, z) in enumerate([(-17.6, 12.6), (17.2, 14.8), (-6.0, 17.4)]):
        objs.append(tube(f'Vent{k}', [(x, G, z), (x, G + 1.6, z), (x + 0.3, G + 2.1, z), (x + 0.7, G + 2.0, z)], 0.22, galv))


# --------------------------------------------------------------------------
# Lounge corner (back left): an L sofa, a fire pit, lanterns, a rug
# --------------------------------------------------------------------------

def sofa_run(name, start, length, yaw, cushions=('#e9e1d0',), arm_end=True, arm_start=False):
    """A run of outdoor sofa along local +x from start, seat facing local +z."""
    teak = flat(TEAK, 0.55)
    cush = flat(CUSHION, 0.9)
    back = flat('#e2d8c4', 0.9)
    D = 3.5
    parts = [box(f'{name}Frame', (length, 1.1, D), (length / 2, 0.75, 0), teak, bevel=0.08),
             box(f'{name}Plinth', (length - 0.3, 0.2, D - 0.4), (length / 2, 0.1, 0), flat(TEAK_DARK, 0.6))]
    n = max(1, round(length / 2.8))
    sw = length / n
    for i in range(n):
        cx = sw * (i + 0.5)
        parts.append(box(f'{name}Seat{i}', (sw - 0.12, 0.85, D - 0.9), (cx, 1.75, 0.35), cush, bevel=0.3, segments=3))
        parts.append(box(f'{name}Back{i}', (sw - 0.15, 2.3, 0.85), (cx, 3.05, -D / 2 + 0.6), back, bevel=0.32, segments=3))
    parts.append(box(f'{name}BackRail', (length, 1.6, 0.35), (length / 2, 1.9, -D / 2 + 0.17), teak, bevel=0.06))
    for s, on in ((0, arm_start), (length, arm_end)):
        if on:
            parts.append(box(f'{name}Arm{s}', (0.55, 2.2, D), (s, 1.4, 0), teak, bevel=0.1))
    return group(name, start, yaw, parts)


def build_lounge(objs):
    # The rug: navy with a cream border and stripes.
    rx, rz, rs = -13.6, -13.6, 9.2
    objs.append(box('Rug', (rs, 0.05, rs), (rx, G + 0.025, rz), flat('#e6dcc6', 0.95)))
    objs.append(box('RugField', (rs - 1.0, 0.055, rs - 1.0), (rx, G + 0.03, rz), flat(NAVY, 0.95)))
    for k in range(4):
        objs.append(box(f'RugStripe{k}', (rs - 1.0, 0.06, 0.18), (rx, G + 0.032, rz - 2.8 + k * 1.86), flat('#d9cdb3', 0.95)))
    # L sofa in the corner: one run along the back parapet, one along the left.
    objs += sofa_run('SofaBack', (-17.95, G, -16.2), 8.6, 0.0, arm_end=True)
    objs += sofa_run('SofaLeft', (-16.2, G, -7.45), 7.0, math.pi / 2, arm_end=False, arm_start=True)
    # Throw pillows.
    for k, (pos, col, yaw) in enumerate([((-16.6, G + 3.0, -16.4), '#e0a63a', 0.6), ((-12.4, G + 3.0, -16.6), '#2f8f8a', 0.1),
                                         ((-16.5, G + 3.0, -11.9), '#e0644f', 1.4), ((-10.6, G + 3.0, -16.6), '#e0644f', -0.15)]):
        p = box(f'Pillow{k}', (1.5, 1.4, 0.45), pos, flat(col, 0.9), rot_y=yaw, bevel=0.2, segments=3)
        p.rotation_euler = (math.radians(-12), 0, yaw)
        objs.append(p)
    # Round concrete fire pit with flames over dark glass.
    fx, fz = -12.0, -12.0
    objs.append(lathe('FirePit', [(1.7, 0), (1.85, 0.1), (2.15, 1.55), (2.25, 1.65), (2.2, 1.75), (1.6, 1.75), (1.5, 1.45), (0, 1.45)],
                      32, (fx, G, fz), flat('#9d968c', 0.85)))
    objs.append(cylinder('FireGlass', 1.5, 0.12, (fx, G + 1.45, fz), flat('#1d2a3a', 0.3), segs=24))
    flame = glow('#ff9a30', 3.0, 'Flame')
    core = glow('#ffe08a', 3.0, 'FlameCore')
    ember = glow('#ff6a1a', 2.0, 'Ember')
    for k, (dx, dz, h, lean) in enumerate([(-0.55, 0.2, 1.5, -0.2), (0.25, -0.35, 2.0, 0.1), (0.65, 0.45, 1.2, 0.25),
                                           (-0.15, -0.8, 1.1, -0.1), (0.05, 0.25, 1.7, 0.05), (-0.7, -0.4, 1.0, -0.3)]):
        objs.append(flame_tongue(f'Flame{k}', (fx + dx, G + 1.5, fz + dz), 0.42, h, lean, flame))
        if k < 4:
            objs.append(flame_tongue(f'FlameCore{k}', (fx + dx * 0.8, G + 1.5, fz + dz * 0.8), 0.24, h * 0.6, lean, core))
    for k in range(10):
        a = k * 2.4
        objs.append(sphere(f'Ember{k}', 0.13, (fx + math.cos(a) * (0.5 + 0.08 * k), G + 1.55, fz + math.sin(a) * (0.5 + 0.08 * k)),
                           ember, scale=(1, 0.6, 1), segs=6, rings=4))
    add_light('Fire', 'POINT', (fx, G + 2.4, fz), '#ff8a2e', 1700, size=0.7)
    # Lanterns at the sofa ends and a side table.
    for k, (x, z) in enumerate([(-8.1, -17.2), (-17.4, -5.5)]):
        lantern(objs, f'Lantern{k}', (x, G, z), 3.0)
    objs.append(cylinder('SideTable', 0.9, 0.12, (-8.4, G + 2.0, -14.0), flat(TEAK, 0.5), segs=20, bevel=0.03))
    objs.append(cylinder('SideTableStem', 0.12, 2.0, (-8.4, G, -14.0), flat(STEEL, 0.4), segs=8))
    objs.append(cylinder('SideTableFoot', 0.6, 0.1, (-8.4, G, -14.0), flat(STEEL, 0.4), segs=16))
    for k, (dx, dz, col) in enumerate([(-0.3, 0.2, '#e85d75'), (0.3, -0.15, '#ffc94a')]):
        objs.append(lathe(f'Glass{k}', [(0.12, 0), (0.12, 0.05), (0.03, 0.08), (0.03, 0.35), (0.26, 0.55), (0.24, 0.62), (0, 0.42)],
                          12, (-8.4 + dx, G + 2.12, -14.0 + dz), flat(col, 0.3), cap_top=False))


def flame_tongue(name, pos, r, h, lean, mat):
    """A teardrop flame leaning a little, so the fire reads as tongues rather than blobs."""
    o = lathe(name, [(0, 0), (r * 0.8, h * 0.08), (r, h * 0.25), (r * 0.75, h * 0.55), (r * 0.3, h * 0.85), (0, h)], 10, pos, mat)
    o.rotation_euler = (lean, lean * 0.6, 0)
    return o


def lantern(objs, name, pos, h):
    x, y, z = pos
    dark = flat('#1f2124', 0.5)
    objs.append(box(f'{name}Base', (1.1, 0.25, 1.1), (x, y + 0.12, z), dark, bevel=0.04))
    for sx in (-1, 1):
        for sz in (-1, 1):
            objs.append(box(f'{name}Post{sx}{sz}', (0.1, h - 0.6, 0.1), (x + sx * 0.45, y + 0.25 + (h - 0.6) / 2, z + sz * 0.45), dark))
    objs.append(box(f'{name}Glass', (0.75, h - 0.9, 0.75), (x, y + 0.3 + (h - 0.9) / 2, z), glow('#ffcb7d', 2.2, 'LanternGlass')))
    objs.append(lathe(f'{name}Roof', [(0.75, 0), (0.75, 0.15), (0.2, 0.55), (0, 0.6)], 4, (x, y + h - 0.35, z), dark, smooth_shade=False))
    objs.append(blib.torus(f'{name}Ring', 0.22, 0.04, (x, y + h + 0.45, z), dark, seg=12, mseg=4))
    objs[-1].rotation_euler = (math.pi / 2, 0, 0)
    add_light(f'{name}L', 'POINT', (x, y + h * 0.5, z), '#ffbf6e', 160, size=0.3)


# --------------------------------------------------------------------------
# Neon sign over the back parapet
# --------------------------------------------------------------------------

def build_neon(objs):
    cz = -R - PT / 2
    w, h = 13.0, 5.2
    y0 = G + PH + 2.4
    steel = flat(STEEL, 0.45)
    for s in (-1, 1):
        objs.append(box(f'SignPost{s}', (0.3, y0 + h - G - PH, 0.3), (s * (w / 2 - 1.0), G + PH + (y0 + h - G - PH) / 2, cz - 0.3), steel))
    objs.append(box('SignBoard', (w, h, 0.35), (0, y0 + h / 2, cz - 0.1), flat('#1b1f33', 0.7), bevel=0.06))
    objs.append(box('SignTrimT', (w + 0.3, 0.25, 0.5), (0, y0 + h + 0.1, cz), flat('#3a3f52', 0.5)))
    objs.append(box('SignTrimB', (w + 0.3, 0.25, 0.5), (0, y0 - 0.1, cz), flat('#3a3f52', 0.5)))
    z = cz + 0.3
    pink = glow(NEON_PINK, 12.0, 'NeonPink')
    cyan = glow(NEON_CYAN, 12.0, 'NeonCyan')
    gold = glow(NEON_GOLD, 12.0, 'NeonGold')
    # A neon skyline, a wave under it, a star and a crescent moon.
    sx = [-5.4, -5.4, -4.2, -4.2, -3.6, -3.6, -2.4, -2.4, -1.6, -1.6, -1.0, -1.0, 0.4, 0.4, 1.2, 1.2, 2.0, 2.0, 3.0, 3.0]
    sy = [0.9, 2.4, 2.4, 3.3, 3.3, 2.0, 2.0, 4.0, 4.0, 4.6, 4.0, 2.7, 2.7, 3.6, 3.6, 2.2, 2.2, 3.0, 3.0, 0.9]
    objs.append(tube('NeonSkyline', [(x, y0 + y, z) for x, y in zip(sx, sy)], 0.075, cyan))
    wave = [(-5.8 + i * 0.3, y0 + 0.6 + 0.18 * math.sin(i * 0.9), z + 0.05) for i in range(31)]
    objs.append(tube('NeonWave', wave, 0.07, pink))
    star = []
    for i in range(11):
        a = math.pi / 2 + i * math.pi / 5
        rr = 0.95 if i % 2 == 0 else 0.4
        star.append((4.4 + math.cos(a) * rr, y0 + 3.2 + math.sin(a) * rr, z))
    objs.append(tube('NeonStar', star, 0.07, gold))
    moon = [(5.2 + 0.7 * math.cos(a), y0 + 1.5 + 0.7 * math.sin(a), z) for a in np.linspace(0.9, 5.4, 18)]
    moon += [(5.45 + 0.55 * math.cos(a), y0 + 1.5 + 0.55 * math.sin(a), z) for a in np.linspace(5.0, 1.3, 14)]
    objs.append(tube('NeonMoon', moon, 0.065, pink))
    # Marquee bulbs round the board.
    bulb = glow(WARM, 10.0, 'MarqueeBulb')
    k = 0
    for i in range(23):
        x = -w / 2 + 0.3 + i * (w - 0.6) / 22
        for y in (y0 + 0.22, y0 + h - 0.22):
            objs.append(sphere(f'Marquee{k}', 0.1, (x, y, z), bulb, segs=8, rings=5))
            k += 1
    L = add_light('NeonPinkL', 'AREA', (-1.0, y0 + 1.2, cz + 1.4), NEON_PINK, 520, size=6.0, shape='RECTANGLE')
    aim(L, (-1.0, G, cz + 8))
    L = add_light('NeonCyanL', 'AREA', (-2.0, y0 + 3.0, cz + 1.4), NEON_CYAN, 420, size=6.0, shape='RECTANGLE')
    aim(L, (-2.0, G, cz + 9))
    add_light('NeonGoldL', 'POINT', (4.4, y0 + 3.2, cz + 1.0), NEON_GOLD, 60, size=0.6)


# --------------------------------------------------------------------------
# Planters, a telescope, sun loungers, a skylight
# --------------------------------------------------------------------------

def shrubs_in(objs, name, x0, x1, z0, z1, y, seed, flowers=None, size=0.9):
    r = np.random.default_rng(seed)
    n = max(2, int(((x1 - x0) + (z1 - z0)) / (size * 1.5)))
    for k in range(n):
        t = (k + 0.5) / n
        x = x0 + (x1 - x0) * t + (r.random() - 0.5) * 0.3
        z = z0 + (z1 - z0) * t + (r.random() - 0.5) * 0.3
        s = size * (0.8 + r.random() * 0.45)
        objs.append(ico(f'{name}Shrub{k}', s, (x, y + s * 0.55, z), flat(LEAF[int(r.random() * 5)], 0.8), subdiv=2,
                        jitter=0.12, scale=(1, 0.85, 1), seed=seed + k))
        if flowers and r.random() < 0.7:
            for j in range(4):
                a = r.random() * 6.28
                objs.append(sphere(f'{name}Flower{k}_{j}', 0.13, (x + math.cos(a) * s * 0.6, y + s * (1.0 + r.random() * 0.25),
                                                                   z + math.sin(a) * s * 0.6), flat(flowers[j % len(flowers)], 0.7),
                                   segs=6, rings=4))


def long_planter(objs, name, x0, x1, z0, z1, h=2.2, seed=0, flowers=None):
    teak = flat(TEAK, 0.6)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    objs.append(box(f'{name}Box', (x1 - x0, h, z1 - z0), (cx, G + h / 2, cz), teak, bevel=0.06))
    # Slatted cladding: a few dark grooves.
    along_x = (x1 - x0) > (z1 - z0)
    for k in range(1, 4):
        y = G + h * k / 4
        size = (x1 - x0 + 0.02, 0.05, z1 - z0 + 0.02)
        objs.append(box(f'{name}Groove{k}', size, (cx, y, cz), flat(TEAK_DARK, 0.6)))
    objs.append(box(f'{name}Soil', (x1 - x0 - 0.3, 0.1, z1 - z0 - 0.3), (cx, G + h - 0.12, cz), flat('#2b1f17', 0.95)))
    inset = 0.6
    if along_x:
        shrubs_in(objs, name, x0 + inset, x1 - inset, cz, cz, G + h - 0.2, seed, flowers)
    else:
        shrubs_in(objs, name, cx, cx, z0 + inset, z1 - inset, G + h - 0.2, seed, flowers)


def tree_pot(objs, name, pos, h=7.5, seed=0):
    x, y, z = pos
    objs.append(planter_pot(f'{name}Pot', (x, y, z), r=1.5, h=2.8, mat=flat('#3d4249', 0.6)))
    objs.append(cylinder(f'{name}Soil', 1.45, 0.05, (x, y + 2.62, z), flat('#2b1f17', 0.95), segs=20))
    r = np.random.default_rng(seed)
    objs.append(tube(f'{name}Trunk', [(x, y + 2.6, z), (x + 0.2, y + h * 0.5, z - 0.1), (x - 0.1, y + h * 0.8, z + 0.1)], 0.16,
                     flat('#5a4030', 0.8)))
    for k in range(5):
        a = k * 1.3 + r.random()
        rr = 0.6 + r.random() * 0.8
        s = 1.4 + r.random() * 0.7
        objs.append(ico(f'{name}Canopy{k}', s, (x + math.cos(a) * rr, y + h * 0.78 + r.random() * 1.6, z + math.sin(a) * rr),
                        flat(LEAF[(k + seed) % 5], 0.8), subdiv=2, jitter=0.15, seed=seed * 10 + k))


def build_planters(objs):
    long_planter(objs, 'PlanterBL', -8.0, -2.4, -R + 0.1, -R + 1.7, seed=3, flowers=['#f2f2f2', '#ff9ec7'])
    long_planter(objs, 'PlanterBR', 2.4, 8.4, -R + 0.1, -R + 1.7, seed=5, flowers=['#f2f2f2', '#ffd36b'])
    long_planter(objs, 'PlanterL', -R + 0.1, -R + 1.7, -3.6, 5.0, seed=7, flowers=['#c9a2ff', '#f2f2f2'])
    long_planter(objs, 'PlanterF', -3.6, 3.6, R - 1.5, R - 0.1, seed=9, flowers=['#ff9ec7', '#ffd36b'])
    long_planter(objs, 'PlanterR', R - 1.7, R - 0.1, 7.2, 12.2, seed=11)
    tree_pot(objs, 'TreeL', (-16.2, G, 9.6), seed=1)
    tree_pot(objs, 'TreeF', (8.5, G, 16.6), seed=2)


def build_extras(objs):
    # Telescope on a tripod, front right, aimed at the moon's side of the sky.
    tx, tz = 12.6, 12.8
    brass = flat(BRASS, 0.3)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.4
        objs.append(tube(f'TripodLeg{k}', [(tx + math.cos(a) * 1.4, G, tz + math.sin(a) * 1.4), (tx, G + 4.2, tz)], 0.06,
                         flat('#2a2a2c', 0.4)))
    tel = cylinder('TelescopeTube', 0.38, 4.4, (0, 0, 0), flat('#f0ece4', 0.35), segs=16, r_top=0.32)
    tel.rotation_euler = (math.radians(55), 0, math.radians(35))
    tel.location = V(tx + 1.2, G + 3.4, tz + 0.9)
    objs.append(tel)
    objs.append(sphere('TelescopeHead', 0.3, (tx, G + 4.3, tz), brass, segs=10, rings=6))
    # Two sun loungers, front left.
    for k, x in enumerate((-12.2, -8.4)):
        z = 14.0
        frame = flat('#f2efe8', 0.5)
        parts = [box(f'Lounger{k}Frame', (2.4, 0.4, 6.4), (0, 1.0, 0), frame, bevel=0.1),
                 box(f'Lounger{k}Cushion', (2.2, 0.35, 4.3), (0, 1.38, 1.0), flat('#2f8f8a', 0.9), bevel=0.14)]
        for sx in (-1, 1):
            for sz in (-1, 1):
                parts.append(box(f'Lounger{k}Leg{sx}{sz}', (0.2, 0.8, 0.2), (sx * 1.0, 0.4, sz * 2.8), frame))
        back = box(f'Lounger{k}Back', (2.2, 0.35, 2.3), (0, 2.1, -2.0), flat('#2f8f8a', 0.9), bevel=0.14)
        back.rotation_euler = (math.radians(-38), 0, 0)
        parts.append(back)
        objs.extend(group(f'Lounger{k}', (x, G, z), math.pi + 0.15 * (k - 0.5), parts))
    objs.append(cylinder('LoungerTable', 0.7, 0.1, (-10.3, G + 1.6, 16.6), flat(TEAK, 0.5), segs=16))
    objs.append(cylinder('LoungerTableLeg', 0.1, 1.6, (-10.3, G, 16.6), flat(STEEL, 0.5), segs=8))
    # A patio heater by the loungers: a post, a glowing element under a reflector hood.
    hx, hz = -15.8, 16.0
    objs.append(lathe('HeaterBase', [(0.9, 0), (0.9, 0.2), (0.35, 0.5), (0, 0.5)], 20, (hx, G, hz), flat(STEEL, 0.4)))
    objs.append(cylinder('HeaterPost', 0.14, 8.3, (hx, G + 0.4, hz), flat('#9aa0a8', 0.3), segs=10))
    objs.append(cylinder('HeaterElement', 0.42, 1.0, (hx, G + 8.6, hz), glow('#ff7a2a', 4.0, 'HeaterGlow'), segs=14))
    objs.append(lathe('HeaterHood', [(0.3, 0), (2.0, 0.6), (2.1, 0.75), (0.4, 0.95), (0, 1.0)], 24, (hx, G + 9.6, hz),
                      flat('#9aa0a8', 0.3)))
    add_light('HeaterL', 'POINT', (hx, G + 9.0, hz), '#ff8a3a', 500, size=0.4)
    # A pitched skylight over the stairs' landing, glowing from below.
    sx, sz = 0.0, 15.0
    objs.append(box('SkylightCurb', (5.0, 0.8, 3.2), (sx, G + 0.4, sz), flat('#6a655d', 0.8), bevel=0.05))
    for s in (-1, 1):
        pane = box(f'SkylightPane{s}', (4.8, 0.08, 1.75), (sx, G + 1.25, sz + s * 0.78), glow('#ffd8a0', 1.4, 'SkylightGlass'))
        pane.rotation_euler = (s * math.radians(-30), 0, 0)
        objs.append(pane)
    objs.append(box('SkylightRidge', (5.0, 0.18, 0.18), (sx, G + 1.75, sz), flat(STEEL, 0.4)))
    add_light('SkylightL', 'POINT', (sx, G + 2.2, sz), '#ffc98a', 120, size=1.2)


# --------------------------------------------------------------------------
# The city: neighbouring rooftops below (lit, baked), towers beyond (unlit)
# --------------------------------------------------------------------------

def tower_face(q, c, n, u, span, y1, y0, style, voff, shade_k=1.0):
    """One side of a tower in the window atlas, split into strips of 8 bays (the atlas column width)."""
    cw = ATLAS_COLW / ATLAS
    strip = 8 * BAY
    k = shade(n) * shade_k
    s = -span / 2
    while s < span / 2 - 1e-3:
        e = min(s + strip, span / 2)
        mid = (s + e) / 2
        cx, cz = c[0] + u[0] * mid, c[2] + u[2] * mid
        hw = (e - s) / 2
        u0 = style * cw
        u1 = u0 + cw * (e - s) / strip
        v0 = (y0 - voff) / (ATLAS_FLOORS * STOREY)
        v1 = (y1 - voff) / (ATLAS_FLOORS * STOREY)
        q.rect((cx, (y0 + y1) / 2, cz), (u[0] * hw, 0, u[2] * hw), (0, (y1 - y0) / 2, 0), (k, k, k),
               uv=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
        s = e


def tower(q, glows, x, z, w, d, top, style, r):
    """A tower from the street up: one to three setbacks, maybe a lit crown, a spire and a beacon."""
    tiers = 1 + int(r.random() * 3) if top > F + 20 else 1
    y0 = STREET
    voff = r.random() * 160
    for t in range(tiers):
        y1 = top if t == tiers - 1 else y0 + (top - y0) * (0.55 + 0.2 * r.random()) if t == 0 else y0 + (top - y0) * 0.6
        for n, u in SIDES:
            span = d if abs(n[0]) > 0.5 else w
            c = (x + n[0] * w / 2, 0, z + n[2] * d / 2)
            tower_face(q, c, n, u, span, y1, y0, style, voff)
        dark = (0.995, 0.5)
        k = shade((0, 1, 0))
        q.rect((x, y1, z), (w / 2, 0, 0), (0, 0, -d / 2), (k, k, k), uv=[dark] * 4)
        y0 = y1
        w, d = max(8, w - 4 * (1 + int(r.random() * 2))), max(8, d - 4 * (1 + int(r.random() * 2)))
    roll = r.random()
    if roll < 0.35:
        col = ['#ffd27a', '#7fe6ff', '#ffffff', '#ff7ac8'][int(r.random() * 4)]
        for n, u in SIDES:
            span = d if abs(n[0]) > 0.5 else w
            glows.rect((x + n[0] * (w / 2 + 0.05), top - 1.2, z + n[2] * (d / 2 + 0.05)), (u[0] * span / 2, 0, u[2] * span / 2),
                       (0, 0.5, 0), col)
    if roll > 0.7:
        h = 8 + r.random() * 14
        for n, u in SIDES:
            glows.rect((x + n[0] * 0.3, top + h / 2, z + n[2] * 0.3), (u[0] * 0.3, 0, u[2] * 0.3), (0, h / 2, 0), scale_col('#5a6070', 0.25))
        glows.rect((x, top + h + 0.6, z + 0.31), (0.6, 0, 0), (0, 0.6, 0), '#ff2a2a')
        glows.rect((x, top + h + 0.6, z - 0.31), (-0.6, 0, 0), (0, 0.6, 0), '#ff2a2a')
        glows.rect((x + 0.31, top + h + 0.6, z), (0, 0, -0.6), (0, 0.6, 0), '#ff2a2a')
        glows.rect((x - 0.31, top + h + 0.6, z), (0, 0, 0.6), (0, 0.6, 0), '#ff2a2a')


def facade_windows(glows, c, n, u, span, top, bottom, r, wall):
    """A near building's face: dark wall with windows as their own quads (sharp at any distance)."""
    k = shade(n)
    glows.rect((c[0], (top + bottom) / 2, c[2]), (u[0] * span / 2, 0, u[2] * span / 2), (0, (top - bottom) / 2, 0), scale_col(wall, k))
    bays = int(span // 4.5)
    if bays < 1:
        return
    pitch = span / bays
    lits = ['#ffd08a', '#ffe4b0', '#ffc070', '#d6e6ff', '#ffb35c']
    floors = int((top - bottom - 3) // 6)
    for f in range(floors):
        y = top - 4.5 - f * 6
        lit_p = 0.42 if r.random() > 0.08 else 0.9
        for b in range(bays):
            t = -span / 2 + pitch * (b + 0.5)
            p = (c[0] + u[0] * t + n[0] * 0.06, y, c[2] + u[2] * t + n[2] * 0.06)
            if r.random() < lit_p:
                col = scale_col(lits[int(r.random() * len(lits))], 0.55 + 0.45 * r.random())
            else:
                col = scale_col('#1a2234', k * (0.7 + 0.5 * r.random()))
            glows.rect(p, (u[0] * 1.4, 0, u[2] * 1.4), (0, 1.8, 0), col)


def neighbour(objs, glows, ads, name, cx, cz, w, d, top, kind, r):
    """A building on a neighbouring block: lit (baked) roof with its clutter, unlit walls and windows."""
    wall = ['#1c2232', '#241e24', '#1a2229', '#20202c'][int(r.random() * 4)]
    for n, u in SIDES:
        span = d if abs(n[0]) > 0.5 else w
        c = (cx + n[0] * w / 2, 0, cz + n[2] * d / 2)
        faces_us = (-cx * n[0] - cz * n[2]) > 0
        if faces_us:
            facade_windows(glows, c, n, u, span, top, max(STREET, top - 160), r, wall)
        else:
            glows.rect((c[0], (top + STREET) / 2, c[2]), (u[0] * span / 2, 0, u[2] * span / 2), (0, (top - STREET) / 2, 0),
                       scale_col(wall, shade(n)))
    roof = flat(['#3b3f47', '#45423f', '#383d45'][int(r.random() * 3)], 0.9)
    rim = flat('#57575a', 0.8)
    objs.append(box(f'{name}Roof', (w, 0.4, d), (cx, top - 0.2, cz), roof))
    for k, (size, pos) in enumerate([((w, 1.4, 0.8), (cx, top + 0.7, cz - d / 2 + 0.4)), ((w, 1.4, 0.8), (cx, top + 0.7, cz + d / 2 - 0.4)),
                                     ((0.8, 1.4, d), (cx - w / 2 + 0.4, top + 0.7, cz)), ((0.8, 1.4, d), (cx + w / 2 - 0.4, top + 0.7, cz))]):
        objs.append(box(f'{name}Rim{k}', size, pos, rim))
    # Clutter by kind.
    if kind == 'pool':
        pw, pd = w * 0.42, d * 0.3
        px, pz = cx + w * 0.1, cz + d * 0.12
        objs.append(box(f'{name}PoolDeck', (pw + 3, 0.3, pd + 3), (px, top + 0.15, pz), flat('#c9b79c', 0.8)))
        objs.append(box(f'{name}Pool', (pw, 0.1, pd), (px, top + 0.32, pz), glow('#36e0e8', 5.0, 'PoolWater')))
        add_light(f'{name}PoolL', 'AREA', (px, top + 1.0, pz), '#3ce6ef', 900, size=pw, shape='RECTANGLE', rot=(0, 0, 0))
        for k in range(4):
            objs.append(box(f'{name}Lounger{k}', (1.6, 0.6, 4.2), (px - pw / 2 + 2 + k * 3.2, top + 0.6, pz - pd / 2 - 3.6), flat('#f0ede6', 0.6)))
        for k in range(10):
            t = k / 9
            objs.append(sphere(f'{name}Bulb{k}', 0.3, (px - pw / 2 - 1 + (pw + 2) * t, top + 6 - 1.6 * 4 * t * (1 - t), pz + pd / 2 + 2.5),
                               glow(WARM, 10.0, 'FestoonBulb'), segs=8, rings=5))
        add_light(f'{name}BulbL', 'POINT', (px, top + 5, pz + pd / 2 + 2.5), WARM, 1500, size=3)
    elif kind == 'garden':
        for k in range(9):
            x = cx + (r.random() - 0.5) * w * 0.7
            z = cz + (r.random() - 0.5) * d * 0.7
            s = 1.6 + r.random() * 1.6
            objs.append(ico(f'{name}Tree{k}', s, (x, top + s * 0.8 + 0.6, z), flat(LEAF[k % 5], 0.8), subdiv=1, jitter=0.15, seed=k))
        objs.append(box(f'{name}Path', (w * 0.7, 0.1, 2.5), (cx, top + 0.05, cz), flat('#b9ad98', 0.8)))
        for k in range(5):
            objs.append(sphere(f'{name}Lamp{k}', 0.35, (cx - w * 0.3 + k * w * 0.15, top + 1.6, cz + 1.8), glow('#ffd59a', 6.0, 'PathLamp'),
                               segs=8, rings=5))
        add_light(f'{name}LampL', 'AREA', (cx, top + 3.0, cz + 1.8), '#ffcf8a', 1200, size=w * 0.6, shape='RECTANGLE')
    else:
        for k in range(3 + int(r.random() * 3)):
            x = cx + (r.random() - 0.5) * w * 0.6
            z = cz + (r.random() - 0.5) * d * 0.6
            objs.append(box(f'{name}Unit{k}', (3 + r.random() * 3, 2 + r.random() * 2, 3 + r.random() * 3), (x, top + 1.5, z),
                            flat('#8a9099', 0.6), bevel=0.1))
        if kind == 'tank':
            tx, tz = cx - w * 0.2, cz - d * 0.15
            for k in range(4):
                a = math.pi / 4 + k * math.pi / 2
                objs.append(box(f'{name}TankLeg{k}', (0.4, 5, 0.4), (tx + math.cos(a) * 2.6, top + 2.5, tz + math.sin(a) * 2.6), flat('#2f3238', 0.6)))
            objs.append(cylinder(f'{name}Tank', 3.4, 6, (tx, top + 5, tz), flat('#6e4a32', 0.85), segs=16))
            objs.append(cylinder(f'{name}TankRoof', 3.7, 2.4, (tx, top + 11, tz), flat('#3a3e45', 0.6), segs=16, r_top=0.3))
        objs.append(sphere(f'{name}Beacon', 0.4, (cx + w * 0.4, top + 2.0, cz - d * 0.4), glow('#ff2a2a', 8.0, 'Beacon'), segs=8, rings=5))


def build_city(objs, city_tex, ad_tex):
    r = np.random.default_rng(2024)
    glows = Quads()
    towers = Quads()
    adq = Quads()
    # The eight blocks round ours: neighbours just below the roof line, rooftop life on them.
    near = {
        (-1, -1): ('pool', -26.0), (0, -1): ('tank', -34.0), (1, -1): ('tall', 22.0),
        (-1, 0): ('garden', -20.0), (1, 0): ('plain', -38.0),
        (-1, 1): ('tank', -30.0), (0, 1): ('plain', -42.0), (1, 1): ('tall', 46.0),
    }
    for (i, j), (kind, top) in near.items():
        cx, cz = i * PITCH, j * PITCH
        w = d = BLOCK - 4
        if kind == 'tall':
            # A tower that rises past our roof: windows by the atlas, a billboard facing us.
            tw, td = 28.0, 28.0
            tower(towers, glows, cx, cz, tw, td, top, int(r.random() * 3), r)
            # The billboard on its face toward our roof.
            n = (0, 0, 1) if j <= 0 else (0, 0, -1)
            u = (1, 0, 0) if n[2] > 0 else (-1, 0, 0)
            face = (cx, top - 18, cz + n[2] * (td / 2 + 0.6))
            quad = 0 if (i, j) == (1, -1) else 2
            u0, v0 = (quad % 2) * 0.5, 0.5 - (quad // 2) * 0.5
            adq.rect(face, (u[0] * 9, 0, 0), (0, 9, 0), (1, 1, 1), uv=[(u0, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0, v0 + 0.5)])
            for k in range(2):
                objs.append(box(f'AdFrame{i}{j}{k}', (18.6, 0.5, 0.4), (cx, top - 18 + (k * 2 - 1) * 9.2, face[2] - n[2] * 0.2), flat('#2c3038', 0.6)))
            continue
        neighbour(objs, glows, adq, f'Nb{i}{j}'.replace('-', 'm'), cx, cz, w, d, top, kind, r)
    # A vertical blade sign on the left neighbour's corner.
    bx, bz, by = -PITCH + (BLOCK - 4) / 2 + 0.4, -10.0, -32.0
    adq.rect((bx + 0.3, by, bz), (0, 0, -3.5), (0, 9, 0), (1, 1, 1), uv=[(0.5, 0.0), (1.0, 0.0), (1.0, 0.5), (0.5, 0.5)])
    # Towers on every block beyond, taller toward downtown (back left) and with distance.
    for i in range(-9, 10):
        for j in range(-9, 10):
            if max(abs(i), abs(j)) <= 1:
                continue
            cx, cz = i * PITCH, j * PITCH
            dist = math.hypot(cx, cz)
            downtown = max(0.0, math.cos(math.atan2(cz, cx) - math.atan2(-1, -0.6))) ** 2
            n = 1 if r.random() < 0.6 else 2
            for k in range(n):
                if n == 1:
                    w = 16 + 4 * int(r.random() * 5)
                    d = 16 + 4 * int(r.random() * 5)
                    x, z = cx + (r.random() - 0.5) * (BLOCK - w), cz + (r.random() - 0.5) * (BLOCK - d)
                else:
                    w, d = 16 + 4 * int(r.random() * 2), 16 + 4 * int(r.random() * 3)
                    x = cx + (k - 0.5) * (BLOCK - w)
                    z = cz + (r.random() - 0.5) * (BLOCK - d)
                base = -60 + r.random() * 70
                boost = downtown * (60 + r.random() * 160) + dist * 0.12 * r.random()
                top = base + boost
                if dist < 140:
                    top = min(top, -12 + r.random() * 30)
                tower(towers, glows, x, z, w, d, top, int(r.random() * 4), r)
    # Streets far below.
    plane = Quads()
    E = 600
    y = STREET
    u0, u1 = (-E + BLOCK / 2) / PITCH, (E + BLOCK / 2) / PITCH
    plane.quad([(-E, y, E), (E, y, E), (E, y, -E), (-E, y, -E)], (1, 1, 1),
               uv=[(u0, -u1 + 1), (u1, -u1 + 1), (u1, -u0 + 1), (u0, -u0 + 1)])
    streets = textured('Streets', blib.image_from_array('streets', tex_streets(512)), emissive=1.0)
    streets.cycles.emission_sampling = 'NONE'
    out = [towers.build('CityTowers', city_tex), glows.build('CityGlow', glow_flat()), adq.build('CityAds', ad_tex),
           plane.build('CityStreets', streets)]
    for o in out:
        if o:
            o['city'] = 1
            objs.append(o)


# --------------------------------------------------------------------------
# Lighting (bake only)
# --------------------------------------------------------------------------

def setup_world():
    world = bpy.data.worlds.new('NightSky')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*blib.hex_rgb('#4a3050'), 1)
    cr.elements[1].position = 0.45
    cr.elements[1].color = (*blib.hex_rgb('#0b1029'), 1)
    e = cr.elements.new(0.12)
    e.color = (*blib.hex_rgb('#262a55'), 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.15
    bpy.context.scene.world = world


def setup_lighting():
    setup_world()
    sun = bpy.data.lights.new('Moon', 'SUN')
    sun.energy = 0.32
    sun.color = blib.hex_rgb('#b4c4ff')
    sun.angle = math.radians(3.0)
    o = bpy.data.objects.new('Moon', sun)
    blib.link(o)
    d = V(*MOON).normalized()
    o.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    # A soft warm wash over the table (as if from the festoon ring), so the deck reads round the board.
    pool = add_light('TablePool', 'SPOT', (0, 26, 4), '#ffd9a8', 15000, size=7.0, spot=95)
    aim(pool, (0, F, -1))


# --------------------------------------------------------------------------
# Preview renders (no bake): what the game's cameras see
# --------------------------------------------------------------------------

VIEWS = {
    'table': ((0, 13.65, 12.07), (0, 0, 0)),
    'follow_back': ((0, 2.6, 8.4), (0, 0.2, 4.6)),
    'follow_right': ((-8.4, 2.6, 0.8), (-4.6, 0.2, 0.4)),
    'follow_front': ((0.6, 2.6, -8.4), (0.3, 0.2, -4.6)),
    'follow_left': ((8.4, 2.6, -0.6), (4.6, 0.2, -0.3)),
    'overhead': ((0, 17.5, 1.6), (0, 0, 0)),
    'orbit': ((24, 12, 26), (0, 0, 0)),
}


def render_views(names, samples=24, res=(960, 540), prefix='sky'):
    sc = bpy.context.scene
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    blib.link(cam)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = math.radians(45)
    cam.data.clip_end = 1500
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.image_settings.file_format = 'PNG'
    for name in names:
        pos, tgt = VIEWS[name]
        cam.location = V(*pos)
        d = V(*tgt) - V(*pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(SCRATCH, f'{prefix}_{name}.png')
        bpy.ops.render.render(write_still=True)
        blib.log('rendered', sc.render.filepath)


# --------------------------------------------------------------------------

def build_all():
    """Every object of the set plus its lights. Returns the list of objects."""
    objs: list = []
    city_tex = textured('CityWindows', blib.image_from_array('windows', tex_windows()), emissive=1.0)
    city_tex.cycles.emission_sampling = 'NONE'
    ad_tex = textured('Ads', blib.image_from_array('ads', tex_ads(512)), emissive=2.0)
    build_roof(objs, city_tex)
    build_deck(objs)
    build_festoons(objs)
    build_hut(objs)
    build_hvac(objs)
    build_lounge(objs)
    build_neon(objs)
    build_planters(objs)
    build_extras(objs)
    build_city(objs, city_tex, ad_tex)
    return objs


def fold_glow(objs, name='RoomGlowLights'):
    """Fold every plain glowing colour into vertex colours on GlowFlat and join them: one draw call."""
    shared = glow_flat()
    for o in objs:
        me = o.data
        if 'Color' not in me.color_attributes:
            me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
            ca = me.color_attributes['Color']
            cols = np.ones((len(me.loops), 4), np.float32)
            slot = []
            for m in me.materials:
                c = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value if m else (1, 1, 1, 1)
                slot.append((c[0], c[1], c[2], 1))
            for p in me.polygons:
                cols[p.loop_start:p.loop_start + p.loop_total] = slot[min(p.material_index, len(slot) - 1)]
            ca.data.foreach_set('color', cols.ravel())
        me.materials.clear()
        me.materials.append(shared)
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
    return blib.join(objs, name)


SMALL = ('Rail', 'FairyWire', 'Flower', 'Glass', 'Tripod', 'Line', 'Socket', 'PoleShrub', 'PoleCap', 'PoleRing', 'Shrub',
         'Canopy', 'Ladder', 'Louvre', 'Grille', 'Blade', 'Hub', 'TankBrace', 'TankLeg', 'TankFoot', 'TankHoop', 'Mast',
         'Vent', 'Conduit', 'Awning', 'Pillow', 'Nb', 'AdFrame', 'Telescope', 'Heater', 'Lantern', 'SideTable', 'Marquee',
         'SignPost', 'DeckStud', 'Door', 'Meter', 'Groove', 'Soil', 'Trunk', 'Lounger', 'Skylight', 'Exhaust', 'Shroud', 'Duct')


def is_small(o):
    return any(k in o.name for k in SMALL)


def lightmap_unwrap(objs, weight, margin=0.0012):
    """One shared 'Lightmap' atlas: clutter unwrapped in a few big islands, the rest by smart projection,
    texel density evened out, then weighted (weight(obj)) and packed tightly (islands fill the deck's hole)."""
    for o in objs:
        blib.ensure_uvs(o)
        o.data.uv_layers.active = o.data.uv_layers['Lightmap']
    small = [o for o in objs if is_small(o)]
    big = [o for o in objs if o not in small]
    for group_, angle in ((small, 80), (big, 55)):
        if not group_:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in group_:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group_[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        k = float(weight(o))
        if k != 1.0:
            uv = o.data.uv_layers['Lightmap'].data
            arr = np.zeros(len(uv) * 2, np.float32)
            uv.foreach_get('uv', arr)
            uv.foreach_set('uv', arr * k)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    t = __import__('time').time()
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    blib.log(f'packed lightmap islands in {__import__("time").time() - t:.0f}s')
    bpy.ops.object.mode_set(mode='OBJECT')


def smooth_lightmap(path, passes=3):
    """More of blib's edge-aware smoothing over a written lightmap (in linear light): a low-sample
    bake of a big floor full of small lights is grainy; islands stay apart (the dark gaps differ too much)."""
    from PIL import Image
    px = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    lin = blib.denoise(lin, passes=passes)
    out = (blib.srgb_encode(lin) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out, 'RGB').save(path, 'WEBP', quality=90, method=6)
    blib.log('smoothed', os.path.relpath(path, blib.REPO), f'{os.path.getsize(path) // 1024} KB')


def main():
    t0 = __import__('time').time()
    blib.reset()
    objs = build_all()
    # Occluders for the bake: the table and the board shade the deck.
    finish = flat('#5a3a22', 0.45, name='OccluderWood')
    occ = table_mod.build(finish, finish)
    occ.append(box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='OccluderBoard')))
    blib.realize()
    meshes = blib.mesh_objects()
    is_occ = lambda o: o.name.startswith(('Table', 'BoardOccluder'))  # noqa: E731
    city = [o for o in meshes if o.get('city')]
    room = [o for o in meshes if not is_occ(o) and o not in city]
    occ_objs = [o for o in meshes if is_occ(o)]
    blib.flatten_colors(room)
    for o in room:
        if o.data.materials and o.data.materials[0].name == 'Brick':
            blib.box_uv_world(o, 4.8)
    setup_lighting()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in room + city)
    blib.log(f'{len(room)} set objects, {len(city)} city meshes, {tris} triangles')

    if PREVIEW:
        names = [a for a in sys.argv if a in VIEWS] or ['table', 'follow_back', 'follow_left']
        render_views(names)
        return

    lit = [o for o in room if not blib.is_unlit(o)]
    unlit = [o for o in room if blib.is_unlit(o)]
    # Bulbs, lanterns, the fire and the lamps have real lights in them: their meshes only need to be seen.
    for m in bpy.data.materials:
        if m.get('unlit') and m.name not in ('DeckLED', 'StairGlow', 'SkylightGlass', 'NeonPink', 'NeonCyan', 'NeonGold'):
            m.cycles.emission_sampling = 'NONE'
    # The city costs the bake nothing: no shadows, no bounce, no light from it.
    for o in city:
        o.visible_diffuse = False
        o.visible_glossy = False
        o.visible_shadow = False
        o.visible_transmission = False
    blib.cull_hidden([o for o in lit if not o.name.startswith(('Pavers', 'Deck'))], F, eps=0.05)

    def weight(o):
        # Texels where the camera looks: the deck and pavers round the table first.
        n = o.name
        if n.startswith(('Nb', 'AdFrame')):
            return 0.1
        if n.startswith('DeckTop'):
            return 3.0
        if n.startswith('Pavers'):
            return 2.4
        if n.startswith('DeckUnder'):
            return 0.1
        if n.startswith(('Tank', 'Mast', 'ExhaustFan', 'HutRoof', 'HutCornice', 'Ladder', 'Pole', 'Festoon', 'Socket', 'Telescope',
                         'Heater', 'Lounger', 'Skylight', 'Tree')):
            return 0.45
        if n.startswith(('SignBoard', 'Rug', 'Sofa', 'FirePit', 'Parapet', 'Coping', 'Hut', 'Planter')):
            return 1.4
        if is_small(o):
            return 0.4
        return 1.0
    lightmap_unwrap(lit, weight, margin=0.0012 if not DRAFT else 0.002)
    # Bounce light settles in three diffuse bounces; nothing here is glossy in the game.
    sc = bpy.context.scene
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 2
    size, spp = (1024, 24) if DRAFT else (2048, 96)
    lm_path = os.path.join(blib.PUBLIC, OUT, 'set-light.webp')
    scale = blib.bake_lightmap(lit, size=size, samples=spp, out_file=lm_path)
    smooth_lightmap(lm_path, passes=3 if DRAFT else 1)

    flat_objs = [o for o in lit if all(m.name == 'Flat' for m in o.data.materials)]
    tex_objs = [o for o in lit if o not in flat_objs]
    groups = {}
    for o in tex_objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = [blib.join(flat_objs, 'RoomFlat')]
    for name, os_ in groups.items():
        out.append(blib.join(os_, f'Room{name}'))
    plain_glow = [o for o in unlit + city if all(m.get('kind') in ('glow', 'glowflat') for m in o.data.materials)]
    tex_glow = [o for o in unlit + city if o not in plain_glow]
    out.append(fold_glow(plain_glow))
    by_mat = {}
    for o in tex_glow:
        by_mat.setdefault(o.data.materials[0].name, []).append(o)
    for name, os_ in by_mat.items():
        out.append(blib.join(os_, f'RoomGlow{name}'))
    for o in occ_objs:
        bpy.data.objects.remove(o)
    flat_mesh = out[0]
    if flat_mesh and 'UVMap' in flat_mesh.data.uv_layers:
        flat_mesh.data.uv_layers.remove(flat_mesh.data.uv_layers['UVMap'])
    final = [o for o in out if o]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in final)
    blib.log('meshes:', ', '.join(f'{o.name} ({sum(len(p.vertices) - 2 for p in o.data.polygons)})' for o in final), f'= {tris} triangles')
    blib.export_glb(final, f'{OUT}/set.glb', normals=False)
    blib.record('skylineSet', {
        'url': f'/{OUT}/set.glb',
        'lightmap': f'/{OUT}/set-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })
    blib.log(f'total {__import__("time").time() - t0:.0f}s')


if __name__ == '__main__':
    if '--smooth' in sys.argv:   # re-run just the smoothing on the current lightmap
        smooth_lightmap(os.path.join(blib.PUBLIC, OUT, 'set-light.webp'))
        with open(blib.MANIFEST) as f:
            prev = __import__('json').load(f)['skylineSet']
        blib.record('skylineSet', {'url': f'/{OUT}/set.glb', 'lightmap': f'/{OUT}/set-light.webp',
                                   'lightmapIntensity': prev['lightmapIntensity']})
    else:
        main()
