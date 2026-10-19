// End of the game: final standings, how long it took, one line on how the
// winner did it, the few moments that stood out (if any did), and the way
// back in — the host resets the room for a rematch with the same seats and
// settings; everyone else waits or leaves.
import { useState } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import type { GameView, PlayerState, RoomView } from '../../../shared/types.ts';
import { call } from '../net.ts';
import { characterEmoji } from '../format.ts';
import { toastError } from '../toast.tsx';
import { groupLabel, ordinal } from '../gameHelpers.ts';
import { groupIndices, type SpaceDef } from '../../../shared/board.ts';
import { gameHistory, type GameHistory, type WorthPoint } from '../gameHistory.ts';
import { Modal } from './Modal.tsx';
import { PlayerBadge } from './PlayerBadge.tsx';

const MEDALS = ['🥇', '🥈', '🥉'];

function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Players already warned about (dev only), so a re-render does not repeat it. */
const warned = new Set<string>();

/**
 * A player's final net worth, as the server counts it (0 once bankrupt).
 * Only game.netWorth, never cash, so the order always matches the server's
 * winner; a missing entry counts as 0.
 */
function netWorthOf(game: GameView, p: PlayerState): number {
  if (p.bankrupt) return 0;
  const v = game.netWorth?.[p.id];
  if (v === undefined) {
    if (import.meta.env.DEV && !warned.has(p.id)) { warned.add(p.id); console.warn(`EndScreen: no net worth for ${p.id}; counting 0`); }
    return 0;
  }
  return v;
}

/**
 * Finishing order, as the server's results record it: the winner, then
 * survivors by net worth (an operator can end a game early), then the
 * bankrupt, last one out first.
 */
function standings(game: GameView): PlayerState[] {
  const worth = (p: PlayerState) => netWorthOf(game, p);
  const alive = game.players.filter(p => !p.bankrupt).sort((a, b) =>
    Number(b.id === game.winner) - Number(a.id === game.winner) || worth(b) - worth(a));
  const out = [...(game.outOrder ?? [])].reverse()
    .map(id => game.players.find(p => p.id === id))
    .filter((p): p is PlayerState => !!p);
  return [...alive, ...out];
}

/**
 * A moment worth remembering. Each has a bar to clear, so most games show
 * one or two and a quiet game shows none: no prize for doing what everyone
 * did (buying deeds, paying a rent, going to jail), and nothing the podium
 * and the net worth bars already say.
 */
interface Moment { icon: string; title: string; who: PlayerState; text: string }

