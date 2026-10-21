"""Shared pieces for the trailer's Blender shots (tools/trailer/shotNN_*.py).

Everything is in game units and game axes (x right, y up, z toward the
camera), like tools/blender: V() turns a point into Blender's axes. The Chog
is the game's own detailed model (characters.build_detailed via
chog_roamer.build), posed frame by frame with the same small rig the game
uses (Figure.tsx): one pose transform carrying the body, head, hands and
feet, the limbs drawn as rubber-hose tubes. A shot is a function of time
that poses the actors and the camera; render() walks the frames, skipping
any already on disk, so a stopped render picks up where it left off.

    BLENDER_VENV=... tools/blender/run.sh ../trailer/shot01_the_o.py [--draft] [--still 5.2] [--every 6]
"""

import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_TOOLS = os.path.abspath(os.path.join(HERE, '..', 'blender'))
sys.path.insert(0, BLENDER_TOOLS)

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import blib  # noqa: E402
import chog_roamer as R  # noqa: E402

FPS = 24
OUT_ROOT = os.environ.get('TRAILER_OUT', '/tmp/trailer')
FONT_DIR = os.path.join(blib.REPO, 'client', 'src', 'fonts')

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
DRAFT = '--draft' in ARGS


def arg(name, default=None, cast=str):
    return cast(ARGS[ARGS.index(name) + 1]) if name in ARGS else default


V = blib.V
C = R.C
CI = R.CI


# ---- timing ----------------------------------------------------------------------

def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def seg(t, a, b):
    """0 before a, 1 after b, linear between."""
    return clamp((t - a) / (b - a)) if b > a else float(t >= b)


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def smoother(x):
    x = clamp(x)
    return x * x * x * (x * (6 * x - 15) + 10)


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = clamp(x)
    return x ** 3


def lerp(a, b, t):
    return a + (b - a) * t


def lerpv(a, b, t):
    return [lerp(x, y, t) for x, y in zip(a, b)]


def damped(t, freq=3.0, decay=6.0):
    """A settle: 1 at t=0, wobbling down to 0 (for squash-and-settle after a landing)."""
    if t < 0:
        return 0.0
    return math.exp(-decay * t) * math.cos(2 * math.pi * freq * t)


# ---- fonts -------------------------------------------------------------------------

def font(name='titan-one-400'):
    """A site font as a Blender font (the woff2 converted to TTF once, with fontTools)."""
    ttf = os.path.join(OUT_ROOT, 'fonts', name + '.ttf')
    if not os.path.exists(ttf):
        from fontTools.ttLib import TTFont
        os.makedirs(os.path.dirname(ttf), exist_ok=True)
        f = TTFont(os.path.join(FONT_DIR, name + '.woff2'))
        f.flavor = None
        f.save(ttf)
    return bpy.data.fonts.load(ttf, check_existing=True)


# ---- materials ---------------------------------------------------------------------

