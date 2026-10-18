"""The Chog edition's room: the Chog Poker lounge at night.

Tufted purple velvet walls over a lacquered dado, a plush casino carpet with a
round suit-pattern rug under the game table, a bar with glowing back shelves
and pink velvet stools, two poker tables mid-hand (chips, cards, a dealer
button), a channel-tufted banquette under a big framed Chog portrait, a row of
slot machines under a jackpot board, booths, plants, pendant lamps and Chog
pink neon. Lit by the lamps, the neon and a warm pool over the table, all
baked into one lightmap.

    tools/blender/run.sh chog_room.py            # full quality
    tools/blender/run.sh chog_room.py --draft    # quick bake for iterating
    tools/blender/run.sh chog_room.py --preview  # path-traced stills from the game cameras, no bake

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the floor at y = -4.6. Nothing but the
mascot art (client/public/editions/chog/logo.png) comes from outside: every
other texture is drawn here with numpy.
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
from blib import V, box, cylinder, flat, glow, lathe, sphere, textured, tube  # noqa: E402
from classic_room import curtain, leaf, picture_frame, planar_uv  # noqa: E402

DRAFT = '--draft' in sys.argv
PREVIEW = '--preview' in sys.argv
F = -4.6          # floor
BACK = -17.0      # back wall face
SIDE = 20.0       # side walls at ±x
FRONT = 36.0      # floor and side walls run this far toward the camera; the front wall faces in only
WALL_H = 16.0
DADO = 4.2        # height of the lacquered dado under the velvet
CORD_TOP = F + WALL_H + 1.0

rng = np.random.default_rng(7)

# ---- palette ---------------------------------------------------------------
PINK = '#d53f7c'          # Chog pink
NEON_PINK = '#ff4fa3'
NEON_CREAM = '#fff3c9'
NEON_LILAC = '#b58cff'
CREAM = '#fdf6cd'
PLUM = '#3b1a6e'
LACQUER = '#1d0f38'
LACQUER_HI = '#2c1757'
GOLD = '#d4a64a'
BRASS = '#c9a04f'
VELVET_PINK = '#b8336f'
VELVET_PINK_HI = '#c94280'
VELVET_PLUM = '#4b2394'
FELT = '#3a1f8f'
MARBLE = '#1a1026'
LAMP_WARM = '#ffd29a'


# ---------------------------------------------------------------------------
# Textures (numpy, sRGB 0..1, row 0 at the top)
# ---------------------------------------------------------------------------

def heart_mask(x, y):
    """Unit heart centred on 0 (y up), about 2.3 wide."""
    y = y * 1.15 + 0.15
    return (x * x + y * y - 1) ** 3 - x * x * y ** 3 < 0


def suit_mask(kind, x, y):
    """Card suits in a box of about -1..1 (y up)."""
    if kind == 'heart':
        return heart_mask(x * 1.05, y * 1.05)
    if kind == 'diamond':
        return np.abs(x) * 1.25 + np.abs(y) * 0.95 < 0.95
    if kind == 'spade':
        body = heart_mask(x * 1.1, -(y - 0.2) * 1.1)
        stem = (y < -0.35) & (y > -1.0) & (np.abs(x) < 0.08 + (-0.35 - y) * 0.45)
        return body | stem
    # club
    r = 0.42
    c = ((x ** 2 + (y - 0.42) ** 2) < r * r) | (((x - 0.45) ** 2 + (y + 0.1) ** 2) < r * r) | \
        (((x + 0.45) ** 2 + (y + 0.1) ** 2) < r * r) | ((x ** 2 + (y + 0.05) ** 2) < 0.2 * 0.2)
    stem = (y < -0.1) & (y > -1.0) & (np.abs(x) < 0.08 + (-0.1 - y) * 0.35)
    return c | stem


def carpet(size=1024, seed=3):
    """Casino carpet tile: medallions with gold rosettes in a lilac trellis on deep purple, wool noise."""
    h = w = size
    v, u = np.mgrid[0:h, 0:w].astype(np.float32) / size
    base, trel = tex.rgb('#2a1352'), tex.rgb('#432684')
    pink, gold, teal, cream = tex.rgb('#c43d78'), tex.rgb('#d6a54a'), tex.rgb('#3fb8ad'), tex.rgb('#efe2b8')
    img = np.broadcast_to(base, (h, w, 3)).copy()
    cx = (u * 2) % 1 - 0.5
    cy = (v * 2) % 1 - 0.5
    r = np.sqrt(cx ** 2 + cy ** 2)
    a = np.arctan2(cy, cx)
    # Trellis: a diamond lattice through the cell edges, with a softer echo inside.
    lat = np.abs(np.abs(cx) + np.abs(cy) - 0.5)
    img[lat < 0.012] = trel
    img[(np.abs(lat - 0.06) < 0.006)] = tex.lerp(base, trel, 0.6)
    # Medallion: a scalloped pink ring, gold petals, a cream heart of the flower.
    scal = 0.27 + 0.018 * np.cos(a * 12)
    img[np.abs(r - scal) < 0.016] = pink
    petals = r < 0.07 + 0.11 * np.abs(np.cos(a * 4)) ** 1.5
    img[petals] = gold
    img[r < 0.075] = pink
    img[r < 0.035] = cream
    img[np.abs(r - 0.205) < 0.006] = tex.lerp(gold, base, 0.35)
    # Small teal diamonds where the lattice crosses.
    ox = ((u * 2 + 0.5) % 1) - 0.5
    oy = ((v * 2 + 0.5) % 1) - 0.5
    img[np.abs(ox) + np.abs(oy) < 0.06] = teal
    img[np.abs(ox) + np.abs(oy) < 0.025] = cream
    wool = tex.noise(h, w, (96, 96), 3, seed)
    patch = tex.noise(h, w, (5, 5), 3, seed + 1)
    img *= (0.84 + 0.2 * wool * (0.75 + 0.25 * patch))[..., None]
    return np.clip(img, 0, 1)


def rug(size=2048, seed=5):
    """The round rug under the table: plum field, cream border of card suits, pink and gold bands, fringe."""
    h = w = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = (x - w / 2 + 0.5) / (w / 2)
    cy = (y - h / 2 + 0.5) / (h / 2)
    r = np.sqrt(cx ** 2 + cy ** 2)
    a = np.arctan2(cy, cx)
    plum, deep = tex.rgb('#3a1a72'), tex.rgb('#24104c')
    pink, cream, gold = tex.rgb('#cc3b78'), tex.rgb('#f1e6bf'), tex.rgb('#d2a24a')
    img = np.broadcast_to(deep, (h, w, 3)).copy()

    def band(r0, r1, col):
        img[(r >= r0) & (r < r1)] = col

    band(0.985, 1.01, cream)     # fringe base
    band(0.955, 0.985, pink)
    band(0.946, 0.955, gold)
    band(0.855, 0.946, cream)    # the suit border
    band(0.845, 0.855, gold)
    band(0.80, 0.845, pink)
    band(0.792, 0.80, gold)
    band(0.66, 0.792, plum)      # field round the table
    # Suits round the border, upright as you walk round: heart, spade, diamond, club.
    k = 56
    cell = np.floor((a / (2 * math.pi)) * k) % k
    seg = ((a / (2 * math.pi)) * k) % 1 - 0.5
    sx = seg * (2 * math.pi * 0.9 / k) / 0.04
    sy = (r - 0.9) / 0.034
    kinds = ['heart', 'spade', 'diamond', 'club']
    border = (r > 0.857) & (r < 0.944)
    for i, kind in enumerate(kinds):
        m = suit_mask(kind, sx, sy) & border & (cell % 4 == i)
        img[m] = pink if kind in ('heart', 'diamond') else plum
    # Field: a scalloped gold line and a ring of small diamonds, all just outside the table.
    scal = 0.735 + 0.012 * np.cos(a * 40)
    img[np.abs(r - scal) < 0.004] = gold
    kd = 80
    sd = ((a / (2 * math.pi)) * kd) % 1 - 0.5
    dmask = (np.abs(sd) * 2.4 + np.abs((r - 0.69) / 0.016)) < 0.9
    img[dmask] = pink
    star = r < (0.2 + 0.12 * np.abs(np.cos(a * 4)) ** 3)
    img[star & (r > 0.02)] = plum
    threads = (np.sin(a * 900) > 0.2) & (r > 0.985)
    img[threads] = tex.lerp(cream, pink, 0.2)
    wool = tex.noise(h, w, (72, 72), 3, seed)
    wear = tex.noise(h, w, (6, 6), 3, seed + 1)
    img *= (0.86 + 0.18 * wool * (0.7 + 0.3 * wear))[..., None]
    return np.clip(img, 0, 1)


def velvet(size=512, seed=11):
    """Diamond-tufted purple velvet: puffed pillows, sunken seams, a button at every crossing."""
    h = w = size
    v, u = np.mgrid[0:h, 0:w].astype(np.float32) / size
    p = (u + v) * 2
    q = (u - v) * 2
    a = p % 1 - 0.5
    b = q % 1 - 0.5
    d = np.maximum(np.abs(a), np.abs(b)) * 2          # 0 at a pillow's centre, 1 on its seams
    base, hi, lo = tex.rgb('#40207a'), tex.rgb('#5a33a0'), tex.rgb('#1c0c38')
    shade = 1 - d ** 2.2
    # Light from above: the upper half of every pillow catches a little sheen.
    sheen = np.clip(0.5 - (a + b) * 0.9, 0, 1) * shade
    img = tex.lerp(base * 0.62, base, shade)
    img = tex.lerp(img, hi, 0.45 * sheen)
    seam = d > 0.94
    img[seam] = lo
    ca = np.abs(np.abs(a) - 0.5)
    cb = np.abs(np.abs(b) - 0.5)
    btn = np.sqrt(ca ** 2 + cb ** 2)
    img[btn < 0.055] = lo
    img[btn < 0.035] = tex.rgb('#6c48b0')
    img[btn < 0.016] = tex.rgb('#a58ad8')
    pile = tex.noise(h, w, (128, 128), 2, seed)
    img *= (0.9 + 0.14 * pile)[..., None]
    return np.clip(img, 0, 1)


def chog_art(size=768, seed=4):
    """The Chog portrait: the edition's mascot on a pink burst with sparkles."""
    from PIL import Image
    h = w = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = (x - w / 2) / (w / 2)
    cy = (y - h * 0.42) / (h / 2)
    r = np.sqrt(cx ** 2 + cy ** 2)
    a = np.arctan2(cy, cx)
    inner, mid, outer = tex.rgb('#ff8cc0'), tex.rgb('#c43d8a'), tex.rgb('#2a1160')
    t = np.clip(r / 1.25, 0, 1)
    img = np.where((t < 0.45)[..., None], tex.lerp(inner, mid, t / 0.45), tex.lerp(mid, outer, (t - 0.45) / 0.55))
    rays = (np.sin(a * 14) > 0.35).astype(np.float32) * np.clip(1.2 - r, 0, 1)
    img = img * (1 + 0.16 * rays[..., None])
    rr = np.random.default_rng(seed)
    cream = tex.rgb(CREAM)
    for _ in range(26):
        sx, sy = rr.random() * w, rr.random() * h
        s = 6 + rr.random() * 16
        dx, dy = np.abs(x - sx), np.abs(y - sy)
        star = (dx * dy < s * 1.6) & (dx < s) & (dy < s)
        img[star] = cream
    # A cream liner just inside the frame.
    m = int(size * 0.03)
    img[m:m + 5, m:-m] = cream
    img[-m - 5:-m, m:-m] = cream
    img[m:-m, m:m + 5] = cream
    img[m:-m, -m - 5:-m] = cream
    logo = Image.open(os.path.join(blib.PUBLIC, 'editions', 'chog', 'logo.png')).convert('RGBA')
    s = int(size * 0.9)
    logo = logo.resize((s, s), Image.LANCZOS)
    la = np.asarray(logo, np.float32) / 255
    oy, ox = h - s, (w - s) // 2
    region = img[oy:oy + s, ox:ox + s]
    al = la[..., 3:4]
    region[:] = region * (1 - al) + la[..., :3] * al
    return np.clip(img, 0, 1)


