"""Versions of the token Chog's eyes and of the Skull face, for choosing between.

chog_traits.py builds one version of each (EYES_STYLE, SKULL_STYLE; 'current'
is what ships). The node names are the same in every version, so the game
needs nothing to switch: set the style, rerun chog_traits.py.

Eyes (every eye type that is drawn; eyewear stays as it is):

  refined  the 2D art's shapes on glossy eyeballs: a thick ink outline, heavy
           lids, the pupils and glints laid on the ball
  decal    the art flat: the same drawings as thin layers on the face, like a
           sticker (ink, white, pupil, glint), raised only enough to clear the
           cheeks
  bold     a chunkier toy take: bigger, rounder eyes, thicker outlines and lids,
           big glints

Each eye is drawn once (the functions below, in the eye's own 2D frame:
u toward his left, v up, metres at the base Chog's size) and the style decides
its scale, its relief and its line weight. Pupils glance the same way in both
eyes, as in the art; lids and brows mirror.

Skull (the Skull form's head, chog_HeadSkull):

  sculpted  a modelled skull: a rounder, bigger cranium, cheekbones, the jaw
            narrowing to a chin, hollow eye sockets, a nose hole and a row of
            teeth in a wide grin with the jaw line round under them
  painted   today's head with the skull face drawn on it: dark sockets, the
            heart-shaped nose hole, the grin of teeth with the jaw crack
  hybrid    the sculpted head (sockets and nose hollowed) with the grin drawn
            on it, as in the art
"""

import math

import bmesh
from mathutils import Vector

import chog_draw as draw
import detailed
from detailed import CHOG_EYE_AT, ChogFace, _finish, ell, rbox, strand

CID = 'chog'
F = ChogFace()
EYE_X, EYE_Y = CHOG_EYE_AT

EYE_STYLES = {
    # k: scale, dome: eyeball height, t: outline, w: line weight
    'refined': dict(k=1.0, dome=0.0085, t=0.0036, w=1.0, glint=1.0),
    'decal': dict(k=1.0, dome=0.0, t=0.0042, w=1.1, glint=1.0),
    'bold': dict(k=1.16, dome=0.0145, t=0.0058, w=1.35, glint=1.3),
}

# The cheeks (detailed.chog_cheeks): pink lenses standing a little off the face. Drawings run over them.
BLUSH = [(s * 0.083, -0.047, 0.0175, 0.0155) for s in (-1, 1)]


def blush_height(x, y):
    """A smooth swell over each cheek, clear of it everywhere (a sharp step would make layers cut through each other)."""
    h = 0.0
    for cx, cy, rx, ry in BLUSH:
        q = 1 - ((x - cx) / (rx * 1.4)) ** 2 - ((y - cy) / (ry * 1.4)) ** 2
        if q > 0:
            h = max(h, 0.0038 * q * q)
    return h


