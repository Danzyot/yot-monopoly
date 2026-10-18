"""A 360° panorama of the Takeprofit TV studio, seen from just above the board.

The game uses it as the environment map for everything lit live — the
characters, dice, table and houses — so they pick up the video wall, the
amber LEDs and the softboxes instead of a generic studio.

    tools/blender/run.sh tptv_env.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import blib  # noqa: E402
import tptv_room as room  # noqa: E402

OUT = os.path.join(blib.PUBLIC, 'models', 'tptv', 'room-env.webp')


def main():
    from PIL import Image
    sc = blib.reset()
    room.build_all()
    room.add_occluders()
    blib.realize()
    for o in blib.mesh_objects():
        if o.name.startswith(('FloorNear', 'FloorFar')):
            room.planar_uv(o, 8.0, 8.0)
        elif o.name == 'Stage':
            room.planar_uv(o, 2 * room.STAGE_R, 2 * room.STAGE_R, origin=(-room.STAGE_R, -room.STAGE_R))
    room.setup_lighting()

    cam = bpy.data.objects.new('Pano', bpy.data.cameras.new('Pano'))
    blib.link(cam)
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    cam.location = blib.V(0, 1.4, 0)
    # Level, looking toward game -z (the video wall) at the centre of the image.
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
    blib.record('tptvEnv', {'url': '/models/tptv/room-env.webp'})


if __name__ == '__main__':
    main()
