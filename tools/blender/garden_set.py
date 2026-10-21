"""The Crossroads map's set: a walled garden on a summer afternoon, where four paths meet.

The table stands on a round stone terrace in the middle of a formal garden.
Four gravel paths cross there, north, south, east and west, lined with clipped
box hedges and topiary balls; flowerbeds fill the quarters between them (one
planted as a Chog's face, for anyone looking down), with benches, iron lamp
posts and a wooden signpost at the crossing pointing down the paths. A
fountain plays at the head of the north path, a white gazebo closes the west
one, and a ring of trees and a low stone wall frame it all, rolling hills and
a blue sky beyond. The sun and the sky are baked by Cycles into one lightmap;
the hills and the sky are unlit, coloured in their vertex colours.

    tools/blender/run.sh garden_set.py            # full quality
    tools/blender/run.sh garden_set.py --draft    # quick bake for iterating
    tools/blender/run.sh garden_set.py --preview  # path-traced stills from the game cameras, no bake

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the ground at y = -4.6. North is -z (away
from the default camera), east +x.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import blib  # noqa: E402
import table as table_mod  # noqa: E402
import tex  # noqa: E402
from blib import V, box, flat, textured  # noqa: E402
from speedway_set import Batch, backdrop_material, backdrop_only, game_normal  # noqa: E402

DRAFT = '--draft' in sys.argv
PREVIEW = '--preview' in sys.argv
F = -4.6
TAU = 2 * math.pi
TERRACE_R = 11.0
PATH_W = 5.2          # path width
PATH_END = 60.0       # paths run out to the wall
WALL_R = 62.0
LAWN = 150.0          # the mown lawn is a square this wide
OUT = 'models/garden'
FONTS = os.path.join(blib.REPO, 'client', 'src', 'fonts')

# Sun: high in the front-right, warm; the sky fills the shadows blue.
SUN_AZ = math.atan2(4, 7)
SUN_EL = math.radians(47)
SUN_DIR = Vector((math.cos(SUN_EL) * math.cos(SUN_AZ), math.sin(SUN_EL), math.cos(SUN_EL) * math.sin(SUN_AZ)))

rng = np.random.default_rng(23)

# ---- palette ---------------------------------------------------------------
HEDGE = ['#2f6b34', '#336f37', '#2b6230']
LEAF = ['#3f8a3a', '#4a9640', '#367c34', '#56a048', '#2f7031']
TRUNK = '#5a4130'
STONE = '#cfc6b4'
STONE_DK = '#a79e8c'
WHITE = '#f1efe8'
IRON = '#26292e'
WOOD = '#8a5a36'
WOOD_DK = '#5e3c22'
SOIL = '#5a3f2c'
WATER = '#7cc3e6'
FLOWERS = ['#e8486a', '#f4c430', '#f7f2e8', '#9b5de5', '#ff8c42', '#4cc9f0', '#f15bb5']


def lin(h):
    return np.array(blib.hex_rgb(h), np.float32)


def P(r, a, y=0.0):
    """Game point at radius r, angle a (0 = +x east, -pi/2 = north), height y above the ground."""
    return (math.cos(a) * r, F + y, math.sin(a) * r)


# ---------------------------------------------------------------------------
# Textures (numpy, sRGB 0..1, row 0 at the top)
# ---------------------------------------------------------------------------

def grass(size=1024, seed=5):
    """Mown lawn: fine blades of light and dark green, faint mowing stripes."""
    img = np.empty((size, size, 3), np.float32)
    img[:] = tex.rgb('#5f9d3f')
    n1 = tex.noise(size, size, (128, 128), 2, seed)
    n2 = tex.noise(size, size, (16, 16), 3, seed + 1)
    img *= (0.82 + 0.3 * n1 * n2 + 0.08 * n2)[..., None]
    xx = np.arange(size)[None, :]
    stripe = 0.94 + 0.06 * (((xx // (size // 4)) % 2) * 2 - 1)
    img *= stripe[..., None]
    img[..., 1] *= 1.04
    return np.clip(img, 0, 1)


def gravel(size=512, seed=8):
    """Pale golden gravel: speckled stones."""
    r = np.random.default_rng(seed)
    img = np.empty((size, size, 3), np.float32)
    img[:] = tex.rgb('#cdb98f')
    img *= (0.86 + 0.22 * tex.noise(size, size, (64, 64), 3, seed))[..., None]
    for _ in range(9000):
        x, y = r.integers(0, size, 2)
        s = r.integers(1, 4)
        img[y:y + s, x:x + s] *= 0.62 + r.random() * 0.6
    return np.clip(img, 0, 1)


def paving(size=1024, seed=12):
    """The terrace: rings of stone setts round a compass star, as seen from above (UV = plan)."""
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    c = size / 2
    d = np.hypot(xx - c, yy - c) / c * TERRACE_R
    a = np.arctan2(yy - c, xx - c)
    img = np.empty((size, size, 3), np.float32)
    img[:] = tex.rgb(STONE)
    ring = np.floor(d / 0.9)
    seg = np.floor((a + math.pi) / TAU * np.maximum(6, np.round(ring * 5.6)))
    tone = np.sin(ring * 12.9898 + seg * 78.233) * 43758.5453
    tone = tone - np.floor(tone)
    img *= (0.86 + 0.16 * tone)[..., None]
    joint = ((d % 0.9) < 0.06) | (((a + math.pi) / TAU * np.maximum(6, np.round(ring * 5.6))) % 1 < 0.035 * np.maximum(1, ring) / 4)
    img[joint] *= 0.62
    # A darker band at the rim and an eight-point compass star in the middle (under the table).
    img[(d > TERRACE_R - 0.7) & (d < TERRACE_R - 0.15)] = tex.rgb(STONE_DK) * 0.9
    star = d < 3.2 * (0.35 + 0.65 * np.abs(np.cos(a * 4)) ** 6)
    img[star] = tex.rgb('#b07a4c')
    img *= (0.93 + 0.12 * tex.noise(size, size, (32, 32), 3, seed))[..., None]
    return np.clip(img, 0, 1)


def signs():
    """Four arrow boards for the signpost (rows of 512×128), white lettering on green."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new('RGB', (512, 512), '#1f5a35')
    dr = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype(os.path.join(FONTS, 'lilita-one-400.woff2'), 70)
    except OSError:
        f = ImageFont.load_default()
    for k, text in enumerate(['EXPRESS', 'LONG WAY', 'START', 'JUNCTION']):
        y = k * 128
        dr.rectangle((6, y + 6, 505, y + 121), outline='#f1efe8', width=6)
        w = dr.textlength(text, font=f)
        dr.text(((512 - w) / 2, y + 22), text, font=f, fill='#f1efe8')
    return np.asarray(im, np.float32) / 255


