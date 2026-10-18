import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.tsx';
import {
  attachPlayer, loadLibrary, musicState, nextTrack, onMusicChange, setMuted, setMusicAllowed,
  setPlaylist, setVolume, togglePlay, type MusicState,
} from '../music.ts';
import { onSfxChange, primeAudio, setSfxMuted, setSfxVolume, sfxState, type SfxState } from '../sound.ts';
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
export default function MusicPlayer() {
  const { config } = useAuth();
  const musicOn = config.features.music;
  const [m, setM] = useState<MusicState>(musicState);
  const [fx, setFx] = useState<SfxState>(sfxState);
  const [amb, setAmb] = useState(ambienceEnabled);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

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

  const fxOff = fx.muted || fx.volume === 0;
  const musicSilent = m.muted || m.volume === 0;

  return (
    <div className="audio-ctl" ref={wrap}>
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
      </button>

      {musicOn && (
        <>
          <button
            className={`audio-btn${m.playing ? ' on' : ''}`}
            title={m.playing ? `Pause music — ${m.trackName}` : 'Play music'}
            aria-label={m.playing ? 'Pause music' : 'Play music'}
            onClick={() => { primeAudio(); togglePlay(); }}
          >
            {m.playing && !musicSilent
              ? <span className="music-bars" aria-hidden><i /><i /><i /></span>
              : <Icon d={m.playing ? P.pause : P.note} />}
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

      {open && musicOn && (
        <div className="audio-panel" role="dialog" aria-label="Music">
          <div className="audio-now">
            <span className="muted small">{m.playing ? 'Now playing' : 'Paused'}</span>
            <b className="audio-track">{m.trackName}</b>
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
                <option key={p.id} value={p.id}>{p.name} ({p.tracks.length})</option>
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
            <span className="small">Ambience<span className="muted"> — room sounds with the music</span></span>
          </label>
        </div>
      )}
    </div>
  );
}
