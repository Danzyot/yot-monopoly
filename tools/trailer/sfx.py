"""Synthesised sound effects for the trailer (numpy only), 48 kHz mono float arrays.

Each function returns one hit; assemble.py places them on the timeline. Run directly to
write every effect to <dir>/<name>.wav for a listen:
    python sfx.py /tmp/sfx
"""

import math
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(7)


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def env(n, a=0.003, d=0.1, sustain=0.0):
    """Attack then exponential decay (d = time constant, s)."""
    t = np.arange(n) / SR
    e = np.minimum(t / max(a, 1e-4), 1.0) * (sustain + (1 - sustain) * np.exp(-np.maximum(t - a, 0) / d))
    return e


def osc(freq):
    """Sine with a per-sample frequency array (or constant)."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), np.asarray(freq).shape or (1,))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def biquad(x, kind, f0, q=0.707, gain_db=0.0):
    """RBJ cookbook biquad (lowpass, highpass, bandpass, peak), constant coefficients."""
    w = 2 * math.pi * f0 / SR
    al = math.sin(w) / (2 * q)
    cw = math.cos(w)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + al, -2 * cw, 1 - al]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + al, -2 * cw, 1 - al]
    elif kind == 'bp':
        b = [al, 0, -al]; a = [1 + al, -2 * cw, 1 - al]
    else:
        A = 10 ** (gain_db / 40)
        b = [1 + al * A, -2 * cw, 1 - al * A]; a = [1 + al / A, -2 * cw, 1 - al / A]
    b = [v / a[0] for v in b]; a = [v / a[0] for v in a]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    b0, b1, b2, a1, a2 = b[0], b[1], b[2], a[1], a[2]
    for i, v in enumerate(x.tolist()):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def sweep_bp(x, f_from, f_to, q=2.0, block=256):
    """Band-pass whose centre glides (processed in blocks)."""
    out = np.zeros_like(x)
    n = len(x)
    state = None
    for s in range(0, n, block):
        k = s / max(n - 1, 1)
        f = f_from * (f_to / f_from) ** k
        seg = x[max(0, s - 64):s + block]
        y = biquad(seg, 'bp', f, q)
        out[s:s + block] = y[-len(x[s:s + block]):]
    return out


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


# ---- the effects -----------------------------------------------------------------------

def squeak(pitch=1.0):
    """A rubber sole: a fast chirp with a wobble."""
    t = t_(0.075)
    f = pitch * (1700 + 1100 * np.sin(np.pi * np.minimum(t / 0.075, 1)) + 90 * np.sin(2 * np.pi * 55 * t))
    s = osc(f) + 0.25 * osc(2 * f)
    return norm(s * env(len(t), 0.004, 0.03), 0.5)


def boing(pitch=1.0, dur=0.5):
    """A spring: a pitch that dips and rings back up with a decaying wobble."""
    t = t_(dur)
    base = pitch * (140 + 260 * (1 - np.exp(-t / 0.06)))
    f = base * (1 + 0.35 * np.exp(-t / 0.18) * np.sin(2 * np.pi * 16 * t))
    s = osc(f) + 0.4 * osc(1.5 * f) * np.exp(-t / 0.1)
    return norm(s * env(len(t), 0.004, 0.16), 0.8)


def flatten():
    """The O squashing: a soft low thud with a squelch on top."""
    t = t_(0.35)
    thud = osc(110 * np.exp(-t / 0.08) + 45) * env(len(t), 0.002, 0.07)
    sq = sweep_bp(noise(0.35), 900, 260, q=4) * env(len(t), 0.005, 0.07)
    return norm(thud + 0.6 * norm(sq), 0.85)


def thump(pitch=1.0):
    t = t_(0.18)
    s = osc(pitch * (95 * np.exp(-t / 0.05) + 48)) * env(len(t), 0.001, 0.06)
    click = biquad(noise(0.18), 'lp', 2500) * env(len(t), 0.0005, 0.006)
    return norm(s + 0.3 * click, 0.8)


def clack(seed=0):
    """A die hitting the board: two or three hard resonant knocks."""
    r = np.random.default_rng(seed)
    out = np.zeros(int(0.12 * SR))
    for k in range(r.integers(2, 4)):
        n = int(0.03 * SR)
        x = biquad(r.standard_normal(n), 'bp', r.uniform(1800, 3600), 6) * env(n, 0.0003, 0.006)
        x += 0.5 * osc(r.uniform(700, 1100) * np.ones(n)) * env(n, 0.0003, 0.01)
        o = int(r.uniform(0, 0.05) * SR)
        out[o:o + n] += x[:len(out) - o]
    return norm(out, 0.7)


def pop(pitch=1.0):
    """A house popping up: a quick upward 'plop'."""
    t = t_(0.14)
    f = pitch * (260 + 900 * (t / 0.14) ** 0.6)
    s = osc(f) * env(len(t), 0.002, 0.04)
    return norm(s, 0.7)


def chime(notes=(0, 4, 7, 12), base=784.0, gap=0.07, ring=0.6):
    """A bright arpeggio (bell partials)."""
    out = np.zeros(int((gap * len(notes) + ring) * SR))
    for k, n in enumerate(notes):
        f = base * 2 ** (n / 12)
        t = t_(ring)
        s = osc(f * np.ones_like(t)) + 0.35 * osc(2.76 * f * np.ones_like(t)) * np.exp(-t / 0.08) + 0.2 * osc(5.4 * f * np.ones_like(t)) * np.exp(-t / 0.04)
        s *= env(len(t), 0.002, 0.22)
        o = int(k * gap * SR)
        out[o:o + len(s)] += s
    return norm(out, 0.6)


def whoosh(dur=0.5, f_from=500, f_to=2400, peak_at=0.6):
    n = int(dur * SR)
    t = np.arange(n) / n
    shape = np.where(t < peak_at, (t / peak_at) ** 2, ((1 - t) / (1 - peak_at)) ** 1.5)
    s = sweep_bp(noise(dur), f_from, f_to, q=1.2) * shape
    return norm(s, 0.8)


def skid(dur=0.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sweep_bp(noise(dur), 1500, 900, q=8) * (1 + 0.5 * np.sin(2 * np.pi * 31 * t))
    e = np.minimum(t / 0.03, 1) * np.clip(1 - t / dur, 0, 1) ** 0.6
    return norm(x * e, 0.6)


def siren(dur=2.0):
    t = t_(dur)
    f = np.where((t * 2.6) % 1 < 0.5, 960.0, 760.0)
    f = biquad(f, 'lp', 40)                   # glide between the two tones
    s = np.sign(osc(f)) * 0.3 + osc(f)
    s = biquad(s, 'lp', 3000)
    e = np.minimum(t / 0.1, 1) * np.clip((dur - t) / 0.3, 0, 1)
    return norm(s * e, 0.45)


def slap():
    """A card slapped down."""
    n = int(0.1 * SR)
    x = biquad(noise(0.1), 'lp', 5000) * env(n, 0.0005, 0.012)
    x += 0.6 * osc(np.full(n, 150.0)) * env(n, 0.001, 0.025)
    return norm(x, 0.8)


def flick():
    n = int(0.08 * SR)
    x = biquad(noise(0.08), 'hp', 2500) * env(n, 0.001, 0.015)
    return norm(x, 0.5)


def chips(n_clicks=10, dur=0.45, seed=1):
    r = np.random.default_rng(seed)
    out = np.zeros(int((dur + 0.05) * SR))
    for k in range(n_clicks):
        m = int(0.02 * SR)
        x = biquad(r.standard_normal(m), 'bp', r.uniform(3500, 6500), 10) * env(m, 0.0002, 0.004)
        o = int(r.uniform(0, dur) * SR)
        out[o:o + m] += x * r.uniform(0.5, 1)
    return norm(out, 0.6)


def flame(dur=1.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    roar = biquad(noise(dur), 'lp', 700) * np.minimum(t / 0.08, 1) * np.clip((dur - t) / 0.4, 0, 1)
    crack = np.zeros(n)
    idx = rng.integers(0, n - 400, 40)
    for i in idx:
        crack[i:i + 200] += rng.standard_normal(200) * np.exp(-np.arange(200) / 30)
    return norm(norm(roar) + 0.4 * crack, 0.6)


def hit():
    """A cinematic low hit for a title."""
    t = t_(1.4)
    s = osc(52 * np.exp(-t / 0.5) + 30) * env(len(t), 0.002, 0.45)
    n = biquad(noise(1.4), 'lp', 900) * env(len(t), 0.001, 0.05)
    return norm(s + 0.4 * n, 0.9)


def riser(dur=1.2):
    t = t_(dur)
    k = t / dur
    s = sweep_bp(noise(dur), 300, 5000, q=2) * k ** 2
    tone = osc(220 * 2 ** (2 * k)) * k ** 3 * 0.3
    return norm(s + tone, 0.6)


def room(dur=11.0):
    """A dark, faint room tone for the opener."""
    t = t_(dur)
    s = biquad(noise(dur), 'lp', 220) * 0.6 + 0.15 * osc(np.full(len(t), 55.0)) + 0.08 * osc(np.full(len(t), 82.5))
    e = np.minimum(t / 1.0, 1)
    return norm(s * e, 0.12)


def tick():
    n = int(0.03 * SR)
    x = biquad(noise(0.03), 'bp', 4200, 3) * env(n, 0.0005, 0.005)
    return norm(x, 0.25)


ALL = {
    'squeak': squeak, 'boing': boing, 'flatten': flatten, 'thump': thump, 'clack': clack, 'pop': pop,
    'chime': chime, 'whoosh': whoosh, 'skid': skid, 'siren': siren, 'slap': slap, 'flick': flick,
    'chips': chips, 'flame': flame, 'hit': hit, 'riser': riser, 'tick': tick,
}


def write(path, x, sr=SR):
    x = np.clip(x, -1, 1)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    import os
    d = sys.argv[1]
    os.makedirs(d, exist_ok=True)
    for name, fn in ALL.items():
        write(os.path.join(d, f'{name}.wav'), fn())
    print('wrote', len(ALL), 'effects to', d)
