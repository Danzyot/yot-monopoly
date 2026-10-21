// The tournament settings an operator picks, shared by the one-off create
// form (/tournaments/new) and a recurring schedule's editor (Schedules.tsx).
// Everything is checked again on the server (manager.ts checkSettings).
import { CARDS_MODES } from '../../../shared/cards/rules.ts';
import {
  TOURNEY_CARDS_TARGETS, TOURNEY_MIN_PLAYERS, TOURNEY_NO_SHOW_MINUTES, TOURNEY_ROUND_MINUTES, TOURNEY_TABLE_RANGE,
} from '../../../shared/tournaments.ts';
import type { ScheduleSettings } from '../../../shared/tournamentSchedules.ts';

const [TABLE_MIN, TABLE_MAX] = TOURNEY_TABLE_RANGE;
const TABLE_SIZES = Array.from({ length: TABLE_MAX - TABLE_MIN + 1 }, (_, i) => TABLE_MIN + i);
/** For the round estimate when nobody set a cap. */
const SAMPLE_FIELD = 50;

/** The cap as typed: empty means no cap. */
export function parseCap(cap: string): number | null {
  return cap.trim() !== '' ? Math.round(Number(cap)) : null;
}

export function SettingsFields<S extends ScheduleSettings>({ s, setS, cap, setCap }: {
  s: S;
  setS: (f: (x: S) => S) => void;
  cap: string;
  setCap: (v: string) => void;
}) {
  const set = <K extends keyof ScheduleSettings>(k: K, v: ScheduleSettings[K]) => setS(x => ({ ...x, [k]: v }));
  const capped = parseCap(cap);
  return (
    <>
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
        <select value={s.cardsMode} onChange={e => set('cardsMode', e.target.value as ScheduleSettings['cardsMode'])}>
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
        <select value={s.noShow} onChange={e => set('noShow', e.target.value as ScheduleSettings['noShow'])}>
          <option value="drop">Are dropped</option>
          <option value="autoplay">Are auto-played (and can’t go through)</option>
        </select>
      </label>
      <label className="field tn-check">
        <input type="checkbox" checked={s.botsFill} onChange={e => set('botsFill', e.target.checked)} />
        <span>Fill empty seats with bots (bots never go through)</span>
      </label>
    </>
  );
}

/** "With 32 players that is about 3 rounds…": a line under the settings. */
export function RoundsPreview({ s, cap }: { s: ScheduleSettings; cap: string }) {
  const capped = parseCap(cap);
  const field = capped && capped > 0 ? capped : SAMPLE_FIELD;
  const rounds = estimateRounds(field, s.tableSize, s.advance);
  return (
    <p className="muted small tn-preview">
      {capped ? `With ${field} players that is` : `No cap: ${field} players, say, would play`} about {rounds} round{rounds === 1 ? '' : 's'} of up to {s.roundMinutes} minutes, the last one a single final table.
    </p>
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
