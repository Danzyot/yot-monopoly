// /tournaments/new: a host sets up an event. Everything is checked again on
// the server (manager.ts); this form only offers what the host's limits allow.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { MAPS } from '../../../shared/maps.ts';
import {
  PRIZE_DISCLAIMER, TOURNEY_CARDS_TARGETS, TOURNEY_GAMES, TOURNEY_MIN_PLAYERS, TOURNEY_NAME_MAX, TOURNEY_NO_SHOW_MINUTES,
  TOURNEY_PRIZE_MAX, TOURNEY_ROUND_MINUTES, TOURNEY_TABLE_RANGE, defaultTournamentSettings, tournamentUrl,
  type TournamentGame, type TournamentSettings,
} from '../../../shared/tournaments.ts';
import { tourneyCall, useTournamentList } from './net.ts';
import { GAME_ICON, gameName } from './bits.tsx';
import './tournaments.css';

/** datetime-local wants the time written in the viewer's own zone. */
function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateTournament() {
  const { profile, openSignIn } = useAuth();
  const nav = useNavigate();
  const first = useSearchParams()[0].get('game') === 'cards' ? 'cards' : 'monopoly';
  const { me } = useTournamentList();
  const [game, setGame] = useState<TournamentGame>(first);
  const [name, setName] = useState('');
  const [prize, setPrize] = useState('');
  const [s, setS] = useState<TournamentSettings>(() => defaultTournamentSettings(first));
  const [scheduled, setScheduled] = useState(false);
  const [startAt, setStartAt] = useState(() => toLocalInput(Date.now() + 60 * 60_000));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `Host a tournament · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);

  const lim = me?.limits;
  const pickGame = (g: TournamentGame) => {
    setGame(g);
    setS(defaultTournamentSettings(g));
  };
  const set = <K extends keyof TournamentSettings>(k: K, v: TournamentSettings[K]) => setS(x => ({ ...x, [k]: v }));
  const maxCap = lim ? lim.maxPlayers[game] : 24;
  const mapMax = game === 'monopoly' ? (MAPS.find(m => m.id === s.mapId)?.players[1] ?? 6) : 99;
  const tableSizes = useMemo(() => {
    const [lo, hi] = TOURNEY_TABLE_RANGE[game];
    return Array.from({ length: Math.min(hi, mapMax) - lo + 1 }, (_, i) => lo + i);
  }, [game, mapMax]);
  const rounds = TOURNEY_ROUND_MINUTES[game].filter(m => !lim || m <= lim.roundMinutesMax[game]);
  const roundsGuess = estimateRounds(s.maxPlayers, s.tableSize, s.advance);

  if (!profile) {
    return (
      <div className="page tn-page"><section className="panel tn-empty">
        <h1>Host a tournament</h1>
        <p className="muted">Sign in first.</p>
        <button className="btn primary" onClick={openSignIn}>Sign in</button>
      </section></div>
    );
  }
  if (me && !me.canHost) {
    return (
      <div className="page tn-page"><section className="panel tn-empty">
        <h1>Host a tournament</h1>
        <p className="muted">Hosting is for Chog Genesis holders and approved hosts. Hold a Chog? Link the wallet it is in and come back.</p>
        <div className="row center wrap"><Link className="btn primary" to="/wallet">Link a wallet</Link><Link className="btn" to="/tournaments">See tournaments</Link></div>
      </section></div>
    );
  }
  if (me && me.hosting.length >= me.limits.live) {
    return (
      <div className="page tn-page"><section className="panel tn-empty">
        <h1>Host a tournament</h1>
        <p className="muted">You already have a tournament on. Finish or cancel it before you set up another.</p>
        <Link className="btn primary" to={tournamentUrl(me.hosting[0])}>Go to your tournament</Link>
      </section></div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const settings = { ...s, startAt: scheduled ? new Date(startAt).getTime() : null };
      if (game !== 'monopoly') delete (settings as Partial<TournamentSettings>).mapId;
      const r = await tourneyCall<{ id: string }>('tourney:create', { game, name, prize, settings });
      nav(tournamentUrl(r.id));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page tn-page">
      <p className="small"><Link to="/tournaments">← Tournaments</Link></p>
      <form className="panel tn-form" onSubmit={submit}>
        <h1 className="lb-title"><span aria-hidden>🏟️</span> Host a tournament</h1>

        <div className="tabs tn-tabs" role="radiogroup" aria-label="Game">
          {TOURNEY_GAMES.map(g => (
            <button key={g} type="button" role="radio" aria-checked={game === g} className={game === g ? 'on' : ''} onClick={() => pickGame(g)}>
              <span aria-hidden>{GAME_ICON[g]}</span> {gameName(g)}
            </button>
          ))}
        </div>

        <div className="tn-grid">
          <label className="field tn-wide"><span>Name</span>
            <input required maxLength={TOURNEY_NAME_MAX} value={name} placeholder={`Friday ${gameName(game)} Cup`} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field tn-wide"><span>Prize (optional)</span>
            <input maxLength={TOURNEY_PRIZE_MAX} value={prize} placeholder="e.g. a Chog plushie for the champion" onChange={e => setPrize(e.target.value)} />
            <small className="tn-warn">{PRIZE_DISCLAIMER}</small>
          </label>

          <label className="field"><span>Most players (up to {maxCap})</span>
            <input type="number" min={TOURNEY_MIN_PLAYERS} max={maxCap} value={s.maxPlayers}
              onChange={e => set('maxPlayers', Number(e.target.value))} />
          </label>
          <label className="field"><span>Fewest to start</span>
            <input type="number" min={TOURNEY_MIN_PLAYERS} max={s.maxPlayers} value={s.minPlayers}
              onChange={e => set('minPlayers', Number(e.target.value))} />
          </label>
          {game === 'monopoly' && (
            <label className="field"><span>Board</span>
              <select value={s.mapId} onChange={e => {
                const most = MAPS.find(m => m.id === e.target.value)?.players[1] ?? 6;
                setS(x => ({ ...x, mapId: e.target.value, tableSize: Math.min(x.tableSize, most) }));
              }}>
                {MAPS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          {game === 'cards' && (
            <label className="field"><span>Each table plays</span>
              <select value={s.cardsMatch === 'single' ? 'single' : String(s.cardsTarget)} onChange={e => {
                const v = e.target.value;
                setS(x => (v === 'single' ? { ...x, cardsMatch: 'single' } : { ...x, cardsMatch: 'points', cardsTarget: Number(v) }));
              }}>
                <option value="single">One round</option>
                {TOURNEY_CARDS_TARGETS.map(n => <option key={n} value={n}>First to {n} points</option>)}
              </select>
            </label>
          )}
          <label className="field"><span>Players per table</span>
            <select value={s.tableSize} onChange={e => set('tableSize', Number(e.target.value))}>
              {tableSizes.map(n => <option key={n} value={n}>Up to {n}</option>)}
            </select>
          </label>
          <label className="field"><span>Going through from each table</span>
            <select value={s.advance} onChange={e => set('advance', Number(e.target.value) as 1 | 2)}>
              <option value={1}>The winner</option>
              <option value={2}>The top two</option>
            </select>
          </label>
          <label className="field"><span>Round time limit</span>
            <select value={s.roundMinutes} onChange={e => set('roundMinutes', Number(e.target.value))}>
              {rounds.map(m => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <small className="muted">{game === 'monopoly' ? 'Then the richest player (net worth) wins the table.' : 'Then the round is scored and the most points win the table.'}</small>
          </label>
          <label className="field"><span>Time to take a seat</span>
            <select value={s.noShowMinutes} onChange={e => set('noShowMinutes', Number(e.target.value))}>
              {TOURNEY_NO_SHOW_MINUTES.map(m => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="field"><span>Players who don’t show up</span>
            <select value={s.noShow} onChange={e => set('noShow', e.target.value as TournamentSettings['noShow'])}>
              <option value="drop">Are dropped</option>
              <option value="autoplay">Are auto-played (and can’t go through)</option>
            </select>
          </label>
          <label className="field tn-check">
            <input type="checkbox" checked={s.botsFill} onChange={e => set('botsFill', e.target.checked)} />
            <span>Fill empty seats with bots (bots never go through)</span>
          </label>

          <fieldset className="field tn-wide tn-start">
            <span>Start</span>
            <label className="tn-check"><input type="radio" checked={!scheduled} onChange={() => setScheduled(false)} /> When I press Start</label>
            <label className="tn-check"><input type="radio" checked={scheduled} onChange={() => setScheduled(true)} /> At a set time
              {lim && <span className="muted small"> (up to {lim.aheadDays} days ahead)</span>}
            </label>
            {scheduled && <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} />}
          </fieldset>
        </div>

        <p className="muted small tn-preview">
          With {s.maxPlayers} players that is about {roundsGuess} round{roundsGuess === 1 ? '' : 's'} of up to {s.roundMinutes} minutes, the last one a single final table.
          {me && !me.isAdmin && ' Hosts run one tournament at a time.'}
        </p>
        <div className="row end">
          <Link className="btn ghost" to="/tournaments">Cancel</Link>
          <button className="btn primary" type="submit" disabled={busy || name.trim().length < 2}>Create tournament</button>
        </div>
      </form>
    </div>
  );
}

/** Rounds a full event takes, roughly (the server seats it exactly, byes and all). */
function estimateRounds(n: number, size: number, advance: number): number {
  let rounds = 1;
  while (n > size && rounds < 20) {
    const tables = Math.ceil(n / size);
    n = Math.max(1, tables * Math.min(advance, 2));
    rounds++;
  }
  return rounds;
}
