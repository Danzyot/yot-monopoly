"""The Blitz map's set: a retro arcade hall after closing time, every machine still lit.

A cosmic-pattern arcade carpet, a round stage under the game table ringed in
cyan light, dark walls with pink and cyan neon running along them, rows of
arcade cabinets down both sides and along the back (each screen a different
pixel game, each marquee lit), a big BLITZ sign spelled out in glowing pixels
over the back row, claw machines either side of it, an air-hockey table, a
pair of pinball machines, a token changer and a prize counter at the front.
The screens, neon and the warm pool over the table are baked by Cycles into
one lightmap; screens, marquees and neon are unlit in the game (`RoomGlow…`).

    tools/blender/run.sh arcade_set.py            # full quality
    tools/blender/run.sh arcade_set.py --draft    # quick bake for iterating
    tools/blender/run.sh arcade_set.py --preview  # path-traced stills from the game cameras, no bake

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the floor at y = -4.6. Every texture is drawn
here with numpy; nothing is downloaded.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import blib  # noqa: E402
import table as table_mod  # noqa: E402
import tex  # noqa: E402
from blib import V, box, cylinder, flat, glow, lathe, sphere, textured  # noqa: E402

DRAFT = '--draft' in sys.argv
PREVIEW = '--preview' in sys.argv
F = -4.6          # floor
BACK = -18.0      # back wall face
SIDE = 21.0       # side walls at ±x
FRONT = 36.0      # the floor and side walls run this far toward the camera
WALL_H = 17.0
STAGE_R = 11.4    # the round stage under the table
OUT = 'models/arcade'

rng = np.random.default_rng(11)

# ---- palette ---------------------------------------------------------------
PINK = '#ff4fd8'
CYAN = '#41e0ff'
YELLOW = '#ffe14d'
GREEN = '#3ce86f'
VIOLET = '#a35bff'
ORANGE = '#ffa21f'
NEON = [PINK, CYAN, YELLOW, GREEN, VIOLET, ORANGE]
CAB = ['#1d1846', '#2a1650', '#14233f', '#33123d', '#1a2a30']
BLACK = '#0c0a16'
CHROME = '#b9bdd0'


# ---------------------------------------------------------------------------
# Pixel font (the same 5×7 font as the board's Pixel Arcade look)
# ---------------------------------------------------------------------------

FONT = {
    'A': [14, 17, 17, 31, 17, 17, 17], 'B': [30, 17, 17, 30, 17, 17, 30], 'C': [14, 17, 16, 16, 16, 17, 14],
    'D': [28, 18, 17, 17, 17, 18, 28], 'E': [31, 16, 16, 30, 16, 16, 31], 'F': [31, 16, 16, 30, 16, 16, 16],
    'G': [14, 17, 16, 23, 17, 17, 15], 'H': [17, 17, 17, 31, 17, 17, 17], 'I': [14, 4, 4, 4, 4, 4, 14],
    'J': [7, 2, 2, 2, 2, 18, 12], 'K': [17, 18, 20, 24, 20, 18, 17], 'L': [16, 16, 16, 16, 16, 16, 31],
    'M': [17, 27, 21, 21, 17, 17, 17], 'N': [17, 17, 25, 21, 19, 17, 17], 'O': [14, 17, 17, 17, 17, 17, 14],
    'P': [30, 17, 17, 30, 16, 16, 16], 'R': [30, 17, 17, 30, 20, 18, 17], 'S': [15, 16, 16, 14, 1, 1, 30],
    'T': [31, 4, 4, 4, 4, 4, 4], 'U': [17, 17, 17, 17, 17, 17, 14], 'V': [17, 17, 17, 17, 17, 10, 4],
    'W': [17, 17, 17, 21, 21, 21, 10], 'X': [17, 17, 10, 4, 10, 17, 17], 'Y': [17, 17, 10, 4, 4, 4, 4],
    'Z': [31, 1, 2, 4, 8, 16, 31], '!': [4, 4, 4, 4, 4, 0, 4], ' ': [0] * 7,
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
    '3': [31, 2, 4, 2, 1, 17, 14], '5': [31, 16, 30, 1, 1, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
}


def text_cells(text):
    """The lit pixels of `text` in the 5×7 font: (col, row) with row 0 at the top."""
    out = []
    for k, ch in enumerate(text.upper()):
        for r, bits in enumerate(FONT.get(ch, FONT[' '])):
            for c in range(5):
                if bits & (16 >> c):
                    out.append((k * 6 + c, r))
    return out, len(text) * 6 - 1


def stamp_text(img, text, x, y, cell, color, gap=1):
    """Draw `text` into an (H, W, 3) image with its top-left at (x, y), `cell` px a pixel."""
    cells, _ = text_cells(text)
    col = tex.rgb(color)
    for c, r in cells:
        x0, y0 = x + c * cell, y + r * cell
        img[y0:y0 + cell - gap, x0:x0 + cell - gap] = col


# ---------------------------------------------------------------------------
# Textures (numpy, sRGB 0..1, row 0 at the top)
# ---------------------------------------------------------------------------

def carpet(size=1024, seed=3):
    """Arcade carpet: near-black with neon rings, bolts, dots and stars, tiling seamlessly."""
    r = np.random.default_rng(seed)
    img = np.empty((size, size, 3), np.float32)
    img[:] = tex.rgb('#0d0b1e')
    img *= (0.85 + 0.3 * tex.noise(size, size, (32, 32), 3, seed))[..., None]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)

    def wrap(d):
        return (d + size / 2) % size - size / 2

    for k in range(150):
        cx, cy = r.random() * size, r.random() * size
        dx, dy = wrap(xx - cx), wrap(yy - cy)
        col = tex.rgb(NEON[k % len(NEON)]) * (0.75 + 0.25 * r.random())
        kind = k % 5
        if kind == 0:   # ring
            rad = 14 + r.random() * 22
            m = np.abs(np.hypot(dx, dy) - rad) < 3.2
        elif kind == 1:  # dot
            m = np.hypot(dx, dy) < 4 + r.random() * 5
        elif kind == 2:  # zigzag bolt
            a = r.random() * math.pi
            u, v = dx * math.cos(a) + dy * math.sin(a), -dx * math.sin(a) + dy * math.cos(a)
            m = (np.abs(u) < 40) & (np.abs(v - (np.abs((u % 18) - 9) - 4.5) * 1.6) < 2.6)
        elif kind == 3:  # plus / sparkle
            s = 10 + r.random() * 10
            m = ((np.abs(dx) < 2.4) & (np.abs(dy) < s)) | ((np.abs(dy) < 2.4) & (np.abs(dx) < s))
        else:            # triangle outline
            s = 16 + r.random() * 14
            a = r.random() * math.tau
            u, v = dx * math.cos(a) + dy * math.sin(a), -dx * math.sin(a) + dy * math.cos(a)
            d = np.maximum.reduce([-v - s * 0.5, v * 0.5 + u * 0.866 - s * 0.5, v * 0.5 - u * 0.866 - s * 0.5])
            m = np.abs(d) < 2.4
        img[m] = col
    return np.clip(img, 0, 1)


def wall(size=512, seed=7):
    """Dark violet panels with fine grooves and a faint grid of studs."""
    img = np.empty((size, size, 3), np.float32)
    img[:] = tex.rgb('#191433')
    img *= (0.9 + 0.18 * tex.noise(size, size, (8, 8), 3, seed))[..., None]
    img[:, ::64] *= 0.55
    img[:, 1::64] *= 0.7
    for y in range(16, size, 32):
        for x in range(32, size, 64):
            img[y - 2:y + 2, x - 2:x + 2] = tex.rgb('#2c2457')
    return np.clip(img, 0, 1)


def stage(size=1024):
    """The stage top: deep violet, a ring of chevrons near the rim and a pixel grid."""
    img = np.empty((size, size, 3), np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    c = size / 2
    d = np.hypot(xx - c, yy - c) / c
    a = np.arctan2(yy - c, xx - c)
    base = tex.rgb('#1c1640') * (1.1 - 0.35 * d)[..., None]
    img[:] = base
    grid = ((xx % 32) < 2) | ((yy % 32) < 2)
    img[grid & (d < 0.86)] *= 1.6
    band = (d > 0.88) & (d < 0.96)
    chev = ((a * 40 / math.pi + d * 30) % 2) < 1
    img[band & chev] = tex.rgb(PINK) * 0.8
    img[band & ~chev] = tex.rgb('#2a1f5c')
    img[(d > 0.965) & (d < 0.985)] = tex.rgb(CYAN) * 0.7
    return np.clip(img, 0, 1)


def screens():
    """Eight game screens (4×2 atlas of 256² cells), drawn at 64² and blown up with scanlines."""
    W = 64
    cells = []

    def blank(col='#05040c'):
        s = np.empty((W, W, 3), np.float32)
        s[:] = tex.rgb(col)
        return s

    def put(s, x, y, w, h, col):
        s[max(0, y):max(0, y + h), max(0, x):max(0, x + w)] = tex.rgb(col)

    # 0 invaders
    s = blank()
    inv = [0b00100000100, 0b00010001000, 0b00111111100, 0b01101110110, 0b11111111111, 0b10111111101, 0b10100000101]
    for row, col in enumerate([GREEN, CYAN, PINK]):
        for k in range(4):
            for r_, bits in enumerate(inv):
                for c in range(11):
                    if bits & (1024 >> c):
                        s[6 + row * 11 + r_, 4 + k * 15 + c] = tex.rgb(col)
    put(s, 28, 56, 9, 3, YELLOW)
    put(s, 31, 53, 3, 3, YELLOW)
    for k in range(4):
        put(s, 6 + k * 15, 46, 8, 4, GREEN)
    cells.append(s)
    # 1 maze
    s = blank()
    for k in range(0, W, 2):
        put(s, k, 2, 2, 2, '#3a3aff'); put(s, k, 60, 2, 2, '#3a3aff')
        put(s, 2, k, 2, 2, '#3a3aff'); put(s, 60, k, 2, 2, '#3a3aff')
    for (x, y, w, h) in [(12, 12, 16, 3), (36, 12, 16, 3), (12, 26, 3, 14), (49, 26, 3, 14), (22, 30, 20, 3), (12, 48, 40, 3)]:
        put(s, x, y, w, h, '#3a3aff')
    for y in range(8, 58, 6):
        for x in range(8, 58, 6):
            if s[y, x].sum() < 0.1:
                put(s, x, y, 1, 1, '#ffd6a0')
    yy, xx = np.mgrid[0:W, 0:W]
    pac = ((xx - 32) ** 2 + (yy - 42) ** 2 < 20) & ~((xx > 32) & (np.abs(yy - 42) < (xx - 32) * 0.7))
    s[pac] = tex.rgb(YELLOW)
    for gx, gc in ((20, '#ff3355'), (44, PINK)):
        put(s, gx - 3, 20, 7, 6, gc)
        put(s, gx - 2, 21, 2, 2, '#ffffff'); put(s, gx + 1, 21, 2, 2, '#ffffff')
    cells.append(s)
    # 2 falling blocks
    s = blank()
    put(s, 18, 0, 28, W, '#0b0a1c')
    pal = [CYAN, YELLOW, PINK, GREEN, ORANGE, VIOLET, '#ff3355']
    r = np.random.default_rng(4)
    heights = [10, 14, 8, 18, 12, 16, 9]
    for c in range(7):
        for k in range(heights[c] // 4):
            put(s, 18 + c * 4, W - 4 - k * 4, 3, 3, pal[r.integers(0, 7)])
    for k, (dx, dy) in enumerate([(0, 0), (4, 0), (8, 0), (4, 4)]):
        put(s, 26 + dx, 14 + dy, 3, 3, VIOLET)
    cells.append(s)
    # 3 racing
    s = blank('#1b0f3a')
    put(s, 0, 30, W, 34, '#2a7a3a')
    for y in range(30, W):
        t = (y - 30) / 34
        half = int(4 + t * 26)
        put(s, 32 - half, y, half * 2, 1, '#444455')
        if (y // 3) % 2:
            put(s, 32 - half - 2, y, 2, 1, '#ff3355'); put(s, 32 + half, y, 2, 1, '#ff3355')
        if (y // 4) % 2 and t > 0.1:
            put(s, 31, y, 2, 1, '#ffffff')
    put(s, 0, 26, W, 4, '#ff7a3a')
    put(s, 26, 50, 12, 8, '#ff3355'); put(s, 28, 47, 8, 4, '#ff6b8a'); put(s, 25, 56, 3, 3, '#111111'); put(s, 36, 56, 3, 3, '#111111')
    cells.append(s)
    # 4 platformer
    s = blank('#3a6dff')
    for (x, y) in [(8, 10), (40, 6), (24, 16)]:
        put(s, x, y, 12, 4, '#ffffff'); put(s, x + 2, y - 2, 8, 2, '#ffffff')
    for x in range(0, W, 8):
        put(s, x, 54, 7, 4, '#c8642a'); put(s, x, 58, 7, 6, '#7a3a1a')
    for x in (22, 30):
        put(s, x, 36, 7, 7, YELLOW)
    put(s, 12, 44, 6, 10, '#ff3355'); put(s, 12, 40, 6, 4, '#f1c7a5')
    put(s, 44, 46, 8, 8, '#2a7a3a'); put(s, 42, 44, 12, 3, '#3ce86f')
    cells.append(s)
    # 5 pong
    s = blank()
    for y in range(0, W, 4):
        put(s, 31, y, 2, 2, '#ffffff')
    put(s, 4, 20, 2, 12, '#ffffff'); put(s, 58, 30, 2, 12, '#ffffff'); put(s, 40, 26, 2, 2, '#ffffff')
    put(s, 20, 4, 3, 7, '#ffffff'); put(s, 40, 4, 6, 2, '#ffffff'); put(s, 44, 4, 2, 7, '#ffffff'); put(s, 40, 9, 6, 2, '#ffffff')
    cells.append(s)
    # 6 a pixel Chog: a round purple face with cream muzzle and big eyes, spikes on top
    s = blank('#140a2e')
    d = np.hypot(xx - 32, (yy - 36) * 1.1)
    s[d < 20] = tex.rgb('#8a4fff')
    for k in range(7):
        x = 14 + k * 6
        for t in range(8):
            put(s, x + t // 3, 14 - t, 3, 1, '#6b3fd1')
    s[np.hypot(xx - 32, (yy - 44) * 1.4) < 10] = tex.rgb('#fdf6cd')
    for ex in (24, 40):
        s[np.hypot(xx - ex, yy - 32) < 5] = tex.rgb('#ffffff')
        s[np.hypot(xx - ex - 1, yy - 33) < 2.5] = tex.rgb('#1b1230')
    put(s, 30, 40, 4, 3, '#d53f7c')
    cells.append(s)
    # 7 title screen
    s = blank('#07060f')
    big = np.zeros((W, W, 3), np.float32)
    stamp_text(big, 'BLITZ', 3, 14, 2, PINK, gap=0)
    s = np.maximum(s, big)
    stamp_text(s, 'PRESS', 17, 38, 1, YELLOW, gap=0)
    stamp_text(s, 'START', 17, 47, 1, YELLOW, gap=0)
    cells.append(s)

    atlas = np.zeros((512, 1024, 3), np.float32)
    for k, c in enumerate(cells):
        up = np.repeat(np.repeat(c, 4, axis=0), 4, axis=1)
        up[2::4] *= 0.72          # scanlines
        up *= 0.9
        x0, y0 = (k % 4) * 256, (k // 4) * 256
        atlas[y0:y0 + 256, x0:x0 + 256] = up
    # A bulge of light toward the middle of each screen, like curved glass.
    yy2, xx2 = np.mgrid[0:256, 0:256]
    v = 1.15 - 0.45 * (np.hypot(xx2 - 128, yy2 - 128) / 181) ** 2
    for k in range(8):
        x0, y0 = (k % 4) * 256, (k // 4) * 256
        atlas[y0:y0 + 256, x0:x0 + 256] *= v[..., None]
    return np.clip(atlas, 0, 1)


MARQUEES = ['CHOG', 'NAD RUSH', 'GMONAD', 'TURBO', 'JACKPOT', 'MOLANDAK', 'PIXEL', 'MONAD']


def marquees():
    """Eight lit marquees (2×4 atlas of 512×128 cells): a two-tone gradient and a pixel title."""
    atlas = np.zeros((512, 1024, 3), np.float32)
    for k, title in enumerate(MARQUEES):
        a, b = tex.rgb(NEON[k % len(NEON)]), tex.rgb(NEON[(k + 2) % len(NEON)])
        t = np.linspace(0, 1, 512)[None, :, None]
        cell = (a * (1 - t) + b * t) * 0.55 + 0.05
        cell = np.repeat(cell, 128, axis=0).astype(np.float32)
        cell[:6] = cell[-6:] = tex.rgb('#ffffff') * 0.9
        _, w = text_cells(title)
        px = max(6, min(13, 470 // w))
        x = (512 - w * px) // 2
        shadow = cell.copy()
        stamp_text(shadow, title, x + 4, (128 - 7 * px) // 2 + 4, px, '#1b1230')
        stamp_text(shadow, title, x, (128 - 7 * px) // 2, px, '#ffffff')
        x0, y0 = (k % 2) * 512, (k // 2) * 128
        atlas[y0:y0 + 128, x0:x0 + 512] = shadow
    return np.clip(atlas, 0, 1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def grp(objs, name, pos, rot_y, parts):
    g = blib.empty(name, pos, rot_y)
    for p in parts:
        p.parent = g
        objs.append(p)
    objs.append(g)
    return g


def uv_cell(obj, k, cols, rows):
    """Squeeze a plane's 0..1 UVs onto cell k of a cols×rows atlas (k = 0 top-left)."""
    c, r = k % cols, k // cols
    uv = obj.data.uv_layers['UVMap'].data
    for d in uv:
        u, v = d.uv
        d.uv = ((c + u) / cols, 1 - (r + 1 - v) / rows)


