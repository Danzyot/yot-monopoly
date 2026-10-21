"""Cards, chips and felts for the card-table shots (the Cards and Poker games at their own scale)."""

import os

import bpy
from mathutils import Euler

import film
from film import V

FELT_Y = -0.25
TEX = os.path.abspath(os.path.join(film.OUT_ROOT, '..', 'tex'))
_mats = {}


def card_mat(face, deck):
    """Face on the front, the deck's back on the back, both cut out by the PNG's alpha."""
    key = (deck, face)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(f'card-{deck}-{face}')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    fimg = nt.nodes.new('ShaderNodeTexImage')
    fimg.image = bpy.data.images.load(os.path.join(TEX, deck, f'{face}.png'), check_existing=True)
    bimg = nt.nodes.new('ShaderNodeTexImage')
    bimg.image = bpy.data.images.load(os.path.join(TEX, deck, 'back.png'), check_existing=True)
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
    _mats[key] = m
    return m


def card(face, deck):
    bpy.ops.mesh.primitive_plane_add(size=1)
    ob = bpy.context.active_object
    ob.scale = (1.0, 1.5, 1)
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(card_mat(face, deck))
    return ob


def put(ob, pos, rot, s=1.0):
    ob.location = V(*pos)
    ob.rotation_euler = Euler(rot, 'ZXY')
    ob.scale = (s, s, s)


def felt(color, trim):
    """The round felt the card games play on, with its gold rail."""
    bpy.ops.mesh.primitive_circle_add(radius=7.2, vertices=96, fill_type='NGON', location=V(0, FELT_Y, 0))
    f = bpy.context.active_object
    fm = film.principled(f'Felt{color}', color, rough=0.92)
    fm.node_tree.nodes['Principled BSDF'].inputs['Sheen Weight'].default_value = 0.25
    f.data.materials.append(fm)
    bpy.ops.mesh.primitive_torus_add(major_radius=7.34, minor_radius=0.12, location=V(0, FELT_Y + 0.02, 0))
    r = bpy.context.active_object
    r.data.materials.append(trim)
    r.parent = f
    r.matrix_parent_inverse = f.matrix_world.inverted()
    return f


CHIP_COLS = ['#e9508f', '#6b3fd1', '#fdf6cd', '#3b8cff', '#2fae6b']
_chips = {}


def _chip(c):
    if c not in _chips:
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
        _chips[c] = ob
    return _chips[c]


def stack(n, col, rnd):
    """A stack of n chips (every fourth one the next colour), its origin at the bottom."""
    root = bpy.data.objects.new('Stack', None)
    film.blib.link(root)
    for k in range(n):
        src = _chip(col if k % 4 else CHIP_COLS[(CHIP_COLS.index(col) + 1) % len(CHIP_COLS)])
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
