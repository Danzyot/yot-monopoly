import { useEffect, useState } from 'react';
import { Face } from './components/CharacterFace.tsx';

type Toast = { id: number; text: string; kind: 'error' | 'info' };
let seq = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++seq, text, kind };
  listeners.forEach(f => f(t));
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

// ---- social chips: a reaction or poke from someone else, in the corner ----

export interface SocialToast {
  /** Dedupes repeats (a server seq), so one event never shows twice. */
  key: string;
  /** Emoji or avatar URL. */
  avatar: string;
  name: string;
  emoji: string;
  /** Short verb after the name ("poked you"); absent for a plain reaction. */
  text?: string;
}
const socialListeners = new Set<(t: SocialToast) => void>();
export const SOCIAL_TOAST_MS = 3_200;
/** At most this many chips at once; older ones drop off so a burst stays readable. */
export const SOCIAL_TOAST_MAX = 3;

export function toastSocial(t: SocialToast) {
  socialListeners.forEach(f => f(t));
}

function SocialChips() {
  const [items, setItems] = useState<SocialToast[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const add = (t: SocialToast) => {
      setItems(i => (i.some(x => x.key === t.key) ? i : [...i.slice(-(SOCIAL_TOAST_MAX - 1)), t]));
      const h = setTimeout(() => { timers.delete(h); setItems(i => i.filter(x => x.key !== t.key)); }, SOCIAL_TOAST_MS);
      timers.add(h);
    };
    socialListeners.add(add);
    return () => { socialListeners.delete(add); timers.forEach(clearTimeout); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="social-toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.key} className={`social-toast ${t.text ? 'poke' : ''}`}>
          {/^https:\/\//.test(t.avatar)
            ? <img className="social-toast-avatar" src={t.avatar} alt="" referrerPolicy="no-referrer" />
            : <span className="social-toast-avatar emoji">{t.avatar}</span>}
          <span className="social-toast-name">{t.name}</span>
          {t.text && <span className="social-toast-text">{t.text}</span>}
          <span className="social-toast-emoji">{t.emoji}</span>
        </div>
      ))}
    </div>
  );
}

// ---- "Achievement unlocked!": a badge a game just earned (achievements.tsx) ----

export interface AchievementToast {
  /** The badge id: the same badge never shows twice at once. */
  key: string;
  emoji: string;
  /** A picture in place of the emoji (AchievementDef.image). */
  image?: string;
  name: string;
  blurb: string;
}
const achievementListeners = new Set<(t: AchievementToast) => void>();
export const ACHIEVEMENT_TOAST_MS = 5_000;

export function toastAchievement(t: AchievementToast) {
  achievementListeners.forEach(f => f(t));
}

function AchievementToasts() {
  const [items, setItems] = useState<AchievementToast[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const add = (t: AchievementToast) => {
      setItems(i => (i.some(x => x.key === t.key) ? i : [...i.slice(-2), t]));
      const h = setTimeout(() => { timers.delete(h); setItems(i => i.filter(x => x.key !== t.key)); }, ACHIEVEMENT_TOAST_MS);
      timers.add(h);
    };
    achievementListeners.add(add);
    return () => { achievementListeners.delete(add); timers.forEach(clearTimeout); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="ach-toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.key} className="ach-toast" role="status">
          <span className="ach-toast-face" aria-hidden><Face emoji={t.emoji} image={t.image} /></span>
          <span className="ach-toast-text">
            <small>Achievement unlocked!</small>
            <b>{t.name}</b>
            <span>{t.blurb}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems(i => [...i.slice(-3), t]);
      setTimeout(() => setItems(i => i.filter(x => x.id !== t.id)), 3500);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);
  return (
    <>
      <div className="toasts">
        {items.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
      <SocialChips />
      <AchievementToasts />
    </>
  );
}
