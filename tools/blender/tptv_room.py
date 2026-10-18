"""The Takeprofit TV edition's room: a broadcast studio and trading floor, on air.

An ink-black studio round the game table: a video wall of candlestick charts,
tickers and test-card bars behind a curved anchor desk, an amber ON AIR sign,
trading desks with stacked monitors along both side walls (and a producer's
switcher), studio cameras on tripods, softboxes on stands, acoustic panels,
amber LED strips and a stage disc ringed with colour bars under the table.
The key light over the table, the screens, the softboxes and the LEDs are
baked into one lightmap; screens and LEDs are unlit (`RoomGlow…`) and show at
full strength in the game.

    tools/blender/run.sh tptv_room.py            # full quality
    tools/blender/run.sh tptv_room.py --draft    # quick bake for iterating
    tools/blender/run.sh tptv_room.py --preview [table follow_back …]  # Cycles stills of the game views, no bake

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the floor at y = -4.6 (one unit is about 17 cm).
Every screen is drawn here (PIL + numpy) with the edition's own fonts and logo;
the symbols are futures roots, no real company or brand.
"""

import math
import os
import sys
import time

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
F = -4.6          # floor
BACK = -19.0      # back wall face
SIDE = 22.0       # side walls at ±x
FRONT = 44.0      # floor and side walls run this far toward the camera (orbiting stays inside)
NEAR = 16.0       # floor / walls beyond this z get few lightmap texels
WALL_H = 22.0
STAGE_R = 12.6    # the stage disc under the table
DESK_R = 14.4     # the anchor desk's arc (centre line)
OUT = 'models/tptv'
SCRATCH = os.environ.get('TPTV_PREVIEW_DIR', '/tmp')
FONTS = os.path.join(blib.REPO, 'client', 'src', 'fonts')
LOGO = os.path.join(blib.HERE, 'assets', 'tptv-logo.png')  # the real mark (client/public/editions/tptv/logo.svg, rasterised)

rng = np.random.default_rng(7)

# ---- palette (the edition's: ink grounds, bone type, amber, test-card bars) --
INK = '#0b0b0d'
PANEL = '#131317'
LINE = '#2e2e36'
BONE = '#f2f0ea'
AMBER = '#ff9e2c'
UP = '#21c45a'
DN = '#ff3b30'
WALL = '#24242a'
FELT = '#2c2c33'
FELT_HI = '#37373f'
BLACK = '#0e0e11'
STEEL = '#55575f'
DESK = '#1e1e24'
BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']


# ---------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------

def font(kind, size):
    from PIL import ImageFont
    f = {'big': 'big-shoulders-900.woff2', 'big8': 'big-shoulders-800.woff2',
         'mono': 'space-mono-400.woff2', 'monob': 'space-mono-700.woff2'}[kind]
    return ImageFont.truetype(os.path.join(FONTS, f), max(6, int(size)))


