// The trailer on the home page (tools/trailer makes the files in /video/):
// HeroLoop is a silent loop of the best 3D moments behind the hero, over the
// board still that is already there (so nothing changes until the video can
// play, and visitors who ask for less motion or less data keep the still).
// TrailerSection is the full trailer under the game cards: it plays muted
// while it is on screen, with buttons for sound and full screen.

import { useEffect, useRef, useState } from 'react';

// Off until the final renders are in client/public/video (then both parts show).
export const TRAILER_READY = true;

// Each video comes as H.264 MP4 (Safari, most phones), at 1080p or 720p, and as a 720p VP9 WebM for
// Chromium builds without H.264.
const MP4 = 'video/mp4; codecs="avc1.640028"';
const WEBM = 'video/webm; codecs="vp9"';

const small = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;
const calm = () =>
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ||
  !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

export function HeroLoop() {
  const [base] = useState(() => (calm() ? null : small() ? '/video/hero-loop-720' : '/video/hero-loop-1080'));
  const [on, setOn] = useState(false);
  if (!base || !TRAILER_READY) return null;
  return (
    <video className={`home-loop${on ? ' on' : ''}`} autoPlay muted loop playsInline preload="auto"
      aria-hidden tabIndex={-1} onPlaying={() => setOn(true)}>
      <source src={`${base}.mp4`} type={MP4} />
      <source src={`${base.replace('1080', '720')}.webm`} type={WEBM} />
    </video>
  );
}

export function TrailerSection() {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [base] = useState(() => (small() ? '/video/trailer-720' : '/video/trailer-1080'));

  // Play while at least half of it is on screen, pause when it leaves.
  useEffect(() => {
    const el = box.current;
    const v = video.current;
    if (!el || !v || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.ended) v.currentTime = 0;
    setMuted(v.muted);
    v.play().catch(() => {});
  };
  if (!TRAILER_READY) return null;
  const fullscreen = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.();
    v.muted = false;
    setMuted(false);
    v.play().catch(() => {});
  };

  return (
    <section className="trailer" aria-labelledby="trailer-title">
      <h2 id="trailer-title" className="sr-only">Trailer</h2>
      <div className="trailer-frame" ref={box}>
        <video ref={video} poster="/video/trailer-poster.jpg" muted loop playsInline preload="none"
          aria-label="Chog Games trailer" onVolumeChange={e => setMuted(e.currentTarget.muted)}>
          <source src={`${base}.mp4`} type={MP4} />
          <source src={`${base.replace('1080', '720')}.webm`} type={WEBM} />
        </video>
        <div className="trailer-controls">
          <button type="button" className="trailer-btn" onClick={toggleSound} aria-pressed={!muted}
            aria-label={muted ? 'Turn the sound on' : 'Mute'}>{muted ? '🔇 Sound on' : '🔊 Mute'}</button>
          <button type="button" className="trailer-btn" onClick={fullscreen} aria-label="Watch full screen">⛶</button>
        </div>
      </div>
    </section>
  );
}