# ---------------------------------------------------------------------------
# The room
# ---------------------------------------------------------------------------

def build_shell(objs):
    cmat = textured('Carpet', blib.image_from_array('carpet', carpet(1024)), rough=1.0)
    objs.append(blib.grid('Floor', 2 * SIDE, FRONT - BACK, 1, 1, (0, F, (BACK + FRONT) / 2), cmat, uv_scale=9))
    wmat = textured('Wall', blib.image_from_array('wall', wall(512)), rough=0.9)
    T = 0.4
    objs.append(box('BackWall', (2 * SIDE + 2 * T, WALL_H, T), (0, F + WALL_H / 2, BACK - T / 2), wmat))
    for s in (-1, 1):
        objs.append(box(f'SideWall{s}', (T, WALL_H, FRONT - BACK), (s * (SIDE + T / 2), F + WALL_H / 2, (BACK + FRONT) / 2), wmat))
    objs.append(blib.plane('FrontWall', 2 * SIDE, WALL_H, (0, F + WALL_H / 2, FRONT), wmat, rot_y=math.pi))
    # Skirting and a dark ceiling band; neon tubes along every wall, low and high.
    skirt = flat('#0e0b1e', 0.4)
    cap = flat('#120e26', 0.5)
    for name, length, centre, rot_y in [
        ('Back', 2 * SIDE, (0, F, BACK), 0.0),
        ('L', FRONT - BACK, (-SIDE, F, (BACK + FRONT) / 2), math.pi / 2),
        ('R', FRONT - BACK, (SIDE, F, (BACK + FRONT) / 2), -math.pi / 2),
    ]:
        low, high = (PINK, CYAN) if name != 'R' else (CYAN, PINK)
        parts = [
            box(f'Skirt{name}', (length, 0.6, 0.25), (0, 0.3, 0.12), skirt),
            box(f'NeonLow{name}', (length, 0.09, 0.09), (0, 0.75, 0.2), glow(low, 4.0, f'Neon{low}')),
            box(f'Cap{name}', (length, 0.9, 0.5), (0, WALL_H - 0.45, 0.25), cap),
            box(f'NeonHigh{name}', (length, 0.1, 0.1), (0, WALL_H - 1.15, 0.3), glow(high, 4.0, f'Neon{high}')),
            box(f'NeonMid{name}', (length, 0.06, 0.06), (0, WALL_H - 1.45, 0.3), glow(VIOLET, 3.0, f'Neon{VIOLET}')),
        ]
        grp(objs, f'Trim{name}', centre, rot_y, parts)


