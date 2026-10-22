"""Cut the trailer: lay the shots end to end (cuts, crossfades, whip smears), put the
captions over them, mix the music and the effects, and encode the 16:9 master plus one
clip per shot.

    <bpy-venv>/bin/python assemble.py [--half] [--no-clips]

Frames come from $TRAILER_OUT/frames/<shot>/; a shot whose final render isn't complete
falls back to its draft (upscaled, marked DRAFT), then to a placeholder card. Canvas
pages (card/*.html) are rendered to frames first if missing. Output: $TRAILER_OUT/cut/.
"""

import json
import math
import os
import shutil
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import sfx

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('TRAILER_OUT', '/tmp/trailer')
FR = os.path.join(OUT, 'frames')
CARD = os.path.join(OUT, '..', 'card')          # page working folder (fonts, layout, assets)
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
MUSIC = os.environ.get('TRAILER_MUSIC', '')
FPS = 24
HALF = '--half' in sys.argv
W, H = (960, 540) if HALF else (1920, 1080)

# ---- the edit -----------------------------------------------------------------------------
# name, source, duration, crossfade-in (s), extras
# source: ('frames', dir, draft dir) or ('page', 'file.html#arg')
EDL = [
    ('the-o', ('frames', 'shot01', 'shot01-draft'), 10.8, 0.0, {}),
    ('title', ('page', 'title2d.html'), 2.6, 0.5, {}),
    ('tour', ('frames', 'shot02', None), 7.5, 0.35, {'smear': [(2.32, 2.78), (4.82, 5.28)]}),
    ('site', ('page', 'screens.html#home'), 3.5, 0.0, {}),
    ('monopoly', ('frames', 'shot03', None), 13.0, 0.0, {}),
    ('monopoly-web', ('page', 'screens.html#monopoly-game'), 3.0, 0.0, {}),
    ('cards', ('frames', 'shot05', None), 7.0, 0.0, {}),
    ('cards-web', ('page', 'screens.html#cards-table'), 3.0, 0.0, {}),
    ('poker', ('frames', 'shot06', None), 4.0, 0.0, {}),
    ('poker-web', ('page', 'screens.html#poker-table'), 3.0, 0.0, {}),
    ('nft', ('page', 'nft.html'), 4.0, 0.0, {}),
    ('nft-run', ('frames', 'nft-run', None), 4.0, 0.25, {}),
    ('dailies', ('page', 'screens.html#dailies-phone'), 3.0, 0.0, {}),
    ('finale', ('frames', 'shot08', None), 4.0, 0.0, {}),
    ('end', ('page', 'endcard.html'), 3.6, 0.5, {}),
]

CAPTIONS = {
    'tour': [(0.5, 2.25, 'MONOPOLY', 'game'), (2.9, 4.75, 'CARDS', 'game'), (5.4, 7.3, 'POKER', 'game')],
    'site': [(0.15, 3.35, 'Play free in your browser.', 'top')],
    'monopoly': [(0.3, 2.5, 'Roll the dice', 'lower'), (5.5, 7.9, 'Build up to a hotel', 'lower'), (8.1, 9.9, 'Mind the cops', 'lower'), (10.4, 12.8, 'Straight to jail', 'lower')],
    'cards': [(1.7, 3.8, 'Stack the Draw Fours', 'lower'), (5.0, 6.9, 'Last card. On fire.', 'lower')],
    'poker': [(0.2, 1.9, 'Chog Poker', 'lower'), (2.4, 3.95, 'Read the table. Take the pot.', 'lower')],
    'monopoly-web': [(0.15, 2.9, 'Friends or bots, any time.', 'top')],
    'poker-web': [(0.15, 2.9, 'Pull up a seat.', 'top')],
    'nft': [(0.15, 1.9, 'Hold a Chog?', 'top'), (2.0, 3.9, 'Play as it.', 'top')],
    'nft-run': [(0.5, 3.8, 'Your Chog. In the game.', 'top')],
    'dailies': [(0.15, 2.9, 'Daily challenges, streaks and leaderboards.', 'top')],
}