class Canvas(draw.Surf):
    """The face as the eyes are drawn on it: over the cheeks, with a dome raised under each eyeball."""

    def __init__(self, base=None, domes=()):
        self.base = base or draw.FaceSurf(F)
        self.domes = list(domes)

    def height(self, x, y):
        h = blush_height(x, y)
        for cx, cy, rx, ry, hh, rot, p in self.domes:
            c, s = math.cos(rot), math.sin(rot)
            u, v = (x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c
            q = 1 - (u / rx) ** 2 - (v / ry) ** 2
            if q > 0:
                h += hh * q ** p
        return h

    def p(self, x, y):
        h = self.height(x, y)
        b = self.base.p(x, y)
        return b + self.base.n(x, y) * h if h else b


class Pen:
    """Draws one eye: shapes in the eye's frame (u, v), each a layer over the ones before."""

    def __init__(self, m, style, s, name, base=None):
        self.m, self.st, self.s, self.name = m, EYE_STYLES[style], s, name
        self.k, self.t = self.st['k'], self.st['t']
        self.o = (s * EYE_X, EYE_Y)
        self.base = base
        self.domes = []
        self.S = None
        self.lift = 0.0008
        self.n = 0
        self.out = []

    def xy(self, u, v):
        return (self.o[0] + u * self.k, self.o[1] + v * self.k)

    def dome(self, rx, ry, cx=0.0, cy=0.0, rot=0.0, h=None, p=2.0):
        """Raise the eyeball: a dome over this ellipse (the style's height unless h), easing out to the face past the
        outline so every layer lies on its smooth part (layers on a sharp crease would cut through each other)."""
        h = self.st['dome'] if h is None else h * self.st['dome'] / 0.0085
        if h > 0:
            X, Y = self.xy(cx, cy)
            pad = self.t + 0.004
            self.domes.append((X, Y, (rx + pad) * self.k, (ry + pad) * self.k, h, rot, p))

    def _layer(self):
        if self.S is None:
            self.S = Canvas(self.base, self.domes)
        self.lift += 0.00034
        self.n += 1
        return self.lift, f'{self.name}{self.s}_{self.n}'

    def fill(self, inside, c, rmax, mat, n=44):
        lift, name = self._layer()
        k, (ox, oy) = self.k, self.o
        X, Y = self.xy(*c)
        self.out.append(draw.region(name, self.S, lambda x, y: inside((x - ox) / k, (y - oy) / k), (X, Y), rmax * k, lift,
                                    self.m[mat], n=n, nr=5 if self.domes else 4))

    def oval(self, cx, cy, rx, ry, mat, rot=0.0, clip=None, n=40):
        e = draw.ellipse(cx, cy, rx, ry, rot)
        self.fill(e if clip is None else (lambda u, v: e(u, v) and clip(u, v)), (cx, cy), max(rx, ry) * 1.05, mat, n=n)

    def glint(self, cx, cy, r, rot=0.0, ry=None, clip=None):
        g = self.st['glint']
        self.oval(cx, cy, r * g, (ry or r) * g, 'white', rot=rot, clip=clip, n=24)

    def line(self, pts, w, mat='ink', taper=0.6, w1=None, n=8):
        lift, name = self._layer()
        lw = self.st['w'] * self.k
        self.out.append(draw.stroke(name, self.S, [self.xy(u, v) for u, v in pts], w * lw, lift, self.m[mat], taper=taper,
                                    w1=None if w1 is None else w1 * lw, n=n))


# ---- the eye drawings ------------------------------------------------------------------
# Each takes a Pen and draws one eye (side P.s).

def _glossy(P, rx, ry, pupil, pc=(0.0, -0.002), glints=((-0.0075, 0.0065, 0.0058), (0.0065, -0.009, 0.0024)), iris='ink'):
    """A round eye in a thick outline: white, a black (or coloured) pupil, glints."""
    t = P.t
    P.dome(rx, ry)
    P.oval(0, 0, rx + t, ry + t, 'ink')
    P.oval(0, 0, rx, ry, 'white')
    W = draw.ellipse(0, 0, rx * 0.985, ry * 0.985)
    P.oval(pc[0], pc[1], pupil[0], pupil[1], iris, clip=W)
    for x, y, r in glints:
        P.glint(x, y, r, clip=W)


def eye_round(P):
    """Round: the black pupil nearly fills the eye, a ring of white round it."""
    _glossy(P, 0.029, 0.031, (0.0215, 0.0235), glints=((-0.008, 0.0085, 0.0056), (0.0075, -0.0105, 0.0023)))


def eye_round_small(P):
    _glossy(P, 0.028, 0.030, (0.0175, 0.0192), glints=((-0.0065, 0.0065, 0.0046),))


def eye_derp(P):
    """Retard: big round eyes, a small pupil in each looking off to its own side."""
    _glossy(P, 0.031, 0.033, (0.0078, 0.0095), pc=(P.s * 0.0125, 0.001), glints=())


def _drop(P, u, v, r=0.0042):
    P.oval(u, v, r + P.t * 0.55, r * 1.45 + P.t * 0.55, 'ink')
    P.oval(u, v, r, r * 1.45, 'c2')


def _streams(P):
    """Tears running down the cheek from under the eye: light blue in a thin dark edge."""
    pts = [(-P.s * 0.008, -0.026), (-P.s * 0.007, -0.05), (-P.s * 0.004, -0.075), (-P.s * 0.003, -0.085)]
    P.line(pts, 0.0125, 'ink', taper=0.15, w1=0.009)
    P.line(pts, 0.009, 'c2', taper=0.15, w1=0.0055)


def eye_round_crying(P):
    eye_round(P)
    _streams(P)


def eye_round_tear(P):
    eye_round(P)
    if P.s < 0:
        _drop(P, 0.006, -0.043, 0.005)


def eye_teary(P):
    _glossy(P, 0.029, 0.031, (0.021, 0.022), glints=((-0.0075, 0.0075, 0.0068), (0.0068, -0.0085, 0.0034)))
    _drop(P, -P.s * 0.011, -0.04, 0.0034)


def eye_worried(P):
    _glossy(P, 0.029, 0.031, (0.0205, 0.0215), glints=((-0.0075, 0.007, 0.0062), (0.0075, -0.008, 0.003)))
    s = P.s
    P.line([(s * 0.033, 0.026), (s * 0.012, 0.038), (-s * 0.01, 0.046), (-s * 0.026, 0.05)], 0.0058, taper=0.55)


def eye_normal(P):
    """The base Chog's eye in the art's weight: the black iris glancing to his left, two glints, a lash line."""
    rx, ry, _ = detailed.CHOG_EYE
    t = P.t
    P.dome(rx, ry)
    P.oval(0, 0, rx + t, ry + t, 'ink')
    P.oval(0, 0, rx, ry, 'white')
    W = draw.ellipse(0, 0, rx * 0.985, ry * 0.985)
    P.oval(0.0075, -0.001, 0.0205, 0.024, 'ink', clip=W)
    P.glint(0.0005, 0.0095, 0.0066, clip=W)
    P.glint(0.0155, -0.0105, 0.0028, clip=W)
    P.line([(-rx * 1.02, ry * 0.4), (-rx * 0.55, ry * 0.95), (0, ry * 1.1), (rx * 0.55, ry * 0.97), (rx * 1.04, ry * 0.45)], 0.0034, taper=0.75)


def _lidded(P, rx, ry, cy, lid, pupil, pc, lid_w=0.0095, glints=((-0.0045, 0.004, 0.0038),)):
    """An eye under a heavy straight lid: white below the lid line v = lid(u), the lid a thick bar along it."""
    t = P.t
    P.dome(rx, ry, cy=cy)
    E, Et = draw.ellipse(0, cy, rx, ry), draw.ellipse(0, cy, rx + t, ry + t)
    P.fill(lambda u, v: Et(u, v) and v < lid(u) + t, (0, cy - ry * 0.3), max(rx, ry) + t, 'ink')
    W = lambda u, v: E(u, v) and v < lid(u)
    P.fill(W, (0, cy - ry * 0.4), max(rx, ry), 'white')
    P.oval(pc[0], pc[1], pupil[0], pupil[1], 'ink', clip=W)
    for x, y, r in glints:
        P.glint(pc[0] + x, pc[1] + y, r, clip=W)
    ends = rx + t * 1.2
    P.line([(-ends, lid(-ends)), (0, lid(0)), (ends, lid(ends))], lid_w, taper=0.35)


def eye_side(P):
    s = P.s
    _lidded(P, 0.031, 0.021, -0.003, lambda u: 0.0045 + 0.11 * s * u, (0.0125, 0.0135), (0.012, -0.007))


def eye_tired(P):
    s = P.s
    _lidded(P, 0.03, 0.02, -0.004, lambda u: -0.0005 + 0.06 * s * u, (0.011, 0.012), (0.0, -0.01), lid_w=0.0105)
    # The bag under it.
    P.line([(-0.022, -0.03), (0, -0.036), (0.022, -0.03)], 0.0026, taper=0.8)


def eye_base(P):
    s = P.s
    _lidded(P, 0.031, 0.017, -0.002, lambda u: 0.004 + 0.1 * s * u, (0.0125, 0.0135), (0.004, -0.004))


def eye_angry(P):
    s = P.s
    _lidded(P, 0.029, 0.023, -0.003, lambda u: 0.004 + 0.3 * s * u, (0.0115, 0.0125), (s * 0.002, -0.008))


def eye_vertical(P):
    """A wide almond eye, the pupil a tall black oval with a sliver of light."""
    t = P.t
    P.dome(0.031, 0.0205)
    P.oval(0, 0, 0.031 + t, 0.0205 + t, 'ink')
    P.oval(0, 0, 0.031, 0.0205, 'white')
    W = draw.ellipse(0, 0, 0.0305, 0.020)
    P.oval(0, 0, 0.0078, 0.019, 'ink', clip=W)
    P.glint(-0.0018, 0.005, 0.0019, ry=0.006)


def eye_frog(P):
    """A big round eye, the pupil a wide oval rolled up to the top."""
    t = P.t
    P.dome(0.032, 0.0335, h=0.0085)
    P.oval(0, 0, 0.032 + t, 0.0335 + t, 'ink')
    P.oval(0, 0, 0.032, 0.0335, 'white')
    W = draw.ellipse(0, 0, 0.0315, 0.033)
    P.oval(0.001, 0.0095, 0.0175, 0.0125, 'ink', clip=W)
    P.glint(-0.0055, 0.0135, 0.0042, ry=0.003, clip=W)


def eye_smirk(P):
    """The sly half-moon: a heavy arched lid over the top, a flatter line under, the iris (black, or blue or green:
    the lens colour) rolled up into the corner toward his right under the lid, the white a crescent beside it."""
    t = P.t
    rx, ry, cy = 0.031, 0.033, -0.012
    # A half moon on its back: the arch of the lid over the top, a shallow curve along the bottom.
    bottom = lambda u: cy - 0.0015 + 0.0085 * (u / rx) ** 2
    P.dome(rx, (ry + t) * 0.6, cy=cy + ry * 0.42)
    E, Et = draw.ellipse(0, cy, rx, ry), draw.ellipse(0, cy, rx + t, ry + t * 1.2)
    c = (0, cy + ry * 0.45)
    P.fill(lambda u, v: Et(u, v) and v > bottom(u) - t * 0.75, c, rx + t * 2, 'ink')
    W = lambda u, v: E(u, v) and v > bottom(u)
    P.fill(W, c, rx, 'white')
    ic = (-0.0085, cy + 0.0175)
    P.oval(ic[0], ic[1], 0.0165, 0.0175, 'glass', clip=W)
    P.oval(ic[0], ic[1], 0.0085, 0.009, 'ink', clip=W)
    P.glint(ic[0] + 0.0055, ic[1] + 0.006, 0.0058, ry=0.0042, rot=0.5, clip=W)
    P.glint(ic[0] - 0.0075, ic[1] - 0.0068, 0.0021, clip=W)
    # The heavy lid: thickest over the top, thinning to the corners.
    arc = [(rx * 1.03 * math.cos(a), cy + ry * 1.03 * math.sin(a)) for a in (math.radians(d) for d in (170, 142, 116, 90, 64, 38, 10))]
    P.line(arc, 0.011, taper=0.8)


def eye_up(P):
    """Glossy black eyes (a skull's sockets), a half-moon of light round the top."""
    t = P.t
    rx, ry = 0.0285, 0.031
    P.dome(rx, ry, h=0.004)
    P.oval(0, 0, rx + t * 0.5, ry + t * 0.5, 'ink')
    E = draw.ellipse(0, 0, rx * 0.86, ry * 0.86)
    P.oval(-0.004, 0.0115, 0.0205, 0.0145, 'white', rot=-0.35, clip=E)
    P.oval(0.0, 0.0012, 0.0235, 0.013, 'ink', rot=-0.35, clip=E)
    P.glint(0.012, -0.013, 0.0026)


def _heart(R, cy=0.0):
    def inside(u, v):
        x, y = u / R, (v - cy) / R + 0.15
        return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0
    return inside


def eye_heart(P):
    t = P.t
    R = 0.0245
    P.dome(R * 1.25 + t, R * 1.2 + t, cy=-0.002, h=0.004)
    P.fill(_heart(R + t * 1.1, -0.0015), (0, -0.002), R * 1.6, 'ink')
    H = _heart(R, -0.0015)
    P.fill(H, (0, -0.002), R * 1.6, 'c1')
    P.glint(-0.0135, 0.0105, 0.0045, ry=0.0032, rot=0.6, clip=H)


def eye_happy(P):
    P.line([(-0.026, -0.007), (-0.014, 0.008), (0, 0.0125), (0.014, 0.008), (0.026, -0.007)], 0.0072, taper=0.7)


def eye_closed_crying(P):
    P.line([(-0.026, 0.005), (-0.013, -0.004), (0, -0.0065), (0.013, -0.004), (0.026, 0.005)], 0.0064, taper=0.7)
    _streams(P)


def eye_flat(P):
    P.line([(-0.024, 0.0), (0.024, 0.0)], 0.0088, taper=0.12)


def eye_xd(P):
    s = P.s
    for dy in (0.016, -0.016):
        P.line([(s * 0.016, dy), (-s * 0.014, 0.0)], 0.0078, taper=0.2)


def eye_dead(P):
    for a, b in (((-0.018, -0.018), (0.018, 0.018)), ((-0.018, 0.018), (0.018, -0.018))):
        P.line([a, b], 0.0082, taper=0.15)


def _clown(P, mix):
    s = P.s
    up, down, hw = 0.06, 0.048, 0.03

    def star(u, v):
        h = up if v > 0 else down
        return (abs(u) / hw) ** 0.55 + (abs(v) / h) ** 0.55 <= 1
    P.dome(0.019, 0.0235, cy=-0.002, h=0.005)
    P.fill(star, (0, 0), up * 1.02, 'c1' if mix and s < 0 else 'glass', n=72)
    P.oval(0, -0.002, 0.019 + P.t * 0.3, 0.0235 + P.t * 0.3, 'ink')
    P.glint(-0.006, 0.006, 0.0045, ry=0.0062, rot=-0.3)
    P.glint(0.005, -0.011, 0.0026)
    if mix:
        lid = [(s * 0.033, 0.031), (s * 0.012, 0.026), (-s * 0.006, 0.021), (-s * 0.026, 0.009)]
    else:
        lid = [(-s * 0.024, 0.012), (-s * 0.008, 0.0225), (s * 0.012, 0.023), (s * 0.034, 0.03)]
    P.line(lid, 0.0052, taper=0.6)


def eye_clown(P):
    _clown(P, False)


def eye_clown_mix(P):
    _clown(P, True)


def eye_laser(P):
    """A glowing eye in a thick ink ring (the beams are their own node), white-hot in the middle."""
    t = P.t
    P.dome(0.0215 + t, 0.0215 + t, h=0.005)
    P.oval(0, 0, 0.0205 + t * 1.1, 0.0205 + t * 1.1, 'ink')
    P.oval(0, 0, 0.0205, 0.0205, 'glow')
    P.oval(0.0, 0.0, 0.0075, 0.0075, 'white')


DRAWN = {
    'normal': eye_normal, 'happy': eye_happy, 'side': eye_side, 'laser': eye_laser, 'dead': eye_dead, 'round': eye_round,
    'roundSmall': eye_round_small, 'heart': eye_heart, 'roundCrying': eye_round_crying, 'roundTear': eye_round_tear,
    'closedCrying': eye_closed_crying, 'teary': eye_teary, 'tired': eye_tired, 'angry': eye_angry, 'flat': eye_flat,
    'vertical': eye_vertical, 'base': eye_base, 'xd': eye_xd, 'smirk': eye_smirk, 'frog': eye_frog, 'clown': eye_clown,
    'clownMix': eye_clown_mix, 'worried': eye_worried, 'up': eye_up, 'derp': eye_derp,
}


def eyes(style, vid):
    """The builder of eyes `vid` in `style` (a function of the materials), or None where the style leaves it be."""
    fn = DRAWN.get(vid)
    if not fn:
        return None

    def build(m):
        out = []
        for s in (-1, 1):
            P = Pen(m, style, s, f'{CID}_{style.title()}{vid}')
            fn(P)
            out += P.out
        return out
    return build


# ---- the Skull face ----------------------------------------------------------------------

SOCKET = (0.037, 0.036)       # eye socket radii round each eye
NOSE = (0.0, -0.05, 0.0105)   # the nose hole: centre and size
CRANIUM = ((0, 0.025, -0.05), (0.118, 0.122, 0.112))   # as big as the Chog's head of hair: every hat still fits


def grin_y(x):
    """The line between the teeth: a wide grin, turning up toward the cheeks."""
    return -0.082 + 0.015 * (x / 0.06) ** 2


def jaw_taper(y):
    """How much narrower the face is at height y: the jaw drawing in under the cheekbones to the chin."""
    t = min(1.0, max(0.0, (-0.055 - y) / 0.06))
    return 1 - 0.13 * t * t


def recess(x, y):
    """How deep the sockets and the nose hole are hollowed into the face at (x, y)."""
    d = 0.0
    for s in (-1, 1):
        q = 1 - ((x - s * EYE_X) / SOCKET[0]) ** 2 - ((y - EYE_Y) / SOCKET[1]) ** 2
        if q > 0:
            d += 0.0062 * q ** 0.8
    nx, ny, r = NOSE
    q = 1 - ((x - nx) / (r * 1.25)) ** 2 - ((y - ny) / (r * 1.3)) ** 2
    if q > 0:
        d += 0.0045 * q ** 0.7
    return d


def _sculpt_deform(v):
    v = F.chin(v)
    # Only the front of the face is hollowed (not the back of the shell, inside the cranium).
    w = min(1.0, max(0.0, (v.z - 0.03) / 0.03))
    v.z -= recess(v.x, v.y) * w
    v.x *= jaw_taper(v.y)
    return v


def _skull_shell(m, name, sculpt):
    """The bone: the face and a bald cranium melted into one surface; `sculpt`: hollowed and shaped as a skull."""
    import characters
    if sculpt:
        face = detailed.superell(f'{name}Face', tuple(F.FC), tuple(F.FR), m['skin'], e=F.E, f=F.F, seg=(76, 56),
                                 deform=_sculpt_deform, fuse=True)
        cran = ell(f'{name}Cranium', *CRANIUM, m['skin'], seg=(40, 28), fuse=True)
        # Cheekbones under the outer corners of the sockets.
        bones = [ell(f'{name}Cheekbone{s}', (s * 0.074, -0.05, 0.036), (0.034, 0.02, 0.04), m['skin'], seg=(20, 12), fuse=True)
                 for s in (-1, 1)]
        objs = [face, cran] + bones
    else:
        objs = [F.build(f'{name}Face', m['skin']), ell(f'{name}Cranium', (0, 0.02, -0.045), (0.114, 0.12, 0.11), m['skin'], seg=(36, 24), fuse=True)]
    import blib
    blib.realize(objs)
    return characters.fuse(objs, f'{name}Bone', budget=7000 if sculpt else 4200, voxel=0.0018 if sculpt else characters.VOXEL)


def _paint_skull(S, m, name, sockets=True, teeth=True, nose=True, tone=True):  # noqa: C901
    """The skull face drawn on surface S: socket shading (in the mane colour, a darker shade of the bone), the
    heart-shaped nose hole, and the grin: teeth (bone, drawn by the dark between them) in a wide mouth, the jaw
    line under them and the cracks at its corners."""
    out = []
    lift = [0.0005]

    def L(step=0.00034):
        lift[0] += step
        return lift[0]
    if sockets:
        # A hollow: dark under the brow, the dark thinning round the sides (bone laid back over the rest of it).
        for s in (-1, 1):
            cx, cy = s * EYE_X, EYE_Y
            out.append(draw.oval(f'{name}Socket{s}', S, cx, cy, SOCKET[0] * 0.93, SOCKET[1] * 0.93, 0.0002, m['ink'], n=56))
            if tone:
                out.append(draw.oval(f'{name}SocketFloor{s}', S, cx, cy - 0.0075, SOCKET[0] * 0.86, SOCKET[1] * 0.8, 0.00045, m['skin'], n=56))
    L(0.001)
    if nose:
        nx, ny, r = NOSE
        heart = _heart(r, 0.0)
        out.append(draw.region(f'{name}Nose', S, lambda x, y: heart(x - nx, -(y - ny)), (nx, ny), r * 1.6, L(), m['ink'], n=56))
    if teeth:
        xs = [-0.062 + 0.124 * i / 24 for i in range(25)]
        out.append(draw.stroke(f'{name}Mouth', S, [(x, grin_y(x)) for x in xs[::3]], 0.0265, L(), m['ink'], taper=0.3))
        lt = L()
        for row, (n, dy, h) in enumerate(((9, 0.0064, 0.0057), (7, -0.0059, 0.0049))):
            for i in range(n):
                x = (i - (n - 1) / 2) * 0.0121
                y = grin_y(x) + dy
                a = math.atan(2 * 0.015 * x / 0.06 ** 2)
                c, s_ = math.cos(a), math.sin(a)
                w = 0.0052 * (1 - 0.18 * (abs(x) / 0.055) ** 2)

                def tooth(px, py, x=x, y=y, c=c, s_=s_, w=w, h=h):
                    u, v = (px - x) * c + (py - y) * s_, -(px - x) * s_ + (py - y) * c
                    return (abs(u) / w) ** 4 + (abs(v) / h) ** 4 <= 1
                out.append(draw.region(f'{name}Tooth{row}{i}', S, tooth, (x, y), max(w, h) * 1.5, lt, m['skin'], n=28, nr=2))
        # The jaw line under the teeth, and the cracks curling up from the corners.
        L(0.0006)
        out.append(draw.stroke(f'{name}Jaw', S, [(-0.046, grin_y(-0.046) - 0.0175), (0, grin_y(0) - 0.0185), (0.046, grin_y(0.046) - 0.0175)],
                               0.0028, lift[0], m['ink'], taper=0.6))
        for s in (-1, 1):
            out.append(draw.stroke(f'{name}Crack{s}', S, [(s * 0.06, grin_y(0.06)), (s * 0.069, grin_y(0.06) + 0.008), (s * 0.071, grin_y(0.06) + 0.016)],
                                   0.003, lift[0], m['ink'], taper=0.7))
    return out


def _teeth_3d(S, m, name):
    """Sculpted teeth on the grin: rounded blocks of bone standing out of the dark mouth."""
    out = [draw.stroke(f'{name}Mouth', S, [(x, grin_y(x)) for x in (-0.062 + 0.124 * i / 8 for i in range(9))], 0.0265, 0.0009, m['ink'], taper=0.3)]
    for row, (n, dy, h) in enumerate(((9, 0.0062, 0.0098), (7, -0.0057, 0.0086))):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.0121
            y = grin_y(x) + dy
            a = math.atan(2 * 0.015 * x / 0.06 ** 2)
            G = detailed.frame_z(S.p(x, y) + S.n(x, y) * 0.0011, S.n(x, y))
            w = 0.0094 * (1 - 0.18 * (abs(x) / 0.055) ** 2)
            out.append(rbox(f'{name}Tooth{row}{i}', (0, 0, 0), (w, h, 0.0042), m['skin'], r=(0, 0, a), parent=G, bevel=0.0018, segs=2))
    L = 0.0016
    out.append(draw.stroke(f'{name}Jaw', S, [(-0.046, grin_y(-0.046) - 0.0175), (0, grin_y(0) - 0.0185), (0.046, grin_y(0.046) - 0.0175)],
                           0.0028, L, m['ink'], taper=0.6))
    for s in (-1, 1):
        out.append(draw.stroke(f'{name}Crack{s}', S, [(s * 0.06, grin_y(0.06)), (s * 0.069, grin_y(0.06) + 0.008), (s * 0.071, grin_y(0.06) + 0.016)],
                               0.003, L, m['ink'], taper=0.7))
    return out


def skull(style, m):
    """The Skull form's head in `style` (sculpted, painted, hybrid): its pieces, cheeks included."""
    name = f'{CID}_Skull{style.title()}'
    sculpt = style in ('sculpted', 'hybrid')
    bone = _skull_shell(m, name, sculpt)
    S = draw.MeshSurf(bone, draw.FaceSurf(F))
    out = [bone]
    if style == 'sculpted':
        out += _paint_skull(S, m, name, teeth=False)
        out += _teeth_3d(S, m, name)
    else:
        out += _paint_skull(S, m, name)
    detailed.chog_cheeks(CID, out, m, F)
    return out
