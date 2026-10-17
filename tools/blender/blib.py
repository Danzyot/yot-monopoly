"""Shared helpers for the headless Blender build scripts.

Every asset in client/public/models is produced by a script in this folder,
run through `tools/blender/run.sh <script>.py` with Blender's Python module
(bpy) — no Blender window, no hand edits, so any asset can be rebuilt or
changed by editing code.

Conventions
- Positions are written in the game's (three.js) frame: x right, y up, z toward
  the default camera. `V()` converts to Blender's Z-up frame; the glTF export
  converts back, so numbers in the scripts match numbers in BoardScene.
- Materials are authored normally; `flatten_colors()` then folds every plain
  colour into a vertex-colour attribute so a whole room can be one draw call.
- Lighting is baked (Cycles) into one lightmap per room on a second UV set
  (TEXCOORD_1); the client multiplies it over the albedo with an unlit
  material, so the room costs no live lights at all.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time

import bpy  # must come before bmesh / mathutils
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PUBLIC = os.path.join(REPO, 'client', 'public')
MANIFEST = os.path.join(HERE, 'manifest.json')
ASSETS_TS = os.path.join(REPO, 'client', 'src', 'three', 'assets.gen.ts')


def log(*a):
    print('[blender]', *a, flush=True)


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.view_settings.view_transform = 'Standard'
    return sc


def V(x: float, y: float, z: float) -> Vector:
    """Game coordinates (y up, z toward camera) -> Blender (z up)."""
    return Vector((x, -z, y))


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_mesh_object(name: str, bm: bmesh.types.BMesh, mat=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    link(obj)
    if mat is not None:
        assign(obj, mat)
    return obj


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def place(obj, pos=(0, 0, 0), rot_y=0.0, rot=None, scale=None):
    """Put an object at a game-space position, turned rot_y radians about the game's up axis."""
    obj.location = V(*pos)
    if rot is not None:
        obj.rotation_euler = rot
    else:
        obj.rotation_euler = (0, 0, rot_y)
    if scale is not None:
        obj.scale = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    return obj


def parent(child, par):
    child.parent = par
    return child


def empty(name, pos=(0, 0, 0), rot_y=0.0):
    e = bpy.data.objects.new(name, None)
    link(e)
    place(e, pos, rot_y)
    return e


