"""The ten player characters as smooth, fused models.

The designs stay where they are — client/src/three/characters/looks.tsx — and
extract_characters.ts dumps them as parts lists. Here every list is rebuilt at
a higher resolution, and the big shapes of each colour are fused into one
surface with voxel remeshing (quills grow out of Spiky's head, the cat's ears
out of its skull) and smoothed, so the figures read as moulded vinyl toys
instead of stacked primitives. Small details (eyes, buttons, visors) stay
crisp primitives.

Output: one file per character, models/characters/<id>.glb, so a game only
downloads the characters at its table. Nodes `<id>_Body|Head|HandL|HandR|FootL|FootR`
(plus `<id>_LidL|LidR` eyelids and `<id>_Top|Chain` for the garments a detailed
character wears), each with its origin on the rig pivot Figure.tsx animates.
The Chog's mane is a node of its own in head space, `chog_Hair_full`, with the
cut-down versions it wears under an outfit hat beside it (`chog_Hair_<trim>`, MANES).
Material names are `<id>:<key>`; the game swaps each for that figure's own
material of that key (player colour on `main`, greying in jail, fading when
bankrupt), and merges each figure into a few skinned meshes (merged.ts).
models/characters/<id>-low.glb is the same model simplified by gltfpack
(LOW_RATIO of the triangles) for Low graphics. The manifest records both
(`characters` / `charactersLow`, by id); .cache/models/characters.glb keeps all
of them uncompressed in one file for outfits.py.

    tools/blender/run.sh characters.py [--preview out.png] [--build chog]
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
import detailed  # noqa: E402

PART_PIVOTS = {'Body': (0, 0, 0), 'Head': (0, 0.29, 0), 'HandL': (0.11, 0.115, 0.015), 'HandR': (-0.11, 0.115, 0.015),
               'FootL': (0.042, 0.0, 0.012), 'FootR': (-0.042, 0.0, 0.012),
               # A detailed character's own garments (its signature outfit items), in the body's frame.
               'Top': (0, 0, 0), 'Chain': (0, 0, 0)}
# Body pieces that belong to a foot (they step with it) and to a leg (the game
# draws legs live, hip to ankle, so the static ones are dropped).
FOOT_TOKENS = ('Shoe', 'Sole', 'Toe', 'Lace', 'Boot', 'Paw', 'Tabi', 'Foot', 'Slipper', 'Tread', 'Strap', 'Cuff')
LEG_TOKENS = ('_Leg',)
LEG_MATS = {'snacky': 'denim', 'starer': 'skin', 'chog': 'cloth', 'robot': 'metal', 'knight': 'metal', 'astronaut': 'white', 'pirate': 'ink', 'chef': 'c1'}
# Characters whose mane is a node of its own, with the cut-down versions worn under outfit hats
# (client/src/three/characters/outfitFit.json `mane`; the game swaps one in for `<id>_Hair_full`).
MANES = {'chog': ('fringe', 'crown')}
MANE_BUDGET = 2400
# Garment nodes (`<id>_Top`, `<id>_Chain`): a character's own clothes, shown or
# hidden by the game as its signature outfit items (shared/outfits.ts).
GARMENTS = ('Top', 'Chain')
FUSE_MATS = {'main', 'skin', 'white', 'metal', 'wood'}
VOXEL = 0.0024          # remesh resolution (figures are ~0.45 tall)
MIN_FUSE_THICKNESS = 0.022
FACE_BUDGET = 1600       # per fused surface
LOW_RATIO = 0.4          # triangles kept in the Low-graphics copy (gltfpack -si; it stops early where shapes would break)


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


def fuse(objs, name, budget=FACE_BUDGET, voxel=VOXEL):
    """Join overlapping shapes into one smooth surface (voxel remesh, smooth, decimate)."""
    o = blib.join(objs, name)
    rm = o.modifiers.new('Fuse', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.adaptivity = 0.0
    rm.use_smooth_shade = True
    sm = o.modifiers.new('Soften', 'SMOOTH')
    sm.factor = 0.6
    sm.iterations = 3
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    faces = len(o.data.polygons)
    if faces > budget:
        dm = o.modifiers.new('Budget', 'DECIMATE')
        dm.ratio = budget / faces
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


def build_detailed(cid, spec):
    """A hand-built character (detailed.py): fuse what is flagged, per material."""
    mats = materials_for(cid, spec)
    nodes = []
    built = detailed.BUILDERS[cid](mats)
    # Split the feet off the body (left = +x) and drop the static legs.
    body = built['Body']
    blib.realize(body)
    feet = {'FootL': [], 'FootR': []}
    keep = []
    for o in body:
        tail = o.name.split('_', 1)[1] if '_' in o.name else o.name
        if any(t in o.name for t in LEG_TOKENS):
            bpy.data.objects.remove(o)
            continue
        if any(tail.startswith(t) or t in tail for t in FOOT_TOKENS):
            cx = sum((o.matrix_world @ v.co).x for v in o.data.vertices) / max(1, len(o.data.vertices))
            side = 'FootL' if cx > 0 else 'FootR'
            px, py, pz = PART_PIVOTS[side]
            # Re-centre on the foot pivot (game -> blender: x, -z, y).
            o.data.transform(Matrix.Translation((-px, pz, -py)))
            feet[side].append(o)
        else:
            keep.append(o)
    built['Body'] = keep
    built.update({k: v for k, v in feet.items() if v})
    # Split the eyelids off the head, each re-centred on its hinge (head space),
    # which rides along in the node's extras for the game to hang it from.
    hinges = {}
    head = []
    blib.realize(built['Head'])
    for o in built['Head']:
        if 'BlinkLid' not in o.name:
            head.append(o)
            continue
        part = 'LidL' if o['side'] > 0 else 'LidR'
        hx, hy, hz = o['hinge']
        o.data.transform(Matrix.Translation((-hx, hz, -hy)))
        hinges[part] = [round(hx, 5), round(hy, 5), round(hz, 5)]
        built.setdefault(part, []).append(o)
    built['Head'] = head
    if cid in MANES:
        # The mane on its own node (`<id>_Hair_full`), and cut-down copies of it to swap in under an outfit's
        # hat (`<id>_Hair_<trim>`, chog_wear.TRIMS; outfitFit.json says which for each hat).
        import chog_wear
        built['Head'] = [o for o in head if '_Hair' not in o.name]
        built['Hair_full'] = [o for o in head if '_Hair' in o.name]
        for trim in MANES[cid]:
            built[f'Hair_{trim}'] = chog_wear.hair(mats, trim)
            for o in built[f'Hair_{trim}']:
                # Mostly under the hat: lighter than the whole mane.
                o['budget'] = MANE_BUDGET
    for part, objs in built.items():
        blib.realize(objs)
        groups: dict[str, list] = {}
        loose = []
        for o in objs:
            if o.get('fuse'):
                groups.setdefault(o.data.materials[0].name, []).append(o)
            else:
                loose.append(o)
        pieces = []
        for mat, os_ in groups.items():
            budget = max(int(o.get('budget', FACE_BUDGET)) for o in os_)
            fine = any('Hair' in o.name or 'Skull' in o.name for o in os_)
            pieces.append(fuse(os_, f'{cid}_{part}_{mat}', budget=budget, voxel=0.0018 if fine else VOXEL))
        node = blib.join(pieces + loose, f'{cid}_{part}')
        if part in hinges:
            node['hinge'] = hinges[part]
        nodes.append(node)
    return nodes


def build_character(cid, spec):
    if cid in detailed.BUILDERS:
        return build_detailed(cid, spec)
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


def preview(nodes_by_char, path, close=False):
    """A lineup render (Cycles) to eyeball the models; not used by the game."""
    sc = bpy.context.scene
    ids = list(nodes_by_char)
    # Characters not in the shot stand far off-camera.
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and o.name.split('_', 1)[0] not in ids:
            o.location = (100, 100, 0)
    for i, cid in enumerate(ids):
        x = (i - (len(ids) - 1) / 2) * (0.36 if close else 0.32)
        for n in nodes_by_char[cid]:
            part = n.name.split('_', 1)[1]
            if part in GARMENTS and os.environ.get('PREVIEW_BARE'):
                # PREVIEW_BARE=1: the garments off, to check the base layer under them.
                n.location = (100, 100, 0)
                continue
            if part in ('LidL', 'LidR'):
                # Hung from the head; shown half closed so the preview checks the fit.
                (hx, hy, hz), (px, py, pz) = n['hinge'], PART_PIVOTS['Head']
                n.location = blib.V(x + px + hx, py + hy, pz + hz)
                n.scale = (1, 1, 0.5)
                continue
            if part.startswith('Hair_'):
                # The mane (head space): the whole one, unless MANE_PREVIEW=<trim> picks a cut-down one.
                if part != f'Hair_{os.environ.get("MANE_PREVIEW", "full")}':
                    n.location = (100, 100, 0)
                    continue
                part = 'Head'
            px, py, pz = PART_PIVOTS[part]
            n.location = blib.V(x + px, py, pz)
        if cid in detailed.LEGS:
            (hx, hy, hz), rad = detailed.LEGS[cid]
            for side, foot in ((1, PART_PIVOTS['FootL']), (-1, PART_PIVOTS['FootR'])):
                blib.tube(f'PreviewLeg{cid}{side}', [(x + hx * side, hy, hz), (x + foot[0], foot[1] + 0.03, foot[2])], rad,
                          bpy.data.materials.get(f'{cid}:{LEG_MATS.get(cid, "main")}'), segs=10)
        if cid in detailed.ARMS:
            (sx, sy, sz), rad = detailed.ARMS[cid]
            skin = bpy.data.materials.get(f'{cid}:skin')
            for side, hand in ((1, PART_PIVOTS['HandL']), (-1, PART_PIVOTS['HandR'])):
                a = (x + sx * side, sy, sz)
                b = (x + hand[0], hand[1], hand[2])
                blib.tube(f'PreviewArm{cid}{side}', [a, b], rad, skin, segs=10)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    blib.link(cam)
    if close:
        cam.location = blib.V(0, 0.42, 1.25)
        cam.rotation_euler = (math.radians(81), 0, 0)
        cam.data.lens = 42
    else:
        # Back off far enough for the whole lineup.
        dist = max(3.0, 0.33 * len(ids) / 1.1)
        cam.location = blib.V(0, 0.3 + dist * 0.2, dist)
        cam.rotation_euler = (math.radians(80), 0, 0)
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
    sc.render.resolution_x, sc.render.resolution_y = (1200, 760) if close else (1600, 520)
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(ground)
    blib.log('preview', path)


def main():
    data = extract()
    # --build chog,snacky: rebuild and export just these (the others' files and manifest entries stay as they are;
    # the voxel remesh is not bit-for-bit repeatable, so a full run rewrites every file).
    some = sys.argv[sys.argv.index('--build') + 1].split(',') if '--build' in sys.argv else None
    if some:
        data = {cid: spec for cid, spec in data.items() if cid in some}
    blib.reset()
    by_char = {}
    for cid, spec in data.items():
        by_char[cid] = build_character(cid, spec)
        blib.log(cid, ', '.join(f'{n.name.split("_", 1)[1]} {len(n.data.polygons)}f' for n in by_char[cid]))
    nodes = [n for ns in by_char.values() for n in ns]
    if '--preview' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
        preview({k: v for k, v in by_char.items() if not only or k in only}, sys.argv[sys.argv.index('--preview') + 1],
                close=bool(only))
        for n in nodes:
            n.location = (0, 0, 0)
            n.scale = (1, 1, 1)
    # All of them uncompressed in one file, for outfits.py (thumbnails and fitting previews; with --build,
    # outfits.py --preview --chars tools/blender/.cache/models/characters/<id>.glb takes one character's own).
    if not some:
        blib.export_glb(nodes, 'models/characters.glb', images='NONE', cache_only=True)
    full, low = {}, {}
    if some:
        with open(blib.MANIFEST) as f:
            known = json.load(f)
        full = {k: v.split('?')[0] for k, v in known.get('characters', {}).items()}
        low = {k: v.split('?')[0] for k, v in known.get('charactersLow', {}).items()}
    for cid, ns in by_char.items():
        rel = f'models/characters/{cid}.glb'
        blib.export_glb(ns, rel, images='NONE')
        low_rel = f'models/characters/{cid}-low.glb'
        blib.gltfpack(os.path.join(blib.PUBLIC, low_rel), ['-si', str(LOW_RATIO)], src=os.path.join(blib.HERE, '.cache', rel))
        blib.log('wrote', low_rel, f'{os.path.getsize(os.path.join(blib.PUBLIC, low_rel)) // 1024} KB')
        full[cid], low[cid] = f'/{rel}', f'/{low_rel}'
    blib.record('characters', full)
    blib.record('charactersLow', low)


if __name__ == '__main__':
    main()
