// The operators' "Schedules" section on /tournaments: recurring Cards
// tournaments ("Monday Night Cup, every Monday 20:00 UTC") that the server
// creates on its own a set time ahead (server/src/tournament/schedules.ts).
// List, create, edit, pause and delete them, with the next three starts.
// Times are set in UTC; the viewer's own time is shown beside them.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast, toastError } from '../toast.tsx';
import { askConfirm } from '../components/Modal.tsx';
import { modeLabel } from '../../../shared/cards/rules.ts';
import { PRIZE_NOTE, TOURNEY_PRIZE_MAX, defaultTournamentSettings, tournamentUrl } from '../../../shared/tournaments.ts';
import {
  SCHEDULE_DEFAULT_LEAD_MINUTES, SCHEDULE_LEAD_MINUTES, SCHEDULE_NAME_MAX, SCHEDULE_NUMBER_TOKEN, WEEKDAYS, WEEKDAYS_LONG, WEEK_ORDER,
  fmtDays, fmtLead, fmtUtcMinute, nextOccurrences, scheduleName,
  type ScheduleLogEntry, type ScheduleSettings, type TournamentScheduleInput, type TournamentScheduleView,
} from '../../../shared/tournamentSchedules.ts';
import { tourneyCall, useSchedules } from './net.ts';
import { STATUS_LABEL, countdown, fmtWhen, useNow } from './bits.tsx';
import { RoundsPreview, SettingsFields, parseCap } from './SettingsFields.tsx';

interface Draft {
  id?: string;
  name: string;
  days: number[];
  /** "20:00", UTC. */
  time: string;
  leadMinutes: number;
  prize: string;
  s: ScheduleSettings;
  cap: string;
  enabled: boolean;
  nextNumber: string;
  /** Editing: starts up to here are already dealt with. */
  after: number;
}

function blank(): Draft {
  const { startAt: _startAt, ...s } = defaultTournamentSettings();
  return { name: '', days: [1], time: '20:00', leadMinutes: SCHEDULE_DEFAULT_LEAD_MINUTES, prize: '', s, cap: '', enabled: true, nextNumber: '1', after: 0 };
}

function fromView(v: TournamentScheduleView): Draft {
  return {
    id: v.id, name: v.name, days: [...v.days], time: fmtUtcMinute(v.minute), leadMinutes: v.leadMinutes, prize: v.prize,
    s: { ...v.settings }, cap: v.settings.maxPlayers === null ? '' : String(v.settings.maxPlayers), enabled: v.enabled,
    nextNumber: String(v.nextNumber), after: v.handledUntil,
  };
}

const minuteOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
};

const ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
})();

/** "Mon 21:00" in the viewer's own zone. */
const localDayTime = (ts: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ts);
const localTime = (ts: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ts);

/** "20:00 UTC (21:00 your time)", or with the day when it falls on another one locally. */
function whenLine(days: number[], minute: number, now: number): string {
  const [next] = nextOccurrences(days, minute, now, 1);
  if (next === undefined) return `${fmtUtcMinute(minute)} UTC`;
  const sameDay = new Date(next).getDay() === new Date(next).getUTCDay();
  return `${fmtUtcMinute(minute)} UTC (${sameDay ? localTime(next) : localDayTime(next)} your time)`;
}

function LogLine({ e }: { e: ScheduleLogEntry }) {
  const when = fmtWhen(e.slot);
  if (e.kind === 'created') {
    return <li><span aria-hidden>✅</span> {e.tournamentId ? <Link to={tournamentUrl(e.tournamentId)}>{e.name}</Link> : e.name} created for {when}</li>;
  }
  return <li><span aria-hidden>{e.kind === 'skipped' ? '⏭️' : '⚠️'}</span> {when} {e.kind === 'skipped' ? 'skipped' : 'missed'}{e.note ? `: ${e.note}` : ''}</li>;
}

