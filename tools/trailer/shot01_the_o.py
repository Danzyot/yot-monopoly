"""Shot 1, "The O": the trailer's opener, after the Pixar lamp.

The 3D title CHOG GAMES stands on a glossy floor in a dark room with a faint
purple glow. A Chog walks in from the left, behind the title, stops, looks at
the camera, looks at the letters, walks up behind the O, wiggles its hips,
bends its knees and jumps onto the O; three more hops flatten the O into the
floor; it lands where the O was, turns to the camera and sits hugging its
knees, a round Chog standing in for the O. The 3D frames end at 10.8 s; the 2D
title card (title2d.html) takes over from the same letter positions, written
to title-layout.json for it.

    tools/blender/run.sh ../trailer/shot01_the_o.py [--draft] [--still 7.4] [--every 6]
"""

import json
import math
import os

import bpy
import bmesh
from mathutils import Vector

import film
from film import V, lerp, seg, smooth, smoother, ease_out, damped, clamp

SHOT = 'shot01'
END_3D = 10.8

# The set, in game units: the title stands on the floor at z = 0, cap height ~0.3; the Chog is ~0.5 tall.
TITLE = 'CHOG GAMES'
SIZE = 0.36
EXTRUDE = 0.034
BEVEL = 0.009
BEHIND = -0.95             # the depth the Chog walks in at
JUST_BEHIND = -0.17        # where it stands to jump onto the O

sc = film.setup_render(film.blib.reset())
world = bpy.data.worlds.new('W')
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.006, 0.003, 0.014, 1)
bg.inputs['Strength'].default_value = 1.0
sc.world = world


def build_title():
    cu = bpy.data.curves.new('Title', 'FONT')
    cu.body = TITLE
    cu.font = film.font('titan-one-400')
    cu.size = SIZE
    cu.extrude = EXTRUDE
    cu.bevel_depth = BEVEL
    cu.bevel_resolution = 4
    cu.align_x = 'CENTER'
    cu.space_character = 1.04
    ob = bpy.data.objects.new('TitleCurve', cu)
    film.blib.link(ob)
    ob.rotation_euler = (math.pi / 2, 0, 0)
    ob.location = V(0, BEVEL, 0)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    me.transform(ob.matrix_world)
    bpy.data.objects.remove(ob)
    # One object per letter, origin at the middle of its foot, so a letter can be squashed into the floor.
    # A converted text is loose pieces (caps, walls, bevels); pieces whose x ranges overlap are one letter.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.verts.ensure_lookup_table()
    seen, comps = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            w = stack.pop()
            comp.append(w.index)
            for e in w.link_edges:
                o = e.other_vert(w)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        comps.append(comp)
    bm.free()
    spans = sorted(([min(me.vertices[i].co.x for i in c), max(me.vertices[i].co.x for i in c), c] for c in comps), key=lambda r: r[0])
    parts = []
    for x0, x1, c in spans:
        if parts and x0 < parts[-1][1] - 1e-4:
            parts[-1][1] = max(parts[-1][1], x1)
            parts[-1][2] = parts[-1][2] + c
        else:
            parts.append([x0, x1, list(c)])
    parts = [p[2] for p in parts]
    assert len(parts) == len(TITLE.replace(' ', '')), f'{len(parts)} letter pieces'
    letters = []
    mat = film.principled('letters', '#fff3d4', rough=0.3, coat=0.4)
    for k, comp in enumerate(parts):
        ids = set(comp)
        bmk = bmesh.new()
        bmk.from_mesh(me)
        kill = [v for v in bmk.verts if v.index not in ids]
        bmesh.ops.delete(bmk, geom=kill, context='VERTS')
        xs = [v.co.x for v in bmk.verts]
        ys = [v.co.y for v in bmk.verts]
        zs = [v.co.z for v in bmk.verts]
        foot = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
        for v in bmk.verts:
            v.co -= foot
        mk = bpy.data.meshes.new(f'L{k}')
        bmk.to_mesh(mk)
        bmk.free()
        for p in mk.polygons:
            p.use_smooth = True
        lo = bpy.data.objects.new(f'Letter{k}', mk)
        lo.location = foot
        mk.materials.append(mat)
        film.blib.link(lo)
        letters.append(lo)
    bpy.data.meshes.remove(me)
    return letters