def build_stage(objs):
    """The round stage the game table stands on, ringed with light."""
    import bmesh
    smat = textured('Stage', blib.image_from_array('stage', stage(1024)), rough=0.6)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=STAGE_R, segments=72)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co.x / (2 * STAGE_R) + 0.5, co.y / (2 * STAGE_R) + 0.5)
    disc = blib.new_mesh_object('StageTop', bm, smat)
    disc.location = V(0, F + 0.32, 0)
    objs.append(disc)
    # Open bands and a ring, not capped cylinders: a cap would cover the stage top.
    R = STAGE_R
    objs.append(lathe('StageSide', [(R, 0), (R, 0.32)], 72, (0, F, 0), flat('#120e26', 0.4), cap_top=False, cap_bottom=False))
    objs.append(lathe('StageGlow', [(R + 0.04, 0.12), (R + 0.04, 0.22)], 72, (0, F, 0), glow(CYAN, 5.0, f'Neon{CYAN}'),
                      cap_top=False, cap_bottom=False))
    objs.append(lathe('StageLip', [(R - 0.12, 0.33), (R + 0.08, 0.33), (R + 0.08, 0.38), (R - 0.12, 0.38), (R - 0.12, 0.33)], 72, (0, F, 0),
                      flat(CHROME, 0.25, 0.8), cap_top=False, cap_bottom=False))


