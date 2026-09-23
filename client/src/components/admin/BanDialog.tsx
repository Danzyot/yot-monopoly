// The one place a ban is written, wherever it is started from (Rooms, Players,
// Alts, Bans, or a player's menu in a game). Everything is pre-filled from
// where the operator clicked, and the exact line the player will read is
// previewed before anything is sent.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { BAN_REASONS, banMessageFor, type BanKind, type BanScope } from '../../../../shared/types.ts';
import { act, post } from './adminApi.ts';

export interface BanTarget {
  kind?: BanKind;
  /** Account id (player ban) or address (IP ban). */
  value?: string;
  /** Display name, stored with the ban so the list stays readable. */
  name?: string;
  scope?: BanScope;
  /** Room code for a room-scoped ban. */
  gameId?: string;
  /** The account id, when the dialog was opened for one (lets the kind be switched back). */
  accountId?: string;
  /** Known addresses for this person, offered when switching to an IP ban. */
  ips?: string[];
}

const DURATIONS: { label: string; hours: number | null }[] = [
  { label: 'Permanent', hours: null },
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

export default function BanDialog({ target, onClose, onDone }: {
  target: BanTarget;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState<BanKind>(target.kind ?? 'player');
  const [value, setValue] = useState(target.value ?? '');
  const [scope, setScope] = useState<BanScope>(target.scope ?? 'lifetime');
  const [gameId, setGameId] = useState(target.gameId ?? '');
  // 'custom' reveals an hours box; anything else is an index into DURATIONS.
  const [duration, setDuration] = useState<string>('0');
  const [customHours, setCustomHours] = useState('');
  const [preset, setPreset] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const hours = duration === 'custom' ? (Number(customHours) > 0 ? Number(customHours) : null) : DURATIONS[Number(duration)].hours;
  const reason = [preset, details.trim()].filter(Boolean).join(' — ');
  // Shown as if it started now; the server stamps the real time.
  const previewExpiry = hours ? Date.now() + hours * 3_600_000 : null;
  const ipOptions = target.ips ?? [];

  const switchKind = (k: BanKind) => {
    setKind(k);
    if (k === 'ip') setValue(ipOptions[0] ?? '');
    else setValue(target.accountId ?? (target.kind === 'player' ? target.value ?? '' : ''));
  };

  const invalid = !value.trim() ? (kind === 'ip' ? 'Which address?' : 'Which account?')
    : scope === 'room' && !gameId.trim() ? 'Which room?'
    : duration === 'custom' && !hours ? 'How many hours?'
    : null;

  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    const ok = await act(() => post('/api/admin/bans', {
      kind, value: value.trim(), name: target.name ?? '', scope,
      gameId: scope === 'room' ? gameId.trim().toUpperCase() : undefined,
      reason, durationHours: hours ?? undefined,
    }), { ok: `Banned ${target.name || value.trim()}` });
    setBusy(false);
    if (ok) { onDone?.(); onClose(); }
  };

  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <form className="modal adm-ban" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <h2>Ban {target.name || (kind === 'ip' ? 'an address' : 'an account')}</h2>

        <div className="adm-field">
          <span>What</span>
          <div className="adm-seg">
            <button type="button" className={kind === 'player' ? 'on' : ''} onClick={() => switchKind('player')}>Account</button>
            <button type="button" className={kind === 'ip' ? 'on' : ''} onClick={() => switchKind('ip')}>IP address</button>
          </div>
          {kind === 'ip' && ipOptions.length > 0 ? (
            <select value={value} onChange={e => setValue(e.target.value)}>
              {ipOptions.map(ip => <option key={ip} value={ip}>{ip}</option>)}
            </select>
          ) : (
            <input value={value} placeholder={kind === 'ip' ? '203.0.113.7' : 'Account id (dc_… / demo_…)'} onChange={e => setValue(e.target.value)} />
          )}
          {kind === 'ip' && <small className="muted">Bars everyone on that address — check the Alts tab for a shared household first.</small>}
        </div>

        <div className="adm-field">
          <span>Where</span>
          <div className="adm-seg">
            <button type="button" className={scope === 'lifetime' ? 'on' : ''} onClick={() => setScope('lifetime')}>Whole site</button>
            <button type="button" className={scope === 'room' ? 'on' : ''} onClick={() => setScope('room')}>One room</button>
          </div>
          {scope === 'room' && (
            <input className="mono" value={gameId} maxLength={8} placeholder="Room code" onChange={e => setGameId(e.target.value.toUpperCase())} />
          )}
        </div>

        <div className="adm-field">
          <span>How long</span>
          <div className="row">
            <select value={duration} onChange={e => setDuration(e.target.value)}>
              {DURATIONS.map((d, i) => <option key={d.label} value={String(i)}>{d.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {duration === 'custom' && (
              <input type="number" min={1} step={1} value={customHours} placeholder="hours" onChange={e => setCustomHours(e.target.value)} style={{ width: 110 }} />
            )}
          </div>
        </div>

        <div className="adm-field">
          <span>Reason</span>
          <select value={preset} onChange={e => setPreset(e.target.value)}>
            <option value="">— pick a reason (optional) —</option>
            {BAN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={details} maxLength={150} placeholder="Details (optional)" onChange={e => setDetails(e.target.value)} />
        </div>

        <div className="adm-field">
          <span>What they will see</span>
          <div className="adm-preview">{banMessageFor(scope, reason, previewExpiry)}</div>
        </div>

        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn danger" disabled={busy || !!invalid} title={invalid ?? ''}>
            {busy ? 'Banning…' : scope === 'lifetime' ? 'Ban from the site' : `Ban from ${gameId || 'room'}`}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
