"""The little Chog that roams the home page: a sprite sheet rendered from the 3D Chog.

The base Chog (detailed.py, built the same way characters.py builds it) is
posed frame by frame with a small Python copy of the game's rig (Figure.tsx:
one pose transform carrying the body, head, hands and feet, limbs drawn as
tubes from shoulder to hand and hip to ankle), seen from above at a slant, and
rendered with Cycles on a transparent background. Every cell is drawn at twice
its size and scaled down, then given a dark outline, like the site's cartoon
edges, and a faint pale halo, so the violet Chog reads on the violet page.

The sheet holds a run cycle in five headings (south, south-east, east,
north-east, north; the page mirrors them for the west side), a standing frame
per heading (the spin) and a handful of idle frames facing the viewer: a blink,
looking left and right, a crouch and a jump, sitting, waving, sniffing and a
surprised hands-up. The home page lays the cells out from
client/src/components/roamer/sheet.gen.json, written alongside.

    tools/blender/run.sh chog_roamer.py [--cell 96] [--preview out.png]
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402
import blib  # noqa: E402
import characters  # noqa: E402
import detailed  # noqa: E402

CELL = int(sys.argv[sys.argv.index('--cell') + 1]) if '--cell' in sys.argv else 88
RENDER = 256                # every frame is rendered this size, then scaled down to CELL
OUTLINE = 4                 # outline width, in render pixels
QUALITY = int(sys.argv[sys.argv.index('--quality') + 1]) if '--quality' in sys.argv else 62
COLS = 8
OUT = 'home/chog-roamer.webp'
LAYOUT = os.path.join(blib.REPO, 'client', 'src', 'components', 'roamer', 'sheet.gen.json')
# The shoes in the mascot's pink (the game paints them in the player's colour).
SHOE = '#ec6f98'
# Camera: looking down at this many degrees below the horizon.
ELEVATION = float(sys.argv[sys.argv.index('--elev') + 1]) if '--elev' in sys.argv else 40
ORTHO = float(sys.argv[sys.argv.index('--ortho') + 1]) if '--ortho' in sys.argv else 0.76
TARGET_Y = 0.27

# Rig constants (Figure.tsx / looks.tsx).
HEAD_Y = 0.29
HAND_REST = (0.11, 0.115, 0.015)
FOOT_REST = (0.042, 0.0, 0.012)
ANKLE = 0.03
ARM_LEN, LEG_LEN = 0.09, 0.05
(SHOULDER, ARM_R) = detailed.ARMS['chog']
(HIP, LEG_R) = detailed.LEGS['chog']

# Headings: yaw about the game's up axis (0 faces the viewer, 90 faces screen right).
HEADINGS = {'s': 0, 'se': 45, 'e': 90, 'ne': 135, 'n': 180}
RUN_FRAMES = 6

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # game -> Blender
CI = C.inverted()


def gm(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """A game-space transform like a three.js object's (Euler XYZ)."""
    t = Matrix.Translation(Vector(pos))
    r = Euler(rot, 'XYZ').to_matrix().to_4x4()
    s = Matrix.Diagonal((*scale, 1))
    return t @ r @ s


def rest():
    """A neutral pose (all game space; hands and feet in the pose's frame)."""
    return {
        'pos': [0.0, 0.0, 0.0], 'rot': [0.0, 0.0, 0.0], 'squash': 1.0,
        'head_y': HEAD_Y, 'head': [0.0, 0.0, 0.0],
        'hands': [[HAND_REST[0], HAND_REST[1], HAND_REST[2], 0.0, 0.0], [-HAND_REST[0], HAND_REST[1], HAND_REST[2], 0.0, 0.0]],
        'feet': [[FOOT_REST[0], FOOT_REST[1], FOOT_REST[2], 0.0], [-FOOT_REST[0], FOOT_REST[1], FOOT_REST[2], 0.0]],
        'lids': 0.0,
    }


