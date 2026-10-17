"""The game table: a round wooden top with a raised lip, a turned pedestal and
four carved feet. Shared by every map; its finish is recoloured at runtime
from the room's table style, so it is lit live rather than baked.

    tools/blender/run.sh table.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blib  # noqa: E402
from blib import V  # noqa: E402

FLOOR = -4.6
BOARD_THICK = 0.28


def build(finish, trim):
    """Returns the table's objects (game units, top surface at y = -BOARD_THICK)."""
    top_y = -BOARD_THICK
    objs = []
    # Top: thick slab with a rounded edge and a low lip round the rim that the board sits inside.
    top = blib.lathe('TableTop', [
        (0, top_y - 0.6), (8.25, top_y - 0.6), (8.58, top_y - 0.54), (8.74, top_y - 0.38),
        (8.76, top_y - 0.16), (8.7, top_y + 0.04), (8.6, top_y + 0.12), (8.48, top_y + 0.12),
        (8.4, top_y + 0.05), (8.36, top_y), (0, top_y),
    ], segs=96, mat=finish, cap_top=False, cap_bottom=False, hard_angle=35)
    objs.append(top)
    # A brass inlay just inside the lip.
    ring = blib.torus('TableInlay', 8.3, 0.035, (0, top_y + 0.005, 0), trim, seg=96, mseg=8)
    objs.append(ring)
    # Pedestal: a turned column, wide collar under the top, bulb, neck, flared foot.
    y0 = top_y - 0.6
    yb = FLOOR + 0.75
    span = y0 - yb
    prof = [(0, yb), (1.7, yb), (1.75, yb + 0.12), (1.25, yb + 0.35), (0.85, yb + 0.9),
            (0.7, yb + span * 0.3), (1.05, yb + span * 0.45), (1.25, yb + span * 0.55),
            (1.0, yb + span * 0.66), (0.72, yb + span * 0.78), (0.95, yb + span * 0.9),
            (1.7, y0 - 0.12), (1.9, y0), (0, y0)]
    objs.append(blib.lathe('TablePedestal', prof, segs=48, mat=finish, cap_top=False, cap_bottom=False, hard_angle=40))
    # Four feet: tapering tubes sweeping out and down, each ending in a brass-capped ball.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        pts = []
        for i in range(9):
            t = i / 8
            r = 1.2 + 2.6 * t
            y = yb + 0.5 - 0.42 * t ** 1.6 + 0.25 * math.sin(t * math.pi)
            pts.append((math.cos(a) * r, y, math.sin(a) * r))
        foot = blib.tube(f'TableFoot{k}', pts, 0.32, finish, segs=12)
        # Taper toward the tip.
        sp = foot.data.splines[0]
        for i, p in enumerate(sp.points):
            p.radius = 1.0 - 0.45 * (i / (len(sp.points) - 1))
        objs.append(foot)
        tip = pts[-1]
        objs.append(blib.sphere(f'TableFootBall{k}', 0.26, (tip[0] * 1.04, FLOOR + 0.26, tip[2] * 1.04), trim, segs=16, rings=10))
    return objs


def main():
    blib.reset()
    finish = blib.bpy.data.materials.new('TableFinish')
    finish.use_nodes = True
    b = finish.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*blib.hex_rgb('#5a3a22'), 1)
    b.inputs['Roughness'].default_value = 0.45
    trim = blib.bpy.data.materials.new('TableTrim')
    trim.use_nodes = True
    t = trim.node_tree.nodes['Principled BSDF']
    t.inputs['Base Color'].default_value = (*blib.hex_rgb('#c9a04f'), 1)
    t.inputs['Metallic'].default_value = 1.0
    t.inputs['Roughness'].default_value = 0.3
    objs = build(finish, trim)
    blib.realize(objs)
    table = blib.join(blib.mesh_objects(), 'Table')
    blib.export_glb([table], 'models/table.glb', images='NONE')
    blib.record('table', {'url': '/models/table.glb'})


if __name__ == '__main__':
    main()
