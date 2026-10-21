// The end of a Daily Challenge deal (in place of the match-over podium): the
// result the server worked out, where it placed and the streak, the share
// text (Wordle style) and the way to practise the deal again.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toastError } from '../toast.tsx';
import { CARDS_GAME_NAME } from '../../../shared/cards/meta.ts';
import { dailyOutcome, dailyShareText, type CardsDailyTableInfo } from '../../../shared/cards/daily.ts';
import type { CardsView } from '../../../shared/cards/types.ts';
import { cardsCall } from './net.ts';
import { playCardsDaily, shareDaily } from './daily.ts';
import './daily.css';

export default function DailyOver({ daily: d, view }: { daily: CardsDailyTableInfo; view: CardsView | null }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const r = d.result;
  const winner = view?.players.find(p => p.id === view.winner);
  const text = r && !d.practice
    ? dailyShareText({ date: d.date, result: r, streak: d.streak, rank: d.rank, of: d.of, url: `${location.origin}/cards#daily` })
    : null;
  const again = async () => {
    setBusy(true);
    try {
      const next = await playCardsDaily();
      nav(`/cards/r/${next.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const title = !r ? 'The deal was ended' : r.won ? '🏆 You won!' : r.left ? 'You walked out' : `${winner?.name ?? 'A bot'} went out first`;
  return (
    <div className="ct-over" role="dialog" aria-label="Daily Challenge result">
      <div className="ct-over-card panel cd-over">
        <p className="cd-over-kicker">📅 Daily Challenge #{d.number}{d.practice ? ' · Practice' : ''}</p>
        <h2>{title}</h2>
        {r && (
          <div className="cd-tiles">
            <div><b>{r.turns}</b><span>Turns</span></div>
            {r.won
              ? <div className="gold"><b>+{r.points}</b><span>Points</span></div>
              : <div><b>{r.handPoints}</b><span>In hand</span></div>}
            {!d.practice && d.rank ? <div><b>#{d.rank}</b><span>of {d.of}</span></div> : <div><b>{r.oppCards}</b><span>Bots’ cards</span></div>}
            {!d.practice && d.streak ? <div className="fire"><b>🔥{d.streak}</b><span>Streak</span></div> : null}
          </div>
        )}
        {d.practice
          ? <p className="muted small">Practice: not on the leaderboard. Your official result for today stands.</p>
          : r && <p className="muted small">You {dailyOutcome(r)}. Same deal for everyone — see how they did.</p>}
        {text && (
          <figure className="cd-share">
            <pre aria-label="Share text">{text}</pre>
          </figure>
        )}
        <div className="row wrap ct-over-actions">
          {text && <button className="btn primary" onClick={() => void shareDaily(text)}>📋 Share result</button>}
          <Link className="btn" to="/cards#daily-board">🏅 Leaderboard</Link>
          <button className="btn ghost" disabled={busy} onClick={again}>Practise the deal</button>
          <button className="btn ghost" onClick={() => { void cardsCall('cards:leave').catch(() => {}); nav('/cards'); }}>Back to {CARDS_GAME_NAME}</button>
        </div>
      </div>
    </div>
  );
}
