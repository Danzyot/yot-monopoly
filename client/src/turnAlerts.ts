// Turn alerts for a player who has tabbed away: when the game starts waiting
// on them (their turn, an auction they are in, a mini-game, a debt, a trade
// offer) the tab title flashes until they come back and — if they opted in
// with the bell — the browser shows a notification. Permission is asked only
// when the bell is clicked, never on page load.
import { useEffect, useRef, useState } from 'react';
import { resolveTheme } from '../../shared/themes.ts';
import type { GameView } from '../../shared/types.ts';
import { readPref, writePref } from './sound.ts';
import { toast } from './toast.tsx';

const PREF = 'yot:notify';

/** What (if anything) the game is waiting on this player for. The key changes when it is a new ask. */
export function attentionFor(game: GameView, me: string): { key: string; text: string } | null {
  const p = game.players.find(x => x.id === me);
  if (!p || p.bankrupt || game.phase === 'over') return null;
  const theme = resolveTheme(game.themeId, game.mapId);
  const turn = `${game.turnNumber}`;
  const owe = game.debts.filter(d => d.from === me).reduce((a, d) => a + d.amount, 0);
  if (owe > 0) return { key: `debt:${turn}:${owe}`, text: `You owe ${theme.currency}${owe}` };
  const a = game.auction;
  if (a && a.bidders.includes(me) && a.highBidder !== me) {
    return { key: `auction:${turn}:${a.space}`, text: `Auction: ${theme.spaces[a.space].name}` };
  }
  const mg = game.minigame;
  if (mg && mg.stage === 'play' && mg.players.includes(me)) return { key: `minigame:${mg.seq}`, text: 'Mini-game — your move' };
  if (game.current === me && (game.phase === 'roll' || game.phase === 'buy')) {
    return { key: `turn:${turn}:${game.phase}`, text: game.phase === 'buy' ? `Buy ${theme.spaces[p.position].name}?` : 'Your turn' };
  }
  const offer = game.trades.filter(t => t.to === me).at(-1);
  if (offer) {
    const from = game.players.find(x => x.id === offer.from);
    return { key: `trade:${offer.id}`, text: `Trade offer from ${from?.name ?? 'someone'}` };
  }
  return null;
}

const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

export function useNotifyPref(): [boolean, () => void] {
  const [on, setOn] = useState(() => readPref(PREF) === '1' && canNotify() && Notification.permission === 'granted');
  const toggle = () => {
    if (on) {
      setOn(false);
      writePref(PREF, '0');
      return;
    }
    if (!canNotify()) {
      toast('This browser cannot show notifications', 'error');
      return;
    }
    // Asked here, on the click, because browsers only allow it from a gesture.
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        setOn(true);
        writePref(PREF, '1');
        toast('We\'ll notify you when it\'s your turn and this tab is hidden');
      } else {
        toast('Notifications are blocked for this site in your browser settings', 'error');
      }
    }).catch(() => toast('Could not turn notifications on', 'error'));
  };
  return [on, toggle];
}

export function useTurnAlerts(game: GameView, me: string, notify: boolean, baseTitle: string): void {
  const need = attentionFor(game, me);
  const lastKey = useRef<string | null>(need?.key ?? null);
  const [flash, setFlash] = useState<string | null>(null);

  // A new ask while the tab is hidden starts the alert.
  useEffect(() => {
    const key = need?.key ?? null;
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (!need || !document.hidden) return;
    setFlash(need.text);
    if (notify && canNotify() && Notification.permission === 'granted') {
      try {
        const n = new Notification(`🎲 ${need.text}`, { body: baseTitle, tag: 'yot-turn' });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* some mobile browsers only notify from a service worker: the title still flashes */ }
    }
  }, [need?.key]);

  // Coming back stops it; so does the ask going away (someone else acted for us).
  useEffect(() => {
    const back = () => { if (!document.hidden) setFlash(null); };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, []);
  useEffect(() => { if (!need) setFlash(null); }, [!need]);

  useEffect(() => {
    if (!flash) return;
    let on = false;
    const tick = () => {
      on = !on;
      document.title = on ? `🎲 ${flash} — ${baseTitle}` : baseTitle;
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      clearInterval(t);
      document.title = baseTitle;
    };
  }, [flash, baseTitle]);
}