# ---------------------------------------------------------------------------
# Ground: lawn, terrace, paths
# ---------------------------------------------------------------------------

def build_ground(objs):
    gmat = textured('Grass', blib.image_from_array('grass', grass(1024)), rough=1.0)
    # The lawn in cells: those near the table get more of the lightmap than the far ones.
    near, far = Batch('LawnNear'), Batch('LawnFar')
    cell = 10.0
    n = int(LAWN / cell)
    for j in range(n):
        for i in range(n):
            x0, z0 = -LAWN / 2 + i * cell, -LAWN / 2 + j * cell
            pts = [(x0, F, z0), (x0 + cell, F, z0), (x0 + cell, F, z0 + cell), (x0, F, z0 + cell)]
            uvs = [((p[0]) / 7, (-p[2]) / 7) for p in pts]
            b = near if max(abs(x0 + cell / 2), abs(z0 + cell / 2)) < 40 else far
            b.quad(pts, gmat, out=(0, 1, 0), uvs=uvs)
    for b in (near, far):
        o = b.done()
        o['ground'] = 1
        objs.append(o)
    # Paths: four arms from the terrace to the wall, a hair above the lawn.
    pmat = textured('Gravel', blib.image_from_array('gravel', gravel(512)), rough=1.0)
    for name, a in (('PathN', -math.pi / 2), ('PathS', math.pi / 2), ('PathE', 0.0), ('PathW', math.pi)):
        b = Batch(name)
        ux, uz = math.cos(a), math.sin(a)
        vx, vz = -uz, ux
        steps = 12
        for k in range(steps):
            r0 = TERRACE_R - 0.5 + (PATH_END - TERRACE_R + 0.5) * k / steps
            r1 = TERRACE_R - 0.5 + (PATH_END - TERRACE_R + 0.5) * (k + 1) / steps
            pts = []
            for rr, s in ((r0, -1), (r1, -1), (r1, 1), (r0, 1)):
                pts.append((ux * rr + vx * s * PATH_W / 2, F + 0.04, uz * rr + vz * s * PATH_W / 2))
            b.quad(pts, pmat, out=(0, 1, 0), uvs=[(p[0] / 4, -p[2] / 4) for p in pts])
        o = b.done()
        o['ground'] = 1
        objs.append(o)
    # The fountain's round plaza at the head of the north path.
    fb = Batch('FountainPlaza')
    rr = 8.0
    cz = -36.0
    for k in range(36):
        a0, a1 = TAU * k / 36, TAU * (k + 1) / 36
        pts = [(0, F + 0.05, cz), (math.cos(a1) * rr, F + 0.05, cz + math.sin(a1) * rr), (math.cos(a0) * rr, F + 0.05, cz + math.sin(a0) * rr)]
        fb.quad(pts, pmat, out=(0, 1, 0), uvs=[(p[0] / 4, -p[2] / 4) for p in pts])
    o = fb.done()
    o['ground'] = 1
    objs.append(o)
    # The terrace: a shallow round platform of setts.
    tmat = textured('Terrace', blib.image_from_array('terrace', paving(1024)), rough=0.85)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=TERRACE_R, segments=96)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co.x / (2 * TERRACE_R) + 0.5, co.y / (2 * TERRACE_R) + 0.5)
    top = blib.new_mesh_object('TerraceTop', bm, tmat)
    top.location = V(0, F + 0.22, 0)
    top['ground'] = 1
    objs.append(top)
    # Its rim: an open band (a capped cylinder's top would cover the setts).
    objs.append(blib.lathe('TerraceEdge', [(TERRACE_R, 0), (TERRACE_R, 0.22)], 96, (0, F, 0), flat(STONE_DK, 0.8),
                           cap_top=False, cap_bottom=False))