function ScheduleCard({ v, now, onEdit }: { v: TournamentScheduleView; now: number; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const toggle = () => run(async () => {
    await tourneyCall('tourney:sched:enable', { id: v.id, enabled: !v.enabled });
    toast(v.enabled ? `${v.name} paused: nothing more is created until you resume it` : `${v.name} resumed`);
  });
  const remove = async () => {
    const ok = await askConfirm({
      title: `Delete the “${v.name}” schedule?`,
      body: 'No more events are created from it. Events it already created stay on the list (cancel them there if you need to).',
      confirm: 'Delete schedule', danger: true,
    });
    if (ok) await run(() => tourneyCall('tourney:sched:delete', { id: v.id }));
  };

  return (
    <li className={`tn-sched${v.enabled ? '' : ' off'}`}>
      <div className="tn-sched-top">
        <span className="tn-card-icon" aria-hidden>🔁</span>
        <span className="tn-card-main">
          <span className="tn-card-top">
            <b className="tn-card-name">{scheduleName(v.name, v.nextNumber)}</b>
            <span className={`tn-status ${v.enabled ? 'registering' : 'paused'}`}>{v.enabled ? 'Active' : 'Paused'}</span>
          </span>
          <span className="small">
            {fmtDays(v.days)} · {whenLine(v.days, v.minute, now)}
          </span>
          <span className="muted small">
            {modeLabel(v.settings.cardsMode)} · {v.settings.maxPlayers ? `up to ${v.settings.maxPlayers} players` : 'no player cap'} · opens {fmtLead(v.leadMinutes)} ahead
          </span>
          {v.prize && <span className="tn-prize small"><span aria-hidden>🎁</span> {v.prize}</span>}
        </span>
      </div>

      {v.current && (
        <p className="tn-sched-current small">
          <span className={`tn-status ${v.current.status}`}>{STATUS_LABEL[v.current.status]}</span>{' '}
          <Link to={tournamentUrl(v.current.id)}>{v.current.name}</Link>
          {v.current.status === 'registering' && v.current.startAt && <span className="muted"> · starts in {countdown(v.current.startAt - now)}</span>}
        </p>
      )}
      {v.waiting && <p className="tn-sched-wait small"><span aria-hidden>⏳</span> Due now, waiting for the previous event to finish (skipped if it is still running at the start).</p>}

      {v.enabled ? (
        <ol className="tn-sched-next">
          {v.next.map(o => (
            <li key={o.start}>
              <b>#{o.n}</b> <span>{fmtWhen(o.start)}</span>
              <span className="muted small">{o.opensAt > now ? `registration opens in ${countdown(o.opensAt - now)}` : 'opening now'}</span>
            </li>
          ))}
        </ol>
      ) : <p className="muted small tn-sched-paused">Paused: nothing is created. Resuming carries on from the next start (missed ones are not made up).</p>}

      {v.log.length > 0 && (
        <details className="tn-sched-log small">
          <summary>History</summary>
          <ul>{v.log.map(e => <LogLine key={`${e.at}-${e.slot}-${e.kind}`} e={e} />)}</ul>
        </details>
      )}

      <div className="tn-sched-actions">
        <button className="btn small" disabled={busy} onClick={onEdit}>Edit</button>
        <button className="btn small" disabled={busy} onClick={toggle}>{v.enabled ? 'Pause' : 'Resume'}</button>
        <button className="btn small ghost tn-danger-text" disabled={busy} onClick={remove}>Delete</button>
      </div>
    </li>
  );
}

function Editor({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }));
  const minute = minuteOf(d.time);
  const first = Math.max(1, Math.round(Number(d.nextNumber)) || 1);
  const preview = nextOccurrences(d.days, minute, Math.max(now, d.after), 3);
  const shownName = d.name.trim() || 'Your cup';

  const toggleDay = (day: number) => set('days', d.days.includes(day) ? d.days.filter(x => x !== day) : [...d.days, day].sort());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const input: TournamentScheduleInput = {
        ...(d.id ? { id: d.id } : {}), name: d.name, days: d.days, minute, prize: d.prize, leadMinutes: d.leadMinutes,
        enabled: d.enabled, nextNumber: first, settings: { ...d.s, maxPlayers: parseCap(d.cap) },
      };
      await tourneyCall('tourney:sched:save', input);
      toast(d.id ? 'Schedule saved' : 'Schedule created');
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tn-form tn-sched-form" onSubmit={submit}>
      <h3>{d.id ? 'Edit schedule' : 'New schedule'}</h3>
      <div className="tn-grid">
        <label className="field tn-wide"><span>Name</span>
          <input required maxLength={SCHEDULE_NAME_MAX} value={d.name} placeholder="Monday Night Cup" onChange={e => set('name', e.target.value)} />
          <small className="muted">Each event gets a number: “{scheduleName(shownName, first)}”. Put {SCHEDULE_NUMBER_TOKEN} where you want the number instead.</small>
        </label>

        <fieldset className="field tn-wide tn-days">
          <span>Every</span>
          <div className="tn-day-row" role="group" aria-label="Days of the week (UTC)">
            {WEEK_ORDER.map(day => (
              <button key={day} type="button" className={`chip${d.days.includes(day) ? ' on' : ''}`} aria-pressed={d.days.includes(day)}
                title={WEEKDAYS_LONG[day]} onClick={() => toggleDay(day)}>{WEEKDAYS[day]}</button>
            ))}
          </div>
        </fieldset>
        <label className="field"><span>Start time (UTC)</span>
          <input type="time" required value={d.time} onChange={e => set('time', e.target.value)} />
          <small className="muted">{minute >= 0 && d.days.length ? `${whenLine(d.days, minute, now)}${ZONE ? ` · ${ZONE}` : ''}` : 'Pick a day and a time'}</small>
        </label>
        <label className="field"><span>Created and open for registration</span>
          <select value={d.leadMinutes} onChange={e => set('leadMinutes', Number(e.target.value))}>
            {SCHEDULE_LEAD_MINUTES.map(m => <option key={m} value={m}>{fmtLead(m)} before the start</option>)}
          </select>
        </label>
        <label className="field"><span>Next number</span>
          <input type="number" min={1} max={9999} value={d.nextNumber} onChange={e => set('nextNumber', e.target.value)} />
        </label>
        <label className="field tn-wide"><span>Prize (optional)</span>
          <input maxLength={TOURNEY_PRIZE_MAX} value={d.prize} placeholder="e.g. a Chog plushie for the champion" onChange={e => set('prize', e.target.value)} />
          <small className="muted">{PRIZE_NOTE}</small>
        </label>

        <SettingsFields s={d.s} setS={f => setD(x => ({ ...x, s: f(x.s) }))} cap={d.cap} setCap={v => set('cap', v)} />

        <label className="field tn-check tn-wide">
          <input type="checkbox" checked={d.enabled} onChange={e => set('enabled', e.target.checked)} />
          <span>Active: create the events automatically</span>
        </label>
      </div>

      <div className="tn-sched-preview">
        <b className="small">Next 3 starts</b>
        {preview.length ? (
          <ol className="tn-sched-next">
            {preview.map((start, i) => (
              <li key={start}>
                <b>{scheduleName(shownName, first + i)}</b> <span>{fmtWhen(start)}</span>
                <span className="muted small">{fmtUtcMinute(minute)} UTC · opens {fmtWhen(start - d.leadMinutes * 60_000)}</span>
              </li>
            ))}
          </ol>
        ) : <p className="muted small">Pick at least one day and a start time.</p>}
      </div>
      <RoundsPreview s={d.s} cap={d.cap} />

      <div className="row end">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy || d.name.trim().length < 2 || !d.days.length || minute < 0}>
          {d.id ? 'Save schedule' : 'Create schedule'}
        </button>
      </div>
    </form>
  );
}

