"""The ten player characters as smooth, fused models.

The designs stay where they are — client/src/three/characters/looks.tsx — and
extract_characters.ts dumps them as parts lists. Here every list is rebuilt at
a higher resolution, and the big shapes of each colour are fused into one
surface with voxel remeshing (quills grow out of Spiky's head, the cat's ears
out of its skull) and smoothed, so the figures read as moulded vinyl toys
instead of stacked primitives. Small details (eyes, buttons, visors) stay
crisp primitives.

Output: models/characters.glb with nodes `<id>_Body|Head|HandL|HandR`, each
with its origin on the rig pivot Figure.tsx animates. Material names are
`<id>:<key>`; the game swaps each for that figure's own material of that key
(player colour on `main`, greying in jail, fading when bankrupt).

    tools/blender/run.sh characters.py [--preview out.png]
"""

import json
import math
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix  # noqa: E402
import blib  # noqa: E402

PART_PIVOTS = {'Body': (0, 0, 0), 'Head': (0, 0.29, 0), 'HandL': (0.11, 0.115, 0.015), 'HandR': (-0.11, 0.115, 0.015)}
FUSE_MATS = {'main', 'skin', 'white', 'metal', 'wood'}
VOXEL = 0.0024          # remesh resolution (figures are ~0.45 tall)
MIN_FUSE_THICKNESS = 0.022
FACE_BUDGET = 1600       # per fused surface


def extract():
    out = os.path.join(tempfile.gettempdir(), 'yot-characters.json')
    subprocess.run(['node', '--import', 'tsx', os.path.join(blib.HERE, 'extract_characters.ts'), out],
                   cwd=blib.REPO, check=True)
    with open(out) as f:
        return json.load(f)


# ---- primitives in three.js space (y up) -----------------------------------

