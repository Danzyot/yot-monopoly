"""Shot 8, the finale: the crew of four stands in a row on the felt among pieces from all
three games (dice, cards, chips, a house and a hotel), crouches, and jumps together with
their arms up while the camera cranes up and back over the table; the end card follows.

  0.0-1.2  a low glide across the felt toward the row; dice still rolling to a stop.
  1.2-1.55 crouch (staggered), 1.55-2.1 the jump, 2.1+ landing and a cheer bounce.
  1.3-4.0  crane up and back to a high wide of the table and the lounge.
"""

import math
import random

import bpy

import film
from film import V, lerp, lerpv, seg, smooth, smoother, ease_out, ease_in, clamp
import lounge
import tablekit as tk
from lounge import BUILD

SHOT = 'shot08'
DUR = 4.0
BIG = 3.9

sc = film.setup_render(film.blib.reset())
world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.01, 0.005, 0.02, 1)
sc.world = world
lounge.room()
finish = film.principled('TableFinish', '#2a1650', rough=0.28, coat=0.6)
trim = film.principled('TableTrim', '#d8a64a', rough=0.3, metal=1.0)
lounge.table.build(finish, trim)
tk.felt('#3a1f78', trim)
film.area_light('TablePool', V(0, 9.0, 2.0), V(0, 0, 0), 1100, 7.0, (1.0, 0.86, 0.7))
film.area_light('Fill', V(7, 4.5, 11), V(0, 0.8, 0), 700, 6.0, (0.7, 0.72, 1.0))
film.area_light('Rim', V(-3, 5.0, -12), V(0, 1.0, 0), 1500, 6.0, (1.0, 0.45, 0.8))
for n in ('TablePool', 'Fill', 'Rim'):
    bpy.data.objects[n].visible_glossy = False

rnd = random.Random(8)
lead = film.Chog(scale=BIG)
crew = [lounge.clone_chog(lead, shoe='#3b8cff', scale=BIG), lead,
        lounge.clone_chog(lead, shoe='#ffd23f', scale=BIG), lounge.clone_chog(lead, shoe='#35c97a', scale=BIG)]
ROW = [(-2.25, 0.25), (-0.75, -0.1), (0.75, -0.1), (2.25, 0.25)]
YAW = [18, 6, -6, -18]

dice = [lounge.die('DieA', top=6, size=0.7), lounge.die('DieB', top=6, size=0.7)]
for k, (f, p, r) in enumerate((('wild-wild4', (-3.4, 2.6), 0.4), ('red-7', (3.1, 2.9), -0.3), ('blue-9', (3.6, 1.8), 0.9),
                               ('back', (-2.9, 3.5), 1.2))):
    tk.put(tk.card(f, 'cards'), (p[0], tk.FELT_Y + 0.01 + 0.004 * k, p[1]), (0, 0, r))
for k, (f, p, r) in enumerate((('As', (-1.2, 3.6), 0.2), ('Kh', (-0.3, 3.75), -0.15))):
    tk.put(tk.card(f, 'poker'), (p[0], tk.FELT_Y + 0.02, p[1]), (0, 0, r))
for k, (x, z) in enumerate(((1.4, 3.3), (1.85, 3.0), (-4.2, 1.2), (4.3, 0.6), (0.6, 4.4))):
    tk.stack(rnd.randint(3, 8), tk.CHIP_COLS[k % 5], rnd).location = V(x, tk.FELT_Y, z)
house = lounge.building('house')
hotel = lounge.building('hotel', color='#d8343a')
lounge.place(house, (-4.3, tk.FELT_Y, -0.9), 25, BUILD * 2.6)
lounge.place(hotel, (4.4, tk.FELT_Y, -1.2), -20, BUILD * 2.6)
cam = film.camera(lens=34)

CROUCH = [1.2, 1.26, 1.22, 1.3]
JUMP = 0.35            # crouch length; the jump starts at CROUCH + JUMP
AIR = 0.55


def crew_pose(t, i):
    q = film.rest()
    q['rot'][2] = 0.03 * math.sin(2 * math.pi * 0.6 * t + i * 1.9)
    t0 = CROUCH[i]
    t1 = t0 + JUMP
    t2 = t1 + AIR
    y = 0.0
    if t < t0:
        return q, y
    c = smooth(seg(t, t0, t1))                         # crouch, arms back
    a = math.sin(math.pi * clamp((t - t1) / AIR))       # in the air
    up = ease_out(seg(t, t1 - 0.05, t1 + 0.15))         # arms thrown up
    land = math.sin(math.pi * seg(t, t2, t2 + 0.22))    # landing squash
    after = seg(t, t2 + 0.15, t2 + 0.4)
    bounce = 0.05 * abs(math.sin(2 * math.pi * 2.4 * (t - t2 - 0.15))) * after
    q['squash'] = 1 - 0.14 * c * (1 - up) + 0.1 * a - 0.12 * land
    q['rot'][0] = 0.18 * c * (1 - up) - 0.08 * a
    for k, side in enumerate((1, -1)):
        back = c * (1 - up)
        q['hands'][k] = [side * lerp(0.11, 0.17, up), lerp(lerp(0.115, 0.08, back), 0.42, up), lerp(-0.06 * back, 0.03, up),
                         0, side * 0.95 * up]
        q['feet'][k][1] = 0.05 * a
        q['feet'][k][3] = 0.5 * a
    q['head'] = [-0.25 * up * (1 - after * 0.5), 0, 0]
    y = 1.1 * a + bounce
    return q, y


def frame(t):
    for i, ch in enumerate(crew):
        q, y = crew_pose(t, i)
        x, z = ROW[i]
        ch.pose(q, (x, tk.FELT_Y + y, z), YAW[i])
    # The dice tumble in from the left and settle on sixes.
    for k, d in enumerate(dice):
        u = seg(t, 0.0, 1.0 + 0.15 * k)
        k2 = 1 - (1 - u) ** 2.5
        x = lerp(-6.5 + k, -3.3 + 1.0 * k, k2)
        z = lerp(5.5, 2.3 + 0.5 * k, k2)
        hop = 0.9 * abs(math.sin(math.pi * 2.2 * u)) * (1 - u) ** 1.5
        spin = (1 - k2) * (9 + 3 * k)
        lounge.set_die(d, (x, tk.FELT_Y + 0.35 + hop, z), (spin, 0.7 * spin, 0.3 + 0.5 * k))

    rise = smoother(seg(t, 1.3, DUR))
    glide = smooth(seg(t, 0.0, 1.3))
    pos = lerpv(lerpv((0.6, 0.55, 8.4), (0.2, 0.75, 7.0), glide), (0.0, 6.4, 13.0), rise)
    tgt = lerpv((0.0, 1.05, 0.0), (0.0, 0.2, -1.0), rise)
    film.place_camera(cam, pos, tgt, lens=lerp(34, 26, rise))


film.render(SHOT, DUR, frame)
