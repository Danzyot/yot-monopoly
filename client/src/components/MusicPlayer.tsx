import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.tsx';
import {
  AUTO_ID, attachPlayer, loadLibrary, musicState, nextTrack, onMusicChange, setMuted, setMusicAllowed,
  setPlaylist, setVolume, togglePlay, type MusicState,
} from '../music.ts';
import { onSfxChange, primeAudio, readPref, setSfxMuted, setSfxVolume, sfxState, writePref, type SfxState } from '../sound.ts';
import { ambienceEnabled, onAmbienceChange, setAmbienceEnabled } from '../ambience.ts';

const Icon = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const P = {
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  pause: 'M9 4.5v15M15 4.5v15',
  next: 'M6 5v14l10-7L6 5ZM18 5v14',
  more: 'M6 9l6 6 6-6',
  note: 'M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  speaker: 'M11 5 6.5 8.5H3v7h3.5L11 19V5Zm4.5 3.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12',
  speakerOff: 'M11 5 6.5 8.5H3v7h3.5L11 19V5Zm5 4 5 6m0-6-5 6',
  bell: 'M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2ZM10 21h4',
  bellOff: 'M18 16v-5a6 6 0 0 0-9.5-4.9M6 11v5l-2 2h14M10 21h4M3 3l18 18',
};

// Compact audio controls for the lobby and the in-game top bar: a sound
// effects toggle, and — when the site has music switched on — play/pause,
// next, and a small panel for the playlist and volumes.
/** Set the first time the "Turn on music?" bubble is shown, so it only ever asks once. */
const ASKED_KEY = 'yot:music.asked';
const ASK_DELAY_MS = 2500;
const ASK_SHOWN_MS = 14000;

