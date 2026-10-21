"""Shot 3, Monopoly in the lounge, four beats on the Classic board in the Chog look:

  0.0-2.6  the dice: a Chog on START shakes the dice over its head and throws;
           they tumble across the board past a low camera and land 4 and 2.
  2.6-5.0  the hop: it hops six spaces along the bottom row, the camera gliding
           alongside at knee height, and lands on Spade Street with a fist pump.
  5.0-7.6  the hotel: houses pop onto a street one per beat, four of them, then
           squash together and a hotel pops up; the owner rubs its hands.
  7.6-10.0 busted: the police car skids in on the corner, two cops grab a Chog
           and lift it off its feet, legs kicking.

    tools/blender/run.sh ../trailer/shot03_monopoly.py [--draft] [--stills 1,3.5] [--every 6]
"""

import math
import random

import bpy
from mathutils import Euler, Vector

import film
from film import V, lerp, lerpv, seg, smooth, smoother, ease_out, ease_in, damped, clamp
import lounge
from lounge import tile, FIG, BUILD

SHOT = 'shot03'
DUR = 10.0

sc = film.setup_render(film.blib.reset())
world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.005, 0.02, 1)
sc.world = world
lounge.room()
lounge.board('classic')
lounge.lights()

hero = film.Chog(scale=FIG)
rival = lounge.clone_chog(hero, shoe='#3b8cff')
owner = lounge.clone_chog(hero, shoe='#ffd23f')
extra = lounge.clone_chog(hero, shoe='#35c97a')
d1 = lounge.die('DieA', top=4)
d2 = lounge.die('DieB', top=2)
houses = [lounge.building('house') for _ in range(4)]
hotel = lounge.building('hotel')
kit = lounge.cop_kit()
cam = film.camera(lens=32)

HIDE = (0, -20, 0)


def hide_all():
    for c in (hero, rival, owner, extra):
        c.pose(film.rest(), HIDE, 0)
    for d in (d1, d2):
        d.location = V(*HIDE)
    for h in houses + [hotel]:
        h.location = V(*HIDE)
    for k in ('car', 'sirenR', 'sirenB'):
        kit[k].location = V(*HIDE)
    for w in kit['wheels']:
        w.location = V(*HIDE)
    for c in kit['cops']:
        for p in c.values():
            p.location = V(*HIDE)


S0 = tile(0)
ROW_YAW = -90.0                       # facing along the bottom row (toward -x)
THROW_YAW = math.degrees(math.atan2(-1.0, -0.55))
LAND = [(1.6, 2.35), (0.95, 2.9)]      # where the dice settle (game x, z)
DICE_UP, DICE_HIT1, DICE_HIT2, DICE_REST = 0.95, 1.38, 1.7, 2.05
HOP0, HOP_DT, HOPS = 2.75, 0.34, 6
HOUSE_AT = [5.6, 6.05, 6.5, 6.95]
HOTEL_AT = 7.35
CAR_IN, CAR_STOP = 8.0, 8.75
GRAB, LIFT = 9.2, 9.45
BUSTED = tile(30)


def shake_pose(t):
    """Dice held over the head, shaken."""
    q = film.rest()
    w = math.sin(2 * math.pi * 7 * t)
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * 0.055 + 0.012 * w, 0.36 + 0.012 * w * side, 0.03, 0.0, side * 0.3]
    q['head'] = [-0.25, 0, 0.05 * w]
    q['rot'][2] = 0.04 * w
    q['squash'] = 1.0 + 0.02 * w
    return q


def throw_pose(k):
    """Arms swing from overhead to forward and down as the dice leave (k 0-1)."""
    q = film.rest()
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * lerp(0.055, 0.09, k), lerp(0.36, 0.16, ease_out(k)), lerp(0.03, 0.16, ease_out(k)), lerp(0, -0.6, k), side * 0.3 * (1 - k)]
    q['rot'][0] = 0.2 * math.sin(math.pi * k)
    q['head'] = [lerp(-0.25, 0.05, k), 0, 0]
    return q


def fist_pump(t):
    q = film.rest()
    k = ease_out(seg(t, 0.0, 0.18)) * (1 - smooth(seg(t, 0.45, 0.6)))
    pump = 0.5 + 0.5 * math.sin(2 * math.pi * 3.2 * t)
    q['hands'][1] = [-0.1, lerp(0.115, 0.3 + 0.03 * pump, k), lerp(0.015, 0.05, k), 0, -0.4 * k]
    q['squash'] = 1.0 + 0.05 * k * pump
    q['pos'][1] = 0.03 * k * pump
    q['head'] = [-0.12 * k, 0, 0]
    return q