# Shot 1's footfalls (film.Walk.footfalls for walk_in and walk_up).
STEPS = [1.119, 1.25, 1.351, 1.445, 1.54, 1.634, 1.728, 1.822, 1.924, 2.018, 2.112, 2.207, 2.301, 2.395,
         2.489, 2.584, 2.685, 2.779, 2.873, 2.968, 3.062, 3.156, 3.258, 3.388, 5.348, 5.438, 5.528, 5.618,
         5.708, 5.795, 5.885, 5.975, 6.065, 6.155]


SFX_DIR = os.environ.get('TRAILER_SFX', os.path.join(OUT, '..', 'audio', 'sfx'))   # real recordings (credits.md there)


def effects():
    """(segment, local time, sound file in SFX_DIR, gain in dB)."""
    ev = [('the-o', 0.0, 'room-tone', -26)]
    for i, t in enumerate(STEPS):
        ev.append(('the-o', t, f'squeak-{1 + i % 4}', -17 + 2 * (i % 3 == 0)))
    for i, (up, down) in enumerate(zip([6.95, 7.5, 7.98, 8.46], [7.38, 7.86, 8.33, 8.84])):
        ev.append(('the-o', up - 0.02, 'hop', -8))
        ev.append(('the-o', down, 'flatten', -6 + 1.5 * i))
    ev += [('the-o', 9.6, 'sit', -10), ('title', 0.0, 'impact', -2)]
    ev += [('tour', 2.12, 'whoosh-1', -4), ('tour', 4.62, 'whoosh-3', -4),
           ('tour', 3.45, 'card-flick', -10), ('tour', 3.9, 'card-slap-1', -8)]
    for seg in ('site', 'monopoly-web', 'cards-web', 'poker-web', 'dailies'):
        ev.append((seg, 0.0, 'whoosh-2', -9))
    m = 'monopoly'
    ev += [(m, 0.15, 'dice-shake', -6), (m, 0.95, 'whoosh-2', -10),
           (m, 1.38, 'dice-hit-1', -3), (m, 1.41, 'dice-hit-2', -5), (m, 1.7, 'dice-hit-3', -6),
           (m, 1.73, 'dice-hit-1', -8), (m, 1.98, 'dice-hit-2', -12)]
    for k in range(6):
        ev.append((m, 2.75 + 0.34 * k + 0.03, 'hop', -14))
        ev.append((m, 2.75 + 0.34 * (k + 1), 'land', -9))
    ev.append((m, 4.95, 'ding', -14))
    for k, t in enumerate([5.6, 6.05, 6.5, 6.95]):
        ev.append((m, t, f'pop-{1 + k % 2}', -4))
    ev += [(m, 7.35, 'pop-1', -3), (m, 7.38, 'ding', -6),
           (m, 8.0, 'siren', -10), (m, 8.3, 'skid', -6), (m, 9.2, 'grab', -6), (m, 9.45, 'whoosh-2', -12),
           (m, 10.0, 'siren', -18), (m, 11.15, 'whoosh-2', -8), (m, 11.55, 'land', -4), (m, 11.62, 'jail-door', -3)]
    ev += [(m, 12.2 + 0.1 * k, f'squeak-{1 + k % 4}', -16) for k in range(4)]
    c = 'cards'
    for k, t in enumerate((2.0, 3.2, 4.15)):
        ev += [(c, t - 0.35, 'card-flick', -9), (c, t, f'card-slap-{1 + k % 3}', -2)]
    ev += [(c, 4.25, 'card-shuffle', -5), (c, 5.3, 'fire', -5)]
    p = 'poker'
    ev += [(p, 1.3, 'chips-1', -5), (p, 2.05, 'card-flick', -9), (p, 2.5, 'card-slap-2', -6),
           (p, 2.85, 'ding', -10), (p, 3.2, 'chips-2', -4)]
    ev += [('nft', 0.2 + 0.25 * k, f'pop-{1 + k % 2}', -6) for k in range(3)]
    ev += [('nft', 1.5, 'whoosh-1', -8), ('nft', 2.05, 'ding', -8)]
    f = 'finale'
    for k in range(2):
        for n in (1, 2):
            ev.append((f, n / 2.2 * (1 + 0.15 * k), f'dice-hit-{1 + (k + n) % 3}', -6 - 4 * n))
    ev += [(f, 1.5, 'whoosh-1', -8), (f, 2.12, 'land', -4), (f, 2.0, 'cheer', -9)]
    ev += [('end', 0.04 * i, 'ui-tick', -12) for i in range(9)]
    ev += [('end', 1.1, 'pop-2', -5), ('end', 1.15, 'ding', -9)]
    return ev