# A 5×7 dot-matrix alphabet for the jackpot board and the slot reels.
GLYPHS = {
    'J': ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
    ' ': ['00000'] * 7,
}


def dot_rows(text):
    """A text line as a 7-row 0/1 grid (one blank column between glyphs)."""
    cols = []
    for ch in text:
        g = GLYPHS[ch]
        for c in range(5):
            cols.append([int(g[r][c]) for r in range(7)])
        cols.append([0] * 7)
    return np.array(cols[:-1], np.int8).T


def blur(img, rad):
    """A cheap box blur (three passes ≈ gaussian)."""
    out = img.copy()
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(out, [(rad + 1, rad) if i == ax else (0, 0) for i in range(out.ndim)], mode='edge'), axis=ax)
            hi = np.take(c, np.arange(2 * rad + 1, c.shape[ax]), axis=ax)
            lo = np.take(c, np.arange(0, c.shape[ax] - 2 * rad - 1), axis=ax)
            out = (hi - lo) / (2 * rad + 1)
    return out


def jackpot(w=1024, h=320):
    """The jackpot board: JACKPOT in pink LEDs over a gold running total, a ring of bulbs."""
    img = np.broadcast_to(tex.rgb('#0d0619'), (h, w, 3)).copy()
    lit = np.zeros((h, w, 3), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

    def draw(text, cy, cell, col):
        g = dot_rows(text)
        rows, cols = g.shape
        x0 = (w - cols * cell) / 2
        y0 = cy - rows * cell / 2
        gx = np.floor((xx - x0) / cell).astype(int)
        gy = np.floor((yy - y0) / cell).astype(int)
        inside = (gx >= 0) & (gx < cols) & (gy >= 0) & (gy < rows)
        fx = (xx - x0) / cell - gx - 0.5
        fy = (yy - y0) / cell - gy - 0.5
        dot = inside & (fx * fx + fy * fy < 0.16)
        on = np.zeros_like(dot)
        on[inside] = g[gy[inside], gx[inside]] == 1
        img[dot & ~on] = tex.rgb('#2a1838')
        lit[dot & on] = tex.rgb(col)

    draw('JACKPOT', h * 0.3, 15, '#ff5fae')
    draw('$1,250,000', h * 0.7, 11, '#ffd36b')
    # Chaser bulbs round the edge.
    for k in range(40):
        t = k / 40
        per = 2 * (w + h) - 8 * 18
        d = t * per
        if d < w - 36:
            bx, by = 18 + d, 16
        elif d < w - 36 + h - 32:
            bx, by = w - 18, 16 + d - (w - 36)
        elif d < 2 * (w - 36) + h - 32:
            bx, by = w - 18 - (d - (w - 36) - (h - 32)), h - 16
        else:
            bx, by = 18, h - 16 - (d - 2 * (w - 36) - (h - 32))
        m = (xx - bx) ** 2 + (yy - by) ** 2 < 36
        lit[m] = tex.rgb('#fff1c2' if k % 2 else '#ff7cbf')
    halo = blur(lit, 6)
    img = img + lit + halo * 0.9
    return np.clip(img, 0, 1)


def reels(w=512, h=256):
    """A slot machine's window: three reels, cream, with 7s on the pay line and cherries above and below."""
    img = np.broadcast_to(tex.rgb('#1a0b2e'), (h, w, 3)).copy()
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rw = w / 3
    for k in range(3):
        x0, x1 = k * rw + 8, (k + 1) * rw - 8
        reel = (xx >= x0) & (xx < x1)
        # Curved reel: brighter in the middle, dark top and bottom.
        sh = np.clip(1 - ((yy - h / 2) / (h / 2)) ** 2 * 0.75, 0, 1)
        img[reel] = (tex.rgb('#f6ecd2')[None, :] * sh[reel][:, None])
        # The 7 on the pay line.
        g = dot_rows('7')
        cell = 13
        gx = np.floor((xx - (x0 + (x1 - x0) / 2 - 2.5 * cell)) / cell).astype(int)
        gy = np.floor((yy - (h / 2 - 3.5 * cell)) / cell).astype(int)
        ins = reel & (gx >= 0) & (gx < 5) & (gy >= 0) & (gy < 7)
        on = np.zeros_like(ins)
        on[ins] = g[gy[ins], gx[ins]] == 1
        img[on] = tex.rgb('#d53f7c')
        # Cherries (top) and a diamond (bottom), squashed by the reel's curve.
        mx = (x0 + x1) / 2
        for dx in (-12, 12):
            img[reel & ((xx - mx - dx) ** 2 + ((yy - 24) * 1.6) ** 2 < 120)] = tex.rgb('#b3203a')
        img[reel & (np.abs(xx - mx) / 22 + np.abs(yy - (h - 22)) / 12 < 1)] = tex.rgb('#6b3fd1')
    img[(np.abs(yy - h / 2) < 2)] = tex.rgb('#ff4fa3')
    return np.clip(img, 0, 1)


def suit_cards(size=256):
    """Four square pictures side by side: a big suit on each, pink on cream or cream on purple."""
    out = []
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    sx = (x - size / 2) / (size * 0.36)
    sy = -(y - size / 2) / (size * 0.36)
    for kind, bg, fg in [('heart', '#f3e8c4', '#d53f7c'), ('spade', '#3a1a72', '#f3e8c4'),
                         ('diamond', '#3a1a72', '#ff6fae'), ('club', '#f3e8c4', '#3a1a72')]:
        img = np.broadcast_to(tex.rgb(bg), (size, size, 3)).copy()
        img[suit_mask(kind, sx, sy)] = tex.rgb(fg)
        m = int(size * 0.06)
        edge = tex.rgb(GOLD)
        img[m:m + 3, m:-m] = edge
        img[-m - 3:-m, m:-m] = edge
        img[m:-m, m:m + 3] = edge
        img[m:-m, -m - 3:-m] = edge
        grain = tex.noise(size, size, (24, 24), 3, len(out) + 3)
        img *= (0.93 + 0.08 * grain)[..., None]
        out.append(img)
    return np.clip(np.concatenate(out, axis=1), 0, 1)


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


def face(x, z, tx=0.0, tz=0.0):
    """rot_y that turns an object at (x, z) so its local +z looks at (tx, tz)."""
    return math.atan2(tx - x, tz - z)


def neon(name, pts, mat, r=0.075, closed=False):
    return tube(name, pts, r, mat, segs=8, closed=closed)


# ---------------------------------------------------------------------------
# Shell: carpet, rug, velvet walls, dado, crown
# ---------------------------------------------------------------------------

def build_shell(objs):
    cmat = textured('Carpet', blib.image_from_array('carpet', carpet(1024)), rough=1.0)
    objs.append(blib.grid('Floor', 2 * SIDE, FRONT - BACK, 1, 1, (0, F, (BACK + FRONT) / 2), cmat, uv_scale=7))

    wall_mat = textured('Velvet', blib.image_from_array('velvet', velvet(512)), rough=0.9)
    T = 0.4
    top = F + WALL_H
    objs.append(box('BackWall', (2 * SIDE + 2 * T, WALL_H, T), (0, F + WALL_H / 2, BACK - T / 2), wall_mat))
    for s in (-1, 1):
        objs.append(box(f'SideWall{s}', (T, WALL_H, FRONT - BACK), (s * (SIDE + T / 2), F + WALL_H / 2, (BACK + FRONT) / 2), wall_mat))

    # The front wall is single planes facing the room, so a camera orbiting out past it sees through.
    fw = blib.plane('FrontWall', 2 * SIDE, WALL_H, (0, F + WALL_H / 2, FRONT), wall_mat, rot_y=math.pi)
    objs.append(fw)
    lac = flat(LACQUER, 0.35)
    lac_hi = flat(LACQUER_HI, 0.35)
    gold = flat(GOLD, 0.3, 0.6)
    strip = glow(NEON_PINK, 3.0, 'NeonPink')
    objs.append(blib.plane('FrontDado', 2 * SIDE, DADO, (0, F + DADO / 2, FRONT - 0.02), lac, rot_y=math.pi))
    objs.append(blib.plane('FrontRail', 2 * SIDE, 0.25, (0, F + DADO, FRONT - 0.04), gold, rot_y=math.pi))
    objs.append(blib.plane('FrontGlow', 2 * SIDE, 0.07, (0, F + DADO - 0.2, FRONT - 0.05), strip, rot_y=math.pi))
    for name, length, centre, rot_y in [
        ('DadoBack', 2 * SIDE, (0, F, BACK), 0.0),
        ('DadoL', FRONT - BACK, (-SIDE, F, (BACK + FRONT) / 2), math.pi / 2),
        ('DadoR', FRONT - BACK, (SIDE, F, (BACK + FRONT) / 2), -math.pi / 2),
    ]:
        parts = [
            box(f'{name}Board', (length, DADO, 0.16), (0, DADO / 2, 0.08), lac),
            box(f'{name}Rail', (length, 0.28, 0.36), (0, DADO, 0.18), gold, bevel=0.06),
            box(f'{name}Skirt', (length, 0.7, 0.28), (0, 0.35, 0.14), lac_hi, bevel=0.04),
            box(f'{name}SkirtTrim', (length, 0.08, 0.3), (0, 0.72, 0.15), gold),
            # A thin pink light line under the rail lip.
            box(f'{name}Glow', (length, 0.07, 0.04), (0, DADO - 0.2, 0.38), strip),
        ]
        n = max(1, round(length / 3.0))
        pw = length / n
        for k in range(n):
            px = -length / 2 + pw * (k + 0.5)
            ph = DADO - 1.7
            parts.append(box(f'{name}Panel{k}', (pw - 0.7, ph, 0.12), (px, 1.05 + ph / 2, 0.2), lac_hi, bevel=0.07))
            parts.append(box(f'{name}Inlay{k}', (pw - 1.3, 0.05, 0.03), (px, 1.05 + ph - 0.35, 0.27), gold))
        grp(objs, name, centre, rot_y, parts)
    crown = flat('#2a1550', 0.4)
    for name, size, pos in [
        ('CrownBack', (2 * SIDE, 0.6, 0.5), (0, top - 0.3, BACK + 0.25)),
        ('CrownL', (0.5, 0.6, FRONT - BACK), (-SIDE + 0.25, top - 0.3, (BACK + FRONT) / 2)),
        ('CrownR', (0.5, 0.6, FRONT - BACK), (SIDE - 0.25, top - 0.3, (BACK + FRONT) / 2)),
    ]:
        objs.append(box(name, size, pos, crown, bevel=0.12))
        objs.append(box(name + 'Gold', (size[0] + (0.06 if size[0] < 1 else 0), 0.08, size[2] + (0.06 if size[2] < 1 else 0)),
                        (pos[0], pos[1] - 0.34, pos[2]), gold))


def build_rug(objs):
    mat = textured('Rug', blib.image_from_array('rug', rug(1024 if DRAFT else 2048)), rough=1.0)
    R = 12.8
    r = lathe('Rug', [(0, 0), (R, 0), (R + 0.03, 0.05), (R, 0.1), (0, 0.1)], 128, (0, F, 0), mat,
              cap_top=False, cap_bottom=False, hard_angle=60)
    planar_uv(r, 2 * R, 2 * R, origin=(-R, -R))
    objs.append(r)


# ---------------------------------------------------------------------------
# Back wall: the Chog portrait over a pink banquette, CHOG in neon
# ---------------------------------------------------------------------------

STROKES = {
    # Letters in a 1 × 1.4 box (x right, y up), as polylines.
    'C': [[(0.92 - 0.0, 1.12), *[(0.5 + 0.46 * math.cos(a), 0.7 + 0.66 * math.sin(a))
                                for a in np.linspace(math.radians(50), math.radians(310), 18)], (0.92, 0.28)]],
    'H': [[(0.08, 0.02), (0.08, 1.38)], [(0.92, 0.02), (0.92, 1.38)], [(0.08, 0.72), (0.92, 0.72)]],
    'O': [[(0.5 + 0.44 * math.cos(a), 0.7 + 0.66 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 26)]],
    'G': [[*[(0.5 + 0.46 * math.cos(a), 0.7 + 0.66 * math.sin(a))
             for a in np.linspace(math.radians(48), math.radians(345), 18)], (0.95, 0.62), (0.58, 0.62)]],
}


def neon_text(objs, text, x0, y0, z, height, mat, name):
    s = height / 1.4
    for i, ch in enumerate(text):
        for j, stroke in enumerate(STROKES[ch]):
            pts = [(x0 + (i * 1.32 + px) * s, y0 + py * s, z) for px, py in stroke]
            objs.append(neon(f'{name}{i}_{j}', pts, mat, r=0.085))


def build_back(objs):
    z = BACK
    # The portrait, framed in gold, lit by a brass picture light.
    art = textured('ChogArt', blib.image_from_array('chog_art', chog_art(768)), rough=0.55)
    W = H = 6.0
    cy = F + 9.0
    objs.append(blib.plane('ChogArt', W, H, (0, cy, z + 0.22), art))
    objs.append(picture_frame('ArtFrame', W, H, (0, cy, z + 0.02), 0.0, flat(GOLD, 0.3, 0.6), t=0.55, depth=0.36))
    objs.append(picture_frame('ArtLiner', W - 0.02, H - 0.02, (0, cy, z + 0.12), 0.0, flat('#2a1550', 0.5), t=0.12, depth=0.16))
    objs.append(box('PictureLightArm', (0.12, 0.12, 1.0), (0, cy + H / 2 + 0.75, z + 0.5), flat(BRASS, 0.3, 0.7)))
    objs.append(cylinder('PictureLightBar', 0.2, 3.2, (0, 0, 0), flat(BRASS, 0.3, 0.7), segs=12))
    pl = objs[-1]
    pl.rotation_euler = (0, math.pi / 2, 0)
    pl.location = V(-1.6, cy + H / 2 + 0.75, z + 1.0)
    objs.append(box('PictureLightGlow', (3.0, 0.05, 0.22), (0, cy + H / 2 + 0.57, z + 1.0), glow(LAMP_WARM, 3.0, 'LampWarm')))
    # CHOG in pink neon above it.
    pinkn = glow(NEON_PINK, 4.0, 'NeonPink2')
    hgt = 1.7
    width = (3 * 1.32 + 1.0) * hgt / 1.4
    neon_text(objs, 'CHOG', -width / 2, F + 13.3, z + 0.3, hgt, pinkn, 'NeonChog')
    for i, x in enumerate((-width / 2 - 0.9, width / 2 + 0.9)):
        objs.append(neon(f'NeonStar{i}', [(x - 0.35, F + 14.15, z + 0.3), (x + 0.35, F + 14.15, z + 0.3)], glow(NEON_CREAM, 4.0, 'NeonCream'), r=0.06))
        objs.append(neon(f'NeonStarV{i}', [(x, F + 13.8, z + 0.3), (x, F + 14.5, z + 0.3)], glow(NEON_CREAM, 4.0, 'NeonCream'), r=0.06))

    # Channel-tufted pink banquette along the wall under the portrait.
    vel = flat(VELVET_PINK, 0.8)
    vel_hi = flat(VELVET_PINK_HI, 0.8)
    lac = flat(LACQUER, 0.35)
    gold = flat(GOLD, 0.3, 0.6)
    L = 13.0
    objs.append(box('BanqPlinth', (L, 1.1, 2.5), (0, F + 0.55, z + 1.35), lac, bevel=0.05))
    objs.append(box('BanqPlinthTrim', (L + 0.02, 0.08, 0.04), (0, F + 1.0, z + 2.61), gold))
    objs.append(box('BanqSeat', (L - 0.1, 0.85, 2.5), (0, F + 1.5, z + 1.45), vel_hi, bevel=0.3, segments=3))
    n = 13
    for k in range(n):
        x = -L / 2 + (k + 0.5) * L / n
        objs.append(box(f'BanqChannel{k}', (L / n - 0.04, 3.4, 0.75), (x, F + 3.5, z + 0.55), vel, bevel=0.3, segments=3))
    objs.append(box('BanqCap', (L + 0.3, 0.3, 1.0), (0, F + 5.3, z + 0.5), lac, bevel=0.1))
    objs.append(box('BanqCapTrim', (L + 0.32, 0.06, 1.02), (0, F + 5.13, z + 0.5), gold))
    for s in (-1, 1):
        objs.append(box(f'BanqEnd{s}', (0.45, 4.8, 2.8), (s * (L / 2 + 0.22), F + 2.4, z + 1.4), lac, bevel=0.12))
        objs.append(box(f'BanqEndTrim{s}', (0.47, 0.08, 2.82), (s * (L / 2 + 0.22), F + 4.4, z + 1.4), gold))
    # Two cocktail tables with drinks and a little candle.
    for i, x in enumerate((-3.4, 3.4)):
        tz = z + 4.1
        objs.append(lathe(f'CocktailBase{i}', [(0.9, 0), (0.9, 0.08), (0.2, 0.25), (0.12, 0.3), (0.12, 3.0), (0.3, 3.1), (0, 3.1)],
                          20, (x, F, tz), flat(BRASS, 0.3, 0.7)))
        objs.append(cylinder(f'CocktailTop{i}', 1.25, 0.16, (x, F + 3.1, tz), flat(MARBLE, 0.25), segs=32, bevel=0.04))
        objs.append(blib.torus(f'CocktailRim{i}', 1.25, 0.05, (x, F + 3.18, tz), gold, seg=32, mseg=6))
        drink(objs, f'Drink{i}a', (x - 0.45, F + 3.26, tz + 0.2), '#ff6fae')
        drink(objs, f'Drink{i}b', (x + 0.35, F + 3.26, tz - 0.25), '#ffcf6b')
        objs.append(lathe(f'CandleCup{i}', [(0.16, 0), (0.2, 0.3), (0, 0.3)], 12, (x + 0.1, F + 3.26, tz + 0.5), flat('#6a3fb5', 0.2), cap_top=False))
        objs.append(sphere(f'CandleFlame{i}', 0.07, (x + 0.1, F + 3.62, tz + 0.5), glow('#ffcf7a', 3.0, 'Flame'), scale=(1, 1.6, 1), segs=8, rings=6))


def drink(objs, name, pos, col):
    """A coupe glass with a coloured drink."""
    glass = flat('#d9d2ec', 0.15)
    objs.append(lathe(name, [(0.18, 0), (0.18, 0.03), (0.03, 0.06), (0.03, 0.42), (0.26, 0.6), (0.28, 0.66), (0, 0.66)],
                      12, pos, glass, cap_top=False))
    objs.append(cylinder(name + 'Liquid', 0.25, 0.02, (pos[0], pos[1] + 0.58, pos[2]), flat(col, 0.2), segs=12))


# ---------------------------------------------------------------------------
# Bar (back left): glowing back shelves, a fluted counter, stools
# ---------------------------------------------------------------------------

def build_bar(objs, lights):
    x0, x1 = -SIDE + 0.3, -8.4
    W = x1 - x0
    cx = (x0 + x1) / 2
    z = BACK
    lac = flat(LACQUER, 0.35)
    lac_hi = flat(LACQUER_HI, 0.35)
    gold = flat(GOLD, 0.3, 0.6)
    # Back bar: a low cabinet, a dark mirror and three lit glass shelves full of bottles.
    objs.append(box('BackBarCab', (W, 3.6, 1.6), (cx, F + 1.8, z + 0.8), lac, bevel=0.05))
    objs.append(box('BackBarTop', (W + 0.2, 0.18, 1.8), (cx, F + 3.69, z + 0.9), flat(MARBLE, 0.25), bevel=0.04))
    nd = 5
    for k in range(nd):
        dx = x0 + (k + 0.5) * W / nd
        objs.append(box(f'BackBarDoor{k}', (W / nd - 0.3, 2.6, 0.08), (dx, F + 1.95, z + 1.62), lac_hi, bevel=0.04))
        objs.append(box(f'BackBarPull{k}', (0.7, 0.06, 0.08), (dx, F + 3.0, z + 1.7), gold))
    objs.append(box('BackBarMirror', (W - 0.6, 6.4, 0.06), (cx, F + 7.3, z + 0.08), flat('#3a2a5e', 0.15, 0.4)))
    for s, xx in ((-1, x0 + 0.15), (1, x1 - 0.15)):
        objs.append(box(f'BackBarPost{s}', (0.32, 7.0, 1.3), (xx, F + 7.2, z + 0.65), lac, bevel=0.05))
    objs.append(box('BackBarCrown', (W + 0.3, 0.5, 1.5), (cx, F + 10.9, z + 0.75), lac, bevel=0.08))
    objs.append(box('BackBarCrownTrim', (W + 0.32, 0.07, 1.52), (cx, F + 10.62, z + 0.75), gold))
    shelf_glow = glow(NEON_PINK, 3.0, 'NeonPink')
    bottle_cols = ['#2f6b3a', '#7a3a1a', '#c9a04f', '#d9d2ec', '#6b1f3a', '#2b4a8a', '#a8541c', '#e9c46a', '#5b2b8a']
    for k, y in enumerate((F + 5.4, F + 7.6, F + 9.8)):
        objs.append(box(f'BarShelf{k}', (W - 0.7, 0.1, 1.1), (cx, y, z + 0.6), flat('#b9a8e0', 0.05, 0.2)))
        objs.append(box(f'BarShelfGlow{k}', (W - 0.7, 0.06, 0.05), (cx, y - 0.08, z + 1.13), shelf_glow))
        bx = x0 + 0.8
        while bx < x1 - 0.8:
            col = bottle_cols[int(rng.random() * len(bottle_cols))]
            hgt = 1.2 + rng.random() * 0.5
            rad = 0.2 + rng.random() * 0.08
            if k == 2 and rng.random() < 0.2:
                bx += 0.6
                continue
            objs.append(lathe(f'Bottle{k}_{int(bx * 10)}', [(rad, 0), (rad, hgt * 0.62), (rad * 0.45, hgt * 0.78), (0.08, hgt * 0.84),
                                                              (0.08, hgt), (0, hgt)], 8, (bx, y + 0.05, z + 0.55 + rng.random() * 0.2),
                              flat(col, 0.2), cap_bottom=False))
            bx += 2 * rad + 0.12 + rng.random() * 0.12
        lights.append(('area', f'BarShelfLight{k}', (cx, y - 0.25, z + 1.2), NEON_PINK, 260, (W - 1, 0.6), (cx, y + 1.0, z + 0.3)))
    # The counter: a fluted plum front, black marble top, pink light under the lip, brass foot rail.
    cz = -12.2
    D = 2.6
    cw = x1 + 0.6 - x0
    ccx = x0 + cw / 2
    objs.append(box('BarBody', (cw, 5.5, D - 0.4), (ccx, F + 2.75, cz - 0.1), lac))
    n = int(cw / 0.55)
    for k in range(n):
        fx = x0 + (k + 0.5) * cw / n
        objs.append(box(f'BarFlute{k}', (cw / n - 0.06, 4.6, 0.3), (fx, F + 3.0, cz + D / 2 - 0.15), flat(VELVET_PLUM, 0.6), bevel=0.12, segments=2))
    objs.append(box('BarKick', (cw, 0.6, 0.3), (ccx, F + 0.3, cz + D / 2 - 0.1), lac_hi))
    objs.append(box('BarKickTrim', (cw, 0.07, 0.32), (ccx, F + 0.62, cz + D / 2 - 0.1), gold))
    objs.append(box('BarTop', (cw + 0.4, 0.3, D + 0.6), (ccx, F + 5.65, cz + 0.1), flat(MARBLE, 0.2), bevel=0.1))
    objs.append(box('BarTopTrim', (cw + 0.42, 0.08, 0.06), (ccx, F + 5.62, cz + D / 2 + 0.42), gold))
    objs.append(box('BarUnderGlow', (cw - 0.2, 0.06, 0.06), (ccx, F + 5.38, cz + D / 2 + 0.2), shelf_glow))
    end = x0 + cw
    objs.append(box('BarEnd', (0.4, 5.6, D + 0.2), (end + 0.0, F + 2.8, cz), lac, bevel=0.06))
    rail = flat(BRASS, 0.3, 0.7)
    objs.append(tube('BarRail', [(x0, F + 0.9, cz + D / 2 + 0.6), (end - 0.3, F + 0.9, cz + D / 2 + 0.6)], 0.09, rail))
    for k in range(4):
        rx = x0 + 1.0 + k * (cw - 2) / 3
        objs.append(box(f'BarRailPost{k}', (0.1, 0.1, 0.65), (rx, F + 0.9, cz + D / 2 + 0.3), rail))
    # On the counter: glasses, a shaker, a bottle.
    for k, (gx, col) in enumerate([(-17.4, '#ff6fae'), (-13.2, '#ffcf6b'), (-10.4, '#6b3fd1')]):
        drink(objs, f'BarDrink{k}', (gx, F + 5.8, cz + 0.7), col)
    objs.append(lathe('Shaker', [(0.25, 0), (0.3, 0.8), (0.22, 1.0), (0.12, 1.2), (0, 1.25)], 14, (-15.4, F + 5.8, cz + 0.2), flat('#cfcbe0', 0.15, 0.9)))
    # Stools in front of the counter.
    for k in range(5):
        stool(objs, f'BarStool{k}', (x0 + 1.6 + k * 2.35, F, cz + D / 2 + 1.7), 4.2)
    # Three globe pendants over the counter.
    for k, px in enumerate((-17.2, -14.0, -10.8)):
        pendant_globe(objs, f'BarPendant{k}', (px, F + 10.4, cz + 0.2))
        lights.append(('point', f'BarLamp{k}', (px, F + 10.0, cz + 0.2), '#ffc884', 260, 0.45))


def stool(objs, name, pos, seat_h, seat_col=VELVET_PINK):
    x, _, z = pos
    brass = flat(BRASS, 0.3, 0.7)
    objs.append(lathe(name + 'Base', [(0.85, 0), (0.85, 0.06), (0.6, 0.14), (0.14, 0.22), (0, 0.22)], 20, (x, F, z), flat('#1b1230', 0.3, 0.6)))
    objs.append(cylinder(name + 'Pole', 0.11, seat_h - 0.5, (x, F + 0.2, z), brass, segs=10))
    objs.append(blib.torus(name + 'Ring', 0.62, 0.05, (x, F + seat_h * 0.42, z), brass, seg=20, mseg=6))
    objs.append(cylinder(name + 'Seat', 0.95, 0.5, (x, F + seat_h - 0.35, z), flat(seat_col, 0.8), segs=24, bevel=0.18))


def pendant_globe(objs, name, pos):
    x, y, z = pos
    brass = flat(BRASS, 0.3, 0.7)
    objs.append(tube(name + 'Cord', [(x, y + 0.6, z), (x, CORD_TOP, z)], 0.035, flat('#120a1c', 0.6)))
    objs.append(lathe(name + 'Cap', [(0.0, 0.0), (0.3, 0.0), (0.22, 0.3), (0.06, 0.6), (0, 0.6)], 14, (x, y + 0.35, z), brass))
    objs.append(sphere(name + 'Globe', 0.55, (x, y, z), glow(LAMP_WARM, 3.0, 'LampWarm'), segs=16, rings=10))


def pendant_dome(objs, name, pos, r=1.0, outer=GOLD, cord_top=None):
    x, y, z = pos
    objs.append(tube(name + 'Cord', [(x, y + r * 0.7, z), (x, cord_top or CORD_TOP, z)], 0.035, flat('#120a1c', 0.6)))
    shade = lathe(name + 'Shade', [(r, 0), (r * 0.96, r * 0.2), (r * 0.75, r * 0.5), (r * 0.35, r * 0.68), (r * 0.12, r * 0.74)],
                  24, (x, y, z), flat(outer, 0.3, 0.6), cap_top=True, cap_bottom=False)
    sol = shade.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.05
    objs.append(shade)
    objs.append(cylinder(name + 'Diffuser', r * 0.9, 0.04, (x, y + 0.08, z), glow(LAMP_WARM, 3.0, 'LampWarm'), segs=24))


# ---------------------------------------------------------------------------
# Slots and the jackpot board (back right)
# ---------------------------------------------------------------------------

def build_slots(objs, lights):
    z = BACK
    reel_mat = textured('Reels', blib.image_from_array('reels', reels(512, 256)), emissive=1.5)
    body = flat('#2b1658', 0.35)
    chrome = flat('#c9c3dc', 0.2, 0.9)
    for k, x in enumerate((10.9, 14.1, 17.3)):
        g = []
        g.append(box(f'Slot{k}Base', (2.7, 3.2, 2.0), (0, 1.6, 1.0), body, bevel=0.08))
        g.append(box(f'Slot{k}Body', (2.7, 4.6, 1.4), (0, 5.5, 0.7), body, bevel=0.1))
        for s in (-1, 1):
            g.append(box(f'Slot{k}Side{s}', (0.16, 7.9, 1.6), (s * 1.38, 3.95, 0.85), chrome, bevel=0.05))
        g.append(box(f'Slot{k}Deck', (2.6, 0.35, 1.0), (0, 3.4, 1.7), flat(LACQUER, 0.3), bevel=0.06))
        for b in range(4):
            g.append(box(f'Slot{k}Btn{b}', (0.34, 0.1, 0.3), (-0.75 + b * 0.5, 3.62, 1.75), glow(NEON_CREAM if b % 2 else NEON_PINK, 3.0,
                                                                                              'NeonCream' if b % 2 else 'NeonPink')))
        reel = blib.plane(f'Slot{k}Reel', 2.1, 1.6, (0, 5.0, 1.42), reel_mat)
        g.append(reel)
        g.append(picture_frame(f'Slot{k}ReelFrame', 2.1, 1.6, (0, 5.0, 1.38), 0.0, chrome, t=0.14, depth=0.1))
        g.append(box(f'Slot{k}Panel', (2.1, 1.3, 0.05), (0, 6.95, 1.42), glow('#7a3cff', 2.0, 'NeonViolet')))
        g.append(box(f'Slot{k}Topper', (2.7, 0.9, 1.2), (0, 8.3, 0.6), glow(NEON_PINK, 3.0, 'NeonPink'), bevel=0.3, segments=3))
        g.append(lathe(f'Slot{k}Dome', [(0.5, 0), (0.48, 0.3), (0.3, 0.6), (0, 0.7)], 14, (0, 8.75, 0.6), glow(NEON_CREAM, 4.0, 'NeonCream')))
        grp(objs, f'Slot{k}', (x, F, z), 0.0, g)
        stool(objs, f'SlotStool{k}', (x, F, z + 4.0), 3.6, VELVET_PLUM)
        lights.append(('area', f'SlotGlow{k}', (x, F + 5.6, z + 2.4), '#ff8fd0', 120, (2.4, 3.0), (x, F + 2.0, z + 6)))
    # The jackpot board above them, in a gold frame studded with bulbs.
    jp = textured('Jackpot', blib.image_from_array('jackpot', jackpot(1024, 320)), emissive=1.5)
    jx, jy, jw, jh = 14.1, F + 11.6, 9.2, 2.87
    objs.append(blib.plane('JackpotBoard', jw, jh, (jx, jy, z + 0.35), jp))
    objs.append(picture_frame('JackpotFrame', jw, jh, (jx, jy, z + 0.05), 0.0, flat(GOLD, 0.3, 0.6), t=0.5, depth=0.45))
    bulb = glow(NEON_CREAM, 4.0, 'NeonCream')
    for k in range(14):
        bx = jx - jw / 2 - 0.25 + (jw + 0.5) * k / 13
        for by in (jy + jh / 2 + 0.25, jy - jh / 2 - 0.25):
            objs.append(sphere(f'JackpotBulb{k}_{int(by)}', 0.12, (bx, by, z + 0.55), bulb, segs=8, rings=5))
    lights.append(('area', 'JackpotLight', (jx, jy, z + 1.4), '#ff9ccf', 500, (jw, jh), (jx, jy - 2, z + 8)))


# ---------------------------------------------------------------------------
# Poker tables with chairs, chips and cards
# ---------------------------------------------------------------------------

CHIP_COLS = ['#d53f7c', '#f3e8c4', '#3a1f8f', '#1b1230', '#35c97a', '#ff9a4d']


def build_poker_table(objs, lights, name, pos, chair_col, felt=FELT, skip=()):
    x, _, z = pos
    R = 3.5
    top_y = F + 4.1
    lac = flat(LACQUER, 0.35)
    objs.append(lathe(name + 'Ped', [(1.6, 0), (1.6, 0.15), (1.2, 0.35), (0.45, 0.7), (0.4, 3.2), (1.0, 3.6), (0, 3.6)],
                      24, (x, F, z), lac))
    objs.append(lathe(name + 'Top', [(0, -0.35), (R - 0.3, -0.35), (R, -0.2), (R + 0.02, 0.0), (0, 0.0)], 48,
                      (x, top_y, z), flat('#2a160e', 0.4), cap_top=False, cap_bottom=False))
    objs.append(cylinder(name + 'Felt', R - 0.45, 0.04, (x, top_y, z), flat(felt, 0.95), segs=48))
    objs.append(blib.torus(name + 'Rail', R - 0.25, 0.32, (x, top_y + 0.12, z), flat('#16101e', 0.45), seg=48, mseg=10))
    objs.append(blib.torus(name + 'RailTrim', R - 0.6, 0.035, (x, top_y + 0.05, z), flat(GOLD, 0.3, 0.6), seg=48, mseg=6))
    fy = top_y + 0.04
    # Community cards (face up), the pot, the dealer button.
    for k in range(5):
        objs.append(box(f'{name}Board{k}', (0.42, 0.025, 0.6), (x - 1.0 + k * 0.5, fy + 0.012, z - 0.35), flat(CREAM, 0.5)))
        pip = PINK if k % 2 == 0 else '#24124a'
        objs.append(box(f'{name}BoardPip{k}', (0.16, 0.01, 0.16), (x - 1.0 + k * 0.5, fy + 0.03, z - 0.35), flat(pip, 0.5), rot_y=math.pi / 4))
    chip_stack(objs, f'{name}Pot0', (x + 0.2, fy, z + 0.45), 9, CHIP_COLS[0])
    chip_stack(objs, f'{name}Pot1', (x + 0.62, fy, z + 0.38), 6, CHIP_COLS[1])
    chip_stack(objs, f'{name}Pot2', (x + 0.4, fy, z + 0.82), 12, CHIP_COLS[2])
    chip_stack(objs, f'{name}Pot3', (x - 0.15, fy, z + 0.7), 4, CHIP_COLS[4])
    # Seats round it.
    for k in range(6):
        if k in skip:
            continue
        a = k * math.pi / 3 + math.pi / 6
        dx, dz = math.sin(a), math.cos(a)
        # Each player's hole cards (face down, Chog pink backs) and their stacks.
        cx, cz = x + dx * 2.15, z + dz * 2.15
        rot = math.atan2(dx, dz)
        for j, off in enumerate((-0.18, 0.18)):
            ox, oz = math.cos(a) * off, -math.sin(a) * off
            objs.append(box(f'{name}Hole{k}{j}', (0.42, 0.025, 0.6), (cx + ox, fy + 0.015 + j * 0.02, cz + oz),
                            flat(PINK, 0.5), rot_y=rot + (j - 0.5) * 0.25))
        sx, sz = x + dx * 2.45 + math.cos(a) * 0.75, z + dz * 2.45 - math.sin(a) * 0.75
        for j in range(1 + (k % 3)):
            chip_stack(objs, f'{name}Stack{k}{j}', (sx + j * 0.42 * math.cos(a), fy, sz - j * 0.42 * math.sin(a)),
                       5 + int(rng.random() * 12), CHIP_COLS[(k + j) % len(CHIP_COLS)])
        chair(objs, f'{name}Chair{k}', (x + dx * 4.6, F, z + dz * 4.6), math.atan2(-dx, -dz), chair_col)
    objs.append(cylinder(f'{name}Button', 0.22, 0.08, (x + 1.2, fy, z - 1.1), flat(CREAM, 0.4), segs=16))
    # A drum pendant over it.
    py = F + 11.0
    shade = lathe(name + 'Drum', [(2.4, 0), (2.4, 1.4)], 40, (x, py, z), flat('#2a1550', 0.8),
                  cap_top=False, cap_bottom=False)
    sol = shade.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.06
    objs.append(shade)
    for yy in (0.0, 1.4):
        objs.append(blib.torus(f'{name}DrumTrim{int(yy)}', 2.42, 0.05, (x, py + yy, z), flat(GOLD, 0.3, 0.6), seg=40, mseg=6))
    objs.append(cylinder(name + 'DrumDiffuser', 2.35, 0.04, (x, py + 0.25, z), glow(LAMP_WARM, 2.5, 'LampWarm2'), segs=40))
    for k in range(3):
        a = k * 2 * math.pi / 3
        objs.append(tube(f'{name}DrumCord{k}', [(x + math.cos(a) * 2.3, py + 1.4, z + math.sin(a) * 2.3), (x, CORD_TOP, z)], 0.025, flat('#120a1c', 0.6)))
    lights.append(('spot', name + 'Pool', (x, py - 0.1, z), '#ffcf9a', 2600, 2.0, 95))


def chip_stack(objs, name, pos, n, col):
    x, y, z = pos
    h = n * 0.07
    objs.append(cylinder(name, 0.2, h, (x, y, z), flat(col, 0.5), segs=12))
    # A pale edge stripe so a stack reads as chips.
    objs.append(cylinder(name + 'Edge', 0.205, 0.025, (x, y + h * 0.5, z), flat('#fdf6cd' if col != '#f3e8c4' else PINK, 0.5), segs=12))


def chair(objs, name, pos, rot_y, col):
    """A low-backed tub chair in velvet on brass legs, facing local +z."""
    vel = flat(col, 0.8)
    hi = flat(blib.mix_hex(col, '#ffffff', 0.1), 0.8)
    brass = flat(BRASS, 0.3, 0.7)
    parts = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(cylinder(f'{name}Leg{sx}{sz}', 0.08, 1.6, (sx * 0.75, 0, sz * 0.7), brass, segs=6, r_top=0.11))
    parts.append(box(f'{name}Seat', (2.0, 0.9, 1.9), (0, 2.05, 0.05), hi, bevel=0.3, segments=3))
    parts.append(box(f'{name}Back', (2.1, 2.1, 0.5), (0, 3.2, -0.85), vel, bevel=0.24, segments=2))
    for s in (-1, 1):
        parts.append(box(f'{name}Arm{s}', (0.42, 1.25, 1.75), (s * 1.0, 2.7, -0.05), vel, bevel=0.2, segments=2))
    grp(objs, name, pos, rot_y, parts)


# ---------------------------------------------------------------------------
# Neon suits on the side walls, booths, plants
# ---------------------------------------------------------------------------

def suit_outline(kind, n=40):
    """A suit's outline as a closed polyline in about -1..1 (x right, y up)."""
    if kind == 'heart':
        t = np.linspace(0, 2 * math.pi, n)
        x = 16 * np.sin(t) ** 3
        y = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
        return [(px / 17, (py + 2.5) / 15) for px, py in zip(x, y)]
    if kind == 'diamond':
        return [(0, 1), (0.72, 0), (0, -1), (-0.72, 0), (0, 1)]
    if kind == 'spade':
        t = np.linspace(0, 2 * math.pi, n)
        x = 16 * np.sin(t) ** 3
        y = -(13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t))
        return [(px / 17, (py - 2.5) / 15 + 0.15) for px, py in zip(x, y)]
    raise ValueError(kind)