def add_bevel(obj, width=0.05, segments=3, limit='ANGLE', angle=40):
    m = obj.modifiers.new('Bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = limit
    if limit == 'ANGLE':
        m.angle_limit = math.radians(angle)
    m.harden_normals = False
    return obj


def add_subsurf(obj, levels=2):
    m = obj.modifiers.new('Subsurf', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    return obj


def smooth(obj, auto_angle=None):
    obj.data.shade_smooth()
    if auto_angle is not None:
        # Blender 4.1+: "smooth by angle" is a modifier node group; flat-split
        # the hard edges instead so the result survives conversion.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        for e in bm.edges:
            if e.is_manifold and e.calc_face_angle(0) > math.radians(auto_angle):
                e.smooth = False
        bm.to_mesh(obj.data)
        bm.free()
    return obj


# --------------------------------------------------------------------------
# Geometry builders (all sizes in game units; game axes)
# --------------------------------------------------------------------------

def box(name, size, pos=(0, 0, 0), mat=None, rot_y=0.0, bevel=0.0, segments=2, origin='center'):
    """An axis box, size = (w along x, h along y, d along z). origin='bottom' puts pos at the base."""
    w, h, d = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    if origin == 'bottom':
        bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    obj = new_mesh_object(name, bm, mat)
    place(obj, pos, rot_y)
    if bevel > 0:
        add_bevel(obj, bevel, segments)
    return obj


def lathe(name, profile, segs=32, pos=(0, 0, 0), mat=None, cap_top=True, cap_bottom=True, smooth_shade=True,
          hard_angle=50):
    """Revolve a profile [(radius, height), ...] (bottom to top) about the up axis."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            if r <= 1e-5:
                ring = [bm.verts.new((0, 0, y))]
                break
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, y)))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(ra) == 1:
                bm.faces.new((ra[0], rb[i], rb[j]))
            elif len(rb) == 1:
                bm.faces.new((ra[i], ra[j], rb[0]))
            else:
                bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
    if cap_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = new_mesh_object(name, bm, mat)
    if smooth_shade:
        smooth(obj, hard_angle)
    place(obj, pos)
    return obj


def cylinder(name, r, h, pos=(0, 0, 0), mat=None, segs=24, r_top=None, bevel=0.0):
    rt = r if r_top is None else r_top
    obj = lathe(name, [(0, 0), (r, 0), (rt, h), (0, h)], segs, pos, mat, cap_top=False, cap_bottom=False)
    if bevel > 0:
        add_bevel(obj, bevel, 2)
    return obj


def sphere(name, r, pos=(0, 0, 0), mat=None, scale=(1, 1, 1), segs=20, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    obj = new_mesh_object(name, bm, mat, smooth=True)
    place(obj)
    obj.location = V(*pos)
    # game (sx, sy, sz) -> blender (sx, sz, sy)
    obj.scale = (scale[0], scale[2], scale[1])
    return obj


def torus(name, major, minor, pos=(0, 0, 0), mat=None, seg=32, mseg=10):
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(mseg):
            b = 2 * math.pi * j / mseg
            rr = major + minor * math.cos(b)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), minor * math.sin(b))))
        verts.append(ring)
    for i in range(seg):
        for j in range(mseg):
            a, b = verts[i], verts[(i + 1) % seg]
            bm.faces.new((a[j], b[j], b[(j + 1) % mseg], a[(j + 1) % mseg]))
    obj = new_mesh_object(name, bm, mat, smooth=True)
    place(obj, pos)
    return obj


def tube(name, points, radius, mat=None, segs=10, closed=False):
    """A round tube through game-space points (curve with a bevel, converted to mesh)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = max(1, segs // 4)
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, q in zip(sp.points, points):
        v = V(*q)
        p.co = (v.x, v.y, v.z, 1)
    sp.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, cu)
    link(obj)
    if mat is not None:
        cu.materials.append(mat)
    return obj


def plane(name, w, h, pos=(0, 0, 0), mat=None, facing='z', rot_y=0.0):
    """A w×h rectangle. facing='z' stands upright facing +z (a wall/picture); 'y' lies flat facing up."""
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    if facing == 'y':
        coords = [(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0)]
    else:  # upright, normal toward game +z == blender -y
        coords = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    vs = [bm.verts.new(c) for c in coords]
    f = bm.faces.new(vs)
    f.normal_update()
    if facing != 'y' and f.normal.y > 0:
        f.normal_flip()
    uv = bm.loops.layers.uv.new('UVMap')
    for loop, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uv].uv = (u, v)
    obj = new_mesh_object(name, bm, mat)
    place(obj, pos, rot_y)
    return obj


def grid(name, w, d, nx, nz, pos=(0, 0, 0), mat=None, uv_scale=1.0):
    """A flat subdivided floor patch (w along x, d along z), UVs in world units / uv_scale."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    vs = [[bm.verts.new((-w / 2 + w * i / nx, -(-d / 2 + d * j / nz), 0)) for i in range(nx + 1)] for j in range(nz + 1)]
    for j in range(nz):
        for i in range(nx):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            for loop in f.loops:
                co = loop.vert.co
                loop[uv].uv = ((co.x + w / 2) / uv_scale, (-co.y + d / 2) / uv_scale)
    obj = new_mesh_object(name, bm, mat)
    place(obj, pos)
    return obj


def box_uv_world(obj, scale=1.0):
    """Planar world-space UVs per face direction, so tiling textures keep their size on any box."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uvl = me.uv_layers['UVMap'] if 'UVMap' in me.uv_layers else me.uv_layers[0]
    mw = obj.matrix_world
    for poly in me.polygons:
        n = (mw.to_3x3() @ poly.normal)
        ax = max(range(3), key=lambda k: abs(n[k]))
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            uvl.data[li].uv = (u / scale, v / scale)


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def mix_hex(a: str, b: str, t: float) -> str:
    a, b = a.lstrip('#'), b.lstrip('#')
    out = ''
    for i in (0, 2, 4):
        x = int(a[i:i + 2], 16) * (1 - t) + int(b[i:i + 2], 16) * t
        out += f'{int(round(x)):02x}'
    return '#' + out


_mats: dict[str, bpy.types.Material] = {}


def flat(color: str, rough=0.7, metal=0.0, name=None):
    """A plain-colour material (folded into vertex colours before baking)."""
    key = name or f'flat_{color}_{rough}_{metal}'
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hex_rgb(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m['kind'] = 'flat'
    m['color'] = color
    _mats[key] = m
    return m


def image_from_array(name: str, arr: np.ndarray, srgb=True):
    """A packed Blender image from an (H, W, 3|4) array in 0..1, row 0 = top."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    img.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    img.pack()
    return img


def textured(name: str, img, rough=0.8, emissive=0.0):
    """A material showing an image on the 'UVMap' layer. emissive>0 makes it a light source (unlit in game)."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVMap'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    if emissive > 0:
        nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emissive
        m['unlit'] = 1
    m['kind'] = 'textured'
    _mats[name] = m
    return m


def glow(color: str, strength=4.0, name=None):
    """A light-emitting surface (lamp shade, bulb). Unlit in game, a light source in the bake."""
    key = name or f'glow_{color}_{strength}'
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hex_rgb(color), 1)
    b.inputs['Emission Color'].default_value = (*hex_rgb(color), 1)
    b.inputs['Emission Strength'].default_value = strength
    m['unlit'] = 1
    m['kind'] = 'glow'
    _mats[key] = m
    return m


# --------------------------------------------------------------------------
# Finishing: modifiers -> mesh, colours -> vertex colours
# --------------------------------------------------------------------------

def mesh_objects(objs=None):
    return [o for o in (objs if objs is not None else bpy.context.scene.objects) if o.type == 'MESH']


def realize(objs=None):
    """Apply every modifier, convert curves to meshes and bake transforms into the vertices."""
    objs = list(objs if objs is not None else bpy.context.scene.objects)
    bpy.ops.object.select_all(action='DESELECT')
    conv = [o for o in objs if o.type in ('MESH', 'CURVE')]
    for o in conv:
        o.select_set(True)
    bpy.context.view_layer.objects.active = conv[0]
    bpy.ops.object.convert(target='MESH')
    # Children first get their parents' transforms.
    for o in conv:
        if o.parent:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    for o in mesh_objects(objs):
        o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in objs if o.type == 'EMPTY']:
        bpy.data.objects.remove(o)


