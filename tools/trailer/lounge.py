"""The Chog lounge as a film set: the game's baked room, its table, the board,
dice, houses, cops and Chogs, all at the game's own scale (the board is 11
wide at y = 0, the table top at y = -0.28).

The room is the shipped model (client/public/models/chog/room.glb, decoded by
unpack-glb.mjs) shaded with its baked lightmap as emission, so it renders as
lit as it looks in the game at almost no cost; everything that moves is real
geometry lit by a few area lights placed where the room's lamps are.
"""

import math
import os
import random
import subprocess

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

import film
from film import V
import props
import cops
import table

REPO = film.blib.REPO
SCRATCH = os.environ.get('TRAILER_CACHE', os.path.join(film.OUT_ROOT, 'cache'))
FIG = 1.35            # figure scale on the board (Pieces.tsx figureScale for a small table)
BUILD = 1.25          # houses and hotels
T = (11 - 3) / 9      # an edge tile's width on a 40-space board
CORNER = 1.5


def unpacked(rel):
    """A shipped GLB with its meshopt compression undone (cached)."""
    os.makedirs(SCRATCH, exist_ok=True)
    out = os.path.join(SCRATCH, rel.replace('/', '-'))
    if not os.path.exists(out):
        subprocess.run(['node', os.path.join(REPO, 'tools', 'trailer', 'unpack-glb.mjs'),
                        os.path.join(REPO, 'client', 'public', 'models', rel), out], check=True)
    return out


def room(name='chog', exposure=2.6):
    """The baked room: base colour x lightmap as emission, the material's gloss kept on top."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=unpacked(f'{name}/room.glb'))
    objs = [o for o in bpy.data.objects if o not in before]
    lm = bpy.data.images.load(os.path.join(REPO, 'client', 'public', 'models', name, 'room-light.webp'))
    done = set()
    for o in objs:
        if o.type != 'MESH':
            continue
        o.visible_shadow = False
        if len(o.data.uv_layers) < 2:
            continue
        for m in o.data.materials:
            if not m or m.name in done:
                continue
            done.add(m.name)
            nt = m.node_tree
            bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            outn = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
            if not bsdf or not outn:
                continue
            uv = nt.nodes.new('ShaderNodeUVMap')
            uv.uv_map = o.data.uv_layers[1].name
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = lm
            nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            base = bsdf.inputs['Base Color']
            if base.links:
                nt.links.new(base.links[0].from_socket, mul.inputs['A'])
                nt.links.remove(base.links[0])
            else:
                mul.inputs['A'].default_value = base.default_value
            nt.links.new(tex.outputs['Color'], mul.inputs['B'])
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Strength'].default_value = exposure
            nt.links.new(mul.outputs['Result'], em.inputs['Color'])
            # The material's own emission (neon, lamps) stays as it was.
            own = bsdf.inputs['Emission Strength'].default_value
            add = nt.nodes.new('ShaderNodeAddShader')
            nt.links.new(em.outputs['Emission'], add.inputs[0])
            bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
            bsdf.inputs['Emission Strength'].default_value = own * 1.5
            nt.links.new(bsdf.outputs['BSDF'], add.inputs[1])
            nt.links.new(add.outputs['Shader'], outn.inputs['Surface'])
    return objs


def board(map_id='classic', tex_dir=None):
    """The table and the board slab, its top painted with the board texture (boardTexture.ts at 4096 px)."""
    finish = film.principled('TableFinish', '#2a1650', rough=0.28, coat=0.6)
    trim = film.principled('TableTrim', '#d8a64a', rough=0.3, metal=1.0)
    objs = table.build(finish, trim)
    tex_dir = tex_dir or os.path.join(film.OUT_ROOT, '..', 'tex')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 11
        v.co.y *= 11
        v.co.z = (v.co.z + 0.5) * table.BOARD_THICK - table.BOARD_THICK
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = ((l.vert.co.x + 5.5) / 11, (l.vert.co.y + 5.5) / 11)
    me = bpy.data.meshes.new('Board')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('Board', me)
    film.blib.link(ob)
    top = bpy.data.materials.new('BoardTop')
    top.use_nodes = True
    nt = top.node_tree
    b = nt.nodes['Principled BSDF']
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(os.path.abspath(os.path.join(tex_dir, f'board-{map_id}.png')))
    img.interpolation = 'Cubic'
    nt.links.new(img.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.42
    b.inputs['Coat Weight'].default_value = 0.25
    side = film.principled('BoardSide', '#1d0f3a', rough=0.35, coat=0.4)
    me.materials.append(top)
    me.materials.append(side)
    for p in me.polygons:
        p.material_index = 0 if p.normal.z > 0.5 else 1
    objs.append(ob)
    return objs


def lights():
    """Area lights where the room's lamps are: a warm pool over the table, a cool fill, a pink rim from the neon wall."""
    film.area_light('TablePool', V(0, 9.0, 1.0), V(0, 0, 0), 2600, 7.0, (1.0, 0.86, 0.7))
    film.area_light('Fill', V(9, 4.5, 10), V(0, 0.5, 0), 900, 6.0, (0.7, 0.72, 1.0))
    film.area_light('Rim', V(-3, 5.0, -12), V(0, 0.5, 0), 1600, 6.0, (1.0, 0.45, 0.8))
    for n in ('TablePool', 'Fill', 'Rim'):
        bpy.data.objects[n].visible_glossy = False