def rub_hands(t):
    q = film.rest()
    w = math.sin(2 * math.pi * 5 * t)
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * 0.02 + 0.012 * w * side, 0.14 + 0.008 * w, 0.075, 0.2, side * 0.6]
    q['head'] = [-0.1, 0.2 * math.sin(2 * math.pi * 1.2 * t), 0]
    q['squash'] = 1.0 + 0.015 * w
    return q


def hop_pose(u):
    """One hop, u 0-1: crouch, stretch in the air, squash on landing."""
    q = film.rest()
    air = math.sin(math.pi * clamp((u - 0.12) / 0.76))
    crouch = (1 - smooth(u / 0.12)) if u < 0.12 else (smooth((u - 0.88) / 0.12) if u > 0.88 else 0.0)
    q['squash'] = 1.0 + 0.08 * air - 0.12 * crouch
    q['rot'][0] = 0.1 * crouch - 0.06 * air
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * (0.11 + 0.03 * air), 0.115 + 0.08 * air, 0.015, 0, side * 0.5 * air]
        q['feet'][i][1] = 0.02 * air
        q['feet'][i][3] = 0.3 * air
    return q, air


def die_state(d, i, t):
    """Thrown from over the Chog's head, two bounces, a short slide, then still with its value up."""
    start = Vector((S0[0] - 0.05 + 0.08 * i, 0.98, S0[1] - 0.05))
    end = Vector((LAND[i][0], 0.25, LAND[i][1]))
    rnd = random.Random(i * 7 + 3)
    spin = Vector((rnd.uniform(9, 14), rnd.uniform(6, 11), rnd.uniform(5, 9)))
    if t < DICE_UP:
        w = math.sin(2 * math.pi * 7 * t)
        p = start + Vector((0.03 * w * (1 if i else -1), 0.02 * w, 0))
        lounge.set_die(d, tuple(p), (0.4 * i + 0.3 * w, 0.2 * w, 0.5 * i))
        return
    u = seg(t, DICE_UP, DICE_REST)
    # Horizontal travel eases out; height: an arc to the first hit, two smaller bounces, then flat.
    k = ease_out(u) if u < 1 else 1.0
    pos = start.lerp(end, k)
    y = 0.25
    if t < DICE_HIT1:
        a = seg(t, DICE_UP, DICE_HIT1)
        y = lerp(start.y, 0.25, a) + 0.55 * math.sin(math.pi * a)
    elif t < DICE_HIT2:
        a = seg(t, DICE_HIT1, DICE_HIT2)
        y = 0.25 + 0.28 * math.sin(math.pi * a)
    elif t < DICE_HIT2 + 0.16:
        a = seg(t, DICE_HIT2, DICE_HIT2 + 0.16)
        y = 0.25 + 0.07 * math.sin(math.pi * a)
    pos.y = y
    left = (1 - clamp(u)) ** 2
    yaw = 0.35 if i == 0 else -0.25
    lounge.set_die(d, tuple(pos), (spin.x * left, spin.y * left, yaw + spin.z * left))


def cop_pose(c, at, yaw, t, carry=0.0, walk=0.0):
    """A cop: body, head, mittens and boots placed like the game's rig (scale FIG)."""
    s = FIG
    root = Vector(at)
    bob = 0.015 * abs(math.sin(2 * math.pi * 3 * t)) * walk
    def put(ob, local, rot=(0, 0, 0)):
        r = math.radians(yaw)
        x, y, z = local
        wx = x * math.cos(r) + z * math.sin(r)
        wz = -x * math.sin(r) + z * math.cos(r)
        ob.location = V(root.x + wx * s, root.y + (y + bob) * s, root.z + wz * s)
        ob.rotation_euler = (rot[0], rot[2], r + rot[1])
        ob.scale = (s, s, s)
    put(c['body'], (0, 0, 0))
    put(c['head'], (0, 0.36, 0))
    lift = 0.06 * carry
    put(c['handL'], (0.12, 0.17 + lift, 0.03 + 0.06 * carry))
    put(c['handR'], (-0.12, 0.17 + lift, 0.03 + 0.06 * carry))
    st = math.sin(2 * math.pi * 3 * t) * walk
    put(c['footL'], (0.045, 0.0, 0.01 + 0.04 * st))
    put(c['footR'], (-0.045, 0.0, 0.01 - 0.04 * st))


