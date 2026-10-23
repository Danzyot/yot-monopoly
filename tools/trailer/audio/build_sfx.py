"""Build the trailer SFX set from downloaded sources into ../sfx/*.wav (48 kHz, 16-bit, stereo).
Every output: lead trimmed so the sound starts within ~1-2 ms, tail trimmed + faded, peak-normalised to -1 dBFS."""
import subprocess, wave, os, sys
import numpy as np

FF = '/tmp/chog-trailer/video/node_modules/ffmpeg-static/ffmpeg'
A = '/tmp/chog-trailer/bl/audio'
D = A + '/dl'
OUT = A + '/sfx'
SR = 48000
K = D + '/kenney'
KC = K + '/kenney_casino-audio/Audio/'
KI = K + '/kenney_impact-sounds/Audio/'
KR = K + '/kenney_rpg-audio/Audio/'
KF = K + '/kenney_interface-sounds/Audio/'
RAW = D + '/raw/'
PX = D + '/pxsfx/'


def load(path, ss=None, t=None, gain_db=0.0, af=None):
    cmd = [FF, '-v', 'error']
    if ss is not None:
        cmd += ['-ss', str(ss)]
    if t is not None:
        cmd += ['-t', str(t)]
    cmd += ['-i', path]
    if af:
        cmd += ['-af', af]
    cmd += ['-ac', '2', '-ar', str(SR), '-f', 'f32le', '-']
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32)
    x = x.reshape(-1, 2).astype(np.float64)
    x -= x.mean(0)
    return x * 10 ** (gain_db / 20)


def fade(x, fin_ms=0.0, fout_ms=0.0):
    x = x.copy()
    if fin_ms > 0:
        n = min(len(x), int(fin_ms / 1000 * SR))
        x[:n] *= np.linspace(0, 1, n)[:, None]
    if fout_ms > 0:
        n = min(len(x), int(fout_ms / 1000 * SR))
        x[-n:] *= (np.linspace(1, 0, n) ** 2)[:, None]
    return x


def norm(x):
    return x / (np.abs(x).max() + 1e-12)


def mix(*layers):
    """layers: (array, offset_seconds)"""
    n = max(int(o * SR) + len(a) for a, o in layers)
    y = np.zeros((n, 2))
    for a, o in layers:
        i = int(o * SR)
        y[i:i + len(a)] += a
    return y