# ---- timeline -----------------------------------------------------------------------------

def layout():
    """Start time of each segment on the cut (crossfades overlap the previous one)."""
    t = 0.0
    starts = {}
    for name, src, dur, xf, extra in EDL:
        t -= xf
        starts[name] = t
        t += dur
    return starts, t


def frame_dir(src):
    kind = src[0]
    if kind == 'frames':
        return os.path.join(FR, src[1])
    page = src[1].replace('.html', '').replace('#', '-')
    return os.path.join(FR, 'page-' + page)


def count(d):
    return len([f for f in os.listdir(d) if f.endswith('.png') and not f.endswith('.tmp.png')]) if os.path.isdir(d) else 0


SCREEN_PATH = {'home': '', 'hub': '/games', 'poker-lobby': '/poker', 'poker-table': '/poker', 'cards-table': '/cards',
               'monopoly-game': '/monopoly'}
NFT_ORDER = os.environ.get('TRAILER_NFTS', '824,1699,285').split(',')     # left to right


def prepare_pages():
    """Manifests and links the screen and NFT pages read (captures live outside card/)."""
    root = os.path.join(OUT, '..', 'screens')
    durs = {src[1].split('#')[1]: dur for name, src, dur, xf, extra in EDL if src[0] == 'page' and '#' in src[1]}
    man = {}
    if os.path.isdir(root):
        for n in sorted(os.listdir(root)):
            d = os.path.join(root, n)
            if os.path.isdir(d) and count(d):
                man[n] = {'frames': count(d), 'kind': 'phone' if n.endswith('-phone') else 'browser',
                          'dur': durs.get(n, 3.5), 'path': SCREEN_PATH.get(n, '')}
        with open(os.path.join(root, 'manifest.json'), 'w') as f:
            json.dump(man, f, indent=1)
    nft = os.path.join(CARD, 'nft')
    os.makedirs(nft, exist_ok=True)
    items = []
    for tok in NFT_ORDER:
        art = os.path.join(OUT, '..', 'nft', f'{tok}.png')
        turn = os.path.join(FR, f'nft-turn-{tok}')
        if os.path.exists(art) and count(turn):
            for src, dst in ((art, os.path.join(nft, f'{tok}.png')), (turn, os.path.join(nft, f'turn-{tok}'))):
                if os.path.lexists(dst):
                    os.remove(dst)
                os.symlink(os.path.abspath(src), dst)
            items.append({'token': tok, 'label': f'Chog #{tok}'})
    with open(os.path.join(nft, 'manifest.json'), 'w') as f:
        json.dump(items, f)
    return man, items


def page_ready(src, man, nfts):
    page = src[1].split('#')[0]
    if not os.path.exists(os.path.join(CARD, page)):
        return False
    if page == 'screens.html':
        return src[1].split('#')[1] in man
    if page == 'nft.html':
        return len(nfts) > 0
    return True


def render_pages():
    man, nfts = prepare_pages()
    for name, src, dur, xf, extra in EDL:
        if src[0] != 'page':
            continue
        d = frame_dir(src)
        need = int(round(dur * FPS))
        page = src[1].split('#')[0]
        if count(d) >= need or not page_ready(src, man, nfts):
            continue
        shutil.rmtree(d, ignore_errors=True)
        print('render page', src[1], flush=True)
        subprocess.run(['node', os.path.join(HERE, 'render-canvas.mjs'), os.path.join(CARD, src[1]), d, str(dur), str(FPS)], check=True)