def place_car(t):
    """Skids in from the right, swinging sideways, and stops by the corner; sirens flashing."""
    s = FIG
    u = seg(t, CAR_IN, CAR_STOP)
    k = ease_out(u)
    start = Vector((10.0, 0.0, -1.8))
    stop = Vector((BUSTED[0] - 0.2, 0.0, BUSTED[1] + 1.35))
    pos = start.lerp(stop, k)
    yaw = lerp(-70, 10, smooth(u)) + 6 * damped(t - CAR_STOP, 2.0, 5.0)
    r = math.radians(yaw)
    def put(ob, local, extra_yaw=0.0):
        x, y, z = local
        wx = x * math.cos(r) + z * math.sin(r)
        wz = -x * math.sin(r) + z * math.cos(r)
        ob.location = V(pos.x + wx * s, pos.y + y * s, pos.z + wz * s)
        ob.rotation_euler = (0, 0, r + extra_yaw)
        ob.scale = (s, s, s)
    put(kit['car'], (0, 0, 0))
    flash = int(t * 8) % 2
    put(kit['sirenR'], (0, 0, 0))
    put(kit['sirenB'], (0, 0, 0))
    for name, on in (('sirenR', flash), ('sirenB', not flash)):
        for ch in kit[name].children:
            for m in ch.data.materials:
                b = m.node_tree.nodes.get('Principled BSDF') if m and m.use_nodes else None
                if b:
                    b.inputs['Emission Color'].default_value = b.inputs['Base Color'].default_value
                    b.inputs['Emission Strength'].default_value = 25.0 if on else 0.5
    for i, (x, z) in enumerate(((0.17, 0.24), (-0.17, 0.24), (0.17, -0.24), (-0.17, -0.24))):
        put(kit['wheels'][i], (x, 0.0, z))
    return pos, yaw