def finalize(name, x, gate=-36.0, tailgate=-50.0, fade_ms=15.0, maxlen=None, peak_db=-1.0, trim=True, fadein_ms=0.0):
    mono = np.abs(x).max(1)
    pk = mono.max()
    if trim:
        i0 = int(np.argmax(mono > pk * 10 ** (gate / 20)))
        i0 = max(0, i0 - int(0.001 * SR))
        blk = 480
        n = len(x) // blk
        r = np.sqrt((x[:n * blk].reshape(n, blk, 2) ** 2).mean((1, 2)))
        idx = np.where(r > pk * 10 ** (tailgate / 20))[0]
        i1 = min(len(x), (idx[-1] + 1) * blk + int(0.02 * SR)) if len(idx) else len(x)
        x = x[i0:i1]
    if maxlen and len(x) > maxlen * SR:
        x = x[:int(maxlen * SR)]
    x = fade(x, fadein_ms, fade_ms)
    x = x * (10 ** (peak_db / 20) / np.abs(x).max())
    y = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    p = f'{OUT}/{name}.wav'
    with wave.open(p, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(y.tobytes())
    m = np.abs(x).max(1)
    on = np.argmax(m > np.abs(x).max() * 10 ** (-30 / 20))
    print(f'{name:14s} {len(x)/SR:6.3f}s  onset(-30dB)={on/SR*1000:5.1f}ms  peak={20*np.log10(np.abs(x).max()):.2f}dBFS')


os.makedirs(OUT, exist_ok=True)
only = set(sys.argv[1:])
def want(n):
    return not only or n in only

# ---- cute squeaky footsteps (rubber toy squeaks, CC0 Freesound via GitHub mirrors)
if want('squeak'):
    finalize('squeak-1', load(RAW + 'jeop_squeaky-toy.mp3', ss=0.38, t=0.24), fade_ms=25)      # Breviceps #4, 3rd squeak
    finalize('squeak-2', load(RAW + 'wa_SqueakyToyShort.ogg', ss=0.35, t=0.20), fade_ms=25)    # arc241, 2nd squeak
    finalize('squeak-3', load(RAW + 'otd_squeak_qubodup.mp3'), fade_ms=25)                     # qubodup Squeaky Toy 7
    finalize('squeak-4', load(RAW + 'wa_SqueakyToyShort.ogg', ss=0.02, t=0.28), fade_ms=25)    # arc241, 1st squeak

# ---- hop: human-made jump foley (CCOUNTERFEIT, CC0) + head of a cartoon boing (sdroliasnick, CC0)
if want('hop'):
    jump = norm(load(RAW + 'df_character_jump_3.ogg'))
    boing = fade(norm(load(RAW + 'df_character_spring_0.ogg', t=0.42)), 0, 160) * 10 ** (-7 / 20)
    finalize('hop', mix((jump, 0.0), (boing, 0.012)), fade_ms=40)

# ---- land: soft low thump + carpet footstep texture (Kenney Impact Sounds, CC0)
if want('land'):
    th = norm(load(KI + 'impactSoft_medium_001.ogg'))
    st = norm(load(KI + 'footstep_carpet_000.ogg')) * 10 ** (-6 / 20)
    finalize('land', mix((th, 0.0), (st, 0.0)), fade_ms=30)

# ---- flatten: heavy soft thump + punchy body + short rubbery squelch (Kenney CC0 + Bricklover CC0)
if want('flatten'):
    th = norm(load(KI + 'impactSoft_heavy_000.ogg'))
    body = norm(load(KI + 'impactPunch_medium_000.ogg')) * 10 ** (-8 / 20)
    sq = norm(load(RAW + 'df_surface_mud_0.ogg', af='lowpass=f=3500')) * 10 ** (-9 / 20)
    finalize('flatten', mix((sq, 0.0), (th, 0.004), (body, 0.004)), fade_ms=60)

# ---- sit: small soft settle (Kenney soft impact + cloth)
if want('sit'):
    th = norm(load(KI + 'impactSoft_medium_003.ogg')) * 10 ** (-3 / 20)
    cl = norm(load(KR + 'cloth3.ogg')) * 10 ** (-4 / 20)
    finalize('sit', mix((th, 0.0), (cl, 0.0)), fade_ms=60)

# ---- dice (Kenney Casino Audio, CC0)
if want('dice'):
    finalize('dice-shake', load(KC + 'dice-shake-1.ogg', ss=0.16), maxlen=0.85, fade_ms=90)
    finalize('dice-hit-1', load(KC + 'dice-throw-1.ogg'), fade_ms=40)
    finalize('dice-hit-2', load(KC + 'dice-throw-2.ogg'), fade_ms=40)
    finalize('dice-hit-3', load(KC + 'dice-throw-3.ogg'), fade_ms=40)

# ---- house pops (Pixabay: DRAGON-STUDIO "Pop", mikeaveloo "Soft Pop")
if want('pop'):
    finalize('pop-1', load(PX + 'pop_dragon_402324.mp3'), fade_ms=30)
    finalize('pop-2', load(PX + 'softpop_mikeaveloo_538611.mp3'), fade_ms=30)

# ---- reward chime (Pixabay: Universfield "Clear Bell Chime")
if want('ding'):
    finalize('ding', load(PX + 'chime_universfield_487898.mp3'), fade_ms=120, tailgate=-45)

# ---- police siren (TitanKaempfer "Police Siren", CC0, via victorrentea/victor-effects starter-pack/02_siren.mp3)
if want('siren'):
    s = fade(load(RAW + 'victor_siren.mp3', ss=0.5, t=2.8), 3, 0)
    finalize('siren', s, fade_ms=450, trim=False)

# ---- tyre skid (martian "car park skiding corner", CC0, excerpt via godspeed)
if want('skid'):
    finalize('skid', load(RAW + 'godspeed_skid.wav'), maxlen=0.62, fade_ms=120)

# ---- grab/scuffle (Kenney RPG Audio cloth/leather handling, CC0)
if want('grab'):
    a = norm(load(KR + 'cloth2.ogg'))
    b = norm(load(KR + 'handleSmallLeather.ogg')) * 10 ** (-2 / 20)
    c = norm(load(KR + 'cloth4.ogg')) * 10 ** (-3 / 20)
    p = norm(load(KI + 'impactPunch_medium_002.ogg')) * 10 ** (-12 / 20)
    a = a[int(0.05 * SR):]
    finalize('grab', mix((a, 0.0), (p, 0.01), (b, 0.07), (c, 0.16)), maxlen=0.55, fade_ms=80)

# ---- jail door (kd_jack "Cell Door 2", CC0, excerpt via OpenSC2k) + Kenney heavy metal impact for weight
if want('jail'):
    door = norm(load(RAW + 'osc_prison_door.wav', ss=0.58))
    clank = norm(load(KI + 'impactMetal_heavy_001.ogg')) * 10 ** (-9 / 20)
    on = int(np.argmax(np.abs(door).max(1) > 0.05))
    finalize('jail-door', mix((door, 0.0), (clank, on / SR)), gate=-24, fadein_ms=1.5, fade_ms=200)

# ---- cards (Kenney Casino Audio, CC0)
if want('cards'):
    finalize('card-slap-1', load(KC + 'card-place-1.ogg'), gate=-22, fadein_ms=1.5, fade_ms=30)
    finalize('card-slap-2', load(KC + 'card-place-3.ogg', ss=0.40), gate=-22, fadein_ms=1.5, fade_ms=30)
    finalize('card-slap-3', load(KC + 'card-place-4.ogg', ss=0.25), gate=-22, fadein_ms=1.5, fade_ms=30)
    finalize('card-flick', load(KC + 'card-shove-3.ogg'), gate=-24, fadein_ms=2, maxlen=0.32, fade_ms=60)
    finalize('card-shuffle', load(KC + 'card-fan-1.ogg'), gate=-26, fadein_ms=2, fade_ms=40)

# ---- fire: low "whoomp" ignition (moogy73 woosh_medium_01, CC0) + crackle (DRAGON-STUDIO "Fire Crackling Sounds", Pixabay)
if want('fire'):
    wh = norm(load(RAW + 'df_character_dash_0.ogg', t=0.9))
    wh = fade(wh, 0, 300)
    cr = norm(load(PX + 'fire_dragon_427410.mp3', ss=12.6, t=1.75)) * 10 ** (-3 / 20)
    cr = fade(cr, 140, 450)
    finalize('fire', mix((wh, 0.0), (cr, 0.06)), fade_ms=300, trim=True, tailgate=-60)

# ---- chips (Kenney Casino Audio, CC0)
if want('chips'):
    finalize('chips-1', load(KC + 'chips-handle-5.ogg'), fade_ms=60)
    finalize('chips-2', load(KC + 'chips-handle-4.ogg'), gate=-22, fadein_ms=1.5, fade_ms=60)

# ---- whooshes
if want('whoosh'):
    finalize('whoosh-1', load(PX + 'whoosh_clean_dragon_382726.mp3'), fade_ms=40)                 # DRAGON-STUDIO, Pixabay
    finalize('whoosh-2', load(RAW + 'df_character_dash_2.ogg'), fade_ms=60)                        # moogy73 woosh_medium_short_01, CC0
    finalize('whoosh-3', load(RAW + 'wa_DoubleWhoosh.ogg', ss=0.48), maxlen=0.4, fade_ms=60)       # qubodup Double Whoosh 2 (2nd pass), CC0

# ---- title impact (Pixabay: Universfield "Cinematic Impact Boom 05")
if want('impact'):
    finalize('impact', load(PX + 'impact_boom05_352465.mp3'), fade_ms=250, tailgate=-55)

# ---- riser into a hit (Pixabay: koiroylers "Small Riser"), cut at its peak so it lands on the hit
if want('riser'):
    r = load(PX + 'riser_small_koiroylers_351977.mp3', t=1.02)
    finalize('riser', r, fade_ms=12, trim=True, gate=-45)

# ---- soft UI tick (Kenney Interface Sounds, CC0)
if want('tick'):
    finalize('ui-tick', load(KF + 'tick_002.ogg'), fade_ms=5)

# ---- cheer (jbeetle "3 Men Cheering", CC0, via AngelOS dotfiles)
if want('cheer'):
    finalize('cheer', load(RAW + 'angel_cheer.ogg'), gate=-26, fadein_ms=3, fade_ms=200)

# ---- room tone (callmethefoo "Soft Room Tone", CC0, 30 s loop via masame) -> 11 s, gentle fades
if want('room'):
    rt = fade(load(RAW + 'masame_room.mp3', ss=2.0, t=11.0), 400, 0)
    finalize('room-tone', rt, fade_ms=600, trim=False)
