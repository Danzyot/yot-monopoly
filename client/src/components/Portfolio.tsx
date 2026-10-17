// Portfolio: who owns what. A summary of every player (cash, net worth,
// deeds, jail cards) and, for the one picked, their deeds grouped by colour
// set with buildings and mortgages. Net worth comes from the server (the
// engine's own formula), so it always matches the final standings.
import { useEffect, useState } from 'react';
import { resolveTheme, type Theme } from '../../../shared/themes.ts';
import type { GameView, PlayerState } from '../../../shared/types.ts';
import { characterEmoji } from '../format.ts';
import { CloseX, Modal } from './Modal.tsx';

interface Group {
  key: string;
  label: string;
  color: string;
  /** How many spaces the whole set has on this board. */
  size: number;
  spaces: number[];
}

const pretty = (id: string) => {
  const s = id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^(light|dark)(?=[a-z])/, '$1 ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** A player's deeds grouped into colour sets (then railroads, utilities), in board order. */
function groupsOf(theme: Theme, game: GameView, id: string): Group[] {
  const keyOf = (i: number) => {
    const s = theme.spaces[i];
    return s.kind === 'property' ? s.group! : s.kind;
  };
  const mine = Object.entries(game.owned).filter(([, o]) => o.owner === id).map(([k]) => Number(k)).sort((a, b) => a - b);
  const byKey = new Map<string, number[]>();
  for (const i of mine) byKey.set(keyOf(i), [...(byKey.get(keyOf(i)) ?? []), i]);
  return [...byKey].map(([key, spaces]) => ({
    key,
    label: key === 'railroad' ? 'Railroads' : key === 'utility' ? 'Utilities' : pretty(key),
    color: theme.groupColors[key] ?? (key === 'railroad' ? '#222' : '#9aa3b2'),
    size: theme.spaces.filter((_, i) => keyOf(i) === key).length,
    spaces,
  }));
}

export default function Portfolio({ game, me, focus, onPick, onTrade, compact }: {
  game: GameView;
  me: string;
  /** Player to show first. */
  focus?: string | null;
  onPick: (space: number) => void;
  /** Offer a trade to this player (absent: no trade buttons). */
  onTrade?: (id: string) => void;
  /** Squeezed into the side panel. */
  compact?: boolean;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const [pick, setPick] = useState<string>(focus ?? me ?? game.players[0].id);
  useEffect(() => { if (focus) setPick(focus); }, [focus]);
  const shown = game.players.find(p => p.id === pick) ?? game.players[0];
  const amIn = game.players.some(p => p.id === me && !p.bankrupt) && game.phase !== 'over';
  const canTrade = (p: PlayerState) => !!onTrade && amIn && p.id !== me && !p.bankrupt;
  const deeds = (id: string) => Object.values(game.owned).filter(o => o.owner === id).length;

  return (
    <div className={`portfolio ${compact ? 'compact' : ''}`}>
      <table className="pf-table">
        <thead>
          <tr><th>Player</th><th>Cash</th><th title="Cash plus what deeds and buildings would raise">Worth</th><th className="hide-compact">Deeds</th></tr>
        </thead>
        <tbody>
          {game.players.map(p => (
            <tr key={p.id} className={`${p.id === shown.id ? 'on' : ''} ${p.bankrupt ? 'out' : ''}`}
              onClick={() => setPick(p.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setPick(p.id); }}>
              <td>
                <span className="pfo-who">
                  <i className="pf-dot" style={{ background: p.color }}>{characterEmoji(p.character)}</i>
                  <span className="pf-name">{p.name}{p.id === me ? ' (you)' : ''}</span>
                </span>
              </td>
              <td className="num">{p.bankrupt ? '—' : cur(p.cash)}</td>
              <td className="num"><b>{p.bankrupt ? 'out' : cur(game.netWorth?.[p.id] ?? p.cash)}</b></td>
              <td className="num hide-compact">{deeds(p.id)}{p.jailCards.length > 0 && <span title="Get Out of Jail Free cards"> · 🎫{p.jailCards.length}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pf-detail">
        <div className="row between">
          <h4 style={{ color: shown.color, margin: 0 }}>{shown.name}{shown.id === me ? ' (you)' : ''}</h4>
          {canTrade(shown) && <button className="btn tiny primary" onClick={() => onTrade!(shown.id)}>Trade with {shown.name}</button>}
        </div>
        <div className="small muted pf-sub">
          {shown.bankrupt ? 'Bankrupt' : <>
            Cash <b className="cash">{cur(shown.cash)}</b> · worth <b>{cur(game.netWorth?.[shown.id] ?? shown.cash)}</b>
            {shown.jailCards.length > 0 && <> · 🎫 {shown.jailCards.length} Get Out of Jail Free</>}
            {shown.inJail && ' · 🔒 in jail'}
          </>}
        </div>
        <PlayerDeeds theme={theme} game={game} id={shown.id} onPick={onPick} />
      </div>
    </div>
  );
}

function PlayerDeeds({ theme, game, id, onPick }: { theme: Theme; game: GameView; id: string; onPick: (i: number) => void }) {
  const groups = groupsOf(theme, game, id);
  if (!groups.length) return <p className="muted small">No properties.</p>;
  return (
    <div className="pf-groups">
      {groups.map(g => (
        <div key={g.key} className="pf-group">
          <div className="pf-group-head">
            <i style={{ background: g.color }} />
            <span className="grow">{g.label}</span>
            <span className={`small ${g.spaces.length === g.size ? 'accent' : 'muted'}`}>
              {g.spaces.length}/{g.size}{g.spaces.length === g.size ? ' ✓ set' : ''}
            </span>
          </div>
          {g.spaces.map(i => {
            const o = game.owned[i];
            return (
              <button key={i} className={`pf-deed ${o.mortgaged ? 'mortgaged' : ''}`} onClick={() => onPick(i)} title="Show the deed">
                <span className="grow">{theme.spaces[i].name}</span>
                <span className="small">
                  {o.mortgaged ? <em className="tag warn">mortgaged</em> : o.houses === 5 ? '🏨' : '🏠'.repeat(o.houses)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Portfolio in a dialog, opened from a player row or the T shortcut. */
export function PortfolioModal(props: Parameters<typeof Portfolio>[0] & { onClose: () => void }) {
  const { onClose, ...rest } = props;
  return (
    <Modal onClose={onClose} labelledBy="pf-title" className="wide pf-modal">
      <div className="row between"><h3 id="pf-title" style={{ margin: 0 }}>Portfolios</h3><CloseX onClick={onClose} /></div>
      <Portfolio {...rest} onPick={i => { onClose(); rest.onPick(i); }} />
    </Modal>
  );
}