def cabinet(objs, lights, name, pos, rot_y, k):
    """An upright arcade cabinet facing local +z: screen k of the atlas, marquee k."""
    body = flat(CAB[k % len(CAB)], 0.45)
    side = flat(NEON[k % len(NEON)], 0.4)
    dark = flat(BLACK, 0.5)
    trim = flat('#2e2a4a', 0.4)
    p = []
    # Sides: a stepped profile (base, belly, screen bay, marquee).
    for s in (-1, 1):
        p.append(box(f'{name}Side{s}', (0.16, 9.6, 3.4), (s * 1.55, 4.8, 0), side, bevel=0.04))
    p.append(box(f'{name}Base', (3.0, 3.6, 2.6), (0, 1.8, 0.35), body))
    p.append(box(f'{name}Kick', (3.0, 0.35, 2.7), (0, 0.17, 0.4), dark))
    p.append(box(f'{name}CoinDoor', (1.2, 1.5, 0.08), (0, 2.0, 1.69), trim, bevel=0.03))
    for c in (-0.3, 0.3):
        p.append(box(f'{name}Coin{c}', (0.22, 0.4, 0.06), (c, 2.3, 1.74), glow('#ff3355', 3.0, 'CoinRed')))
    # Control panel, sloped toward the player, with a joystick and buttons.
    panel = box(f'{name}Panel', (3.0, 0.3, 1.3), (0, 3.85, 1.25), dark)
    panel.rotation_euler.x = math.radians(14)
    p.append(panel)
    p.append(cylinder(f'{name}Stick', 0.05, 0.5, (-0.7, 4.0, 1.25), flat('#222222', 0.3), segs=8))
    p.append(sphere(f'{name}Ball', 0.16, (-0.7, 4.52, 1.25), flat('#ff3355', 0.3), segs=10, rings=6))
    for b in range(3):
        p.append(cylinder(f'{name}Btn{b}', 0.13, 0.08, (0.2 + b * 0.38, 4.02, 1.25 - b * 0.02),
                          glow(NEON[(k + b) % len(NEON)], 3.0, f'Neon{NEON[(k + b) % len(NEON)]}'), segs=10))
    # Screen bay: a dark bezel tilted back, the lit screen in it.
    bay = box(f'{name}Bay', (2.94, 3.2, 1.6), (0, 5.7, -0.2), dark)
    p.append(bay)
    scr = blib.plane(f'{name}Screen', 2.3, 2.3, (0, 5.75, 0.62), SCREENS)
    scr.rotation_euler.x += math.radians(-10)
    uv_cell(scr, k % 8, 4, 2)
    p.append(scr)
    p.append(box(f'{name}Bezel', (2.6, 0.12, 0.25), (0, 4.45, 0.66), trim))
    # Marquee: lit banner over the screen, a little forward.
    p.append(box(f'{name}Hood', (3.0, 1.2, 2.0), (0, 8.3, 0.0), body))
    mq = blib.plane(f'{name}Marquee', 2.8, 0.9, (0, 8.3, 1.02), MARQUEE)
    uv_cell(mq, k % 8, 2, 4)
    p.append(mq)
    p.append(box(f'{name}Top', (3.3, 0.18, 3.5), (0, 9.0, 0.0), trim))
    grp(objs, name, pos, rot_y, p)
    # The screen lights the floor and the next cabinet (bake only).
    x, _, z = pos
    fx, fz = math.sin(rot_y), math.cos(rot_y)
    lights.append(('area', f'{name}Glow', (x + fx * 1.4, F + 5.8, z + fz * 1.4), '#9fb8ff', 55, (2.2, 2.2), (x + fx * 6, F + 2, z + fz * 6)))


