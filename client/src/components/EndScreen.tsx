// End of the game: final standings, how long it took, a few fun numbers the
// engine tallied during play, and the way back in — the host resets the room
// for a rematch with the same seats and settings; everyone else waits or leaves.
import { useState } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import type { GameView, PlayerState, PlayerStats, RoomView } from '../../../shared/types.ts';
import { call } from '../net.ts';
import { characterEmoji } from '../format.ts';
import { toastError } from '../toast.tsx';
import { ordinal } from '../gameHelpers.ts';
import { Modal } from './Modal.tsx';

const MEDALS = ['🥇', '🥈', '🥉'];

function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Finishing order, as the server's results record it: the winner, then
 * survivors by net worth (an operator can end a game early), then the
 * bankrupt, last one out first.
 */
function standings(game: GameView): PlayerState[] {
  const worth = (p: PlayerState) => game.netWorth?.[p.id] ?? p.cash;
  const alive = game.players.filter(p => !p.bankrupt).sort((a, b) =>
    Number(b.id === game.winner) - Number(a.id === game.winner) || worth(b) - worth(a));
  const out = [...(game.outOrder ?? [])].reverse()
    .map(id => game.players.find(p => p.id === id))
    .filter((p): p is PlayerState => !!p);
  return [...alive, ...out];
}

interface Award { icon: string; title: string; who: PlayerState; value: string }

function awards(game: GameView, cur: (n: number) => string): Award[] {
  const best = (key: keyof PlayerStats): [PlayerState, number] | null => {
    let top: [PlayerState, number] | null = null;
    for (const p of game.players) {
      const v = game.stats?.[p.id]?.[key] ?? 0;
      if (v > 0 && (!top || v > top[1])) top = [p, v];
    }
    return top;
  };
  const out: Award[] = [];
  const add = (key: keyof PlayerStats, icon: string, title: string, fmt: (v: number) => string) => {
    const b = best(key);
    if (b) out.push({ icon, title, who: b[0], value: fmt(b[1]) });
  };
  add('rentCollected', '💰', 'Landlord of the game', v => `${cur(v)} rent collected`);
  add('biggestRentPaid', '😱', 'Ouch', v => `paid ${cur(v)} rent in one go`);
  add('propertiesBought', '🏘️', 'Shopaholic', v => `${v} ${v === 1 ? 'property' : 'properties'} bought`);
  add('jailed', '🔒', 'Jailbird', v => `sent to jail ${v}×`);
  add('minigamesWon', '🎮', 'Arcade champ', v => `${v} mini-game${v === 1 ? '' : 's'} won`);
  return out;
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
  const fun = awards(game, cur);
  const isHost = room.hostId === me;
  const host = room.seats.find(s => s.id === room.hostId);
  const ended = game.endedAt ?? room.now;
  const myPlace = order.findIndex(p => p.id === me) + 1;
  const iWon = !!winner && winner.id === me;
  const worth = (p: PlayerState) => (p.bankrupt ? 0 : game.netWorth?.[p.id] ?? p.cash);
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

        {order.length >= 2 && (
          <ol className="podium" aria-label="Podium">
            {podium.map(({ p, place }) => p ? (
              <li key={p.id} className={`podium-spot p${place} ${p.id === me ? 'me' : ''}`} style={{ ['--pc' as string]: p.color }}>
                <span className="podium-char" aria-hidden>{characterEmoji(p.character)}</span>
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
              <span className="token-badge" style={{ background: p.color }} aria-hidden>{characterEmoji(p.character)}</span>
              <span className="grow end-main">
                <span className="end-line">
                  <span className="end-name">{p.name}{p.id === me ? ' (you)' : ''}</span>
                  <span className="end-worth">{p.bankrupt ? <span className="muted">bankrupt</span> : cur(worth(p))}</span>
                </span>
                <span className="end-bar" aria-hidden>
                  <i style={{ ['--w' as string]: `${Math.max(2, Math.round((worth(p) / top) * 100))}%`, background: p.color, animationDelay: `${0.25 + i * 0.12}s` }} />
                </span>
              </span>
            </li>
          ))}
        </ol>

        {fun.length > 0 && (
          <>
            <h3 className="end-h">Awards</h3>
            <ul className="end-badges" aria-label="Awards">
              {fun.map(a => (
                <li key={a.title} className="end-badge" style={{ ['--pc' as string]: a.who.color }} title={`${a.who.name}: ${a.value}`}>
                  <span className="end-badge-icon" aria-hidden>{a.icon}</span>
                  <span className="end-badge-text">
                    <b>{a.title}</b>
                    <span className="small"><span className="end-badge-who">{a.who.name}</span> · {a.value}</span>
                  </span>
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