def frame(t):
    hide_all()
    # The other players wait at the corners of the shot.
    if t < 7.95:
        extra.pose(film.rest(), (tile(13)[0], 0, tile(13)[1]), 90)
    if t < 2.6:
        # The throw.
        if t < DICE_UP:
            q = shake_pose(t)
        else:
            q = throw_pose(seg(t, DICE_UP, DICE_UP + 0.3))
            if t > DICE_UP + 0.5:
                q['head'] = [0.15, 0.4 * smooth(seg(t, 1.3, 1.8)), 0]
        hero.pose(q, (S0[0], 0, S0[1]), THROW_YAW)
        die_state(d1, 0, t)
        die_state(d2, 1, t)
        # The camera faces the thrower from the board; the dice fly past it and it swings round to watch them land.
        k = smoother(seg(t, 1.05, 1.9))
        pos = lerpv((3.05, 0.5, 3.35), (2.75, 0.55, 3.75), k)
        at = lerpv((S0[0], 0.62, S0[1]), (1.25, 0.22, 2.6), k)
        focus = math.dist(pos, at)
        film.place_camera(cam, pos, at, lens=lerp(34, 40, k), dof=(focus, 2.8))
        return
    if t < 5.4:
        # The hop along the bottom row, six spaces; the dice still lie on the board.
        lounge.set_die(d1, (LAND[0][0], 0.25, LAND[0][1]), (0, 0, 0.35))
        lounge.set_die(d2, (LAND[1][0], 0.25, LAND[1][1]), (0, 0, -0.25))
        n = clamp((t - HOP0) / HOP_DT, 0, HOPS)
        i = min(int(n), HOPS - 1)
        u = n - i if n < HOPS else 1.0
        a, b = tile(i), tile(i + 1)
        if n >= HOPS:
            pos = (tile(HOPS)[0], 0.0, tile(HOPS)[1])
            q = fist_pump(t - (HOP0 + HOPS * HOP_DT) - 0.05)
            yaw = lerp(ROW_YAW, -25, smooth(seg(t, 4.85, 5.1)))
        elif t < HOP0:
            pos, q, yaw = (a[0], 0.0, a[1]), film.rest(), lerp(THROW_YAW, ROW_YAW, smooth(seg(t, 2.6, HOP0)))
        else:
            q, air = hop_pose(u)
            k = smooth(clamp((u - 0.12) / 0.76))
            pos = (lerp(a[0], b[0], k), 0.3 * air, lerp(a[1], b[1], k))
            yaw = ROW_YAW
        hero.pose(q, pos, yaw)
        # Knee height, alongside: the camera follows the Chog's average position over the last
        # third of a second (a pure function of time, so any frame renders on its own).
        follow = pos[0]
        cx = sum(hop_x(t - 0.3 * j / 8) for j in range(9)) / 9
        film.place_camera(cam, (cx + 0.2, 0.62, 7.0), (cx - 0.45, 0.42, 4.75), lens=32,
                          dof=(math.dist((cx + 0.2, 0.62, 7.0), (follow, 0.35, 4.75)), 2.4))
        return
    if t < 7.95:
        # The street fills: four houses, then a hotel; the owner stands on its space rubbing its hands.
        ts = tile(HOPS)
        lounge.set_die(d1, (LAND[0][0], 0.25, LAND[0][1]), (0, 0, 0.35))
        lounge.set_die(d2, (LAND[1][0], 0.25, LAND[1][1]), (0, 0, -0.25))
        q = rub_hands(t) if t > HOTEL_AT + 0.05 else film.rest()
        if t <= HOTEL_AT + 0.05:
            q['head'] = [0.1, 0.5, 0]
        hero.pose(q, (ts[0] + 0.05, 0, ts[1] + 0.32), lerp(-25, 15, smooth(seg(t, 7.3, 7.6))))
        squash = smooth(seg(t, HOTEL_AT - 0.22, HOTEL_AT - 0.04))
        for k, h in enumerate(houses):
            at = HOUSE_AT[k]
            if t < at or t > HOTEL_AT:
                continue
            g = seg(t, at, at + 0.22)
            scale = BUILD * (ease_out(g) * 1.0 + 0.22 * math.sin(math.pi * g))
            x = ts[0] + 0.3 - 0.2 * k
            x = lerp(x, ts[0], squash)
            lounge.place(h, (x, 0, ts[1] - 0.47), 0, max(scale, 0.001), 1 - 0.7 * squash)
        if t >= HOTEL_AT:
            g = seg(t, HOTEL_AT, HOTEL_AT + 0.3)
            sq = 1 + 0.25 * damped(t - HOTEL_AT - 0.12, 2.5, 6.0) if g >= 0.4 else 1.0
            lounge.place(hotel, (ts[0], 0, ts[1] - 0.47), 0, BUILD * (ease_out(g) + 0.25 * math.sin(math.pi * g)), sq)
        cx = ts[0]
        film.place_camera(cam, (cx + 0.9, 0.55, ts[1] + 1.7), (cx - 0.05, 0.22, ts[1] - 0.35), lens=40,
                          dof=(math.dist((cx + 0.9, 0.55, ts[1] + 1.7), (cx, 0.2, ts[1] - 0.45)), 2.4))
        return
    # Busted: the car skids in, the cops hop out, grab the Chog and lift it, legs kicking.
    bx, bz = BUSTED
    pos, yaw = place_car(t)
    q = film.rest()
    lifted = smooth(seg(t, LIFT, LIFT + 0.25))
    if t > CAR_STOP - 0.2:
        q['head'] = [0.0, 0.6, 0]
        q['lids'] = 0.0
    if t > GRAB:
        for i, side in enumerate((1, -1)):
            q['hands'][i] = [side * 0.15, 0.2, 0.0, 0, side * 0.9]
    if lifted > 0:
        kick = math.sin(2 * math.pi * 6 * t)
        for i, side in enumerate((1, -1)):
            q['feet'][i][2] = R_FOOT_Z + 0.05 * kick * side
            q['feet'][i][1] = 0.02 + 0.015 * kick * side
        q['head'] = [-0.15, 0.3 * math.sin(2 * math.pi * 2 * t), 0]
    carry_x = lerp(0.0, 0.7, smooth(seg(t, 9.75, 10.5)))
    chog_at = (bx - 0.1 + carry_x, 0.22 * lifted, bz + 0.25)
    rival.pose(q, chog_at, 0)
    out = smooth(seg(t, CAR_STOP + 0.05, GRAB))
    for k, c in enumerate(kit['cops']):
        side = 1 if k == 0 else -1
        door = Vector((pos.x - 0.35 * side, 0, pos.z - 0.2))
        hold = Vector((chog_at[0] + 0.28 * side, 0.0, chog_at[2] + 0.02))
        if t < CAR_STOP + 0.05:
            continue
        p = door.lerp(hold, out)
        hop = 0.18 * math.sin(math.pi * out) if out < 1 else 0.0
        p.y = hop
        cop_pose(c, tuple(p), -90 * side, t, carry=lifted, walk=1.0 if 9.75 < t else 0.0)
    shake = 0.03 * damped(t - CAR_STOP, 6.0, 9.0)
    film.place_camera(cam, (bx - 1.7, 0.75 + shake, bz + 2.6), (bx + 0.1, 0.35 + shake, bz + 0.3), lens=30)


R_FOOT_Z = film.R.FOOT_REST[2]


def hop_x(t):
    n = clamp((t - HOP0) / HOP_DT, 0, HOPS)
    i = min(int(n), HOPS - 1)
    u = n - i if n < HOPS else 1.0
    k = smooth(clamp((u - 0.12) / 0.76))
    return lerp(tile(i)[0], tile(i + 1)[0], k)


film.render(SHOT, DUR, frame)