letters = build_title()
O = letters[2]
xO = O.location.x
H = max(v.co.z for v in O.data.vertices)          # the O's height (Blender z is game y)
TITLE_W = max(l.location.x + max(v.co.x for v in l.data.vertices) for l in letters) - min(l.location.x + min(v.co.x for v in l.data.vertices) for l in letters)
print('title width', round(TITLE_W, 3), 'O at', round(xO, 3), 'height', round(H, 3))

# Floor: glossy near-black with a purple cast, reflecting the letters; a faint purple pool of light under the title.
bpy.ops.mesh.primitive_plane_add(size=60)
floor = bpy.context.active_object
floor.data.materials.append(film.principled('floor', '#0a0612', rough=0.22, coat=0.2))
# Backdrop: a far wall glowing faint purple in the middle, black at the edges.
bpy.ops.mesh.primitive_plane_add(size=40)
wall = bpy.context.active_object
wall.rotation_euler = (math.pi / 2, 0, 0)
wall.location = V(0, 0.7, -6)
wm = bpy.data.materials.new('wall')
wm.use_nodes = True
nt = wm.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
out = nt.nodes.new('ShaderNodeOutputMaterial')
em = nt.nodes.new('ShaderNodeEmission')
tc = nt.nodes.new('ShaderNodeTexCoord')
mp = nt.nodes.new('ShaderNodeMapping')
gr = nt.nodes.new('ShaderNodeTexGradient')
gr.gradient_type = 'SPHERICAL'
cr = nt.nodes.new('ShaderNodeValToRGB')
cr.color_ramp.elements[0].color = (0, 0, 0, 1)
cr.color_ramp.elements[1].position = 1.0
cr.color_ramp.elements[1].color = (0.16, 0.06, 0.36, 1)
mp.inputs['Scale'].default_value = (0.2, 0.42, 1)
nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
nt.links.new(gr.outputs['Fac'], cr.inputs['Fac'])
nt.links.new(cr.outputs['Color'], em.inputs['Color'])
em.inputs['Strength'].default_value = 1.0
nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
wall.data.materials.append(wm)
wall.visible_shadow = False

# Lights: a big soft key from above and in front, a cool rim from behind, a purple pool from straight above.
film.area_light('Key', V(-1.4, 3.0, 3.2), V(0, 0.15, 0), 420, 3.0, (1.0, 0.95, 0.88))
film.area_light('Fill', V(2.6, 1.0, 2.8), V(0, 0.2, 0), 90, 2.5, (0.85, 0.82, 1.0))
film.area_light('Rim', V(0.6, 1.8, -2.6), V(0, 0.3, 0), 260, 2.0, (0.75, 0.6, 1.0))
pool = film.area_light('Pool', V(0, 2.6, 0.1), V(0, 0, 0.1), 140, 2.0, (0.62, 0.42, 1.0))
pool.visible_glossy = False
for lname in ('Key', 'Fill', 'Rim'):
    bpy.data.objects[lname].visible_glossy = False

chog = film.Chog()
cam = film.camera(lens=42)
CAM_POS = (0.0, 0.34, 3.45)
CAM_AT = (0.0, 0.19, -0.35)

walk_in = film.Walk([(-2.35, BEHIND), (-0.08, BEHIND)], 0.8, 3.7, step=0.09)
walk_up = film.Walk([(-0.08, BEHIND), (xO, JUST_BEHIND)], 5.15, 6.35, step=0.085)
HOPS = [6.95, 7.5, 7.98, 8.46]        # take-offs
LAND = [7.38, 7.86, 8.33, 8.84]       # landings
O_AFTER = [0.72, 0.46, 0.2, 0.0]      # the O's height after each landing


def o_height(t):
    h, prev = 1.0, 1.0
    for land, after in zip(LAND, O_AFTER):
        if t >= land:
            k = seg(t, land, land + 0.11)
            h = lerp(prev, after, ease_out(k))
            # The letter gives a little after the impact, then holds.
            h = max(0.0, h - 0.04 * after * math.sin(math.pi * k))
        prev = after if t >= land else prev
    return h


def head_to_camera(yaw):
    """Head yaw (radians) that turns the face to the camera from a body facing yaw degrees."""
    return -math.radians(yaw) * 0.85


