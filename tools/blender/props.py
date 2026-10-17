"""Houses and hotels.

Both stand on their base at the origin, front toward +z. The body and roof
materials are recoloured live to the edition's house / hotel colour (the roof
a shade darker), so one model serves every edition.

    tools/blender/run.sh props.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import blib  # noqa: E402
from blib import V, box  # noqa: E402


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


def windows(prefix, xs, y, z, w, h, mat, frame_mat, depth=0.006):
    out = []
    for i, x in enumerate(xs):
        out.append(box(f'{prefix}Frame{i}', (w + 0.012, h + 0.012, depth), (x, y, z + depth / 2), frame_mat))
        out.append(box(f'{prefix}Glass{i}', (w, h, depth), (x, y, z + depth), mat))
    return out


def build_house(body, roof, trim, glass):
    W, H, D = 0.13, 0.11, 0.14
    parts = [box('HouseBody', (W, H, D), (0, 0, 0), body, bevel=0.008, origin='bottom')]
    parts.append(gable_roof('HouseRoof', W, D, 0.075, 0.012, (0, H, 0), roof))
    parts.append(box('HouseChimney', (0.022, 0.05, 0.022), (0.035, H + 0.045, -0.025), roof, bevel=0.003, origin='bottom'))
    parts.append(box('HouseDoor', (0.03, 0.055, 0.006), (0.0, 0.0275, D / 2 + 0.003), trim, bevel=0.002))
    parts += windows('HouseWin', (-0.042, 0.042), 0.065, D / 2, 0.026, 0.026, glass, trim)
    return parts


def build_hotel(body, roof, trim, glass):
    W, H, D = 0.36, 0.2, 0.19
    parts = [box('HotelBody', (W, H, D), (0, 0, 0), body, bevel=0.01, origin='bottom')]
    parts.append(gable_roof('HotelRoof', W, D, 0.085, 0.014, (0, H, 0), roof))
    parts.append(box('HotelDoor', (0.05, 0.075, 0.006), (0, 0.0375, D / 2 + 0.003), trim, bevel=0.002))
    parts.append(box('HotelCanopy', (0.09, 0.012, 0.035), (0, 0.083, D / 2 + 0.017), roof, bevel=0.003))
    xs = (-0.135, -0.075, 0.075, 0.135)
    parts += windows('HotelWinA', xs, 0.06, D / 2, 0.03, 0.034, glass, trim)
    parts += windows('HotelWinB', (-0.135, -0.075, 0.0, 0.075, 0.135), 0.145, D / 2, 0.03, 0.034, glass, trim)
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


if __name__ == '__main__':
    main()
