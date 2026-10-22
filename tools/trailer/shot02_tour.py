"""Shot 2, the tour: the camera flies into the lounge and circles the big table, whipping
round twice; each whip lands on the next game on the same table.

  0.0-2.55  arrival on the Monopoly board: a Chog hopping along the bottom row, houses up.
  2.55      whip -> Cards: four Chogs round a purple felt, a card flicked onto the pile.
  5.05      whip -> Poker: green felt, chips, the board out; the camera settles low.

The whips are fast enough that the edit adds a horizontal smear over them (assemble step).
"""

import math
import random

import bpy

import film
from film import V, lerp, lerpv, seg, smooth, smoother, ease_out, clamp
import lounge
import tablekit as tk
from lounge import tile, BUILD

SHOT = 'shot02'
DUR = 7.5
BIG = 3.9
SEAT_R = 5.7
SWAP = (2.55, 5.05)
WHIP = 0.46
HIDE = (0, -40, 0)

sc = film.setup_render(film.blib.reset())
world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.005, 0.02, 1)
sc.world = world
lounge.room()
lounge.board('classic')
lounge.lights()
slab = bpy.data.objects['Board']
trim = bpy.data.materials['TableTrim']
felts = {'cards': tk.felt('#3a1f78', trim), 'poker': tk.felt('#145a4a', trim)}
LIGHT = {'board': (2600, 900, 1600), 'cards': (900, 500, 1400), 'poker': (1000, 500, 1400)}

rnd = random.Random(5)
hero = film.Chog(scale=lounge.FIG)
chogs = [hero] + [lounge.clone_chog(hero, shoe=c) for c in ('#3b8cff', '#ffd23f', '#35c97a')]
houses = [lounge.building('house') for _ in range(3)]
hotel = lounge.building('hotel', color='#d8343a')
dice = [lounge.die('DieA', top=5), lounge.die('DieB', top=3)]

# Cards: a draw pile, a discard pile, one card in flight.
pile = [tk.card('back', 'cards') for _ in range(7)]
discard = [tk.card(f, 'cards') for f in ('red-7', 'green-draw2', 'blue-9', 'yellow-reverse')]
flick = tk.card('wild-wild4', 'cards')
fans = [[tk.card('back', 'cards') for _ in range(4)] for _ in range(3)]
# Poker: stacks at each seat, a pot, the board.
stacks = [tk.stack(rnd.randint(5, 9), tk.CHIP_COLS[(k + j) % 5], rnd) for k in range(4) for j in range(2)]
pot = [tk.stack(rnd.randint(3, 7), tk.CHIP_COLS[k], rnd) for k in range(4)]
board = [tk.card(f, 'poker') for f in ('As', 'Kh', 'Qs', 'Jh', '10d')]
holes = [tk.card('back', 'poker') for _ in range(8)]
cam = film.camera(lens=30)

SEATS = [(-SEAT_R, 0.0, 90.0), (0.0, -SEAT_R, 0.0), (SEAT_R, 0.0, -90.0), (0.0, SEAT_R, 180.0)]


def seat_xyz(i, fwd=0.0, side=0.0, up=0.0):
    sx, sz, yaw = SEATS[i]
    r = math.radians(yaw)
    fx, fz = math.sin(r), math.cos(r)
    return (sx + fx * fwd + fz * side, tk.FELT_Y + up, sz + fz * fwd - fx * side)


def game_at(t):
    return 'board' if t < SWAP[0] else ('cards' if t < SWAP[1] else 'poker')


def hide(*obs):
    for o in obs:
        o.location = V(*HIDE)


def idle(t, i):
    q = film.rest()
    q['rot'][2] = 0.035 * math.sin(2 * math.pi * 0.55 * t + i * 1.7)
    q['squash'] = 1 + 0.015 * math.sin(2 * math.pi * 1.1 * t + i)
    return q


