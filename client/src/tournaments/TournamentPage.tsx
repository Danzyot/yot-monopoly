// /tournaments/:id: one event, live. Registration, the rounds as a bracket
// (each table with its players, places and who goes through; click to watch,
// or to sit at your own), host controls, and the final standings.
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { getSocket } from '../net.ts';
import { toast, toastError } from '../toast.tsx';
import { askConfirm, askText } from '../components/Modal.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ProfileLink } from '../community.tsx';
import { BRAND } from '../../../shared/brand.ts';
import {
  PRIZE_NOTE, TOURNEY_PRIZE_MAX, tableUrl,
  type TournamentRoundView, type TournamentSeated, type TournamentTableView, type TournamentView,
} from '../../../shared/tournaments.ts';
import { register, tourneyCall, useTournament } from './net.ts';
import { GAME_ICON, MEDALS, StatusChip, countdown, fmtWhen, gameName, ordinal, useNow } from './bits.tsx';
import './tournaments.css';

const TABLE_STATUS: Record<TournamentTableView['status'], string> = {
  pending: 'Opening…', waiting: 'Taking seats', playing: 'Playing', done: 'Done',
};

function TableCard({ v, round, table, me, now }: { v: TournamentView; round: TournamentRoundView; table: TournamentTableView; me: string; now: number }) {
  const mine = table.players.some(p => p.id === me);
  const live = table.status === 'waiting' || table.status === 'playing';
  const ordered = table.status === 'done' ? [...table.players].sort((a, b) => (a.finish ?? 99) - (b.finish ?? 99)) : table.players;
  return (
    <div className={`tn-table ${table.status}${mine ? ' mine' : ''}`}>
      <div className="tn-table-head">
        <b>{round.final ? 'Final table' : `Table ${table.id.split('t')[1]}`}</b>
        <span className={`tn-tstatus ${table.status}`}>{TABLE_STATUS[table.status]}</span>
        {table.code && <span className="mono small muted">{table.code}</span>}
      </div>
      <ol className="tn-seats">
        {ordered.map(p => (
          <li key={p.id} className={`${p.through ? 'through' : ''}${p.noShow ? ' noshow' : ''}${p.id === me ? ' me' : ''}`}>
            <span className="tn-finish">{p.finish ? (round.final && p.finish <= 3 ? MEDALS[p.finish - 1] : ordinal(p.finish)) : table.status === 'waiting' ? (p.arrived ? '✓' : '…') : ''}</span>
            <Avatar src={p.avatar} size={20} />
            <ProfileLink id={p.id} className="tn-pname">{p.name}</ProfileLink>
            {p.noShow && <em className="tag warn">no-show</em>}
            {p.through && <em className="tag tn-through">through</em>}
          </li>
        ))}
      </ol>
      <div className="tn-table-foot small muted">
        {table.status === 'waiting' && table.startsBy && <span>Starts in {countdown(table.startsBy - now)} (or when all are here)</span>}
        {table.status === 'playing' && table.endsAt && !v.paused && <span>⏱ {countdown(table.endsAt - now)} left</span>}
        {table.status === 'done' && (table.walkover ? <span>Decided without a game</span> : table.byTime ? <span>Ended on time</span> : <span>Played out</span>)}
      </div>
      {table.code && (live || table.status === 'done') && (
        <Link className={`btn small ${mine && live ? 'primary' : ''} tn-table-go`} to={`${tableUrl(table.code)}${mine && live ? '' : '?watch=1'}`}>
          {mine && live ? 'Go to your table' : live ? 'Watch' : 'See the table'}
        </Link>
      )}
    </div>
  );
}