/** Join names the way a sentence does: "A", "A and B", "A, B and C". */
function andList(xs: string[]): string {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

/** One line on how the winner did it: the sets they held, what stood on them, the rent they took. */
function howWon(game: GameView, winner: PlayerState, spaces: SpaceDef[], cur: (n: number) => string): string {
  const mine = Object.entries(game.owned).filter(([, o]) => o.owner === winner.id);
  const groups = [...new Set(mine.map(([k]) => spaces[Number(k)]).filter(s => s?.kind === 'property' && s.group).map(s => s.group!))];
  const sets = groups.filter(g => groupIndices(spaces, g).every(i => game.owned[i]?.owner === winner.id));
  const hotels = mine.filter(([, o]) => o.houses === 5).length;
  const houses = mine.reduce((a, [, o]) => a + (o.houses < 5 ? o.houses : 0), 0);
  const rent = game.stats?.[winner.id]?.rentCollected ?? 0;
  const bits = [
    hotels ? `${hotels} ${hotels === 1 ? 'hotel' : 'hotels'}` : '',
    houses ? `${houses} ${houses === 1 ? 'house' : 'houses'}` : '',
    rent ? `${cur(rent)} in rent` : '',
  ].filter(Boolean);
  const how = sets.length
    ? `with the ${andList(sets.map(groupLabel))} ${sets.length === 1 ? 'set' : 'sets'}`
    : 'without a full colour set';
  const end = game.timeUp ? ' when time ran out' : '';
  return `${winner.name} won ${how}${end}${bits.length ? `: ${andList(bits)}` : ''}.`;
}

function moments(game: GameView, spaces: SpaceDef[], cur: (n: number) => string, hist: GameHistory | null, order: PlayerState[]): Moment[] {
  const who = (id: string) => game.players.find(p => p.id === id);
  const start = game.rules.startingCash || 1500;
  const out: Moment[] = [];

  // The deal that decided it: a trade that completed one of the winner's sets.
  const deal = game.winner ? hist?.deals.find(d => d.to === game.winner) : undefined;
  const dealer = deal && who(deal.to), partner = deal && who(deal.from);
  if (deal && dealer && partner) {
    out.push({ icon: '🤝', title: 'The deal', who: dealer, text: `completed the ${groupLabel(deal.group)} set in a trade with ${partner.name} (turn ${deal.turn})` });
  }

  // A comeback: last at half time, top two at the end. Needs most of the game on record and three or more players.
  const pts = hist?.points ?? [];
  if (order.length >= 3 && pts.length >= 8 && pts[0].turn <= 3) {
    const mid = pts[Math.floor(pts.length / 2)];
    const ranked = game.players.filter(p => mid.worth[p.id] !== undefined).sort((a, b) => mid.worth[a.id] - mid.worth[b.id]);
    const low = ranked[0];
    const place = order.findIndex(p => p.id === low?.id);
    if (low && place >= 0 && place <= 1 && mid.worth[low.id] < mid.worth[ranked[1].id]) {
      out.push({ icon: '📈', title: 'Comeback', who: low, text: `last at turn ${mid.turn}, finished ${ordinal(place + 1)}` });
    }
  }

  // The biggest single rent, when it was a real blow: at least a third of a starting stake.
  // (Not "on the way out": the record does not say whether that rent is what broke them.)
  let hit: [PlayerState, number] | null = null;
  for (const p of game.players) {
    const v = game.stats?.[p.id]?.biggestRentPaid ?? 0;
    if (v > (hit?.[1] ?? 0)) hit = [p, v];
  }
  if (hit && hit[1] >= start / 3) {
    out.push({ icon: '💥', title: 'Biggest hit', who: hit[0], text: `paid ${cur(hit[1])} rent in one go` });
  }

  // Top rent collector, only when there was a winner and it was someone else
  // (whose rent is in the line above): not the winner, not whoever finished first, and serious money.
  let rent: [PlayerState, number] | null = null;
  for (const p of game.players) {
    const v = game.stats?.[p.id]?.rentCollected ?? 0;
    if (v > (rent?.[1] ?? 0)) rent = [p, v];
  }
  if (rent && game.winner && rent[0].id !== game.winner && rent[0].id !== order[0]?.id && rent[1] >= start) {
    out.push({ icon: '👑', title: 'Rent king', who: rent[0], text: `took ${cur(rent[1])} in rent and still didn't win` });
  }
  // One each: a player's second moment would read as a pile-up.
  return out.filter((m, k) => out.findIndex(x => x.who.id === m.who.id) === k).slice(0, 3);
}

/** Net worth over the game as a little line, on a scale shared by every row. */
function Spark({ points, id, color, top }: { points: WorthPoint[]; id: string; color: string; top: number }) {
  const vals = points.map(p => p.worth[id]).filter((v): v is number => v !== undefined);
  if (vals.length < 4) return null;
  const W = 72, H = 22;
  const xy = vals.map((v, k) => `${((k / (vals.length - 1)) * W).toFixed(1)},${(H - 1 - (Math.max(0, v) / top) * (H - 2)).toFixed(1)}`);
  return (
    <svg className="end-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <polyline points={xy.join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy.at(-1)!.split(',')[0]} cy={xy.at(-1)!.split(',')[1]} r="2.6" fill={color} />
    </svg>
  );
}

export default function EndScreen({ room, game, me, onLeave }: {
  room: RoomView; game: GameView; me: string; onLeave: () => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const winner = game.players.find(p => p.id === game.winner);
  const order = standings(game);
  const hist = gameHistory(game.startedAt);
  const story = winner ? howWon(game, winner, theme.spaces, cur) : null;
  const fun = moments(game, theme.spaces, cur, hist, order);
  const sparkTop = Math.max(1, ...(hist?.points ?? []).flatMap(p => Object.values(p.worth)));
  const isHost = room.hostId === me;
  const host = room.seats.find(s => s.id === room.hostId);
  const ended = game.endedAt ?? room.now;
  const myPlace = order.findIndex(p => p.id === me) + 1;
  const iWon = !!winner && winner.id === me;
  const worth = (p: PlayerState) => netWorthOf(game, p);
  const top = Math.max(1, ...order.map(worth));
  // Podium: 2nd · 1st · 3rd, the classic silhouette; missing places simply stay empty.
  const podium = [order[1], order[0], order[2]].map((p, k) => ({ p, place: [2, 1, 3][k] }));

  const rematch = () => {
    setBusy(true);
    call('room:rematch').catch(toastError).finally(() => setBusy(false));
  };

  if (hidden) {
    return (
      <button className="btn primary end-reopen" onClick={() => setHidden(false)}>🏆 Results</button>
    );
  }

  return (
    <Modal onClose={() => setHidden(true)} dismissable={false} labelledBy="end-title" className="end-screen" backClassName="end-back"
      behind={winner && <Confetti colors={[winner.color, '#ffd23f', '#ffffff', '#5be35b', '#3b8cff']} />}>
        <div className="trophy" aria-hidden>{iWon ? '🏆' : myPlace > 0 ? (MEDALS[myPlace - 1] ?? '🎲') : '🏆'}</div>
        {winner
          ? <h2 id="end-title" className="end-title">{iWon ? 'You win!' : <><span style={{ color: winner.color }}>{winner.name}</span> wins!</>}</h2>
          : <h2 id="end-title" className="end-title">Game over!</h2>}
        {myPlace > 0 && !iWon && <p className="end-you">You finished <b>{ordinal(myPlace)}</b> of {order.length}</p>}
        {iWon && <p className="end-you">Property tycoon! 🎉</p>}
        {game.timeUp && <p className="end-timeup">⏰ Time's up — richest player wins</p>}
        <p className="muted small end-meta">
          {game.turnNumber} {game.turnNumber === 1 ? 'turn' : 'turns'} · {duration(ended - game.startedAt)} · {theme.name}
        </p>

        {story && winner && (
          <p className="end-story" style={{ ['--pc' as string]: winner.color }}>
            <PlayerBadge p={winner} />
            <span>{story}</span>
          </p>
        )}

        {order.length >= 2 && (
          <ol className="podium" aria-label="Podium">
            {podium.map(({ p, place }) => p ? (
              <li key={p.id} className={`podium-spot p${place} ${p.id === me ? 'me' : ''}`} style={{ ['--pc' as string]: p.color }}>
                <span className="podium-char" aria-hidden>{p.chogToken ? <PlayerBadge p={p} className="podium-face" /> : characterEmoji(p.character)}</span>
                <span className="podium-name">{p.name}</span>
                <span className="podium-block">
                  <span className="podium-medal" aria-hidden>{MEDALS[place - 1]}</span>
                  <span className="podium-place">{ordinal(place)}</span>
                </span>
              </li>
            ) : <li key={place} className={`podium-spot p${place} empty`} aria-hidden />)}
          </ol>
        )}

        <h3 className="end-h">Final net worth</h3>
        <ol className="end-standings" aria-label="Final standings">
          {order.map((p, i) => (
            <li key={p.id} className={p.id === me ? 'me' : ''}>
              <span className="end-place" aria-label={ordinal(i + 1)}>{MEDALS[i] ?? `${i + 1}.`}</span>
              <PlayerBadge p={p} />
              <span className="grow end-main">
                <span className="end-line">
                  <span className="end-name">{p.name}{p.id === me ? ' (you)' : ''}</span>
                  <span className="end-worth">{p.bankrupt ? <span className="muted">bankrupt</span> : cur(worth(p))}</span>
                </span>
                <span className="end-bar" aria-hidden>
                  <i style={{ ['--w' as string]: `${Math.max(2, Math.round((worth(p) / top) * 100))}%`, background: p.color, animationDelay: `${0.25 + i * 0.12}s` }} />
                </span>
              </span>
              {hist && <Spark points={hist.points} id={p.id} color={p.color} top={sparkTop} />}
            </li>
          ))}
        </ol>

        {fun.length > 0 && (
          <>
            <h3 className="end-h">Moments</h3>
            <ul className={`end-moments n${fun.length}`} aria-label="Moments of the game">
              {fun.map(m => (
                <li key={m.title} className="end-moment" style={{ ['--pc' as string]: m.who.color }}>
                  <span className="end-moment-icon" aria-hidden>{m.icon}</span>
                  <b className="end-moment-title">{m.title}</b>
                  <span className="end-moment-who">
                    <PlayerBadge p={m.who} />
                    <span className="end-moment-name">{m.who.name}{m.who.id === me ? ' (you)' : ''}</span>
                  </span>
                  <span className="end-moment-text small">{m.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Sticky at the bottom of the scrolling dialog (ui-polish.css), so Rematch is always in view. */}
        <div className="end-actions">
          {isHost
            ? <button className="btn primary chunky rematch-btn" disabled={busy} onClick={rematch} data-autofocus>🔁 Rematch!</button>
            : <span className="muted small">Waiting for {host?.name ?? 'the host'} to start a rematch…</span>}
          <div className="row">
            <button className="btn ghost small" onClick={() => setHidden(true)}>View board</button>
            <button className="btn small" onClick={onLeave}>Leave</button>
          </div>
        </div>
    </Modal>
  );
}

/**
 * A burst of paper confetti behind the winner's card. CSS only, a few seconds
 * long rather than endless, and skipped entirely under reduced motion.
 */
function Confetti({ colors }: { colors: string[] }) {
  const bits = Array.from({ length: 40 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden>
      {bits.map(i => (
        <i key={i} style={{
          left: `${(i * 37) % 100}%`, background: colors[i % colors.length],
          animationDelay: `${(i % 10) * 0.2}s`, animationDuration: `${3.2 + (i % 5) * 0.45}s`,
          ['--drift' as string]: `${((i * 53) % 120) - 60}px`, ['--spin' as string]: `${360 + (i % 4) * 180}deg`,
        }} />
      ))}
    </div>
  );
}
