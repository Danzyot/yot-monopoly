"""Procedural textures drawn with numpy (no downloads, no licences).

Every function returns an (H, W, 3) float array in 0..1 (sRGB), row 0 at the
top, ready for blib.image_from_array. Tiling textures wrap seamlessly.
"""

from __future__ import annotations

import math

import numpy as np


def rgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def noise(h: int, w: int, cells: tuple[int, int], octaves=4, seed=0, wrap=True) -> np.ndarray:
    """Tileable value noise in 0..1, `cells` = lattice cells across (y, x) at the first octave."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    cy, cx = cells
    for _ in range(octaves):
        g = rng.random((cy, cx)).astype(np.float32)
        ys = np.linspace(0, cy, h, endpoint=False)
        xs = np.linspace(0, cx, w, endpoint=False)
        y0 = np.floor(ys).astype(int)
        x0 = np.floor(xs).astype(int)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        y1 = (y0 + 1) % cy if wrap else np.minimum(y0 + 1, cy - 1)
        x1 = (x0 + 1) % cx if wrap else np.minimum(x0 + 1, cx - 1)
        a = g[y0][:, x0]
        b = g[y0][:, x1]
        c = g[y1][:, x0]
        d = g[y1][:, x1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        total += amp
        amp *= 0.5
        cy, cx = cy * 2, cx * 2
    return out / total


def lerp(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2:
        t = t[..., None]
    return a * (1 - t) + b * t


# --------------------------------------------------------------------------
# Floor: warm oak planks running along x
# --------------------------------------------------------------------------

def planks(size=1024, rows=8, base='#6c4426', seed=3) -> np.ndarray:
    """A tile of `rows` plank rows; boards of varied length with staggered joints and grain."""
    rng = np.random.default_rng(seed)
    h = w = size
    img = np.zeros((h, w, 3), np.float32)
    rh = h // rows
    grain_n = noise(h, w, (rows * 2, 6), 4, seed + 1)
    fine = noise(h, w, (rows * 24, 3), 3, seed + 2)
    yy = np.arange(h)[:, None].astype(np.float32)
    xx = np.arange(w)[None, :].astype(np.float32)
    b = rgb(base)
    for r in range(rows):
        y0, y1 = r * rh, (r + 1) * rh
        # Boards run round the tile (indices wrap) so the texture tiles without a seam.
        x0 = rng.random() * w
        x = x0
        while x < x0 + w:
            length = min(w * (0.35 + rng.random() * 0.4), x0 + w - x)
            tone = 0.82 + rng.random() * 0.3
            hue = np.array([1.0, 0.97 + rng.random() * 0.05, 0.92 + rng.random() * 0.1], np.float32)
            xs = np.arange(int(x), int(x + length)) % w
            if len(xs):
                phase = rng.random() * 50
                gn = grain_n[y0:y1][:, xs]
                fn = fine[y0:y1][:, xs]
                # Grain: stretched streaks that wander with low-frequency noise.
                g = np.sin((yy[y0:y1] * 0.9 + gn * 40 + phase) * 1.3) * 0.5 + 0.5
                streak = 0.86 + 0.14 * g * (0.6 + 0.4 * fn)
                img[y0:y1, xs] = b * tone * hue * streak[..., None]
                img[y0:y1, xs[:2]] *= 0.45
            x += length
        # Seam between rows, with a soft bevel highlight under it.
        img[y0:y0 + 2] *= 0.4
        img[y0 + 2:y0 + 4] *= 1.08
    img = np.clip(img, 0, 1)
    return img


# --------------------------------------------------------------------------
# Wallpaper: deep green damask with fine gold pinstripes
# --------------------------------------------------------------------------

def wallpaper(size=512, base='#2d4a3e', motif='#3a5d4f', line='#8f7c4c') -> np.ndarray:
    h = w = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32) / size
    b, m, l = rgb(base), rgb(motif), rgb(line)
    img = np.broadcast_to(b, (h, w, 3)).copy()
    # Damask: a lozenge lattice with a four-petal flower in each cell (two per tile).
    cx = (x * 2) % 1 - 0.5
    cy = (y * 2) % 1 - 0.5
    # Offset every other row by half a cell.
    row = np.floor(y * 2) % 2
    cx = np.where(row == 1, ((x * 2 + 0.5) % 1) - 0.5, cx)
    r = np.sqrt(cx ** 2 + cy ** 2)
    a = np.arctan2(cy, cx)
    petals = 0.18 + 0.12 * np.cos(4 * a) ** 2
    flower = r < petals
    centre = r < 0.05
    lozenge = np.abs(np.abs(cx) + np.abs(cy) - 0.42) < 0.012
    img[flower] = m
    img[centre] = lerp(m, l, 0.6)
    img[lozenge] = lerp(m, b, 0.3)
    # Pinstripes between the motifs.
    stripe = (np.abs(((x * 4) % 1) - 0.5) > 0.495)
    img[stripe] = lerp(b, l, 0.45)
    grain = noise(h, w, (16, 16), 3, 7)
    img *= (0.94 + 0.08 * grain)[..., None]
    return np.clip(img, 0, 1)


# --------------------------------------------------------------------------
# Rug: round, Monopoly red field, cream and navy borders, a fringe
# --------------------------------------------------------------------------

def rug(size=2048, red='#a8261f', cream='#ecdcb5', navy='#1d2b4a', gold='#c99a3c', seed=5) -> np.ndarray:
    h = w = size
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = (x - w / 2 + 0.5) / (w / 2)
    cy = (y - h / 2 + 0.5) / (h / 2)
    r = np.sqrt(cx ** 2 + cy ** 2)
    a = np.arctan2(cy, cx)
    R, C, N, G = rgb(red), rgb(cream), rgb(navy), rgb(gold)
    img = np.broadcast_to(R, (h, w, 3)).copy()

    def band(r0, r1, col):
        img[(r >= r0) & (r < r1)] = col

    # From the outside in (radius 1 = rug edge).
    band(0.985, 1.01, C)       # fringe base
    band(0.955, 0.985, N)
    band(0.945, 0.955, G)
    band(0.86, 0.945, C)       # wide cream border with a motif ring
    band(0.85, 0.86, G)
    band(0.835, 0.85, N)
    # Motifs on the cream border: diamonds alternating navy / red.
    k = 48
    seg = (a / (2 * math.pi) * k) % 1 - 0.5
    rr = (r - 0.9025) / 0.042
    diamond = (np.abs(seg) * 2.2 + np.abs(rr)) < 0.85
    which = (np.floor(a / (2 * math.pi) * k) % 2) == 0
    img[diamond & which & (r > 0.86) & (r < 0.945)] = N
    img[diamond & ~which & (r > 0.86) & (r < 0.945)] = R
    dot = (np.abs(seg) * 4 + np.abs(rr) * 2) < 0.35
    img[dot & (r > 0.86) & (r < 0.945)] = G
    # Inner field: a ring of scalloped arches and a central star (mostly under the table).
    scal = 0.74 + 0.03 * np.cos(a * 24)
    img[(r > scal - 0.012) & (r < scal + 0.012)] = C
    img[(r > 0.6) & (r < 0.612)] = G
    star = r < (0.16 + 0.1 * np.abs(np.cos(a * 4)) ** 3)
    img[star] = C
    img[r < 0.06] = N
    # Fringe: fine radial threads in the outermost band.
    threads = (np.sin(a * 900) > 0.2) & (r > 0.985)
    img[threads] = lerp(C, R, 0.15)
    # Wool texture and wear.
    wool = noise(h, w, (64, 64), 3, seed)
    wear = noise(h, w, (6, 6), 3, seed + 1)
    img *= (0.88 + 0.16 * wool * (0.7 + 0.3 * wear))[..., None]
    return np.clip(img, 0, 1)


# --------------------------------------------------------------------------
# Window: a moonlit night over rooftops
# --------------------------------------------------------------------------

def night_window(w=1024, h=820, seed=9) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    t = y / h
    img = lerp(rgb('#0a1230'), rgb('#2c4278'), t ** 1.4)
    # Stars.
    for _ in range(220):
        sx, sy = rng.random() * w, rng.random() * h * 0.6
        rad = 0.8 + rng.random() * 1.6
        b = 0.4 + rng.random() * 0.6
        d = np.hypot(x - sx, y - sy)
        img += (np.clip(1 - d / rad, 0, 1) * b)[..., None] * rgb('#fff7e0')
    # Moon with a glow.
    mx, my = w * 0.72, h * 0.22
    d = np.hypot(x - mx, y - my)
    img += (np.exp(-d / 90) * 0.5)[..., None] * rgb('#fff1c9')
    moon = d < 46
    img[moon] = rgb('#fff6dc')
    craters = noise(h, w, (40, 40), 2, seed + 3)
    img[moon] *= (0.9 + 0.1 * craters[moon])[..., None]
    # Rooftops with lit windows.
    skyline = np.full(w, h, np.float32)
    xx = 0
    while xx < w:
        bw = 50 + rng.random() * 90
        top = h * (0.6 + rng.random() * 0.25)
        skyline[int(xx):int(xx + bw)] = top
        xx += bw + rng.random() * 8
    building = y >= skyline[None, :]
    img[building] = rgb('#070b1a')
    lit = (np.sin(x / 9) > 0.55) & (np.sin(y / 11) > 0.6) & building
    flick = noise(h, w, (h // 22, w // 18), 1, seed + 4) > 0.62
    img[lit & flick] = rgb('#ffcf7a')
    return np.clip(img, 0, 1)


# --------------------------------------------------------------------------
# Paintings
# --------------------------------------------------------------------------

def painting_landscape(w=640, h=480, seed=12) -> np.ndarray:
    """Rolling hills at dusk, in a loose painterly style."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    t = y / h
    img = lerp(rgb('#f2b36b'), rgb('#e9d6a8'), np.clip(t * 2.2, 0, 1))
    img = lerp(rgb('#7d93c6'), img, np.clip(t * 3.2, 0, 1))
    d = np.hypot(x - w * 0.3, y - h * 0.42)
    img = lerp(img, rgb('#fff1c0'), np.clip(1 - d / 40, 0, 1))
    for k, (base, col) in enumerate([(0.55, '#7b9b5a'), (0.65, '#5d8448'), (0.78, '#3f6a3a'), (0.9, '#2f5530')]):
        xs = x[0]
        ridge = h * base + np.sin(xs / w * (3 + k) * math.pi + k) * h * 0.05 + np.sin(xs / w * 11 + k * 2) * h * 0.015
        img[y > ridge[None, :]] = rgb(col)
    # A little red-roofed house on the middle hill.
    hx, hy = int(w * 0.62), int(h * 0.66)
    img[hy - 22:hy, hx - 26:hx + 26] = rgb('#efe3c8')
    roof = (y < hy - 20) & (y > hy - 46) & (np.abs(x - hx) < (y - (hy - 46)) * 1.3)
    img[roof] = rgb('#b3261e')
    brush = noise(h, w, (h // 6, w // 6), 3, seed)
    img *= (0.9 + 0.18 * brush)[..., None]
    return np.clip(img, 0, 1)


def painting_hat(w=480, h=640) -> np.ndarray:
    """A vintage-poster top hat on a red sunburst."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h * 0.48
    a = np.arctan2(y - cy, x - cx)
    img = np.where((np.sin(a * 16) > 0)[..., None], rgb('#b3261e'), rgb('#c8382c'))
    border = (x < 18) | (x > w - 18) | (y < 18) | (y > h - 18)
    img[border] = rgb('#ecdcb5')
    # Hat: brim ellipse, crown, band.
    brim = ((x - cx) / 150) ** 2 + ((y - (cy + 95)) / 26) ** 2 < 1
    crown = (np.abs(x - cx) < 92 - (y - (cy - 120)) * 0.06) & (y > cy - 120) & (y < cy + 95)
    top = ((x - cx) / 86) ** 2 + ((y - (cy - 120)) / 18) ** 2 < 1
    band = crown & (y > cy + 50) & (y < cy + 80)
    hat = brim | crown | top
    img[hat] = rgb('#141414')
    img[band] = rgb('#ecdcb5')
    shine = crown & (np.abs(x - (cx - 50)) < 8) & (y < cy + 45)
    img[shine] = rgb('#3a3a3a')
    return np.clip(img, 0, 1)


def leaf_texture(size=256) -> np.ndarray:
    """Monstera-ish leaf colour with a midrib and veins (alpha via the mesh outline, not the texture)."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    img = lerp(rgb('#2f6f35'), rgb('#4f9a4a'), x)
    rib = np.abs(x - 0.5) < 0.015
    veins = (np.abs(((y - np.abs(x - 0.5) * 0.8) * 9) % 1 - 0.5) < 0.04) & ~rib
    img[rib] = rgb('#a9c97a')
    img[veins] = lerp(rgb('#4f9a4a'), rgb('#a9c97a'), 0.5)
    return img
