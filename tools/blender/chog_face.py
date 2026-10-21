"""Chog's face for the site: the base 3D Chog's head and shoulders, front on.

Wherever the Chog character shows as a small round face (player rows, toasts,
lobby seats, leaderboards), the site draws this instead of an emoji. The model
and its rest pose are the home page roamer's (chog_roamer.py); the camera sits
level with the face, a little above, and frames the head and mane.

    tools/blender/run.sh chog_face.py [--target 0.37] [--ortho 0.5] [--preview out.png]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import math  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image  # noqa: E402

import blib  # noqa: E402
import chog_roamer as roamer  # noqa: E402

arg = lambda n, d: float(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
TARGET_Y = arg('--target', 0.37)
ORTHO = arg('--ortho', 0.5)
ELEVATION = arg('--elev', 10)
RENDER = 512
OUT = 'faces/chog.webp'
SIZE = 128


def main():
    blib.reset()
    nodes, mats = roamer.build()
    sc = roamer.scene_setup()
    sc.render.resolution_x = sc.render.resolution_y = RENDER
    sc.cycles.samples = 96
    cam = sc.camera
    cam.data.ortho_scale = ORTHO
    e = math.radians(ELEVATION)
    tgt = blib.V(0, TARGET_Y, 0)
    cam.location = tgt + Vector((0, -math.cos(e), math.sin(e))) * 4
    cam.rotation_euler = (math.pi / 2 - e, 0, 0)
    # Head and shoulders only: the hands and arms would poke up at the bottom edge.
    for o in roamer.apply(nodes, mats, roamer.rest(), 0):
        o.hide_render = True
    for part in ('HandL', 'HandR'):
        nodes[part].hide_render = True
    tmp = os.path.join(blib.HERE, '.cache', 'chog-face.png')
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    roamer.render(sc, tmp)
    img = Image.open(tmp).convert('RGBA')
    dest = os.path.join(blib.PUBLIC, OUT)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    img.convert('RGBa').resize((SIZE, SIZE), Image.LANCZOS).convert('RGBA').save(dest, 'WEBP', quality=88, method=6, alpha_quality=90)
    blib.log('wrote', dest, f'{os.path.getsize(dest) // 1024} KB')
    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        bg = Image.new('RGBA', img.size, (253, 246, 205, 255))
        bg.alpha_composite(img)
        bg.convert('RGB').save(out)


if __name__ == '__main__':
    main()