def flatten_colors(objs, target_name='Flat'):
    """Fold plain-colour materials into a 'Color' vertex attribute and one shared material.

    Returns the shared material. Objects keep textured/glow materials as they are.
    """
    shared = bpy.data.materials.get(target_name)
    if shared is None:
        shared = bpy.data.materials.new(target_name)
        shared.use_nodes = True
        nt = shared.node_tree
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Color'
        nt.links.new(attr.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
        nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
        shared['kind'] = 'flat'
    for o in mesh_objects(objs):
        me = o.data
        if not me.materials or not any(m and m.get('kind') == 'flat' for m in me.materials):
            continue
        if 'Color' not in me.color_attributes:
            me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        ca = me.color_attributes['Color']
        cols = np.ones((len(me.loops), 4), np.float32)
        slot_color = []
        for m in me.materials:
            if m and m.get('kind') == 'flat':
                c = m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value
                slot_color.append((c[0], c[1], c[2], 1))
            else:
                slot_color.append(None)
        for poly in me.polygons:
            c = slot_color[poly.material_index] if poly.material_index < len(slot_color) else None
            if c is not None:
                cols[poly.loop_start:poly.loop_start + poly.loop_total] = c
        ca.data.foreach_set('color', cols.ravel())
        # Re-point the plain slots at the shared material.
        for i, m in enumerate(me.materials):
            if m and m.get('kind') == 'flat':
                me.materials[i] = shared
    return shared


def merge_slots(obj):
    """Collapse duplicate material slots (after flattening, many point at 'Flat')."""
    me = obj.data
    seen: dict[str, int] = {}
    remap = []
    new = []
    for m in me.materials:
        if m.name not in seen:
            seen[m.name] = len(new)
            new.append(m)
        remap.append(seen[m.name])
    if len(new) == len(me.materials):
        return
    idx = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get('material_index', idx)
    idx = np.array(remap, np.int32)[idx]
    me.materials.clear()
    for m in new:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', idx)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    merge_slots(o)
    o.data.validate(clean_customdata=False)
    return o


def is_unlit(obj):
    return any(m and m.get('unlit') for m in obj.data.materials)


# --------------------------------------------------------------------------
# Lightmap baking
# --------------------------------------------------------------------------

def ensure_uvs(obj):
    me = obj.data
    if 'UVMap' not in me.uv_layers:
        # Index 0 must be the texture UVs (TEXCOORD_0) so the lightmap is TEXCOORD_1 everywhere.
        if len(me.uv_layers) == 0:
            me.uv_layers.new(name='UVMap')
        else:
            me.uv_layers[0].name = 'UVMap'
    if 'Lightmap' not in me.uv_layers:
        me.uv_layers.new(name='Lightmap')


def lightmap_unwrap(objs, margin=0.003, weight=None):
    """Unwrap objs onto one shared 'Lightmap' UV atlas with even texel density.

    weight(obj) -> float scales an object's share of texels per unit length
    (2 = twice the resolution): spend them where the camera looks.
    """
    for o in objs:
        ensure_uvs(o)
        o.data.uv_layers.active = o.data.uv_layers['Lightmap']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    if weight:
        for o in objs:
            k = float(weight(o))
            if k != 1.0:
                uv = o.data.uv_layers['Lightmap'].data
                arr = np.zeros(len(uv) * 2, np.float32)
                uv.foreach_get('uv', arr)
                uv.foreach_set('uv', arr * k)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def cull_hidden(objs, floor_z, eps=0.03):
    """Delete faces nobody can see — undersides resting on the floor — so they take no lightmap space."""
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        dead = [f for f in bm.faces if f.normal.z < -0.95 and f.calc_center_median().z < floor_z + eps]
        if dead and len(dead) < len(bm.faces):
            bmesh.ops.delete(bm, geom=dead, context='FACES')
            bm.to_mesh(o.data)
        bm.free()


def srgb_encode(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def bake_lightmap(objs, size=2048, samples=128, out_file=None, quality=90):
    """Bake diffuse light (direct + indirect, no albedo) for objs into one atlas on their 'Lightmap' UVs.

    Writes an sRGB-encoded WEBP scaled so the brightest 0.2% clip; returns that
    scale (the client sets lightMapIntensity = scale * PI for an unlit material).
    """
    from PIL import Image  # installed into the venv by run.sh

    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    # Tiny bright emitters (flames) throw fireflies into a bake; clamp the bounce light.
    sc.cycles.sample_clamp_indirect = 4.0
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.margin = max(4, size // 256)
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    img = bpy.data.images.new('LightmapBake', size, size, float_buffer=True, alpha=False)
    added = []
    for m in {m for o in objs for m in o.data.materials if m}:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.name = '__bake__'
        m.node_tree.nodes.active = n
        added.append((m, n))
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['Lightmap']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    t = time.time()
    log(f'baking {len(objs)} objects into {size}² at {samples} spp…')
    bpy.ops.object.bake(type='DIFFUSE')
    log(f'bake done in {time.time() - t:.0f}s')
    for m, n in added:
        m.node_tree.nodes.remove(n)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
    px = np.array(img.pixels[:], np.float32).reshape(size, size, 4)[..., :3]
    px = denoise(px)
    scale = float(np.percentile(px, 99.8)) or 1.0
    enc = srgb_encode(px / scale)
    rgb = (np.flipud(enc) * 255 + 0.5).astype(np.uint8)
    if out_file:
        os.makedirs(os.path.dirname(out_file), exist_ok=True)
        Image.fromarray(rgb, 'RGB').save(out_file, 'WEBP', quality=quality, method=6)
        log('wrote', os.path.relpath(out_file, REPO), f'{os.path.getsize(out_file) // 1024} KB, scale {scale:.3f}')
    bpy.data.images.remove(img)
    return scale


def denoise(px: np.ndarray, passes=2) -> np.ndarray:
    """Light edge-aware smoothing of a noisy bake: a 3×3 blur that ignores very different neighbours."""
    out = px.copy()
    for _ in range(passes):
        acc = np.zeros_like(out)
        wsum = np.zeros(out.shape[:2] + (1,), np.float32)
        lum = out.mean(axis=2, keepdims=True)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nb = np.roll(np.roll(out, dy, 0), dx, 1)
                nl = nb.mean(axis=2, keepdims=True)
                w = np.exp(-np.abs(nl - lum) / (0.15 * lum + 0.02)) * (1.0 if dx == dy == 0 else 0.6)
                acc += nb * w
                wsum += w
        out = acc / wsum
    return out


# --------------------------------------------------------------------------
# Export + manifest
# --------------------------------------------------------------------------

def export_glb(objs, rel_path, images='WEBP', quality=88, normals=True, compress=True):
    path = os.path.join(PUBLIC, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=normals, export_materials='EXPORT',
        export_vertex_color='NAME', export_vertex_color_name='Color', export_all_vertex_colors=False,
        export_image_format=images, export_image_quality=quality, export_extras=True,
        export_cameras=False, export_lights=False,
    )
    raw = os.path.getsize(path)
    # Keep the uncompressed export (gitignored) so compression can be redone without a re-bake.
    cache = os.path.join(HERE, '.cache', rel_path)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    import shutil
    shutil.copyfile(path, cache)
    if compress:
        gltfpack(path)
    log('wrote', os.path.relpath(path, REPO), f'{os.path.getsize(path) // 1024} KB (from {raw // 1024} KB)')
    return path


def gltfpack(path):
    """Meshopt-compress a GLB in place (three.js decodes it with the bundled decoder, no CDN).

    -kn/-km keep the named nodes and materials the game looks up; -kv keeps the
    lightmap UVs, which no material in the file references (the lightmap loads
    separately); -vpf/-vtf keep positions and UVs as floats, so no node or
    texture transform is added for the lightmap to miss.
    """
    import subprocess
    tool = os.path.join(REPO, 'node_modules', '.bin', 'gltfpack')
    if not os.path.exists(tool):
        log('gltfpack not installed (npm install at the repo root) — leaving', os.path.basename(path), 'uncompressed')
        return
    tmp = path + '.tmp.glb'
    subprocess.run([tool, '-i', path, '-o', tmp, '-cc', '-kn', '-km', '-ke', '-kv', '-vpf', '-vtf'], check=True,
                   stdout=subprocess.DEVNULL)
    os.replace(tmp, path)


def file_hash(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:10]


def record(key: str, entry: dict):
    """Store an asset's URLs (with a content hash for caching) in the manifest and regenerate assets.gen.ts."""
    data = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as f:
            data = json.load(f)
    out = {}
    for k, v in entry.items():
        if isinstance(v, str) and v.startswith('/'):
            out[k] = f'{v}?v={file_hash(os.path.join(PUBLIC, v.lstrip("/")))}'
        else:
            out[k] = v
    data[key] = out
    with open(MANIFEST, 'w') as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write('\n')
    lines = [
        '// Generated by tools/blender (blib.record) — do not edit by hand.',
        '// URLs carry a content hash so a rebuilt asset is never served stale.',
        '',
        f'export const ASSETS = {json.dumps(data, indent=2, sort_keys=True)} as const;',
        '',
    ]
    with open(ASSETS_TS, 'w') as f:
        f.write('\n'.join(lines))
    log('manifest updated:', key)
