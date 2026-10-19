"""Chog Genesis trait parts: the face parts a verified holder's own Chog is assembled from.

The base Chog (detailed.chog, exported by characters.py) stays the body, hands
and feet of every token. This script exports the swappable head parts, all in
head space (relative to the head pivot) so the game hangs them on the head
bone exactly like the base head (client/src/three/characters/chogToken.ts):

  chog_HeadBare       the face, cheeks and nose, with no eyes, mouth or mane
  chog_HeadSkull      the Skull form: a bald skull with eye sockets, nasal cavity and teeth
  chog_Hair_<trim>    the mane, whole or cut back to sit under a hat (chog_wear.py)
  chog_Eyes_<id>      one node per eyes variant (shared/chogs/traits.ts, ChogEyesVariant)
  chog_LaserBeams     the laser variant's beams, on their own so they can be toggled
  chog_Mouth_<id>     one node per mouth variant (ChogMouthVariant)
  chog_Hat_<shape>    hats, hair and face props (shared/chogs/wear.ts, ChogHatShape)
  chog_Wear_<shape>   outfits, in body space (ChogWearShape)
  chog_Prop_<id>      held props, in right-hand space (ChogPropId)

Hats and outfits are painted per value from the figure's own texture
(material `chog:paint`; see chog_wear.py).

Skin, mane, lens, laser and tear colours are runtime material tints (the
material names are `chog:<key>` like every character's); aura and the
Radioactive glow are runtime effects, not geometry.

    tools/blender/run.sh chog_traits.py [--preview out.png --tokens 1,186,1517]

`--preview` renders whole figures for real tokens (their look resolved by
shared/chogs/traits.ts through chog_look.ts), one frame each, to compare with
the NFT art.
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
from mathutils import Vector  # noqa: E402
import blib  # noqa: E402
import characters  # noqa: E402
import chog_wear  # noqa: E402
import detailed  # noqa: E402
from detailed import CHOG_EYE_AT, ChogFace, M, cyl, ell, loop, rbox, sheet, strand, torus  # noqa: E402

CID = 'chog'
F = ChogFace()
EYE_X, EYE_Y = CHOG_EYE_AT
MOUTH_Y = -0.083
# Material keys the parts use: colour, roughness, metalness (the game's defaults; runtime swaps them anyway).
KEYS = {
    'main': ('#3cb4ff', 0.32, 0), 'skin': ('#f3e6d2', 0.62, 0), 'hair': ('#5b3aa8', 0.75, 0), 'cloth': ('#56349f', 0.85, 0),
    'white': ('#f7f5ef', 0.6, 0), 'ink': ('#15151c', 0.45, 0), 'accent': ('#ec6f98', 0.55, 0), 'gold': ('#f4c542', 0.3, 0.8),
    'glow': ('#7ff6ff', 0.4, 0), 'glass': ('#1c2438', 0.12, 0.7), 'c1': ('#e8323c', 0.5, 0), 'c2': ('#8fd3ff', 0.35, 0),
    'c3': ('#7b4fd8', 0.4, 0), 'denim': ('#3cc35a', 0.6, 0), 'metal': ('#b9c2cf', 0.3, 0.75), 'wood': ('#7a4a24', 0.8, 0),
    # Hats and outfits: the figure's paint texture (white here; the preview tints it).
    'paint': ('#d8d8d8', 0.7, 0),
}


def materials():
    mats = {}
    for key, (color, rough, metal) in KEYS.items():
        mat = bpy.data.materials.new(f'{CID}:{key}')
        mat.use_nodes = True
        b = mat.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*blib.hex_rgb(color), 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if key == 'glow':
            b.inputs['Emission Color'].default_value = (*blib.hex_rgb(color), 1)
            b.inputs['Emission Strength'].default_value = 1.4
        mats[key] = mat
    return mats


# ---- placement helpers ----------------------------------------------------------

def at(side, dx=0.0, dy=0.0, lift=-0.004):
    """A frame on the face at the eye position of `side` (+1 his left), nudged by (dx, dy) in his frame."""
    return F.on_face(side * EYE_X + dx, EYE_Y + dy, lift)


def on(x, y, lift=0.0):
    return F.on_face(x, y, lift)


def line(name, pts, r, mat, lift=0.001, r1=None, n=6, **kw):
    """An ink line drawn on the face through (x, y) points."""
    return strand(name, [(x, y, F.face_z(x, y) + lift) for x, y in pts], r, r1 if r1 is not None else r * 0.85, mat, n=n, **kw)


def tears(name, m, sides=(-1, 1), length=0.05):
    """Tear streams running down the cheeks from the lower lid."""
    out = []
    for s in sides:
        x0, y0 = s * (EYE_X - 0.004), EYE_Y - 0.027
        pts = [(x0, y0), (x0 + s * 0.002, y0 - length * 0.5), (x0 + s * 0.003, y0 - length)]
        out.append(strand(f'{name}{s}', [(x, y, F.face_z(x, y) + 0.002) for x, y in pts], 0.0048, 0.0036, m['c2'],
                          up=(0, 0, 1), flat=0.5, ring=8, n=6))
    return out


def tear_drop(name, m, side, dx=0.012, dy=-0.03):
    return ell(name, (0, 0, 0), (0.0038, 0.0058, 0.003), m['c2'], parent=at(side, side * dx, dy, 0.002), seg=(10, 7))


# ---- eyes --------------------------------------------------------------------------

def eyes_normal(m):
    head = []
    detailed.chog_eyes(CID, head, m, F, blink=False)
    return head


def eyes_round(m, pupil=0.0135, rx=0.029, ry=0.030, glint=True):
    out = []
    for s in (-1, 1):
        G = at(s)
        out.append(ell(f'{CID}_RoundRim{s}', (0, 0, -0.0015), (rx + 0.0025, ry + 0.0025, 0.010), m['ink'], parent=G, seg=(24, 16)))
        out.append(ell(f'{CID}_RoundWhite{s}', (0, 0, 0), (rx, ry, 0.011), m['white'], parent=G, seg=(24, 16)))
        out.append(ell(f'{CID}_RoundPupil{s}', (0, -0.001, 0.0085), (pupil, pupil * 1.05, 0.004), m['ink'], parent=G, seg=(18, 12)))
        if glint:
            out.append(ell(f'{CID}_RoundGlint{s}', (-0.006, 0.008, 0.0125), (0.005, 0.005, 0.0018), m['white'], parent=G, seg=(10, 6)))
    return out


def eyes_round_small(m):
    return eyes_round(m, pupil=0.0085)


def eyes_round_crying(m):
    return eyes_round(m) + tears(f'{CID}_Tear', m)


def eyes_round_tear(m):
    return eyes_round(m) + [tear_drop(f'{CID}_Drop', m, -1)]


def eyes_teary(m):
    out = eyes_round(m, pupil=0.019)
    for s in (-1, 1):
        G = at(s)
        out.append(ell(f'{CID}_TearyGlint{s}', (0.009, -0.009, 0.0128), (0.0032, 0.0032, 0.0015), m['white'], parent=G, seg=(8, 6)))
        out.append(tear_drop(f'{CID}_TearyDrop{s}', m, s, dx=-0.01, dy=-0.031))
    return out


def eyes_closed_crying(m):
    out = []
    for s in (-1, 1):
        x = s * EYE_X
        out.append(line(f'{CID}_Shut{s}', [(x - 0.026, EYE_Y + 0.002), (x, EYE_Y - 0.003), (x + 0.026, EYE_Y + 0.002)], 0.0026, m['ink']))
    return out + tears(f'{CID}_Tear', m)


def eyes_happy(m):
    out = []
    for s in (-1, 1):
        x = s * EYE_X
        out.append(line(f'{CID}_Happy{s}', [(x - 0.024, EYE_Y - 0.006), (x - 0.012, EYE_Y + 0.007), (x, EYE_Y + 0.011),
                                            (x + 0.012, EYE_Y + 0.007), (x + 0.024, EYE_Y - 0.006)], 0.003, m['ink'], r1=0.0028))
    return out


def eyes_xd(m):
    out = []
    for s in (-1, 1):
        # Each eye a chevron pointing in toward the nose: > <
        apex = (s * (EYE_X - 0.013), EYE_Y - 0.001)
        for k, dy in enumerate((0.015, -0.015)):
            out.append(line(f'{CID}_Xd{s}{k}', [(s * (EYE_X + 0.013), EYE_Y + dy), apex], 0.0032, m['ink'], r1=0.003, n=4))
    return out


def eyes_flat(m):
    return [line(f'{CID}_Flat{s}', [(s * EYE_X - 0.026, EYE_Y), (s * EYE_X + 0.026, EYE_Y)], 0.0026, m['ink'], n=4) for s in (-1, 1)]


def eyes_side(m, lid_y=0.017, lid_h=0.016, pupil_x=0.012, pupil=(0.011, 0.013), bags=False):
    out = []
    for s in (-1, 1):
        G = at(s)
        out.append(ell(f'{CID}_SideRim{s}', (0, 0, -0.0015), (0.0325, 0.0235, 0.010), m['ink'], parent=G, seg=(24, 14)))
        out.append(ell(f'{CID}_SideWhite{s}', (0, 0, 0), (0.03, 0.021, 0.011), m['white'], parent=G, seg=(24, 14)))
        out.append(ell(f'{CID}_SidePupil{s}', (pupil_x, -0.002, 0.0085), (pupil[0], pupil[1], 0.0045), m['ink'], parent=G, seg=(16, 10)))
        # A straight heavy upper lid: a flat-bottomed block over the top of the white.
        out.append(rbox(f'{CID}_SideLid{s}', (0, lid_y, 0.009), (0.068, lid_h, 0.012), m['ink'], parent=G, bevel=0.003, segs=2))
        if bags:
            out.append(line(f'{CID}_Bag{s}', [(s * EYE_X - 0.02, EYE_Y - 0.027), (s * EYE_X, EYE_Y - 0.031), (s * EYE_X + 0.02, EYE_Y - 0.027)],
                            0.0017, m['ink'], n=4))
    return out


def eyes_tired(m):
    return eyes_side(m, lid_y=0.0125, lid_h=0.025, pupil_x=0.0, pupil=(0.009, 0.01), bags=True)


def eyes_angry(m):
    out = []
    for s in (-1, 1):
        G = at(s)
        out.append(ell(f'{CID}_AngryRim{s}', (0, 0, -0.0015), (0.0305, 0.028, 0.010), m['ink'], parent=G, seg=(24, 14)))
        out.append(ell(f'{CID}_AngryWhite{s}', (0, 0, 0), (0.028, 0.0255, 0.011), m['white'], parent=G, seg=(24, 14)))
        out.append(ell(f'{CID}_AngryPupil{s}', (s * 0.002, -0.003, 0.0085), (0.012, 0.014, 0.0045), m['ink'], parent=G, seg=(16, 10)))
        # The brow slants down toward the nose.
        out.append(line(f'{CID}_Brow{s}', [(s * (EYE_X + 0.03), EYE_Y + 0.034), (s * (EYE_X + 0.008), EYE_Y + 0.026), (s * (EYE_X - 0.014), EYE_Y + 0.012)],
                        0.0042, m['ink'], lift=0.002, r1=0.0034))
    return out


def eyes_base(m):
    out = []
    for s in (-1, 1):
        G = at(s)
        out.append(ell(f'{CID}_BaseRim{s}', (0, 0, -0.0015), (0.0325, 0.0165, 0.010), m['ink'], parent=G, seg=(24, 12)))
        out.append(ell(f'{CID}_BaseWhite{s}', (0, 0, 0), (0.03, 0.014, 0.011), m['white'], parent=G, seg=(24, 12)))
        out.append(ell(f'{CID}_BasePupil{s}', (0.004, -0.001, 0.0085), (0.011, 0.012, 0.0045), m['ink'], parent=G, seg=(16, 10)))
        # A thick lid line, higher at the outer corner: the determined look.
        out.append(line(f'{CID}_BaseLid{s}', [(s * (EYE_X + 0.03), EYE_Y + 0.013), (s * EYE_X, EYE_Y + 0.011), (s * (EYE_X - 0.03), EYE_Y + 0.004)],
                        0.0032, m['ink'], lift=0.0025, r1=0.0024))
    return out


def eyes_vertical(m):
    out = []
    for s in (-1, 1):
        G = at(s)
        out.append(ell(f'{CID}_VertRim{s}', (0, 0, -0.0015), (0.021, 0.033, 0.010), m['ink'], parent=G, seg=(18, 16)))
        out.append(ell(f'{CID}_VertWhite{s}', (0, 0, 0), (0.019, 0.031, 0.011), m['white'], parent=G, seg=(18, 16)))
        out.append(ell(f'{CID}_VertSlit{s}', (0, -0.001, 0.0085), (0.0055, 0.022, 0.0045), m['ink'], parent=G, seg=(10, 14)))
    return out


def eyes_dead(m):
    out = []
    for s in (-1, 1):
        G = at(s, lift=0.0)
        for k, (a, b) in enumerate((((-0.019, -0.019), (0.019, 0.019)), ((-0.019, 0.019), (0.019, -0.019)))):
            out.append(strand(f'{CID}_Dead{s}{k}', [(a[0], a[1], 0.002), (b[0], b[1], 0.002)], 0.0042, 0.0042, m['ink'], parent=G, ring=8, n=3))
    return out


def eyes_heart(m):
    out = []
    for s in (-1, 1):
        G = at(s, lift=0.003)
        for k in (-1, 1):
            out.append(ell(f'{CID}_HeartLobe{s}{k}', (k * 0.016, 0.011, 0), (0.0185, 0.017, 0.008), m['c1'], parent=G, seg=(16, 10)))
        out.append(rbox(f'{CID}_HeartTip{s}', (0, -0.007, -0.001), (0.037, 0.037, 0.012), m['c1'], r=(0, 0, math.pi / 4), parent=G, bevel=0.005, segs=2))
        out.append(ell(f'{CID}_HeartGlint{s}', (-0.018, 0.017, 0.0065), (0.0045, 0.0045, 0.0015), m['white'], parent=G, seg=(8, 6)))
    return out


def eyes_laser(m):
    """Glowing discs for eyes; the beams are a node of their own (laser_beams)."""
    out = []
    for s in (-1, 1):
        G = at(s, lift=0.0)
        out.append(ell(f'{CID}_LaserRim{s}', (0, 0, 0), (0.0245, 0.0245, 0.005), m['ink'], parent=G, seg=(20, 12)))
        out.append(ell(f'{CID}_LaserEye{s}', (0, 0, 0.002), (0.0205, 0.0205, 0.0065), m['glow'], parent=G, seg=(20, 12)))
    return out


def laser_beams(m):
    out = []
    d = Vector((-0.34, -0.12, 1.0)).normalized()
    for s in (-1, 1):
        G = at(s, lift=0.003)
        start = G @ Vector((0, 0, 0))
        out.append(strand(f'{CID}_Beam{s}', [start, start + d * 0.34], 0.0068, 0.0068, m['glow'], ring=10, round_tip=False, n=3))
    return out


def glasses_arms(name, m, mat, y=0.004, x0=0.03):
    """Temple arms from the lens edge back along the head to the hair."""
    return [strand(f'{name}{s}', [(s * (EYE_X + x0), EYE_Y + y, F.face_z(s * (EYE_X + x0), EYE_Y + y) + 0.003),
                                  (s * 0.112, EYE_Y + y + 0.006, 0.0), (s * 0.118, EYE_Y + y + 0.01, -0.03)], 0.0022, 0.002, m[mat], ring=6, n=5)
            for s in (-1, 1)]


def eyes_anime_glass(m):
    out = []
    for s in (-1, 1):
        G = at(s, lift=0.003)
        out.append(rbox(f'{CID}_AnimeFrame{s}', (0, 0, 0), (0.06, 0.04, 0.005), m['ink'], parent=G, bevel=0.007, segs=3))
        out.append(rbox(f'{CID}_AnimeLens{s}', (0, 0, 0.0025), (0.054, 0.034, 0.005), m['glass'], parent=G, bevel=0.006, segs=3))
    out.append(rbox(f'{CID}_AnimeBridge', (0, 0.002, 0), (0.028, 0.005, 0.004), m['ink'], parent=on(0, EYE_Y, 0.006), bevel=0.0012, segs=1))
    return out + glasses_arms(f'{CID}_AnimeArm', m, 'ink')


def eyes_round_glasses(m, rim, lens_glint=True, bar=None):
    out = []
    for s in (-1, 1):
        G = at(s, lift=0.004)
        out.append(ell(f'{CID}_LensR{s}', (0, 0, 0), (0.027, 0.0255, 0.004), m['glass'], parent=G, seg=(24, 12)))
        out.append(torus(f'{CID}_RimR{s}', (0, 0, 0.001), 0.0272, 0.0028, m[rim], parent=G, seg=32, mseg=8))
        if lens_glint:
            out.append(ell(f'{CID}_LensGlint{s}', (-0.009, 0.01, 0.004), (0.005, 0.0035, 0.0012), m['white'], parent=G, r=(0, 0, 0.7), seg=(10, 6)))
        if bar:
            out.append(rbox(f'{CID}_LensBar{s}', (0, 0, 0.005), (0.004, 0.017, 0.002), m[bar], parent=G, bevel=0.001, segs=1))
            out.append(rbox(f'{CID}_LensBar2{s}', (0, 0.0045, 0.005), (0.011, 0.0035, 0.002), m[bar], parent=G, bevel=0.001, segs=1))
            out.append(rbox(f'{CID}_LensBar3{s}', (0, -0.0045, 0.005), (0.011, 0.0035, 0.002), m[bar], parent=G, bevel=0.001, segs=1))
    out.append(rbox(f'{CID}_BridgeR', (0, 0.004, 0), (0.016, 0.004, 0.004), m[rim], parent=on(0, EYE_Y, 0.007), bevel=0.0012, segs=1))
    return out + glasses_arms(f'{CID}_ArmR', m, rim, y=0.006, x0=0.027)


def eyes_retro_glass(m):
    return eyes_round_glasses(m, 'c1')


def eyes_btc_glass(m):
    return eyes_round_glasses(m, 'gold', lens_glint=False, bar='white')


def eyes_glasses_3d(m):
    out = []
    for s in (-1, 1):
        G = at(s, lift=0.003)
        out.append(rbox(f'{CID}_3dFrame{s}', (0, 0, 0), (0.062, 0.04, 0.005), m['white'], parent=G, bevel=0.004, segs=2))
        # Red over his right eye, blue over his left.
        out.append(rbox(f'{CID}_3dLens{s}', (0, 0, 0.0025), (0.054, 0.032, 0.005), m['c1' if s < 0 else 'glass'], parent=G, bevel=0.003, segs=2))
    out.append(rbox(f'{CID}_3dBridge', (0, 0.002, 0), (0.03, 0.006, 0.004), m['white'], parent=on(0, EYE_Y, 0.006), bevel=0.0012, segs=1))
    return out + glasses_arms(f'{CID}_3dArm', m, 'white')


def eyes_shades(m):
    """Pixel shades: one dark bar across both eyes, each lens dropping a step lower."""
    out = [rbox(f'{CID}_ShadesBar', (0, 0.006, 0), (0.136, 0.02, 0.008), m['ink'], parent=on(0, EYE_Y + 0.002, 0.006), bevel=0.0015, segs=1)]
    for s in (-1, 1):
        G = at(s, lift=0.0055)
        out.append(rbox(f'{CID}_ShadesLens{s}', (s * 0.002, -0.009, 0), (0.05, 0.016, 0.008), m['ink'], parent=G, bevel=0.0015, segs=1))
        out.append(rbox(f'{CID}_ShadesStep{s}', (s * 0.006, -0.018, 0), (0.028, 0.008, 0.008), m['ink'], parent=G, bevel=0.0012, segs=1))
        out.append(rbox(f'{CID}_ShadesShine{s}', (s * 0.012, 0.0, 0.0045), (0.012, 0.004, 0.002), m['white'], parent=G, bevel=0.0008, segs=1))
    return out + glasses_arms(f'{CID}_ShadesArm', m, 'ink', y=0.006, x0=0.032)


def face_surf(x, y):
    return Vector((x, y, F.face_z(x, y)))


def eyes_visor(m, hw=0.108, half_h=0.025, rim='ink', rim_r=0.0025):
    """A wraparound band over the eyes in the lens colour, with a piped rim."""
    panel, border = sheet(f'{CID}_Visor', face_surf, 0, lambda t: hw, EYE_Y + half_h, EYE_Y - half_h, 0.007, 0.004, m['glass'], nu=18, nv=4)
    out = [panel, loop(f'{CID}_VisorRim', border, rim_r, m[rim], axis=(0, 0, 1), ring=8, n=3)]
    out.append(ell(f'{CID}_VisorShine', (0, 0, 0), (0.014, 0.004, 0.0015), m['white'], parent=on(-0.05, EYE_Y + 0.012, 0.0095), r=(0, 0, 0.25), seg=(10, 6)))
    return out


def eyes_goggles(m):
    out = eyes_visor(m, hw=0.1, half_h=0.027, rim='white', rim_r=0.0038)
    # The strap runs back round the head.
    for s in (-1, 1):
        x0 = s * 0.103
        out.append(strand(f'{CID}_Strap{s}', [(x0, EYE_Y + 0.002, F.face_z(x0, EYE_Y) + 0.004), (s * 0.128, EYE_Y + 0.012, -0.03),
                                              (s * 0.1, EYE_Y + 0.03, -0.13), (0, EYE_Y + 0.038, -0.165)], 0.007, 0.007, m['ink'],
                          ring=8, n=5, round_tip=False, up=(0, 1, 0), flat=0.5))
    return out


EYES = {
    'normal': eyes_normal, 'happy': eyes_happy, 'side': eyes_side, 'laser': eyes_laser, 'dead': eyes_dead, 'round': eyes_round,
    'roundSmall': eyes_round_small, 'heart': eyes_heart, 'roundCrying': eyes_round_crying, 'roundTear': eyes_round_tear,
    'closedCrying': eyes_closed_crying, 'teary': eyes_teary, 'tired': eyes_tired, 'angry': eyes_angry, 'flat': eyes_flat,
    'vertical': eyes_vertical, 'base': eyes_base, 'xd': eyes_xd, 'animeGlass': eyes_anime_glass, 'retroGlass': eyes_retro_glass,
    'btcGlass': eyes_btc_glass, 'glasses3d': eyes_glasses_3d, 'shades': eyes_shades, 'visor': eyes_visor, 'goggles': eyes_goggles,
}


# ---- mouths -----------------------------------------------------------------------

def mouth_normal_smile(m):
    head = []
    detailed.chog_mouth(CID, head, m, F)
    return head


def mouth_smile(m):
    return [line(f'{CID}_Smile', [(-0.014, -0.080), (-0.006, -0.0855), (0.004, -0.0865), (0.012, -0.0855), (0.019, -0.080)], 0.0019, m['ink'])]


def mouth_sad(m):
    return [line(f'{CID}_Sad', [(-0.014, -0.0875), (-0.006, -0.0825), (0.003, -0.0812), (0.012, -0.0825), (0.019, -0.0875)], 0.0019, m['ink'])]


def mouth_flat(m):
    return [line(f'{CID}_FlatMouth', [(-0.016, MOUTH_Y), (0.016, MOUTH_Y)], 0.002, m['ink'], n=4)]


def mouth_worried(m):
    return [line(f'{CID}_Worried', [(-0.016, -0.082), (-0.009, -0.0865), (-0.002, -0.0805), (0.005, -0.0865), (0.012, -0.0805), (0.017, -0.084)],
                 0.0018, m['ink'], n=4)]


def mouth_wo(m):
    return [ell(f'{CID}_Wo', (0, 0, 0), (0.0075, 0.0095, 0.004), m['ink'], parent=on(0.003, -0.084, 0.001), seg=(14, 10))]


def mouth_drooling(m):
    out = [ell(f'{CID}_DroolMouth', (0, 0, 0), (0.011, 0.0075, 0.004), m['ink'], parent=on(0.003, -0.084, 0.001), seg=(16, 10))]
    out.append(strand(f'{CID}_Drool', [(0.011, -0.088, F.face_z(0.011, -0.088) + 0.002), (0.013, -0.104, F.face_z(0.013, -0.104) + 0.003),
                                        (0.015, -0.12, F.face_z(0.015, -0.118) + 0.003)], 0.0032, 0.0022, m['c2'], ring=8, n=6))
    return out


def mouth_bubblegum(m):
    out = [ell(f'{CID}_GumMouth', (0, 0, 0), (0.005, 0.004, 0.003), m['ink'], parent=on(0.0, -0.084, 0.001), seg=(10, 8))]
    z = F.face_z(0.012, -0.089) + 0.03
    out.append(ell(f'{CID}_Gum', (0.015, -0.091, z), (0.034, 0.034, 0.034), m['accent'], seg=(28, 18)))
    out.append(ell(f'{CID}_GumShine', (0.003, -0.074, z + 0.026), (0.0075, 0.006, 0.003), m['white'], r=(0.6, 0, 0.3), seg=(10, 6)))
    return out


def mouth_rainbow_puke(m):
    out = [ell(f'{CID}_PukeMouth', (0, 0, 0), (0.012, 0.009, 0.005), m['ink'], parent=on(0.002, -0.085, 0.001), seg=(16, 10))]
    z0 = F.face_z(0, -0.088)
    for k, mat in enumerate(('c1', 'gold', 'denim', 'c2', 'c3')):
        dx = (k - 2) * 0.0068
        out.append(strand(f'{CID}_Rainbow{k}', [(dx * 0.6, -0.088, z0 + 0.002), (dx, -0.125, z0 + 0.045), (dx * 1.1, -0.165, z0 + 0.07)],
                          0.0036, 0.0036, m[mat], ring=8, n=8, round_tip=False))
    return out


def mouth_grin(m, name, coin=None, tooth=None):
    out = [ell(f'{CID}_{name}Mouth', (0, 0, 0), (0.02, 0.009, 0.004), m['ink'], parent=on(0.003, -0.084, 0.001), seg=(20, 10))]
    out.append(rbox(f'{CID}_{name}Teeth', (0, 0, 0), (0.03, 0.0062, 0.004), m['white'], parent=on(0.003, -0.0825, 0.0028), bevel=0.0015, segs=2))
    if tooth:
        out.append(rbox(f'{CID}_{name}Gold', (0, 0, 0), (0.0055, 0.0068, 0.004), m['gold'], parent=on(0.011, -0.0825, 0.0034), bevel=0.001, segs=1))
    if coin:
        G = on(0.006, -0.0865, 0.0045)
        out.append(cyl(f'{CID}_{name}Coin', (0, 0, 0), 0.0125, 0.0035, m[coin], r=(math.pi / 2, 0, 0), parent=G, seg=28))
        out.append(rbox(f'{CID}_{name}CoinBar', (0, 0, 0.002), (0.0028, 0.013, 0.0012), m['ink' if coin == 'gold' else 'white'], parent=G, bevel=0.0006, segs=1))
        out.append(rbox(f'{CID}_{name}CoinBar2', (0.001, 0.003, 0.002), (0.0075, 0.0028, 0.0012), m['ink' if coin == 'gold' else 'white'], parent=G, bevel=0.0006, segs=1))
        out.append(rbox(f'{CID}_{name}CoinBar3', (0.001, -0.003, 0.002), (0.0075, 0.0028, 0.0012), m['ink' if coin == 'gold' else 'white'], parent=G, bevel=0.0006, segs=1))
    return out


def mouth_gold_tooth(m):
    return mouth_grin(m, 'GoldTooth', tooth=True)


def mouth_btc_coin(m):
    return mouth_grin(m, 'Btc', coin='gold')


def mouth_mon_coin(m):
    return mouth_grin(m, 'Mon', coin='c3')


def mouth_grit(m):
    G = on(0.002, -0.084, 0.002)
    out = [rbox(f'{CID}_GritRim', (0, 0, -0.0015), (0.036, 0.0155, 0.003), m['ink'], parent=G, bevel=0.002, segs=2),
           rbox(f'{CID}_GritTeeth', (0, 0, 0), (0.032, 0.012, 0.005), m['white'], parent=G, bevel=0.002, segs=2),
           rbox(f'{CID}_GritMid', (0, 0, 0.0027), (0.032, 0.0012, 0.0015), m['ink'], parent=G, bevel=0.0004, segs=1)]
    for k, dx in enumerate((-0.0085, 0.0, 0.0085)):
        out.append(rbox(f'{CID}_GritGap{k}', (dx, 0, 0.0027), (0.0012, 0.012, 0.0015), m['ink'], parent=G, bevel=0.0004, segs=1))
    return out


def mouth_lip_bite(m):
    out = [line(f'{CID}_BiteLip', [(-0.015, -0.0815), (0.0, -0.083), (0.016, -0.0815)], 0.0021, m['ink'], n=4)]
    G = on(0.005, -0.0865, 0.0022)
    out.append(rbox(f'{CID}_BiteTeeth', (0, 0, 0), (0.015, 0.0062, 0.004), m['white'], parent=G, bevel=0.0015, segs=2))
    out.append(rbox(f'{CID}_BiteGap', (0, 0, 0.0022), (0.0012, 0.0062, 0.0012), m['ink'], parent=G, bevel=0.0004, segs=1))
    return out


def mouth_clown(m):
    pts = [(-0.034, -0.071), (-0.02, -0.086), (0, -0.0915), (0.02, -0.086), (0.034, -0.071)]
    out = [strand(f'{CID}_ClownLips', [(x, y, F.face_z(x, y) + 0.0015) for x, y in pts], 0.0058, 0.0048, m['c1'], up=(0, 0, 1), flat=0.45, ring=8, n=6)]
    out.append(line(f'{CID}_ClownLine', [(x, y - 0.002) for x, y in pts[1:4]], 0.0016, m['ink'], lift=0.0035))
    return out


MOUTHS = {
    'normalSmile': mouth_normal_smile, 'sad': mouth_sad, 'drooling': mouth_drooling, 'smile': mouth_smile, 'bubblegum': mouth_bubblegum,
    'rainbowPuke': mouth_rainbow_puke, 'worried': mouth_worried, 'goldTooth': mouth_gold_tooth, 'wo': mouth_wo, 'lipBite': mouth_lip_bite,
    'btcCoin': mouth_btc_coin, 'clownMouth': mouth_clown, 'flat': mouth_flat, 'monCoin': mouth_mon_coin, 'grit': mouth_grit,
}


# ---- heads --------------------------------------------------------------------------

def head_bare(m):
    """The base head minus its eyes, mouth and mane (the nose in the blush colour: c1 is red on a token)."""
    head = [F.build(f'{CID}_BareFace', m['skin'])]
    detailed.chog_cheeks(CID, head, m, F)
    detailed.chog_nose(CID, head, m, F, mat='accent')
    return head


def head_skull(m):
    """The Skull form: the same face as bone, with hollow sockets, a nasal cavity and a row of teeth, and a bald
    cranium behind (the skulls in the art have no mane)."""
    head = [F.build(f'{CID}_SkullBone', m['skin'])]
    head.append(ell(f'{CID}_SkullCranium', (0, 0.02, -0.045), (0.114, 0.12, 0.11), m['skin'], seg=(36, 24), fuse=True))
    for s in (-1, 1):
        head.append(ell(f'{CID}_Socket{s}', (0, 0, 0), (0.035, 0.036, 0.014), m['ink'], parent=at(s, lift=-0.009), seg=(24, 16)))
    head.append(ell(f'{CID}_Nasal', (0, 0, 0), (0.011, 0.014, 0.006), m['ink'], parent=on(0, -0.0605, -0.003), seg=(14, 10)))
    G = on(0, -0.0855, 0.002)
    head.append(rbox(f'{CID}_Teeth', (0, 0, 0), (0.06, 0.017, 0.008), m['white'], parent=G, bevel=0.0035, segs=3))
    for k, dx in enumerate((-0.0225, -0.0115, 0.0, 0.0115, 0.0225)):
        head.append(rbox(f'{CID}_ToothGap{k}', (dx, 0, 0.0038), (0.0014, 0.017, 0.0015), m['ink'], parent=G, bevel=0.0004, segs=1))
    head.append(line(f'{CID}_UpperLip', [(-0.029, -0.0785), (0, -0.0775), (0.029, -0.0785)], 0.0017, m['ink'], lift=0.003))
    head.append(line(f'{CID}_Jaw', [(-0.028, -0.0925), (0, -0.0935), (0.028, -0.0925)], 0.0017, m['ink'], lift=0.003))
    detailed.chog_cheeks(CID, head, m, F)
    return head


# ---- build ---------------------------------------------------------------------------

def assemble(name, objs):
    """Realize the pieces, fuse what is flagged (per material) and join everything into one node."""
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
        budget = max(int(o.get('budget', characters.FACE_BUDGET)) for o in os_)
        fine = any('Hair' in o.name for o in os_)
        pieces.append(characters.fuse(os_, f'{name}_{mat}', budget=budget, voxel=0.0018 if fine else characters.VOXEL))
    return blib.join(pieces + loose, name)


def build(m):
    nodes = {'HeadBare': assemble(f'{CID}_HeadBare', head_bare(m)), 'HeadSkull': assemble(f'{CID}_HeadSkull', head_skull(m))}
    for vid, fn in EYES.items():
        nodes[f'Eyes_{vid}'] = assemble(f'{CID}_Eyes_{vid}', fn(m))
    nodes['LaserBeams'] = assemble(f'{CID}_LaserBeams', laser_beams(m))
    for vid, fn in MOUTHS.items():
        nodes[f'Mouth_{vid}'] = assemble(f'{CID}_Mouth_{vid}', fn(m))
    for trim in chog_wear.TRIMS:
        nodes[f'Hair_{trim}'] = assemble(f'{CID}_Hair_{trim}', chog_wear.hair(m, trim))
    for shape, fn in {**chog_wear.HATS, **chog_wear.HOODS}.items():
        nodes[f'Hat_{shape}'] = chog_wear.assemble(f'{CID}_Hat_{shape}', fn(m))
    for shape, fn in chog_wear.WEARS.items():
        nodes[f'Wear_{shape}'] = chog_wear.assemble(f'{CID}_Wear_{shape}', fn(m))
    for pid, fn in chog_wear.PROPS.items():
        nodes[f'Prop_{pid}'] = chog_wear.assemble(f'{CID}_Prop_{pid}', fn(m))
    return nodes


# ---- preview -------------------------------------------------------------------------

def looks_for(ids):
    out = os.path.join(tempfile.gettempdir(), 'yot-chog-looks.json')
    subprocess.run(['node', '--import', 'tsx', os.path.join(blib.HERE, 'chog_look.ts'), out, *map(str, ids)], cwd=blib.REPO, check=True)
    with open(out) as f:
        return json.load(f)


def tint(m, look):
    """Colour the shared materials the way the game's makeMaterials would for this token."""
    for key, (color, rough, metal) in KEYS.items():
        b = m[key].node_tree.nodes['Principled BSDF']
        c = look['colors'].get(key, color)
        b.inputs['Base Color'].default_value = (*blib.hex_rgb(c), 1)
        glow = key == 'glow' or (look['base'] == 'radioactive' and key in ('skin', 'hair'))
        b.inputs['Emission Color'].default_value = (*blib.hex_rgb(c), 1) if glow else (0, 0, 0, 1)
        b.inputs['Emission Strength'].default_value = 1.4 if key == 'glow' else 0.9 if glow else 0.0


