// /tournaments/new: an operator sets up a Cards tournament. Everything is
// checked again on the server (manager.ts), which takes it from operators only.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { CARDS_MODES } from '../../../shared/cards/rules.ts';
import {
  PRIZE_NOTE, TOURNEY_AHEAD_DAYS, TOURNEY_CARDS_TARGETS, TOURNEY_MIN_PLAYERS, TOURNEY_NAME_MAX, TOURNEY_NO_SHOW_MINUTES,
  TOURNEY_PRIZE_MAX, TOURNEY_ROUND_MINUTES, TOURNEY_TABLE_RANGE, defaultTournamentSettings, tournamentUrl,
  type TournamentSettings,
} from '../../../shared/tournaments.ts';
import { tourneyCall } from './net.ts';
import { GAME_ICON, gameName } from './bits.tsx';
import './tournaments.css';

/** datetime-local wants the time written in the viewer's own zone. */
function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const [TABLE_MIN, TABLE_MAX] = TOURNEY_TABLE_RANGE;
const TABLE_SIZES = Array.from({ length: TABLE_MAX - TABLE_MIN + 1 }, (_, i) => TABLE_MIN + i);
/** For the round estimate when nobody set a cap. */
const SAMPLE_FIELD = 50;

export default function CreateTournament() {
  const { profile, openSignIn } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [prize, setPrize] = useState('');
  const [s, setS] = useState<TournamentSettings>(defaultTournamentSettings);
  /** The cap as typed: empty means no cap. */
  const [cap, setCap] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [startAt, setStartAt] = useState(() => toLocalInput(Date.now() + 60 * 60_000));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `Host a tournament · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);

  const set = <K extends keyof TournamentSettings>(k: K, v: TournamentSettings[K]) => setS(x => ({ ...x, [k]: v }));
  const capped = cap.trim() !== '' ? Math.round(Number(cap)) : null;
  const field = capped && capped > 0 ? capped : SAMPLE_FIELD;
  const roundsGuess = estimateRounds(field, s.tableSize, s.advance);

  if (!profile) {
    return (
      <div className="page tn-page"><section className="panel tn-empty">
        <h1>Host a tournament</h1>
        <p className="muted">Sign in first.</p>
        <button className="btn primary" onClick={openSignIn}>Sign in</button>
      </section></div>
    );
  }
  if (!profile.isAdmin) {
    return (
      <div className="page tn-page"><section className="panel tn-empty">
        <h1>Host a tournament</h1>
        <p className="muted">Tournaments are run by the {BRAND.name} team. Register for one on the list, or host an ordinary table any time.</p>
        <div className="row center wrap"><Link className="btn primary" to="/tournaments">See tournaments</Link><Link className="btn" to="/cards">Play {gameName('cards')}</Link></div>
      </section></div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const settings = { ...s, maxPlayers: capped, startAt: scheduled ? new Date(startAt).getTime() : null };
      const r = await tourneyCall<{ id: string }>('tourney:create', { game: 'cards', name, prize, settings });
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
        <h1 className="lb-title"><span aria-hidden>{GAME_ICON.cards}</span> Host a {gameName('cards')} tournament</h1>

        <div className="tn-grid">
          <label className="field tn-wide"><span>Name</span>
            <input required maxLength={TOURNEY_NAME_MAX} value={name} placeholder={`Friday ${gameName('cards')} Cup`} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field tn-wide"><span>Prize (optional)</span>
            <input maxLength={TOURNEY_PRIZE_MAX} value={prize} placeholder="e.g. a Chog plushie for the champion" onChange={e => setPrize(e.target.value)} />
            <small className="muted">{PRIZE_NOTE}</small>
          </label>

          <label className="field"><span>Most players (optional)</span>
            <input type="number" min={Math.max(TOURNEY_MIN_PLAYERS, s.minPlayers)} value={cap} placeholder="No cap"
              onChange={e => setCap(e.target.value)} />
            <small className="muted">Leave empty to take everyone who registers.</small>
          </label>
          <label className="field"><span>Fewest to start</span>
            <input type="number" min={TOURNEY_MIN_PLAYERS} max={capped ?? undefined} value={s.minPlayers}
              onChange={e => set('minPlayers', Number(e.target.value))} />
          </label>
          <label className="field"><span>Mode</span>
            <select value={s.cardsMode} onChange={e => set('cardsMode', e.target.value as TournamentSettings['cardsMode'])}>
              {CARDS_MODES.map(m => <option key={m.id} value={m.id}>{m.label} ({m.tag})</option>)}
            </select>
            <small className="muted">{CARDS_MODES.find(m => m.id === s.cardsMode)?.help}</small>
          </label>
          <label className="field"><span>Each table plays</span>
            <select value={s.cardsMatch === 'single' ? 'single' : String(s.cardsTarget)} onChange={e => {
              const v = e.target.value;
              setS(x => (v === 'single' ? { ...x, cardsMatch: 'single' } : { ...x, cardsMatch: 'points', cardsTarget: Number(v) }));
            }}>
              <option value="single">One round</option>
              {TOURNEY_CARDS_TARGETS.map(n => <option key={n} value={n}>First to {n} points</option>)}
            </select>
          </label>
          <label className="field"><span>Players per table</span>
            <select value={s.tableSize} onChange={e => set('tableSize', Number(e.target.value))}>
              {TABLE_SIZES.map(n => <option key={n} value={n}>Up to {n}</option>)}
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
              {TOURNEY_ROUND_MINUTES.map(m => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <small className="muted">Then the round is scored and the most points win the table.</small>
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
              <span className="muted small"> (up to {TOURNEY_AHEAD_DAYS} days ahead)</span>
            </label>
            {scheduled && <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} />}
          </fieldset>
        </div>

        <p className="muted small tn-preview">
          {capped ? `With ${field} players that is` : `No cap: ${field} players, say, would play`} about {roundsGuess} round{roundsGuess === 1 ? '' : 's'} of up to {s.roundMinutes} minutes, the last one a single final table.
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
