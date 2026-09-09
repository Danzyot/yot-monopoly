import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { TableTheme, TournamentView } from '../../../shared/types';
import { getSocket } from '../socket';
import BlindEditor, { type LevelRow } from './BlindEditor';
import ThemePicker from './ThemePicker';

// Host-only: edit everything about a tournament after it was created,
// including mid-game. Every field the create form offers is editable here.
export default function SettingsModal({ view, onClose }: {
  view: TournamentView;
  onClose: () => void;
}) {
  const live = view.state === 'running' || view.state === 'break' || view.state === 'paused';
  const hasCustomLevels = !!view.config.customLevels?.length;
  const [name, setName] = useState(view.name);
  const [levelMinutes, setLevelMinutes] = useState(view.config.levelMinutes);
  const [levelMinutesCustom, setLevelMinutesCustom] = useState(
    ![3, 5, 8, 10, 12, 15, 20].includes(view.config.levelMinutes));
  const [lateRegMinutes, setLateRegMinutes] = useState(view.config.lateRegMinutes);
  const [joinMinutes, setJoinMinutes] = useState(view.config.joinMinutes ?? 15);
  const [lateRegCustom, setLateRegCustom] = useState(
    ![0, 5, 10, 15, 20, 30, 45, 60].includes(view.config.lateRegMinutes));
  const [approve, setApprove] = useState(view.config.approveRegistrations);
  const [prizeText, setPrizeText] = useState(view.config.prizeText ?? '');
  const [actionSeconds, setActionSeconds] = useState(view.config.actionSeconds ?? 20);
  const [actionCustom, setActionCustom] = useState(
    ![10, 15, 20, 30, 45, 60].includes(view.config.actionSeconds ?? 20));
  const [maxPlayers, setMaxPlayers] = useState(view.config.maxPlayers);
  const [timebankSeconds, setTimebankSeconds] = useState(view.config.timebankSeconds ?? 0);
  const [maxReentries, setMaxReentries] = useState(view.config.maxReentries);
  const [rabbitHunting, setRabbitHunting] = useState(view.config.rabbitHunting);
  const [displayMode, setDisplayMode] = useState<'chips' | 'bb'>(view.config.displayMode);
  // Custom schedule: editable in place; only sent if actually changed.
  const initialLevels: LevelRow[] = (view.config.customLevels ?? []).map(r => ({
    sb: r.sb, bb: r.bb, minutes: r.minutes, isBreak: r.isBreak, ante: r.ante,
  }));
  const [levels, setLevels] = useState<LevelRow[]>(initialLevels);
  // Blinds: start from the level currently in play.
  const [sb, setSb] = useState(view.level.sb);
  const [bb, setBb] = useState(view.level.bb);
  const [ante, setAnte] = useState(view.level.ante);
  const [editBlinds, setEditBlinds] = useState(false);
  const [theme, setTheme] = useState<TableTheme | null>(view.config.theme ?? null);

  const save = () => {
    getSocket().emit('tourney:settings', {
      id: view.id,
      name,
      levelMinutes,
      lateRegMinutes,
      joinMinutes,
      approveRegistrations: approve,
      prizeText: prizeText.trim() || null,
      actionSeconds,
      maxPlayers,
      timebankSeconds,
      maxReentries,
      rabbitHunting,
      displayMode,
      theme,
      ...(hasCustomLevels && JSON.stringify(levels) !== JSON.stringify(initialLevels)
        ? {
          customLevels: levels.map(r => ({
            sb: r.sb, bb: r.bb, ante: r.ante ?? 0, minutes: r.minutes, isBreak: !!r.isBreak,
          })),
        }
        : {}),
      ...(editBlinds ? { blinds: { sb, bb, ante } } : {}),
    });
    onClose();
  };

  const jump = (delta: number) => {
    getSocket().emit('tourney:settings', { id: view.id, jumpLevel: view.level.level + delta });
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Tournament settings</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          {live
            ? 'Changes apply immediately. Blind changes take effect from the next hand — never inside a live one.'
            : 'Changes apply as soon as you save.'}
        </p>

        <div className="field">
          <label>Tournament name</label>
          <input className="input" value={name} maxLength={48} onChange={e => setName(e.target.value)} />
        </div>

        <div className="row">
          {!hasCustomLevels && (
            <div className="field">
              <label>Minutes per level</label>
              <select
                className="input"
                value={levelMinutesCustom ? 'custom' : String(levelMinutes)}
                onChange={e => {
                  if (e.target.value === 'custom') { setLevelMinutesCustom(true); return; }
                  setLevelMinutesCustom(false);
                  setLevelMinutes(Number(e.target.value));
                }}
              >
                {[3, 5, 8, 10, 12, 15, 20].map(m => <option key={m} value={m}>{m} min</option>)}
                <option value="custom">Custom…</option>
              </select>
              {levelMinutesCustom && (
                <input className="input" type="number" min={1} max={60} value={levelMinutes}
                  onChange={e => setLevelMinutes(Math.max(1, Math.min(60, Math.floor(Number(e.target.value) || 1))))} />
              )}
            </div>
          )}
          <div className="field">
            <label>Time limit per turn</label>
            <select
              className="input"
              value={actionCustom ? 'custom' : String(actionSeconds)}
              onChange={e => {
                if (e.target.value === 'custom') { setActionCustom(true); return; }
                setActionCustom(false);
                setActionSeconds(Number(e.target.value));
              }}
            >
              {[10, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}
              <option value="custom">Custom…</option>
            </select>
            {actionCustom && (
              <input className="input" type="number" min={5} max={120} value={actionSeconds}
                onChange={e => setActionSeconds(Math.max(5, Math.min(120, Math.floor(Number(e.target.value) || 5))))} />
            )}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Time to join a table</label>
            <input
              className="input" type="number" min={1} max={240} value={joinMinutes}
              onChange={e => setJoinMinutes(Math.max(1, Math.min(240, Math.floor(Number(e.target.value) || 1))))}
            />
            <div className="field-hint">
              Registering reserves a place; players press <strong>Join table</strong> to
              claim it. Minutes from the start before an unclaimed place is given up.
            </div>
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Late registration</label>
            <select
              className="input"
              value={lateRegCustom ? 'custom' : String(lateRegMinutes)}
              onChange={e => {
                if (e.target.value === 'custom') { setLateRegCustom(true); return; }
                setLateRegCustom(false);
                setLateRegMinutes(Number(e.target.value));
              }}
            >
              <option value={0}>Closed</option>
              {[5, 10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
              <option value="custom">Custom…</option>
            </select>
            {lateRegCustom && (
              <input className="input" type="number" min={0} max={240} value={lateRegMinutes}
                onChange={e => setLateRegMinutes(Math.max(0, Math.min(240, Math.floor(Number(e.target.value) || 0))))} />
            )}
          </div>
          <div className="field">
            <label>Max players</label>
            <input className="input" type="number" min={2} max={1000} value={maxPlayers}
              onChange={e => setMaxPlayers(Math.max(2, Math.min(1000, Math.floor(Number(e.target.value) || 2))))} />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Re-entries</label>
            <select className="input" value={maxReentries} onChange={e => setMaxReentries(Number(e.target.value))}>
              <option value={0}>No</option>
              {[1, 2, 3, 5, 10].map(m => <option key={m} value={m}>Up to {m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Show stacks and bets as</label>
            <select className="input" value={displayMode} onChange={e => setDisplayMode(e.target.value as 'chips' | 'bb')}>
              <option value="chips">Chip amounts</option>
              <option value="bb">Big blinds</option>
            </select>
          </div>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={approve} onChange={e => setApprove(e.target.checked)} />
          <span>Approve each registration</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={rabbitHunting} onChange={e => setRabbitHunting(e.target.checked)} />
          <span>Rabbit hunting (show the board that would have come when a hand ends early)</span>
        </label>

        <div className="field">
          <label>Prizes</label>
          <textarea className="input" rows={2} maxLength={500} value={prizeText}
            onChange={e => setPrizeText(e.target.value)} />
        </div>

        {hasCustomLevels && (
          <>
            <div className="divider">blind schedule</div>
            <BlindEditor levels={levels} onChange={setLevels}
              currentLevel={live ? view.level.level : undefined} />
          </>
        )}

        {live && (
          <>
            <div className="divider">blinds — level {view.level.level}</div>
            <div className="row">
              <button className="btn btn-sm" disabled={view.level.level <= 1} onClick={() => jump(-1)}>
                ‹ Previous level
              </button>
              <button className="btn btn-sm" onClick={() => jump(1)}>Next level ›</button>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={editBlinds} onChange={e => setEditBlinds(e.target.checked)} />
              <span>Set custom blinds for this level</span>
            </label>
            {editBlinds && (
              <div className="row">
                <div className="field">
                  <label>Small blind</label>
                  <input className="input" type="number" min={1} value={sb}
                    onChange={e => setSb(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
                </div>
                <div className="field">
                  <label>Big blind</label>
                  <input className="input" type="number" min={2} value={bb}
                    onChange={e => setBb(Math.max(2, Math.floor(Number(e.target.value) || 2)))} />
                </div>
                <div className="field">
                  <label>Ante <span className="label-opt">optional</span></label>
                  <input className="input" type="number" min={0} value={ante} placeholder="0"
                    onChange={e => setAnte(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                </div>
              </div>
            )}
            {editBlinds && (
              <p className="field-hint">
                <strong>Ante</strong> = an extra chip everyone tosses into the pot before each
                deal, on top of the blinds. Bigger pots, more action. <strong>0</strong> = none.
              </p>
            )}
          </>
        )}

        <ThemePicker value={theme} onChange={setTheme} />

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save settings</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