def build_cabinets(objs, lights):
    k = 0
    # Down both sides, facing in.
    for s in (-1, 1):
        for j, z in enumerate((-12.5, -8.2, -3.9, 0.4, 4.7, 9.0)):
            x = s * (SIDE - 2.0)
            cabinet(objs, lights, f'Cab{"L" if s < 0 else "R"}{j}', (x, F, z), -s * math.pi / 2, k)
            k += 1
    # Along the back, either side of the sign.
    for j, x in enumerate((-9.6, -6.0, 6.0, 9.6)):
        cabinet(objs, lights, f'CabB{j}', (x, F, BACK + 2.0), 0.0, k)
        k += 1


def build_sign(objs, lights):
    """BLITZ in glowing pixels over the back row, framed by a ring of bulbs."""
    cells, w = text_cells('BLITZ')
    cell = 0.6
    x0 = -w * cell / 2
    y0 = F + 13.35
    z = BACK + 0.45
    cols = [YELLOW, YELLOW, ORANGE, ORANGE, PINK, PINK, VIOLET]
    for c, r in cells:
        objs.append(box(f'SignPx{c}_{r}', (cell * 0.86, cell * 0.86, 0.3),
                        (x0 + (c + 0.5) * cell, y0 - r * cell, z), glow(cols[r], 4.5, f'Neon{cols[r]}')))
    bw, bh = w * cell + 1.6, 7 * cell + 1.2
    yc = y0 - 3 * cell
    objs.append(box('SignBack', (bw, bh, 0.25), (0, yc, BACK + 0.15), flat('#0b0920', 0.5)))
    bulb = glow('#fff3c9', 5.0, 'Bulb')
    n = 22
    for k in range(n):
        t = k / (n - 1)
        for y in (yc + bh / 2 - 0.25, yc - bh / 2 + 0.25):
            objs.append(sphere(f'SignBulb{k}_{int(y * 10)}', 0.13, (-bw / 2 + 0.3 + t * (bw - 0.6), y, z + 0.1), bulb, segs=8, rings=5))
    lights.append(('area', 'SignLight', (0, yc, BACK + 2.4), '#ff8ad8', 900, (bw, bh), (0, F + 4, BACK + 10)))
    # A Chog in pixels, either side of the sign: a purple face, cream muzzle, two eyes.
    for s in (-1, 1):
        cx = s * (bw / 2 + 3.4)
        for (dx, dy, col) in chog_pixels():
            objs.append(box(f'ChogPx{s}_{dx}_{dy}', (0.42, 0.42, 0.2), (cx + dx * 0.46, yc + 1.2 - dy * 0.46, BACK + 0.3),
                            glow(col, 3.5, f'Neon{col}')))