def board_phase(t):
    # The hero hops along the bottom row, one space every 0.36 s.
    k, u = divmod(max(t - 0.2, 0) / 0.36, 1)
    k = int(min(k, 6))
    if t - 0.2 > 0.36 * 7:
        u = 0.0
    a, b = tile(k), tile(k + 1)
    air = math.sin(math.pi * clamp((u - 0.12) / 0.76))
    crouch = (1 - smooth(u / 0.12)) if u < 0.12 else (smooth((u - 0.88) / 0.12) if u > 0.88 else 0.0)
    w = smoother(clamp((u - 0.12) / 0.76))
    q = film.rest()
    q['squash'] = 1.0 + 0.08 * air - 0.12 * crouch
    for i, side in enumerate((1, -1)):
        q['hands'][i] = [side * (0.11 + 0.03 * air), 0.115 + 0.08 * air, 0.015, 0, side * 0.5 * air]
        q['feet'][i][1] = 0.02 * air
    hero.scale = lounge.FIG
    hero.pose(q, (lerp(a[0], b[0], w), 0.42 * air, lerp(a[1], b[1], w)), -90)
    # A waver on the left side, a Chog by its hotel at the top right.
    q = idle(t, 1)
    q['hands'][0] = [0.12, 0.38, 0.03, 0, 0.9 + 0.35 * math.sin(2 * math.pi * 2.2 * t)]
    p = tile(13)
    chogs[1].scale = lounge.FIG
    chogs[1].pose(q, (p[0], 0, p[1]), 60)
    p = tile(37)
    chogs[2].scale = lounge.FIG
    chogs[2].pose(idle(t, 2), (p[0] - 0.1, 0, p[1]), -120)
    chogs[3].pose(film.rest(), HIDE, 0)
    for h, i in zip(houses, (21, 23, 23)):
        p = tile(i)
        lounge.place(h, (p[0] + (0.2 if h is houses[2] else -0.2 if i == 23 else 0), 0, p[1] + 0.47), 180, BUILD)
    p = tile(39)
    lounge.place(hotel, (p[0] - 0.47, 0, p[1]), 90, BUILD)
    lounge.set_die(dice[0], (0.5, 0.25, 0.9), (0, 0, 0.3))
    lounge.set_die(dice[1], (1.15, 0.25, 0.55), (0, math.pi, 1.1))


def seat_chogs(t, cheer=None):
    for i, ch in enumerate(chogs):
        if i == 3 and t >= SWAP[1]:
            # Poker seats three, leaving the camera's side open for the closing push.
            ch.pose(film.rest(), HIDE, 0)
            continue
        ch.scale = BIG
        q = idle(t, i)
        if cheer == i:
            up = ease_out(seg(t, SWAP[0] + 1.3, SWAP[0] + 1.6))
            for j, side in enumerate((1, -1)):
                q['hands'][j] = [side * lerp(0.11, 0.17, up), lerp(0.115, 0.4, up), 0.03, 0, side * 0.9 * up]
            q['pos'][1] = 0.04 * abs(math.sin(2 * math.pi * 2.5 * t)) * up
        sx, sz, yaw = SEATS[i]
        ch.pose(q, (sx, tk.FELT_Y, sz), yaw)