def prim(geo, size=0.1):
    """Vertices + faces for a three.js geometry description; resolution follows the part's size."""
    t, p = geo['type'], geo['params']
    fine = 1.0 if size > 0.12 else 0.6 if size > 0.05 else 0.35
    bm = bmesh.new()
    if t == 'SphereGeometry':
        bmesh.ops.create_uvsphere(bm, u_segments=max(10, int(40 * fine)), v_segments=max(6, int(24 * fine)), radius=p['radius'])
    elif t == 'BoxGeometry':
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(p['width'], p['height'], p['depth']), verts=bm.verts)
    elif t in ('CylinderGeometry', 'ConeGeometry'):
        rt = 0.0 if t == 'ConeGeometry' else p['radiusTop']
        rb = p['radius'] if t == 'ConeGeometry' else p['radiusBottom']
        seg = p['radialSegments']
        seg = seg if seg < 8 else max(10, int(40 * fine))
        h = p['height']
        t0, tl = p.get('thetaStart', 0.0), p.get('thetaLength', math.tau)
        ring = lambda r, y: [bm.verts.new((r * math.sin(t0 + tl * i / seg), y, r * math.cos(t0 + tl * i / seg))) for i in range(seg)]
        bot = ring(rb, -h / 2)
        if rt > 1e-6:
            top = ring(rt, h / 2)
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new((bot[i], bot[j], top[j], top[i]))
            if not p.get('openEnded'):
                bm.faces.new(top)
        else:
            apex = bm.verts.new((0, h / 2, 0))
            for i in range(seg):
                bm.faces.new((bot[i], bot[(i + 1) % seg], apex))
        if not p.get('openEnded'):
            bm.faces.new(list(reversed(bot)))
    elif t == 'TorusGeometry':
        R, r, arc = p['radius'], p['tube'], p['arc']
        full = abs(arc - math.tau) < 1e-6
        nu = max(12, int(48 * fine)) if full else max(8, int(48 * fine * arc / math.tau))
        nv = max(6, int(14 * fine))
        rows = []
        for i in range(nu + (0 if full else 1)):
            u = arc * i / nu
            rows.append([bm.verts.new(((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v)))
                         for v in (math.tau * j / nv for j in range(nv))])
        n = len(rows)
        for i in range(n if full else n - 1):
            a, b = rows[i], rows[(i + 1) % n]
            for j in range(nv):
                bm.faces.new((a[j], b[j], b[(j + 1) % nv], a[(j + 1) % nv]))
        if not full:
            bm.faces.new(list(reversed(rows[0])))
            bm.faces.new(rows[-1])
    elif t == 'OctahedronGeometry':
        r = p['radius']
        v = [bm.verts.new(c) for c in ((r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r))]
        for a, b, c in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            bm.faces.new((v[a], v[b], v[c]))
    else:
        raise ValueError(t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


THREE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def entry_object(name, e, mat):
    bm = prim(e['geo'], extent(e))
    el = e['matrix']
    m = Matrix([[el[c * 4 + r] for c in range(4)] for r in range(4)])  # column-major -> rows
    bm.transform(THREE_TO_BLENDER @ m)
    if m.determinant() < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    obj = blib.new_mesh_object(name, bm, mat)
    t = e['geo']['type']
    if t in ('SphereGeometry', 'TorusGeometry'):
        obj.data.shade_smooth()
    elif t in ('CylinderGeometry', 'ConeGeometry'):
        blib.smooth(obj, 50)
    if t == 'BoxGeometry':
        blib.add_bevel(obj, min(0.006, thickness(e) * 0.2), 2)
    return obj


def extent(e):
    """Largest extent of a part (sets its mesh resolution)."""
    el = e['matrix']
    cols = [math.sqrt(el[c * 4] ** 2 + el[c * 4 + 1] ** 2 + el[c * 4 + 2] ** 2) for c in range(3)]
    p = e['geo']['params']
    r = max(p.get('radius', 0.5), p.get('radiusTop', 0), p.get('radiusBottom', 0), p.get('width', 0), p.get('height', 0))
    return 2 * r * max(cols)


def thickness(e):
    """Smallest extent of a part, from its geometry size and its matrix's column lengths."""
    el = e['matrix']
    cols = [math.sqrt(el[c * 4] ** 2 + el[c * 4 + 1] ** 2 + el[c * 4 + 2] ** 2) for c in range(3)]
    t, p = e['geo']['type'], e['geo']['params']
    if t == 'SphereGeometry':
        size = [2 * p['radius']] * 3
    elif t == 'BoxGeometry':
        size = [p['width'], p['height'], p['depth']]
    elif t in ('CylinderGeometry', 'ConeGeometry'):
        r = p.get('radius', max(p.get('radiusTop', 0), p.get('radiusBottom', 0)))
        size = [2 * r, p['height'], 2 * r]
    elif t == 'TorusGeometry':
        return 2 * p['tube'] * min(cols)
    else:
        size = [2 * p.get('radius', 1)] * 3
    return min(s * c for s, c in zip(size, cols))


def fuse(objs, name):
    """Join overlapping shapes into one smooth surface (voxel remesh, smooth, decimate)."""
    o = blib.join(objs, name)
    rm = o.modifiers.new('Fuse', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = VOXEL
    rm.adaptivity = 0.0
    rm.use_smooth_shade = True
    sm = o.modifiers.new('Soften', 'SMOOTH')
    sm.factor = 0.6
    sm.iterations = 3
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    faces = len(o.data.polygons)
    if faces > FACE_BUDGET:
        dm = o.modifiers.new('Budget', 'DECIMATE')
        dm.ratio = FACE_BUDGET / faces
        bpy.ops.object.modifier_apply(modifier=dm.name)
    o.data.shade_smooth()
    return o


def materials_for(cid, spec):
    mats = {}
    for key, m in spec['materials'].items():
        mat = bpy.data.materials.new(f'{cid}:{key}')
        mat.use_nodes = True
        b = mat.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*blib.hex_rgb(m['color']), 1)
        b.inputs['Roughness'].default_value = m['roughness']
        b.inputs['Metallic'].default_value = m['metalness']
        if m['emissive'] != '#000000':
            b.inputs['Emission Color'].default_value = (*blib.hex_rgb(m['emissive']), 1)
            b.inputs['Emission Strength'].default_value = 1.4
        mats[key] = mat
    return mats


def build_character(cid, spec):
    mats = materials_for(cid, spec)
    nodes = []
    for part, entries in spec['parts'].items():
        fusable: dict[str, list] = {}
        loose = []
        for k, e in enumerate(entries):
            obj = entry_object(f'{cid}_{part}_{k}', e, mats[e['mat']])
            if e['mat'] in FUSE_MATS and thickness(e) >= MIN_FUSE_THICKNESS:
                fusable.setdefault(e['mat'], []).append(obj)
            else:
                loose.append(obj)
        blib.realize(loose + [o for os_ in fusable.values() for o in os_])
        pieces = []
        for key, objs in fusable.items():
            pieces.append(fuse(objs, f'{cid}_{part}_{key}') if len(objs) > 1 else objs[0])
        pieces += loose
        node = blib.join(pieces, f'{cid}_{part}')
        nodes.append(node)
    return nodes


def preview(nodes_by_char, path):
    """A lineup render (Cycles) to eyeball the models; not used by the game."""
    sc = bpy.context.scene
    ids = list(nodes_by_char)
    for i, cid in enumerate(ids):
        x = (i - (len(ids) - 1) / 2) * 0.32
        for n in nodes_by_char[cid]:
            part = n.name.split('_', 1)[1]
            px, py, pz = PART_PIVOTS[part]
            n.location = blib.V(x + px, py, pz)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    blib.link(cam)
    cam.location = blib.V(0, 0.95, 3.0)
    cam.rotation_euler = (math.radians(74), 0, 0)
    cam.data.lens = 32
    sc.camera = cam
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    blib.link(sun)
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.55, 0.65, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sc.world = world
    ground = blib.box('Ground', (6, 0.02, 3), (0, -0.01, 0), blib.flat('#d8d2bf', 0.8))
    sc.render.resolution_x, sc.render.resolution_y = 1600, 520
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)
    blib.log('preview', path)


def main():
    data = extract()
    blib.reset()
    by_char = {}
    for cid, spec in data.items():
        by_char[cid] = build_character(cid, spec)
        blib.log(cid, ', '.join(f'{n.name.split("_", 1)[1]} {len(n.data.polygons)}f' for n in by_char[cid]))
    nodes = [n for ns in by_char.values() for n in ns]
    if '--preview' in sys.argv:
        preview(by_char, sys.argv[sys.argv.index('--preview') + 1])
        for n in nodes:
            n.location = (0, 0, 0)
    blib.export_glb(nodes, 'models/characters.glb', images='NONE')
    blib.record('characters', {'url': '/models/characters.glb'})


if __name__ == '__main__':
    main()