def preview(nodes, m, ids, path):
    """One figure per token, front view, against its background colour; a contact sheet with the art is made by the caller."""
    sc = bpy.context.scene
    looks = looks_for(ids)
    far = (100, 100, 0)
    HEAD = Vector(blib.V(*characters.PART_PIVOTS['Head']))
    body = detailed.chog_body(CID, m)
    blib.realize(body['Body'] + body['HandL'] + body['HandR'])
    for part in ('HandL', 'HandR'):
        px, py, pz = characters.PART_PIVOTS[part]
        for o in body[part]:
            o.location = blib.V(px, py, pz)
    (sx, sy, sz), rad = detailed.ARMS[CID]
    for side, hand in ((1, characters.PART_PIVOTS['HandL']), (-1, characters.PART_PIVOTS['HandR'])):
        blib.tube(f'PreviewArm{side}', [(sx * side, sy, sz), hand], rad, m['cloth'], segs=10)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    blib.link(cam)
    cam.data.lens = 70
    cam.location = blib.V(0, 0.36, 1.05)
    cam.rotation_euler = (math.radians(84), 0, 0)
    sc.camera = cam
    key = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'AREA'))
    key.data.energy, key.data.size = 60, 0.8
    key.location = blib.V(0.5, 0.9, 0.9)
    key.rotation_euler = (math.radians(45), 0, math.radians(28))
    blib.link(key)
    fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'AREA'))
    fill.data.energy, fill.data.size = 25, 1.2
    fill.location = blib.V(-0.7, 0.5, 0.8)
    fill.rotation_euler = (math.radians(60), 0, math.radians(-40))
    blib.link(fill)
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    sc.world = world
    sc.render.resolution_x, sc.render.resolution_y = 420, 480
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    outs = []
    by_name = {n.name: n for n in nodes.values()}
    # The paint texture is the client's: here hats and outfits just take their ground colour, each its own material.
    body_paint = m['paint'].copy()
    swapped = []
    for n in nodes.values():
        if n.name.startswith(f'{CID}_Wear_'):
            for k, slot in enumerate(n.material_slots):
                if slot.material == m['paint']:
                    n.data.materials[k] = body_paint
                    swapped.append((n, k))
    place = {'Head': HEAD, 'Body': Vector((0, 0, 0)), 'HandR': Vector(blib.V(*characters.PART_PIVOTS['HandR']))}
    for tid in ids:
        look = looks[str(tid)]
        tint(m, look)
        for mat, part in ((m['paint'], look['head']), (body_paint, look['body'])):
            if part:
                mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*blib.hex_rgb(part['paint']['base']), 1)
        world.node_tree.nodes['Background'].inputs['Color'].default_value = (*blib.hex_rgb(look['background']), 1)
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
        for n in nodes.values():
            n.location = far
        for bone, names in look['parts'].items():
            for name in names:
                by_name[name].location = place[bone]
        out = f'{os.path.splitext(path)[0]}_{tid}.png'
        sc.render.filepath = out
        bpy.ops.render.render(write_still=True)
        outs.append(out)
        blib.log('preview', tid, look['form'], look['eyes'], look['mouth'], '→', out)
    for n in nodes.values():
        n.location = (0, 0, 0)
    # The export wants every hat and outfit in the one paint material again.
    for n, k in swapped:
        n.data.materials[k] = m['paint']
    bpy.data.materials.remove(body_paint)
    for o in list(sc.objects):
        if o.type != 'MESH' or o.name.split('_', 1)[0] != CID or o not in nodes.values():
            if o not in nodes.values():
                bpy.data.objects.remove(o)
    return outs


def main():
    blib.reset()
    m = materials()
    nodes = build(m)
    for name, n in nodes.items():
        blib.log(name, f'{len(n.data.polygons)}f')
    if '--preview' in sys.argv:
        ids = [int(x) for x in sys.argv[sys.argv.index('--tokens') + 1].split(',')] if '--tokens' in sys.argv else [1, 186, 1517]
        preview(nodes, m, ids, sys.argv[sys.argv.index('--preview') + 1])
        if '--no-export' in sys.argv:
            return
    rel = f'models/characters/{CID}-traits.glb'
    blib.export_glb(list(nodes.values()), rel, images='NONE')
    low_rel = f'models/characters/{CID}-traits-low.glb'
    blib.gltfpack(os.path.join(blib.PUBLIC, low_rel), ['-si', str(characters.LOW_RATIO)], src=os.path.join(blib.HERE, '.cache', rel))
    blib.log('wrote', low_rel, f'{os.path.getsize(os.path.join(blib.PUBLIC, low_rel)) // 1024} KB')
    blib.record('chogTraits', {'url': f'/{rel}', 'low': f'/{low_rel}'})


if __name__ == '__main__':
    main()
