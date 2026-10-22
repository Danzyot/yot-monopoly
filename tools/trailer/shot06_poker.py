"""Shot 6 (3D part), Chog Poker in the lounge, staged like the Cards shot: Chogs at
the Cards game's scale round a felt, with chip stacks and a board of five cards.

  0.0-1.2  low across the felt: the Chog on the left lifts the corner of its two cards and peeks.
  1.2-2.0  the Chog on the right pushes a stack into the pot.
  2.0-2.8  the dealer across the table turns the river.
  2.8-4.0  the right-hand Chog throws its hands up and the pot slides over to it.
"""

import math
import os
import random

import bpy
from mathutils import Euler, Vector

import film
from film import V, lerp, lerpv, seg, smooth, smoother, ease_out, damped, clamp
import lounge

SHOT = 'shot06'
DUR = 4.0
FIG = 3.9
FELT_Y = -0.25
SEAT_R = 5.7
TEX = os.path.abspath(os.path.join(film.OUT_ROOT, '..', 'tex', 'poker'))

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
fm = film.principled('Felt', '#145a4a', rough=0.92)
fm.node_tree.nodes['Principled BSDF'].inputs['Sheen Weight'].default_value = 0.25
felt.data.materials.append(fm)
bpy.ops.mesh.primitive_torus_add(major_radius=7.34, minor_radius=0.12, location=V(0, FELT_Y + 0.02, 0))
bpy.context.active_object.data.materials.append(trim)
film.area_light('TablePool', V(0, 9.0, 1.0), V(0, 0, 0), 1000, 7.0, (1.0, 0.86, 0.7))
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
    ob.scale = (1.0, 1.5, 1)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(card_mat(face))
    return ob


def put(ob, pos, rot, s=1.0):
    ob.location = V(*pos)
    ob.rotation_euler = Euler(rot, 'ZXY')
    ob.scale = (s, s, s)


# Chips: linked copies of one chip per colour, in stacks that can slide.
CHIP_COLS = ['#e9508f', '#6b3fd1', '#fdf6cd', '#3b8cff', '#1d1238']
chip_proto = {}
for c in CHIP_COLS:
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.3, depth=0.07)
    ob = bpy.context.active_object
    bev = ob.modifiers.new('B', 'BEVEL')
    bev.width = 0.015
    bev.segments = 2
    ob.data.materials.append(film.principled(f'chip{c}', c, rough=0.35, coat=0.4))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.25, minor_radius=0.012)
    ring = bpy.context.active_object
    ring.data.materials.append(film.principled(f'ring{c}', '#ffffff' if c != '#fdf6cd' else '#e9508f', rough=0.4))
    ring.parent = ob
    ring.location = (0, 0, 0.036)
    ob.location = V(0, -30, 0)
    chip_proto[c] = ob


def stack(n, col, rnd):
    root = bpy.data.objects.new('Stack', None)
    film.blib.link(root)
    for k in range(n):
        src = chip_proto[col if k % 4 else CHIP_COLS[(CHIP_COLS.index(col) + 1) % len(CHIP_COLS)]]
        c = src.copy()
        film.blib.link(c)
        for ch in src.children:
            cc = ch.copy()
            film.blib.link(cc)
            cc.parent = c
        c.parent = root
        c.location = (rnd.uniform(-0.015, 0.015), rnd.uniform(-0.015, 0.015), 0.035 + 0.072 * k)
        c.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
    return root


rnd = random.Random(11)
SEATS = {'left': (-SEAT_R, 0.0), 'far': (0.0, -SEAT_R), 'right': (SEAT_R, 0.0)}
YAW = {'left': 90.0, 'far': 0.0, 'right': -90.0}


def seat_xyz(name, fwd=0.0, side=0.0, up=0.0):
    sx, sz = SEATS[name]
    r = math.radians(YAW[name])
    fx, fz = math.sin(r), math.cos(r)
    rx, rz = fz, -fx
    return (sx + fx * fwd + rx * side, FELT_Y + up, sz + fz * fwd + rz * side)


stacks = {}
for name, cols in (('left', ('#e9508f', '#6b3fd1', '#3b8cff')), ('right', ('#fdf6cd', '#e9508f', '#6b3fd1')), ('far', ('#3b8cff', '#fdf6cd'))):
    for k, c in enumerate(cols):
        s = stack(rnd.randint(5, 9), c, rnd)
        # The left seat's stacks sit off to its side so they don't hide the peek.
        side = 1.0 + 0.66 * k if name == 'left' else -0.8 + 0.72 * k
        s.location = V(*seat_xyz(name, fwd=1.7, side=side))
        stacks[(name, k)] = s
pot = []
for k in range(5):
    s = stack(rnd.randint(3, 7), CHIP_COLS[k], rnd)
    pot.append((s, (rnd.uniform(-0.9, 0.9), rnd.uniform(0.9, 1.5))))
push = stack(8, '#e9508f', rnd)

board = [card(f) for f in ('As', 'Kh', 'Qs', 'Jh', '10d')]
holes = [card('7c'), card('9d')]
proto = film.Chog(scale=FIG)
chogs = {'left': proto, 'far': lounge.clone_chog(proto, shoe='#3b8cff', scale=FIG), 'right': lounge.clone_chog(proto, shoe='#ffd23f', scale=FIG)}
cam = film.camera(lens=32)


