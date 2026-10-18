"""A 360° panorama of the Chog Poker lounge, seen from just above the board.

The game uses it as the environment map for everything lit live — the
characters, dice, table and houses — so they pick up the lounge's pink neon,
warm lamps and purple velvet instead of a generic studio.

    tools/blender/run.sh chog_env.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import blib  # noqa: E402
import chog_room as room  # noqa: E402
import table as table_mod  # noqa: E402
from blib import box, flat  # noqa: E402

OUT = os.path.join(blib.PUBLIC, 'models', 'chog', 'room-env.webp')


def main():
    from PIL import Image
    sc = blib.reset()
    objs, lights = room.build_all()
    table_mod.build(flat('#2b1764', 0.45, name='EnvTable'), flat('#d4a64a', 0.3, name='EnvTrim'))
    box('EnvBoard', (11, 0.28, 11), (0, -0.14, 0), flat('#1c1140', 0.6, name='EnvBoardMat'))
    blib.realize()
    room.uv_walls()
    room.setup_lighting(lights)

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
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    Image.open(tmp).convert('RGB').save(OUT, 'WEBP', quality=88, method=6)
    os.remove(tmp)
    blib.log('wrote', os.path.relpath(OUT, blib.REPO), f'{os.path.getsize(OUT) // 1024} KB')
    blib.record('chogEnv', {'url': '/models/chog/room-env.webp'})


if __name__ == '__main__':
    main()