def run_pose(p):
    """One moment (0-1) of a run cycle: a bouncy, leaning trot, arms pumping against the legs."""
    a = 2 * math.pi * p
    s, c = math.sin(a), math.cos(a)
    q = rest()
    q['pos'][1] = 0.016 * c * c              # up as the legs pass, down on each footfall
    q['rot'][0] = 0.1                        # leaning into the run
    q['rot'][2] = 0.06 * s                   # a waddle
    q['rot'][1] = 0.1 * s                    # hips twist with the stride
    q['squash'] = 1.0 - 0.04 * s * s
    q['head'] = [-0.2, -0.08 * s, -0.05 * s]
    q['head_y'] = HEAD_Y - 0.008 * s * s
    for i, side in enumerate((1, -1)):
        fwd = s * side                       # +1: this foot is out in front
        swing = max(0.0, c * side)           # this foot is coming forward, off the ground
        f = q['feet'][i]
        f[1] = 0.036 * swing + 0.004 * max(0.0, -fwd)
        f[2] = FOOT_REST[2] + 0.05 * fwd
        f[3] = -0.4 * fwd
        h = q['hands'][i]
        h[0] = side * 0.1
        h[1] = HAND_REST[1] + 0.035 * max(0.0, -fwd) + 0.008
        h[2] = HAND_REST[2] - 0.05 * fwd
        h[3] = 0.5 * fwd
    return q


def idle_poses():
    """The idle frames, by name, all facing the viewer."""
    out = {}
    q = rest(); q['lids'] = 1.0
    out['blink'] = q
    for name, side in (('lookL', 1), ('lookR', -1)):
        q = rest()
        q['head'] = [0.05, side * 0.55, side * 0.06]
        q['rot'][1] = side * 0.12
        out[name] = q
    q = rest()                                   # winding up for a hop
    q['squash'] = 0.86; q['pos'][1] = -0.004; q['rot'][0] = 0.12
    q['head'] = [0.12, 0, 0]; q['head_y'] = HEAD_Y - 0.01
    for i, side in enumerate((1, -1)):
        q['hands'][i][1] -= 0.02; q['hands'][i][2] -= 0.04
    out['crouch'] = q
    q = rest()                                   # in the air: stretched, arms up, feet tucked
    q['squash'] = 1.08; q['rot'][0] = -0.06; q['head'] = [-0.15, 0, 0]
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * 0.14, 0.33, 0.03, 0, side * 0.7]
        q['feet'][i][1] = 0.03; q['feet'][i][2] = 0.0; q['feet'][i][3] = 0.3
    q['lids'] = 0.35
    out['air'] = q
    for name, lids in (('sit', 0.0), ('sitBlink', 1.0)):
        q = rest()                               # sat down, legs out in front
        q['pos'][1] = -0.075; q['rot'][0] = -0.16
        q['head'] = [0.04, 0, 0.06]
        for i, side in enumerate((1, -1)):
            q['feet'][i] = [side * 0.055, 0.06, 0.13, -1.25]
            q['hands'][i] = [side * 0.105, 0.07, 0.05, 0, side * 0.3]
        q['lids'] = lids
        out[name] = q
    for name, k in (('wave1', -1), ('wave2', 1)):
        q = rest()                               # waving with the right hand
        q['hands'][1] = [-0.15 + k * 0.02, 0.34, 0.05, 0, -0.5 + k * 0.4]
        q['head'] = [-0.04, -0.12, 0.1 * k * 0.5]
        q['rot'][2] = -0.04
        out[name] = q
    for name, k in (('sniff1', 0), ('sniff2', 1)):
        q = rest()                               # nose to the ground
        q['rot'][0] = 0.3; q['head'] = [0.55 + 0.06 * k, 0.08 * (k - 0.5), 0]
        q['head_y'] = HEAD_Y - 0.02
        for i, side in enumerate((1, -1)):
            q['hands'][i][2] += 0.03; q['hands'][i][1] -= 0.01
        q['lids'] = 0.5
        out[name] = q
    q = rest()                                   # surprised: hands up, leaning back
    q['rot'][0] = -0.12; q['head'] = [-0.2, 0, 0]
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * 0.13, 0.3, 0.05, 0, side * 0.5]
    out['surprise'] = q
    return out


# ---- the model ------------------------------------------------------------------

def build():
    data = characters.extract()
    spec = data['chog']
    spec['materials']['main']['color'] = SHOE
    nodes = {n.name.split('_', 1)[1]: n for n in characters.build_detailed('chog', spec)}
    mats = {m.name.split(':', 1)[1]: m for m in bpy.data.materials if m.name.startswith('chog:')}
    return nodes, mats


