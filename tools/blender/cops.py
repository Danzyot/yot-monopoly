"""The cutscene cast: two cartoon cops, their patrol car, a tow truck, a trophy
and a winner's podium, in the same moulded vinyl-toy style as the characters.

Output: models/cops.glb, loaded only when a cutscene first needs it
(client/src/three/cinematics). Every node is built round its own pivot, in
three.js space (y up, facing +z), like characters.py:

  CopBody            torso, belt and badge; origin between the feet
  CopHeadA/B         the sergeant (moustache) and the rookie; origin at the neck pivot (0.335 up)
  CopHandL/R         white gloves; origin at each hand
  CopFootL/R         boots; origin under each foot
  CopBaton           a night stick; origin at the grip
  CarBody            the patrol car; origin on the ground at its middle
  CarSirenRed/Blue   the light-bar domes (flashed live); origin on the car's roof bar
  CarWheel           one wheel, axle along x (drawn four times)
  TruckBody          the tow truck: cab, flatbed, crane arm and hook
  TruckBeacon        the amber roof beacon
  Trophy             a gold cup on a plinth; origin at its foot
  Podium             the winner's block with a big gold 1; origin at its foot

Arms and legs are not modelled: the game draws them live from shoulder to
hand and hip to foot, so they follow every pose. No light is baked; the game
lights it all live.

    tools/blender/run.sh cops.py [--preview out.png]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import blib  # noqa: E402
import characters  # noqa: E402
from detailed import M, cyl, ell, eyes, frame_z, mitten, on_ell, rbox, star, strand, torus, _finish  # noqa: E402

PALETTE = {
    'navy': ('#25386e', 0.55, 0.0),
    'pants': ('#1b2850', 0.6, 0.0),
    'skin': ('#f3c39c', 0.5, 0.0),
    'skin2': ('#d99b74', 0.5, 0.0),
    'white': ('#f7f7f4', 0.45, 0.0),
    'ink': ('#17171d', 0.35, 0.0),
    'gold': ('#f0c23b', 0.28, 0.85),
    'blush': ('#f0928a', 0.6, 0.0),
    'c3': ('#3a6fd6', 0.3, 0.0),
    'hair': ('#4a2f22', 0.55, 0.0),
    'hair2': ('#c98b3c', 0.55, 0.0),
    'glass': ('#1f2b3a', 0.12, 0.2),
    'chrome': ('#c9ced6', 0.22, 0.9),
    'tyre': ('#202024', 0.75, 0.0),
    'paint': ('#f4f4f0', 0.32, 0.0),
    'paint2': ('#1b2a55', 0.32, 0.0),
    'tow': ('#f5a524', 0.38, 0.0),
    'tow2': ('#2e2e34', 0.5, 0.0),
    'red': ('#ff2a2a', 0.3, 0.0, '#ff1a1a'),
    'blue': ('#2a6bff', 0.3, 0.0, '#1a5cff'),
    'amber': ('#ffb020', 0.3, 0.0, '#ff9a00'),
    'lamp': ('#fff6d8', 0.2, 0.0, '#fff1c0'),
    'wood': ('#5a3a26', 0.6, 0.0),
    'podium': ('#f7f4ee', 0.4, 0.0),
    'carpet': ('#c8202f', 0.7, 0.0),
}

HEAD_Y = 0.335
SHOULDER = (0.085, 0.222, 0.0)
HAND_REST = (0.118, 0.125, 0.02)
FOOT_REST = (0.045, 0.0, 0.012)


def materials():
    mats = {}
    for key, spec in PALETTE.items():
        color, rough, metal = spec[:3]
        mat = bpy.data.materials.new(f'cop:{key}')
        mat.use_nodes = True
        b = mat.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*blib.hex_rgb(color), 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if len(spec) > 3:
            b.inputs['Emission Color'].default_value = (*blib.hex_rgb(spec[3]), 1)
            b.inputs['Emission Strength'].default_value = 1.6
        mats[key] = mat
    return mats


def lathe3(name, profile, mat, p=(0, 0, 0), seg=28):
    """Revolve [(radius, y), ...] about three's y axis (a cup, a hubcap)."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, y, 0))])
        else:
            rings.append([bm.verts.new((r * math.sin(2 * math.pi * i / seg), y, r * math.cos(2 * math.pi * i / seg))) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1 and len(b) > 1:
                bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1 and len(a) > 1:
                bm.faces.new((a[i], a[j], b[0]))
            elif len(a) > 1 and len(b) > 1:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.transform(M(p))
    return _finish(name, bm, mat, False)


def node(objs, name, fuse_mats=(), budget=1800):
    """Realize, fuse the flagged shapes per material, and join into one named node."""
    blib.realize(objs)
    groups, loose = {}, []
    for o in objs:
        if o.get('fuse') and o.data.materials[0].name.split(':')[1] in fuse_mats:
            groups.setdefault(o.data.materials[0].name, []).append(o)
        else:
            loose.append(o)
    pieces = [characters.fuse(g, f'{name}_{k.split(":")[1]}', budget=budget) if len(g) > 1 else g[0] for k, g in groups.items()]
    return blib.join(pieces + loose, name)


# --------------------------------------------------------------------------
# The cops
# --------------------------------------------------------------------------

def cop_body(m):
    out = []
    T = ((0, 0.17, 0), (0.09, 0.09, 0.074))
    out.append(ell('CopTorso', T[0], T[1], m['navy'], fuse=True))
    out.append(ell('CopChest', (0, 0.19, 0.012), (0.084, 0.06, 0.066), m['navy'], fuse=True))
    out.append(ell('CopHips', (0, 0.095, 0), (0.078, 0.04, 0.066), m['pants'], seg=(24, 14)))
    # Belt with a gold buckle, a holster pouch on each side.
    out.append(ell('CopBelt', (0, 0.112, 0), (0.093, 0.017, 0.077), m['ink'], seg=(28, 10)))
    out.append(rbox('CopBuckle', (0, 0.112, 0.077), (0.03, 0.022, 0.008), m['gold'], bevel=0.003))
    out.append(rbox('CopBuckleIn', (0, 0.112, 0.081), (0.018, 0.011, 0.004), m['ink'], bevel=0.0015, segs=1))
    for side in (-1, 1):
        out.append(rbox(f'CopPouch{side}', (side * 0.083, 0.104, 0.026), (0.022, 0.03, 0.028), m['ink'], r=(0, side * 0.5, 0), bevel=0.005))
    # Collar wings and a tie down the front.
    for side in (-1, 1):
        out.append(rbox(f'CopCollar{side}', (side * 0.024, 0.247, 0.052), (0.036, 0.012, 0.03), m['navy'],
                        r=(0.5, side * -0.5, side * -0.35), bevel=0.004))
    out.append(ell('CopTieKnot', (0, 0.24, 0.066), (0.011, 0.01, 0.008), m['ink'], seg=(12, 8)))
    out.append(strand('CopTie', [(0, 0.235, 0.07), (0, 0.205, ell_z(T, 0, 0.205) + 0.003), (0, 0.17, ell_z(T, 0, 0.17) + 0.003),
                                 (0, 0.145, ell_z(T, 0, 0.145) + 0.002)], 0.009, 0.012, m['ink'], ring=8, n=5))
    # Shirt buttons down the placket, pocket flaps, the badge on the left chest.
    for k in range(3):
        G = on_ell(T, 0.018, 0.2 - k * 0.028, lift=0.001)
        out.append(ell(f'CopButton{k}', (0, 0, 0), (0.0055, 0.0055, 0.003), m['gold'], parent=G, seg=(10, 6)))
    for side in (-1, 1):
        G = on_ell(T, side * 0.045, 0.186, lift=0.002)
        out.append(rbox(f'CopFlap{side}', (0, 0, 0), (0.034, 0.014, 0.005), m['navy'], parent=G, bevel=0.002, segs=1))
        out.append(ell(f'CopFlapBtn{side}', (0, -0.002, 0.004), (0.004, 0.004, 0.002), m['gold'], parent=G, seg=(8, 5)))
    G = on_ell(T, 0.045, 0.214, lift=0.004)
    out.append(ell('CopBadge', (0, 0, 0), (0.019, 0.022, 0.005), m['gold'], parent=G, seg=(16, 10)))
    out.append(star('CopBadgeStar', G @ M((0, 0.001, 0.004)), 0.013, 0.006, 0.004, m['gold']))
    # A shoulder radio with a stub aerial.
    out.append(rbox('CopRadio', (-0.06, 0.232, 0.035), (0.022, 0.03, 0.014), m['ink'], r=(0.2, 0.4, 0.3), bevel=0.004))
    out.append(cyl('CopAerial', (-0.068, 0.258, 0.03), 0.003, 0.03, m['ink'], r=(0.2, 0, 0.3), seg=6))
    # Epaulettes.
    for side in (-1, 1):
        out.append(rbox(f'CopEpaulette{side}', (side * 0.07, 0.247, 0.0), (0.04, 0.008, 0.03), m['navy'], r=(0, 0, side * -0.45), bevel=0.003))
    return out


def ell_z(e, x, y):
    (cx, cy, cz), (a, b, c) = e
    return cz + c * math.sqrt(max(0.0, 1 - ((x - cx) / a) ** 2 - ((y - cy) / b) ** 2))


def cop_head(m, kind):
    """kind 'A': the sergeant (moustache, stern brows); 'B': the rookie (freckles, a grin)."""
    h = []
    F = ((0, -0.004, 0), (0.104, 0.1, 0.098))
    h.append(ell(f'Cop{kind}Face', F[0], F[1], m['skin'], seg=(30, 20), fuse=True))
    h.append(ell(f'Cop{kind}Jaw', (0, -0.04, 0.02), (0.09, 0.06, 0.08), m['skin'], fuse=True))
    h.append(ell(f'Cop{kind}Nose', (0, -0.02, 0.102), (0.024, 0.021, 0.02), m['skin'], fuse=True))
    for side in (-1, 1):
        h.append(ell(f'Cop{kind}Ear{side}', (side * 0.102, -0.008, 0), (0.016, 0.026, 0.014), m['skin'], fuse=True))
        h.append(ell(f'Cop{kind}Blush{side}', (side * 0.058, -0.036, 0.078), (0.018, 0.011, 0.006), m['blush'], r=(0, side * 0.6, 0), seg=(14, 8)))
    eyes(f'Cop{kind}', h, m, y=0.008, gap=0.038, z=0.088, size=(0.017, 0.019), iris='c3', yaw=0.38, blink=False)
    if kind == 'A':
        for side in (-1, 1):
            h.append(strand(f'CopAMoustache{side}', [(0, -0.044, 0.108), (side * 0.024, -0.048, 0.106), (side * 0.048, -0.042, 0.094),
                                                       (side * 0.058, -0.026, 0.088)], 0.011, 0.005, m['hair'], ring=8))
            h.append(strand(f'CopABrow{side}', [(side * 0.014, 0.036, 0.096), (side * 0.04, 0.042, 0.09), (side * 0.064, 0.05, 0.074)],
                            0.0075, 0.005, m['hair'], ring=6))
            h.append(ell(f'CopASideburn{side}', (side * 0.092, -0.01, 0.03), (0.014, 0.03, 0.02), m['hair'], seg=(12, 8)))
        h.append(strand('CopAMouth', [(-0.016, -0.068, 0.096), (0, -0.066, 0.1), (0.016, -0.068, 0.096)], 0.003, 0.003, m['ink'], ring=6))
    else:
        for side in (-1, 1):
            h.append(strand(f'CopBBrow{side}', [(side * 0.016, 0.04, 0.094), (side * 0.04, 0.046, 0.088), (side * 0.06, 0.042, 0.076)],
                            0.0055, 0.004, m['hair2'], ring=6))
            h.append(ell(f'CopBSideburn{side}', (side * 0.09, 0.0, 0.03), (0.014, 0.026, 0.02), m['hair2'], seg=(12, 8)))
            for k, (dx, dy) in enumerate(((0.05, -0.02), (0.062, -0.028), (0.055, -0.033))):
                G = on_ell(F, side * dx, dy, lift=0.0006)
                h.append(ell(f'CopBFreckle{side}{k}', (0, 0, 0), (0.0035, 0.0035, 0.0015), m['skin2'], parent=G, seg=(8, 5)))
        h.append(strand('CopBGrin', [(-0.03, -0.05, 0.094), (-0.015, -0.068, 0.1), (0.015, -0.068, 0.1), (0.03, -0.05, 0.094)],
                        0.0038, 0.0038, m['ink'], ring=6))
    # The peaked cap: a flared crown, a black band and visor, a gold badge.
    cap = [cyl(f'Cop{kind}CapCrown', (0, 0.078, -0.006), 0.094, 0.06, m['navy'], seg=32, fuse=True, r_top=0.112),
           ell(f'Cop{kind}CapTop', (0, 0.108, -0.01), (0.116, 0.03, 0.11), m['navy'], fuse=True)]
    h += cap
    h.append(torus(f'Cop{kind}CapBand', (0, 0.058, -0.006), 0.095, 0.011, m['ink'], r=(math.pi / 2, 0, 0), seg=32, mseg=8))
    h.append(ell(f'Cop{kind}Visor', (0, 0.05, 0.078), (0.085, 0.009, 0.05), m['ink'], r=(0.32, 0, 0), seg=(24, 8)))
    h.append(strand(f'Cop{kind}CapCord', [(-0.07, 0.066, 0.07), (0, 0.068, 0.097), (0.07, 0.066, 0.07)], 0.003, 0.003, m['gold'], ring=6))
    G = frame_z((0, 0.09, 0.098), (0, 0.25, 1))
    h.append(ell(f'Cop{kind}CapBadge', (0, 0, 0), (0.018, 0.02, 0.005), m['gold'], parent=G, seg=(14, 8)))
    h.append(star(f'Cop{kind}CapStar', G @ M((0, 0, 0.004)), 0.012, 0.0055, 0.004, m['gold']))
    return h


def cop_foot(m, side):
    return [ell(f'CopBoot{side}', (0, 0.026, 0.012), (0.034, 0.028, 0.055), m['ink'], seg=(20, 12)),
            ell(f'CopBootShine{side}', (0, 0.036, 0.03), (0.02, 0.012, 0.026), m['ink'], seg=(12, 8)),
            rbox(f'CopSole{side}', (0, 0.006, 0.012), (0.066, 0.012, 0.11), m['tyre'], bevel=0.005)]


def baton(m):
    return [cyl('CopBatonStick', (0, 0.06, 0), 0.0085, 0.15, m['ink'], seg=12, r_top=0.0095),
            ell('CopBatonTip', (0, 0.135, 0), (0.0095, 0.007, 0.0095), m['ink'], seg=(12, 6)),
            cyl('CopBatonGrip', (0, -0.012, 0), 0.0098, 0.03, m['tyre'], seg=12),
            cyl('CopBatonSide', (0, 0.012, 0.016), 0.006, 0.034, m['ink'], r=(math.pi / 2, 0, 0), seg=10),
            torus('CopBatonRing', (0, -0.029, 0), 0.009, 0.002, m['gold'], r=(math.pi / 2, 0, 0), seg=12, mseg=5)]


# --------------------------------------------------------------------------
# Vehicles
# --------------------------------------------------------------------------

def wheel(m):
    out = [lathe3('WheelTyre', [(0.0, -0.028), (0.05, -0.03), (0.06, -0.022), (0.063, 0.0), (0.06, 0.022), (0.05, 0.03), (0.0, 0.028)],
                  m['tyre'], seg=24),
           lathe3('WheelHub', [(0.0, 0.031), (0.034, 0.03), (0.036, 0.024)], m['chrome'], seg=20),
           ell('WheelCap', (0, 0.032, 0), (0.012, 0.006, 0.012), m['chrome'], seg=(12, 6))]
    # Axle along x: turn the y-up lathe onto its side.
    blib.realize(out)
    for o in out:
        o.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Y'))
    return out


def car(m):
    out = []
    # Two-tone toy body: navy lower shell with white doors, a rounded cabin on top.
    out.append(rbox('CarShell', (0, 0.1, 0), (0.36, 0.1, 0.72), m['paint2'], bevel=0.04, segs=4))
    out.append(rbox('CarDoors', (0, 0.112, -0.01), (0.364, 0.07, 0.34), m['paint'], bevel=0.025, segs=3))
    out.append(rbox('CarHoodTop', (0, 0.152, 0.2), (0.33, 0.02, 0.28), m['paint2'], bevel=0.01, segs=2))
    out.append(rbox('CarCabin', (0, 0.205, -0.04), (0.31, 0.1, 0.34), m['paint'], bevel=0.04, segs=4))
    out.append(rbox('CarWindF', (0, 0.205, 0.124), (0.27, 0.075, 0.02), m['glass'], r=(-0.45, 0, 0), bevel=0.012))
    out.append(rbox('CarWindB', (0, 0.205, -0.205), (0.27, 0.07, 0.02), m['glass'], r=(0.45, 0, 0), bevel=0.012))
    for side in (-1, 1):
        out.append(rbox(f'CarWindS{side}', (side * 0.156, 0.208, -0.04), (0.012, 0.064, 0.27), m['glass'], bevel=0.008))
        out.append(star(f'CarStar{side}', frame_z((side * 0.183, 0.112, -0.01), (side, 0, 0)), 0.034, 0.015, 0.006, m['gold']))
        out.append(ell(f'CarHead{side}', (side * 0.12, 0.11, 0.358), (0.035, 0.026, 0.012), m['lamp'], seg=(14, 8)))
        out.append(ell(f'CarTail{side}', (side * 0.13, 0.11, -0.358), (0.03, 0.02, 0.01), m['red'], seg=(12, 8)))
        # Wheel arches.
        for z in (-0.22, 0.22):
            out.append(torus(f'CarArch{side}{z}', (side * 0.18, 0.06, z), 0.072, 0.012, m['tow2'], r=(0, math.pi / 2, 0), seg=20, mseg=6))
    out.append(rbox('CarBumperF', (0, 0.06, 0.36), (0.38, 0.04, 0.04), m['chrome'], bevel=0.015))
    out.append(rbox('CarBumperB', (0, 0.06, -0.36), (0.38, 0.04, 0.04), m['chrome'], bevel=0.015))
    out.append(rbox('CarGrille', (0, 0.1, 0.362), (0.14, 0.03, 0.012), m['tow2'], bevel=0.005))
    # The light bar: a black base the two domes sit on.
    out.append(rbox('CarBar', (0, 0.262, -0.04), (0.22, 0.02, 0.07), m['ink'], bevel=0.008))
    return out


def siren(m, color, x):
    return [ell(f'CarSiren{color}', (x, 0.282, -0.04), (0.05, 0.026, 0.03), m['red' if color == 'Red' else 'blue'], seg=(18, 10))]


def truck(m):
    out = []
    out.append(rbox('TruckChassis', (0, 0.07, -0.05), (0.34, 0.05, 0.86), m['tow2'], bevel=0.015))
    out.append(rbox('TruckCab', (0, 0.17, 0.24), (0.36, 0.2, 0.28), m['tow'], bevel=0.05, segs=4))
    out.append(rbox('TruckHood', (0, 0.13, 0.4), (0.34, 0.12, 0.14), m['tow'], bevel=0.04, segs=3))
    out.append(rbox('TruckWind', (0, 0.22, 0.38), (0.3, 0.08, 0.02), m['glass'], r=(-0.35, 0, 0), bevel=0.01))
    for side in (-1, 1):
        out.append(rbox(f'TruckSide{side}', (side * 0.181, 0.21, 0.25), (0.01, 0.07, 0.15), m['glass'], bevel=0.006))
        out.append(ell(f'TruckHead{side}', (side * 0.12, 0.13, 0.472), (0.032, 0.026, 0.01), m['lamp'], seg=(12, 8)))
    out.append(rbox('TruckBumper', (0, 0.07, 0.47), (0.38, 0.05, 0.04), m['chrome'], bevel=0.015))
    out.append(rbox('TruckGrille', (0, 0.13, 0.472), (0.16, 0.06, 0.01), m['chrome'], bevel=0.004))
    # The flatbed with low rails, and a crane arm with a hook at the back.
    out.append(rbox('TruckBed', (0, 0.115, -0.18), (0.38, 0.03, 0.5), m['tow'], bevel=0.01))
    for side in (-1, 1):
        out.append(rbox(f'TruckRail{side}', (side * 0.18, 0.15, -0.18), (0.02, 0.04, 0.5), m['tow2'], bevel=0.006))
    out.append(rbox('TruckBoomBase', (0, 0.17, 0.06), (0.12, 0.08, 0.08), m['tow2'], bevel=0.01))
    out.append(strand('TruckBoom', [(0, 0.2, 0.06), (0, 0.33, -0.08), (0, 0.36, -0.2)], 0.018, 0.014, m['tow'], ring=8, n=6))
    out.append(cyl('TruckCable', (0, 0.3, -0.2), 0.003, 0.12, m['tow2'], seg=6))
    out.append(torus('TruckHook', (0, 0.225, -0.2), 0.016, 0.005, m['chrome'], r=(0, math.pi / 2, 0), seg=14, mseg=6))
    out.append(rbox('TruckBeaconBase', (0, 0.275, 0.24), (0.1, 0.015, 0.05), m['ink'], bevel=0.005))
    return out


def beacon(m):
    return [ell('TruckBeaconDome', (0, 0.297, 0.24), (0.03, 0.025, 0.03), m['amber'], seg=(16, 8))]


# --------------------------------------------------------------------------
# Trophy and podium
# --------------------------------------------------------------------------

def trophy(m):
    out = [rbox('TrophyPlinth', (0, 0.018, 0), (0.07, 0.036, 0.07), m['wood'], bevel=0.006),
           rbox('TrophyPlate', (0, 0.018, 0.0355), (0.044, 0.016, 0.003), m['gold'], bevel=0.001, segs=1),
           lathe3('TrophyCup', [(0.0, 0.036), (0.028, 0.036), (0.026, 0.044), (0.008, 0.05), (0.007, 0.075), (0.012, 0.082),
                                (0.03, 0.095), (0.042, 0.12), (0.046, 0.15), (0.042, 0.152), (0.038, 0.122), (0.0, 0.1)], m['gold'], seg=32)]
    for side in (-1, 1):
        out.append(strand(f'TrophyHandle{side}', [(side * 0.04, 0.142, 0), (side * 0.068, 0.138, 0), (side * 0.07, 0.112, 0),
                                                   (side * 0.035, 0.1, 0)], 0.0055, 0.0055, m['gold'], ring=8, n=6))
    out.append(star('TrophyStar', frame_z((0, 0.122, 0.041), (0, 0, 1)), 0.016, 0.007, 0.005, m['gold']))
    return out


def podium(m):
    out = [rbox('PodiumBlock', (0, 0.09, 0), (0.42, 0.18, 0.42), m['podium'], bevel=0.025, segs=3),
           rbox('PodiumTop', (0, 0.183, 0), (0.44, 0.02, 0.44), m['gold'], bevel=0.008),
           rbox('PodiumFoot', (0, 0.008, 0), (0.46, 0.016, 0.46), m['gold'], bevel=0.006),
           rbox('PodiumCarpet', (0, 0.198, 0), (0.36, 0.008, 0.36), m['carpet'], bevel=0.003)]
    # A big gold "1" on each face.
    for k in range(4):
        R = M(r=(0, k * math.pi / 2, 0))
        out.append(rbox(f'PodiumOne{k}', (0, 0.09, 0.213), (0.03, 0.12, 0.012), m['gold'], parent=R, bevel=0.004))
        out.append(rbox(f'PodiumFlag{k}', (-0.022, 0.135, 0.213), (0.03, 0.022, 0.012), m['gold'], parent=R, r=(0, 0, 0.6), bevel=0.004))
        out.append(rbox(f'PodiumBase{k}', (0, 0.034, 0.213), (0.07, 0.016, 0.012), m['gold'], parent=R, bevel=0.004))
    return out


# --------------------------------------------------------------------------

def preview(nodes, path):
    """A lineup render (Cycles) to eyeball the cast; not used by the game."""
    layout = {'CopBody': (-0.3, 0, 0), 'CopHeadA': (-0.3, HEAD_Y, 0),
              'CopHandL': (-0.3 + HAND_REST[0], HAND_REST[1], HAND_REST[2]), 'CopHandR': (-0.3 - HAND_REST[0], HAND_REST[1], HAND_REST[2]),
              'CopFootL': (-0.3 + FOOT_REST[0], 0, FOOT_REST[2]), 'CopFootR': (-0.3 - FOOT_REST[0], 0, FOOT_REST[2]),
              'CopHeadB': (0.05, HEAD_Y + 0.25, 0), 'CopBaton': (0.05, 0.05, 0.1),
              'CarBody': (0.75, 0, -0.1), 'CarSirenRed': (0.75, 0, -0.1), 'CarSirenBlue': (0.75, 0, -0.1),
              'TruckBody': (-1.0, 0, -0.3), 'TruckBeacon': (-1.0, 0, -0.3),
              'Trophy': (0.25, 0, 0.25), 'Podium': (0.25, 0, -0.35)}
    for n in nodes:
        n.location = blib.V(*layout.get(n.name, (5, 5, 5)))
    for x, z in ((0.57, 0.12), (0.93, 0.12), (0.57, -0.32), (0.93, -0.32)):
        w = bpy.data.objects.new('PrevWheel', bpy.data.objects['CarWheel'].data)
        blib.link(w)
        w.location = blib.V(x, 0.063, z)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    blib.link(cam)
    cam.location = blib.V(-0.1, 0.75, 2.3)
    cam.rotation_euler = (math.radians(73), 0, 0)
    cam.data.lens = 40
    sc = bpy.context.scene
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
    blib.box('Ground', (6, 0.02, 4), (0, -0.01, 0), blib.flat('#d8d2bf', 0.8))
    sc.render.resolution_x, sc.render.resolution_y = 1100, 640
    sc.cycles.samples = 16
    sc.cycles.use_denoising = True
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    blib.log('preview', path)


def main():
    blib.reset()
    m = materials()
    nodes = [
        node(cop_body(m), 'CopBody', fuse_mats=('navy',), budget=2200),
        node(cop_head(m, 'A'), 'CopHeadA', fuse_mats=('skin', 'navy')),
        node(cop_head(m, 'B'), 'CopHeadB', fuse_mats=('skin', 'navy')),
        node(mitten('Cop', 'HandL', m, 'white', 1), 'CopHandL', fuse_mats=('white',), budget=500),
        node(mitten('Cop', 'HandR', m, 'white', -1), 'CopHandR', fuse_mats=('white',), budget=500),
        node(cop_foot(m, 1), 'CopFootL'),
        node(cop_foot(m, -1), 'CopFootR'),
        node(baton(m), 'CopBaton'),
        node(car(m), 'CarBody'),
        node(siren(m, 'Red', -0.055), 'CarSirenRed'),
        node(siren(m, 'Blue', 0.055), 'CarSirenBlue'),
        node(wheel(m), 'CarWheel'),
        node(truck(m), 'TruckBody'),
        node(beacon(m), 'TruckBeacon'),
        node(trophy(m), 'Trophy'),
        node(podium(m), 'Podium'),
    ]
    for n in nodes:
        blib.log(n.name, f'{len(n.data.polygons)}f')
    if '--preview' in sys.argv:
        preview(nodes, sys.argv[sys.argv.index('--preview') + 1])
        for n in nodes:
            n.location = (0, 0, 0)
        for o in [o for o in bpy.context.scene.objects if o.name.startswith(('PrevWheel', 'Ground', 'Cam', 'Sun'))]:
            bpy.data.objects.remove(o)
    blib.export_glb(nodes, 'models/cops.glb', images='NONE')
    blib.record('cops', {'url': '/models/cops.glb'})


if __name__ == '__main__':
    main()
