"""The Classic edition's room: a cosy study at night.

Green damask walls over panelled wainscoting, a moonlit window with heavy red
drapes, a fireplace, a bookshelf, a Chesterfield armchair, a floor lamp, a
sideboard with a radio, a big plant and a round rug under the table. Lit by
the fire, the lamp, the moon and a warm pool of light over the table, all
baked into one lightmap.

    tools/blender/run.sh classic_room.py            # full quality
    tools/blender/run.sh classic_room.py --draft    # quick bake for iterating

Positions are in game units (see blib.V): the board is 11 wide at y = 0, the
table top sits at y = -0.28 and the floor at y = -4.6.
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
from blib import V, box, cylinder, flat, glow, lathe, place, sphere, textured, tube  # noqa: E402

DRAFT = '--draft' in sys.argv
F = -4.6          # floor
BACK = -17.0      # back wall face
SIDE = 20.0       # side walls at ±x
FRONT = 44.0      # floor and side walls run this far toward the camera (orbiting stays inside)
WALL_H = 16.0
WAINSCOT = 4.4

rng = np.random.default_rng(42)

# ---- palette ---------------------------------------------------------------
WOOD_DARK = '#4b2f1d'
WOOD = '#6b4428'
WOOD_LIGHT = '#8a5a35'
BRASS = '#c9a04f'
LEATHER = '#5e1c17'
LEATHER_HI = '#6e231c'
DRAPE = '#7a1c19'
STONE = '#cbbfa8'
STONE_DARK = '#3a332d'
CREAM = '#ecdcb5'


def planar_uv(obj, scale_x, scale_z, origin=(0, 0)):
    """Top-down UVs: u from game x, v from game z (for the rug and floor)."""
    me = obj.data
    uvl = me.uv_layers['UVMap'] if 'UVMap' in me.uv_layers else me.uv_layers.new(name='UVMap')
    mw = obj.matrix_world
    for li, loop in enumerate(me.loops):
        co = mw @ me.vertices[loop.vertex_index].co
        gx, gz = co.x, -co.y
        uvl.data[li].uv = ((gx - origin[0]) / scale_x, 1 - (gz - origin[1]) / scale_z)


def rect_uv(obj, axis_u, axis_v, u0, u1, v0, v1):
    """Map a world-space rectangle (game axes 'x'|'y'|'z') onto 0..1 UVs (for pictures and windows)."""
    me = obj.data
    uvl = me.uv_layers['UVMap'] if 'UVMap' in me.uv_layers else me.uv_layers.new(name='UVMap')
    mw = obj.matrix_world
    def game(co):
        return {'x': co.x, 'y': co.z, 'z': -co.y}
    for li, loop in enumerate(me.loops):
        g = game(mw @ me.vertices[loop.vertex_index].co)
        uvl.data[li].uv = ((g[axis_u] - u0) / (u1 - u0), (g[axis_v] - v0) / (v1 - v0))


# ---------------------------------------------------------------------------
# Shell: floor, walls, wainscoting, window opening
# ---------------------------------------------------------------------------

def build_shell(objs):
    floor_img = blib.image_from_array('planks', tex.planks(1024))
    floor_mat = textured('Floor', floor_img, rough=0.5)
    fl = blib.grid('Floor', 2 * SIDE, FRONT - BACK, 1, 1, (0, F, (BACK + FRONT) / 2), floor_mat, uv_scale=8)
    objs.append(fl)

    wall_img = blib.image_from_array('wallpaper', tex.wallpaper(512))
    wall_mat = textured('Wallpaper', wall_img, rough=0.9)
    T = 0.4
    top = F + WALL_H
    # Back wall in four pieces around the window opening (x 0..10, y -0.4..7.8).
    wx0, wx1, wy0, wy1 = -0.2, 10.2, F + 4.6, F + 12.6
    pieces = [
        ((-SIDE, BACK - T, F), (wx0, BACK, top)),
        ((wx1, BACK - T, F), (SIDE, BACK, top)),
        ((wx0, BACK - T, F), (wx1, BACK, wy0)),
        ((wx0, BACK - T, wy1), (wx1, BACK, top)),
    ]
    for i, ((x0, z0, y0), (x1, z1, y1)) in enumerate(pieces):
        objs.append(box(f'BackWall{i}', (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), wall_mat))
    for s in (-1, 1):
        x = s * (SIDE + T / 2)
        objs.append(box(f'SideWall{s}', (T, WALL_H, FRONT - BACK + T), (x, F + WALL_H / 2, (BACK + FRONT) / 2 - T / 2), wall_mat))

    # Wainscoting: a panelled dado with a chair rail and skirting, on all three walls.
    panel = flat(WOOD, 0.6)
    frame = flat(WOOD_DARK, 0.6)
    for name, length, centre, rot_y, gaps in [
        ('DadoBack', 2 * SIDE, (0, F, BACK), 0.0, ()),
        ('DadoL', FRONT - BACK, (-SIDE, F, (BACK + FRONT) / 2), math.pi / 2, ((-0.2, 9.2),)),  # gap for the fireplace (local x = 4.5 - z)
        ('DadoR', FRONT - BACK, (SIDE, F, (BACK + FRONT) / 2), -math.pi / 2, ()),
    ]:
        g = blib.empty(name, centre, rot_y)
        for p in _dado_parts(name, length, panel, frame, gaps):
            p.parent = g
            objs.append(p)
        objs.append(g)
    # Crown moulding (catches a little light at the top of the walls).
    for name, size, pos in [
        ('CrownBack', (2 * SIDE, 0.5, 0.5), (0, top - 0.25, BACK + 0.25)),
        ('CrownL', (0.5, 0.5, FRONT - BACK), (-SIDE + 0.25, top - 0.25, (BACK + FRONT) / 2)),
        ('CrownR', (0.5, 0.5, FRONT - BACK), (SIDE - 0.25, top - 0.25, (BACK + FRONT) / 2)),
    ]:
        objs.append(box(name, size, pos, frame, bevel=0.12))


def _dado_parts(name, length, panel, frame, gaps):
    parts = [
        box(f'{name}Board', (length, WAINSCOT, 0.18), (0, WAINSCOT / 2, 0.09), frame),
        box(f'{name}Rail', (length, 0.3, 0.34), (0, WAINSCOT, 0.17), frame, bevel=0.07),
        box(f'{name}Skirt', (length, 0.75, 0.3), (0, 0.375, 0.15), frame, bevel=0.05),
    ]
    n = max(1, round(length / 3.4))
    pw = length / n
    for k in range(n):
        cx = -length / 2 + pw * (k + 0.5)
        if any(a <= cx <= b for a, b in gaps):
            continue
        ph = WAINSCOT - 2.0
        parts.append(box(f'{name}Panel{k}', (pw - 0.8, ph, 0.14), (cx, 0.9 + ph / 2 + 0.2, 0.25), panel, bevel=0.08))
    return parts


# ---------------------------------------------------------------------------
# Window with drapes
# ---------------------------------------------------------------------------

def curtain(name, x_centre, width, y_top, y_bottom, z, gather_to, mat, seed):
    """A heavy drape: sine folds, gathered toward `gather_to` (x) at a tie-back 60% down."""
    nx, ny = 44, 22
    bm = bmesh.new()
    vs = []
    r = np.random.default_rng(seed)
    phase = r.random() * 6
    for j in range(ny + 1):
        v = j / ny
        y = y_top + (y_bottom - y_top) * v
        # Width pinches in at the tie-back, then flares to the floor.
        tie = 0.6
        pinch = 1 - 0.38 * math.exp(-((v - tie) / 0.16) ** 2)
        row = []
        for i in range(nx + 1):
            u = i / nx
            off = (u - 0.5) * width * pinch
            x = gather_to + (x_centre + off - gather_to) * (0.55 + 0.45 * pinch)
            depth = (0.16 + 0.1 * v) * math.sin(u * math.pi * 11 + phase) * (0.7 + 0.3 * pinch)
            row.append(bm.verts.new(V(x, y, z + 0.35 + depth)))
        vs.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((vs[j][i], vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = blib.new_mesh_object(name, bm, mat, smooth=True)
    # Face the room (+z).
    me = obj.data
    if sum(p.normal.y for p in me.polygons) > 0:
        for p in me.polygons:
            p.flip()
    sol = obj.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.08
    return obj


def build_window(objs):
    trim = flat(WOOD_DARK, 0.5)
    x0, x1, y0, y1 = -0.2, 10.2, F + 4.6, F + 12.6
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = x1 - x0, y1 - y0
    # The view outside: emissive so the moon lights the bake; unlit in game.
    view_img = blib.image_from_array('night', tex.night_window(1024, 820))
    view = textured('NightView', view_img, emissive=0.8)
    vp = blib.plane('WindowView', w + 1, h + 1, (cx, cy, BACK - 1.2), view)
    objs.append(vp)
    # Deep reveal + frame + mullions + sill.
    for name, size, pos in [
        ('RevealT', (w, 0.2, 1.2), (cx, y1 - 0.1, BACK - 0.6)),
        ('RevealB', (w, 0.2, 1.2), (cx, y0 + 0.1, BACK - 0.6)),
        ('RevealL', (0.2, h, 1.2), (x0 + 0.1, cy, BACK - 0.6)),
        ('RevealR', (0.2, h, 1.2), (x1 - 0.1, cy, BACK - 0.6)),
    ]:
        objs.append(box(f'Window{name}', size, pos, flat('#e9e2d2', 0.6)))
    sash = flat('#efe9dc', 0.5)
    for k in (1, 2):
        objs.append(box(f'WindowMullionV{k}', (0.22, h, 0.22), (x0 + w * k / 3, cy, BACK - 0.7), sash, bevel=0.04))
    objs.append(box('WindowTransom', (w, 0.26, 0.22), (cx, y0 + h * 0.62, BACK - 0.7), sash, bevel=0.04))
    for name, size, pos in [
        ('FrameT', (w + 1.2, 0.6, 0.3), (cx, y1 + 0.3, BACK + 0.15)),
        ('FrameL', (0.6, h + 0.6, 0.3), (x0 - 0.3, cy + 0.3, BACK + 0.15)),
        ('FrameR', (0.6, h + 0.6, 0.3), (x1 + 0.3, cy + 0.3, BACK + 0.15)),
    ]:
        objs.append(box(f'Window{name}', size, pos, trim, bevel=0.08))
    objs.append(box('WindowSill', (w + 1.8, 0.35, 1.2), (cx, y0 - 0.17, BACK + 0.4), trim, bevel=0.1))
    # Curtain rod with finials, and two drapes tied back.
    rod_y = y1 + 1.2
    brass = flat(BRASS, 0.35)
    objs.append(tube('CurtainRod', [(x0 - 3.4, rod_y, BACK + 0.6), (x1 + 3.4, rod_y, BACK + 0.6)], 0.11, brass))
    for s, x in ((-1, x0 - 3.6), (1, x1 + 3.6)):
        objs.append(sphere(f'RodFinial{s}', 0.28, (x, rod_y, BACK + 0.6), brass))
        objs.append(box(f'RodBracket{s}', (0.15, 0.15, 0.6), (x - s * 0.4, rod_y, BACK + 0.3), brass))
    drape = flat(DRAPE, 0.95)
    objs.append(curtain('DrapeL', x0 - 1.6, 4.6, rod_y - 0.1, F + 0.15, BACK, x0 - 3.0, drape, 1))
    objs.append(curtain('DrapeR', x1 + 1.6, 4.6, rod_y - 0.1, F + 0.15, BACK, x1 + 3.0, drape, 2))
    # Pelmet-style valance in the same red.
    objs.append(box('Valance', (w + 7.4, 0.9, 0.5), (cx, rod_y + 0.2, BACK + 0.9), drape, bevel=0.15))
    return vp


# ---------------------------------------------------------------------------
# Fireplace (left wall)
# ---------------------------------------------------------------------------

def build_fireplace(objs):
    zc = 0.0
    x = -SIDE
    stone = flat(STONE, 0.8)
    dark = flat(STONE_DARK, 0.9)
    # Surround: two pillars, a lintel, a mantel shelf, a hearth.
    objs.append(box('FirePillarA', (1.3, 4.4, 1.3), (x + 0.65, F + 2.2, zc - 3.3), stone, bevel=0.08))
    objs.append(box('FirePillarB', (1.3, 4.4, 1.3), (x + 0.65, F + 2.2, zc + 3.3), stone, bevel=0.08))
    objs.append(box('FireLintel', (1.3, 1.1, 5.4), (x + 0.65, F + 3.85, zc), stone, bevel=0.08))
    objs.append(box('Mantel', (1.9, 0.38, 8.6), (x + 0.95, F + 4.6, zc), flat(WOOD_DARK, 0.5), bevel=0.1))
    objs.append(box('MantelCorbel', (1.5, 0.3, 8.0), (x + 0.75, F + 4.3, zc), flat(WOOD_DARK, 0.5), bevel=0.08))
    objs.append(box('Hearth', (2.6, 0.22, 8.6), (x + 1.3, F + 0.11, zc), dark, bevel=0.05))
    objs.append(box('FireBack', (0.4, 3.3, 5.4), (x + 0.2, F + 1.65, zc), flat('#1d1714', 0.95)))
    objs.append(box('FireFloor', (1.2, 0.1, 5.4), (x + 0.6, F + 0.27, zc), flat('#120d0b', 0.95)))
    # Logs, embers and flames (the flames are light sources).
    log_mat = flat('#4a2c19', 0.9)
    for i, (dz, dy, rot) in enumerate([(-0.8, 0.55, 0.2), (0.7, 0.55, -0.25), (0.0, 0.95, 0.05)]):
        lg = cylinder(f'Log{i}', 0.28, 2.4, (0, 0, 0), log_mat, segs=12)
        lg.rotation_euler = (math.pi / 2, 0, rot)
        lg.location = V(x + 0.9, F + dy, zc + dz)
        objs.append(lg)
    ember = glow('#ff6a1a', 1.5, 'Embers')
    objs.append(box('Embers', (0.9, 0.12, 3.2), (x + 0.75, F + 0.35, zc), ember))
    flame = glow('#ffad3b', 1.5, 'Flame')
    for i, (dz, hgt) in enumerate([(-0.6, 1.2), (0.1, 1.6), (0.7, 1.0), (-0.1, 0.9)]):
        f = sphere(f'Flame{i}', 0.35, (x + 0.85, F + 1.0 + hgt * 0.45, zc + dz), flame, scale=(0.7, hgt / 0.7, 0.9), segs=12, rings=8)
        objs.append(f)
    # On the mantel: a clock and two candlesticks.
    brass = flat(BRASS, 0.35)
    objs.append(box('ClockBody', (0.9, 1.3, 1.6), (x + 0.95, F + 5.45, zc), flat(WOOD, 0.4), bevel=0.15))
    face = cylinder('ClockFace', 0.5, 0.06, (0, 0, 0), flat('#f3ead6', 0.4), segs=24)
    face.rotation_euler = (0, math.pi / 2, 0)
    face.location = V(x + 1.42, F + 5.5, zc)
    objs.append(face)
    for s in (-1, 1):
        objs.append(lathe(f'Candlestick{s}', [(0.32, 0), (0.3, 0.08), (0.08, 0.2), (0.07, 0.9), (0.18, 1.0), (0.12, 1.08), (0, 1.08)],
                          16, (x + 0.95, F + 4.79, zc + s * 3.4), brass, cap_bottom=True))
        objs.append(cylinder(f'Candle{s}', 0.09, 0.7, (x + 0.95, F + 5.87, zc + s * 3.4), flat('#f6efdc', 0.6), segs=10))
        objs.append(sphere(f'CandleFlame{s}', 0.07, (x + 0.95, F + 6.65, zc + s * 3.4), glow('#ffcf7a', 1.5, 'CandleFlame'), scale=(1, 1.8, 1), segs=8, rings=6))
    # The hat poster above the mantel.
    hat_img = blib.image_from_array('hat', tex.painting_hat(480, 640))
    pic = textured('PosterHat', hat_img, rough=0.6)
    p = blib.plane('PosterHat', 3.6, 4.8, (x + 0.2, F + 9.2, zc), pic, rot_y=math.pi / 2)
    objs.append(p)
    objs.append(picture_frame('PosterFrame', 3.6, 4.8, (x + 0.12, F + 9.2, zc), math.pi / 2, flat(WOOD_DARK, 0.4)))


def picture_frame(name, w, h, pos, rot_y, mat, t=0.32, depth=0.22):
    """A bevelled moulding round a w×h picture, facing +z in local space."""
    g = blib.empty(name, pos, rot_y)
    parts = [
        box(f'{name}T', (w + 2 * t, t, depth), (0, h / 2 + t / 2, depth / 2), mat, bevel=0.06),
        box(f'{name}B', (w + 2 * t, t, depth), (0, -h / 2 - t / 2, depth / 2), mat, bevel=0.06),
        box(f'{name}L', (t, h, depth), (-w / 2 - t / 2, 0, depth / 2), mat, bevel=0.06),
        box(f'{name}R', (t, h, depth), (w / 2 + t / 2, 0, depth / 2), mat, bevel=0.06),
    ]
    for p in parts:
        p.parent = g
    return g


# ---------------------------------------------------------------------------
# Furniture
# ---------------------------------------------------------------------------

def build_bookshelf(objs):
    cx, cz = -10.0, BACK + 0.85
    case = flat(WOOD_DARK, 0.5)
    W, H, D = 6.4, 11.2, 1.6
    objs.append(box('ShelfBack', (W, H, 0.15), (cx, F + H / 2, BACK + 0.1), flat('#3a2416', 0.7)))
    for s in (-1, 1):
        objs.append(box(f'ShelfSide{s}', (0.32, H, D), (cx + s * (W / 2 - 0.16), F + H / 2, cz), case, bevel=0.05))
    objs.append(box('ShelfCrown', (W + 0.6, 0.45, D + 0.3), (cx, F + H + 0.2, cz + 0.1), case, bevel=0.12))
    objs.append(box('ShelfPlinth', (W + 0.2, 0.6, D + 0.1), (cx, F + 0.3, cz + 0.05), case, bevel=0.06))
    levels = [F + 0.6, F + 3.2, F + 5.8, F + 8.4, F + 11.0]
    for k, y in enumerate(levels):
        objs.append(box(f'Shelf{k}', (W - 0.5, 0.2, D - 0.1), (cx, y, cz), case, bevel=0.03))
    colors = ['#6e2a2c', '#2f4a68', '#3a5e42', '#a07d36', '#4f3a62', '#8e5428', '#d8cfb6', '#1f2a3a', '#7a3a2c', '#4a4a3a']
    n = 0
    for k, y in enumerate(levels[:-1]):
        x = cx - W / 2 + 0.45
        end = cx + W / 2 - 0.45
        while x < end - 0.25:
            roll = rng.random()
            if roll > 0.92 and k != 1:
                x += 0.5
                continue
            if roll > 0.86:
                # A short horizontal stack.
                for j in range(3):
                    bw = 1.2 - j * 0.1
                    objs.append(box(f'Book{n}', (bw, 0.22, 1.1), (x + 0.65, y + 0.1 + 0.11 + j * 0.23, cz), flat(colors[int(rng.random() * len(colors))], 0.7), bevel=0.02))
                    n += 1
                x += 1.45
                continue
            bw = 0.2 + rng.random() * 0.22
            bh = 1.5 + rng.random() * 0.75
            bd = 1.0 + rng.random() * 0.25
            col = colors[int(rng.random() * len(colors))]
            b = box(f'Book{n}', (bw, bh, bd), (0, 0, 0), flat(col, 0.7), bevel=0.02, origin='bottom')
            lean = 0.0
            if roll < 0.06 and x > cx - W / 2 + 0.6:
                lean = -0.25
            b.location = V(x + bw / 2, y + 0.1, cz)
            b.rotation_euler = (0, lean, 0)  # leaning sideways (about the game z axis)
            objs.append(b)
            # A gold band near the top of some spines.
            if rng.random() > 0.5:
                objs.append(box(f'BookBand{n}', (bw + 0.01, 0.08, 0.02), (x + bw / 2, y + 0.1 + bh * 0.82, cz + bd / 2), flat(BRASS, 0.4)))
            n += 1
            x += bw + 0.02 + (0.35 if lean else 0)
    # A globe on the second shelf.
    objs.append(lathe('GlobeStand', [(0.45, 0), (0.4, 0.08), (0.08, 0.2), (0.07, 0.55), (0, 0.55)], 16, (cx + 2.2, levels[1] + 0.1, cz), flat(BRASS, 0.35)))
    objs.append(sphere('Globe', 0.6, (cx + 2.2, levels[1] + 1.2, cz), flat('#3f6f8f', 0.5), segs=24, rings=14))
    objs.append(blib.torus('GlobeRing', 0.68, 0.03, (cx + 2.2, levels[1] + 1.2, cz), flat(BRASS, 0.35), seg=32, mseg=6))
    g = objs[-1]
    g.rotation_euler = (math.pi / 2, 0.4, 0)
    # A trophy and a vase on top.
    objs.append(lathe('Trophy', [(0.35, 0), (0.3, 0.15), (0.1, 0.25), (0.08, 0.6), (0.45, 0.9), (0.5, 1.35), (0.42, 1.35), (0.0, 0.95)],
                      20, (cx - 1.8, F + H + 0.42, cz), flat(BRASS, 0.3), cap_top=False))
    objs.append(lathe('Vase', [(0.3, 0), (0.55, 0.4), (0.6, 0.9), (0.3, 1.5), (0.28, 1.8), (0.38, 1.95), (0.0, 1.9)],
                      20, (cx + 1.6, F + H + 0.42, cz), flat('#2c5d7c', 0.3), cap_top=False))


def build_armchair(objs):
    """A Chesterfield wingback, angled toward the table."""
    pos = (-14.2, F, -4.0)
    rot = math.atan2(-pos[0], -pos[2])  # face the table
    g = blib.empty('Armchair', pos, rot)
    leather = flat(LEATHER, 0.55)
    leather_hi = flat(LEATHER_HI, 0.5)
    parts = []
    # Turned feet.
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(lathe(f'ChairFoot{sx}{sz}', [(0.22, 0), (0.28, 0.15), (0.18, 0.45), (0.25, 0.55), (0, 0.55)], 12,
                               (sx * 1.75, 0, sz * 1.55), flat(WOOD_DARK, 0.5)))
    base = box('ChairBase', (4.2, 1.5, 3.8), (0, 1.3, 0), leather, bevel=0.25, segments=4)
    parts.append(base)
    seat = box('ChairSeat', (3.0, 0.75, 3.0), (0, 2.35, 0.25), leather_hi, bevel=0.32, segments=5)
    parts.append(seat)
    back = box('ChairBack', (4.2, 4.0, 0.95), (0, 3.4, -1.45), leather, bevel=0.35, segments=5)
    parts.append(back)
    # Rolled arms: a block topped with a fat roll running front to back.
    for s in (-1, 1):
        parts.append(box(f'ChairArm{s}', (0.75, 1.5, 3.4), (s * 1.75, 2.6, 0.1), leather, bevel=0.25, segments=4))
        roll = cylinder(f'ChairRoll{s}', 0.52, 3.6, (0, 0, 0), leather_hi, segs=20)
        roll.rotation_euler = (math.pi / 2, 0, 0)
        roll.location = V(s * 1.85, 3.35, 0.1 + 1.8)
        parts.append(roll)
        # Wings either side of the back.
        parts.append(box(f'ChairWing{s}', (0.55, 2.6, 1.6), (s * 1.85, 4.35, -0.95), leather, bevel=0.22, segments=4))
    # Tufting: a grid of buttons on the backrest.
    btn = flat('#4a1512', 0.4)
    for row in range(3):
        for col in range(5 - (row % 2)):
            bx = -1.4 + col * 0.7 + (0.35 if row % 2 else 0)
            parts.append(sphere(f'ChairButton{row}{col}', 0.07, (bx, 3.1 + row * 0.75, -0.97), btn, segs=8, rings=6))
    for p in parts:
        p.parent = g
        objs.append(p)
    objs.append(g)
    for p in (base, seat, back):
        blib.add_subsurf(p, 1)


def build_side_table(objs):
    pos = (-14.6, F, -10.2)
    wood = flat(WOOD, 0.45)
    objs.append(cylinder('SideTop', 1.5, 0.22, (pos[0], F + 2.5, pos[2]), wood, segs=32, bevel=0.06))
    objs.append(lathe('SideStem', [(0.9, 0), (0.85, 0.12), (0.25, 0.3), (0.18, 1.2), (0.3, 1.8), (0.2, 2.2), (0.45, 2.5), (0, 2.5)],
                      20, (pos[0], F, pos[2]), wood))
    # A mug of tea and a closed book.
    mug = flat('#b3261e', 0.35)
    objs.append(lathe('Mug', [(0.3, 0), (0.33, 0.05), (0.34, 0.65), (0.3, 0.65), (0.28, 0.1), (0, 0.1)], 20,
                      (pos[0] + 0.5, F + 2.72, pos[2] + 0.2), mug, cap_top=False))
    h = blib.torus('MugHandle', 0.17, 0.045, (pos[0] + 0.86, F + 3.05, pos[2] + 0.2), mug, seg=16, mseg=6)
    h.rotation_euler = (math.pi / 2, 0, 0)
    objs.append(h)
    objs.append(box('SideBook', (1.1, 0.25, 0.8), (pos[0] - 0.4, F + 2.74, pos[2] - 0.2), flat('#2d4f7a', 0.7), rot_y=0.4, bevel=0.03))


def build_floor_lamp(objs):
    x, z = 13.6, -10.5
    brass = flat(BRASS, 0.35)
    objs.append(lathe('LampBase', [(1.1, 0), (1.12, 0.1), (0.9, 0.22), (0.3, 0.35), (0.12, 0.6), (0, 0.6)], 32, (x, F, z), flat('#2a2622', 0.4)))
    objs.append(cylinder('LampPole', 0.09, 8.6, (x, F + 0.5, z), brass, segs=12))
    objs.append(lathe('LampCollar', [(0.2, 0), (0.22, 0.2), (0.12, 0.35), (0, 0.35)], 12, (x, F + 8.9, z), brass))
    # Pleated shade: outside cream, glowing from inside.
    shade = glow('#ffd59a', 1.0, 'LampShade')
    sh = lathe('LampShade', [(1.9, 0), (1.15, 1.9)], 40, (x, F + 8.6, z), shade, cap_top=False, cap_bottom=False, smooth_shade=True)
    sol = sh.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.06
    objs.append(sh)
    objs.append(blib.torus('LampTrimB', 1.9, 0.05, (x, F + 8.6, z), brass, seg=40, mseg=6))
    objs.append(blib.torus('LampTrimT', 1.15, 0.05, (x, F + 10.5, z), brass, seg=40, mseg=6))
    return (x, F + 9.4, z)


def leaf(name, length, width, mat, droop=0.35):
    """A broad leaf on its own midrib, lying along local +y (game), tip drooping."""
    bm = bmesh.new()
    n = 10
    rows = []
    for i in range(n + 1):
        t = i / n
        w = width * (math.sin(math.pi * min(1, t * 1.05)) ** 0.7) * (1 - 0.15 * t)
        y = t * length
        z = -droop * length * t * t
        ridge = 0.06 * width * math.sin(math.pi * t)
        rows.append([bm.verts.new((-w, y, z - ridge)), bm.verts.new((0, y, z)), bm.verts.new((w, y, z - ridge))])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
        bm.faces.new((a[1], a[2], b[2], b[1]))
    obj = blib.new_mesh_object(name, bm, mat, smooth=True)
    sol = obj.modifiers.new('Thick', 'SOLIDIFY')
    sol.thickness = 0.03
    return obj


def build_plant(objs):
    x, z = 16.4, -14.0
    pot = flat('#b5653a', 0.8)
    objs.append(lathe('Pot', [(0.9, 0), (1.0, 0.1), (1.35, 2.2), (1.55, 2.25), (1.6, 2.6), (1.45, 2.65), (1.3, 2.4), (0, 2.3)],
                      28, (x, F, z), pot, cap_top=False))
    objs.append(cylinder('Soil', 1.32, 0.05, (x, F + 2.3, z), flat('#2a1d14', 0.95), segs=24))
    greens = ['#2f6f35', '#3d8441', '#4b9a4a', '#2a5f30']
    for k in range(13):
        a = k * 2.4
        tilt = 0.35 + 0.5 * rng.random()
        length = 2.2 + rng.random() * 1.2
        stem_h = 2.5 + rng.random() * 3.2
        base = (x + math.cos(a) * 0.25, F + 2.3, z + math.sin(a) * 0.25)
        tip = (x + math.cos(a) * (0.6 + tilt * 1.6), F + 2.3 + stem_h, z + math.sin(a) * (0.6 + tilt * 1.6))
        objs.append(tube(f'Stem{k}', [base, ((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2 + 0.3, (base[2] + tip[2]) / 2), tip], 0.05, flat('#5d8a3a', 0.7)))
        lf = leaf(f'Leaf{k}', length, 1.05 + rng.random() * 0.45, flat(greens[k % 4], 0.6), droop=0.25 + rng.random() * 0.2)
        # Point the leaf outward from the stem tip and tip it up/down a little.
        lf.location = V(*tip)
        # Local +y (the leaf's length) -> outward along angle a, raised 35-55 degrees.
        lf.rotation_euler = (0.95 - tilt * 0.5, 0, math.atan2(-math.cos(a), -math.sin(a)))
        objs.append(lf)


def build_sideboard(objs):
    """Right wall: a low sideboard with a radio, a stack of board games and a framed landscape above."""
    x = SIDE - 1.3
    z0, z1 = -5.0, 3.0
    zc = (z0 + z1) / 2
    wood = flat(WOOD, 0.45)
    dark = flat(WOOD_DARK, 0.5)
    brass = flat(BRASS, 0.35)
    objs.append(box('SideboardBody', (2.4, 3.3, z1 - z0), (x, F + 0.6 + 1.65, zc), wood, bevel=0.06))
    objs.append(box('SideboardTop', (2.7, 0.22, z1 - z0 + 0.4), (x - 0.1, F + 4.0, zc), dark, bevel=0.07))
    objs.append(box('SideboardPlinth', (2.2, 0.6, z1 - z0 - 0.3), (x, F + 0.3, zc), dark))
    for k in range(3):
        cz = z0 + (k + 0.5) * (z1 - z0) / 3
        objs.append(box(f'SideboardDoor{k}', (0.12, 2.6, (z1 - z0) / 3 - 0.4), (x - 1.22, F + 2.2, cz), dark, bevel=0.06))
        objs.append(sphere(f'SideboardKnob{k}', 0.12, (x - 1.36, F + 2.5, cz + 0.6), brass, segs=10, rings=8))
    # Radio: a rounded wooden cabinet with a cloth grille and a dial.
    rx, rz = x - 0.1, zc + 1.6
    objs.append(box('Radio', (1.6, 1.9, 2.4), (rx, F + 4.11 + 0.95, rz), flat('#5a3520', 0.4), bevel=0.35, segments=4))
    objs.append(box('RadioGrille', (0.05, 1.0, 1.7), (rx - 0.81, F + 5.2, rz), flat('#c9b48a', 0.95), bevel=0.02))
    dial = cylinder('RadioDial', 0.22, 0.08, (0, 0, 0), flat('#f3ead6', 0.4), segs=16)
    dial.rotation_euler = (0, math.pi / 2, 0)
    dial.location = V(rx - 0.84, F + 4.5, rz - 0.55)
    objs.append(dial)
    for k, dz in enumerate((0.1, 0.65)):
        kn = cylinder(f'RadioKnob{k}', 0.13, 0.12, (0, 0, 0), dark, segs=12)
        kn.rotation_euler = (0, math.pi / 2, 0)
        kn.location = V(rx - 0.86, F + 4.5, rz + dz)
        objs.append(kn)
    # A stack of board-game boxes.
    for k, (col, w, d) in enumerate([('#b3261e', 1.9, 2.6), ('#2d6a4f', 1.8, 2.3), ('#e3c25a', 1.6, 2.0)]):
        objs.append(box(f'GameBox{k}', (w, 0.32, d), (x - 0.2, F + 4.11 + 0.16 + k * 0.33, zc - 1.8), flat(col, 0.5), rot_y=0.08 * (k - 1), bevel=0.03))
    # Landscape above the sideboard.
    land = blib.image_from_array('landscape', tex.painting_landscape(640, 480))
    pic = textured('PaintingLandscape', land, rough=0.6)
    objs.append(blib.plane('PaintingLandscape', 5.2, 3.9, (SIDE - 0.2, F + 8.8, zc), pic, rot_y=-math.pi / 2))
    objs.append(picture_frame('LandscapeFrame', 5.2, 3.9, (SIDE - 0.12, F + 8.8, zc), -math.pi / 2, flat('#a8803a', 0.35), t=0.42))


def build_rug(objs):
    rug_img = blib.image_from_array('rug', tex.rug(2048))
    mat = textured('Rug', rug_img, rough=1.0)
    R = 12.8
    r = lathe('Rug', [(0, 0), (R, 0), (R + 0.03, 0.04), (R, 0.08), (0, 0.08)], 128, (0, F, 0), mat,
              cap_top=False, cap_bottom=False, hard_angle=60)
    planar_uv(r, 2 * R, 2 * R, origin=(-R, -R))
    objs.append(r)


# ---------------------------------------------------------------------------
# Lights (bake only)
# ---------------------------------------------------------------------------

def add_light(name, kind, pos, color, power, size=1.0, rot=None, shape=None):
    L = bpy.data.lights.new(name, kind)
    L.energy = power
    L.color = color
    if kind == 'AREA':
        L.shape = shape or 'DISK'
        L.size = size
        if shape == 'RECTANGLE':
            L.size_y = size * 0.8
    elif kind in ('POINT', 'SPOT'):
        L.shadow_soft_size = size
    o = bpy.data.objects.new(name, L)
    blib.link(o)
    o.location = V(*pos)
    if rot is not None:
        o.rotation_euler = rot
    return o


def setup_lighting(lamp_pos):
    world = bpy.data.worlds.new('Night')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*blib.hex_rgb('#2a2438'), 1)
    bg.inputs['Strength'].default_value = 0.4
    bpy.context.scene.world = world
    # A warm pool over the table (off camera), like a low pendant: a soft spot
    # so the light falls away toward the walls.
    pool = add_light('TablePool', 'SPOT', (0, 18, 1), (1.0, 0.84, 0.64), 20000, size=3.5)
    pool.data.spot_size = math.radians(110)
    pool.data.spot_blend = 1.0
    add_light('Lamp', 'POINT', lamp_pos, (1.0, 0.66, 0.36), 2600, size=0.6)
    add_light('Fire', 'POINT', (-SIDE + 1.2, F + 1.3, 0.0), (1.0, 0.45, 0.14), 2600, size=0.9)
    add_light('FireSpill', 'AREA', (-SIDE + 2.6, F + 1.6, 0.0), (1.0, 0.5, 0.2), 2200, size=3.0,
              rot=(0, math.radians(-90), 0), shape='SQUARE')
    # Moonlight through the window, cool and soft.
    add_light('Moon', 'AREA', (5, F + 8.6, BACK - 0.9), (0.62, 0.72, 1.0), 4000, size=10, rot=(math.radians(-90), 0, 0), shape='RECTANGLE')


# ---------------------------------------------------------------------------

def main():
    blib.reset()
    objs: list = []
    build_shell(objs)
    build_rug(objs)
    build_window(objs)
    build_fireplace(objs)
    build_bookshelf(objs)
    build_armchair(objs)
    build_side_table(objs)
    lamp = build_floor_lamp(objs)
    build_plant(objs)
    build_sideboard(objs)

    # Occluders for the bake: the table and the board cast the light pool's shadow.
    finish = flat('#5a3a22', 0.45, name='OccluderWood')
    occ = table_mod.build(finish, finish)
    occ.append(box('BoardOccluder', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='OccluderBoard')))

    blib.realize()
    room = [o for o in blib.mesh_objects() if not o.name.startswith(('Table', 'BoardOccluder'))]
    occ_objs = [o for o in blib.mesh_objects() if o.name.startswith(('Table', 'BoardOccluder'))]
    blib.flatten_colors(room)
    # Pictures and wallpaper keep world-space tiling; the hat/landscape planes already carry 0..1 UVs.
    for o in room:
        if o.name.startswith(('BackWall', 'SideWall')):
            blib.box_uv_world(o, 4.0)

    lit = [o for o in room if not blib.is_unlit(o)]
    unlit = [o for o in room if blib.is_unlit(o)]
    setup_lighting(lamp)
    blib.cull_hidden([o for o in lit if not o.name.startswith(('Floor', 'Rug'))], F + 0.0, eps=0.05)

    def weight(o):
        # Texel density where the camera looks: the rug and floor round the table first.
        if o.name.startswith('Rug'):
            return 3.2
        if o.name.startswith('Floor'):
            return 2.4
        if o.name.startswith(('Book', 'ChairButton', 'Candle', 'RadioKnob', 'Stem', 'GlobeRing', 'SideboardKnob')):
            return 0.35
        if o.name.startswith(('BackWall', 'SideWall', 'Crown')):
            return 0.8
        return 1.0
    blib.lightmap_unwrap(lit, margin=0.002 if not DRAFT else 0.004, weight=weight)
    size, spp = (1024, 24) if DRAFT else (2048, 96)
    scale = blib.bake_lightmap(lit, size=size, samples=spp,
                               out_file=os.path.join(blib.PUBLIC, 'models', 'classic', 'room-light.webp'))

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
    # The plain-colour mesh needs no texture UVs: drop them so its lightmap UVs become TEXCOORD_0.
    flat_mesh = out[0]
    if flat_mesh and 'UVMap' in flat_mesh.data.uv_layers:
        flat_mesh.data.uv_layers.remove(flat_mesh.data.uv_layers['UVMap'])
    blib.export_glb([o for o in out if o], 'models/classic/room.glb', normals=False)
    blib.record('classicRoom', {
        'url': '/models/classic/room.glb',
        'lightmap': '/models/classic/room-light.webp',
        'lightmapIntensity': round(scale * math.pi, 4),
    })


if __name__ == '__main__':
    main()