def limb(name, s, h, r0, r1, natural, pole, mat):
    """A rubber-hose limb from s to h (game space), bowing toward pole like the game's."""
    u = h - s
    ln = max(1e-4, u.length)
    u = u / ln
    bend = pole - u * pole.dot(u)
    if bend.length < 1e-6:
        bend = Vector((0, 0, 1))
    bend.normalize()
    bow = 0.6 * math.sqrt(max(0.0, natural * natural - ln * ln))
    ctrl = (s + h) / 2 + bend * bow
    pts = []
    for i in range(7):
        t = i / 6
        pts.append(tuple(s * (1 - t) ** 2 + ctrl * 2 * (1 - t) * t + h * t * t))
    obj = blib.tube(name, pts, (r0 + r1) / 2, mat, segs=12)
    obj.data.bevel_resolution = 4
    return obj


POLE_ARM = [Vector((0.6, -0.25, -0.75)), Vector((-0.6, -0.25, -0.75))]
POLE_LEG = [Vector((0.12, 0, 1)), Vector((-0.12, 0, 1))]


def apply(nodes, mats, q, yaw):
    """Pose the model for one frame; returns the temporary limb objects."""
    root = gm(rot=(0, math.radians(yaw), 0))
    sy = q['squash']
    sxz = 1 / math.sqrt(sy)
    P = root @ gm(q['pos'], q['rot'], (sxz, sy, sxz))

    def put(node, M):
        node.matrix_world = C @ M @ CI

    put(nodes['Body'], P)
    H = P @ gm((0, q['head_y'], 0), q['head'])
    put(nodes['Head'], H)
    for part, n in nodes.items():
        # The mane may be a node of its own in head space (`Hair_full`), beside the cut-down
        # ones worn under outfit hats, which the bare Chog never shows.
        if part.startswith('Hair_'):
            n.hide_render = part != 'Hair_full'
            put(n, H)
    for part in ('LidL', 'LidR'):
        n = nodes.get(part)
        if not n:
            continue
        shut = q['lids']
        n.hide_render = shut < 0.03
        put(n, H @ gm(tuple(n['hinge']), (0, 0, 0), (1, max(0.03, shut), 1)))
    for part, (x, y, z, rx, rz) in zip(('HandL', 'HandR'), q['hands']):
        put(nodes[part], P @ gm((x, y, z), (rx, 0, rz)))
    for part, (x, y, z, rx) in zip(('FootL', 'FootR'), q['feet']):
        put(nodes[part], P @ gm((x, y, z), (rx, 0, 0)))
    temp = []
    # Limbs are built in the pose's own frame, then carried by it.
    for i, side in enumerate((1, -1)):
        x, y, z = q['hands'][i][:3]
        o = limb(f'Arm{i}', Vector((SHOULDER[0] * side, SHOULDER[1], SHOULDER[2])), Vector((x, y, z)),
                 ARM_R, ARM_R * 0.85, ARM_LEN, POLE_ARM[i], mats['cloth'])
        temp.append((o, P))
        x, y, z = q['feet'][i][:3]
        o = limb(f'Leg{i}', Vector((HIP[0] * side, HIP[1], HIP[2])), Vector((x, y + ANKLE, z - 0.006)),
                 LEG_R, LEG_R * 0.9, LEG_LEN, POLE_LEG[i], mats['cloth'])
        temp.append((o, P))
    out = []
    for o, M in temp:
        # blib.tube wrote game points as Blender coordinates; carry them by the pose.
        o.matrix_world = C @ M @ CI
        out.append(o)
    return out


