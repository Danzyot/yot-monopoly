"""A looping flame animation as RGBA PNGs (numpy value noise, no Blender), for the burning
card in shot 5: each frame is a flame tongue on transparent ground, white-yellow at the
root through orange to red tips, licking upward. Loops seamlessly over N frames.

    python flames.py <out dir> [frames=24] [w=160] [h=320]
"""

import os
import sys

import numpy as np
from PIL import Image

rng = np.random.default_rng(3)
LAT = rng.random((64, 64, 64)).astype(np.float32)


def noise3(x, y, z):
    """Smooth value noise on a 64^3 periodic lattice."""
    xi, yi, zi = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(z).astype(int)
    fx, fy, fz = x - xi, y - yi, z - zi
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                out = out + w * LAT[(xi + dx) % 64, (yi + dy) % 64, (zi + dz) % 64]
    return out


def fbm(x, y, z, octaves=4):
    s, a, f = 0, 0.5, 1.0
    for _ in range(octaves):
        s = s + a * noise3(x * f, y * f, z * f)
        a *= 0.5
        f *= 2.0
    return s


def frame(k, n, w, h):
    u = (np.arange(w) + 0.5) / w
    v = 1 - (np.arange(h) + 0.5) / h                   # 0 at the root, 1 at the tip
    U, Vv = np.meshgrid(u, v)
    # Time loops: the noise scrolls up by a whole lattice period over the loop.
    t = k / n
    rise = t * 16.0
    turb = fbm(U * 3.0 + 7, Vv * 4.0 - rise, 2.0 * np.sin(2 * np.pi * t) + 3)
    sway = (fbm(Vv * 1.5 + 11, np.full_like(U, 5.0) - rise * 0.5, 1.5 * np.cos(2 * np.pi * t) + 9) - 0.47) * 0.5 * Vv
    dx = np.abs(U - 0.5 + sway)
    width = 0.36 * (1 - Vv) ** 0.75 * np.clip(Vv * 5 + 0.35, 0, 1)
    body = 1 - dx / np.maximum(width, 1e-4)
    f = np.clip(body * 1.3 + (turb - 0.47) * 1.6 - Vv * 0.35, 0, 1)
    f = f * np.clip(1 - Vv ** 2.2, 0, 1)
    heat = np.clip(f * (1.25 - Vv), 0, 1)
    # Colour ramp: deep red → orange → yellow → near white.
    stops = np.array([[0.75, 0.08, 0.02], [1.0, 0.35, 0.03], [1.0, 0.68, 0.12], [1.0, 0.93, 0.62]])
    x = heat * (len(stops) - 1)
    i = np.clip(np.floor(x).astype(int), 0, len(stops) - 2)
    fr = (x - i)[..., None]
    rgb = stops[i] * (1 - fr) + stops[i + 1] * fr
    alpha = np.clip((f - 0.06) / 0.3, 0, 1) ** 1.2
    root = np.clip(Vv / 0.18, 0, 1)
    alpha = alpha * root * root * (3 - 2 * root)        # the root fades out: no hard edge where the sprite starts
    img = np.dstack([rgb, alpha])
    return Image.fromarray((img * 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    out = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    w = int(sys.argv[3]) if len(sys.argv) > 3 else 160
    h = int(sys.argv[4]) if len(sys.argv) > 4 else 320
    os.makedirs(out, exist_ok=True)
    for k in range(n):
        frame(k, n, w, h).save(os.path.join(out, f'flame-{k:02d}.png'))
    print('flames', n, out)
