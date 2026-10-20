// The home page's live strip under the hero: what just happened across the
// site, one line at a time ("Pete won on Metropolis", "Table 9CL9K just
// started"). It reads GET /api/activity (server/src/activity.ts, cached there
// for ten seconds) every 30 s while the tab is in view, never while it is
// hidden. Until the first answer the strip holds its place invisibly, so the
// page does not jump when it fills; with nothing recent it goes away.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityFeed, ActivityItem } from '../../../shared/activity.ts';
import '../styles/home-alive.css';

const POLL_MS = 30_000;
const STEP_MS = 5_000;
const SHOW = 12;

const ICONS: Record<ActivityItem['kind'], string> = {
  win: '🏆', started: '🎲', open: '🪑', champion: '🥇', tournament: '🏟️', joined: '👋',
};
const iconOf = (i: ActivityItem) => (i.kind === 'started' && i.game === 'cards' ? '🃏' : ICONS[i.kind]);

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function ActivityTicker() {
  /** null until the first answer (the strip keeps its place, unseen). */
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [skew, setSkew] = useState(0);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const lastFetch = useRef(0);
  const shown = useRef<ActivityItem[] | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      lastFetch.current = Date.now();
      try {
        const res = await fetch(`/api/activity?limit=${SHOW}`);
        if (!res.ok) throw new Error(String(res.status));
        const feed = await res.json() as ActivityFeed;
        if (stop) return;
        setSkew(feed.now - Date.now());
        const next = Array.isArray(feed.items) ? feed.items : [];
        const prev = shown.current;
        // Same list: keep the place in it. New news: start from the newest.
        if (prev && prev.length === next.length && prev.every((p, k) => p.id === next[k].id)) return;
        shown.current = next;
        setItems(next);
        setI(0);
      } catch {
        // Unreachable server: an unseen placeholder goes; a list already up stays.
        if (!stop && !shown.current) { shown.current = []; setItems([]); }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(() => { void load().then(schedule); }, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); return; }
      if (Date.now() - lastFetch.current >= POLL_MS) void load().then(schedule);
      else schedule();
    };
    void load().then(schedule);
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // One line at a time; held while a pointer or the keyboard is on it.
  const count = items?.length ?? 0;
  useEffect(() => {
    if (count < 2 || paused) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'hidden') setI(x => (x + 1) % count);
    }, STEP_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  if (items && !items.length) return null;
  const item = items?.[i % Math.max(1, count)];
  const body = item && (
    <>
      <span className="ticker-icon" aria-hidden>{iconOf(item)}</span>
      <span className="ticker-text">{item.text}</span>
      <span className="ticker-ago">{ago(Date.now() + skew - item.at)}</span>
    </>
  );

  return (
    <section className={`ticker${items ? '' : ' ticker-wait'}`} aria-label="Happening now"
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="ticker-live"><i aria-hidden /> Live</span>
      <div className="ticker-track">
        {item && (item.href
          ? <Link key={item.id} className="ticker-item" to={item.href}>{body}</Link>
          : <span key={item.id} className="ticker-item">{body}</span>)}
      </div>
      {count > 1 && (
        <button type="button" className="ticker-next" aria-label="Next" title="Next"
          onClick={() => setI(x => (x + 1) % count)}>›</button>
      )}
    </section>
  );
}