def chog_pixels():
    """A 9×9 pixel Chog: (dx, dy, colour) with dy down."""
    rows = [
        '..p.p.p..',
        '.ppppppp.',
        'ppPPPPPpp',
        'pPwkPwkPp',
        'pPPPPPPPp',
        'pPccccPPp',
        '.Pcc.ccP.',
        '..PPPPP..',
        '.........',
    ]
    cmap = {'p': '#6b3fd1', 'P': '#8a4fff', 'w': '#ffffff', 'k': '#1b1230', 'c': '#fdf6cd', '.': None}
    out = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if cmap[ch]:
                out.append((x - 4, y, cmap[ch]))
    return out


def claw_machine(objs, lights, name, pos, rot_y, tint):
    p = []
    frame = flat(CHROME, 0.25, 0.8)
    p.append(box(f'{name}Base', (3.4, 3.6, 3.4), (0, 1.8, 0), flat(tint, 0.4)))
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(box(f'{name}Post{sx}{sz}', (0.16, 4.8, 0.16), (sx * 1.6, 6.0, sz * 1.6), frame))
    p.append(box(f'{name}Floor', (3.2, 0.1, 3.2), (0, 3.65, 0), flat('#141024', 0.5)))
    p.append(box(f'{name}Roof', (3.6, 1.0, 3.6), (0, 8.9, 0), flat(tint, 0.4)))
    p.append(box(f'{name}RoofGlow', (3.4, 0.5, 0.06), (0, 8.9, 1.82), glow(YELLOW, 4.0, f'Neon{YELLOW}')))
    p.append(box(f'{name}Rail', (3.2, 0.08, 0.08), (0, 8.2, 0), frame))
    p.append(cylinder(f'{name}Cable', 0.025, 1.6, (0.4, 6.6, 0.3), frame, segs=6))
    for a in range(3):
        ang = a * math.tau / 3
        p.append(box(f'{name}Claw{a}', (0.06, 0.5, 0.06), (0.4 + math.cos(ang) * 0.2, 6.4, 0.3 + math.sin(ang) * 0.2), frame))
    # A pile of plush prizes.
    r = np.random.default_rng(len(name))
    for j in range(26):
        px, pz = (r.random() - 0.5) * 2.6, (r.random() - 0.5) * 2.6
        py = 3.9 + r.random() * 0.9 * (1 - (abs(px) + abs(pz)) / 3)
        col = ['#8a4fff', '#ff6fb5', '#fdf6cd', '#41e0ff', '#ffd23f', '#3ce86f'][j % 6]
        p.append(sphere(f'{name}Plush{j}', 0.38 + r.random() * 0.12, (px, py, pz), flat(col, 0.95), segs=10, rings=6))
    p.append(box(f'{name}Chute', (0.9, 0.9, 0.1), (1.0, 2.2, 1.72), flat('#111111', 0.5)))
    grp(objs, name, pos, rot_y, p)
    x, _, z = pos
    lights.append(('point', f'{name}Inside', (x, F + 7.6, z), '#fff0d0', 160, 0.8))