def tuck_pose(k):
    """Sitting, knees pulled to the chest, arms hugging them: a round Chog. k blends in from rest."""
    q = film.rest()
    t = film.rest()
    t['pos'] = [0.0, -0.083, -0.01]
    t['rot'] = [-0.1, 0.0, 0.0]
    t['head'] = [-0.02, 0.0, 0.0]
    t['head_y'] = R_HEAD - 0.012
    t['squash'] = 0.97
    for i, side in enumerate((1, -1)):
        t['feet'][i] = [side * 0.036, 0.055, 0.082, -0.7]
        t['hands'][i] = [side * 0.032, 0.118, 0.118, 0.5, side * 1.1]
    for key in ('pos', 'rot', 'head'):
        q[key] = film.lerpv(q[key], t[key], k)
    q['head_y'] = lerp(q['head_y'], t['head_y'], k)
    q['squash'] = lerp(q['squash'], t['squash'], k)
    for i in range(2):
        q['feet'][i] = film.lerpv(q['feet'][i], t['feet'][i], k)
        q['hands'][i] = film.lerpv(q['hands'][i], t['hands'][i], k)
    if k > 0.3:
        # Elbows out round the knees.
        q['arm_poles'] = [Vector((1.0, -0.1, 0.25)), Vector((-1.0, -0.1, 0.25))]
    return q


R_HEAD = film.R.HEAD_Y


def blink(q, t, at):
    w = seg(t, at, at + 0.09) - seg(t, at + 0.09, at + 0.18)
    q['lids'] = max(q['lids'], clamp(w * 1.0))


def jump_state(t):
    """(pos, pose) during the hops, from the first take-off to settling on the floor."""
    q = film.rest()
    # Each hop: stretch in the air, squash on landing, a crouch to wind up the next.
    if t < HOPS[0]:
        return (xO, 0.0, JUST_BEHIND), q
    for i, (up, land) in enumerate(zip(HOPS, LAND)):
        nxt = HOPS[i + 1] if i + 1 < len(HOPS) else None
        if up <= t < land:
            u = seg(t, up, land)
            y0 = 0.0 if i == 0 else H * O_AFTER[i - 1]
            y1 = H if i == 0 else H * O_AFTER[i - 1]
            peak = max(y0, y1) + (0.1 if i == 0 else 0.075)
            # A parabola through y0, peak, y1.
            y = (1 - u) ** 2 * y0 + 2 * (1 - u) * u * (2 * peak - (y0 + y1) / 2) + u * u * y1
            z = lerp(JUST_BEHIND, 0.0, smooth(u)) if i == 0 else 0.0
            q['squash'] = 1.0 + 0.1 * math.sin(math.pi * u)
            q['rot'][0] = -0.1 * math.sin(math.pi * u)
            for k, side in enumerate((1, -1)):
                q['hands'][k] = [side * 0.13, 0.27, 0.03, 0.0, side * 0.6]
                q['feet'][k][1] = 0.02 * math.sin(math.pi * u)
                q['feet'][k][3] = 0.3 * math.sin(math.pi * u)
            q['lids'] = 0.25
            return (xO, y, z), q
        if land <= t and (nxt is None or t < nxt):
            on = H * o_height(t)
            dt = t - land
            sq = 1.0 - 0.18 * max(0.0, damped(dt, 2.5, 7.0))
            # Before the next hop: a crouch to wind up.
            if nxt is not None:
                w = seg(t, nxt - 0.16, nxt)
                sq = min(sq, 1.0 - 0.16 * math.sin(math.pi * 0.5 * w))
            q['squash'] = sq
            q['pos'][1] = -0.01 * (1 - sq)
            for k, side in enumerate((1, -1)):
                q['hands'][k][1] -= 0.04 * (1 - sq) * 4
            return (xO, on, 0.0), q
    return (xO, 0.0, 0.0), q