def cards_phase(t):
    seat_chogs(t, cheer=2)
    for k, c in enumerate(pile):
        tk.put(c, (-1.45, tk.FELT_Y + 0.01 + 0.012 * k, 0.35), (math.pi, 0, 0.05 * math.sin(k * 3.1)))
    for k, c in enumerate(discard):
        tk.put(c, (1.45, tk.FELT_Y + 0.012 + 0.012 * k, 0.35), (0, 0, 0.5 * math.sin(k * 2.3)))
    # A Wild Four flicked from the left seat onto the discard pile.
    f = smoother(seg(t, SWAP[0] + 0.9, SWAP[0] + 1.35))
    a = seat_xyz(0, fwd=0.9, up=1.2)
    b = (1.45, tk.FELT_Y + 0.07, 0.35)
    p = lerpv(a, b, f)
    tk.put(flick, (p[0], p[1] + 0.9 * math.sin(math.pi * f), p[2]), (0, -1.2 * (1 - f), 4 * math.pi * f + 0.3))
    for i, fan in enumerate(fans):
        seat = (1, 2, 3)[i]
        r = math.radians(SEATS[seat][2])
        for k, c in enumerate(fan):
            a = (k - 1.5) * 0.16
            p = seat_xyz(seat, fwd=1.0, side=0.55 + a * 1.6, up=0.62 - abs(a) * 0.2)
            tk.put(c, p, (math.pi / 2 - 0.45, r + math.pi, -a * 1.4), 0.8)


def poker_phase(t):
    seat_chogs(t, cheer=1)
    for n, s in enumerate(stacks):
        i, j = divmod(n, 2)
        if i == 3:
            continue
        p = seat_xyz(i, fwd=1.7, side=0.9 + 0.7 * j)
        s.location = V(*p)
    for k, s in enumerate(pot):
        s.location = V(-0.7 + 0.45 * k, tk.FELT_Y, 1.2 + 0.25 * math.sin(k * 2.0))
    for k, c in enumerate(board):
        tk.put(c, (-2.4 + 1.2 * k, tk.FELT_Y + 0.006, -0.3), (0, 0, 0))
    for n, c in enumerate(holes):
        i, j = divmod(n, 2)
        if i == 3:
            hide(c)
            continue
        p = seat_xyz(i, fwd=1.4, side=-0.35 + 0.7 * j)
        tk.put(c, (p[0], tk.FELT_Y + 0.008, p[2]), (math.pi, 0, math.radians(SEATS[i][2] + 90) + 0.1 * j))


def theta(t):
    """Orbit angle (degrees, 0 = in front of the table): a steady drift plus two whips."""
    th = -100 + 24 * t
    for s in SWAP:
        th += 140 * smoother((t - (s - WHIP / 2)) / WHIP)
    return th


def frame(t):
    g = game_at(t)
    hide(slab, *felts.values(), *houses, hotel, *dice, *pile, *discard, flick, *[c for f in fans for c in f],
         *stacks, *pot, *board, *holes)
    if g == 'board':
        slab.location = (0, 0, 0)
        board_phase(t)
    else:
        felts[g].location = V(0, tk.FELT_Y, 0)
        (cards_phase if g == 'cards' else poker_phase)(t)
    for n, e in zip(('TablePool', 'Fill', 'Rim'), LIGHT[g]):
        bpy.data.objects[n].data.energy = e

    arrive = smoother(seg(t, 0.0, 2.0))
    settle = smoother(seg(t, 5.6, DUR))
    r = lerp(lerp(12.0, 10.5, arrive), 7.4, settle)
    h = lerp(lerp(6.2, 4.6, arrive), 2.1, settle)
    th = math.radians(theta(t))
    tgt_y = lerp(0.2, 1.0, settle) if g != 'board' else 0.0
    pos = (r * math.sin(th), h, r * math.cos(th))
    film.place_camera(cam, pos, (0, tgt_y, lerp(0, -1.2, settle)), lens=lerp(30, 32, settle))


if '--probe' in film.ARGS:
    # What stands between the camera and the table centre over the shot.
    for k in range(0, int(DUR * 4) + 1):
        t = k / 4
        frame(t)
        bpy.context.view_layer.update()
        o = cam.matrix_world.translation
        d = (V(0, 0.3, 0) - o)
        hit, loc, _, _, ob, _ = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), o, d.normalized(), distance=d.length)
        print('PROBE', t, tuple(round(x, 1) for x in o), ob.name if hit else '-', round((loc - o).length, 1) if hit else '')
else:
    film.render(SHOT, DUR, frame)