def write_captions(starts):
    caps = []
    for seg, items in CAPTIONS.items():
        for t0, t1, text, kind in items:
            caps.append({'t0': round(starts[seg] + t0, 3), 't1': round(starts[seg] + t1, 3), 'text': text, 'kind': kind})
    with open(os.path.join(CARD, 'captions.json'), 'w') as f:
        json.dump(caps, f, indent=1)
    return caps


def render_captions(total, caps):
    d = os.path.join(FR, 'captions')
    stamp = os.path.join(d, 'captions.json')
    if os.path.exists(stamp) and open(stamp).read() == json.dumps(caps) and count(d) >= int(total * FPS):
        return d
    shutil.rmtree(d, ignore_errors=True)
    subprocess.run(['node', os.path.join(HERE, 'render-canvas.mjs'), os.path.join(CARD, 'captions.html'), d, str(total), str(FPS)], check=True)
    with open(stamp, 'w') as f:
        f.write(json.dumps(caps))
    return d


# ---- pictures -----------------------------------------------------------------------------

_font = None


def font(size):
    try:
        return ImageFont.truetype(os.path.join(OUT, '..', 'fonts', 'Nunito-800.ttf'), size)
    except OSError:
        return ImageFont.load_default(size)


def placeholder(name, t):
    im = Image.new('RGB', (W, H), (24, 12, 44))
    d = ImageDraw.Draw(im)
    d.text((W / 2, H / 2), f'{name} — rendering', fill=(200, 180, 255), font=font(H // 18), anchor='mm')
    return np.asarray(im, dtype=np.float32)


_vignette = None


def vignette():
    global _vignette
    if _vignette is None:
        y, x = np.mgrid[0:H, 0:W]
        r = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
        _vignette = (1 - 0.22 * np.clip(r - 0.55, 0, 1) ** 1.6)[..., None].astype(np.float32)
    return _vignette


def load(path, draft=False):
    im = Image.open(path).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    if draft:
        d = ImageDraw.Draw(im)
        d.text((W - 24, 24), 'DRAFT', fill=(255, 210, 80), font=font(H // 22), anchor='ra')
    return np.asarray(im, dtype=np.float32)


def smear(a, r):
    """Horizontal box blur of radius r px (a whip pan's streak)."""
    r = int(r)
    if r < 1:
        return a
    c = np.cumsum(np.pad(a, ((0, 0), (r + 1, r), (0, 0)), mode='edge'), axis=1)
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)


def seg_frame(entry, local):
    name, src, dur, xf, extra = entry
    local += extra.get('from', 0.0)
    n = int(round((dur + extra.get('from', 0.0)) * FPS))
    i = min(max(int(round(local * FPS)), 0), n - 1)
    d = frame_dir(src)
    is3d = src[0] == 'frames' and src[1].startswith('shot')
    if count(d) >= n:
        a = load(os.path.join(d, f'{i:04d}.png'))
    elif src[0] == 'frames' and src[2] and count(os.path.join(FR, src[2])) >= n:
        a = load(os.path.join(FR, src[2], f'{i:04d}.png'), draft=True)
    elif os.path.exists(os.path.join(d, f'{i:04d}.png')):
        a = load(os.path.join(d, f'{i:04d}.png'), draft=True)
    else:
        return placeholder(name, local)
    for s0, s1 in extra.get('smear', []):
        if s0 <= local <= s1:
            a = smear(a, (W / 1920) * 140 * math.sin(math.pi * (local - s0) / (s1 - s0)))
    if is3d:
        a = a * vignette()
    return a


# ---- sound --------------------------------------------------------------------------------

def read_wav(path):
    with wave.open(path) as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        x = np.frombuffer(w.readframes(n), '<i2').astype(np.float32) / 32768
    x = x.reshape(-1, ch)
    if ch == 1:
        x = np.repeat(x, 2, 1)
    assert sr == sfx.SR, sr
    return x


def mix(starts, total):
    n = int((total + 0.5) * sfx.SR)
    out = np.zeros((n, 2), np.float32)
    title = starts['title']
    if MUSIC and os.path.exists(MUSIC):
        m = read_wav(MUSIC)
        o = int(title * sfx.SR)
        m = m[:n - o].copy()
        fade_in = min(len(m), int(0.08 * sfx.SR))
        m[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
        end = int((total - 2.2 - title) * sfx.SR)
        if end < len(m):
            k = np.ones(len(m))
            k[end:] = np.clip(1 - (np.arange(len(m) - end)) / (1.8 * sfx.SR), 0, 1)
            m *= k[:, None]
        out[o:o + len(m)] += 0.62 * m
    cache = {}
    for seg, t, name, gain in effects():
        if name not in cache:
            cache[name] = read_wav(os.path.join(SFX_DIR, name + '.wav'))
        x = cache[name] * 10 ** (gain / 20)
        o = int((starts[seg] + t) * sfx.SR)
        if o < 0 or o >= n:
            continue
        x = x[:n - o]
        out[o:o + len(x)] += x
    out = np.tanh(out * 1.1) / np.tanh(1.1)
    path = os.path.join(OUT, 'cut', 'mix.wav')
    sfx.write(path, out)
    return path


# ---- the home page loop ---------------------------------------------------------------------
# A silent loop of the best 3D moments behind the site's hero: no captions, short crossfades,
# and the end dissolves into the first shot so it wraps without a seam.
LOOP = [
    ('tour', ('frames', 'shot02', None), 2.6, 0.0, {'from': 0.5}),
    ('monopoly', ('frames', 'shot03', None), 2.3, 0.35, {'from': 5.5}),
    ('cards', ('frames', 'shot05', None), 2.0, 0.35, {'from': 1.55}),
    ('poker', ('frames', 'shot06', None), 2.0, 0.35, {'from': 2.0}),
    ('nft-run', ('frames', 'nft-run', None), 3.0, 0.35, {'from': 0.4}),
    ('finale', ('frames', 'shot08', None), 2.6, 0.35, {'from': 1.0}),
]
LOOP_WRAP = 0.5


def loop_main():
    """Writes <out>/cut/hero-loop-{1080,720}.mp4 and hero-loop-poster.jpg."""
    starts, t = {}, 0.0
    for name, src, dur, xf, extra in LOOP:
        t -= xf
        starts[name] = t
        t += dur
    total = t - LOOP_WRAP
    first = LOOP[0]
    out = os.path.join(OUT, 'cut')
    os.makedirs(out, exist_ok=True)
    raw = os.path.join(out, 'hero-loop-raw.mp4')
    enc = subprocess.Popen([FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
                            '-i', '-', '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-pix_fmt', 'yuv420p', raw], stdin=subprocess.PIPE)
    nf = int(round(total * FPS))
    for f in range(nf):
        # The loop starts LOOP_WRAP into the first shot; its last LOOP_WRAP seconds dissolve into the first shot's start.
        tt = f / FPS + LOOP_WRAP
        layers = [e for e in LOOP if starts[e[0]] - 1e-6 <= tt < starts[e[0]] + e[2] - 1e-6]
        a = seg_frame(layers[0], tt - starts[layers[0][0]]) if layers else None
        if len(layers) > 1:
            b = layers[1]
            k = (tt - starts[b[0]]) / b[3]
            k = k * k * (3 - 2 * k)
            a = a * (1 - k) + seg_frame(b, tt - starts[b[0]]) * k
        wrap = (f / FPS) - (total - LOOP_WRAP)
        if wrap > 0:
            k = wrap / LOOP_WRAP
            k = k * k * (3 - 2 * k)
            a = a * (1 - k) + seg_frame(first, wrap) * k
        enc.stdin.write(np.clip(a, 0, 255).astype(np.uint8).tobytes())
    enc.stdin.close()
    enc.wait()
    for h, crf in ((1080, 25), (720, 27)):
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', raw, '-vf', f'scale=-2:{h}:flags=lanczos', '-c:v', 'libx264',
                        '-profile:v', 'high', '-crf', str(crf), '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an',
                        '-movflags', '+faststart', os.path.join(out, f'hero-loop-{h}.mp4')], check=True)
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', raw, '-vf', f'scale=-2:{h}:flags=lanczos', '-c:v', 'libvpx-vp9',
                        '-crf', str(crf + 10), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', '-an',
                        os.path.join(out, f'hero-loop-{h}.webm')], check=True)
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', raw, '-frames:v', '1', '-vf', 'scale=-2:1080', '-q:v', '3',
                    os.path.join(out, 'hero-loop-poster.jpg')], check=True)
    os.remove(raw)
    print(f'loop {total:.2f}s ->', out)