def frame(t):
    cam_k = smooth(t / END_3D)
    film.place_camera(cam, (CAM_POS[0], CAM_POS[1], lerp(CAM_POS[2], CAM_POS[2] - 0.08, cam_k)), CAM_AT, lens=lerp(42, 43.2, cam_k))
    # The O squashes into the floor.
    h = o_height(t)
    O.scale = (1 + 0.18 * (1 - h), 1 + 0.05 * (1 - h), max(h, 0.0005))
    O.hide_render = h <= 0.002
    if t < 0.8:
        chog.pose(film.rest(), (-9, 0, BEHIND), 90)
        return
    if t < 3.7:
        pos, yaw, q, _ = walk_in.at(t)
        chog.pose(q, pos, yaw)
        return
    if t < 5.15:
        # Stops, turns to the camera, blinks, then looks down at the letters.
        q = film.rest()
        turn = smooth(seg(t, 3.75, 4.25))
        yaw = lerp(90, 25, turn)
        look_cam = smooth(seg(t, 3.85, 4.3)) * (1 - smooth(seg(t, 4.65, 4.95)))
        look_title = smooth(seg(t, 4.7, 4.95))
        q['head'] = [0.32 * look_title, head_to_camera(yaw) * look_cam + math.radians(-yaw * 0.4) * look_title, 0.0]
        q['rot'][1] = 0.0
        blink(q, t, 4.35)
        # Settling from the walk.
        q['pos'][1] = 0.004 * damped(t - 3.7, 2.0, 6.0)
        chog.pose(q, (-0.08, 0.0, BEHIND), yaw)
        return
    if t < 6.35:
        pos, yaw, q, _ = walk_up.at(t)
        q['head'][0] += 0.12
        chog.pose(q, pos, yaw)
        return
    if t < HOPS[0]:
        # Turns to face the O, wiggles its hips, bends its knees.
        q = film.rest()
        _, yaw_end, _, _ = walk_up.at(6.35)
        yaw = lerp(yaw_end, 0.0, smooth(seg(t, 6.35, 6.5)))
        w = seg(t, 6.45, 6.78)
        q['rot'][2] = 0.16 * math.sin(2 * math.pi * 2 * w) * (1 - w * 0.3) * (w < 1)
        q['rot'][1] = 0.12 * math.sin(2 * math.pi * 2 * w + 0.6) * (w < 1)
        bend = math.sin(math.pi * 0.5 * seg(t, 6.74, HOPS[0]))
        q['squash'] = 1.0 - 0.17 * bend
        q['pos'][1] = -0.012 * bend
        q['rot'][0] = 0.14 * bend
        q['head'] = [-0.18 * bend + 0.1 * (1 - bend), 0, 0]
        for k, side in enumerate((1, -1)):
            q['hands'][k][2] -= 0.05 * bend
            q['hands'][k][1] -= 0.02 * bend
        chog.pose(q, (xO, 0.0, JUST_BEHIND), yaw)
        return
    if t < 9.2:
        pos, q = jump_state(t)
        if t > LAND[3]:
            # Looks down at where the O went.
            q['head'][0] = 0.35 * smooth(seg(t, 8.95, 9.1))
        chog.pose(q, pos, 0.0)
        return
    # Sits and hugs its knees: the round Chog in the O's place.
    k = smoother(seg(t, 9.25, 9.85))
    q = tuck_pose(k)
    q['head'][0] += 0.35 * (1 - smooth(seg(t, 9.2, 9.45)))
    blink(q, t, 10.25)
    chog.pose(q, (xO, 0.0, 0.0), 0.0)


def write_layout():
    """Each letter's front-face box on screen at the last 3D frame, for the 2D card to match."""
    frame(END_3D - 1 / film.FPS)
    bpy.context.view_layer.update()
    rx, ry = sc.render.resolution_x, sc.render.resolution_y
    boxes = []
    for k, lo in enumerate(letters):
        if k == 2:
            O.scale = (1, 1, 1)
            bpy.context.view_layer.update()
        mw = lo.matrix_world
        ymin = min(v.co.y for v in lo.data.vertices)
        pts = [film.project(cam, mw @ v.co) for v in lo.data.vertices if v.co.y < ymin + 0.006]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        boxes.append({'char': [c for c in TITLE if c != ' '][k], 'x0': min(xs) / rx, 'x1': max(xs) / rx, 'y0': min(ys) / ry, 'y1': max(ys) / ry})
    path = os.path.join(film.OUT_ROOT, 'title-layout.json')
    with open(path, 'w') as f:
        json.dump({'letters': boxes, 'chog_center': [p / r for p, r in zip(film.project(cam, V(xO, 0.13, 0.0)), (rx, ry))]}, f, indent=1)
    print('layout', path)


if '--layout' in film.ARGS:
    write_layout()
else:
    film.render(SHOT, END_3D, frame)