# ---------------------------------------------------------------------------
# Hedges, topiary, beds
# ---------------------------------------------------------------------------

def build_hedges(objs):
    b = Batch('Hedges')
    pots = Batch('TopiaryPots')
    side = PATH_W / 2 + 1.1
    for a in (-math.pi / 2, math.pi / 2, 0.0, math.pi):
        ux, uz = math.cos(a), math.sin(a)
        vx, vz = -uz, ux
        yaw = -a
        for s in (-1, 1):
            # Two runs each side, a gap between them for a bench.
            for r0, r1 in ((14.5, 25.0), (30.0, 44.0)):
                rm = (r0 + r1) / 2
                c = (ux * rm + vx * s * side, F, uz * rm + vz * s * side)
                b.box(c, (r1 - r0, 2.3, 1.7), flat(HEDGE[(int(rm) + s) % 3], 0.95), yaw=yaw, bottom=True)
                # Clipped tops: a slightly narrower cap.
                b.box((c[0], F + 2.3, c[2]), (r1 - r0 - 0.2, 0.25, 1.4), flat(HEDGE[(int(rm) + s + 1) % 3], 0.95), yaw=yaw)
            # Topiary balls on stone pots where the path leaves the terrace.
            for rr in (12.6, 46.0):
                c = (ux * rr + vx * s * side, F, uz * rr + vz * s * side)
                pots.box(c, (1.4, 1.3, 1.4), flat(STONE, 0.8), bottom=True)
                b.ico((c[0], F + 2.5, c[2]), 1.3, flat(HEDGE[0], 0.95), subdiv=2)
    objs.append(b.done(smooth=False))
    objs.append(pots.done())


def build_beds(objs):
    """A flowerbed in each quarter; the north-east one is planted as a Chog's face."""
    soil = flat(SOIL, 1.0)
    edge = flat(STONE, 0.8)
    for qx, qz in ((1, -1), (-1, -1), (1, 1), (-1, 1)):
        cx, cz = qx * 21.0, qz * 21.0
        r = 7.0
        b = Batch(f'Bed{qx}{qz}')
        b.lathe((cx, F, cz), [(r + 0.35, 0), (r + 0.35, 0.45), (r, 0.45), (r, 0.3)], edge, segs=40, cap_top=False)
        b.lathe((cx, F + 0.3, cz), [(r, 0), (0, 0.05)], soil, segs=40, cap_top=False)
        objs.append(b.done())
        fl = Batch(f'Flowers{qx}{qz}')
        rr = np.random.default_rng(qx * 7 + qz * 3 + 20)
        chog = qx == 1 and qz == -1
        step = 0.55
        for gx in np.arange(-r + step, r, step):
            for gz in np.arange(-r + step, r, step):
                if gx * gx + gz * gz > (r - 0.4) ** 2:
                    continue
                px, pz = cx + gx + rr.normal(0, 0.06), cz + gz + rr.normal(0, 0.06)
                col = chog_flower(gx / r, gz / r) if chog else FLOWERS[int((math.atan2(gz, gx) / TAU * 6 + math.hypot(gx, gz) / 2.2)) % len(FLOWERS)]
                h = 0.55 + rr.random() * 0.25
                # From the table a flower is a dot of colour: a low-poly ball, no stem to see.
                fl.ico((px, F + 0.32 + h * 0.75, pz), 0.27 + rr.random() * 0.06, flat(col, 0.9), subdiv=0)
        objs.append(fl.done())


def chog_flower(u, v):
    """The NE bed's colour at (u, v) in -1..1 (v toward the camera): a purple face, cream muzzle, eyes, spikes."""
    d = math.hypot(u, v * 1.05 - 0.05)
    if abs(u) < 0.95 and -0.98 < v < -0.62 and (math.floor((u + 1) * 5) % 2 == 0):
        return '#5a2fb5'                       # the spikes on top
    for ex in (-0.32, 0.32):
        e = math.hypot(u - ex, v + 0.12)
        if e < 0.1:
            return '#1b1230'
        if e < 0.22:
            return '#ffffff'
    if math.hypot(u, (v - 0.35) * 1.4) < 0.36:
        return '#d53f7c' if math.hypot(u, v - 0.2) < 0.09 else '#fdf6cd'
    if d < 0.78:
        return '#8a4fff'
    return '#c39bff'