def web_main():
    """The full trailer for the site: 1080p and 720p H.264 with AAC, and a poster."""
    out = os.path.join(OUT, 'cut')
    master = os.path.join(out, 'chog-games-trailer.mp4')
    for h, crf, ab in ((1080, 24, '160k'), (720, 26, '128k')):
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', master, '-vf', f'scale=-2:{h}:flags=lanczos', '-c:v', 'libx264',
                        '-profile:v', 'high', '-crf', str(crf), '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', ab,
                        '-movflags', '+faststart', os.path.join(out, f'trailer-{h}.mp4')], check=True)
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', master, '-vf', f'scale=-2:{h}:flags=lanczos', '-c:v', 'libvpx-vp9',
                        '-crf', str(crf + 10), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3',
                        '-c:a', 'libopus', '-b:a', ab, os.path.join(out, f'trailer-{h}.webm')], check=True)
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-ss', '11.5', '-i', master, '-frames:v', '1', '-vf', 'scale=-2:1080', '-q:v', '3',
                    os.path.join(out, 'trailer-poster.jpg')], check=True)
    print('web versions in', out)


# ---- encode -------------------------------------------------------------------------------

def main():
    os.makedirs(os.path.join(OUT, 'cut'), exist_ok=True)
    starts, total = layout()
    for name, src, dur, xf, extra in EDL:
        print(f'{starts[name]:6.2f} {name:10s} {dur:4.1f}s  {frame_dir(src)}  {count(frame_dir(src))}/{int(round(dur * FPS))}')
    print(f'total {total:.2f}s', flush=True)
    render_pages()
    caps = write_captions(starts)
    cap_dir = render_captions(total, caps)
    audio = mix(starts, total)
    suffix = '-half' if HALF else ''
    master = os.path.join(OUT, 'cut', f'chog-games-trailer{suffix}.mp4')
    enc = subprocess.Popen([FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
                            '-i', '-', '-i', audio, '-vf', 'noise=alls=3:allf=t', '-c:v', 'libx264', '-preset', 'medium',
                            '-crf', '23' if HALF else '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest',
                            '-movflags', '+faststart', master], stdin=subprocess.PIPE)
    nf = int(round(total * FPS))
    for f in range(nf):
        t = f / FPS
        layers = []
        for e in EDL:
            s = starts[e[0]]
            if s - 1e-6 <= t < s + e[2] - 1e-6:
                layers.append(e)
        a = seg_frame(layers[0], t - starts[layers[0][0]])
        if len(layers) > 1:
            b = layers[1]
            k = (t - starts[b[0]]) / b[3]
            k = k * k * (3 - 2 * k)
            a = a * (1 - k) + seg_frame(b, t - starts[b[0]]) * k
        cp = os.path.join(cap_dir, f'{f:04d}.png')
        if os.path.exists(cp):
            c = Image.open(cp)
            if c.getbbox():
                c = np.asarray(c.resize((W, H), Image.BICUBIC) if HALF else c, dtype=np.float32)
                al = c[..., 3:4] / 255
                a = a * (1 - al) + c[..., :3] * al
        enc.stdin.write(np.clip(a, 0, 255).astype(np.uint8).tobytes())
        if f % 96 == 0:
            print(f'frame {f}/{nf}', flush=True)
    enc.stdin.close()
    enc.wait()
    print('master', master)
    if '--no-clips' not in sys.argv:
        for name, src, dur, xf, extra in EDL:
            clip = os.path.join(OUT, 'cut', f'clip-{name}{suffix}.mp4')
            subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-ss', f'{starts[name]:.3f}', '-i', master, '-t', f'{dur:.3f}',
                            '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', clip], check=True)
        print('clips in', os.path.join(OUT, 'cut'))


if __name__ == '__main__':
    if '--loop' in sys.argv:
        loop_main()
    elif '--web' in sys.argv:
        web_main()
    else:
        main()