export default function MusicPlayer({ askOnce = false }: {
  /** Offer "Turn on music?" once per browser (the game screen asks; the lobby does not). */
  askOnce?: boolean;
}) {
  const { config } = useAuth();
  const musicOn = config.features.music;
  const [m, setM] = useState<MusicState>(musicState);
  const [fx, setFx] = useState<SfxState>(sfxState);
  const [amb, setAmb] = useState(ambienceEnabled);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => onSfxChange(setFx), []);
  useEffect(() => onAmbienceChange(setAmb), []);
  useEffect(() => {
    setMusicAllowed(musicOn);
    if (!musicOn) return;
    void loadLibrary();
    const off = onMusicChange(setM);
    const release = attachPlayer();
    setM(musicState());
    return () => { off(); release(); };
  }, [musicOn]);

  // Click-away closes the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // The one-time gentle ask. Music stays off until they say yes: the click on
  // "Turn on" is the gesture browsers need, and nothing plays before it.
  useEffect(() => {
    if (!askOnce || !musicOn || readPref(ASKED_KEY) === '1' || readPref('yot:music.on') === '1') return;
    const show = window.setTimeout(() => {
      if (musicState().playing) return;
      writePref(ASKED_KEY, '1');
      setAsking(true);
    }, ASK_DELAY_MS);
    return () => clearTimeout(show);
  }, [askOnce, musicOn]);
  useEffect(() => {
    if (!asking) return;
    const hide = window.setTimeout(() => setAsking(false), ASK_SHOWN_MS);
    return () => clearTimeout(hide);
  }, [asking]);
  useEffect(() => { if (m.playing) setAsking(false); }, [m.playing]);

  const fxOff = fx.muted || fx.volume === 0;
  const musicSilent = m.muted || m.volume === 0;

  return (
    // Escape closes the settings panel and hands focus back to its button.
    <div className="audio-ctl" ref={wrap} onKeyDown={e => {
      if (e.key !== 'Escape' || !open) return;
      e.stopPropagation();
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>('[aria-label="Music settings"]')?.focus();
    }}>
      <button
        className={`audio-btn${fxOff ? ' off' : ''}`}
        title={fxOff ? 'Sound effects off' : 'Sound effects on'}
        aria-label={fxOff ? 'Turn sound effects on' : 'Turn sound effects off'}
        aria-pressed={!fxOff}
        onClick={() => {
          primeAudio();
          if (fxOff && fx.volume === 0) setSfxVolume(0.7);
          setSfxMuted(!fxOff);
        }}
      >
        <Icon d={fxOff ? P.bellOff : P.bell} />
        <span className="audio-label">Sounds</span>
      </button>

      {musicOn && (
        <>
          <button
            className={`audio-btn music-toggle${m.playing ? ' on' : ''}`}
            title={m.playing ? `Music is on — click to turn off (${m.trackName})` : 'Music is off — click to turn on'}
            aria-label={m.playing ? 'Turn music off' : 'Turn music on'}
            aria-pressed={m.playing}
            onClick={() => { primeAudio(); setAsking(false); togglePlay(); }}
          >
            {m.playing && !musicSilent
              ? <span className="music-bars" aria-hidden><i /><i /><i /></span>
              : <Icon d={P.note} />}
            <span className="audio-label">{m.playing ? 'Music on' : 'Music off'}</span>
          </button>
          <button className="audio-btn hide-sm" title="Next track" aria-label="Next track"
            onClick={() => { primeAudio(); nextTrack(); }}>
            <Icon d={P.next} />
          </button>
          <button className={`audio-btn${open ? ' on' : ''}`} title="Music settings" aria-label="Music settings"
            aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <Icon d={P.more} size={13} />
          </button>
        </>
      )}

      {asking && musicOn && (
        <div className="music-ask" role="dialog" aria-label="Turn on music?">
          <b>🎵 Turn on music?</b>
          <span className="muted small">Gentle background tunes. You can change it any time.</span>
          <div className="music-ask-actions">
            <button className="btn small primary" onClick={() => { primeAudio(); setAsking(false); if (!musicState().playing) togglePlay(); }}>Turn on</button>
            <button className="btn small ghost" onClick={() => setAsking(false)}>No thanks</button>
          </div>
        </div>
      )}

      {open && musicOn && (
        <div className="audio-panel" role="dialog" aria-label="Music">
          <div className="audio-now">
            <span className="muted small">{m.playing ? 'Now playing' : 'Paused'}</span>
            <b className="audio-track">{m.trackName}{m.playlistId === AUTO_ID && m.scene ? <span className="muted"> · auto</span> : null}</b>
          </div>
          <div className="audio-transport">
            <button className="btn small" onClick={() => { primeAudio(); togglePlay(); }}>
              <Icon d={m.playing ? P.pause : P.play} size={13} />{m.playing ? 'Pause' : 'Play'}
            </button>
            <button className="btn small" onClick={() => { primeAudio(); nextTrack(); }}>
              <Icon d={P.next} size={13} />Next
            </button>
          </div>
          <label className="audio-field">
            <span className="muted small">Playlist</span>
            <select value={m.playlistId} onChange={e => { primeAudio(); setPlaylist(e.target.value); }}>
              {m.playlists.map(p => (
                <option key={p.id} value={p.id}>{p.id === AUTO_ID || p.tracks.length === 1 ? p.name : `${p.name} (${p.tracks.length})`}</option>
              ))}
            </select>
          </label>
          <div className="audio-field">
            <span className="muted small">Music volume</span>
            <div className="audio-vol">
              <button className="audio-btn" title={musicSilent ? 'Unmute music' : 'Mute music'}
                aria-label={musicSilent ? 'Unmute music' : 'Mute music'}
                onClick={() => { if (m.volume === 0) setVolume(0.5); else setMuted(!m.muted); }}>
                <Icon d={musicSilent ? P.speakerOff : P.speaker} />
              </button>
              <input type="range" min={0} max={100} aria-label="Music volume"
                value={Math.round((m.muted ? 0 : m.volume) * 100)}
                onChange={e => setVolume(Number(e.target.value) / 100)} />
            </div>
          </div>
          <div className="audio-field">
            <span className="muted small">Sound effects</span>
            <div className="audio-vol">
              <button className="audio-btn" title={fxOff ? 'Unmute effects' : 'Mute effects'}
                aria-label={fxOff ? 'Unmute effects' : 'Mute effects'}
                onClick={() => { primeAudio(); if (fx.volume === 0) setSfxVolume(0.7); setSfxMuted(!fxOff); }}>
                <Icon d={fxOff ? P.bellOff : P.bell} />
              </button>
              <input type="range" min={0} max={100} aria-label="Sound effects volume"
                value={Math.round((fx.muted ? 0 : fx.volume) * 100)}
                onChange={e => { primeAudio(); setSfxVolume(Number(e.target.value) / 100); if (fx.muted) setSfxMuted(false); }} />
            </div>
          </div>
          <label className="audio-field audio-check" title="A quiet room tone for the scene, under the music">
            <input type="checkbox" checked={amb} onChange={e => { primeAudio(); setAmbienceEnabled(e.target.checked); }} />
            <span className="small">Ambience<span className="muted"> — room sounds (follows the effects volume)</span></span>
          </label>
        </div>
      )}
    </div>
  );
}