# ---------------------------------------------------------------------------
# Trees, fountain, gazebo, benches, lamps, signpost, wall
# ---------------------------------------------------------------------------

def build_trees(objs):
    b = Batch('Trees')
    spots = []
    for k in range(4):
        a = -math.pi / 4 + k * math.pi / 2
        spots.append((math.cos(a) * 34, math.sin(a) * 34, 1.0))
    r = np.random.default_rng(31)
    for k in range(18):
        a = (k + 0.5) / 18 * TAU + r.normal(0, 0.06)
        if min(abs(math.remainder(a - q, TAU)) for q in (0, math.pi / 2, math.pi, -math.pi / 2)) < 0.18:
            continue
        rad = 48 + r.random() * 9
        spots.append((math.cos(a) * rad, math.sin(a) * rad, 1.1 + r.random() * 0.4))
    for k, (x, z, s) in enumerate(spots):
        h = 5.5 * s
        b.cone((x, F, z), 0.55 * s, 0.38 * s, h, flat(TRUNK, 0.9), segs=8)
        for j in range(4):
            ox, oz = r.normal(0, 1.4 * s), r.normal(0, 1.4 * s)
            b.ico((x + ox, F + h + 1.6 * s + r.random() * 1.6 * s, z + oz), (2.6 + r.random()) * s,
                  flat(LEAF[(k + j) % len(LEAF)], 0.95), scale=(1, 0.85, 1), subdiv=2)
    objs.append(b.done(smooth=True))


def build_fountain(objs):
    b = Batch('Fountain')
    cz = -36.0
    st = flat(STONE, 0.6)
    b.lathe((0, F, cz), [(4.6, 0), (4.6, 1.2), (4.2, 1.2), (4.2, 0.6)], st, segs=40, cap_top=False)
    b.lathe((0, F + 0.6, cz), [(4.2, 0), (0, 0.02)], flat(WATER, 0.1), segs=40, cap_top=False)
    b.lathe((0, F, cz), [(0.8, 0), (0.6, 1.5), (0.4, 3.0), (2.0, 3.3), (2.0, 3.6), (0.4, 3.6), (0.3, 4.8), (1.0, 5.0),
                         (1.0, 5.2), (0.2, 5.2), (0.15, 6.0), (0, 6.2)], st, segs=24, cap_top=False)
    b.lathe((0, F + 3.4, cz), [(1.85, 0), (0, 0.02)], flat(WATER, 0.1), segs=24, cap_top=False)
    # Falling water: a pale ring of drops and a spout.
    for k in range(16):
        a = TAU * k / 16
        b.ico((math.cos(a) * 1.9, F + 2.0, cz + math.sin(a) * 1.9), 0.09, flat('#d9f0fb', 0.1), scale=(1, 6, 1), subdiv=1)
    b.cone((0, F + 6.0, cz), 0.12, 0.02, 1.2, flat('#d9f0fb', 0.1), segs=8)
    objs.append(b.done(smooth=True))


def build_gazebo(objs):
    b = Batch('Gazebo')
    cx = -40.0
    w = flat(WHITE, 0.5)
    b.lathe((cx, F, 0), [(6.0, 0), (6.0, 0.6), (0, 0.62)], flat(STONE, 0.7), segs=32, cap_top=False)
    for k in range(8):
        a = TAU * k / 8 + TAU / 16
        x, z = cx + math.cos(a) * 5.2, math.sin(a) * 5.2
        b.lathe((x, F + 0.6, z), [(0.35, 0), (0.25, 0.4), (0.22, 6.4), (0.4, 6.8), (0.4, 7.0), (0, 7.02)], w, segs=12, cap_top=False)
    b.lathe((cx, F + 7.0, 0), [(6.2, 0), (6.2, 0.6), (5.6, 0.6), (4.2, 2.6), (1.6, 4.2), (0.4, 4.7), (0.3, 5.6), (0, 5.9)],
            flat('#4f8f8a', 0.6), segs=32, cap_top=False)
    b.lathe((cx, F + 7.6, 0), [(5.6, 0), (0, 0.05)], w, segs=32, cap_top=False)
    objs.append(b.done(smooth=True))


