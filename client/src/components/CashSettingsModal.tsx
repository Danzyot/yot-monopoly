import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { TableTheme, TableView } from '../../../shared/types';
import { getSocket } from '../socket';
import ThemePicker from './ThemePicker';

// Host-only: edit a cash table after creation. Blind changes take effect
// from the next hand — a hand in progress is never touched.
export default function CashSettingsModal({ view, onClose }: {
  view: TableView;
  onClose: () => void;
}) {
  const [name, setName] = useState(view.name);
  const [sb, setSb] = useState(view.blinds.sb);
  const [bb, setBb] = useState(view.blinds.bb);
  const [ante, setAnte] = useState(view.blinds.ante);
  const [actionSeconds, setActionSeconds] = useState(view.actionSeconds);
  const [actionCustom, setActionCustom] = useState(
    ![10, 15, 20, 22, 30, 45, 60].includes(view.actionSeconds));
  const [rabbitHunting, setRabbitHunting] = useState(view.rabbitHuntingOn);
  const [timebankSeconds, setTimebankSeconds] = useState(view.timebankSeconds ?? 0);
  const [theme, setTheme] = useState<TableTheme | null>(view.theme);

  const save = () => {
    getSocket().emit('table:settings', {
      tableId: view.id, name, sb, bb, ante, actionSeconds, timebankSeconds, rabbitHunting, theme,
    });
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Table settings</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          Changes apply immediately; blinds change from the next hand.
        </p>

        <div className="field">
          <label>Table name</label>
          <input className="input" value={name} maxLength={48} onChange={e => setName(e.target.value)} />
        </div>

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
        <p className="field-hint">
          <strong>Ante</strong> = an extra chip everyone tosses into the pot before each deal,
          on top of the blinds. Bigger pots, more action. <strong>0</strong> = normal game.
        </p>

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
            {[10, 15, 20, 22, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}
            <option value="custom">Custom…</option>
          </select>
          {actionCustom && (
            <input className="input" type="number" min={5} max={120} value={actionSeconds}
              onChange={e => setActionSeconds(Math.max(5, Math.min(120, Math.floor(Number(e.target.value) || 5))))} />
          )}
        </div>

        <label className="check-row">
          <input type="checkbox" checked={rabbitHunting} onChange={e => setRabbitHunting(e.target.checked)} />
          <span>Rabbit hunting (show the board that would have come when a hand ends early)</span>
        </label>

        <ThemePicker value={theme} onChange={setTheme} />

        <div className="modal-actions">
          <button
            className="btn btn-danger"
            style={{ marginRight: 'auto' }}
            title="Cash everyone out and shut the table down for good"
            onClick={() => {
              if (window.confirm('Close this table? Everyone is cashed out and the table is gone for good.')) {
                getSocket().emit('table:close', view.id);
                onClose();
              }
            }}
          >
            Close table
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save settings</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
