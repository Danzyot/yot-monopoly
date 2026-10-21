// The Daily Challenge card on the Monopoly page (/monopoly#daily): today's
// board and bots, your status (play it, go back to it, or your result to
// share), your streak, how it is scored, and the leaderboard: the top five
// here, the top 50 and the days before when opened. Built like the Cards
// daily's card (../cards/DailyCard.tsx) and on its styles.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { useConnected } from '../net.ts';
import { toastError } from '../toast.tsx';
import { ProfileLink } from '../community.tsx';
import { getMap } from '../../../shared/maps.ts';
import { mapThumbUrl } from '../../../shared/season.ts';
import {
  MONOPOLY_DAILY_HOW, MONOPOLY_DAILY_RANKING_HELP, dailyMoney, monopolyDailyMap, monopolyDailyOutcome, monopolyDailyShareText,
  monopolyDailyTitle, ordinal, type MonopolyDailyInfo, type MonopolyDailyRow,
} from '../../../shared/monopolyDaily.ts';
import {
  monopolyDailyUrl, playMonopolyDaily, shareDaily, untilNext, useMonopolyDaily, useMonopolyDailyHistory,
} from './monopolyDaily.ts';
import '../cards/daily.css';
import './monopoly-daily.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Chogzilla, Lil Chog and Spike". */
const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');

/** A row's result in a few words: "won · 14 turns" / "$2,340" / "broke on turn 9" / "walked out". */
function rowResult(r: MonopolyDailyRow): string {
  if (r.won) return `won · ${r.turns} turns`;
  if (r.left) return 'walked out';
  if (r.bankrupt) return `broke on turn ${r.turns}`;
  return dailyMoney(r.netWorth);
}

export function MonopolyDailyBoard({ rows, me, empty }: { rows: MonopolyDailyRow[]; me?: string; empty: string }) {
  if (!rows.length) return <p className="muted small cd-empty">{empty}</p>;
  return (
    <ol className="cd-board">
      {rows.map(r => (
        <li key={r.id} className={`${r.won ? 'won' : r.left ? 'left' : 'lost'}${r.id === me ? ' me' : ''}`}>
          <span className="cd-rank">{r.rank}</span>
          <ProfileLink id={r.id} className="cd-name">{r.name}</ProfileLink>
          {r.id === me && <em className="tag">you</em>}
          <span className="cd-res">{r.won ? '🏆 ' : ''}{rowResult(r)}</span>
        </li>
      ))}
    </ol>
  );
}

function CalendarTile({ date }: { date: string }) {
  const [, m, d] = date.split('-').map(Number);
  return (
    <div className="cd-cal" aria-hidden>
      <span>{MONTHS[(m ?? 1) - 1]}</span>
      <b>{d}</b>
    </div>
  );
}