def build_benches(objs):
    b = Batch('Benches')
    wd, ir = flat(WOOD, 0.8), flat(IRON, 0.5)
    side = PATH_W / 2 + 0.9
    for a in (-math.pi / 2, math.pi / 2, 0.0, math.pi):
        ux, uz = math.cos(a), math.sin(a)
        vx, vz = -uz, ux
        for s in (-1, 1):
            rr = 27.5
            cx, cz = ux * rr + vx * s * side, uz * rr + vz * s * side
            yaw = -a
            # Seat slats, back slats, iron ends; facing the path.
            fx, fz = -vx * s, -vz * s
            for k in range(3):
                off = -0.3 + k * 0.3
                b.box((cx + fx * off * -1, F + 1.75, cz + fz * off * -1), (4.0, 0.12, 0.26), wd, yaw=yaw)
            for k in range(2):
                b.box((cx - fx * 0.55, F + 2.4 + k * 0.5, cz - fz * 0.55), (4.0, 0.3, 0.1), wd, yaw=yaw)
            for e in (-1.8, 1.8):
                ex, ez = cx + ux * e, cz + uz * e
                b.box((ex, F, ez), (0.12, 1.75, 1.0), ir, yaw=yaw, bottom=True)
                b.box((ex - fx * 0.55, F + 1.75, ez - fz * 0.55), (0.12, 1.3, 0.12), ir, yaw=yaw, bottom=True)
    objs.append(b.done())


def build_lamps(objs):
    b = Batch('Lamps')
    ir = flat(IRON, 0.4, 0.6)
    glass = flat('#f3ead2', 0.2)
    for a in (-math.pi / 2, math.pi / 2, 0.0, math.pi):
        ux, uz = math.cos(a), math.sin(a)
        vx, vz = -uz, ux
        for s in (-1, 1):
            for rr in (13.0, 47.5):
                x, z = ux * rr + vx * s * (PATH_W / 2 + 2.6), uz * rr + vz * s * (PATH_W / 2 + 2.6)
                b.lathe((x, F, z), [(0.45, 0), (0.4, 0.5), (0.16, 0.8), (0.12, 7.2), (0.3, 7.4), (0, 7.45)], ir, segs=10, cap_top=False)
                b.lathe((x, F + 7.45, z), [(0.25, 0), (0.45, 0.9), (0.5, 1.0), (0, 1.02)], glass, segs=8, cap_top=False)
                b.lathe((x, F + 8.45, z), [(0.6, 0), (0.08, 0.6), (0, 0.8)], ir, segs=8, cap_top=False)
    objs.append(b.done(smooth=True))


def build_signpost(objs):
    """At the crossing, just off the terrace: a post with four arrow boards down the paths."""
    smat = textured('Signs', blib.image_from_array('signs', signs()), rough=0.7)
    x, z = 8.2, -7.6
    objs.append(blib.cylinder('SignPost', 0.22, 9.2, (x, F, z), flat(WOOD_DK, 0.8), segs=10))
    objs.append(blib.sphere('SignCap', 0.3, (x, F + 9.3, z), flat(WOOD_DK, 0.8), segs=10, rings=6))
    # Board k on the atlas row k, pointing: north (the Express), west (the long way), south-east (START) and
    # south (Junction). `yaw` turns the board about the vertical so its length points that way.
    core = flat('#173f27', 0.7)
    for k, (yaw, y) in enumerate(((math.pi / 2, 8.3), (math.pi, 7.4), (-math.pi / 4, 6.5), (-math.pi / 2, 5.6))):
        # The board's middle, its length along `yaw`, out from the post; its face's normal (game x, z).
        cx, cz = x + math.cos(yaw) * 1.7, z - math.sin(yaw) * 1.7
        nx, nz = math.sin(yaw), math.cos(yaw)
        objs.append(box(f'SignCore{k}', (3.3, 0.9, 0.1), (cx, F + y, cz), core, rot_y=yaw))
        # A lettered face on each side, just proud of the board so neither is hidden by the other.
        for side, name in ((1, 'SignFace'), (-1, 'SignBack')):
            p = blib.plane(f'{name}{k}', 3.2, 0.8, (0, 0, 0), smat)
            for d in p.data.uv_layers['UVMap'].data:
                u, v = d.uv
                d.uv = (u, 1 - (k + 1 - v) / 4)
            # Upright already; turn it about the vertical so its length (local +x) points the way.
            p.rotation_euler = (0, 0, yaw if side > 0 else yaw + math.pi)
            p.location = V(cx + nx * 0.06 * side, F + y, cz + nz * 0.06 * side)
            objs.append(p)