def build_wall_neon(objs, lights):
    pinkn = glow(NEON_PINK, 4.0, 'NeonPink2')
    cream = glow(NEON_CREAM, 4.0, 'NeonCream')
    lilac = glow(NEON_LILAC, 4.0, 'NeonLilac')
    y = F + 10.4
    s = 1.3
    for side, items in ((-1, [('heart', pinkn, -5.6), ('spade', cream, -1.4)]), (1, [('diamond', pinkn, -5.6), ('spade', lilac, -1.4)])):
        xw = side * (SIDE - 0.3)
        for kind, mat, zc in items:
            pts = [(xw, y + py * s, zc + side * px * s) for px, py in suit_outline(kind)]
            objs.append(neon(f'NeonSuit{side}{kind}', pts, mat, r=0.08))
            if kind == 'spade':
                objs.append(neon(f'NeonSuitStem{side}', [(xw, y - 0.55 * s, zc), (xw, y - 1.15 * s, zc - 0.35 * s), (xw, y - 1.15 * s, zc + 0.35 * s),
                                                          (xw, y - 0.55 * s, zc)], mat, r=0.08))
        col = NEON_PINK
        lights.append(('area', f'NeonWall{side}', (side * (SIDE - 1.2), y, -3.5), col, 300, (1.5, 7.0), (0, y - 3, -3.5)))


