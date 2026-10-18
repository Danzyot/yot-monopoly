// Keyboard shortcuts for the game screen (listed in the How to play dialog). Each key does what the matching action-bar button would, only when
// that button would be there, so a stray key press never sends a move the
// server would refuse. Keys are ignored while typing (chat, bids, trades).
import { useEffect, useRef } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import type { Action, GameView } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';

export const SHORTCUTS: [string, string][] = [
  ['Space / R', 'Roll the dice'],
  ['B', 'Buy the property'],
  ['A', 'Auction it (or pass)'],
  ['E', 'End your turn'],
  ['P', 'Pay your debt'],
  ['C', 'Change camera view'],
  ['H', 'Build & manage your deeds'],
  ['T', 'Make a trade'],
  ['Q', 'Quick chat'],
  ['Esc', 'Close dialogs'],
  ['?', 'How to play & this list'],
];

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The move a key stands for right now, or null when it would not apply. */
export function actionForKey(key: string, game: GameView, me: string): Action | null {
  const p = game.players.find(x => x.id === me);
  if (!p || p.bankrupt || game.phase === 'over') return null;
  const owe = game.debts.filter(d => d.from === me).reduce((a, d) => a + d.amount, 0);
  const mine = game.current === me;
  switch (key) {
    case ' ': case 'r':
      return mine && game.phase === 'roll' && owe === 0 ? { type: 'roll' } : null;
    case 'b': {
      // Only when the Buy button is live: money already owed is not there to spend.
      const price = resolveTheme(game.themeId, game.mapId).spaces[p.position]?.price ?? 0;
      return mine && game.phase === 'buy' && p.cash - owe >= price ? { type: 'buy' } : null;
    }
    case 'a':
      return mine && game.phase === 'buy' ? { type: 'decline' } : null;
    case 'e':
      return mine && game.phase === 'done' && owe === 0 ? { type: 'endTurn' } : null;
    case 'p':
      return owe > 0 && p.cash >= owe ? { type: 'payDebt' } : null;
    default:
      return null;
  }
}

export function useShortcuts(game: GameView, me: string, h: {
  /** A dialog is open: only Esc applies. */
  dialogOpen: boolean;
  onEscape: () => void;
  onTrade: () => void;
  onHelp: () => void;
  /** Next camera view. */
  onCamera?: () => void;
  onBuild: () => void;
}): void {
  // Handlers read the latest props without re-binding the listener every state.
  const ref = useRef({ game, me, h });
  ref.current = { game, me, h };
  const busy = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const { game, me, h } = ref.current;
      if (e.key === 'Escape') { h.onEscape(); return; }
      if (typing(e.target)) return;
      // Any dialog, the game's own or one it doesn't track (askConfirm, a ban), holds the keys.
      if (h.dialogOpen || (e.target as Element | null)?.closest?.('[aria-modal="true"]')) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === '?') { e.preventDefault(); h.onHelp(); return; }
      if (key === 't') { e.preventDefault(); h.onTrade(); return; }
      if (key === 'c' && h.onCamera) { e.preventDefault(); h.onCamera(); return; }
      if (key === 'h') { e.preventDefault(); h.onBuild(); return; }
      // Space on a focused button already clicks it: don't double up.
      if (key === ' ' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      const a = actionForKey(key, game, me);
      if (!a) return;
      e.preventDefault();
      if (busy.current) return;
      busy.current = true;
      act(a).catch(toastError).finally(() => { busy.current = false; });
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
}