def principled(name, color, rough=0.4, coat=0.0, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    col = blib.hex_rgb(color) if isinstance(color, str) else color
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.08
    if emit:
        b.inputs['Emission Color'].default_value = (*blib.hex_rgb(emit), 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m


# ---- render settings ------------------------------------------------------------------

def setup_render(sc, res=(1600, 900), spp=8):
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    if DRAFT:
        res, spp = (640, 360), 4
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.fps = FPS
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.use_persistent_data = True
    cy = sc.cycles
    cy.samples = spp
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.03
    cy.use_denoising = True
    try:
        cy.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    cy.max_bounces = 4
    cy.diffuse_bounces = 1
    cy.glossy_bounces = 2
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 6
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    sc.render.filter_size = 1.2
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Punchy'
    except Exception:
        sc.view_settings.view_transform = 'Standard'
    return sc


def area_light(name, pos, target, power, size, color=(1, 1, 1), shape='DISK'):
    lt = bpy.data.lights.new(name, 'AREA')
    lt.energy = power
    lt.size = size
    lt.shape = shape
    lt.color = color
    ob = bpy.data.objects.new(name, lt)
    ob.location = pos
    look_at(ob, target)
    blib.link(ob)
    return ob


def look_at(ob, target, roll=0.0):
    d = Vector(target) - Vector(ob.location)
    q = d.to_track_quat('-Z', 'Y')
    ob.rotation_euler = q.to_euler()
    if roll:
        ob.rotation_euler.rotate_axis('Z', roll)


def camera(name='Cam', lens=50.0):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = lens
    cam.data.sensor_width = 36
    cam.data.clip_start = 0.02
    cam.data.clip_end = 200
    blib.link(cam)
    bpy.context.scene.camera = cam
    return cam


def place_camera(cam, pos_game, target_game, lens=None, dof=None):
    cam.location = V(*pos_game)
    look_at(cam, V(*target_game))
    if lens:
        cam.data.lens = lens
    if dof:
        dist, fstop = dof
        cam.data.dof.use_dof = True
        cam.data.dof.focus_distance = dist
        cam.data.dof.aperture_fstop = fstop
    else:
        cam.data.dof.use_dof = False


def project(cam, p_blender):
    """A Blender-space point -> (x, y) in output pixels, y down."""
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    co = world_to_camera_view(sc, cam, Vector(p_blender))
    return co.x * sc.render.resolution_x, (1 - co.y) * sc.render.resolution_y


# ---- the Chog ------------------------------------------------------------------------

class Chog:
    """The game's detailed Chog, posed per frame: pose q (chog_roamer's pose dict), standing at
    `at` (game space, feet on y) and turned `yaw` degrees (0 faces the camera, 90 faces screen right)."""

    def __init__(self, scale=1.0):
        self.nodes, self.mats = R.build()
        self.scale = scale
        self.temp = []
        self.hide_hats()

    def hide_hats(self):
        for part, n in self.nodes.items():
            if part.startswith('Hair_'):
                n.hide_render = part != 'Hair_full'

    def pose(self, q, at=(0, 0, 0), yaw=0.0):
        for o in self.temp:
            bpy.data.objects.remove(o)
        self.temp = []
        s = self.scale
        root = R.gm(pos=at) @ R.gm(rot=(0, math.radians(yaw), 0), scale=(s, s, s))
        sy = q['squash']
        sxz = 1 / math.sqrt(sy)
        P = root @ R.gm(q['pos'], q['rot'], (sxz, sy, sxz))

        def put(node, M):
            node.matrix_world = C @ M @ CI

        nodes = self.nodes
        put(nodes['Body'], P)
        H = P @ R.gm((0, q['head_y'], 0), q['head'])
        put(nodes['Head'], H)
        for part, n in nodes.items():
            if part.startswith('Hair_'):
                put(n, H)
        for part in ('LidL', 'LidR'):
            n = nodes.get(part)
            if not n:
                continue
            shut = q['lids']
            n.hide_render = shut < 0.03
            put(n, H @ R.gm(tuple(n['hinge']), (0, 0, 0), (1, max(0.03, shut), 1)))
        for part, (x, y, z, rx, rz) in zip(('HandL', 'HandR'), q['hands']):
            put(nodes[part], P @ R.gm((x, y, z), (rx, 0, rz)))
        for part, (x, y, z, rx) in zip(('FootL', 'FootR'), q['feet']):
            put(nodes[part], P @ R.gm((x, y, z), (rx, 0, 0)))
        poles_arm = q.get('arm_poles', R.POLE_ARM)
        poles_leg = q.get('leg_poles', R.POLE_LEG)
        for i, side in enumerate((1, -1)):
            x, y, z = q['hands'][i][:3]
            o = R.limb(f'Arm{i}', Vector((R.SHOULDER[0] * side, R.SHOULDER[1], R.SHOULDER[2])), Vector((x, y, z)),
                       R.ARM_R, R.ARM_R * 0.85, R.ARM_LEN, Vector(poles_arm[i]), self.mats['cloth'])
            o.matrix_world = C @ P @ CI
            self.temp.append(o)
            x, y, z = q['feet'][i][:3]
            o = R.limb(f'Leg{i}', Vector((R.HIP[0] * side, R.HIP[1], R.HIP[2])), Vector((x, y + R.ANKLE, z - 0.006)),
                       R.LEG_R, R.LEG_R * 0.9, R.LEG_LEN, Vector(poles_leg[i]), self.mats['cloth'])
            o.matrix_world = C @ P @ CI
            self.temp.append(o)


def rest():
    return R.rest()


class Walk:
    """A walk along a polyline (game x, z points) from time t0 to t1, feet planted.

    The body covers the path at an eased speed; the feet take turns: each swing carries a foot
    from half a step behind the body to half a step ahead while the body moves one step, and a
    foot on the ground stays exactly where it landed (its plant spot is fixed in the world), so
    nothing slides. The first and last steps start and end with the feet together."""

    def __init__(self, pts, t0, t1, step=0.085, lift=0.03, bob=0.008, ease=0.18):
        self.pts = [Vector((x, 0.0, z)) for x, z in pts]
        self.t0, self.t1 = t0, t1
        self.lens = [(b - a).length for a, b in zip(self.pts, self.pts[1:])]
        self.S = sum(self.lens)
        n = max(2, round(self.S / step))
        self.L = self.S / n
        self.lift, self.bob, self.ease = lift, bob, ease

    def dist(self, t):
        u = seg(t, self.t0, self.t1)
        e = self.ease
        # Trapezoid speed: accelerate over the first e of the time, cruise, decelerate over the last e.
        vmax = 1 / (1 - e)
        if u < e:
            d = 0.5 * vmax * u * u / e
        elif u > 1 - e:
            w = 1 - u
            d = 1 - 0.5 * vmax * w * w / e
        else:
            d = 0.5 * vmax * e + vmax * (u - e)
        return self.S * clamp(d)

    def point(self, d):
        for a, b, ln in zip(self.pts, self.pts[1:], self.lens):
            if d <= ln or ln == self.lens[-1] and b is self.pts[-1]:
                k = clamp(d / ln) if ln else 0
                p = a.lerp(b, k)
                return p, b - a
            d -= ln
        return self.pts[-1], self.pts[-1] - self.pts[-2]

    def at(self, t):
        """(position (x, 0, z), yaw degrees, pose) at time t."""
        s = self.dist(t)
        p, dirn = self.point(s)
        yaw = math.degrees(math.atan2(dirn.x, dirn.z))
        L = self.L
        q = rest()
        moving = 0.0 < s < self.S - 1e-6
        rels = []
        for i, side in enumerate((1, -1)):
            # Foot 0 swings over body distance [2kL, 2kL + L], foot 1 over [2kL + L, 2kL + 2L].
            phase = (s - i * L) / (2 * L)
            k = math.floor(phase)
            u = phase - k              # 0..0.5 swing, 0.5..1 stance
            swing_start = 2 * k * L + i * L
            if u < 0.5:
                w = u / 0.5
                frm = clamp(swing_start - L / 2, 0, self.S)
                to = clamp(swing_start + 1.5 * L, 0, self.S)
                foot = lerp(frm, to, smooth(w))
                lift = self.lift * math.sin(math.pi * w) if moving and to > frm else 0.0
                pitch = -0.35 * math.sin(math.pi * w) if lift else 0.0
            else:
                foot = clamp(swing_start + 1.5 * L, 0, self.S)
                lift, pitch = 0.0, 0.0
            rel = foot - s
            rels.append(rel)
            f = q['feet'][i]
            f[1] = R.FOOT_REST[1] + lift
            f[2] = R.FOOT_REST[2] + rel
            f[3] = pitch
        # Arms swing against the legs; the body bobs, waddles and twists with the stride.
        stride = (rels[0] - rels[1]) / max(L, 1e-6)
        for i, side in enumerate((1, -1)):
            h = q['hands'][i]
            h[2] = R.HAND_REST[2] - 0.045 * stride * side
            h[1] = R.HAND_REST[1] + 0.01 * abs(stride)
            h[3] = 0.45 * stride * side
        walk_phase = s / (2 * L) * 2 * math.pi
        amt = min(1.0, s / L, (self.S - s) / L) if moving else 0.0
        q['pos'][1] = self.bob * amt * abs(math.cos(walk_phase))
        q['rot'][2] = 0.07 * amt * math.sin(walk_phase)
        q['rot'][1] = 0.08 * amt * math.sin(walk_phase)
        q['rot'][0] = 0.05 * amt
        q['head'] = [-0.04 * amt, -0.05 * amt * math.sin(walk_phase), -0.04 * amt * math.sin(walk_phase)]
        q['squash'] = 1.0 - 0.025 * amt * math.sin(walk_phase) ** 2
        return (p.x, 0.0, p.z), yaw, q, (moving, s, L)

    def footfalls(self):
        """Times at which a foot lands (for the squeaks)."""
        out = []
        n = int(round(self.S / self.L))
        t, prev = self.t0, 0
        steps = 400
        last = -1
        for j in range(steps + 1):
            tt = self.t0 + (self.t1 - self.t0) * j / steps
            k = int(self.dist(tt) // self.L)
            if k != last and j:
                out.append(tt)
            last = k
        return out[:n]


# ---- the frame loop -------------------------------------------------------------------

def frames_dir(shot):
    d = os.path.join(OUT_ROOT, 'frames', shot + ('-draft' if DRAFT else ''))
    os.makedirs(d, exist_ok=True)
    return d


def render(shot, duration, frame_fn, start=0.0):
    """Render [start, duration) at FPS through frame_fn(t). --still T renders one frame to
    <shot>-still.png; --every K renders every K-th frame (a quick motion check); --range a:b."""
    sc = bpy.context.scene
    stills = arg('--stills', None)
    if stills:
        for st in [float(x) for x in stills.split(',')]:
            frame_fn(st)
            sc.render.filepath = os.path.join(OUT_ROOT, 'stills', f'{shot}{"-draft" if DRAFT else ""}-{st:05.2f}.png')
            bpy.ops.render.render(write_still=True)
            print('still', sc.render.filepath, flush=True)
        return
    out = frames_dir(shot)
    every = arg('--every', 1, int)
    n = int(round((duration - start) * FPS))
    lo, hi = 0, n
    if '--range' in ARGS:
        a, b = arg('--range').split(':')
        lo, hi = int(a), int(b)
    t_all = time.time()
    done = 0
    for f in range(lo, hi, every):
        path = os.path.join(out, f'{f:04d}.png')
        if os.path.exists(path):
            continue
        t0 = time.time()
        frame_fn(start + f / FPS)
        sc.render.filepath = path + '.tmp.png'
        bpy.ops.render.render(write_still=True)
        os.replace(path + '.tmp.png', path)
        done += 1
        print(f'frame {f}/{n} {time.time() - t0:.1f}s', flush=True)
    print(f'done {shot}: {done} frames in {time.time() - t_all:.0f}s', flush=True)
