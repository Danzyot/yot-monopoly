// The Daily Challenge card on the Cards home (/cards#daily): today's deal and
// bots, your status (play it, go back to it, or your result to share), your
// streak, and the leaderboard: the top five here, the top 50 and the days
// before when opened.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { useConnected } from '../net.ts';
import { toastError } from '../toast.tsx';
import { ProfileLink } from '../community.tsx';
import {
  DAILY_RANKING_HELP, dailyOutcome, dailyShareText, dailyTitle,
  type CardsDailyInfo, type CardsDailyRow,
} from '../../../shared/cards/daily.ts';
import { playCardsDaily, shareDaily, untilNext, useCardsDaily, useCardsDailyHistory } from './daily.ts';
import './daily.css';
import { CARDS_DEFAULT_TABLE, getCardsTable } from '../../../shared/cards/tables.ts';

/** A daily table has no lobby to pick a setting in: it is dealt in the default one. */
const DAILY_TABLE = getCardsTable(CARDS_DEFAULT_TABLE);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Chogzilla, Lil Chog and Spike". */
const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');

/** A row's result in a few words: "14 turns · +87" / "23 in hand" / "walked out". */
function rowResult(r: CardsDailyRow): string {
  if (r.won) return `${r.turns} turns · +${r.points}`;
  if (r.left) return 'walked out';
  return `lost · ${r.handPoints} in hand`;
}

/** The share link: this site's Cards home, opened at the daily. */
const shareUrl = () => `${location.origin}/cards#daily`;

export function DailyBoard({ rows, me, empty }: { rows: CardsDailyRow[]; me?: string; empty: string }) {
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
function FullBoard({ info, me }: { info: CardsDailyInfo; me?: string }) {
  const days = useCardsDailyHistory(true, me);
  const [date, setDate] = useState<string | null>(null);
  const past = useCardsDaily(date, me, !!date);
  // A past day shows once its own answer is in (not the day picked before it).
  const shown = !date ? info : past.info?.date === date ? past.info : null;
  return (
    <div className="cd-full">
      <div className="cd-days" role="tablist" aria-label="Day">
        <button role="tab" aria-selected={!date} className={!date ? 'on' : ''} onClick={() => setDate(null)}>Today</button>
        {days.map(d => (
          <button key={d.date} role="tab" aria-selected={date === d.date} className={date === d.date ? 'on' : ''} onClick={() => setDate(d.date)}
            title={`${d.date}: ${d.players} played${d.you ? `, you came #${d.you.rank}` : ''}`}>
            #{d.number}{d.you ? <span className="cd-day-dot" aria-label=" (played)" /> : null}
          </button>
        ))}
      </div>
      {shown ? (
        <>
          <p className="muted small cd-board-meta">
            {dailyTitle(shown.date)} · {shown.players} played · {shown.wins} won
          </p>
          <DailyBoard rows={shown.leaders} me={me} empty={date ? 'Nobody played that day.' : 'Nobody has finished today’s deal yet — be the first.'} />
        </>
      ) : <p className="muted small">Loading…</p>}
      <p className="muted small cd-help">{DAILY_RANKING_HELP}</p>
    </div>
  );
}

export default function DailyCard() {
  const nav = useNavigate();
  const { profile, config, openSignIn } = useAuth();
  const connected = useConnected();
  const { info, error } = useCardsDaily(null, profile?.id);
  const [busy, setBusy] = useState(false);
  // The result screen's Leaderboard button lands here with the board open.
  const [open, setOpen] = useState(() => location.hash === '#daily-board');
  const [, setNow] = useState(0);

  // The countdown to the next deal, kept roughly current.
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // Arriving from the hub's chip (/cards#daily): bring the card into view.
  useEffect(() => {
    if (info && location.hash.startsWith('#daily')) document.getElementById('daily')?.scrollIntoView({ block: 'start' });
  }, [!!info]);

  if (error && !info) return null;
  if (!info) return <section className="panel cd-daily cd-loading" id="daily" aria-busy="true" />;

  const you = info.you;
  const streak = you?.streaks.streak ?? 0;
  const play = async () => {
    if (!profile) return openSignIn();
    setBusy(true);
    try {
      const r = await playCardsDaily();
      nav(`/cards/r/${r.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const share = () => {
    if (!you?.result) return;
    void shareDaily(dailyShareText({ date: info.date, result: you.result, streak, rank: you.rank, of: info.players, url: shareUrl() }));
  };
  const bots = listNames(info.bots.map(b => b.name));

  return (
    <section className="panel cd-daily" id="daily" aria-labelledby="cd-title">
      <div className="cd-head">
        <CalendarTile date={info.date} />
        <div className="cd-titles">
          <h2 id="cd-title">Daily Challenge <span className="cd-num">#{info.number}</span></h2>
          <p className="muted small">Everyone gets the same cards today, at the {DAILY_TABLE.name} table. Beat {bots} in as few turns as you can: the fastest wins top the board. New deal in {untilNext(info.endsAt)}.</p>
        </div>
        {streak > 0 && (
          <span className="cd-streak" title={`${streak} day${streak === 1 ? '' : 's'} in a row (best ${you!.streaks.best})${you!.streaks.winStreak ? ` · ${you!.streaks.winStreak} won in a row` : ''}`}>
            🔥<b>{streak}</b><small>day{streak === 1 ? '' : 's'}</small>
          </span>
        )}
      </div>

      <div className="cd-status" role="status">
        {!profile ? (
          <p>One official try a day, then practise the deal as often as you like.</p>
        ) : you?.status === 'playing' ? (
          <p><b>Your attempt is under way.</b> Pick it up where you left it.</p>
        ) : you?.status === 'done' && you.result ? (
          <div className={`cd-result ${you.result.won ? 'won' : 'lost'}`}>
            <span className="cd-result-icon" aria-hidden>{you.result.won ? '🏆' : you.result.left ? '🚪' : '🃏'}</span>
            <span className="grow">
              <b>You {dailyOutcome(you.result)}</b>
              <span className="muted small cd-result-meta">
                {you.result.won ? `+${you.result.points} points` : `${you.result.cards} card${you.result.cards === 1 ? '' : 's'} left`}
                {you.rank ? ` · #${you.rank} of ${info.players}` : ''}
              </span>
            </span>
          </div>
        ) : (
          <p>You get <b>one try</b> a day, and leaving counts as a loss.</p>
        )}
      </div>

      <div className="cd-actions">
        {!profile ? (
          <button className="btn primary" onClick={openSignIn}>Sign in to play</button>
        ) : you?.status === 'playing' ? (
          <button className="btn primary" onClick={() => nav(`/cards/r/${you.code}`)}>▶ Back to your game</button>
        ) : you?.status === 'done' ? (
          <>
            <button className="btn primary" onClick={share}>📋 Share result</button>
            <button className="btn ghost" disabled={busy || !connected} onClick={play}>Practise the deal</button>
          </>
        ) : (
          <button className="btn primary" disabled={busy || !connected} onClick={play}>▶ Play today’s deal</button>
        )}
        {config.features.leaderboard && (
          <button className="btn ghost small cd-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? 'Hide leaderboard' : `🏅 Leaderboard${info.players ? ` (${info.players})` : ''}`}
          </button>
        )}
      </div>

      {config.features.leaderboard && (open
        ? <FullBoard info={info} me={profile?.id} />
        : info.leaders.length > 0 && <DailyBoard rows={info.leaders.slice(0, 5)} me={profile?.id} empty="" />)}
    </section>
  );
}
