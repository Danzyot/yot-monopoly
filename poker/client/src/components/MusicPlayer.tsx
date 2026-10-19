import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearQueue, loadCustomTracks, musicState, nextTrack, onMusicChange, playTrack,
  playTrackById, prevTrack, queueTrack, removeQueued, setRepeat, setShuffle,
  setVibe, setVolume, toggleMusic, type MusicState,
} from '../music';
import { primeAudio } from '../sound';

const Icon = ({ d, size = 15 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const P = {
  note: 'M9 18V5l10-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  pause: 'M9 4.5v15M15 4.5v15',
  prev: 'M18 19V5L8 12l10 7ZM6 5v14',
  next: 'M6 5v14l10-7L6 5ZM18 5v14',
  shuffle: 'M17 4h4v4M21 4l-7 7M3 20l7-7M17 20h4v-4M3 4l4 4',
  repeat: 'M4 10V8a3 3 0 0 1 3-3h10l-3-3m3 12v2a3 3 0 0 1-3 3H4l3 3',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-3.8-3.8',
  plus: 'M12 5v14M5 12h14',
  speaker: 'M11 5 6.5 8.5H3v7h3.5L11 19V5Zm4.5 3.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12',
};

// Music control panel: choose a vibe, search any song, queue what plays next.
export default function MusicPlayer({ atTable = false }: { atTable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [s, setS] = useState<MusicState>(() => musicState());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadCustomTracks();
    return onMusicChange(setS);
  }, []);

  // Search spans every vibe's playlist plus any tracks the operator added.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return s.vibes
      .flatMap(v => v.tracks.map(t => ({ id: t.id, name: t.name, vibeName: v.name })))
      .filter(t => t.name.toLowerCase().includes(q) || t.vibeName.toLowerCase().includes(q))
      .slice(0, 30);
  }, [query, s.vibes]);

  // Click-away closes the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const vibe = s.vibes.find(v => v.id === s.vibeId) ?? s.vibes[0];

  return (
    <div className="music-wrap" ref={panelRef}>
      <button
        className={`btn btn-ghost btn-sm music-btn${s.playing ? ' on' : ''}`}
        title={s.playing ? `Playing: ${s.trackName}` : 'Music'}
        onClick={() => { primeAudio(); setOpen(o => !o); }}
      >
        <Icon d={P.note} />
        {s.playing && <span className="music-bars"><i /><i /><i /></span>}
      </button>

      {open && (
        <div className={`music-panel${atTable ? ' at-table' : ''}`}>
          <div className="music-head">
            <span className="music-title">{query.trim() ? 'Search songs' : 'Choose vibe'}</span>
            <button className="music-x" onClick={() => setOpen(false)} aria-label="Close">
              <Icon d={P.close} size={14} />
            </button>
          </div>

          <label className="music-search">
            <Icon d={P.search} size={13} />
            <input
              type="search"
              placeholder="Search songs…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className="music-x" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon d={P.close} size={12} />
              </button>
            )}
          </label>

          {query.trim() ? (
            <div className="track-list search-results">
              {results.length === 0 && <span className="music-empty">No songs match.</span>}
              {results.map(t => (
                <div
                  key={t.id}
                  className={`track-row${t.id === s.trackId ? ' active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => { primeAudio(); playTrackById(t.id); }}
                  onKeyDown={e => { if (e.key === 'Enter') { primeAudio(); playTrackById(t.id); } }}
                >
                  <span className="track-idx">{t.id === s.trackId && s.playing ? '▶' : <Icon d={P.play} size={10} />}</span>
                  <span className="track-name">{t.name}</span>
                  <span className="track-vibe">{t.vibeName}</span>
                  <button
                    className="track-add" title="Play next"
                    onClick={e => { e.stopPropagation(); queueTrack(t.id); }}
                  >
                    <Icon d={P.plus} size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="vibe-grid">
                {s.vibes.map(v => (
                  <button
                    key={v.id}
                    className={`vibe-card${v.id === s.vibeId ? ' active' : ''}`}
                    onClick={() => { primeAudio(); setVibe(v.id); }}
                  >
                    <span className="vibe-name">{v.name}</span>
                    <span className="vibe-blurb">
                      {v.tracks.length} track{v.tracks.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>

              <div className="track-list">
                {vibe?.tracks.length === 0 && (
                  <span className="music-empty">No songs in this vibe yet.</span>
                )}
                {vibe?.tracks.map((t, i) => (
                  <div
                    key={t.id}
                    className={`track-row${i === s.trackIndex ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => { primeAudio(); playTrack(i); }}
                    onKeyDown={e => { if (e.key === 'Enter') { primeAudio(); playTrack(i); } }}
                  >
                    <span className="track-idx">{i === s.trackIndex && s.playing ? '▶' : i + 1}</span>
                    <span className="track-name">{t.name}</span>
                    <button
                      className="track-add" title="Play next"
                      onClick={e => { e.stopPropagation(); queueTrack(t.id); }}
                    >
                      <Icon d={P.plus} size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {s.queue.length > 0 && (
            <div className="music-queue">
              <div className="queue-head">
                <span className="music-title">Up next · {s.queue.length}</span>
                <button className="queue-clear" onClick={clearQueue}>Clear</button>
              </div>
              {s.queue.map((t, i) => (
                <div key={`${t.id}-${i}`} className="queue-row">
                  <span className="track-idx">{i + 1}</span>
                  <span className="track-name">{t.name}</span>
                  <span className="track-vibe">{t.vibeName}</span>
                  <button className="music-x" title="Remove from queue" onClick={() => removeQueued(i)}>
                    <Icon d={P.close} size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="now-playing">
            <span className="np-label">{s.playing ? 'Now playing' : 'Paused'}</span>
            <span className="np-track">{s.trackName}</span>
          </div>

          <div className="music-transport">
            <button className={`tp-btn${s.shuffle ? ' on' : ''}`} title="Shuffle"
              onClick={() => setShuffle(!s.shuffle)}><Icon d={P.shuffle} /></button>
            <button className="tp-btn" title="Previous track" onClick={prevTrack}><Icon d={P.prev} /></button>
            <button className="tp-btn play" title={s.playing ? 'Pause' : 'Play'}
              onClick={() => { primeAudio(); toggleMusic(); }}>
              <Icon d={s.playing ? P.pause : P.play} size={17} />
            </button>
            <button className="tp-btn" title="Next track" onClick={nextTrack}><Icon d={P.next} /></button>
            <button
              className={`tp-btn${s.repeat !== 'off' ? ' on' : ''}`}
              title={s.repeat === 'one' ? 'Repeating this track' : s.repeat === 'all' ? 'Repeating the vibe' : 'Repeat off'}
              onClick={() => setRepeat(s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off')}
            >
              <Icon d={P.repeat} />
              {s.repeat === 'one' && <span className="repeat-one">1</span>}
            </button>
          </div>

          <label className="music-vol" title="Music volume">
            <Icon d={P.speaker} size={15} />
            <input
              type="range" min={0} max={100} value={Math.round(s.volume * 100)}
              onChange={e => setVolume(Number(e.target.value) / 100)}
            />
            <span className="vol-val">{Math.round(s.volume * 100)}%</span>
          </label>
        </div>
      )}
    </div>
  );
}
