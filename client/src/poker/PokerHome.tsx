// /poker: Chog Poker's home on this site, like /cards for Cards. Poker itself
// runs on its own site (pokerLink.ts), so this page is the way in: Play, the
// tournaments on now, coming up and just finished (read from poker's public
// /api/lobby and /api/leaderboard), join by code, and Host for those who may.
// Every link across carries the sign-in, the same as the header used to.
import { Suspense, lazy, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { GAMES } from '../../../shared/brand.ts';
import { goToPoker, openPoker, pokerHref, pokerTarget, POKER_BASE } from '../pokerLink.ts';
import './poker.css';

// The hub's per-game tutorial (components/HowToPlay.tsx with game="poker"),
// fetched when the "?" is pressed, as on the Cards home.
const HowToPlay = lazy(() => import('../components/HowToPlay.tsx'));

// What poker's /api/lobby and /api/leaderboard send (poker/shared/types.ts
// LobbyTournament and TournamentRecord), just the fields this page reads.
type TourneyState = 'registering' | 'running' | 'break' | 'paused' | 'finished' | 'cancelled';
interface LobbyTourney {
  id: string;
  name: string;
  state: TourneyState;
  players: number;
  maxPlayers: number | null;
  level: number;
  structure: string;
  hostName: string;
  playerHosted: boolean;
  scheduledStart: number | null;
  createdAt: number;
  topPlayers: { name: string; place: number | null }[];
}
interface FinishedRecord { id: string; name: string; finishedAt: number; entrants: number; results: { name: string; place: number }[] }

interface Finished { id: string; name: string; winner: string | null; entrants: number; at: number }
interface Lists { live: LobbyTourney[]; upcoming: LobbyTourney[]; finished: Finished[] }

const RECENT = 5;
const REFRESH_MS = 20_000;

const STEPS = [
  { icon: '🎟️', title: 'Register', body: 'Pick a tournament below and register. Everyone starts with the same stack, and it is free to play.' },
  { icon: '🃏', title: 'Take your seat', body: 'When it starts you are dealt in at a table. No-Limit Hold’em: two cards each, five in the middle, best hand of five wins.' },
  { icon: '🏆', title: 'Last stack standing', body: 'Blinds go up every level and tables merge as players bust. Keep chips to the end to take the title.' },
];

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${POKER_BASE}${path}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Poker answered ${r.status}`);
  return r.json() as Promise<T>;
}

/** Live, upcoming and just finished, from the lobby plus the stored results (which outlive a restart). */
async function loadLists(): Promise<Lists> {
  const [lobby, board] = await Promise.all([
    getJson<{ tournaments: LobbyTourney[] }>('/api/lobby'),
    getJson<{ recent?: FinishedRecord[] }>('/api/leaderboard').catch(() => ({ recent: [] as FinishedRecord[] })),
  ]);
  const list = lobby.tournaments ?? [];
  const live = list.filter(t => t.state === 'running' || t.state === 'break' || t.state === 'paused');
  // Soonest first; one with no start time waits for its host, so it goes after.
  const upcoming = list.filter(t => t.state === 'registering')
    .sort((a, b) => (a.scheduledStart ?? Infinity) - (b.scheduledStart ?? Infinity) || b.createdAt - a.createdAt);
  const records = new Map((board.recent ?? []).map(r => [r.id, r]));
  const finished: Finished[] = list.filter(t => t.state === 'finished').map(t => {
    const rec = records.get(t.id);
    return {
      id: t.id, name: t.name, entrants: rec?.entrants ?? t.players, at: rec?.finishedAt ?? t.createdAt,
      winner: t.topPlayers.find(p => p.place === 1)?.name ?? rec?.results.find(p => p.place === 1)?.name ?? null,
    };
  });
  for (const r of records.values()) {
    if (finished.some(f => f.id === r.id)) continue;
    finished.push({ id: r.id, name: r.name, entrants: r.entrants, at: r.finishedAt, winner: r.results.find(p => p.place === 1)?.name ?? null });
  }
  finished.sort((a, b) => b.at - a.at);
  return { live, upcoming, finished: finished.slice(0, RECENT) };
}

const fieldLabel = (t: Pick<LobbyTourney, 'players' | 'maxPlayers'>) =>
  t.maxPlayers ? `${t.players} / ${t.maxPlayers} registered` : `${t.players} registered`;

function startLabel(ts: number | null): string {
  if (!ts) return 'Starts when the host is ready';
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** One tournament: the whole row opens it on poker, signed in. */
function Row({ id, signedIn, badge, badgeClass, name, meta, cta }: {
  id: string; signedIn: boolean; badge: string; badgeClass: string; name: string; meta: string; cta: string;
}) {
  const path = `/t/${id}`;
  return (
    <li>
      <a className="ph-row" href={pokerHref(path)} onClick={e => openPoker(e, signedIn, path)}>
        <span className="ph-row-main">
          <b className="ph-row-name">{name}</b>
          <span className="ph-row-meta">{meta}</span>
        </span>
        <span className={`ph-badge ${badgeClass}`}>{badge}</span>
        <span className="btn small ph-row-cta" aria-hidden>{cta}</span>
      </a>
    </li>
  );
}

export default function PokerHome() {
  const { profile, canHost, openSignIn } = useAuth();
  const signedIn = !!profile;
  const mayHost = !!profile && (canHost || profile.isAdmin);
  const [lists, setLists] = useState<Lists | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const [howTo, setHowTo] = useState(false);

  useEffect(() => { document.title = `${GAMES.poker.name} · Chog Games`; }, []);
  useEffect(() => {
    let live = true;
    const load = () => loadLists()
      .then(l => { if (live) { setLists(l); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const onShow = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, []);

  const join = (raw: string) => {
    const target = pokerTarget(raw);
    if (!target) return toastError(new Error('Enter a tournament code or link'));
    goToPoker(target, signedIn);
  };

  const empty = !!lists && lists.live.length + lists.upcoming.length + lists.finished.length === 0;

  return (
    <div className="poker-home">
      <div className="ph-bg" aria-hidden>
        {['♠', '♥', '♦', '♣', '♠', '♥'].map((s, i) => <span key={i} className={`ph-suit s${i}`}>{s}</span>)}
      </div>

      <section className="ph-hero">
        <div className="ph-fan" aria-hidden>
          {[['A', '♠'], ['K', '♥'], ['Q', '♦'], ['J', '♣'], ['10', '♠']].map(([r, s], i) => (
            <span key={r} className={`ph-card ${s === '♥' || s === '♦' ? 'red' : ''}`}
              style={{ transform: `rotate(${(i - 2) * 10}deg) translateY(${Math.abs(i - 2) * 8}px)` }}>
              <b>{r}</b><i>{s}</i>
            </span>
          ))}
        </div>
        <div className="ph-title">
          <h1>{GAMES.poker.name}</h1>
          <button type="button" className="hub-help ph-help" onClick={() => setHowTo(true)} aria-label={`How to play ${GAMES.poker.name}`} title={`How to play ${GAMES.poker.name}`}>?</button>
        </div>
        <p className="ph-tag">No-Limit Hold’em tournaments for the whole Chog crew. Free to play, one sign-in.</p>
        <div className="ph-actions">
          <a className="btn primary hub-play ph-play" href={pokerHref('/')} onClick={e => openPoker(e, signedIn)}>Play {GAMES.poker.name}</a>
          <form className="hub-join ph-join" onSubmit={e => { e.preventDefault(); join(code); }}>
            <input className="code-input" value={code} placeholder="CODE" aria-label="Poker tournament code or link"
              autoCapitalize="none" autoComplete="off" spellCheck={false} onChange={e => setCode(e.target.value)} />
            <button className="btn gold small" type="submit">Join</button>
          </form>
        </div>
        <p className="ph-sub muted small">
          {mayHost ? (
            <a className="ph-host" href={pokerHref('/?host=1')} onClick={e => openPoker(e, signedIn, '/?host=1')}>🏆 Host a tournament</a>
          ) : !profile ? (
            <><button type="button" className="ph-link" onClick={openSignIn}>Sign in</button> here and you stay signed in at the tables.</>
          ) : (
            <>Chog holders can host their own. <Link to="/wallet">Link a wallet</Link></>
          )}
        </p>
      </section>

      <div className="ph-body">
        {failed && !lists && <p className="panel ph-note" role="status">Couldn’t reach {GAMES.poker.name} just now. Play still takes you there.</p>}
        {!lists && !failed && <p className="ph-note muted" role="status">Loading tournaments…</p>}
        {empty && <p className="panel ph-note" role="status">No tournaments right now. Check back soon{mayHost ? ', or host one' : ''}!</p>}

        {lists && lists.live.length > 0 && (
          <section className="panel ph-list" aria-labelledby="ph-live">
            <h2 id="ph-live"><span className="ph-dot" aria-hidden /> Live now</h2>
            <ul>
              {lists.live.map(t => (
                <Row key={t.id} id={t.id} signedIn={signedIn} name={t.name}
                  badge={t.state === 'running' ? `Level ${t.level}` : t.state === 'break' ? 'On break' : 'Paused'}
                  badgeClass="live" cta="Watch"
                  meta={`${t.players} player${t.players === 1 ? '' : 's'}${t.playerHosted ? ` · hosted by ${t.hostName}` : ''}`} />
              ))}
            </ul>
          </section>
        )}

        {lists && lists.upcoming.length > 0 && (
          <section className="panel ph-list" aria-labelledby="ph-next">
            <h2 id="ph-next">Upcoming</h2>
            <ul>
              {lists.upcoming.map(t => (
                <Row key={t.id} id={t.id} signedIn={signedIn} name={t.name}
                  badge={t.scheduledStart ? startLabel(t.scheduledStart) : 'Soon'} badgeClass="soon" cta="Register"
                  meta={`${fieldLabel(t)}${t.scheduledStart ? '' : ` · ${startLabel(null)}`}${t.playerHosted ? ` · hosted by ${t.hostName}` : ''}`} />
              ))}
            </ul>
          </section>
        )}

        {lists && lists.finished.length > 0 && (
          <section className="panel ph-list" aria-labelledby="ph-done">
            <h2 id="ph-done">Recently finished</h2>
            <ul>
              {lists.finished.map(f => (
                <Row key={f.id} id={f.id} signedIn={signedIn} name={f.name}
                  badge={f.winner ? `🏆 ${f.winner}` : 'Finished'} badgeClass="done" cta="Results"
                  meta={`${f.entrants} player${f.entrants === 1 ? '' : 's'}${f.winner ? ` · won by ${f.winner}` : ''}`} />
              ))}
            </ul>
          </section>
        )}

        <section className="panel" aria-labelledby="ph-how">
          <h2 id="ph-how">How it works</h2>
          <ol className="how-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="how-icon" aria-hidden>{s.icon}</span>
                <b><span className="how-n">{i + 1}</span>{s.title}</b>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <p className="ph-foot muted small"><Link to="/">← All games</Link> · <Link to="/leaderboard">Leaderboard</Link></p>
      </div>
      {howTo && createPortal(<Suspense fallback={null}><HowToPlay game="poker" onClose={() => setHowTo(false)} /></Suspense>, document.body)}
    </div>
  );
}
