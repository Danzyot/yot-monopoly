// Achievements on the client: the badge grid on a profile, the "Achievement
// unlocked!" toast when a game you played ends, and the profile's Share
// button (its link previews as the player's card, /api/players/:id/card.png).
// The server works the badges out (server/src/achievements.ts); this only shows them.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { toast, toastAchievement } from './toast.tsx';
import type { Achievement, AchievementsReply } from '../../shared/achievements.ts';
import { BRAND } from '../../shared/brand.ts';
import './styles/achievements.css';

const fetchAchievements = (id: string) => api<AchievementsReply>(`/api/players/${encodeURIComponent(id)}/achievements`);

function when(t: number): string {
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The tooltip: how to earn it, then when it was earned or how far along it is. */
function tipFor(a: Achievement): string {
  const state = a.earned
    ? `Earned ${a.earnedAt ? when(a.earnedAt) : ''}`.trim()
    : a.progress ? `${a.progress.have} / ${a.progress.need}` : 'Locked';
  return `${a.name}: ${a.blurb}. ${state}`;
}

function Badge({ a }: { a: Achievement }) {
  const pct = a.progress ? Math.round((a.progress.have / a.progress.need) * 100) : 0;
  return (
    <li className={`ach-badge tier-${a.tier} ${a.earned ? 'earned' : 'locked'}`} title={tipFor(a)} tabIndex={0}>
      <span className="ach-face" aria-hidden>{a.emoji}</span>
      <span className="ach-name">{a.name}</span>
      {!a.earned && a.progress && a.progress.have > 0 && (
        <span className="ach-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
      )}
      <span className="sr-only">{a.earned ? ' (earned)' : ' (locked)'}: {a.blurb}</span>
    </li>
  );
}

const LOCKED_PREVIEW = 6;

/** A profile's badges: earned ones first, newest first, then the locked ones nearest to done. */
export function BadgeGrid({ id }: { id: string }) {
  const [list, setList] = useState<Achievement[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    setList(null);
    fetchAchievements(id).then(r => { if (live) setList(r.achievements); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [id]);
  if (!list?.length) return null;
  const earned = list.filter(a => a.earned).length;
  // Every earned badge, and the locked ones nearest to done, until asked for the rest.
  const shown = all ? list : list.slice(0, earned + LOCKED_PREVIEW);
  return (
    <section className="panel ach-panel" aria-labelledby="pf-badges">
      <h2 id="pf-badges" className="lb-h2">Badges <span className="lb-count">{earned} / {list.length}</span></h2>
      <ul className="ach-grid">
        {shown.map(a => <Badge key={a.id} a={a} />)}
      </ul>
      {shown.length < list.length && (
        <button type="button" className="btn small ghost ach-more" onClick={() => setAll(true)}>
          Show all {list.length} badges
        </button>
      )}
    </section>
  );
}

/** Copy the profile link, or post it on X: its preview is the player's card. */
export function ShareProfile({ id, name, mine }: { id: string; name: string; mine: boolean }) {
  const url = `${location.origin}/u/${encodeURIComponent(id)}`;
  const text = mine ? `My ${BRAND.name} card 💜` : `${name} on ${BRAND.name} 💜`;
  const intent = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const copy = () => {
    const done = () => toast('Profile link copied!');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => toast(url));
    else toast(url);
  };
  return (
    <div className="pf-share" role="group" aria-label="Share this profile">
      <button type="button" className="btn small" onClick={copy}><span aria-hidden>🔗</span> Share</button>
      <a className="btn small ghost" href={intent} target="_blank" rel="noopener noreferrer"><span aria-hidden>𝕏</span> Post on X</a>
      <a className="btn small ghost" href={`/api/players/${encodeURIComponent(id)}/card.png`} target="_blank" rel="noopener" title="The picture a shared link shows">Card</a>
    </div>
  );
}

/** Badges already toasted on this device, so one never shows twice. */
const SEEN_KEY = 'yot:achievements-seen';
/** How recent a badge must be to count as "this game earned it". */
const FRESH_MS = 10 * 60_000;

function seenSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500))); } catch { /* private mode */ }
}

/**
 * When a game `me` played in ends (`over` turns true), ask for their badges and
 * toast the ones earned in the last few minutes that this device has not shown.
 */
export function useAchievementToasts(over: boolean, me: string | null | undefined) {
  const done = useRef(false);
  useEffect(() => {
    if (!over || !me || done.current) return;
    // A beat for the server to file the result (and for the end screen to land first).
    const t = setTimeout(() => {
      done.current = true;
      fetchAchievements(me).then(r => {
        const seen = seenSet();
        const fresh = r.achievements.filter(a => a.earned && a.earnedAt && r.now - a.earnedAt < FRESH_MS && !seen.has(`${me}:${a.id}`));
        fresh.slice(0, 3).forEach((a, i) => setTimeout(() => toastAchievement({ key: a.id, emoji: a.emoji, name: a.name, blurb: a.blurb }), i * 900));
        for (const a of fresh) seen.add(`${me}:${a.id}`);
        if (fresh.length) saveSeen(seen);
      }).catch(() => { /* badges are a bonus: no error for the player */ });
    }, 1500);
    return () => clearTimeout(t);
  }, [over, me]);
  // A new game in the same room (a rematch) may toast again.
  useEffect(() => { if (!over) done.current = false; }, [over]);
}