def frame(t):
    # The board: four cards up, the river turning over at 2.0-2.5.
    for k, c in enumerate(board):
        x = -2.4 + 1.2 * k
        if k < 4:
            put(c, (x, FELT_Y + 0.006, -0.3), (0, 0, 0))
        else:
            f = smoother(seg(t, 2.05, 2.5))
            lift = 0.5 * math.sin(math.pi * f)
            put(c, (x, FELT_Y + 0.006 + lift, -0.3), (math.pi * (1 - f), 0, 0))
    # The left Chog's two cards: the corners lift as it peeks.
    peek = math.sin(math.pi * seg(t, 0.35, 1.25))
    for k, c in enumerate(holes):
        p = seat_xyz('left', fwd=1.5, side=-0.35 + 0.7 * k)
        put(c, (p[0], FELT_Y + 0.008 + 0.12 * peek, p[2]), (math.pi - 0.5 * peek, 0.0, math.radians(90) + 0.12 * (k - 0.5)))
    # The push: a stack slides from the right Chog into the pot.
    pk = smoother(seg(t, 1.3, 1.85))
    a = Vector(seat_xyz('right', fwd=1.4, side=0.2))
    b = Vector((0.9, FELT_Y, 1.3))
    pp = a.lerp(b, pk)
    push.location = V(pp.x, pp.y, pp.z)
    # The pot, then sliding to the winner.
    win = smoother(seg(t, 3.2, 3.95))
    dest = Vector(seat_xyz('right', fwd=1.9))
    for s, (x, z) in pot:
        p = Vector((x, FELT_Y, z)).lerp(dest + Vector((x * 0.3, 0, (z - 1.2) * 0.3)), win)
        s.location = V(p.x, p.y, p.z)
    if win > 0:
        p = Vector((pp.x, pp.y, pp.z)).lerp(dest, win)
        push.location = V(p.x, p.y, p.z)

    for name, ch in chogs.items():
        q = film.rest()
        q['rot'][2] = 0.03 * math.sin(2 * math.pi * 0.6 * t + hash(name) % 7)
        if name == 'left':
            q['head'] = [0.25 + 0.15 * peek, 0.0, 0.08 * peek]
            for i, side in enumerate((1, -1)):
                q['hands'][i] = [side * 0.07, 0.11, 0.19, 0.4, side * 0.4]
            q['lids'] = 0.35 * peek
        if name == 'right':
            pushing = math.sin(math.pi * seg(t, 1.2, 1.95))
            q['hands'][0] = [0.08, 0.1 + 0.03 * pushing, 0.12 + 0.12 * pushing, 0.4, 0.4]
            q['rot'][0] = 0.12 * pushing
            if t > 2.85:
                up = ease_out(seg(t, 2.85, 3.15))
                bounce = 0.04 * abs(math.sin(2 * math.pi * 2.5 * (t - 2.85)))
                for i, side in enumerate((1, -1)):
                    q['hands'][i] = [side * lerp(0.11, 0.17, up), lerp(0.115, 0.4, up), 0.03, 0, side * 0.9 * up]
                q['pos'][1] = bounce * up
                q['squash'] = 1 + 0.05 * up
                q['head'] = [-0.2 * up, 0, 0]
        if name == 'far':
            reach = math.sin(math.pi * seg(t, 1.85, 2.6))
            q['hands'][1] = [-0.08, 0.1 + 0.05 * reach, 0.12 + 0.18 * reach, 0.6 * reach, -0.3]
            q['rot'][0] = 0.15 * reach
        ch.pose(q, seat_xyz(name), YAW[name])

    if t < 1.2:
        k = smooth(seg(t, 0.0, 1.2))
        focus = seat_xyz('left', fwd=1.5)
        film.place_camera(cam, lerpv((-2.2, 0.75, 2.6), (-2.0, 0.85, 2.2), k), lerpv(seat_xyz('left', fwd=0.8, up=1.2), seat_xyz('left', fwd=1.3, up=0.9), k), lens=29,
                          dof=(math.dist((-2.1, 0.8, 2.4), focus), 2.6))
    elif t < 2.0:
        k = smoother(seg(t, 1.2, 1.45))
        film.place_camera(cam, lerpv((-2.0, 0.85, 2.2), (2.6, 1.1, 3.6), k), lerpv(seat_xyz('left', fwd=1.3, up=0.9), (1.6, FELT_Y, 1.0), k), lens=34)
    elif t < 2.8:
        k = smoother(seg(t, 2.0, 2.2))
        film.place_camera(cam, lerpv((2.6, 1.1, 3.6), (1.9, 1.2, 1.8), k), lerpv((1.6, FELT_Y, 1.0), (2.4, FELT_Y + 0.2, -0.3), k), lens=40,
                          dof=(math.dist((1.9, 1.2, 1.8), (2.4, FELT_Y, -0.3)), 2.8))
    else:
        k = smoother(seg(t, 2.8, 4.0))
        film.place_camera(cam, lerpv((-0.6, 2.3, 3.4), (-0.2, 2.1, 2.4), k), seat_xyz('right', fwd=0.8, up=1.2), lens=lerp(28, 32, k))


film.render(SHOT, DUR, frame)