def build_wall(objs):
    b = Batch('StoneWall')
    st, cap = flat('#b9ae98', 0.9), flat('#d6ccb8', 0.8)
    n = 160
    for k in range(n):
        a0, a1 = TAU * k / n, TAU * (k + 1) / n
        am = (a0 + a1) / 2
        if min(abs(math.remainder(am - q, TAU)) for q in (0, math.pi / 2, math.pi, -math.pi / 2)) < 0.06:
            continue
        x, z = math.cos(am) * WALL_R, math.sin(am) * WALL_R
        seg = TAU * WALL_R / n + 0.05
        b.box((x, F, z), (seg, 2.2, 1.2), st, yaw=-am + math.pi / 2, bottom=True)
        b.box((x, F + 2.2, z), (seg, 0.25, 1.5), cap, yaw=-am + math.pi / 2)
    # Gate piers either side of each path.
    for a in (-math.pi / 2, math.pi / 2, 0.0, math.pi):
        for s in (-1, 1):
            aa = a + s * 0.06
            x, z = math.cos(aa) * WALL_R, math.sin(aa) * WALL_R
            b.box((x, F, z), (1.8, 3.4, 1.8), cap, bottom=True)
            b.ico((x, F + 3.9, z), 0.6, cap, subdiv=1)
    objs.append(b.done())


# ---------------------------------------------------------------------------
# Backdrop: hills and sky (unlit, never baked)
# ---------------------------------------------------------------------------

def build_hills(objs):
    mat = backdrop_material()
    out = []
    sun = lin('#fff1d6')
    haze = lin('#bcd6ea')
    for layer, (r0, r1, hmax, seed, low, high, hz) in enumerate(((78.0, 120.0, 12.0, 4, '#5e9a45', '#8fbf62', 0.15),
                                                                   (125.0, 165.0, 30.0, 9, '#6f9a7c', '#a7c1b8', 0.5))):
        ph = np.random.default_rng(seed).random(6) * TAU
        nseg, nr = 128, 6
        bm = bmesh.new()
        vs = []
        for j in range(nr + 1):
            r = r0 + (r1 - r0) * j / nr
            row = []
            for i in range(nseg):
                a = TAU * i / nseg
                t = (r - r0) / (r1 - r0)
                ridge = 0.55 + 0.25 * math.sin(a * 3 + ph[0]) + 0.15 * math.sin(a * 7 + ph[1]) + 0.08 * math.sin(a * 17 + ph[2])
                prof = math.sin(math.pi * min(1.0, t / 0.68) * 0.5) ** 1.4 * (1 - max(0.0, (t - 0.68) / 0.32) ** 2)
                row.append(bm.verts.new(V(*P(r, a, hmax * ridge * prof))))
            vs.append(row)
        for j in range(nr):
            for i in range(nseg):
                i2 = (i + 1) % nseg
                f = bm.faces.new((vs[j][i], vs[j][i2], vs[j + 1][i2], vs[j + 1][i]))
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
        o = blib.new_mesh_object(f'Hills{layer}', bm, mat)
        lo, hi = lin(low), lin(high)
        me = o.data
        ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
        cols = np.ones((len(me.vertices), 4), np.float32)
        for v in me.vertices:
            n = game_normal(v.normal)
            gy = v.co.z - F
            lam = max(0.0, n.dot(SUN_DIR))
            base = lo + (hi - lo) * min(1.0, gy / (hmax * 0.8))
            k = base * (0.6 + 0.6 * lam * sun)
            h = hz + 0.1 * min(1.0, gy / hmax)
            cols[v.index] = (*np.clip(k * (1 - h) + haze * h, 0, 1), 1)
        ca.data.foreach_set('color', cols.ravel())
        o['keep_colors'] = 1
        backdrop_only(o)
        out.append(o)
    objs.extend(out)
    return out


def build_sky():
    """A dome from deep blue overhead to a pale horizon, a few white clouds; unlit."""
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
    for f in bm.faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - V(0, F, 0)) > 0:
            f.normal_flip()
    o = blib.new_mesh_object('SkyDome', bm, mat)
    me = o.data
    ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
    top, mid, hor = lin('#3f7fd6'), lin('#7fb3ea'), lin('#d7e8f4')
    cols = np.ones((len(me.vertices), 4), np.float32)
    for v in me.vertices:
        g = Vector((v.co.x, v.co.z - F, -v.co.y)).normalized()
        h = max(0.0, g.y)
        col = hor + (mid - hor) * min(1.0, h / 0.3) if h < 0.3 else mid + (top - mid) * min(1.0, (h - 0.3) / 0.6)
        cols[v.index] = (*np.clip(col, 0, 1), 1)
    ca.data.foreach_set('color', cols.ravel())
    o['keep_colors'] = 1
    backdrop_only(o)
    parts = [o]
    cb = Batch('SkyClouds')
    cb.slot(mat)
    cr = np.random.default_rng(14)
    for k in range(11):
        a = cr.random() * TAU
        el = math.radians(12 + cr.random() * 22)
        dist = R - 20 - cr.random() * 20
        cx, cy, cz = math.cos(a) * math.cos(el) * dist, math.sin(el) * dist * 0.6, math.sin(a) * math.cos(el) * dist
        for j in range(4):
            w = 6 + cr.random() * 6
            cb.ico((cx + cr.normal(0, 6), F + cy + cr.normal(0, 1), cz + cr.normal(0, 6)), w, mat, scale=(1.5, 0.45, 1.0), subdiv=2)
    co = cb.done()
    me = co.data
    ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
    lit_c, shade_c = lin('#ffffff'), lin('#b9c8dc')
    cols = np.ones((len(me.vertices), 4), np.float32)
    for v in me.vertices:
        lam = max(0.0, game_normal(v.normal).dot(SUN_DIR))
        cols[v.index] = (*np.clip(shade_c + (lit_c - shade_c) * min(1.0, 0.3 + lam), 0, 1), 1)
    ca.data.foreach_set('color', cols.ravel())
    co['keep_colors'] = 1
    backdrop_only(co)
    parts.append(co)
    return parts


