// "Extra time near the end": once the field is down to N players, every
// decision gets more seconds. Shared by the create form and the settings
// screen so the two can never describe it differently.
import type { LateClock } from '../../../shared/types';

export interface LateClockState { on: boolean; players: number; extraSeconds: number }

export const lateClockState = (v: LateClock | null | undefined): LateClockState =>
  v ? { on: true, ...v } : { on: false, players: 30, extraSeconds: 10 };

export const lateClockValue = (s: LateClockState): LateClock | null =>
  s.on ? { players: s.players, extraSeconds: s.extraSeconds } : null;

export default function LateClockField({ value, onChange }: {
  value: LateClockState;
  onChange: (v: LateClockState) => void;
}) {
  const set = (p: Partial<LateClockState>) => onChange({ ...value, ...p });
  return (
    <div className="field">
      <label>Extra time near the end</label>
      <div className="cap-row late-clock-row">
        <label className="cap-toggle">
          <input type="checkbox" checked={value.on} onChange={e => set({ on: e.target.checked })} />
          <span>On</span>
        </label>
        <select
          className="input" value={value.extraSeconds} disabled={!value.on}
          aria-label="Extra seconds per decision"
          onChange={e => set({ extraSeconds: Number(e.target.value) })}
        >
          {[5, 10, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>+{s} seconds</option>)}
        </select>
        <span className="late-clock-at">
          <span className="late-clock-word">from</span>
          <input
            className="input late-clock-players" type="number" min={2} max={1000}
            value={value.players} disabled={!value.on} aria-label="Players left"
            onChange={e => set({ players: Math.max(2, Math.min(1000, Math.floor(Number(e.target.value) || 2))) })}
          />
          <span className="late-clock-word">players left</span>
        </span>
      </div>
      <div className="field-hint">
        {value.on
          ? `When ${value.players} or fewer players are left, every decision gets ${value.extraSeconds} more seconds on top of the turn limit. Players are told in the chat when it starts.`
          : 'Give everyone more time per decision once the field is down to the last few — the hands that decide the prizes.'}
      </div>
    </div>
  );
}