def build_games(objs, lights):
    claw_machine(objs, lights, 'ClawL', (-15.8, F, BACK + 2.4), 0.0, '#ff4fa8')
    claw_machine(objs, lights, 'ClawR', (15.8, F, BACK + 2.4), 0.0, '#41b6ff')
    # Air hockey, left of the table.
    ah = []
    ah.append(box('HockeyBody', (4.4, 3.2, 7.6), (0, 1.6, 0), flat('#1b2a5c', 0.4)))
    ah.append(box('HockeyTop', (4.0, 0.12, 7.2), (0, 3.26, 0), flat('#e9f3ff', 0.25)))
    ah.append(box('HockeyRim', (4.4, 0.3, 0.2), (0, 3.4, 3.7), flat(PINK, 0.4)))
    ah.append(box('HockeyRim2', (4.4, 0.3, 0.2), (0, 3.4, -3.7), flat(PINK, 0.4)))
    for s in (-1, 1):
        ah.append(box(f'HockeyRail{s}', (0.2, 0.3, 7.6), (s * 2.1, 3.4, 0), flat(PINK, 0.4)))
        ah.append(cylinder(f'HockeyMallet{s}', 0.32, 0.35, (0.3 * s, 3.32, s * 2.4), flat('#ff3355' if s < 0 else CYAN, 0.3), segs=14))
    ah.append(box('HockeyLine', (4.0, 0.02, 0.08), (0, 3.33, 0), flat('#ff3355', 0.3)))
    ah.append(cylinder('HockeyPuck', 0.22, 0.06, (-0.6, 3.32, 0.8), flat('#111111', 0.3), segs=12))
    grp(objs, 'Hockey', (-14.2, F, 5.0), 0.12, ah)
    lights.append(('spot', 'HockeyLamp', (-14.2, F + 11, 5.0), '#e8f0ff', 900, 1.0, 70))
    # Two pinball machines, right of the table.
    for j, z in enumerate((2.4, 6.6)):
        pb = []
        pb.append(box(f'Pin{j}Body', (2.6, 1.6, 5.2), (0, 3.6, 0), flat('#3a1258', 0.4)))
        top = box(f'Pin{j}Glass', (2.4, 0.06, 5.0), (0, 4.45, 0), glow('#5a2aa8', 1.6, 'PinGlass'))
        pb.append(top)
        for lx in (-1, 1):
            for lz in (-1, 1):
                pb.append(box(f'Pin{j}Leg{lx}{lz}', (0.18, 2.8, 0.18), (lx * 1.1, 1.4, lz * 2.3), flat(CHROME, 0.25, 0.8)))
        pb.append(box(f'Pin{j}Back', (2.6, 3.6, 0.5), (0, 6.2, -2.5), flat('#3a1258', 0.4)))
        bg = blib.plane(f'Pin{j}Backglass', 2.3, 2.6, (0, 6.4, -2.24), MARQUEE)
        uv_cell(bg, 4 + j, 2, 4)
        pb.append(bg)
        grp(objs, f'Pin{j}', (14.6, F, z), -math.pi / 2, pb)
    lights.append(('point', 'PinGlow', (14.6, F + 6.5, 4.5), '#c08cff', 220, 1.2))
    # Token changer and a dance-floor of lit tiles by it.
    tk = [box('TokenBody', (2.0, 6.0, 1.6), (0, 3.0, 0), flat('#20304f', 0.35)),
          box('TokenFace', (1.6, 1.4, 0.06), (0, 4.4, 0.82), glow(YELLOW, 3.0, f'Neon{YELLOW}')),
          box('TokenTray', (1.2, 0.3, 0.5), (0, 1.6, 0.9), flat(CHROME, 0.25, 0.8))]
    grp(objs, 'Token', (-18.6, F, 14.5), math.pi / 2, tk)


def build_counter(objs):
    """The prize counter across the front, shelves of plush prizes behind it."""
    z = FRONT - 4.0
    objs.append(box('CounterBody', (20.0, 3.8, 1.8), (0, F + 1.9, z), flat('#26124a', 0.4)))
    objs.append(box('CounterTop', (20.4, 0.25, 2.2), (0, F + 3.9, z), flat('#fdf6cd', 0.3)))
    objs.append(box('CounterGlow', (20.0, 0.1, 0.1), (0, F + 3.6, z - 0.95), glow(PINK, 4.0, f'Neon{PINK}')))
    for row in range(3):
        y = F + 5.5 + row * 2.4
        objs.append(box(f'Shelf{row}', (20.0, 0.18, 1.2), (0, y, FRONT - 0.7), flat('#3a2a6a', 0.4)))
        for j in range(16):
            col = ['#8a4fff', '#ff6fb5', '#fdf6cd', '#41e0ff', '#ffd23f', '#3ce86f'][(j + row) % 6]
            objs.append(sphere(f'Prize{row}_{j}', 0.48, (-9.0 + j * 1.2, y + 0.55, FRONT - 0.8), flat(col, 0.95), segs=10, rings=6))


# ---------------------------------------------------------------------------
# Lighting (bake only)
# ---------------------------------------------------------------------------

def aim(obj, target):
    d = V(*target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_lighting(lights):
    world = bpy.data.worlds.new('Arcade')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*blib.hex_rgb('#1d1640'), 1)
    bg.inputs['Strength'].default_value = 0.3
    bpy.context.scene.world = world

    def make(name, kind, pos, color, power):
        L = bpy.data.lights.new(name, kind)
        L.energy = power
        L.color = blib.hex_rgb(color)
        o = bpy.data.objects.new(name, L)
        blib.link(o)
        o.location = V(*pos)
        return o

    # A warm pool over the table and stage, falling off toward the machines.
    pool = make('TablePool', 'SPOT', (0, 18, 1), '#ffe2c8', 13000)
    pool.data.spot_size = math.radians(100)
    pool.data.spot_blend = 1.0
    pool.data.shadow_soft_size = 3.0
    # A violet wash from above so the far corners keep their shape.
    wash = make('Wash', 'AREA', (0, F + 15, 0), '#7a5cff', 2600)
    wash.data.shape = 'RECTANGLE'
    wash.data.size, wash.data.size_y = 40, 40
    for item in lights:
        kind, name, pos = item[0], item[1], item[2]
        if kind == 'point':
            _, _, _, col, power, size = item
            o = make(name, 'POINT', pos, col, power)
            o.data.shadow_soft_size = size
        elif kind == 'spot':
            _, _, _, col, power, size, cone = item
            o = make(name, 'SPOT', pos, col, power)
            o.data.shadow_soft_size = size
            o.data.spot_size = math.radians(cone)
            o.data.spot_blend = 0.9
            aim(o, (pos[0], F, pos[2]))
        else:
            _, _, _, col, power, (sx, sy), tgt = item
            o = make(name, 'AREA', pos, col, power)
            o.data.shape = 'RECTANGLE'
            o.data.size, o.data.size_y = sx, sy
            aim(o, tgt)


