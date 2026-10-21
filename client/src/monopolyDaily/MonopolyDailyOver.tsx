// The end of a Monopoly Daily Challenge game (in place of the usual results):
// the result the server worked out, where it placed and the streak, the share
// text (Wordle style) and the way to practise the same game again.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { call } from '../net.ts';
import { toastError } from '../toast.tsx';
import { resolveTheme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import { GAMES } from '../../../shared/brand.ts';
import {
  MONOPOLY_DAILY_BOTS, dailyMoney, monopolyDailyMap, monopolyDailyShareText, ordinal, type MonopolyDailyResult, type MonopolyDailyTableInfo,
} from '../../../shared/monopolyDaily.ts';
import type { GameView, PlayerState } from '../../../shared/types.ts';
import { Modal } from '../components/Modal.tsx';
import { PlayerBadge } from '../components/PlayerBadge.tsx';
import { monopolyDailyUrl, playMonopolyDaily, shareDaily } from './monopolyDaily.ts';
import '../cards/daily.css';
import './monopoly-daily.css';

function headline(r: MonopolyDailyResult | undefined, cur: string): { icon: string; title: string } {
  if (!r) return { icon: '🎩', title: 'The game was ended' };
  if (r.won) return { icon: '🏆', title: `You beat all ${MONOPOLY_DAILY_BOTS} bots!` };
  if (r.left) return { icon: '🚪', title: 'You left — that counts as a loss' };
  if (r.bankrupt) return { icon: '💸', title: `You went broke on turn ${r.turns}` };
  return { icon: r.place === 1 ? '🥇' : '🎩', title: `You finished with ${dailyMoney(r.netWorth, cur)}` };
}

/** Everyone at the table, richest first (the bankrupt last), with their final money. */
function standings(game: GameView): PlayerState[] {
  const worth = (p: PlayerState) => (p.bankrupt ? -1 : game.netWorth?.[p.id] ?? 0);
  return [...game.players].sort((a, b) => worth(b) - worth(a));
}

export default function MonopolyDailyOver({ daily: d, game, me }: { daily: MonopolyDailyTableInfo; game: GameView; me: string }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = theme.currency;
  const r = d.result;
  const board = getMap(monopolyDailyMap(d.date)).name;
  const text = r && !d.practice
    ? monopolyDailyShareText({ date: d.date, result: r, streak: d.streak, rank: d.rank, of: d.of, url: monopolyDailyUrl(), currency: cur })
    : null;
  const { icon, title } = headline(r, cur);
  const again = async () => {
    setBusy(true);
    try {
      const next = await playMonopolyDaily();
      nav(`/r/${next.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const home = () => { void call('room:leave').catch(() => {}); nav(`${GAMES.monopoly.path}#daily`); };

  if (hidden) return <button className="btn primary end-reopen" onClick={() => setHidden(false)}>📅 Result</button>;

  return (
    <Modal onClose={() => setHidden(true)} dismissable={false} labelledBy="md-over-title" className="end-screen md-over">
      <p className="cd-over-kicker">📅 Daily Challenge #{d.number} · {board}{d.practice ? ' · Practice' : ''}</p>
      <div className="trophy" aria-hidden>{icon}</div>
      <h2 id="md-over-title" className="end-title">{title}</h2>
      {r && (
        <div className="cd-tiles">
          <div><b>{r.turns}</b><span>Turns</span></div>
          <div className={r.won || r.place === 1 ? 'gold' : ''}><b>{dailyMoney(r.netWorth, cur)}</b><span>Money</span></div>
          {!d.practice && d.rank ? <div><b>#{d.rank}</b><span>of {d.of} today</span></div> : <div><b>{ordinal(r.place)}</b><span>At the table</span></div>}
          {!d.practice && d.streak ? <div className="fire"><b>🔥{d.streak}</b><span>Streak</span></div> : null}
        </div>
      )}
      {d.practice
        ? <p className="muted small">Practice doesn’t count. Your result for today stays the same.</p>
        : <p className="muted small">Everyone played this same game today. See how they did.</p>}

      <ol className="md-over-standings" aria-label="Final money">
        {standings(game).map((p, i) => (
          <li key={p.id} className={p.id === me ? 'me' : ''}>
            <span className="md-over-place">{i + 1}.</span>
            <PlayerBadge p={p} />
            <span className="grow">{p.name}{p.id === me ? ' (you)' : ''}</span>
            <span className="md-over-worth">{p.bankrupt ? <span className="muted">broke</span> : dailyMoney(game.netWorth?.[p.id] ?? 0, cur)}</span>
          </li>
        ))}
      </ol>

      {text && (
        <figure className="cd-share">
          <pre aria-label="Share text">{text}</pre>
        </figure>
      )}
      <div className="end-actions">
        <div className="row wrap md-over-actions">
          {text && <button className="btn primary" onClick={() => void shareDaily(text)} data-autofocus>📋 Share result</button>}
          <Link className="btn" to={`${GAMES.monopoly.path}#daily-board`} onClick={() => void call('room:leave').catch(() => {})}>🏅 Leaderboard</Link>
          <button className="btn ghost" disabled={busy} onClick={again}>Practise</button>
        </div>
        <div className="row">
          <button className="btn ghost small" onClick={() => setHidden(true)}>View board</button>
          <button className="btn small" onClick={home}>Back to {GAMES.monopoly.name}</button>
        </div>
      </div>
    </Modal>
  );
}
