"""A 360° panorama of the Metropolis rooftop, seen from just above the board.

The game uses it as the environment map for everything lit live — the
characters, dice, table and houses — so they reflect the festoon lights, the
neon sign and the lit towers round the roof.

    tools/blender/run.sh skyline_env.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import blib  # noqa: E402
import skyline_set as sky  # noqa: E402
import table as table_mod  # noqa: E402
from blib import box, flat  # noqa: E402

OUT = os.path.join(blib.PUBLIC, 'models', 'skyline', 'set-env.webp')


def main():
    from PIL import Image
    sc = blib.reset()
    sky.build_all()
    table_mod.build(flat('#5a3a22', 0.45, name='EnvTable'), flat('#c9a04f', 0.3, name='EnvTrim'))
    box('EnvBoard', (11, 0.28, 11), (0, -0.14, 0), flat('#d8d2bf', 0.6, name='EnvBoardMat'))
    blib.realize()
    for o in blib.mesh_objects():
        if o.data.materials and o.data.materials[0].name == 'Brick':
            blib.box_uv_world(o, 4.8)
    sky.setup_lighting()

    cam = bpy.data.objects.new('Pano', bpy.data.cameras.new('Pano'))
    blib.link(cam)
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    cam.data.clip_end = 1500
    cam.location = blib.V(0, 1.4, 0)
    # Level, looking toward game -z (the neon sign) at the centre of the image.
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1024, 512
    sc.render.resolution_percentage = 100
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    tmp = OUT.replace('.webp', '.tmp.png')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sc.render.filepath = tmp
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    Image.open(tmp).convert('RGB').save(OUT, 'WEBP', quality=88, method=6)
    os.remove(tmp)
    blib.log('wrote', os.path.relpath(OUT, blib.REPO), f'{os.path.getsize(OUT) // 1024} KB')
    blib.record('skylineEnv', {'url': '/models/skyline/set-env.webp'})


if __name__ == '__main__':
    main()