# ---------------------------------------------------------------------------

SCREENS = None
MARQUEE = None


def build_all():
    global SCREENS, MARQUEE
    SCREENS = textured('Screens', blib.image_from_array('screens', screens()), emissive=1.6)
    MARQUEE = textured('Marquees', blib.image_from_array('marquees', marquees()), emissive=1.6)
    objs: list = []
    lights: list = []
    build_shell(objs)
    build_stage(objs)
    build_cabinets(objs, lights)
    build_sign(objs, lights)
    build_games(objs, lights)
    build_counter(objs)
    return objs, lights


def occluders():
    """The table and board, in the bake only as shadow casters."""
    finish = flat('#2b1764', 0.45, name='OccluderWood')
    occ = table_mod.build(finish, finish)
    occ.append(box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#1c1140', 0.6, name='OccluderBoard')))
    return occ


def uv_walls():
    for o in blib.mesh_objects():
        if o.name.startswith(('BackWall', 'SideWall', 'FrontWall')):
            blib.box_uv_world(o, 4.0)


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
    'front': ((0, 3.0, -6), (0, 0, 20)),
}


def preview():
    """Path-traced stills from the game's cameras (no bake) for judging layout and light."""
    sc = blib.reset()
    _, lights = build_all()
    occluders()
    blib.realize()
    uv_walls()
    report()
    setup_lighting(lights)
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
        sc.render.filepath = os.path.join(out_dir, f'arcade-{name}.png')
        bpy.ops.render.render(write_still=True)
        blib.log('wrote', sc.render.filepath)


def fold_glow(objs, name='RoomGlowLights'):
    """Fold every plain glowing colour into vertex colours on one material and join them: one draw call."""
    shared = bpy.data.materials.new('GlowFlat')
    shared.use_nodes = True
    shared['unlit'] = 1
    shared['kind'] = 'glowflat'
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


def main():
    if PREVIEW:
        preview()
        return
    t0 = __import__('time').time()
    blib.reset()
    _, lights = build_all()
    occluders()
    blib.realize()
    occ_names = ('Table', 'BoardOccluder')
    room = [o for o in blib.mesh_objects() if not o.name.startswith(occ_names)]
    occ_objs = [o for o in blib.mesh_objects() if o.name.startswith(occ_names)]
    blib.flatten_colors(room)
    uv_walls()
    report()
    lit = [o for o in room if not blib.is_unlit(o)]
    unlit = [o for o in room if blib.is_unlit(o)]
    setup_lighting(lights)
    blib.cull_hidden([o for o in lit if not o.name.startswith(('Floor', 'Stage'))], F, eps=0.05)
    # The neon and screens light the room through their own lamps here; only the big ones sample as lights.
    for m in bpy.data.materials:
        if m.get('unlit') and m.name not in ('Screens', 'Marquees') and not m.name.startswith('Neon'):
            m.cycles.emission_sampling = 'NONE'

    def weight(o):
        n = o.name
        if n.startswith('StageTop'):
            return 3.0
        if n.startswith('Floor'):
            return 2.0
        if n.startswith(('Plush', 'Prize')) or 'Plush' in n or 'Btn' in n or 'Stick' in n or 'Ball' in n or 'Coin' in n or 'Claw' in n:
            return 0.25
        if n.startswith(('BackWall', 'SideWall', 'FrontWall', 'Counter', 'Shelf', 'Trim')):
            return 0.7
        return 1.0
    blib.lightmap_unwrap(lit, margin=0.002 if not DRAFT else 0.004, weight=weight)
    # 64 samples: the screens and the neon are many small lights; the edge-aware denoise does the rest.
    size, spp = (1024, 24) if DRAFT else (2048, 64)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    light_file = os.path.join(blib.PUBLIC, OUT, 'set-light.webp')
    scale = blib.bake_lightmap(lit, size=size, samples=spp, out_file=light_file)

    # One mesh for every plain-coloured thing, one per textured surface, one for the plain glow, one per lit atlas.
    flat_objs = [o for o in lit if all(m.name == 'Flat' for m in o.data.materials)]
    tex_objs = [o for o in lit if o not in flat_objs]
    groups = {}
    for o in tex_objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = [blib.join(flat_objs, 'RoomFlat')]
    for name, os_ in groups.items():
        out.append(blib.join(os_, f'Room{name}'))
    plain_glow = [o for o in unlit if all(m.get('kind') == 'glow' for m in o.data.materials)]
    tex_glow = [o for o in unlit if o not in plain_glow]
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
    blib.log('meshes:', ', '.join(o.name for o in final), f'= {tris} triangles')
    blib.export_glb(final, f'{OUT}/set.glb', normals=False)
    blib.record('arcadeSet', {
        'url': f'/{OUT}/set.glb',
        'lightmap': f'/{OUT}/set-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })
    blib.log(f'total {__import__("time").time() - t0:.0f}s')


if __name__ == '__main__':
    main()