AW, AH = 2048, 1536
REG = {
    'wall': (0, 0, 2048, 696),     # the video wall, one picture over 5×3 panels
    'crawl': (0, 696, 2048, 64),   # the ticker crawl under it
    'onair': (0, 1192, 512, 192),
    'desklogo': (512, 1192, 512, 256),
    'clock': (1024, 1192, 1024, 128),
}
for _i in range(10):
    REG[f'mon{_i}'] = (384 * (_i % 5), 760 + 216 * (_i // 5), 384, 216)

SYMS = [('ES', 5412.25, 0.42), ('NQ', 19820.50, 0.87), ('YM', 39645.0, 0.18), ('RTY', 2071.4, -0.35),
        ('GC', 2384.6, -0.21), ('SI', 29.415, 1.12), ('CL', 78.62, -0.94), ('NG', 2.734, 2.31),
        ('ZB', 118.03, -0.08), ('6E', 1.0842, 0.05), ('MES', 5412.25, 0.42), ('MNQ', 19820.5, 0.87)]


def _fmt(p):
    return f'{p:,.2f}' if p >= 100 else f'{p:.3f}' if p >= 10 else f'{p:.4f}'


def tri(d, x, y, s, up):
    """A small up/down arrowhead."""
    if up:
        d.polygon([(x, y + s * 0.5), (x + s, y + s * 0.5), (x + s / 2, y - s * 0.4)], fill=UP)
    else:
        d.polygon([(x, y - s * 0.4), (x + s, y - s * 0.4), (x + s / 2, y + s * 0.5)], fill=DN)


def draw_candles(d, bx, seed, label, price=5412.25, step=1.5, n=46, scale=1.0, tf='5M'):
    x0, y0, x1, y1 = bx
    r = np.random.default_rng(seed)
    moves = r.normal(0.16, 1.0, n) * step
    close = price + np.cumsum(moves) - moves.sum()
    opn = np.r_[close[0] - moves[0], close[:-1]]
    hi = np.maximum(opn, close) + np.abs(r.normal(0, 0.7, n)) * step
    lo = np.minimum(opn, close) - np.abs(r.normal(0, 0.7, n)) * step
    hh, aw = 40 * scale, 92 * scale
    vh = (y1 - y0) * 0.14
    px0, px1, py0, py1 = x0 + 10 * scale, x1 - aw, y0 + hh, y1 - 8 * scale - vh
    top, bot = hi.max() + step, lo.min() - step

    def py(p):
        return py0 + (top - p) / (top - bot) * (py1 - py0)
    d.rectangle(bx, fill=INK)
    small = font('mono', 15 * scale)
    for k in range(5):
        gy = py0 + (py1 - py0) * (k + 0.5) / 5
        d.line([(px0, gy), (px1, gy)], fill='#1c1c23', width=1)
        p = top - (gy - py0) / (py1 - py0) * (top - bot)
        d.text((px1 + 10 * scale, gy), _fmt(p), font=small, fill='#85827b', anchor='lm')
    cw = (px1 - px0) / n
    for i in range(0, n, 8):
        gx = px0 + (i + 0.5) * cw
        d.line([(gx, py0), (gx, y1 - 8 * scale)], fill='#1c1c23', width=1)
    vols = np.abs(r.normal(1, 0.45, n)) + 0.2
    vols /= vols.max()
    for i in range(n):
        cx = px0 + (i + 0.5) * cw
        up = close[i] >= opn[i]
        col = UP if up else DN
        d.line([(cx, py(hi[i])), (cx, py(lo[i]))], fill=col, width=max(1, int(cw * 0.14)))
        a, b = sorted((py(opn[i]), py(close[i])))
        d.rectangle([cx - cw * 0.33, a, cx + cw * 0.33, max(b, a + 1.5)], fill=col)
        d.rectangle([cx - cw * 0.33, y1 - 8 * scale - vh * vols[i], cx + cw * 0.33, y1 - 8 * scale],
                    fill='#0f5a2a' if up else '#6a1f1a')
    ma = np.convolve(close, np.ones(9) / 9, mode='valid')
    pts = [(px0 + (i + 8 + 0.5) * cw, py(v)) for i, v in enumerate(ma)]
    d.line(pts, fill=AMBER, width=max(2, int(2.5 * scale)), joint='curve')
    last = close[-1]
    ly = py(last)
    for xx in np.arange(px0, px1, 10 * scale):
        d.line([(xx, ly), (xx + 5 * scale, ly)], fill='#6c6a64', width=1)
    tag = UP if close[-1] >= opn[-1] else DN
    d.rectangle([px1 + 3, ly - 12 * scale, x1 - 4, ly + 12 * scale], fill=tag)
    d.text((px1 + 10 * scale, ly), _fmt(last), font=font('monob', 15 * scale), fill=INK, anchor='lm')
    d.text((x0 + 12 * scale, y0 + 8 * scale), label, font=font('big8', 28 * scale), fill=BONE)
    w = d.textlength(label, font=font('big8', 28 * scale))
    d.rounded_rectangle([x0 + 22 * scale + w, y0 + 12 * scale, x0 + 66 * scale + w, y0 + 34 * scale], 4 * scale, fill='#2a2a31')
    d.text((x0 + 44 * scale + w, y0 + 23 * scale), tf, font=font('monob', 14 * scale), fill=AMBER, anchor='mm')


def draw_tickers(d, bx, scale=1.0, rows=SYMS, start=0):
    x0, y0, x1, y1 = bx
    d.rectangle(bx, fill=INK)
    hh = 30 * scale
    d.rectangle([x0, y0, x1, y0 + hh], fill='#1b1b21')
    hf, rf = font('monob', 14 * scale), font('mono', 16 * scale)
    cols = [x0 + 14 * scale, x0 + (x1 - x0) * 0.62, x1 - 14 * scale]
    d.text((cols[0], y0 + hh / 2), 'SYMBOL', font=hf, fill=AMBER, anchor='lm')
    d.text((cols[1], y0 + hh / 2), 'LAST', font=hf, fill=AMBER, anchor='rm')
    d.text((cols[2], y0 + hh / 2), 'CHG%', font=hf, fill=AMBER, anchor='rm')
    n = len(rows)
    rh = (y1 - y0 - hh) / n
    for k in range(n):
        sym, p, c = rows[(k + start) % len(rows)]
        ry = y0 + hh + k * rh
        if k % 2:
            d.rectangle([x0, ry, x1, ry + rh], fill='#111115')
        cy = ry + rh / 2
        d.text((cols[0], cy), sym, font=font('monob', 17 * scale), fill=BONE, anchor='lm')
        d.text((cols[1], cy), _fmt(p), font=rf, fill='#d8d5ce', anchor='rm')
        d.text((cols[2], cy), f'{c:+.2f}', font=rf, fill=UP if c >= 0 else DN, anchor='rm')
        tri(d, cols[2] - 78 * scale, cy, 10 * scale, c >= 0)


def draw_dom(d, bx, seed, scale=1.0, mid=5412.25):
    x0, y0, x1, y1 = bx
    r = np.random.default_rng(seed)
    d.rectangle(bx, fill=INK)
    hh = 30 * scale
    d.rectangle([x0, y0, x1, y0 + hh], fill='#1b1b21')
    hf = font('monob', 14 * scale)
    w = x1 - x0
    d.text((x0 + w * 0.17, y0 + hh / 2), 'BID', font=hf, fill=AMBER, anchor='mm')
    d.text((x0 + w * 0.5, y0 + hh / 2), 'PRICE', font=hf, fill=AMBER, anchor='mm')
    d.text((x0 + w * 0.83, y0 + hh / 2), 'ASK', font=hf, fill=AMBER, anchor='mm')
    n = 14
    rh = (y1 - y0 - hh) / n
    f = font('mono', 15 * scale)
    for k in range(n):
        ry = y0 + hh + k * rh
        price = mid + (n / 2 - k) * 0.25
        cy = ry + rh / 2
        ask = k < n / 2
        size = int(r.integers(4, 260))
        bw = (w * 0.3) * min(1.0, size / 260)
        if ask:
            d.rectangle([x0 + w * 0.68, ry + 2, x0 + w * 0.68 + bw, ry + rh - 2], fill='#5a1c18')
            d.text((x0 + w * 0.7, cy), str(size), font=f, fill='#ff8a80', anchor='lm')
        else:
            d.rectangle([x0 + w * 0.32 - bw, ry + 2, x0 + w * 0.32, ry + rh - 2], fill='#1d2a7a')
            d.text((x0 + w * 0.3, cy), str(size), font=f, fill='#9fb0ff', anchor='rm')
        last = abs(price - mid) < 0.01
        if last:
            d.rectangle([x0 + w * 0.34, ry + 1, x0 + w * 0.66, ry + rh - 1], fill=AMBER)
        d.text((x0 + w * 0.5, cy), f'{price:,.2f}', font=font('monob', 15 * scale), fill=INK if last else BONE, anchor='mm')


def draw_heatmap(d, bx, seed, cols=4, rows=3, scale=1.0):
    x0, y0, x1, y1 = bx
    r = np.random.default_rng(seed)
    d.rectangle(bx, fill=INK)
    tw, th = (x1 - x0) / cols, (y1 - y0) / rows
    k = 0
    for j in range(rows):
        for i in range(cols):
            sym, _, c = SYMS[k % len(SYMS)]
            c = c + r.normal(0, 0.4)
            t = min(1.0, abs(c) / 2.0)
            col = blib.mix_hex('#16161b', '#0f8a3c' if c >= 0 else '#b3241c', 0.35 + 0.65 * t)
            d.rectangle([x0 + i * tw + 3, y0 + j * th + 3, x0 + (i + 1) * tw - 3, y0 + (j + 1) * th - 3], fill=col)
            cx, cy = x0 + (i + 0.5) * tw, y0 + (j + 0.5) * th
            d.text((cx, cy - 10 * scale), sym, font=font('big', 40 * scale), fill=BONE, anchor='mm')
            d.text((cx, cy + 24 * scale), f'{c:+.2f}%', font=font('monob', 17 * scale), fill=BONE, anchor='mm')
            k += 1


def draw_line(d, bx, seed, label, scale=1.0, tf='1H'):
    x0, y0, x1, y1 = bx
    r = np.random.default_rng(seed)
    d.rectangle(bx, fill=INK)
    n = 90
    v = np.cumsum(r.normal(0.12, 1.0, n))
    v = (v - v.min()) / (v.max() - v.min() + 1e-6)
    hh = 44 * scale
    px0, px1, py0, py1 = x0 + 12 * scale, x1 - 12 * scale, y0 + hh, y1 - 12 * scale
    for k in range(4):
        gy = py0 + (py1 - py0) * k / 3
        d.line([(px0, gy), (px1, gy)], fill='#1c1c23', width=1)
    pts = [(px0 + (px1 - px0) * i / (n - 1), py1 - (py1 - py0) * (0.08 + 0.84 * v[i])) for i in range(n)]
    d.polygon(pts + [(px1, py1), (px0, py1)], fill='#33240f')
    d.line(pts, fill=AMBER, width=max(2, int(3 * scale)), joint='curve')
    ex, ey = pts[-1]
    d.ellipse([ex - 5 * scale, ey - 5 * scale, ex + 5 * scale, ey + 5 * scale], fill=BONE)
    d.text((x0 + 12 * scale, y0 + 8 * scale), label, font=font('big8', 28 * scale), fill=BONE)
    d.text((x1 - 12 * scale, y0 + 22 * scale), tf, font=font('monob', 15 * scale), fill=AMBER, anchor='rm')


def draw_smpte(d, bx):
    x0, y0, x1, y1 = bx
    w, h = x1 - x0, y1 - y0
    bw = w / 7
    for i, c in enumerate(BARS):
        d.rectangle([x0 + i * bw, y0, x0 + (i + 1) * bw, y0 + h * 0.67], fill=c)
    for i, c in enumerate(['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0']):
        d.rectangle([x0 + i * bw, y0 + h * 0.67, x0 + (i + 1) * bw, y0 + h * 0.75], fill=c)
    bot = [('#00214c', 1.25), ('#ffffff', 1.25), ('#32006a', 1.25), ('#131313', 1.25), ('#090909', 1 / 3),
           ('#131313', 1 / 3), ('#1d1d1d', 1 / 3), ('#131313', 1.0)]
    x = x0
    for c, k in bot:
        d.rectangle([x, y0 + h * 0.75, x + bw * k, y1], fill=c)
        x += bw * k


def draw_logo(img, d, bx, scale=1.0, sub=True):
    from PIL import Image
    x0, y0, x1, y1 = bx
    d.rectangle(bx, fill=INK)
    w, h = x1 - x0, y1 - y0
    s = int(min(w, h) * 0.56)
    logo = Image.open(LOGO).convert('RGBA').resize((s, s), Image.LANCZOS)
    img.paste(logo, (int(x0 + (w - s) / 2), int(y0 + h * 0.05)), logo)
    d.text((x0 + w / 2, y0 + h * 0.05 + s * 1.02), 'TAKEPROFIT TV', font=font('big', 52 * scale), fill=BONE, anchor='mt')
    if sub:
        d.ellipse([x0 + w / 2 - 62 * scale, y1 - h * 0.12 - 7 * scale, x0 + w / 2 - 48 * scale, y1 - h * 0.12 + 7 * scale], fill=DN)
        d.text((x0 + w / 2 + 8 * scale, y1 - h * 0.12), 'ON AIR', font=font('monob', 22 * scale), fill=AMBER, anchor='mm')


def draw_news(d, bx, scale=1.0):
    x0, y0, x1, y1 = bx
    w, h = x1 - x0, y1 - y0
    d.rectangle(bx, fill='#101014')
    # A soft studio backdrop, then the lower third.
    for k in range(12):
        d.rectangle([x0 + w * 0.55 + k * 10 * scale, y0 + 10 * scale, x0 + w * 0.55 + k * 10 * scale + 4 * scale, y0 + h * 0.55],
                    fill='#1a1a20')
    d.rounded_rectangle([x1 - 92 * scale, y0 + 12 * scale, x1 - 12 * scale, y0 + 40 * scale], 5 * scale, fill=DN)
    d.text((x1 - 52 * scale, y0 + 26 * scale), 'LIVE', font=font('monob', 16 * scale), fill=BONE, anchor='mm')
    d.rectangle([x0, y0 + h * 0.58, x0 + w * 0.5, y0 + h * 0.72], fill=AMBER)
    d.text((x0 + 12 * scale, y0 + h * 0.65), 'BREAKING NEWS', font=font('big', 26 * scale), fill=INK, anchor='lm')
    d.rectangle([x0, y0 + h * 0.72, x1, y0 + h * 0.9], fill=BONE)
    d.text((x0 + 12 * scale, y0 + h * 0.81), 'FUTURES RALLY AT THE OPENING BELL', font=font('big', 27 * scale), fill=INK, anchor='lm')
    d.rectangle([x0, y0 + h * 0.9, x1, y1], fill=INK)
    d.text((x0 + 12 * scale, y0 + h * 0.95), 'ES +0.42%   NQ +0.87%   GC -0.21%   CL -0.94%', font=font('mono', 13 * scale),
           fill='#bdbab3', anchor='lm')


def draw_crawl(d, bx):
    x0, y0, x1, y1 = bx
    h = y1 - y0
    d.rectangle(bx, fill=INK)
    d.rectangle([x0, y0, x0 + 150, y1], fill=AMBER)
    d.text((x0 + 75, y0 + h / 2), 'LIVE', font=font('big', 44), fill=INK, anchor='mm')
    x = x0 + 176
    f, fb = font('mono', 26), font('monob', 26)
    k = 0
    while x < x1:
        sym, p, c = SYMS[k % len(SYMS)]
        d.text((x, y0 + h / 2), sym, font=fb, fill=BONE, anchor='lm')
        x += d.textlength(sym, font=fb) + 14
        d.text((x, y0 + h / 2), _fmt(p), font=f, fill='#d8d5ce', anchor='lm')
        x += d.textlength(_fmt(p), font=f) + 14
        tri(d, x, y0 + h / 2, 16, c >= 0)
        x += 24
        d.text((x, y0 + h / 2), f'{c:+.2f}%', font=f, fill=UP if c >= 0 else DN, anchor='lm')
        x += d.textlength(f'{c:+.2f}%', font=f) + 30
        d.ellipse([x - 4, y0 + h / 2 - 4, x + 4, y0 + h / 2 + 4], fill=AMBER)
        x += 34
        k += 1


def draw_clocks(d, bx):
    x0, y0, x1, y1 = bx
    d.rectangle(bx, fill=INK)
    w = (x1 - x0) / 3
    for i, (city, t) in enumerate([('NEW YORK', '09:30:00'), ('LONDON', '14:30:00'), ('TOKYO', '22:30:00')]):
        cx = x0 + (i + 0.5) * w
        d.text((cx, y0 + 26), city, font=font('monob', 20), fill='#9a978f', anchor='mm')
        d.text((cx, y0 + 80), t, font=font('monob', 54), fill=AMBER, anchor='mm')
        if i:
            d.line([(x0 + i * w, y0 + 16), (x0 + i * w, y1 - 16)], fill='#2a2a31', width=2)


def draw_onair(d, bx):
    x0, y0, x1, y1 = bx
    d.rectangle(bx, fill='#ffa63c')
    d.rounded_rectangle([x0 + 14, y0 + 14, x1 - 14, y1 - 14], 18, outline='#1a1006', width=7)
    d.text(((x0 + x1) / 2, (y0 + y1) / 2 + 4), 'ON AIR', font=font('big', 128), fill='#140c04', anchor='mm')


def draw_desklogo(img, d, bx):
    from PIL import Image
    x0, y0, x1, y1 = bx
    d.rectangle(bx, fill=INK)
    s = 150
    logo = Image.open(LOGO).convert('RGBA').resize((s, s), Image.LANCZOS)
    img.paste(logo, (x0 + 18, y0 + (y1 - y0 - s) // 2), logo)
    f = font('big', 84)
    k = min(1.0, (x1 - x0 - 200) / d.textlength('TAKEPROFIT', font=f))
    d.text((x0 + 180, y0 + 116), 'TAKEPROFIT', font=font('big', 84 * k), fill=BONE, anchor='ls')
    d.text((x0 + 182, y0 + 182), 'TV  ·  ON AIR', font=font('big8', 52 * k), fill=AMBER, anchor='ls')


def tex_screens():
    """Everything shown on a screen, in one atlas (regions in REG)."""
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (AW, AH), INK)
    d = ImageDraw.Draw(img)

    def bx(key, pad=0):
        x, y, w, h = REG[key]
        return (x + pad, y + pad, x + w - 1 - pad, y + h - 1 - pad)
    # The video wall: columns 0-1 a big chart, 2 the logo over the bars, 3-4 tickers, ladder and a line chart.
    wx, wy, ww, wh = REG['wall']
    c = ww / 5
    draw_candles(d, (wx, wy, wx + 2 * c, wy + wh), 11, 'ES FUTURES', scale=1.7, n=52)
    draw_logo(img, d, (wx + 2 * c, wy, wx + 3 * c, wy + wh * 2 / 3), scale=1.1)
    draw_smpte(d, (wx + 2 * c, wy + wh * 2 / 3, wx + 3 * c, wy + wh))
    draw_tickers(d, (wx + 3 * c, wy, wx + 4 * c, wy + wh * 2 / 3), scale=1.15)
    draw_dom(d, (wx + 4 * c, wy, wx + 5 * c, wy + wh * 2 / 3), 5, scale=1.1)
    draw_line(d, (wx + 3 * c, wy + wh * 2 / 3, wx + 5 * c, wy + wh), 21, 'NQ FUTURES', scale=1.2)
    draw_crawl(d, bx('crawl'))
    draw_candles(d, bx('mon0', 2), 1, 'ES', scale=0.75, n=36)
    draw_tickers(d, bx('mon1', 2), scale=0.62, rows=SYMS[:8])
    draw_candles(d, bx('mon2', 2), 2, 'NQ', price=19820.5, step=6, scale=0.75, n=40, tf='1M')
    draw_dom(d, bx('mon3', 2), 3, scale=0.55)
    draw_smpte(d, bx('mon4', 2))
    draw_heatmap(d, bx('mon5', 2), 4, cols=4, rows=3, scale=0.5)
    draw_line(d, bx('mon6', 2), 6, 'GOLD', scale=0.75, tf='4H')
    draw_news(d, bx('mon7', 2), scale=0.8)
    draw_candles(d, bx('mon8', 2), 8, 'CL', price=78.62, step=0.08, scale=0.75, n=34, tf='15M')
    draw_logo(img, d, bx('mon9', 2), scale=0.5)
    draw_onair(d, bx('onair'))
    draw_desklogo(img, d, bx('desklogo'))
    draw_clocks(d, bx('clock'))
    return np.asarray(img, np.float32) / 255


def tex_floor(size=1024, seed=7):
    """Dark polished concrete slabs (2×2 per tile), a little cloudy."""
    n = tex.noise(size, size, (5, 5), octaves=5, seed=seed)
    fine = tex.noise(size, size, (64, 64), octaves=2, seed=seed + 1)
    img = tex.rgb('#34343b')[None, None, :] * (0.82 + 0.26 * n[..., None] + 0.08 * fine[..., None])
    y, x = np.mgrid[0:size, 0:size]
    half = size // 2
    seam = ((x % half) < 3) | ((y % half) < 3)
    img[seam] *= 0.5
    return np.clip(img, 0, 1)


def tex_stage(size=2048):
    """The round stage under the table: ink with rings, a dial of ticks, the edition's line of words and a ring of colour bars."""
    from PIL import Image, ImageDraw
    R = STAGE_R
    c = (np.arange(size) + 0.5) / size * 2 * R - R
    gz, gx = np.meshgrid(c, c, indexing='ij')
    r = np.hypot(gx, gz)
    a = np.arctan2(gx, -gz)  # 0 at the back, growing to the right as seen from the front
    n = tex.noise(size, size, (8, 8), octaves=4, seed=3)
    img = tex.rgb('#1f1f25')[None, None, :] * (0.9 + 0.18 * n[..., None])

    def ring(r0, r1, col):
        img[(r >= r0) & (r < r1)] = tex.rgb(col)
    ring(9.05, 9.12, '#3a3a44')
    ring(11.25, 11.32, '#3a3a44')
    # A dial of ticks just outside the table.
    deg = np.degrees(a) % 360
    tick = ((deg % 3) < 0.35) & (r > 9.25) & (r < 9.6)
    tick |= ((deg % 15) < 0.35) & (r > 9.25) & (r < 9.85)
    img[tick] = tex.rgb('#54545f')
    # The edition's line, round the ring, letter tops toward the centre.
    words = 'TAKEPROFIT TV  •  FUTURES  •  FUNDED ACCOUNTS  •  CODE TP  •  ON AIR  •  '
    sw, sh = 4096, 64
    f = font('big8', 50)
    one = ImageDraw.Draw(Image.new('L', (8, 8))).textlength(words, font=f)
    # The line twice round.
    tmp = Image.new('L', (int(one * 2) + 4, sh), 0)
    ImageDraw.Draw(tmp).text((0, sh / 2), words * 2, font=f, fill=255, anchor='lm')
    strip = tmp.resize((sw, sh), Image.LANCZOS)
    s = np.asarray(strip, np.float32) / 255
    r0, r1 = 10.05, 10.95
    band = (r >= r0) & (r < r1)
    u = ((a[band] / (2 * math.pi)) % 1.0) * (sw - 1)
    v = (r1 - r[band]) / (r1 - r0) * (sh - 1)  # letter tops outward: the line reads from the camera's side
    t = s[v.astype(int), u.astype(int)][:, None]
    img[band] = img[band] * (1 - t) + tex.rgb('#a9a59c')[None, :] * t
    # Colour bars round the outer band, cut into segments.
    seg = (a / (2 * math.pi) % 1.0) * 84
    idx = np.floor(seg).astype(int) % 7
    bars = np.array([tex.rgb(b) for b in BARS]) * 0.92
    band = (r >= 11.45) & (r < 12.3) & ((seg % 1.0) > 0.07)
    img[band] = bars[idx[band]]
    ring(12.3, 13.0, '#101013')
    return np.clip(img, 0, 1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def planar_uv(obj, scale_x, scale_z, origin=(0, 0)):
    """Top-down UVs: u from game x, v from game z."""
    me = obj.data
    uvl = me.uv_layers['UVMap'] if 'UVMap' in me.uv_layers else me.uv_layers.new(name='UVMap')
    mw = obj.matrix_world
    for li, loop in enumerate(me.loops):
        co = mw @ me.vertices[loop.vertex_index].co
        gx, gz = co.x, -co.y
        uvl.data[li].uv = ((gx - origin[0]) / scale_x, 1 - (gz - origin[1]) / scale_z)


def grp(name, pos, yaw, parts, pitch=0.0, parent=None):
    """Parent parts (built in local game coordinates, front = +z) to an empty at pos, turned yaw about up
    and pitched (positive tips the front down). Returns the empty; the parts stay in the scene."""
    g = blib.empty(name, pos, yaw)
    g.rotation_euler = (pitch, 0, yaw)
    for p in parts:
        p.parent = g
    if parent is not None:
        g.parent = parent
    return g


def face_yaw(frm, to):
    """The yaw that turns a part's +z front from game point frm toward game point to."""
    return math.atan2(to[0] - frm[0], to[2] - frm[2])


SCREENS = None


def screens_mat():
    global SCREENS
    if SCREENS is None:
        img = blib.image_from_array('screens', tex_screens())
        SCREENS = textured('Screens', img, emissive=1.6)
    return SCREENS


def screen(name, w, h, pos, region, rot_y=0.0, sub=(0, 0, 1, 1)):
    """A glowing w×h plane facing +z (turned rot_y) showing REG[region] (sub: fractions u0, v0, u1, v1 from its top-left)."""
    p = blib.plane(name, w, h, pos, screens_mat(), rot_y=rot_y)
    x, y, rw, rh = REG[region]
    su0, sv0, su1, sv1 = sub
    u0, u1 = (x + su0 * rw) / AW, (x + su1 * rw) / AW
    vt, vb = 1 - (y + sv0 * rh) / AH, 1 - (y + sv1 * rh) / AH
    uv = p.data.uv_layers['UVMap'].data
    for loop in uv:
        u, v = loop.uv
        loop.uv = (u0 + u * (u1 - u0), vb + v * (vt - vb))
    return p


def led(name, size, pos, color=AMBER, strength=5.0, rot_y=0.0):
    return box(name, size, pos, glow(color, strength, f'LED{color}{strength}'), rot_y=rot_y)


def frustum(name, w0, h0, w1, h1, depth, mat):
    """An open-fronted box tapering from a w0×h0 back (at z = -depth) to a w1×h1 mouth at z = 0."""
    bm = bmesh.new()
    back = [bm.verts.new(V(x * w0 / 2, y * h0 / 2, -depth)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    mouth = [bm.verts.new(V(x * w1 / 2, y * h1 / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(list(reversed(back)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((back[i], back[j], mouth[j], mouth[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = blib.new_mesh_object(name, bm, mat)
    sol = obj.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.06
    return obj


def arc_prism(name, r0, r1, a0, a1, y0, y1, mat, segs=24):
    """A curved slab: the ring r0..r1 between angles a0..a1 (0 = straight back, toward -z), from y0 to y1."""
    bm = bmesh.new()
    rows = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        s, c = math.sin(a), -math.cos(a)
        rows.append([bm.verts.new(V(r * s, y, r * c)) for r, y in ((r0, y0), (r1, y0), (r1, y1), (r0, y1))])
    for ra, rb in zip(rows, rows[1:]):
        for k in range(4):
            m = (k + 1) % 4
            bm.faces.new((ra[k], ra[m], rb[m], rb[k]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = blib.new_mesh_object(name, bm, mat)
    blib.smooth(obj, 30)
    return obj


# ---------------------------------------------------------------------------
# Shell: floor, stage disc, walls, acoustic panels, LED strips
# ---------------------------------------------------------------------------

def build_shell(objs):
    floor_mat = textured('Floor', blib.image_from_array('floor', tex_floor(1024)), rough=0.3)
    for name, z0, z1 in (('FloorNear', BACK, NEAR), ('FloorFar', NEAR, FRONT)):
        fl = blib.grid(name, 2 * SIDE, z1 - z0, 1, 1, (0, F, (z0 + z1) / 2), floor_mat)
        objs.append(fl)
    stage = textured('Stage', blib.image_from_array('stage', tex_stage(2048)), rough=0.4)
    R = STAGE_R
    st = lathe('Stage', [(R + 0.03, 0.0), (R + 0.03, 0.04), (R, 0.08), (0, 0.08)], 128, (0, F, 0), stage,
               cap_top=False, cap_bottom=False, hard_angle=60)
    objs.append(st)
    # The amber ring round the stage.
    objs.append(blib.torus('StageLED', R + 0.12, 0.07, (0, F + 0.06, 0), glow(AMBER, 6.0, 'LEDStage'), seg=128, mseg=6))

    wall = flat(WALL, 0.85)
    T = 0.4
    objs.append(box('BackWall', (2 * SIDE + 2 * T, WALL_H, T), (0, F + WALL_H / 2, BACK - T / 2), wall))
    for s in (-1, 1):
        x = s * (SIDE + T / 2)
        objs.append(box(f'SideWallNear{s}', (T, WALL_H, NEAR - BACK), (x, F + WALL_H / 2, (BACK + NEAR) / 2), wall))
        objs.append(box(f'SideWallFar{s}', (T, WALL_H, FRONT - NEAR), (x, F + WALL_H / 2, (NEAR + FRONT) / 2), wall))
    # A dark skirting with an amber wash along its foot, round the three walls.
    skirt = flat('#101013', 0.5)
    objs.append(box('SkirtBack', (2 * SIDE, 0.7, 0.3), (0, F + 0.55, BACK + 0.15), skirt))
    objs.append(led('CoveBack', (2 * SIDE, 0.08, 0.08), (0, F + 0.16, BACK + 0.28), strength=4.0))
    for s in (-1, 1):
        objs.append(box(f'Skirt{s}', (0.3, 0.7, FRONT - BACK), (s * (SIDE - 0.15), F + 0.55, (BACK + FRONT) / 2), skirt))
        objs.append(led(f'Cove{s}', (0.08, 0.08, NEAR + 6 - BACK), (s * (SIDE - 0.28), F + 0.16, (BACK + NEAR + 6) / 2), strength=4.0))
        # A line of amber at shoulder height down each side wall.
        objs.append(led(f'SideStrip{s}', (0.08, 0.1, NEAR - BACK - 2), (s * (SIDE - 0.05), F + 8.2, (BACK + NEAR) / 2 - 1), strength=5.0))

    # Acoustic panels: the back wall either side of the video wall, the side walls above the desks.
    def panel_grid(prefix, centre, yaw, xs, ys, w, h, seed):
        r = np.random.default_rng(seed)
        parts = []
        for i, x in enumerate(xs):
            for j, y in enumerate(ys):
                col = FELT_HI if r.random() < 0.35 else FELT
                if r.random() < 0.12:
                    col = '#3a2a1a'  # the odd panel in deep amber-brown felt
                parts.append(box(f'{prefix}Panel{i}_{j}', (w, h, 0.32), (x, y, 0.16), flat(col, 0.95), bevel=0.1, segments=2))
        objs.extend(parts)
        objs.append(grp(prefix, centre, yaw, parts))
    ys = [F + 3.6 + k * 3.7 for k in range(4)]
    panel_grid('AcuBackL', (0, 0, BACK), 0.0, [-20.0, -16.4], ys, 3.4, 3.4, 1)
    panel_grid('AcuBackR', (0, 0, BACK), 0.0, [16.4, 20.0], ys, 3.4, 3.4, 2)
    # Side walls (local x runs toward the back on the left wall, toward the front on the right).
    ys = [F + 9.6 + k * 3.0 for k in range(3)]
    zs = [-16.2, -12.9, 1.9, 5.2, 8.5]
    panel_grid('AcuL', (-SIDE, 0, 0), math.pi / 2, [-z for z in zs], ys, 3.1, 2.8, 3)
    panel_grid('AcuR', (SIDE, 0, 0), -math.pi / 2, zs, ys, 3.1, 2.8, 4)


# ---------------------------------------------------------------------------
# The video wall, the ON AIR sign and the wall screens
# ---------------------------------------------------------------------------

def build_video_wall(objs):
    cols, rows, pw, ph, gap = 5, 3, 4.3, 2.436, 0.07
    W, H = cols * pw, rows * ph
    y0 = F + 6.0
    z = BACK + 0.45
    objs.append(box('VideoWallFrame', (W + 0.5, H + 0.5, 0.4), (0, y0 + H / 2, BACK + 0.2), flat('#08080a', 0.4), bevel=0.06))
    for i in range(cols):
        for j in range(rows):
            cx = -W / 2 + (i + 0.5) * pw
            cy = y0 + H - (j + 0.5) * ph
            sub = ((i * pw + gap / 2) / W, (j * ph + gap / 2) / H, ((i + 1) * pw - gap / 2) / W, ((j + 1) * ph - gap / 2) / H)
            objs.append(screen(f'VideoWall{i}_{j}', pw - gap, ph - gap, (cx, cy, z), 'wall', sub=sub))
    # Ticker crawl under the wall, the ON AIR sign over it.
    objs.append(box('CrawlFrame', (W + 0.5, 0.9, 0.3), (0, y0 - 0.75, BACK + 0.15), flat('#08080a', 0.4)))
    objs.append(screen('Crawl', W, 0.68, (0, y0 - 0.75, BACK + 0.31), 'crawl'))
    sy = y0 + H + 1.9
    objs.append(box('OnAirBox', (4.6, 1.9, 0.6), (0, sy, BACK + 0.3), flat('#111114', 0.4), bevel=0.12))
    objs.append(screen('OnAir', 4.1, 1.54, (0, sy, BACK + 0.61), 'onair'))
    # Amber uprights framing the wall, and a halo line under the frame.
    for s in (-1, 1):
        objs.append(led(f'WallUpright{s}', (0.14, WALL_H - 4, 0.14), (s * (W / 2 + 1.3), F + (WALL_H - 4) / 2 + 0.8, BACK + 0.1), strength=5.0))
    # Side walls: a big screen each, the clocks (right) and a ticker (left) above.
    for s, cell, top in ((-1, 'mon5', 'crawl'), (1, 'mon6', 'clock')):
        x = s * (SIDE - 0.25)
        yaw = -s * math.pi / 2
        objs.append(box(f'SideScreenFrame{s}', (0.35, 4.0, 7.0), (x, F + 11.6, -5.6), flat('#08080a', 0.4), bevel=0.05))
        objs.append(screen(f'SideScreen{s}', 6.6, 3.6, (x - s * 0.19, F + 11.6, -5.6), cell, rot_y=yaw))
        if top == 'clock':
            objs.append(box('ClockFrame', (0.3, 1.25, 8.6), (x, F + 15.0, -5.6), flat('#08080a', 0.4)))
            objs.append(screen('Clocks', 8.3, 1.04, (x - s * 0.16, F + 15.0, -5.6), 'clock', rot_y=yaw))
        else:
            objs.append(box('TickerFrame', (0.3, 0.8, 8.6), (x, F + 14.6, -5.6), flat('#08080a', 0.4)))
            objs.append(screen('SideCrawl', 8.3, 0.6, (x - s * 0.16, F + 14.6, -5.6), 'crawl', rot_y=yaw, sub=(0, 0, 0.42, 1)))


# ---------------------------------------------------------------------------
# Furniture: anchor desk, trading desks, chairs, monitors
# ---------------------------------------------------------------------------

def monitor(name, w, h, region, y, stand=True):
    """A thin monitor facing +z, screen centre at height y (local). Returns its parts."""
    housing = flat(BLACK, 0.4)
    parts = [box(f'{name}Housing', (w + 0.14, h + 0.14, 0.14), (0, y, 0), housing, bevel=0.03),
             box(f'{name}Hump', (w * 0.45, h * 0.45, 0.16), (0, y, -0.14), housing),
             screen(f'{name}Screen', w, h, (0, y, 0.075), region)]
    if stand:
        base = y - h / 2 - 0.5
        parts.append(box(f'{name}Neck', (0.22, y - base, 0.1), (0, base + (y - base) / 2, -0.26), flat(STEEL, 0.35)))
        parts.append(box(f'{name}Foot', (1.1, 0.06, 0.75), (0, base + 0.03, -0.12), flat(STEEL, 0.35), bevel=0.02))
    return parts


def office_chair(name, colour, back_h=2.4, seat_y=2.7):
    """A swivel chair facing +z (local), standing at y = 0. Returns its parts."""
    dark = flat('#141417', 0.5)
    metal = flat('#6d6f76', 0.3)
    fab = flat(colour, 0.75)
    parts = []
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        leg = box(f'{name}Leg{k}', (0.16, 0.12, 1.25), (math.sin(a) * 0.62, 0.34, math.cos(a) * 0.62), dark, rot_y=a)
        parts.append(leg)
        parts.append(sphere(f'{name}Caster{k}', 0.14, (math.sin(a) * 1.22, 0.14, math.cos(a) * 1.22), dark, segs=8, rings=5))
    parts.append(cylinder(f'{name}Gas', 0.1, seat_y - 0.5, (0, 0.38, 0), metal, segs=10))
    parts.append(box(f'{name}Seat', (2.0, 0.4, 1.9), (0, seat_y, 0.05), fab, bevel=0.15, segments=3))
    back = box(f'{name}BackRest', (1.85, back_h, 0.32), (0, seat_y + 0.5 + back_h / 2, -0.98), fab, bevel=0.14, segments=3)
    back.rotation_euler = (-0.1, 0, 0)
    parts.append(back)
    parts.append(box(f'{name}Spine', (0.3, 1.0, 0.7), (0, seat_y + 0.2, -0.85), dark))
    for s in (-1, 1):
        parts.append(box(f'{name}ArmPost{s}', (0.12, 0.8, 0.12), (s * 0.95, seat_y + 0.5, 0.0), dark))
        parts.append(box(f'{name}ArmPad{s}', (0.26, 0.12, 1.0), (s * 0.95, seat_y + 0.92, 0.05), dark, bevel=0.04))
    return parts


def chair(objs, name, pos, yaw, colour, **kw):
    parts = office_chair(name, colour, **kw)
    objs.extend(parts)
    g = grp(name, pos, yaw, parts)
    objs.append(g)
    return g


def mug(name, pos, colour):
    m = flat(colour, 0.35)
    parts = [lathe(f'{name}Body', [(0.27, 0), (0.29, 0.04), (0.3, 0.58), (0.26, 0.58), (0.25, 0.08), (0, 0.08)], 16, pos, m, cap_top=False)]
    h = blib.torus(f'{name}Handle', 0.15, 0.04, (pos[0] + 0.32, pos[1] + 0.3, pos[2]), m, seg=12, mseg=5)
    h.rotation_euler = (math.pi / 2, 0, 0)
    parts.append(h)
    return parts


def build_anchor_desk(objs):
    a0, a1 = math.radians(-30), math.radians(30)
    r_in, r_out = DESK_R - 1.3, DESK_R + 1.3
    top_y = F + 4.3
    body = flat('#141418', 0.6)
    objs.append(arc_prism('AnchorBody', r_in + 0.15, r_out - 0.2, a0, a1, F, top_y - 0.25, body, segs=32))
    objs.append(arc_prism('AnchorTop', r_in - 0.15, r_out, a0 - 0.012, a1 + 0.012, top_y - 0.25, top_y, flat('#2b2b33', 0.3), segs=32))
    objs.append(arc_prism('AnchorTopEdge', r_in - 0.2, r_in - 0.12, a0 - 0.012, a1 + 0.012, top_y - 0.22, top_y - 0.04,
                          glow(AMBER, 6.0, 'LEDAnchor'), segs=32))
    objs.append(arc_prism('AnchorKick', r_in + 0.05, r_in + 0.12, a0, a1, F + 0.1, F + 0.22, glow(AMBER, 6.0, 'LEDAnchor'), segs=32))
    # Fluted front panels either side of the glowing logo panel.
    for k in range(-9, 10):
        if abs(k) <= 2:
            continue
        a = k * math.radians(3.0)
        x, z = math.sin(a) * (r_in + 0.1), -math.cos(a) * (r_in + 0.1)
        objs.append(box(f'AnchorFlute{k}', (0.32, 3.4, 0.16), (x, F + 2.0, z), flat('#1d1d23', 0.5), rot_y=-a, bevel=0.05))
    objs.append(box('AnchorLogoBox', (4.6, 2.5, 0.3), (0, F + 2.1, -r_in + 0.1), flat('#08080a', 0.4), bevel=0.05))
    objs.append(screen('AnchorLogo', 4.3, 2.15, (0, F + 2.1, -r_in + 0.26), 'desklogo'))
    # Two anchors' chairs, monitors facing them, mugs, papers, microphones.
    for s in (-1, 1):
        a = s * math.radians(9)
        cp = (math.sin(a) * (DESK_R + 2.6), F, -math.cos(a) * (DESK_R + 2.6))
        chair(objs, f'AnchorChair{s}', cp, face_yaw(cp, (0, 0, 0)), '#d6d0c2', back_h=3.0, seat_y=3.0)
        mp = (math.sin(a) * (DESK_R + 0.2), top_y, -math.cos(a) * (DESK_R + 0.2))
        parts = monitor(f'AnchorMon{s}', 2.0, 1.15, 'mon9' if s < 0 else 'mon0', 1.2)
        objs.extend(parts)
        # The monitors face the anchors (away from the table).
        objs.append(grp(f'AnchorMon{s}', mp, face_yaw(mp, cp) , parts))
        mic = flat('#1a1a1e', 0.4)
        bp = (math.sin(a * 0.4) * (DESK_R - 0.6), top_y, -math.cos(a * 0.4) * (DESK_R - 0.6))
        objs.append(cylinder(f'MicBase{s}', 0.3, 0.08, bp, mic, segs=14))
        objs.append(tube(f'MicStem{s}', [(bp[0], top_y + 0.05, bp[2]), (bp[0], top_y + 0.9, bp[2] - 0.15),
                                         (bp[0] - s * 0.2, top_y + 1.3, bp[2] - 0.5)], 0.04, mic))
        objs.append(sphere(f'MicHead{s}', 0.17, (bp[0] - s * 0.22, top_y + 1.38, bp[2] - 0.6), flat('#2a2a30', 0.8), scale=(1, 1.3, 1), segs=10, rings=7))
        objs.extend(mug(f'AnchorMug{s}', (math.sin(a * 1.9) * (DESK_R + 0.6), top_y, -math.cos(a * 1.9) * (DESK_R + 0.6)), AMBER if s < 0 else BONE))
        objs.append(box(f'AnchorPapers{s}', (1.0, 0.06, 1.3), (math.sin(a * 0.9) * (DESK_R + 0.9), top_y + 0.03, -math.cos(a * 0.9) * (DESK_R + 0.9)),
                        flat('#e9e6de', 0.9), rot_y=-a + 0.15 * s))


def trader_desk(objs, name, pos, yaw, cells, length=7.6, switcher=False, seed=0):
    """A trading desk against a wall, facing +z (local): three monitors and two above on a pole, a chair in front."""
    r = np.random.default_rng(seed)
    top = flat(DESK, 0.35)
    leg = flat('#131317', 0.5)
    L = length
    parts = [box(f'{name}Top', (L, 0.2, 2.8), (0, 4.2, 0), top, bevel=0.04),
             box(f'{name}Modesty', (L - 0.5, 2.4, 0.1), (0, 2.9, -1.2), leg),
             led(f'{name}Strip', (L - 0.4, 0.06, 0.06), (0, 4.04, 1.3), strength=6.0)]
    for s in (-1, 1):
        parts.append(box(f'{name}Leg{s}', (0.2, 4.1, 2.6), (s * (L / 2 - 0.2), 2.05, 0), leg))
    pole = flat(STEEL, 0.3)
    parts.append(cylinder(f'{name}Pole', 0.09, 5.0, (0, 4.3, -1.0), pole, segs=10))
    parts.append(box(f'{name}Clamp', (0.5, 0.3, 0.5), (0, 4.45, -1.0), pole))
    lower = [(-2.72, -0.6, 0.36), (0, -0.85, 0.0), (2.72, -0.6, -0.36)]
    for k, (x, z, a) in enumerate(lower):
        mp = monitor(f'{name}Mon{k}', 2.6, 1.48, f'mon{cells[k]}', 0.0, stand=False)
        parts.extend(mp)
        parts.append(grp(f'{name}MonG{k}', (x, 5.85, z), a, mp))
    if not switcher:
        for k, (x, a) in enumerate([(-1.37, 0.1), (1.37, -0.1)]):
            mp = monitor(f'{name}MonT{k}', 2.6, 1.48, f'mon{cells[3 + k]}', 0.0, stand=False)
            parts.extend(mp)
            parts.append(grp(f'{name}MonTG{k}', (x, 7.62, -0.95), a, mp))
        parts.append(box(f'{name}Bar', (3.0, 0.16, 0.16), (0, 7.62, -1.12), pole))
        parts.append(box(f'{name}Keyboard', (1.8, 0.08, 0.6), (0, 4.34, 0.45), flat('#2a2a30', 0.6), bevel=0.02))
        parts.append(box(f'{name}Mouse', (0.25, 0.1, 0.4), (1.4, 4.35, 0.5), flat('#2a2a30', 0.5), bevel=0.04))
        parts.extend(mug(f'{name}Mug', (-2.6, 4.3, 0.55), [AMBER, BONE, '#2b2b31'][seed % 3]))
        parts.append(box(f'{name}Pad', (1.1, 0.04, 1.4), (2.6, 4.32, 0.3), flat('#e9e6de', 0.9), rot_y=r.normal(0, 0.2)))
    else:
        # A vision mixer: a sloped panel of buttons (a red and a green row lit) and a T-bar.
        console = []
        console.append(box(f'{name}Console', (5.2, 0.3, 1.5), (0, 0, 0), flat('#1b1b20', 0.5), bevel=0.06))
        cols = 14
        for row in range(4):
            for c in range(cols):
                x = -2.2 + c * (4.0 / (cols - 1))
                z = -0.5 + row * 0.33
                if row == 0 and c == 3:
                    m = glow('#ff3b30', 4.0, 'BtnRed')
                elif row == 1 and c == 6:
                    m = glow('#21c45a', 4.0, 'BtnGreen')
                elif row == 3 and r.random() < 0.25:
                    m = glow(AMBER, 3.0, 'BtnAmber')
                else:
                    m = flat('#3d3d45' if row < 2 else '#55555e', 0.5)
                console.append(box(f'{name}Btn{row}_{c}', (0.2, 0.08, 0.2), (x, 0.18, z), m))
        console.append(box(f'{name}TBar', (0.12, 0.7, 0.12), (2.45, 0.45, 0.0), flat('#cfcac0', 0.4)))
        parts.extend(console)
        parts.append(grp(f'{name}ConsoleG', (0, 4.5, 0.35), 0.0, console, pitch=0.18))
    objs.extend(parts)
    g = grp(name, pos, yaw, [p for p in parts if p.parent is None])
    objs.append(g)
    # The chair, pulled out a little, turned toward the screens.
    yaw_c = yaw + math.pi + r.normal(0, 0.25)
    cx = pos[0] + math.sin(yaw) * 2.8 + math.cos(yaw) * r.normal(0, 0.6)
    cz = pos[2] + math.cos(yaw) * 2.8 - math.sin(yaw) * r.normal(0, 0.6)
    chair(objs, f'{name}Chair', (cx, F, cz), yaw_c, '#2a2a31')


def build_desks(objs):
    x = SIDE - 1.5
    trader_desk(objs, 'DeskL0', (-x, F, -10.6), math.pi / 2, [0, 1, 3, 8, 7], seed=1)
    trader_desk(objs, 'DeskL1', (-x, F, -2.9), math.pi / 2, [2, 5, 6, 0, 9], seed=2)
    trader_desk(objs, 'DeskR0', (x, F, -10.6), -math.pi / 2, [8, 3, 2, 1, 4], seed=3)
    trader_desk(objs, 'DeskR1', (x, F, -2.9), -math.pi / 2, [7, 4, 9], switcher=True, seed=4)


# ---------------------------------------------------------------------------
# Studio kit: cameras on tripods, softboxes, cables, plants
# ---------------------------------------------------------------------------

def studio_camera(objs, name, pos, target, head_h=5.0):
    yaw = face_yaw(pos, target)
    dark = flat('#26272c', 0.45)
    black = flat('#111114', 0.5)
    metal = flat('#8a8c93', 0.3)
    legs = []
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 3
        foot = (math.sin(a) * 2.1, 0.05, math.cos(a) * 2.1)
        legs.append(tube(f'{name}Leg{k}', [(0, head_h - 0.4, 0), (foot[0] * 0.5, head_h * 0.5, foot[2] * 0.5), foot], 0.09, metal, segs=8))
        legs.append(sphere(f'{name}Wheel{k}', 0.22, (foot[0], 0.22, foot[2]), black, segs=10, rings=6))
        legs.append(tube(f'{name}Spreader{k}', [(0, 1.4, 0), (foot[0] * 0.62, 1.4 * 0.95, foot[2] * 0.62)], 0.05, metal, segs=6))
    legs.append(cylinder(f'{name}Column', 0.22, head_h - 0.3, (0, 0.5, 0), black, segs=12))
    legs.append(cylinder(f'{name}PanHead', 0.42, 0.4, (0, head_h - 0.2, 0), black, segs=14))
    head = [box(f'{name}Body', (1.1, 1.3, 2.6), (0, 0.85, 0.1), dark, bevel=0.12),
            box(f'{name}Handle', (0.25, 0.25, 1.4), (0, 1.65, 0.2), black, bevel=0.05)]
    lens = cylinder(f'{name}Lens', 0.44, 1.8, (0, 0.8, 1.35), black, segs=16)
    lens.rotation_euler = (math.pi / 2, 0, 0)
    head.append(lens)
    hood = frustum(f'{name}Hood', 0.9, 0.9, 1.5, 1.2, 0.7, black)
    hood.location = V(0, 0.8, 3.75)
    head.append(hood)
    head.append(box(f'{name}Finder', (0.95, 0.75, 0.55), (0, 1.75, -1.0), black, bevel=0.06))
    head.append(screen(f'{name}FinderScreen', 0.8, 0.55, (0, 1.75, -1.28), 'mon4', rot_y=math.pi))
    head.append(box(f'{name}Tally', (0.3, 0.14, 0.14), (0, 1.62, 1.1), glow('#ff2a1f', 5.0, 'Tally')))
    for s in (-1, 1):
        head.append(tube(f'{name}PanBar{s}', [(s * 0.45, 0.2, -0.6), (s * 0.85, -0.25, -2.2), (s * 0.95, -0.45, -2.9)], 0.06, metal, segs=6))
    objs.extend(legs + head)
    g = grp(name, pos, yaw, legs)
    h = grp(f'{name}Head', (0, head_h, 0), 0.0, head, pitch=0.12, parent=g)
    objs.extend([g, h])


def softbox(objs, name, pos, target, h=8.6, w=3.4, hh=2.6, strength=2.5):
    yaw = face_yaw(pos, target)
    top = (pos[0], pos[1] + h, pos[2])
    pitch = math.atan2(top[1] - target[1], math.hypot(target[0] - pos[0], target[2] - pos[2]))
    metal = flat('#2b2c31', 0.4)
    stand = []
    for k in range(3):
        a = k * 2 * math.pi / 3
        stand.append(tube(f'{name}Leg{k}', [(0, 2.0, 0), (math.sin(a) * 1.8, 0.05, math.cos(a) * 1.8)], 0.07, metal, segs=6))
    stand.append(cylinder(f'{name}Pole', 0.1, h - 1.6, (0, 1.6, 0), metal, segs=8))
    stand.append(cylinder(f'{name}PoleTop', 0.07, 1.2, (0, h - 0.6, 0), flat('#6d6f76', 0.3), segs=8))
    head = [frustum(f'{name}Box', 0.9, 0.9, w, hh, 1.7, flat('#141416', 0.7)),
            box(f'{name}Ring', (1.0, 1.0, 0.5), (0, 0, -1.9), metal),
            box(f'{name}Diffuser', (w - 0.1, hh - 0.1, 0.04), (0, 0, -0.05), glow('#fff3e2', strength, f'Softbox{strength}'))]
    objs.extend(stand + head)
    g = grp(name, pos, yaw, stand)
    hd = grp(f'{name}Head', (0, h, 0), 0.0, head, pitch=pitch, parent=g)
    objs.extend([g, hd])


def build_kit(objs):
    studio_camera(objs, 'CamA', (-10.8, F, 13.2), (0, 0, 0))
    studio_camera(objs, 'CamB', (10.8, F, 13.2), (0, 0, 0))
    studio_camera(objs, 'CamC', (16.0, F, 5.0), (0, F + 3, -DESK_R))
    softbox(objs, 'SoftL', (-14.2, F, -8.0), (0, F + 5.5, -DESK_R), strength=2.2)
    softbox(objs, 'SoftR', (14.2, F, -8.0), (0, F + 5.5, -DESK_R), strength=2.2)
    softbox(objs, 'SoftFL', (-16.0, F, 11.5), (0, F + 3, 0), h=9.6, w=3.0, hh=3.0, strength=1.4)
    softbox(objs, 'SoftFR', (16.0, F, 11.5), (0, F + 3, 0), h=9.6, w=3.0, hh=3.0, strength=1.4)
    # Cables snaking off to the walls.
    cable = flat('#0c0c0e', 0.6)
    y = F + 0.07
    for k, pts in enumerate([
        [(-10.8, F + 1.2, 13.2), (-11.6, y, 14.4), (-14.0, y, 15.2), (-17.5, y, 14.0), (-21.6, y, 14.6)],
        [(10.8, F + 1.2, 13.2), (11.7, y, 14.6), (14.5, y, 15.6), (18.0, y, 13.6), (21.6, y, 13.9)],
        [(16.0, F + 1.2, 5.0), (17.2, y, 6.2), (19.0, y, 7.6), (21.6, y, 7.4)],
        [(-14.2, F + 0.5, -8.0), (-15.6, y, -7.0), (-18.2, y, -6.6), (-21.6, y, -6.9)],
        [(14.2, F + 0.5, -8.0), (15.5, y, -6.8), (18.0, y, -6.8), (21.6, y, -6.5)],
    ]):
        objs.append(tube(f'Cable{k}', pts, 0.06, cable, segs=6))
    # Overhead: two pipes of the lighting grid with fresnels hanging off them.
    pipe = flat('#2a2b30', 0.4)
    for k, z in enumerate((-9.0, 3.0)):
        objs.append(tube(f'GridPipe{k}', [(-SIDE, F + 20.0, z), (SIDE, F + 20.0, z)], 0.14, pipe, segs=8))
        for j, x in enumerate((-12.0, -4.0, 4.0, 12.0)):
            objs.append(box(f'Yoke{k}_{j}', (0.12, 1.2, 1.3), (x, F + 19.3, z), pipe))
            can = cylinder(f'Fresnel{k}_{j}', 0.55, 1.6, (0, 0, 0), flat('#18181b', 0.5), segs=14)
            can.rotation_euler = (math.radians(180 - 35 if k == 0 else 180 + 30), 0, 0)
            can.location = V(x, F + 19.0, z)
            objs.append(can)


def snake_plant(objs, name, pos, seed, height=6.0, pot_r=1.15, pot_h=2.8):
    r = np.random.default_rng(seed)
    x, _, z = pos
    objs.append(lathe(f'{name}Pot', [(pot_r * 0.82, 0), (pot_r, 0.15), (pot_r, pot_h), (pot_r - 0.1, pot_h), (pot_r - 0.12, pot_h - 0.3), (0, pot_h - 0.3)],
                      28, (x, F, z), flat('#16161a', 0.35), cap_top=False))
    objs.append(cylinder(f'{name}Soil', pot_r - 0.12, 0.05, (x, F + pot_h - 0.32, z), flat('#1d1610', 0.95), segs=20))
    greens = ['#2e5a2c', '#3b6d34', '#28502a', '#47783a']
    for k in range(15):
        a = r.random() * 2 * math.pi
        rad = r.random() * (pot_r - 0.35)
        h = height * (0.55 + 0.45 * r.random())
        lean = 0.08 + 0.18 * r.random()
        wdt = 0.3 + 0.12 * r.random()
        bm = bmesh.new()
        rows = []
        for i in range(7):
            t = i / 6
            w = wdt * (1 - t ** 1.6) + 0.01
            off = lean * h * t * t
            cx, cz = math.cos(a) * (rad + off), math.sin(a) * (rad + off)
            tw = a + math.pi / 2 + 0.5 * t
            dx, dz = math.cos(tw) * w, math.sin(tw) * w
            yy = pot_h - 0.3 + h * t
            rows.append([bm.verts.new(V(cx - dx, yy, cz - dz)), bm.verts.new(V(cx + dx, yy, cz + dz))])
        for ra, rb in zip(rows, rows[1:]):
            bm.faces.new((ra[0], ra[1], rb[1], rb[0]))
        leaf = blib.new_mesh_object(f'{name}Leaf{k}', bm, flat(greens[k % 4], 0.6), smooth=True)
        sol = leaf.modifiers.new('Thick', 'SOLIDIFY')
        sol.thickness = 0.04
        leaf.location = V(x, F, z)
        objs.append(leaf)


def build_plants(objs):
    snake_plant(objs, 'PlantL', (-19.6, F, -16.6), 11, height=6.5)
    snake_plant(objs, 'PlantR', (19.6, F, -16.6), 12, height=5.6, pot_r=1.0, pot_h=3.4)
    snake_plant(objs, 'PlantF', (-19.8, F, 5.2), 13, height=5.0, pot_r=0.95, pot_h=2.4)


# ---------------------------------------------------------------------------
# Lights (bake only)
# ---------------------------------------------------------------------------

def add_light(name, kind, pos, color, power, size=1.0, spot=None, blend=0.7):
    L = bpy.data.lights.new(name, kind)
    L.energy = power
    L.color = blib.hex_rgb(color)
    if kind == 'AREA':
        L.shape = 'DISK'
        L.size = size
    else:
        L.shadow_soft_size = size
    if kind == 'SPOT' and spot:
        L.spot_size = math.radians(spot)
        L.spot_blend = blend
    o = bpy.data.objects.new(name, L)
    blib.link(o)
    o.location = V(*pos)
    return o


def aim(obj, target):
    d = V(*target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return obj


def setup_lighting():
    world = bpy.data.worlds.new('Studio')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*blib.hex_rgb('#1c1d2a'), 1)
    bg.inputs['Strength'].default_value = 0.35
    bpy.context.scene.world = world
    # The key: a warm pool on the table, falling off toward the walls.
    key = add_light('Key', 'SPOT', (0, 19, 2.5), '#ffe6c8', 15000, size=3.0, spot=78, blend=0.85)
    aim(key, (0, F, 0))
    # The anchor desk's own key, and a cool wash off the video wall.
    desk = add_light('DeskKey', 'SPOT', (0, 15, -3), '#fff0dc', 3500, size=2.0, spot=40, blend=0.6)
    aim(desk, (0, F + 4.5, -DESK_R - 1))
    wash = add_light('WallWash', 'SPOT', (0, F + 9.5, BACK + 1.2), '#b9c8ff', 1800, size=6.0, spot=150, blend=1.0)
    aim(wash, (0, F, 0))
    # Soft grazing light down the side walls (desks, panels, screens).
    for s in (-1, 1):
        wash = add_light(f'SideWash{s}', 'SPOT', (s * 11, F + 19, -3), '#d4dbff', 2600, size=3.0, spot=75, blend=1.0)
        aim(wash, (s * SIDE, F + 6, -5))
    # The ON AIR sign's spill.
    sign = add_light('SignSpill', 'POINT', (0, F + 15.5, BACK + 1.6), '#ffa23c', 500, size=1.2)
    del sign


# ---------------------------------------------------------------------------
# Preview renders (no bake): what the game's cameras see
# ---------------------------------------------------------------------------

VIEWS = {
    'table': ((0, 13.65, 12.07), (0, 0, 0)),
    'follow_back': ((0, 2.6, 8.4), (0, 0.2, 4.6)),
    'follow_right': ((-8.4, 2.6, 0.8), (-4.6, 0.2, 0.4)),
    'follow_front': ((0.6, 2.6, -8.4), (0.3, 0.2, -4.6)),
    'follow_left': ((8.4, 2.6, -0.6), (4.6, 0.2, -0.3)),
    'close_back': ((0.4, 1.35, 7.6), (0.1, 0.35, 4.8)),
    'orbit': ((15, 9, 19), (0, 0, -6)),
    'low': ((0, 3.5, 16), (0, 2, -10)),
    'left_wall': ((8, 5, 6), (-22, 1, -6)),
    'right_wall': ((-8, 5, 6), (22, 1, -6)),
    'front': ((0, 4, -12), (0, 0, 20)),
}


def render_views(names, samples=24, res=(960, 540), prefix='tptv'):
    sc = bpy.context.scene
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    blib.link(cam)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = math.radians(45)
    cam.data.clip_end = 500
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


# ---------------------------------------------------------------------------

def build_all():
    objs: list = []
    build_shell(objs)
    build_video_wall(objs)
    build_anchor_desk(objs)
    build_desks(objs)
    build_kit(objs)
    build_plants(objs)
    return objs


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
    m['unlit'] = 1
    m['kind'] = 'glowflat'
    return m


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


SMALL = ('Caster', 'Leg', 'Gas', 'ArmPost', 'ArmPad', 'Spine', 'Btn', 'TBar', 'Mic', 'Mug', 'Handle', 'Papers', 'Pad',
         'Mouse', 'Keyboard', 'Neck', 'Foot', 'Hump', 'Cable', 'Wheel', 'Spreader', 'PanBar', 'PanHead', 'Column', 'Yoke',
         'Fresnel', 'GridPipe', 'Pole', 'Clamp', 'Bar', 'Ring', 'Leaf', 'Soil', 'Finder', 'Hood', 'Lens', 'Housing')


def is_small(o):
    return any(k in o.name for k in SMALL)


def lightmap_unwrap(objs, weight, margin=0.0015):
    """One shared 'Lightmap' atlas: clutter unwrapped in big islands, the rest by smart projection,
    texel density evened out, weighted (weight(obj)) and packed."""
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
    t = time.time()
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=margin)
    blib.log(f'packed lightmap islands in {time.time() - t:.0f}s')
    bpy.ops.object.mode_set(mode='OBJECT')


def smooth_lightmap(path, passes=1):
    """More of blib's edge-aware smoothing over the written lightmap (in linear light)."""
    from PIL import Image
    px = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255
    lin = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)
    lin = blib.denoise(lin, passes=passes)
    out = (blib.srgb_encode(lin) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(out, 'RGB').save(path, 'WEBP', quality=90, method=6)
    blib.log('smoothed', os.path.relpath(path, blib.REPO), f'{os.path.getsize(path) // 1024} KB')


def add_occluders():
    """The table and the board, in the bake only: they shade the stage under the key light."""
    finish = flat('#2a2a31', 0.45, name='OccluderWood')
    table_mod.build(finish, finish)
    box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#131317', 0.6, name='OccluderBoard'))


def is_occ(o):
    return o.name.startswith(('Table', 'BoardOccluder'))


def main():
    t0 = time.time()
    blib.reset()
    build_all()
    add_occluders()
    blib.realize()
    meshes = blib.mesh_objects()
    room = [o for o in meshes if not is_occ(o)]
    occ_objs = [o for o in meshes if is_occ(o)]
    blib.flatten_colors(room)
    for o in room:
        if o.name.startswith(('FloorNear', 'FloorFar')):
            planar_uv(o, 8.0, 8.0)
        elif o.name == 'Stage':
            planar_uv(o, 2 * STAGE_R, 2 * STAGE_R, origin=(-STAGE_R, -STAGE_R))
    setup_lighting()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in room)
    blib.log(f'{len(room)} objects, {tris} triangles')

    if PREVIEW:
        names = [a for a in sys.argv if a in VIEWS] or ['table', 'follow_back', 'follow_left']
        render_views(names)
        return

    lit = [o for o in room if not blib.is_unlit(o)]
    unlit = [o for o in room if blib.is_unlit(o)]
    blib.cull_hidden([o for o in lit if not o.name.startswith(('Floor', 'Stage'))], F, eps=0.05)

    def weight(o):
        n = o.name
        if n == 'Stage':
            return 3.0
        if n == 'FloorNear':
            return 1.9
        if n.startswith(('FloorFar', 'SideWallFar')):
            return 0.25
        if n.startswith(('BackWall', 'SideWallNear')):
            return 0.7
        if n.startswith(('Anchor', 'VideoWallFrame', 'OnAirBox')) and not is_small(o):
            return 1.4
        if n.startswith(('GridPipe', 'Fresnel', 'Yoke')):
            return 0.2
        if is_small(o):
            return 0.45
        return 1.0
    lightmap_unwrap(lit, weight, margin=0.0015 if not DRAFT else 0.0025)
    sc = bpy.context.scene
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 2
    size, spp = (1024, 24) if DRAFT else (2048, 128)
    lm_path = os.path.join(blib.PUBLIC, OUT, 'room-light.webp')
    scale = blib.bake_lightmap(lit, size=size, samples=spp, out_file=lm_path)
    smooth_lightmap(lm_path, passes=2 if DRAFT else 1)

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
    out.append(blib.join(tex_glow, 'RoomGlowScreens'))
    for o in occ_objs:
        bpy.data.objects.remove(o)
    flat_mesh = out[0]
    if flat_mesh and 'UVMap' in flat_mesh.data.uv_layers:
        flat_mesh.data.uv_layers.remove(flat_mesh.data.uv_layers['UVMap'])
    final = [o for o in out if o]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in final)
    blib.log('meshes:', ', '.join(f'{o.name} ({sum(len(p.vertices) - 2 for p in o.data.polygons)})' for o in final), f'= {tris} triangles')
    blib.export_glb(final, f'{OUT}/room.glb', normals=False)
    blib.record('tptvRoom', {
        'url': f'/{OUT}/room.glb',
        'lightmap': f'/{OUT}/room-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })
    blib.log(f'total {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