def build_booth(objs, lights, side, zc):
    """A booth bay against a side wall: two channel-tufted benches facing across a table."""
    xw = side * SIDE
    L = 6.6
    xc = xw - side * L / 2
    vel = flat(VELVET_PLUM, 0.8)
    vel_hi = flat(blib.mix_hex(VELVET_PLUM, '#ffffff', 0.08), 0.8)
    lac = flat(LACQUER, 0.35)
    gold = flat(GOLD, 0.3, 0.6)
    for j, dz in enumerate((-3.0, 3.0)):
        facing = -1 if dz > 0 else 1       # bench faces the table
        bz = zc + dz
        parts = [
            box(f'Booth{side}{j}Plinth', (L, 1.0, 2.4), (0, 0.5, 0.0), lac),
            box(f'Booth{side}{j}Seat', (L - 0.1, 0.8, 2.3), (0, 1.4, 0.1), vel_hi, bevel=0.28, segments=3),
            box(f'Booth{side}{j}Cap', (L, 0.25, 0.9), (0, 6.2, -1.1), lac, bevel=0.08),
            box(f'Booth{side}{j}CapTrim', (L + 0.02, 0.06, 0.92), (0, 6.05, -1.1), gold),
        ]
        n = 8
        for k in range(n):
            px = -L / 2 + (k + 0.5) * L / n
            parts.append(box(f'Booth{side}{j}Ch{k}', (L / n - 0.04, 4.3, 0.75), (px, 3.95, -0.95), vel, bevel=0.3, segments=3))
        rot = 0.0 if facing > 0 else math.pi
        grp(objs, f'Booth{side}{j}', (xc, F, bz), rot, parts)
    # The table between, on a brass pedestal.
    tx = xw - side * 3.0
    objs.append(lathe(f'BoothTableBase{side}', [(0.8, 0), (0.8, 0.08), (0.2, 0.25), (0.15, 3.3), (0, 3.3)], 16, (tx, F, zc), flat(BRASS, 0.3, 0.7)))
    objs.append(box(f'BoothTableTop{side}', (4.6, 0.18, 2.5), (tx + side * 0.6, F + 3.4, zc), flat(MARBLE, 0.22), bevel=0.06))
    objs.append(box(f'BoothTableTrim{side}', (4.62, 0.06, 2.52), (tx + side * 0.6, F + 3.3, zc), gold))
    drink(objs, f'BoothDrink{side}a', (tx - 0.4, F + 3.49, zc - 0.5), '#ff6fae')
    drink(objs, f'BoothDrink{side}b', (tx + 0.5, F + 3.49, zc + 0.6), '#6b3fd1')
    chip_stack(objs, f'BoothChips{side}', (tx + side * 1.4, F + 3.49, zc + 0.1), 10, PINK)
    pendant_dome(objs, f'BoothLamp{side}', (tx, F + 9.4, zc), r=0.9)
    lights.append(('point', f'BoothLamp{side}', (tx, F + 9.1, zc), '#ffc884', 450, 0.5))
    # Two suit pictures above the booth.
    cards = textured('SuitCards', blib.image_from_array('suits', suit_cards(256)), rough=0.6)
    for j, (dz, quarter) in enumerate(((-1.7, 0 if side < 0 else 2), (1.7, 1 if side < 0 else 3))):
        pz = zc + dz
        p = blib.plane(f'SuitPic{side}{j}', 2.6, 2.6, (xw - side * 0.2, F + 9.6, pz), cards, rot_y=-side * math.pi / 2)
        me = p.data
        uv = me.uv_layers['UVMap']
        for li in range(len(me.loops)):
            u, v = uv.data[li].uv
            uv.data[li].uv = ((quarter + u) / 4, v)
        objs.append(p)
        objs.append(picture_frame(f'SuitFrame{side}{j}', 2.6, 2.6, (xw - side * 0.12, F + 9.6, pz), -side * math.pi / 2, gold, t=0.22, depth=0.18))