def scene_setup():
    sc = bpy.context.scene
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = RENDER
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ORTHO
    e = math.radians(ELEVATION)
    tgt = blib.V(0, TARGET_Y, 0)
    cam.location = tgt + Vector((0, -math.cos(e), math.sin(e))) * 4
    cam.rotation_euler = (math.pi / 2 - e, 0, 0)
    blib.link(cam)
    sc.camera = cam
    # Key light from above and a little in front, centred left-right so mirrored
    # headings light the same; a soft world for the shadow sides.
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(12)
    sun.rotation_euler = (math.radians(30), 0, 0)
    blib.link(sun)
    # A rim light from behind and above lights the mane's edges, so the violet reads on a violet page.
    back = bpy.data.objects.new('Back', bpy.data.lights.new('Back', 'SUN'))
    back.data.energy = 2.6
    back.data.color = (1.0, 0.92, 1.0)
    back.rotation_euler = (math.radians(-55), 0, 0)
    blib.link(back)
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.6, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.9
    sc.world = world
    return sc


def render(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def outline(img):
    """Give a full-size render a dark outline (the site's cartoon black edges) with a faint pale halo
    round that, so it reads on dark and light ground alike; then scale it down to a cell."""
    a = img.split()[3]
    ink_a = a.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 1)).filter(ImageFilter.GaussianBlur(1.4))
    halo_a = a.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 5)).filter(ImageFilter.GaussianBlur(1.6))
    out = Image.new('RGBA', img.size, (255, 236, 250, 0))
    out.putalpha(halo_a.point(lambda v: int(v * 0.3)))
    ink = Image.new('RGBA', img.size, (18, 10, 30, 0))
    ink.putalpha(ink_a.point(lambda v: int(v * 0.92)))
    out.alpha_composite(ink)
    out.alpha_composite(img)
    return out.convert('RGBa').resize((CELL, CELL), Image.LANCZOS).convert('RGBA')


def main():
    frames = []      # (name, pose, yaw)
    for h, yaw in HEADINGS.items():
        for k in range(RUN_FRAMES):
            frames.append((f'run_{h}_{k}', run_pose(k / RUN_FRAMES), yaw))
    for h, yaw in HEADINGS.items():
        frames.append((f'stand_{h}', rest(), yaw))
    for name, q in idle_poses().items():
        frames.append((name, q, 0))
    tmp = os.path.join(blib.HERE, '.cache', 'roamer')
    os.makedirs(tmp, exist_ok=True)
    # --pack-only: re-pack the last renders (another cell size or quality) without rendering.
    if '--pack-only' not in sys.argv:
        todo = frames
        if '--only' in sys.argv:
            keep = sys.argv[sys.argv.index('--only') + 1].split(',')
            todo = [f for f in frames if any(f[0].startswith(k) for k in keep)]
        blib.reset()
        nodes, mats = build()
        sc = scene_setup()
        for i, (name, q, yaw) in enumerate(todo):
            temp = apply(nodes, mats, q, yaw)
            render(sc, os.path.join(tmp, f'{name}.png'))
            for o in temp:
                bpy.data.objects.remove(o)
            blib.log('frame', i + 1, '/', len(todo), name)
    cells = [(name, outline(Image.open(os.path.join(tmp, f'{name}.png')).convert('RGBA'))) for name, _, _ in frames]
    rows = math.ceil(len(cells) / COLS)
    sheet = Image.new('RGBA', (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    layout = {}
    for i, (name, im) in enumerate(cells):
        sheet.paste(im, ((i % COLS) * CELL, (i // COLS) * CELL))
        layout[name] = i
    dest = os.path.join(blib.PUBLIC, OUT)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    sheet.save(dest, 'WEBP', quality=QUALITY, method=6, alpha_quality=50)
    size = os.path.getsize(dest)
    blib.log('wrote', OUT, f'{size // 1024} KB', f'{sheet.size[0]}x{sheet.size[1]}')
    os.makedirs(os.path.dirname(LAYOUT), exist_ok=True)
    with open(LAYOUT, 'w') as f:
        json.dump({'url': f'/{OUT}?v={blib.file_hash(dest)}', 'cell': CELL, 'cols': COLS, 'rows': rows,
                   'runFrames': RUN_FRAMES, 'headings': list(HEADINGS), 'frames': layout}, f, indent=2)
        f.write('\n')
    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        bg = Image.new('RGBA', sheet.size, (34, 18, 58, 255))
        bg.alpha_composite(sheet)
        bg.convert('RGB').resize((sheet.size[0] * 2, sheet.size[1] * 2), Image.NEAREST).save(out)
        blib.log('preview', out)


if __name__ == '__main__':
    main()
