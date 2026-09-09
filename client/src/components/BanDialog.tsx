// The one place a ban is confirmed, wherever it is started from.
//
// It replaced three window.prompt() calls, which could only ever ask for
// free text. A stock reason is a click here, a custom one is still typed,
// and both show a preview of the exact line the player will read — the
// operator should never have to guess what they are about to say to someone.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { BAN_REASONS, banMessageFor } from '../../../shared/types';
import { BRAND } from '../../../shared/brand';

export interface BanTarget {
  name: string;
  kind: 'player' | 'ip';
  scope: 'game' | 'lifetime';
}

// Re-exported so callers preview the message without needing to know it
// comes from the shared module the server also builds it from.
export const banMessagePreview = banMessageFor;

export default function BanDialog({ target, onConfirm, onCancel }: {
  target: BanTarget;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');

  const what = target.kind === 'ip'
    ? `${target.name}'s address — and everyone else on it`
    : target.name;
  // Whole sentences rather than one template with a slot, which produced
  // "removed from tournaments, for good right now" — not English.
  const consequence = target.scope === 'lifetime'
    ? `They are removed from every ${BRAND.name} game right now, and can never come back.`
    : 'They are removed from this game right now and cannot come back — late registration included.';

  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Suspend {what}</h3>
        <p className="tag">
          {consequence}
          {target.kind === 'ip' && ' Check the audit for a shared household first.'}
        </p>

        <div className="field">
          <label htmlFor="ban-reason">Reason (optional)</label>
          <div className="reason-presets">
            {BAN_REASONS.map(r => (
              <button
                key={r}
                type="button"
                className={`reason-chip${reason === r ? ' on' : ''}`}
                onClick={() => setReason(reason === r ? '' : r)}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            id="ban-reason" value={reason} maxLength={200}
            placeholder="…or type your own"
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(reason.trim()); }}
          />
        </div>

        <div className="field">
          <label>What they will see</label>
          <div className="ban-preview">{banMessagePreview(target.scope, reason)}</div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={() => onConfirm(reason.trim())}>
            {target.scope === 'lifetime' ? 'Suspend for life' : 'Suspend from this game'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