def build_plant(objs, name, x, z, seed):
    r = np.random.default_rng(seed)
    pot = flat(GOLD, 0.3, 0.6)
    objs.append(lathe(name + 'Pot', [(0.8, 0), (0.85, 0.1), (1.25, 1.6), (1.3, 2.4), (1.4, 2.5), (1.2, 2.5), (0, 2.3)],
                      24, (x, F, z), pot, cap_top=False))
    objs.append(cylinder(name + 'Soil', 1.18, 0.05, (x, F + 2.3, z), flat('#1d1410', 0.95), segs=20))
    greens = ['#2c6b3d', '#3a8048', '#25583a', '#4a9150']
    for k in range(11):
        a = k * 2.4 + r.random() * 0.4
        tilt = 0.3 + 0.5 * r.random()
        length = 2.0 + r.random() * 1.3
        stem_h = 2.8 + r.random() * 3.6
        base = (x + math.cos(a) * 0.2, F + 2.3, z + math.sin(a) * 0.2)
        tip = (x + math.cos(a) * (0.5 + tilt * 1.5), F + 2.3 + stem_h, z + math.sin(a) * (0.5 + tilt * 1.5))
        objs.append(tube(f'{name}Stem{k}', [base, ((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2 + 0.3, (base[2] + tip[2]) / 2), tip],
                         0.05, flat('#4f7a34', 0.7)))
        lf = leaf(f'{name}Leaf{k}', length, 1.0 + r.random() * 0.45, flat(greens[k % 4], 0.6), droop=0.25 + r.random() * 0.2)
        lf.location = V(*tip)
        lf.rotation_euler = (0.95 - tilt * 0.5, 0, math.atan2(-math.cos(a), -math.sin(a)))
        objs.append(lf)


def build_front(objs, lights):
    """The entrance on the front wall: tall lacquered doors between pink drapes, a neon heart, a velvet rope."""
    z = FRONT
    lac_hi = flat(LACQUER_HI, 0.35)
    gold = flat(GOLD, 0.3, 0.6)
    brass = flat(BRASS, 0.3, 0.7)
    DH = 10.0
    for s in (-1, 1):
        objs.append(box(f'Door{s}', (3.1, DH, 0.3), (s * 1.6, F + DH / 2, z - 0.15), lac_hi, bevel=0.06))
        objs.append(box(f'DoorPanelT{s}', (2.3, 3.6, 0.1), (s * 1.6, F + DH - 2.6, z - 0.33), flat(LACQUER, 0.35), bevel=0.05))
        objs.append(box(f'DoorPanelB{s}', (2.3, 4.2, 0.1), (s * 1.6, F + 2.6, z - 0.33), flat(LACQUER, 0.35), bevel=0.05))
        objs.append(box(f'DoorPull{s}', (0.14, 3.2, 0.14), (s * 0.45, F + 5.0, z - 0.6), brass, bevel=0.04))
        objs.append(box(f'DoorJamb{s}', (0.5, DH + 0.5, 0.5), (s * 3.4, F + (DH + 0.5) / 2, z - 0.25), gold, bevel=0.08))
    objs.append(box('DoorHead', (7.3, 0.6, 0.6), (0, F + DH + 0.3, z - 0.3), gold, bevel=0.1))
    # Pink velvet drapes either side, gathered back, under a plum pelmet (built facing the back wall, turned round).
    drape = flat(VELVET_PINK, 0.9)
    rod_y = F + DH + 2.0
    for k, (xc, gather) in enumerate(((-6.0, -7.6), (6.0, 7.6))):
        c = curtain(f'Drape{k}', xc, 4.4, rod_y, F + 0.15, -z, gather, drape, 10 + k)
        c.rotation_euler = (0, 0, math.pi)
        dec = c.modifiers.new('Lighter', 'DECIMATE')
        dec.ratio = 0.35
        objs.append(c)
    objs.append(box('Pelmet', (17.0, 1.1, 0.6), (0, rod_y + 0.3, z - 0.9), flat(PLUM, 0.8), bevel=0.15))
    objs.append(box('PelmetTrim', (17.02, 0.08, 0.62), (0, rod_y - 0.22, z - 0.9), gold))
    # A pink neon heart above.
    pinkn = glow(NEON_PINK, 4.0, 'NeonPink2')
    hs = 1.15
    pts = [(-px * hs, F + 14.0 + py * hs, z - 0.3) for px, py in suit_outline('heart')]
    objs.append(neon('NeonHeartFront', pts, pinkn, r=0.08))
    lights.append(('area', 'NeonFront', (0, F + 14.0, z - 1.2), NEON_PINK, 300, (2.5, 2.5), (0, F + 10, z - 8)))
    # Brass stanchions and a velvet rope in front of the doors.
    rope = flat(VELVET_PINK, 0.7)
    posts = [-4.5, -1.5, 1.5, 4.5]
    rz = z - 4.5
    for i, x in enumerate(posts):
        objs.append(lathe(f'Stanchion{i}', [(0.5, 0), (0.5, 0.08), (0.12, 0.25), (0.1, 3.3), (0.2, 3.4), (0.2, 3.6), (0, 3.75)],
                          14, (x, F, rz), brass))
    for i in range(len(posts) - 1):
        a, b = posts[i], posts[i + 1]
        pts = [(a + (b - a) * t, F + 3.3 - 0.9 * math.sin(math.pi * t), rz) for t in np.linspace(0, 1, 9)]
        objs.append(tube(f'Rope{i}', pts, 0.09, rope, segs=8))
    lights.append(('spot', 'DoorLight', (0, F + 13.5, z - 7.0), '#ffcf9a', 1400, 1.0, 80, (0, F + 4.0, z)))


# ---------------------------------------------------------------------------
# Lights (bake only)
# ---------------------------------------------------------------------------

def aim(obj, target):
    d = V(*target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def setup_lighting(lights):
    world = bpy.data.worlds.new('Night')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*blib.hex_rgb('#2a1a4a'), 1)
    bg.inputs['Strength'].default_value = 0.35
    bpy.context.scene.world = world

    def make(name, kind, pos, color, power):
        L = bpy.data.lights.new(name, kind)
        L.energy = power
        L.color = blib.hex_rgb(color)
        o = bpy.data.objects.new(name, L)
        blib.link(o)
        o.location = V(*pos)
        return o

    # A warm pool over the game table (off camera), falling away toward the walls.
    pool = make('TablePool', 'SPOT', (0, 18, 1), '#ffd8c0', 15000)
    pool.data.spot_size = math.radians(105)
    pool.data.spot_blend = 1.0
    pool.data.shadow_soft_size = 3.5
    # A soft lilac wash from above so the far walls never go black.
    wash = make('Wash', 'AREA', (0, F + 17, -6), '#9b7be0', 2200)
    wash.data.shape = 'RECTANGLE'
    wash.data.size, wash.data.size_y = 36, 18
    # The portrait's picture light and the CHOG neon.
    pic = make('PictureLight', 'SPOT', (0, F + 12.6, BACK + 1.8), '#ffd6a0', 900)
    pic.data.spot_size = math.radians(70)
    pic.data.spot_blend = 0.8
    pic.data.shadow_soft_size = 0.6
    aim(pic, (0, F + 8.5, BACK))
    ch = make('ChogNeon', 'AREA', (0, F + 14.1, BACK + 0.9), NEON_PINK, 700)
    ch.data.shape = 'RECTANGLE'
    ch.data.size, ch.data.size_y = 7.5, 2.2
    aim(ch, (0, F + 11, BACK + 8))
    for i, x in enumerate((-6.5, 6.5)):
        b = make(f'BanquetteGlow{i}', 'POINT', (x * 0.6, F + 5.2, BACK + 3.2), '#ff7fb8', 140)
        b.data.shadow_soft_size = 0.8
    for item in lights:
        kind, name, pos = item[0], item[1], item[2]
        if kind == 'point':
            _, _, _, col, power, size = item
            o = make(name, 'POINT', pos, col, power)
            o.data.shadow_soft_size = size
        elif kind == 'spot':
            _, _, _, col, power, size, cone, *tgt = item
            o = make(name, 'SPOT', pos, col, power)
            o.data.shadow_soft_size = size
            o.data.spot_size = math.radians(cone)
            o.data.spot_blend = 0.9
            aim(o, tgt[0] if tgt else (pos[0], F, pos[2]))
        else:
            _, _, _, col, power, (sx, sy), tgt = item
            o = make(name, 'AREA', pos, col, power)
            o.data.shape = 'RECTANGLE'
            o.data.size, o.data.size_y = sx, sy
            aim(o, tgt)


# ---------------------------------------------------------------------------

def build_all():
    objs: list = []
    lights: list = []
    build_shell(objs)
    build_rug(objs)
    build_back(objs)
    build_bar(objs, lights)
    build_slots(objs, lights)
    build_poker_table(objs, lights, 'PokerA', (-14.6, F, -1.8), VELVET_PINK)
    build_poker_table(objs, lights, 'PokerB', (14.6, F, -1.4), VELVET_PLUM, felt='#4a2a9e')
    build_wall_neon(objs, lights)
    for side in (-1, 1):
        build_booth(objs, lights, side, 12.5)
    build_front(objs, lights)
    build_plant(objs, 'PlantA', -7.4, -15.2, 1)
    build_plant(objs, 'PlantB', 7.6, -15.2, 2)
    build_plant(objs, 'PlantC', -18.2, 6.4, 3)
    build_plant(objs, 'PlantD', 18.2, 6.6, 4)
    build_plant(objs, 'PlantE', -9.6, FRONT - 1.6, 5)
    build_plant(objs, 'PlantF', 9.6, FRONT - 1.6, 6)
    return objs, lights


def occluders():
    """The table and board, in the bake only as shadow casters."""
    finish = flat('#2b1764', 0.45, name='OccluderWood')
    occ = table_mod.build(finish, finish)
    occ.append(box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#1c1140', 0.6, name='OccluderBoard')))
    return occ


def report():
    import re
    tally = {}
    for o in blib.mesh_objects():
        key = re.sub(r'[\d_]+.*$', '', o.name) or o.name
        tally[key] = tally.get(key, 0) + sum(len(p.vertices) - 2 for p in o.data.polygons)
    for k, v in sorted(tally.items(), key=lambda kv: -kv[1])[:25]:
        blib.log(f'{v:7d}  {k}')
    blib.log(f'{sum(tally.values()):7d}  total')


def uv_walls():
    for o in blib.mesh_objects():
        if o.name.startswith(('BackWall', 'SideWall', 'FrontWall')):
            blib.box_uv_world(o, 4.0)


def preview():
    """Path-traced stills from the game's cameras (no bake) for judging layout and light."""
    sc = blib.reset()
    objs, lights = build_all()
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
    cams = {
        'table': ((0, 13.65, 12.1), (0, 0, 0)),
        'cine': ((0.6, 1.55, 7.2), (0.2, 0.35, 4.8)),
        'back': ((0, 2.2, 7.5), (0, 1.6, -4)),
        'follow': ((-1.0, 2.6, -8.4), (-0.6, 0.2, -4.6)),
        'side': ((8.4, 2.6, 1.0), (4.6, 0.2, 0.6)),
        'left': ((-8.4, 2.6, 1.0), (-4.6, 0.2, 0.6)),
        'wallL': ((6, 3.0, 3), (-20, 0, -3)),
        'wallR': ((-6, 3.0, 3), (20, 0, -3)),
        'front': ((0, 3.0, -6), (0, 0, 20)),
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
        sc.render.filepath = os.path.join(out_dir, f'chog-{name}.png')
        bpy.ops.render.render(write_still=True)
        blib.log('wrote', sc.render.filepath)


def main():
    if PREVIEW:
        preview()
        return
    blib.reset()
    objs, lights = build_all()
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
    blib.cull_hidden([o for o in lit if not o.name.startswith(('Floor', 'Rug'))], F + 0.0, eps=0.05)

    small = ('Bottle', 'Drink', 'BarDrink', 'BoothDrink', 'Candle', 'Chip', 'Shaker', 'JackpotBulb')

    def weight(o):
        # Texel density where the camera looks: the rug and the floor round the table first.
        n = o.name
        if n.startswith('Rug'):
            return 3.0
        if n.startswith('Floor'):
            return 2.0
        if 'Stack' in n or 'Pot' in n or 'Hole' in n or 'Board' in n and n.startswith('Poker') or n.startswith(small):
            return 0.3
        if 'Leg' in n or 'Cord' in n or 'Stem' in n or 'Trim' in n or 'Inlay' in n or 'Rail' in n:
            return 0.5
        if n.startswith(('BackWall', 'SideWall', 'Crown', 'Front')):
            return 0.7
        if n.startswith(('Booth', 'Plant', 'SuitPic', 'SuitFrame')):
            return 0.7   # in front of the table: only the low views see them
        return 1.0
    blib.lightmap_unwrap(lit, margin=0.002 if not DRAFT else 0.004, weight=weight)
    size, spp = (1024, 24) if DRAFT else (2048, 48)
    # Three diffuse bounces fill a room this dark well enough and keep the final bake near an hour.
    sc = bpy.context.scene
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    scale = blib.bake_lightmap(lit, size=size, samples=spp,
                               out_file=os.path.join(blib.PUBLIC, 'models', 'chog', 'room-light.webp'))

    # One mesh for every plain-coloured thing, one per textured surface, one for the glowing bits.
    flat_objs = [o for o in lit if all(m.name == 'Flat' for m in o.data.materials)]
    tex_objs = [o for o in lit if o not in flat_objs]
    groups = {}
    for o in tex_objs:
        groups.setdefault(o.data.materials[0].name, []).append(o)
    out = [blib.join(flat_objs, 'RoomFlat')]
    for name, os_ in groups.items():
        out.append(blib.join(os_, f'Room{name}'))
    out.append(blib.join(unlit, 'RoomGlow'))
    for o in occ_objs:
        bpy.data.objects.remove(o)
    flat_mesh = out[0]
    if flat_mesh and 'UVMap' in flat_mesh.data.uv_layers:
        flat_mesh.data.uv_layers.remove(flat_mesh.data.uv_layers['UVMap'])
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in out if o)
    blib.log(f'{tris} triangles in {len(out)} meshes')
    blib.export_glb([o for o in out if o], 'models/chog/room.glb', normals=False)
    blib.record('chogRoom', {
        'url': '/models/chog/room.glb',
        'lightmap': '/models/chog/room-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })


if __name__ == '__main__':
    main()
