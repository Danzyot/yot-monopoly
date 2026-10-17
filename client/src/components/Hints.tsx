// First-time tips: a speech bubble over the action bar the first time a
// player can do something new (build, trade, raise cash). Each tip shows once
// per browser and goes away for good on "Got it" or when its action is used.
import { useEffect, useState } from 'react';
import { groupIndices } from '../../../shared/board.ts';
import { resolveTheme } from '../../../shared/themes.ts';
import type { GameView } from '../../../shared/types.ts';
import { canBuildAnywhere, debtOf, ownedBy } from '../gameHelpers.ts';
import { howToSeen } from './HowToPlay.tsx';

export type HintId = 'welcome' | 'build' | 'trade' | 'raise';

const KEY = 'yot:hints';
function seenSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
const listeners = new Set<() => void>();

/** Never show this tip again (its action was used, or "Got it"). */
export function markHint(id: HintId): void {
  const s = seenSet();
  if (s.has(id)) return;
  s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* private mode */ }
  listeners.forEach(f => f());
}

function useSeen(): Set<string> {
  const [s, setS] = useState(seenSet);
  useEffect(() => {
    const f = () => setS(seenSet());
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return s;
}

/**
 * Who holds the rest of a set I've started (only other players, no bank
 * deeds left): the natural trade partner. Fewest missing deeds first.
 */
export function tradePartnerFor(game: GameView, me: string): string | null {
  const theme = resolveTheme(game.themeId, game.mapId);
  const groups = new Set(ownedBy(game, me).map(i => theme.spaces[i]).filter(s => s.kind === 'property').map(s => s.group!));
  let best: { owner: string; missing: number } | null = null;
  for (const g of groups) {
    const missing = groupIndices(theme.spaces, g).filter(i => game.owned[i]?.owner !== me);
    // Every missing deed held by the same (still playing) player.
    const owners = new Set(missing.map(i => game.owned[i]?.owner ?? ''));
    if (!missing.length || owners.has('') || owners.size !== 1) continue;
    const owner = [...owners][0];
    if (game.players.find(p => p.id === owner)?.bankrupt) continue;
    if (!best || missing.length < best.missing) best = { owner, missing: missing.length };
  }
  return best?.owner ?? null;
}

export function CoachHint({ game, me, busy, onHelp, onBuild, onRaise, onTrade }: {
  game: GameView; me: string;
  /** Something else is going on (dice rolling, a dialog open): hold the tip. */
  busy: boolean;
  onHelp: () => void; onBuild: () => void; onRaise: () => void; onTrade: () => void;
}) {
  const seen = useSeen();
  const p = game.players.find(x => x.id === me);
  if (!p || p.bankrupt || game.phase === 'over' || game.paused || busy) return null;
  const theme = resolveTheme(game.themeId, game.mapId);
  const mine = game.current === me;
  const calm = game.phase === 'done' || game.phase === 'roll';

  const price = game.phase === 'buy' && mine ? theme.spaces[p.position].price ?? 0 : 0;
  const cantAfford = price > p.cash && ownedBy(game, me).some(i => !game.owned[i].mortgaged);
  let hint: { id: HintId; icon: string; text: string; action?: [string, () => void] } | null = null;
  if ((debtOf(game, me) > p.cash || cantAfford) && !seen.has('raise')) {
    hint = {
      id: 'raise', icon: '💸', action: ['Raise cash', onRaise],
      text: cantAfford ? "Can't afford it? Mortgage a deed for quick cash — or let it go to auction."
        : 'Short on cash? Raise cash lets you sell houses and mortgage deeds to pay what you owe.',
    };
  } else if (calm && canBuildAnywhere(game, theme.spaces, me) && !seen.has('build')) {
    hint = { id: 'build', icon: '🏗️', text: 'You own a full colour set! Build houses on it — rent shoots way up.', action: ['Build', onBuild] };
  } else if (mine && game.phase === 'done' && !seen.has('trade') && tradePartnerFor(game, me)) {
    hint = { id: 'trade', icon: '🤝', text: 'One trade away from a full set? Offer cash or deeds for the missing one.', action: ['Trade', onTrade] };
  } else if (!seen.has('welcome') && !howToSeen()) {
    hint = { id: 'welcome', icon: '👋', text: 'New here? The rules fit on one screen.', action: ['How to play', onHelp] };
  }
  if (!hint) return null;
  const h = hint;
  return (
    <div className="coach" role="note" key={h.id}>
      <span className="coach-icon" aria-hidden>{h.icon}</span>
      <span className="coach-text">{h.text}</span>
      <span className="coach-actions">
        {h.action && <button className="btn tiny gold" onClick={() => { markHint(h.id); h.action![1](); }}>{h.action[0]}</button>}
        <button className="btn tiny ghost" onClick={() => markHint(h.id)} aria-label="Dismiss tip">Got it</button>
      </span>
    </div>
  );
}
