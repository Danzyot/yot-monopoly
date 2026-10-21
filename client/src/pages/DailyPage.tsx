// /daily: today's three dailies on one page (Monopoly, Cards, Poker): each
// one's status for you, Play, your streak and the day's top three, plus the
// days in a row you played every daily there is. Each game's own endpoint
// (GET /api/<game>/daily) answers in the same shape; one that is not there yet
// shows as coming soon.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ProfileLink } from '../community.tsx';
import { GAMES } from '../../../shared/brand.ts';
import { dailyDate, dailyNumber, dayStreak, nextDailyAt } from '../../../shared/daily.ts';
import { dailyOutcome, type CardsDailyInfo, type CardsDailyRow } from '../../../shared/cards/daily.ts';
import { formatTime, type PokerDailyInfo, type PokerDailyRow } from '../../../shared/poker/daily.ts';
import { dailyMoney, monopolyDailyOutcome, type MonopolyDailyInfo, type MonopolyDailyRow } from '../../../shared/monopolyDaily.ts';
import { untilNext } from '../cards/daily.ts';
import '../styles/daily-page.css';

type Game = 'monopoly' | 'cards' | 'poker';
/** What every game's GET /api/<game>/daily has in common (the Cards one's shape). */
interface AnyInfo {
  date: string;
  number: number;
  players: number;
  leaders: { id: string; name: string; rank: number }[];
  you?: { status: 'none' | 'playing' | 'done'; streaks: { streak: number; best: number }; rank?: number; result?: unknown };
}
type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ok'; info: AnyInfo };

const TILES: { game: Game; icon: string; play: string; blurb: string }[] = [
  { game: 'monopoly', icon: '🎩', play: '/monopoly#daily', blurb: 'Same game for everyone today. Beat 3 bots — or finish richest after 20 turns.' },
  { game: 'cards', icon: '🃏', play: '/cards#daily', blurb: 'One deal, the same for everyone today. Go out in as few turns as you can.' },
  { game: 'poker', icon: '♠️', play: '/poker/daily', blurb: '10 poker hands, the same for everyone today. Pick the best move in each.' },
];

/** A leaderboard row in a few words, whichever game it is from. */
function rowResult(game: Game, row: AnyInfo['leaders'][number]): string {
  if (game === 'poker') {
    const r = row as PokerDailyRow;
    return `${r.points}/100 · ${formatTime(r.timeMs)}`;
  }
  if (game === 'monopoly') {
    const m = row as MonopolyDailyRow;
    return m.won ? `won · ${m.turns} turns` : m.left ? 'walked out' : m.bankrupt ? `broke on turn ${m.turns}` : dailyMoney(m.netWorth);
  }
  const r = row as CardsDailyRow;
  if (typeof r.won === 'boolean') return r.won ? `won · ${r.turns} turns` : r.left ? 'walked out' : 'lost';
  return '';
}

/** Your result today, in a few words. */
function yourResult(game: Game, info: AnyInfo): string {
  const you = info.you;
  if (!you || you.status === 'none') return 'Not played yet';
  if (you.status === 'playing') return 'Under way';
  const rank = you.rank ? ` · #${you.rank} of ${info.players}` : '';
  if (game === 'poker') {
    const r = (info as unknown as PokerDailyInfo).you?.result;
    return r ? `${r.points}/100${rank}` : `Done${rank}`;
  }
  if (game === 'monopoly') {
    const m = (info as unknown as MonopolyDailyInfo).you?.result;
    return m ? `You ${monopolyDailyOutcome(m)}${rank}` : `Done${rank}`;
  }
  const r = (info as unknown as CardsDailyInfo).you?.result;
  return r && typeof r.won === 'boolean' ? `You ${dailyOutcome(r)}${rank}` : `Done${rank}`;
}

function useDaily(game: Game, key: unknown): Load {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    api<AnyInfo>(`/api/${game}/daily`)
      .then(info => { if (live) setLoad(info && typeof info.number === 'number' ? { state: 'ok', info } : { state: 'missing' }); })
      .catch(() => { if (live) setLoad({ state: 'missing' }); });
    return () => { live = false; };
  }, [game, key]);
  return load;
}

