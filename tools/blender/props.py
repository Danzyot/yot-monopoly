"""Houses and hotels.

Both stand on their base at the origin, front toward +z. The body and roof
materials are recoloured live to the edition's house / hotel colour (the roof
a shade darker), so one model serves every edition. They are meant to read as
premium moulded game pieces: soft bevels everywhere, a doorstep, window sills
and glazing bars, a capped chimney, ridge tiles, and on the hotel a storey
band, a canopy with a blank sign plate and a flagpole.

    tools/blender/run.sh props.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402
import blib  # noqa: E402
from blib import box  # noqa: E402


def material(name, color, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*blib.hex_rgb(color), 1)
    b.inputs['Roughness'].default_value = rough
    return m


def gable_roof(name, w, d, h, overhang, pos, mat):
    """A pitched roof: ridge along x, slopes toward ±z, with a little overhang."""
    bm = bmesh.new()
    hw, hd = w / 2 + overhang, d / 2 + overhang
    t = 0.012  # slab thickness
    pts = [(-hw, -hd, 0), (hw, -hd, 0), (hw, hd, 0), (-hw, hd, 0), (-hw, 0, h), (hw, 0, h)]
    # Build as a solid prism (blender: y = -game z).
    v = [bm.verts.new((x, y, z)) for x, y, z in pts]
    bm.faces.new((v[0], v[1], v[5], v[4]))
    bm.faces.new((v[2], v[3], v[4], v[5]))
    bm.faces.new((v[0], v[4], v[3]))
    bm.faces.new((v[1], v[2], v[5]))
    bm.faces.new((v[0], v[3], v[2], v[1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = blib.new_mesh_object(name, bm, mat)
    blib.place(obj, pos)
    blib.add_bevel(obj, t, 2)
    return obj


def roof_courses(prefix, w, d, h, overhang, y, mat, n=3):
    """Thin tile courses lying on both slopes of a gable roof, plus a ridge cap."""
    hw, hd = w / 2 + overhang, d / 2 + overhang
    slope = math.atan2(h, hd)
    length = math.hypot(hd, h)
    out = []
    for side in (1, -1):  # 1 = front slope (game +z = blender -y)
        for i in range(n):
            f = (i + 0.5) / n  # fraction up the slope
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(2 * hw + 0.002, length / n * 0.92, 0.004), verts=bm.verts)
            bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(side * slope, 3, 'X'), verts=bm.verts)
            ny, nz = -side * h / length, hd / length  # outward normal of the slope
            cy, cz = -side * hd * (1 - f), h * f
            bmesh.ops.translate(bm, vec=(0, cy + ny * 0.002, y + cz + nz * 0.002), verts=bm.verts)
            out.append(blib.new_mesh_object(f'{prefix}Course{"F" if side > 0 else "B"}{i}', bm, mat))
    out.append(box(f'{prefix}Ridge', (2 * hw + 0.006, 0.009, 0.016), (0, y + h - 0.001, 0), mat))
    return out


def window(name, x, y, z, w, h, glass, trim, rot_y=0.0, depth=0.006, bars=True, sill=True):
    """A framed window with a sill and glazing bars, on a wall whose outside is at (x, z) facing rot_y."""
    sx, sz = math.sin(rot_y), math.cos(rot_y)  # outward normal

    def at(off):
        return (x + sx * off, y, z + sz * off)

    out = [
        box(f'{name}Frame', (w + 0.014, h + 0.014, depth), at(depth / 2), trim, rot_y),
        box(f'{name}Glass', (w, h, depth), at(depth), glass, rot_y),
    ]
    if sill:
        out.append(box(f'{name}Sill', (w + 0.022, 0.006, 0.012), (x + sx * 0.006, y - h / 2 - 0.007, z + sz * 0.006), trim, rot_y))
    if bars:
        out.append(box(f'{name}BarV', (0.0025, h, 0.002), at(depth * 1.5 + 0.001), trim, rot_y))
        out.append(box(f'{name}BarH', (w, 0.0025, 0.002), at(depth * 1.5 + 0.001), trim, rot_y))
    return out


def door(name, x, y, z, w, h, panel, trim, leaves=1):
    """A framed door with a step and a knob, set into the front (+z) wall at (x, z)."""
    out = [
        box(f'{name}Frame', (w + 0.014, h + 0.01, 0.006), (x, y + h / 2 + 0.003, z + 0.003), trim),
        box(f'{name}Step', (w + 0.03, 0.007, 0.022), (x, y, z + 0.011), trim, origin='bottom'),
    ]
    lw = w / leaves
    for i in range(leaves):
        lx = x + (i - (leaves - 1) / 2) * lw
        out.append(box(f'{name}Leaf{i}', (lw - 0.003, h - 0.004, 0.005), (lx, y + h / 2, z + 0.007), panel))
        kx = lx + (0.3 if leaves == 1 else (-1 if i == 0 else 1) * 0.3) * lw
        out.append(blib.sphere(f'{name}Knob{i}', 0.0028, (kx, y + h * 0.45, z + 0.011), trim, segs=8, rings=4))
    return out


def chimney(name, x, y, z, w, h, body, trim):
    return [
        box(f'{name}Stack', (w, h, w), (x, y, z), body, bevel=0.0025, origin='bottom'),
        box(f'{name}Cap', (w + 0.008, 0.006, w + 0.008), (x, y + h, z), trim, origin='bottom'),
        blib.cylinder(f'{name}Flue', w * 0.22, 0.008, (x, y + h + 0.005, z), trim, segs=8),
    ]


def build_house(body, roof, trim, glass):
    W, H, D = 0.13, 0.11, 0.14
    parts = [
        box('HousePlinth', (W + 0.008, 0.008, D + 0.008), (0, 0, 0), trim, bevel=0.003, origin='bottom'),
        box('HouseBody', (W, H, D), (0, 0.006, 0), body, bevel=0.007, segments=3, origin='bottom'),
    ]
    parts.append(gable_roof('HouseRoof', W, D, 0.072, 0.012, (0, H + 0.004, 0), roof))
    parts += roof_courses('HouseRoof', W, D, 0.072, 0.012, H + 0.004, roof, n=3)
    parts += chimney('HouseChimney', 0.036, H + 0.03, -0.028, 0.022, 0.058, roof, trim)
    parts += door('HouseDoor', 0.0, 0.006, D / 2, 0.03, 0.054, roof, trim)
    for i, x in enumerate((-0.04, 0.04)):
        parts += window(f'HouseWin{i}', x, 0.068, D / 2, 0.026, 0.028, glass, trim)
    for i, (x, r) in enumerate(((W / 2, math.pi / 2), (-W / 2, -math.pi / 2))):
        parts += window(f'HouseSide{i}', x, 0.064, 0.015, 0.024, 0.026, glass, trim, rot_y=r)
    return parts


def build_hotel(body, roof, trim, glass):
    W, H, D = 0.36, 0.2, 0.19
    parts = [
        box('HotelPlinth', (W + 0.01, 0.008, D + 0.01), (0, 0, 0), trim, bevel=0.003, origin='bottom'),
        box('HotelBody', (W, H, D), (0, 0.006, 0), body, bevel=0.008, segments=3, origin='bottom'),
        # Storey band and cornice.
        box('HotelBand', (W + 0.006, 0.008, D + 0.006), (0, 0.108, 0), trim),
        box('HotelCornice', (W + 0.01, 0.01, D + 0.01), (0, H + 0.001, 0), trim, bevel=0.003),
    ]
    parts.append(gable_roof('HotelRoof', W, D, 0.085, 0.014, (0, H + 0.006, 0), roof))
    parts += roof_courses('HotelRoof', W, D, 0.085, 0.014, H + 0.006, roof, n=4)
    for i, x in enumerate((-0.125, 0.125)):
        parts += chimney(f'HotelChimney{i}', x, H + 0.04, -0.05, 0.026, 0.066, roof, trim)
    # Entrance: double door under a canopy with a blank sign plate on its fascia.
    parts += door('HotelDoor', 0.0, 0.006, D / 2, 0.052, 0.074, roof, trim, leaves=2)
    cz = D / 2 + 0.024
    parts.append(box('HotelCanopy', (0.11, 0.007, 0.05), (0, 0.092, cz), roof, bevel=0.002))
    parts.append(box('HotelSign', (0.096, 0.016, 0.005), (0, 0.086, D / 2 + 0.047), trim))
    for i, x in enumerate((-0.046, 0.046)):
        parts.append(blib.cylinder(f'HotelPost{i}', 0.0035, 0.088, (x, 0.006, D / 2 + 0.042), trim, segs=8))
    for i, x in enumerate((-0.138, -0.078, 0.078, 0.138)):
        parts += window(f'HotelWinA{i}', x, 0.058, D / 2, 0.03, 0.036, glass, trim)
    for i, x in enumerate((-0.138, -0.078, 0.0, 0.078, 0.138)):
        parts += window(f'HotelWinB{i}', x, 0.154, D / 2, 0.03, 0.036, glass, trim)
    for i, (x, r) in enumerate(((W / 2, math.pi / 2), (-W / 2, -math.pi / 2))):
        for j, (z, y) in enumerate(((-0.05, 0.058), (0.05, 0.058), (-0.05, 0.154), (0.05, 0.154))):
            parts += window(f'HotelSide{i}{j}', x, y, z, 0.028, 0.034, glass, trim, rot_y=r)
    # Flagpole on the ridge.
    top = H + 0.006 + 0.085
    parts.append(blib.cylinder('HotelPole', 0.003, 0.075, (0.0, top - 0.004, 0), trim, segs=8))
    parts.append(blib.sphere('HotelFinial', 0.005, (0.0, top + 0.072, 0), trim, segs=8, rings=5))
    parts.append(box('HotelFlag', (0.03, 0.018, 0.002), (0.017, top + 0.058, 0), roof))
    return parts


def main():
    blib.reset()
    body = material('BuildingBody', '#1f9d49', 0.45)
    roof = material('BuildingRoof', '#16753a', 0.6)
    trim = material('BuildingTrim', '#f5f1e6', 0.5)
    glass = material('BuildingGlass', '#fff1b8', 0.2)
    house = build_house(body, roof, trim, glass)
    blib.realize(house)
    h = blib.join(house, 'House')
    hotel = build_hotel(body, roof, trim, glass)
    blib.realize(hotel)
    t = blib.join(hotel, 'Hotel')
    blib.export_glb([h, t], 'models/buildings.glb', images='NONE')
    blib.record('buildings', {'url': '/models/buildings.glb'})
    return h, t


if __name__ == '__main__':
    main()