# ---------------------------------------------------------------------------
# Lighting (bake only)
# ---------------------------------------------------------------------------

def aim(obj, target):
    d = V(*target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_lighting():
    world = bpy.data.worlds.new('Day')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*blib.hex_rgb('#8db9ea'), 1)
    bg.inputs['Strength'].default_value = 1.1
    bpy.context.scene.world = world
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.2
    sun.color = blib.hex_rgb('#fff0d6')
    sun.angle = math.radians(2.0)
    so = bpy.data.objects.new('Sun', sun)
    blib.link(so)
    so.rotation_euler = (-V(*SUN_DIR)).to_track_quat('-Z', 'Y').to_euler()


# ---------------------------------------------------------------------------

def sunlit_dots(obj):
    """Shade a cluster of tiny parts (the flowers) by hand: each face its colour times sun and sky, in its
    vertex colours, unlit in the game. A thousand flower heads each wanting a speck of the lightmap would
    take half of it, for light that hardly varies across a bed."""
    me = obj.data
    slot = []
    for m in me.materials:
        c = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value if m else (1, 1, 1, 1)
        slot.append(np.array(c[:3], np.float32))
    ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    cols = np.ones((len(me.loops), 4), np.float32)
    for p in me.polygons:
        n = game_normal(p.normal)
        light = 0.42 + 0.75 * max(0.0, n.dot(SUN_DIR)) + 0.12 * max(0.0, n.y)
        col = slot[min(p.material_index, len(slot) - 1)] * light
        cols[p.loop_start:p.loop_start + p.loop_total] = (*np.clip(col, 0, 1), 1)
    ca.data.foreach_set('color', cols.ravel())
    me.materials.clear()
    me.materials.append(backdrop_material())
    obj['keep_colors'] = 1
    backdrop_only(obj)


def build_all(with_sky=False):
    objs: list = []
    build_ground(objs)
    build_hedges(objs)
    build_beds(objs)
    build_trees(objs)
    build_fountain(objs)
    build_gazebo(objs)
    build_benches(objs)
    build_lamps(objs)
    build_signpost(objs)
    build_wall(objs)
    back = build_hills(objs)
    if with_sky:
        back += build_sky()
    return objs, back


def occluders():
    finish = flat('#5a3a22', 0.45, name='OccluderWood')
    occ = table_mod.build(finish, finish)
    occ.append(box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='OccluderBoard')))
    return occ


def report():
    import re
    tally = {}
    for o in blib.mesh_objects():
        key = re.sub(r'[\d_]+.*$', '', o.name) or o.name
        tally[key] = tally.get(key, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1])[:20]:
        blib.log(f'{v:7d}  {k}')
    blib.log(f'{sum(tally.values()):7d}  total, {len(blib.mesh_objects())} objects')


CAMS = {
    'table': ((0, 13.65, 12.1), (0, 0, 0)),
    'cine': ((0.6, 1.55, 7.2), (0.2, 0.35, 4.8)),
    'back': ((0, 2.2, 7.5), (0, 1.6, -4)),
    'follow': ((-1.0, 2.6, -8.4), (-0.6, 0.2, -4.6)),
    'side': ((8.4, 2.6, 1.0), (4.6, 0.2, 0.6)),
    'left': ((-8.4, 2.6, 1.0), (-4.6, 0.2, 0.6)),
    'high': ((0, 30, 34), (0, 0, -6)),
}


def preview():
    sc = blib.reset()
    build_all(with_sky=True)
    occluders()
    blib.realize()
    report()
    setup_lighting()
    out_dir = os.environ.get('PREVIEW_DIR', '/tmp')
    sc.render.resolution_x, sc.render.resolution_y = 960, 600
    sc.cycles.samples = int(os.environ.get('PREVIEW_SPP', '24'))
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    which = os.environ.get('PREVIEW_CAMS', ','.join(CAMS)).split(',')
    for name in which:
        pos, tgt = CAMS[name]
        cam = bpy.data.objects.new(f'Cam{name}', bpy.data.cameras.new(f'Cam{name}'))
        blib.link(cam)
        cam.data.sensor_fit = 'VERTICAL'
        cam.data.angle_y = math.radians(45)
        cam.data.clip_end = 1000
        cam.location = V(*pos)
        aim(cam, tgt)
        sc.camera = cam
        sc.render.filepath = os.path.join(out_dir, f'garden-{name}.png')
        bpy.ops.render.render(write_still=True)
        blib.log('wrote', sc.render.filepath)


