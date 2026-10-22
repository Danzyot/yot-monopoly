"""Shot 5, Chog Cards in the lounge, at the Cards game's own scale (cards/three/layout.ts:
felt radius 7.2, Chogs at 3.9x standing round it at radius 5.7, cards 1 x 1.5).

  0.0-1.6  your hand fans up in front of a low camera, the pile beyond.
  1.6-2.7  the Chog on the left slams a Draw Four onto the pile.
  2.7-3.9  the Chog across winces, then stacks a Draw Four of its own.
  3.9-5.0  a Rug Pull +10 lands and ten cards stream from the draw pile to the right-hand Chog.
  5.0-7.0  the Chog across holds up its last card and it catches fire; a slow push in.
"""

import math
import os
import random

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

import film
from film import V, lerp, lerpv, seg, smooth, smoother, ease_out, ease_in, damped, clamp
import lounge

SHOT = 'shot05'
DUR = 7.0
FIG = 3.9
FELT_Y = -0.25
SEAT_R = 5.7
CARD_W, CARD_H = 1.0, 1.5
PILE = (-1.45, 0.35)
DISCARD = (1.45, 0.35)
TEX = os.path.abspath(os.path.join(film.OUT_ROOT, '..', 'tex', 'cards'))

sc = film.setup_render(film.blib.reset())
world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.005, 0.02, 1)
sc.world = world
lounge.room()
finish = film.principled('TableFinish', '#2a1650', rough=0.28, coat=0.6)
trim = film.principled('TableTrim', '#d8a64a', rough=0.3, metal=1.0)
lounge.table.build(finish, trim)
bpy.ops.mesh.primitive_circle_add(radius=7.2, vertices=96, fill_type='NGON', location=V(0, FELT_Y, 0))
felt = bpy.context.active_object
fm = bpy.data.materials.new('Felt')
fm.use_nodes = True
fb = fm.node_tree.nodes['Principled BSDF']
fb.inputs['Base Color'].default_value = (*film.blib.hex_rgb('#3a1f78'), 1)
fb.inputs['Roughness'].default_value = 0.9
fb.inputs['Sheen Weight'].default_value = 0.25
felt.data.materials.append(fm)
bpy.ops.mesh.primitive_torus_add(major_radius=7.34, minor_radius=0.12, location=V(0, FELT_Y + 0.02, 0))
bpy.context.active_object.data.materials.append(trim)
film.area_light('TablePool', V(0, 9.0, 1.0), V(0, 0, 0), 900, 7.0, (1.0, 0.86, 0.7))
film.area_light('Fill', V(9, 4.5, 10), V(0, 0.5, 0), 500, 6.0, (0.7, 0.72, 1.0))
film.area_light('Rim', V(-3, 5.0, -12), V(0, 1.0, 0), 1400, 6.0, (1.0, 0.45, 0.8))
for n in ('TablePool', 'Fill', 'Rim'):
    bpy.data.objects[n].visible_glossy = False

_mats = {}


