// PokerNow-style blind schedule editor: SB/BB/ante/minutes rows, breaks, and
// a final row that plays forever when its minutes are left empty. Used by the
// create form and by the live settings modal (mid-game rewrites).
export type LevelRow = { sb: number; bb: number; minutes: number; isBreak?: boolean; ante?: number };

// Round a blind up to a number that exists in a chip rack — the same ladder
// the server's structure generator uses, kept in step by the tests.
export function niceChip(n: number): number {
  const magnitudes = [1, 10, 100, 1000, 10000, 100000];
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const m of magnitudes) {
    for (const st of steps) {
      const v = m * st * 100;
      if (v / 100 >= n && Number.isInteger(v / 100)) return v / 100;
    }
  }
  return n;
}

// The next level, continued from the last playable row. This used to double
// the big blind, which is why every custom structure played like a hyper
// turbo by level six: doubling is two presets past "turbo". Real schedules
// step ~1.4x on rounded chip numbers, and bring antes in around level four at
// about an eighth of the big blind — matching the built-in structures, so a
// custom schedule starts from the same pacing the presets have.
export function nextLevelAfter(rows: LevelRow[]): LevelRow {
  const plays = rows.filter(r => !r.isBreak);
  const last = plays[plays.length - 1];
  if (!last) return { sb: 25, bb: 50, minutes: 0 };
  const bb = niceChip(Math.max(last.bb + 1, Math.round(last.bb * 1.4)));
  const sb = Math.max(Math.floor(bb / 2 / 25) * 25, Math.floor(bb / 2)) >= 25
    ? Math.max(Math.floor(bb / 2 / 25) * 25, 25)
    : Math.floor(bb / 2);
  const anteDue = plays.length + 1 >= 4 || (last.ante ?? 0) > 0;
  const ante = anteDue ? Math.max(25, Math.round(bb / 8 / 25) * 25) : 0;
  return { sb, bb, ante, minutes: 0 };
}

export default function BlindEditor({ levels, onChange, currentLevel }: {
  levels: LevelRow[];
  onChange: (rows: LevelRow[]) => void;
  // Live editing: highlight the level currently in play (1-based, playable rows).
  currentLevel?: number;
}) {
  const patch = (i: number, p: Partial<LevelRow>) =>
    onChange(levels.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const addLevel = () => onChange([...levels, nextLevelAfter(levels)]);
  const addBreak = () => onChange([...levels, { sb: 0, bb: 0, minutes: 5, isBreak: true }]);
  const remove = (i: number) => onChange(levels.filter((_, k) => k !== i));

  return (
    <div className="blind-editor">
      <div className="blind-row blind-head">
        <span>#</span><span>SB</span><span>BB</span><span>Ante</span><span>Minutes</span><span />
      </div>
      {levels.map((r, i) => {
        const num = r.isBreak ? null : levels.slice(0, i + 1).filter(x => !x.isBreak).length;
        const isCurrent = currentLevel !== undefined && num === currentLevel;
        return (
          <div key={i} className={`blind-row${r.isBreak ? ' is-break' : ''}${isCurrent ? ' is-current' : ''}`}>
            <span className="blind-num">{r.isBreak ? '—' : num}</span>
            {r.isBreak ? (
              <span className="blind-break-label">Break</span>
            ) : (
              <>
                <input className="input" type="number" min={1} value={r.sb || ''}
                  placeholder="SB"
                  onChange={e => patch(i, { sb: Math.max(1, Math.floor(Number(e.target.value) || 0)) })} />
                <input className="input" type="number" min={2} value={r.bb || ''}
                  placeholder="BB"
                  onChange={e => patch(i, { bb: Math.max(2, Math.floor(Number(e.target.value) || 0)) })} />
                <input className="input" type="number" min={0} value={r.ante || ''}
                  placeholder="0"
                  onChange={e => patch(i, { ante: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
              </>
            )}
            <input className="input" type="number" min={0} value={r.minutes || ''}
              placeholder={i === levels.length - 1 ? '∞' : 'min'}
              onChange={e => patch(i, { minutes: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            <button type="button" className="btn btn-sm blind-x" disabled={levels.length <= 1}
              onClick={() => remove(i)} aria-label="Remove level">✕</button>
          </div>
        );
      })}
      <div className="blind-editor-actions">
        <button type="button" className="btn btn-sm" onClick={addLevel}>Add another blind level</button>
        <button type="button" className="btn btn-sm" onClick={addBreak}>Add a break</button>
      </div>
      <p className="blind-editor-note">
        Levels play top to bottom, each for its minutes. Leave the last level's
        minutes empty and it runs forever. Breaks pause every table. Every
        player posts the ante each hand once one is set — added rows bring
        antes in from level 4 automatically, like the built-in structures.
      </p>
    </div>
  );
}