# ---- the board's geometry (shared/layout.ts for a 40-space board) ------------------------

def tile(i):
    """Centre of space i on the classic board (game x, z): START bottom right, play runs clockwise."""
    side, k = divmod(i % 40, 10)
    h = 11 / 2
    if k == 0:
        c = [(h - CORNER / 2, h - CORNER / 2), (-h + CORNER / 2, h - CORNER / 2), (-h + CORNER / 2, -h + CORNER / 2), (h - CORNER / 2, -h + CORNER / 2)][side]
        return c
    off = CORNER + (k - 0.5) * T
    d = h - CORNER / 2
    if side == 0:
        return (h - off, d)
    if side == 1:
        return (-d, h - off)
    if side == 2:
        return (-h + off, -d)
    return (d, -h + off)


def outward(i):
    """Unit vector from a space toward the board's outer edge."""
    side = (i % 40) // 10
    return [(0, 1), (-1, 0), (0, -1), (1, 0)][side]


# ---- dice -------------------------------------------------------------------------------

PIPS = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)], 4: [(-1, -1), (-1, 1), (1, -1), (1, 1)],
        5: [(-1, -1), (-1, 1), (0, 0), (1, -1), (1, 1)], 6: [(-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)]}


def die(name, top=6, size=0.5):
    """A rounded white die with sunk pips; `top` faces up (+game y) at rest. Origin at its centre."""
    body = film.principled(f'{name}Body', '#fbf6ee', rough=0.25, coat=0.5)
    pipm = film.principled(f'{name}Pip', '#2a1650', rough=0.4)
    bpy.ops.mesh.primitive_cube_add(size=size)
    d = bpy.context.active_object
    d.name = name
    bev = d.modifiers.new('Bevel', 'BEVEL')
    bev.width = 0.085 * size / 0.5
    bev.segments = 5
    d.data.materials.append(body)
    for p in d.data.polygons:
        p.use_smooth = True
    # Faces in Blender axes: +Z is up at rest. Opposite faces sum to 7.
    others = [v for v in (1, 2, 3, 4, 5, 6) if v not in (top, 7 - top)]
    faces = {(0, 0, 1): top, (0, 0, -1): 7 - top, (1, 0, 0): others[0], (-1, 0, 0): 7 - others[0]}
    rest = [v for v in others if v not in (others[0], 7 - others[0])]
    faces[(0, 1, 0)] = rest[0]
    faces[(0, -1, 0)] = 7 - rest[0]
    r = size * 0.085
    sp = size * 0.24
    for n, val in faces.items():
        n = Vector(n)
        a = Vector((1, 0, 0)) if abs(n.x) < 0.5 else Vector((0, 1, 0))
        b = n.cross(a)
        for u, v in PIPS[val]:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=16, ring_count=8)
            p = bpy.context.active_object
            p.scale = (1, 1, 0.45) if n.z else (1, 0.45, 1) if n.y else (0.45, 1, 1)
            p.location = n * (size / 2 - r * 0.2) + a * u * sp + b * v * sp
            p.data.materials.append(pipm)
            p.parent = d
    return d


