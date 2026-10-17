"""A 360° panorama of the Classic room, seen from just above the board.

The game uses it as the environment map for everything lit live — the
characters, dice, table and houses — so they reflect this room's lamp, fire
and moonlit window instead of a generic studio.

    tools/blender/run.sh classic_env.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
import blib  # noqa: E402
import classic_room as room  # noqa: E402
import table as table_mod  # noqa: E402
from blib import box, flat  # noqa: E402

OUT = os.path.join(blib.PUBLIC, 'models', 'classic', 'room-env.webp')


def main():
    from PIL import Image
    sc = blib.reset()
    objs: list = []
    room.build_shell(objs)
    room.build_rug(objs)
    room.build_window(objs)
    room.build_fireplace(objs)
    room.build_bookshelf(objs)
    room.build_armchair(objs)
    room.build_side_table(objs)
    lamp = room.build_floor_lamp(objs)
    room.build_plant(objs)
    room.build_sideboard(objs)
    table_mod.build(flat('#5a3a22', 0.45, name='EnvTable'), flat('#c9a04f', 0.3, name='EnvTrim'))
    box('EnvBoard', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='EnvBoardMat'))
    blib.realize()
    for o in blib.mesh_objects():
        if o.name.startswith(('BackWall', 'SideWall')):
            blib.box_uv_world(o, 4.0)
    room.setup_lighting(lamp)

    cam = bpy.data.objects.new('Pano', bpy.data.cameras.new('Pano'))
    blib.link(cam)
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    cam.location = blib.V(0, 1.4, 0)
    # Level, looking toward game -z (the back wall) at the centre of the image.
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1024, 512
    sc.render.resolution_percentage = 100
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    tmp = OUT.replace('.webp', '.tmp.png')
    sc.render.filepath = tmp
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    Image.open(tmp).convert('RGB').save(OUT, 'WEBP', quality=88, method=6)
    os.remove(tmp)
    blib.log('wrote', os.path.relpath(OUT, blib.REPO), f'{os.path.getsize(OUT) // 1024} KB')
    blib.record('classicEnv', {'url': '/models/classic/room-env.webp'})


if __name__ == '__main__':
    main()