def main():
    if PREVIEW:
        preview()
        return
    t0 = __import__('time').time()
    blib.reset()
    _, back = build_all(with_sky=False)
    occluders()
    blib.realize()
    occ_names = ('Table', 'BoardOccluder')
    every = blib.mesh_objects()
    for o in every:
        if o.name.startswith('Flowers'):
            sunlit_dots(o)
    backdrop = [o for o in every if o.get('backdrop')]
    occ_objs = [o for o in every if o.name.startswith(occ_names)]
    room = [o for o in every if o not in backdrop and o not in occ_objs]
    blib.flatten_colors(room)
    lit = [o for o in room if not blib.is_unlit(o)]
    unlit = [o for o in room if blib.is_unlit(o)]
    setup_lighting()
    report()
    blib.cull_hidden([o for o in lit if not o.get('ground')], F, eps=0.04)

    def weight(o):
        n = o.name
        if n.startswith('TerraceTop'):
            return 3.0
        if n.startswith('LawnFar'):
            return 0.12
        if n.startswith('LawnNear'):
            return 0.7
        if n.startswith('Path'):
            return 0.8
        if n.startswith(('StoneWall', 'Trees', 'Gazebo')):
            return 0.35
        if n.startswith(('Flowers', 'Lamps', 'Benches')):
            return 0.5
        return 1.0
    blib.lightmap_unwrap(lit, margin=0.0015 if not DRAFT else 0.003, weight=weight)
    size, spp = (1024, 16) if DRAFT else (2048, 96)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    scale = blib.bake_lightmap(lit, size=size, samples=spp, out_file=os.path.join(blib.PUBLIC, OUT, 'set-light.webp'))
    smooth_lightmap(os.path.join(blib.PUBLIC, OUT, 'set-light.webp'))

    flat_objs = [o for o in lit if all(m.name == 'Flat' for m in o.data.materials)]
    tex_objs = [o for o in lit if o not in flat_objs]
    groups = {}
    for o in tex_objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = [blib.join(flat_objs, 'SetFlat')]
    for name, os_ in groups.items():
        out.append(blib.join(os_, f'Set{name}'))
    for o in occ_objs:
        bpy.data.objects.remove(o)
    # The backdrop (hills, sky, clouds): its own colours, unlit, one mesh and material.
    glow_objs = unlit + backdrop + build_sky()
    shared = bpy.data.materials.new('Glow')
    shared.use_nodes = True
    nt = shared.node_tree
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    nt.links.new(vc.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    for o in glow_objs:
        me = o.data
        if me.color_attributes['Color'].domain == 'POINT':
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
    out.append(blib.join(glow_objs, 'RoomGlowSky'))
    flat_mesh = out[0]
    if 'UVMap' in flat_mesh.data.uv_layers:
        flat_mesh.data.uv_layers.remove(flat_mesh.data.uv_layers['UVMap'])
    final = [o for o in out if o]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in final)
    blib.log('meshes:', ', '.join(o.name for o in final), f'= {tris} triangles')
    blib.export_glb(final, f'{OUT}/set.glb', normals=False)
    blib.record('gardenSet', {
        'url': f'/{OUT}/set.glb',
        'lightmap': f'/{OUT}/set-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })
    blib.log(f'total {__import__("time").time() - t0:.0f}s')


def smooth_lightmap(path, passes=3):
    """More of blib's edge-aware smoothing over the written lightmap (in linear light): sunlight on a big
    lawn bakes grainy, and the grain is most of the file's size. Islands stay apart."""
    from PIL import Image
    px = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    lin_ = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    lin_ = blib.denoise(lin_, passes=passes)
    out = (blib.srgb_encode(lin_) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out, 'RGB').save(path, 'WEBP', quality=86, method=6)
    blib.log('smoothed', os.path.relpath(path, blib.REPO), f'{os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    if '--smooth' in sys.argv:   # re-run just the smoothing on the current lightmap
        import json
        smooth_lightmap(os.path.join(blib.PUBLIC, OUT, 'set-light.webp'))
        with open(blib.MANIFEST) as f:
            prev = json.load(f)['gardenSet']
        blib.record('gardenSet', {'url': f'/{OUT}/set.glb', 'lightmap': f'/{OUT}/set-light.webp',
                                  'lightmapIntensity': prev['lightmapIntensity']})
    else:
        main()