def set_die(d, pos_game, rot):
    d.location = V(*pos_game)
    d.rotation_euler = rot


# ---- buildings -------------------------------------------------------------------------

def building(kind, color='#1f9d49'):
    body = props.material(f'{kind}Body', color, 0.45)
    roof = props.material(f'{kind}Roof', '#16753a' if color == '#1f9d49' else color, 0.6)
    trim = props.material(f'{kind}Trim', '#f5f1e6', 0.5)
    glass = props.material(f'{kind}Glass', '#fff1b8', 0.2)
    parts = (props.build_house if kind == 'house' else props.build_hotel)(body, roof, trim, glass)
    root = bpy.data.objects.new(kind.title(), None)
    film.blib.link(root)
    for p in parts:
        p.parent = root
    return root


def place(ob, pos_game, yaw_deg=0.0, scale=1.0, squash=1.0):
    ob.location = V(*pos_game)
    ob.rotation_euler = (0, 0, math.radians(yaw_deg))
    s = scale
    ob.scale = (s / math.sqrt(squash), s / math.sqrt(squash), s * squash)


# ---- the cops ---------------------------------------------------------------------------

def cop_kit():
    m = cops.materials()
    parts = {
        'car': cops.car(m), 'sirenR': cops.siren(m, 'Red', -0.055), 'sirenB': cops.siren(m, 'Blue', 0.055),
    }
    kit = {}
    for k, objs in parts.items():
        objs = objs if isinstance(objs, list) else [objs]
        root = bpy.data.objects.new(k, None)
        film.blib.link(root)
        for o in objs:
            o.parent = root
        kit[k] = root
    wheels = []
    for i in range(4):
        objs = cops.wheel(m)
        objs = objs if isinstance(objs, list) else [objs]
        root = bpy.data.objects.new(f'wheel{i}', None)
        film.blib.link(root)
        for o in objs:
            o.parent = root
        wheels.append(root)
    kit['wheels'] = wheels
    copsets = []
    for kind in ('A', 'B'):
        c = {}
        for k, fn in (('body', lambda: cops.cop_body(m)), ('head', lambda: cops.cop_head(m, kind)),
                      ('handL', lambda: cops.mitten('Cop', 'HandL', m, 'white', 1)),
                      ('handR', lambda: cops.mitten('Cop', 'HandR', m, 'white', -1)),
                      ('footL', lambda: cops.cop_foot(m, 1)), ('footR', lambda: cops.cop_foot(m, -1))):
            objs = fn()
            objs = objs if isinstance(objs, list) else [objs]
            root = bpy.data.objects.new(f'cop{kind}{k}', None)
            film.blib.link(root)
            for o in objs:
                o.parent = root
            c[k] = root
        copsets.append(c)
    kit['cops'] = copsets
    return kit


# ---- more Chogs --------------------------------------------------------------------------

def clone_chog(src, shoe=None, scale=FIG):
    """Another Chog sharing the source's meshes, its shoes recoloured."""
    c = film.Chog.__new__(film.Chog)
    c.nodes = {}
    for part, n in src.nodes.items():
        k = n.copy()
        film.blib.link(k)
        c.nodes[part] = k
    c.mats = dict(src.mats)
    c.scale = scale
    c.temp = []
    if shoe:
        m = src.mats['main'].copy()
        m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*film.blib.hex_rgb(shoe), 1)
        for part in ('FootL', 'FootR'):
            ob = c.nodes[part]
            ob.data = ob.data.copy()
            for i, slot in enumerate(ob.data.materials):
                if slot == src.mats['main']:
                    ob.data.materials[i] = m
    return c