/** The full leaderboard: today or one of the days before. */
function FullBoard({ info, me }: { info: MonopolyDailyInfo; me?: string }) {
  const days = useMonopolyDailyHistory(true, me);
  const [date, setDate] = useState<string | null>(null);
  const past = useMonopolyDaily(date, me, !!date);
  // A past day shows once its own answer is in (not the day picked before it).
  const shown = !date ? info : past.info?.date === date ? past.info : null;
  return (
    <div className="cd-full">
      <div className="cd-days" role="tablist" aria-label="Day">
        <button role="tab" aria-selected={!date} className={!date ? 'on' : ''} onClick={() => setDate(null)}>Today</button>
        {days.map(d => (
          <button key={d.date} role="tab" aria-selected={date === d.date} className={date === d.date ? 'on' : ''} onClick={() => setDate(d.date)}
            title={`${d.date} · ${getMap(d.mapId).name}: ${d.players} played${d.you ? `, you came #${d.you.rank}` : ''}`}>
            #{d.number}{d.you ? <span className="cd-day-dot" aria-label=" (played)" /> : null}
          </button>
        ))}
      </div>
      {shown ? (
        <>
          <p className="muted small cd-board-meta">
            {monopolyDailyTitle(shown.date)} · {getMap(shown.mapId).name} · {shown.players} played · {shown.wins} won
          </p>
          <MonopolyDailyBoard rows={shown.leaders} me={me} empty={date ? 'Nobody played that day.' : 'Nobody has finished today’s game yet — be the first.'} />
        </>
      ) : <p className="muted small">Loading…</p>}
    </div>
  );
}

export default function MonopolyDailyCard() {
  const nav = useNavigate();
  const { profile, config, openSignIn } = useAuth();
  const connected = useConnected();
  const { info, error } = useMonopolyDaily(null, profile?.id);
  const [busy, setBusy] = useState(false);
  // The result screen's Leaderboard button lands here with the board open.
  const [open, setOpen] = useState(() => location.hash === '#daily-board');
  const [, setNow] = useState(0);

  // The countdown to the next game, kept roughly current.
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // Arriving from a link (/monopoly#daily): bring the card into view.
  useEffect(() => {
    if (info && location.hash.startsWith('#daily')) document.getElementById('daily')?.scrollIntoView({ block: 'start' });
  }, [!!info]);

  if (error && !info) return null;
  if (!info) return <section className="panel cd-daily md-daily cd-loading" id="daily" aria-busy="true" />;

  const you = info.you;
  const streak = you?.streaks.streak ?? 0;
  const map = getMap(info.mapId || monopolyDailyMap(info.date));
  const play = async () => {
    if (!profile) return openSignIn();
    setBusy(true);
    try {
      const r = await playMonopolyDaily();
      nav(`/r/${r.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const share = () => {
    if (!you?.result) return;
    void shareDaily(monopolyDailyShareText({ date: info.date, result: you.result, streak, rank: you.rank, of: info.players, url: monopolyDailyUrl() }));
  };
  const r = you?.result;

  return (
    <section className="panel cd-daily md-daily" id="daily" aria-labelledby="md-title">
      <div className="cd-head">
        <CalendarTile date={info.date} />
        <div className="cd-titles">
          <h2 id="md-title">Daily Challenge <span className="cd-num">#{info.number}</span></h2>
          <p className="md-how">{MONOPOLY_DAILY_HOW}</p>
        </div>
        {streak > 0 && (
          <span className="cd-streak" title={`${streak} day${streak === 1 ? '' : 's'} in a row (best ${you!.streaks.best})${you!.streaks.winStreak ? ` · ${you!.streaks.winStreak} won in a row` : ''}`}>
            🔥<b>{streak}</b><small>day{streak === 1 ? '' : 's'}</small>
          </span>
        )}
      </div>

      <div className="md-today">
        <img className="md-thumb" src={mapThumbUrl(map.id)} alt="" width={120} height={75} loading="lazy" decoding="async" />
        <div className="md-today-text">
          <b>Today: {map.name}</b>
          <span className="muted small">vs {listNames(info.bots.map(b => b.name))} · {info.turns} turns · new game in {untilNext(info.endsAt)}</span>
        </div>
      </div>

      <div className="cd-status" role="status">
        {!profile ? (
          <p>Sign in to play. You can practise as much as you like after your try.</p>
        ) : you?.status === 'playing' ? (
          <p><b>Your game is still on.</b> Pick it up where you left it.</p>
        ) : you?.status === 'done' && r ? (
          <div className={`cd-result ${r.won ? 'won' : 'lost'}`}>
            <span className="cd-result-icon" aria-hidden>{r.won ? '🏆' : r.left ? '🚪' : r.bankrupt ? '💸' : '🎩'}</span>
            <span className="grow">
              <b>You {monopolyDailyOutcome(r)}</b>
              <span className="muted small cd-result-meta">
                {r.left ? 'Leaving counts as a loss' : `${ordinal(r.place)} at the table`}
                {you.rank ? ` · #${you.rank} of ${info.players} today` : ''}
              </span>
            </span>
          </div>
        ) : (
          <p>Leaving or stopping counts as a loss.</p>
        )}
      </div>

      <div className="cd-actions">
        {!profile ? (
          <button className="btn primary" onClick={openSignIn}>Sign in to play</button>
        ) : you?.status === 'playing' ? (
          <button className="btn primary" onClick={() => nav(`/r/${you.code}`)}>▶ Back to your game</button>
        ) : you?.status === 'done' ? (
          <>
            <button className="btn primary" onClick={share}>📋 Share result</button>
            <button className="btn ghost" disabled={busy || !connected} onClick={play}>Practise</button>
          </>
        ) : (
          <button className="btn primary" disabled={busy || !connected} onClick={play}>▶ Play today’s game</button>
        )}
        {config.features.leaderboard && (
          <button className="btn ghost small cd-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Hide leaderboard' : `🏅 Leaderboard${info.players ? ` (${info.players})` : ''}`}
          </button>
        )}
      </div>

      {config.features.leaderboard && (open
        ? <FullBoard info={info} me={profile?.id} />
        : info.leaders.length > 0 && <MonopolyDailyBoard rows={info.leaders.slice(0, 5)} me={profile?.id} empty="" />)}
      <p className="muted small cd-help md-scoring"><b>How it’s scored:</b> {MONOPOLY_DAILY_RANKING_HELP}</p>
    </section>
  );
}