export default function Schedules() {
  const { schedules, error } = useSchedules(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const now = useNow();

  return (
    <section className="panel tn-section tn-schedules" id="schedules" aria-labelledby="tn-schedules-h">
      <div className="tn-sched-head">
        <h2 id="tn-schedules-h"><span aria-hidden>🔁</span> Schedules <span className="lb-count">{schedules?.length ?? 0}</span></h2>
        {!editing && <button className="btn primary small" onClick={() => setEditing(blank())}>＋ New schedule</button>}
      </div>
      <p className="muted small tn-sched-intro">
        Recurring tournaments: each event is created on its own ahead of the start, so players can register in advance.
        Times are set in UTC. Only operators see this section.
      </p>
      {editing && <Editor key={editing.id ?? 'new'} initial={editing} onDone={() => setEditing(null)} />}
      {error && <p className="muted">{error}</p>}
      {!schedules && !error && <div className="lb-skeleton" aria-busy="true"><div className="sk sk-row" /></div>}
      {schedules && schedules.length === 0 && !editing && (
        <p className="muted">No schedules yet. Set one up, e.g. “Monday Night Cup, every Monday 20:00 UTC, Chog Chaos”.</p>
      )}
      {schedules && schedules.length > 0 && (
        <ul className="tn-sched-list">
          {schedules.map(v => <ScheduleCard key={v.id} v={v} now={now} onEdit={() => setEditing(fromView(v))} />)}
        </ul>
      )}
    </section>
  );
}
