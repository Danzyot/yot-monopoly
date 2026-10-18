"""A 360° panorama of the Speedway set, seen from just above the board.

The game uses it as the environment map for everything lit live on the
Speedway map — the characters, dice, table and houses — so they reflect the
dusk sky, the floodlights and the lit garages instead of a generic studio.

    tools/blender/run.sh speedway_env.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import blib  # noqa: E402
import speedway_set as sset  # noqa: E402
import table as table_mod  # noqa: E402
from blib import box, flat  # noqa: E402

OUT = os.path.join(blib.PUBLIC, 'models', 'speedway', 'set-env.webp')


def main():
    from PIL import Image
    sc = blib.reset()
    objs, heads, back, gmat = sset.build_all(with_sky=True)
    table_mod.build(flat('#5a3a22', 0.45, name='EnvTable'), flat('#c9a04f', 0.3, name='EnvTrim'))
    box('EnvBoard', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='EnvBoardMat'))
    blib.realize()
    sset.setup_lighting(heads)

    cam = bpy.data.objects.new('Pano', bpy.data.cameras.new('Pano'))
    blib.link(cam)
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    cam.data.clip_end = 1000
    cam.location = blib.V(0, 1.4, 0)
    # Level, looking toward game -z (the back of the set) at the centre of the image.
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
    blib.record('speedwayEnv', {'url': '/models/speedway/set-env.webp'})


if __name__ == '__main__':
    main()