def card_mat(face):
    if face in _mats:
        return _mats[face]
    m = bpy.data.materials.new(f'card-{face}')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    fimg = nt.nodes.new('ShaderNodeTexImage')
    fimg.image = bpy.data.images.load(os.path.join(TEX, f'{face}.png'), check_existing=True)
    bimg = nt.nodes.new('ShaderNodeTexImage')
    bimg.image = bpy.data.images.load(os.path.join(TEX, 'back.png'), check_existing=True)
    flip = nt.nodes.new('ShaderNodeMapping')
    flip.inputs['Scale'].default_value = (-1, 1, 1)
    flip.inputs['Location'].default_value = (1, 0, 0)
    uv = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(uv.outputs['UV'], fimg.inputs['Vector'])
    nt.links.new(uv.outputs['UV'], flip.inputs['Vector'])
    nt.links.new(flip.outputs['Vector'], bimg.inputs['Vector'])
    col = nt.nodes.new('ShaderNodeMix')
    col.data_type = 'RGBA'
    nt.links.new(geo.outputs['Backfacing'], col.inputs['Factor'])
    nt.links.new(fimg.outputs['Color'], col.inputs['A'])
    nt.links.new(bimg.outputs['Color'], col.inputs['B'])
    alpha = nt.nodes.new('ShaderNodeMix')
    alpha.data_type = 'FLOAT'
    nt.links.new(geo.outputs['Backfacing'], alpha.inputs['Factor'])
    nt.links.new(fimg.outputs['Alpha'], alpha.inputs['A'])
    nt.links.new(bimg.outputs['Alpha'], alpha.inputs['B'])
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = 0.35
    b.inputs['Coat Weight'].default_value = 0.3
    nt.links.new(col.outputs['Result'], b.inputs['Base Color'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(alpha.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(b.outputs['BSDF'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    _mats[face] = m
    return m


def card(face):
    bpy.ops.mesh.primitive_plane_add(size=1)
    ob = bpy.context.active_object
    ob.scale = (CARD_W, CARD_H, 1)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(card_mat(face))
    ob.visible_shadow = True
    return ob


def put_card(ob, pos, rot, s=1.0):
    """pos in game space; rot = (pitch, yaw, roll) radians, a card lying flat face up at (0, 0, 0)."""
    ob.location = V(*pos)
    ob.rotation_euler = Euler(rot, 'ZXY')
    ob.scale = (s, s, s)


# The table: a draw pile, a discard pile, three Chogs with fanned hands.
rnd = random.Random(5)
pile = []
for k in range(14):
    c = card('back')
    put_card(c, (PILE[0] + rnd.uniform(-0.02, 0.02), FELT_Y + 0.006 + 0.012 * k, PILE[1]), (math.pi, rnd.uniform(-0.06, 0.06), 0))
    pile.append(c)
discard = []
for k, face in enumerate(('red-7', 'green-9', 'blue-2')):
    c = card(face)
    put_card(c, (DISCARD[0] + rnd.uniform(-0.1, 0.1), FELT_Y + 0.006 + 0.012 * k, DISCARD[1] + rnd.uniform(-0.1, 0.1)), (0, 0, rnd.uniform(-0.5, 0.5)))
    discard.append(c)
TOP0 = FELT_Y + 0.006 + 0.012 * 3

proto = film.Chog(scale=FIG)
chogs = {'left': proto, 'far': lounge.clone_chog(proto, shoe='#3b8cff', scale=FIG), 'right': lounge.clone_chog(proto, shoe='#ffd23f', scale=FIG)}
SEATS = {'left': (-SEAT_R, 0.0), 'far': (0.0, -SEAT_R), 'right': (SEAT_R, 0.0)}
YAW = {'left': 90.0, 'far': 0.0, 'right': -90.0}

# Each opponent's hand: card backs fanned in front of it.
hands = {}
for name, n in (('left', 5), ('far', 2), ('right', 6)):
    hands[name] = [card('back') for _ in range(n)]
mine = [card(f) for f in ('red-5', 'yellow-reverse', 'green-draw2', 'wild-wild4', 'blue-7', 'yellow-9', 'red-purge')]
flyers = {'d4a': card('wild-wild4'), 'd4b': card('wild-wild4'), 'rug': card('wild-wild10'), 'last': card('blue-9')}
stream = [card('back') for _ in range(10)]

# Fire round the last card: camera-facing sprites playing a looping flame animation
# (flames.py renders the frames into tex/flames), and an orange light.
FLAME_DIR = os.path.abspath(os.path.join(film.OUT_ROOT, '..', 'tex', 'flames'))
flame_imgs = [bpy.data.images.load(os.path.join(FLAME_DIR, f'flame-{k:02d}.png'), check_existing=True) for k in range(24)]
# (x across the card, root height from the card's centre, depth toward the camera, height, frame phase)
FLAME_LAYOUT = [(-0.25, 0.1, -0.08, 2.3, 0), (0.27, 0.05, -0.1, 2.1, 11), (0.0, 0.3, -0.06, 2.5, 5),
                (-0.36, 0.42, 0.04, 1.35, 17), (0.04, 0.48, 0.05, 1.5, 8), (0.38, 0.4, 0.04, 1.3, 20),
                (-0.2, 0.62, 0.06, 1.0, 22), (0.22, 0.64, 0.06, 1.05, 2),
                (-0.58, 0.0, 0.02, 0.95, 3), (0.59, 0.05, 0.02, 0.9, 14)]
flames = []
for k, lay in enumerate(FLAME_LAYOUT):
    bpy.ops.mesh.primitive_plane_add(size=1)
    f = bpy.context.active_object
    f.scale = (0.8, 1.0, 1.0)
    bpy.ops.object.transform_apply(scale=True)
    for v in f.data.vertices:
        v.co.y += 0.5                      # root at the origin, the flame rising along +Y
    m = bpy.data.materials.new(f'Flame{k}')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = flame_imgs[0]
    tex.extension = 'CLIP'
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 3.2
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(tex.outputs['Alpha'], mix.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    f.data.materials.append(m)
    f.visible_shadow = False
    f.visible_glossy = False
    flames.append((f, tex, lay))
fl = bpy.data.lights.new('FireLight', 'POINT')
fl.energy = 0
fl.color = (1.0, 0.55, 0.2)
fl.shadow_soft_size = 0.3
fire_light = bpy.data.objects.new('FireLight', fl)
film.blib.link(fire_light)

cam = film.camera(lens=32)
HIDE = (0, -30, 0)
for f, tex, lay in flames:
    c = f.constraints.new('TRACK_TO')
    c.target = cam
    c.track_axis = 'TRACK_Z'
    c.up_axis = 'UP_Y'



def seat_xyz(name, fwd=0.0, side=0.0, up=0.0):
    sx, sz = SEATS[name]
    r = math.radians(YAW[name])
    fx, fz = math.sin(r), math.cos(r)        # facing direction
    rx, rz = fz, -fx                         # its right
    return (sx + fx * fwd + rx * side, FELT_Y + up, sz + fz * fwd + rz * side)


def fan(cards, name, spread=0.16, open_k=1.0, lift=0.0):
    """A hand of backs held up in front of a Chog, fanned toward the table."""
    n = len(cards)
    r = math.radians(YAW[name])
    for i, c in enumerate(cards):
        a = (i - (n - 1) / 2) * spread * open_k
        p = seat_xyz(name, fwd=1.0, side=0.55 + a * 1.6, up=0.62 + lift - abs(a) * 0.2)
        put_card(c, p, (math.pi / 2 - 0.45, r + math.pi, -a * 1.4), 0.8)


def fly(c, frm, to, t, t0, t1, arc=1.6, spin=2 * math.pi, face_up=True, slam=True):
    """A card flying along an arc from frm to to (game xyz), landing flat with a slam."""
    u = seg(t, t0, t1)
    if t < t0:
        put_card(c, HIDE, (0, 0, 0))
        return 0.0
    k = smooth(u) if not slam else 1 - (1 - u) ** 2.2
    p = Vector(frm).lerp(Vector(to), k)
    p.y += arc * math.sin(math.pi * u)
    pitch = lerp(-0.9, 0.0, k) if face_up else math.pi
    yaw = spin * (1 - k)
    put_card(c, tuple(p), (pitch, yaw, 0.0))
    return u


def frame(t):
    # Opponents: idle sway, hands held up; reactions by beat.
    for name, ch in chogs.items():
        q = film.rest()
        q['rot'][2] = 0.03 * math.sin(2 * math.pi * 0.6 * t + hash(name) % 7)
        for i, side in enumerate((1, -1)):
            q['hands'][i] = [side * 0.05, 0.2, 0.12, 0.6, side * 0.4]
        if name == 'left' and 1.55 < t < 1.95:
            k = math.sin(math.pi * seg(t, 1.55, 1.95))
            q['hands'][1] = [-0.1, 0.32, 0.18, -0.5, -0.5]
            q['rot'][0] = 0.15 * k
        if name == 'far':
            wince = math.sin(math.pi * seg(t, 2.0, 2.55))
            q['head'] = [-0.3 * wince, 0, 0.1 * wince]
            q['squash'] = 1 - 0.08 * wince
            if 2.75 < t < 3.15:
                q['hands'][1] = [-0.1, 0.32, 0.18, -0.5, -0.5]
            if t > 5.0:
                up = ease_out(seg(t, 5.0, 5.35))
                q['hands'][1] = [-0.06, lerp(0.2, 0.42, up), lerp(0.12, 0.08, up), -0.2 * up, -0.2]
                q['head'] = [-0.2 * up, 0, 0]
                q['squash'] = 1.0 + 0.04 * up
        if name == 'right' and t > 4.1:
            shock = ease_out(seg(t, 4.1, 4.35))
            q['head'] = [-0.25 * shock, 0.15 * math.sin(2 * math.pi * 3 * t) * shock, 0]
            for i, side in enumerate((1, -1)):
                q['hands'][i] = [side * 0.16 * shock + side * 0.05 * (1 - shock), 0.2 + 0.12 * shock, 0.12, 0.6, side * (0.4 + 0.6 * shock)]
            q['lids'] = 0.0
        ch.pose(q, seat_xyz(name), YAW[name])
    fan(hands['left'], 'left')
    held = hands['far'] if t < 3.0 else hands['far'][:1] if t < 5.0 else []
    fan(held, 'far')
    for c in hands['far'][len(held):]:
        put_card(c, HIDE, (0, 0, 0))
    fan(hands['right'], 'right', open_k=1.0 + 0.6 * ease_out(seg(t, 4.2, 4.9)))

    # My hand: rises into a fan in front of the camera, then drops away as the camera leaves.
    rise = ease_out(seg(t, 0.1, 0.9)) * (1 - smooth(seg(t, 1.55, 1.85)))
    n = len(mine)
    spread = smooth(seg(t, 0.35, 1.15))
    for i, c in enumerate(mine):
        j = i - (n - 1) / 2
        p = (j * 0.22 * spread, lerp(-0.4, 0.78, rise) - abs(j) * 0.035 * spread, 6.1 + 0.012 * i)
        put_card(c, p, (math.pi / 2 - 0.3, 0.0, -j * 0.12 * spread), 0.4)

    # The slams onto the discard pile, each a little higher on the stack.
    top = TOP0
    fly(flyers['d4a'], seat_xyz('left', fwd=1.4, up=1.4), (DISCARD[0], top, DISCARD[1]), t, 1.65, 2.0, arc=0.8)
    top += 0.012
    fly(flyers['d4b'], seat_xyz('far', fwd=1.4, up=1.4), (DISCARD[0] + 0.08, top, DISCARD[1] - 0.05), t, 2.85, 3.2, arc=0.9, spin=-2 * math.pi)
    top += 0.012
    fly(flyers['rug'], seat_xyz('far', fwd=1.4, up=1.4), (DISCARD[0] - 0.05, top, DISCARD[1] + 0.06), t, 3.85, 4.15, arc=1.0, spin=3 * math.pi)
    # A jolt of the whole pile on each slam.
    jolt = sum(0.04 * max(0.0, damped(t - a, 4.0, 10.0)) for a in (2.0, 3.2, 4.15))
    for k, c in enumerate(discard):
        c.location.z = V(0, FELT_Y + 0.006 + 0.012 * k + jolt * (k + 1) / 3, 0).z
    # Ten cards stream from the draw pile to the right-hand Chog.
    for k, c in enumerate(stream):
        t0 = 4.25 + 0.06 * k
        u = seg(t, t0, t0 + 0.35)
        if u <= 0 or u >= 1:
            put_card(c, HIDE, (0, 0, 0))
            continue
        frm = Vector((PILE[0], FELT_Y + 0.2, PILE[1]))
        to = Vector(seat_xyz('right', fwd=1.2, up=1.2))
        p = frm.lerp(to, smooth(u))
        p.y += 1.0 * math.sin(math.pi * u)
        put_card(c, tuple(p), (math.pi - 2.5 * u, 4 * u + k, 0.4 * k))

    # The last card held up, on fire.
    if t > 5.0:
        hand = Vector(seat_xyz('far', fwd=0.55, side=-0.45, up=lerp(0.8, 1.7, ease_out(seg(t, 5.0, 5.35)))))
        put_card(flyers['last'], tuple(hand), (math.pi / 2 - 0.15, 0.0, 0.08 * math.sin(2 * math.pi * 1.5 * t)), 1.05)
        burn = ease_out(seg(t, 5.3, 5.7))
        fi = int(round(t * 24))
        for k, (f, tex, (x, y, z, hgt, ph)) in enumerate(flames):
            grow = ease_out(seg(t, 5.3 + 0.04 * k, 5.75 + 0.04 * k))
            flick = 1.0 + 0.08 * math.sin(2 * math.pi * (1.7 + 0.3 * k) * t + k)
            f.location = V(hand.x + x * 1.05, hand.y + y * 1.05 - 0.15, hand.z + z)
            sz = max(grow * hgt * 0.75 * flick, 0.001)
            f.scale = (sz, sz, sz)
            tex.image = flame_imgs[(fi + ph) % len(flame_imgs)]
        fire_light.location = V(hand.x, hand.y + 0.4, hand.z + 0.4)
        fl.energy = 1500 * burn * (0.85 + 0.15 * math.sin(2 * math.pi * 9 * t))
    else:
        put_card(flyers['last'], HIDE, (0, 0, 0))
        for f, tex, lay in flames:
            f.location = V(*HIDE)
        fl.energy = 0

    # Camera.
    if t < 1.6:
        k = smooth(seg(t, 0.0, 1.6))
        film.place_camera(cam, (0.0, 1.55, 7.4), (0.0, lerp(1.0, 0.5, k), 3.0), lens=30, dof=(2.2, 2.0))
    elif t < 2.7:
        k = smoother(seg(t, 1.6, 1.85))
        film.place_camera(cam, lerpv((0.0, 1.55, 7.4), (3.2, 1.3, 3.6), k), lerpv((0.0, 0.5, 3.0), (DISCARD[0], FELT_Y, DISCARD[1]), k), lens=34,
                          dof=(math.dist((3.2, 1.3, 3.6), (DISCARD[0], FELT_Y, DISCARD[1])), 2.8))
    elif t < 3.9:
        k = smoother(seg(t, 2.7, 2.95))
        far = seat_xyz('far', up=2.2)
        film.place_camera(cam, lerpv((3.2, 1.3, 3.6), (1.8, 1.9, 0.6), k), lerpv((DISCARD[0], FELT_Y, DISCARD[1]), far, smooth(seg(t, 2.7, 2.95)) * (1 - smooth(seg(t, 3.1, 3.3)))), lens=34)
    elif t < 5.0:
        k = smoother(seg(t, 3.9, 4.15))
        right = seat_xyz('right', up=2.0)
        film.place_camera(cam, lerpv((1.8, 1.9, 0.6), (-0.5, 1.6, 2.6), k), lerpv((DISCARD[0], FELT_Y, DISCARD[1]), right, smooth(seg(t, 4.2, 4.6))), lens=lerp(34, 28, k))
    else:
        k = smoother(seg(t, 5.0, 7.0))
        far = Vector(seat_xyz('far', up=1.9))
        film.place_camera(cam, lerpv((0.9, 2.3, 1.2), (0.45, 2.1, -1.0), k), tuple(far), lens=lerp(30, 34, k),
                          dof=(math.dist(lerpv((0.9, 2.3, 1.2), (0.45, 2.1, -1.0), k), tuple(far)), 2.4))


film.render(SHOT, DUR, frame)
