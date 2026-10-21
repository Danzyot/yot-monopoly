// /tournaments/new: an operator sets up a Cards tournament. Everything is
// checked again on the server (manager.ts), which takes it from operators only.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { BRAND } from '../../../shared/brand.ts';
import {
  PRIZE_NOTE, TOURNEY_AHEAD_DAYS, TOURNEY_NAME_MAX, TOURNEY_PRIZE_MAX, defaultTournamentSettings, tournamentUrl,
  type TournamentSettings,
} from '../../../shared/tournaments.ts';
import { tourneyCall } from './net.ts';
import { GAME_ICON, gameName } from './bits.tsx';
import { RoundsPreview, SettingsFields, parseCap } from './SettingsFields.tsx';
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

  const capped = parseCap(cap);

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

          <SettingsFields s={s} setS={setS} cap={cap} setCap={setCap} />

          <fieldset className="field tn-wide tn-start">
            <span>Start</span>
            <label className="tn-check"><input type="radio" checked={!scheduled} onChange={() => setScheduled(false)} /> When I press Start</label>
            <label className="tn-check"><input type="radio" checked={scheduled} onChange={() => setScheduled(true)} /> At a set time
              <span className="muted small"> (up to {TOURNEY_AHEAD_DAYS} days ahead)</span>
            </label>
            {scheduled && <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} />}
            <small className="muted">Every week, or every day? Set up a <Link to="/tournaments#schedules">recurring schedule</Link> instead.</small>
          </fieldset>
        </div>

        <RoundsPreview s={s} cap={cap} />
        <div className="row end">
          <Link className="btn ghost" to="/tournaments">Cancel</Link>
          <button className="btn primary" type="submit" disabled={busy || name.trim().length < 2}>Create tournament</button>
        </div>
      </form>
    </div>
  );
}