function Bracket({ v, me, now }: { v: TournamentView; me: string; now: number }) {
  if (!v.rounds.length) return null;
  return (
    <section className="panel tn-bracket-panel" aria-labelledby="tn-rounds">
      <h2 id="tn-rounds">Rounds</h2>
      <div className="tn-bracket">
        {v.rounds.map(r => (
          <div key={r.n} className={`tn-round${r.final ? ' final' : ''}`}>
            <h3>{r.final ? '🏆 Final' : `Round ${r.n}`}
              <span className="muted small"> · {r.final ? 'winner takes it' : r.advance === 1 ? 'winners go through' : `top ${r.advance} go through`}</span>
            </h3>
            {r.tables.map(t => <TableCard key={t.id} v={v} round={r} table={t} me={me} now={now} />)}
            {r.byes.length > 0 && (
              <div className="tn-byes small"><b>Byes:</b> {r.byes.map(b => b.name).join(', ')} <span className="muted">(straight through)</span></div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Standings({ v }: { v: TournamentView }) {
  if (v.status !== 'finished' || !v.places.length) return null;
  const podium = [v.places[1], v.places[0], v.places[2]].map((p, k) => ({ p, place: [2, 1, 3][k] }));
  return (
    <section className="panel tn-standings" aria-labelledby="tn-standings">
      <h2 id="tn-standings">Final standings</h2>
      <ol className="podium lb-podium tn-podium" aria-label="Podium">
        {podium.map(({ p, place }) => p ? (
          <li key={p.id} className={`podium-spot p${place}`} style={{ ['--pc' as string]: `var(--medal-${place})` }}>
            <span className="podium-char lb-podium-char"><Avatar src={p.avatar} size={place === 1 ? 56 : 44} /></span>
            <span className="podium-name">{p.name}</span>
            <span className="podium-block"><span className="podium-medal" aria-hidden>{MEDALS[place - 1]}</span><span className="podium-place">{ordinal(place)}</span></span>
          </li>
        ) : <li key={`empty-${place}`} className={`podium-spot p${place} empty`} aria-hidden />)}
      </ol>
      <ol className="tn-places">
        {v.places.map(p => (
          <li key={p.id}>
            <span className="tn-place">{MEDALS[p.place - 1] ?? ordinal(p.place)}</span>
            <Avatar src={p.avatar} size={22} />
            <ProfileLink id={p.id}>{p.name}</ProfileLink>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function TournamentPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { profile, openSignIn } = useAuth();
  const { view: v, error, skew } = useTournament(id);
  const now = useNow(skew);
  const me = profile?.id ?? '';

  useEffect(() => {
    document.title = v ? `${v.name} · ${BRAND.name}` : `Tournament · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, [v?.name]);

  // Seated while watching this page: straight to the table.
  useEffect(() => {
    const s = getSocket();
    const onSeated = (m: TournamentSeated) => {
      if (m.id !== id) return;
      toast(`Round ${m.round}: your table is ready — taking you there.`);
      nav(tableUrl(m.code));
    };
    s.on('tourney:seated', onSeated);
    return () => { s.off('tourney:seated', onSeated); };
  }, [id, nav]);

  if (error && !v) {
    return <div className="page tn-page"><section className="panel tn-empty"><p>{error}</p><Link className="btn primary" to="/tournaments">All tournaments</Link></section></div>;
  }
  if (!v) {
    return (
      <div className="page lb-skeleton" aria-busy="true" aria-label="Loading the tournament">
        <div className="sk sk-hero" /><div className="sk sk-row" /><div className="sk sk-row" /><div className="sk sk-row" />
      </div>
    );
  }

  const isHost = me === v.hostId;
  const isAdmin = !!profile?.isAdmin;
  const canRun = isHost || isAdmin;
  const live = v.status === 'registering' || v.status === 'running';
  const entrant = v.entrants.find(e => e.id === me);
  const round = v.rounds.at(-1);
  const myTable = v.status === 'running' && round?.tables.find(t => t.players.some(p => p.id === me) && t.status !== 'done' && t.code);
  const act = (ev: string, extra: Record<string, unknown> = {}) => tourneyCall(ev, { id, ...extra }).catch(toastError);

  const cancel = async () => {
    const reason = await askText({ title: 'Cancel the tournament?', body: 'Tables still playing stop, and nobody is placed. This cannot be undone.', placeholder: 'Reason (optional)', confirm: 'Cancel tournament', maxLength: 140 });
    if (reason === null) return;
    void act('tourney:cancel', { reason });
  };
  const editPrize = async () => {
    const prize = await askText({ title: 'Prize', body: PRIZE_NOTE, initial: v.prize, placeholder: 'What the champion wins', confirm: 'Save', maxLength: TOURNEY_PRIZE_MAX });
    if (prize !== null) void act('tourney:prize', { prize });
  };
  const removePlayer = async (pid: string, name: string) => {
    if (await askConfirm({ title: `Remove ${name}?`, body: 'Off the list before the start; out of the event (and their table) once it runs.', confirm: 'Remove', danger: true })) {
      void act('tourney:remove', { playerId: pid });
    }
  };

  const s = v.settings;
  const full = s.maxPlayers !== null && v.entrants.length >= s.maxPlayers;
  const facts = [
    s.maxPlayers ? `${s.maxPlayers} players max` : 'no player cap',
    `tables of up to ${s.tableSize}`,
    s.advance === 1 ? 'winners go through' : `top ${s.advance} go through`,
    `${s.roundMinutes}-minute rounds`,
    s.cardsMatch === 'single' ? 'one round per table' : `first to ${s.cardsTarget}`,
    s.noShow === 'drop' ? `${s.noShowMinutes} min to sit down` : `no-shows auto-played after ${s.noShowMinutes} min`,
    ...(s.botsFill ? ['bots fill empty seats'] : []),
  ];

  return (
    <div className="page tn-page">
      <p className="small"><Link to="/tournaments">← Tournaments</Link></p>
      <section className="panel tn-hero">
        <span className="tn-hero-icon" aria-hidden>{GAME_ICON[v.game]}</span>
        <div className="tn-hero-main">
          <div className="tn-card-top">
            <h1 className="tn-title">{v.name}</h1>
            <StatusChip status={v.status} paused={!!v.paused} />
          </div>
          <p className="muted">{gameName(v.game)} · hosted by <ProfileLink id={v.hostId}>{v.hostName}</ProfileLink> · {v.entrants.length} {v.entrants.length === 1 ? 'player' : 'players'}</p>
          <p className="small muted tn-facts">{facts.join(' · ')}</p>
          {(v.prize || isHost) && (
            <div className="tn-prize-box">
              <span aria-hidden>🎁</span>
              <div>
                <b>{v.prize || 'No prize set'}</b>
                {canRun && live && <button className="btn tiny ghost" onClick={editPrize}>Edit</button>}
                {v.prize && <p className="small muted">{PRIZE_NOTE}</p>}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Where things stand, and the one thing this viewer can do about it. */}
      <section className="panel tn-now">
        {v.status === 'registering' && (
          <>
            <p className="tn-now-line">
              {s.startAt ? <>Starts <b>{fmtWhen(s.startAt)}</b> · in <b>{countdown(s.startAt - now)}</b></> : 'Starts when the host is ready.'}
              {' '}{v.entrants.length}{s.maxPlayers ? `/${s.maxPlayers}` : ''} registered, {s.minPlayers} needed.
            </p>
            {!profile ? <button className="btn primary" onClick={openSignIn}>Sign in to register</button>
              : entrant ? <button className="btn" onClick={() => act('tourney:unregister')}>Withdraw</button>
              : <button className="btn primary" disabled={full} onClick={() => register(id).catch(toastError)}>
                  {full ? 'Full' : 'Register'}
                </button>}
            {entrant && <p className="small muted">You’re in. Keep this page open: when your table is ready you’ll be taken there.</p>}
          </>
        )}
        {v.status === 'running' && (
          <>
            {v.paused && <p className="tn-now-line warn">⏸ Paused by {v.paused.by}. Tables are on hold.</p>}
            {!v.paused && v.nextRoundAt && <p className="tn-now-line">Round {round?.n} is over. Next round seats in <b>{countdown(v.nextRoundAt - now)}</b>.</p>}
            {!v.paused && !v.nextRoundAt && round && <p className="tn-now-line">{round.final ? 'The final is on.' : `Round ${round.n} is on.`}</p>}
            {myTable && (
              <Link className="btn primary chunky tn-mytable" to={tableUrl(myTable.code!)}>
                Go to your table · <span className="mono">{myTable.code}</span>
              </Link>
            )}
            {entrant && !myTable && <p className="small muted">{entrant.state === 'out' ? 'You’re out — thanks for playing! Watch the rest below.' : entrant.state === 'through' ? 'You’re through. Keep this page open for your next table.' : ''}</p>}
          </>
        )}
        {v.status === 'finished' && v.places[0] && <p className="tn-now-line">🏆 <b>{v.places[0].name}</b> is the champion{v.finishedAt ? ` · ${fmtWhen(v.finishedAt)}` : ''}.</p>}
        {v.status === 'cancelled' && <p className="tn-now-line warn">Cancelled{v.cancelReason ? `: ${v.cancelReason}` : ''}.</p>}
      </section>

      {canRun && live && (
        <section className="panel tn-controls" aria-label="Host controls">
          <b>{isHost ? 'Host controls' : 'Operator controls'}</b>
          {v.status === 'registering' && (
            <button className="btn primary" disabled={v.entrants.length < s.minPlayers} onClick={() => act('tourney:start')}
              title={v.entrants.length < s.minPlayers ? `Needs ${s.minPlayers} players` : undefined}>Start now</button>
          )}
          {v.status === 'running' && (v.paused
            ? <button className="btn primary" onClick={() => act('tourney:resume')}>Resume</button>
            : <button className="btn" onClick={() => act('tourney:pause')}>Pause</button>)}
          <button className="btn danger" onClick={cancel}>Cancel tournament</button>
        </section>
      )}

      <Standings v={v} />
      <Bracket v={v} me={me} now={now} />

      <section className="panel tn-entrants" aria-labelledby="tn-entrants">
        <h2 id="tn-entrants">Players <span className="lb-count">{v.entrants.length}</span></h2>
        {!v.entrants.length && <p className="muted">Nobody has registered yet.</p>}
        <ul className="tn-entrant-list">
          {v.entrants.map(e => (
            <li key={e.id} className={`tn-entrant ${e.state}${e.id === me ? ' me' : ''}`}>
              <Avatar src={e.avatar} size={22} />
              <ProfileLink id={e.id}>{e.name}</ProfileLink>
              {e.place ? <span className="small muted">{ordinal(e.place)}</span> : v.status === 'running' && <span className={`small tn-state ${e.state}`}>{e.state}</span>}
              {isAdmin && live && e.id !== me && <button className="btn tiny ghost" aria-label={`Remove ${e.name}`} onClick={() => removePlayer(e.id, e.name)}>✕</button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