/** The days you played each game's daily (finished ones from the history, plus today). */
function useComboStreak(loads: Record<Game, Load>, signedIn: boolean, key: unknown): number | null {
  const live = (Object.keys(loads) as Game[]).filter(g => loads[g].state === 'ok');
  const ready = signedIn && live.length >= 2 && (Object.values(loads) as Load[]).every(l => l.state !== 'loading');
  const [streak, setStreak] = useState<number | null>(null);
  const liveKey = live.join(',');
  useEffect(() => {
    if (!ready) { setStreak(null); return; }
    let alive = true;
    const today = dailyDate();
    Promise.all(live.map(async g => {
      const days = new Set<string>();
      const info = (loads[g] as { info: AnyInfo }).info;
      if (info.you && info.you.status !== 'none') days.add(today);
      const h = await api<{ days: { date: string; you?: unknown }[] }>(`/api/${g}/daily/history?days=60`).catch(() => ({ days: [] }));
      for (const d of h.days) if (d.you) days.add(d.date);
      return days;
    })).then(sets => {
      if (!alive) return;
      const every = [...sets[0]].filter(d => sets.every(s => s.has(d)));
      setStreak(dayStreak(every, today).current);
    });
    return () => { alive = false; };
  }, [ready, liveKey, key]);
  return streak;
}

function Tile({ game, icon, play, blurb, load, me }: { game: Game; icon: string; play: string; blurb: string; load: Load; me?: string }) {
  const name = GAMES[game].name;
  if (load.state === 'loading') return <li className={`dl-tile dl-${game} loading`} aria-busy="true" />;
  if (load.state === 'missing') {
    return (
      <li className={`dl-tile dl-${game} soon`}>
        <div className="dl-tile-head"><span className="dl-icon" aria-hidden>{icon}</span><h2>{name}</h2></div>
        <p className="dl-blurb">{blurb}</p>
        <p className="dl-status muted">Coming soon</p>
      </li>
    );
  }
  const { info } = load;
  const you = info.you;
  const done = you?.status === 'done';
  const streak = you?.streaks.streak ?? 0;
  return (
    <li className={`dl-tile dl-${game}${done ? ' done' : ''}`}>
      <div className="dl-tile-head">
        <span className="dl-icon" aria-hidden>{icon}</span>
        <h2>{name}</h2>
        {streak > 0 && <span className="dl-streak" title={`${streak} day${streak === 1 ? '' : 's'} in a row`}>🔥{streak}</span>}
      </div>
      <p className="dl-blurb">{blurb}</p>
      <p className={`dl-status${done ? ' done' : ''}`}>{done ? '✅ ' : ''}{yourResult(game, info)}</p>
      <Link className={`btn ${done ? 'ghost' : 'primary'} dl-play`} to={play}>{done ? 'See result' : you?.status === 'playing' ? '▶ Carry on' : '▶ Play'}</Link>
      <div className="dl-top">
        <h3>Top 3 today <span className="muted">· {info.players} played</span></h3>
        {info.leaders.length ? (
          <ol>
            {info.leaders.slice(0, 3).map(r => (
              <li key={r.id} className={r.id === me ? 'me' : ''}>
                <span className="dl-rank">{r.rank}</span>
                <ProfileLink id={r.id} className="dl-name">{r.name}</ProfileLink>
                <span className="dl-res">{rowResult(game, r)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="muted small">Nobody yet. Be the first.</p>}
      </div>
    </li>
  );
}

export default function DailyPage() {
  const { profile, openSignIn } = useAuth();
  const key = profile?.id;
  const loads: Record<Game, Load> = { monopoly: useDaily('monopoly', key), cards: useDaily('cards', key), poker: useDaily('poker', key) };
  const combo = useComboStreak(loads, !!profile, key);
  const live = TILES.filter(t => loads[t.game].state === 'ok');
  const playedAll = live.length > 0 && live.every(t => { const l = loads[t.game]; return l.state === 'ok' && l.info.you && l.info.you.status !== 'none'; });
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  let note: ReactNode = null;
  if (!profile) note = <><button type="button" className="dl-link" onClick={openSignIn}>Sign in</button> to play and keep a streak.</>;
  else if (playedAll) note = <>All done for today. Come back tomorrow{combo ? ' to keep your streak going' : ''}.</>;

  return (
    <div className="page daily-page">
      <header className="dl-head">
        <p className="dl-kicker">Daily #{dailyNumber(dailyDate())}</p>
        <h1>Today’s dailies</h1>
        <p className="dl-lede">One puzzle for each game. The same for everyone today, and you get one try at each.</p>
        <p className="muted small">New ones in {untilNext(nextDailyAt())}.</p>
        {combo !== null && combo > 0 && (
          <p className="dl-combo" title="Days in a row you played every daily">🔥 {combo} day{combo === 1 ? '' : 's'} in a row with every daily</p>
        )}
        {note && <p className="dl-note small">{note}</p>}
      </header>
      <ul className="dl-tiles">
        {TILES.map(t => <Tile key={t.game} {...t} load={loads[t.game]} me={profile?.id} />)}
      </ul>
    </div>
  );
}
