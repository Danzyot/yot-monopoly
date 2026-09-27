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
  // Whether this person has a Discord account behind them. true: offer the
  // Discord ban. false: the caller KNOWS they are a guest, so hide it. Left
  // out: the caller cannot tell (a seat at a table carries no Discord
  // field), so offer it and let the server report a guest as not banned
  // there — hiding it on a guess is how the option went missing for
  // everyone whose id did not happen to start with dc_.
  discordLinked?: boolean;
  // For an address ban: who has been seen from it. Supplied so the operator
  // is told how many people "and the accounts behind it" actually means
  // BEFORE they agree to it, rather than finding out from the result.
  accounts?: { id: string; name: string }[];
}

// Re-exported so callers preview the message without needing to know it
// comes from the shared module the server also builds it from.
export const banMessagePreview = banMessageFor;

export default function BanDialog({ target, onConfirm, onCancel }: {
  target: BanTarget;
  onConfirm: (reason: string, discordBan: boolean, banPlayers: boolean) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  // Off by default and always a deliberate choice. A Discord ban is public,
  // reaches beyond the card room, and is not what every poker ban deserves.
  const [discordBan, setDiscordBan] = useState(false);
  const canDiscordBan = target.kind === 'player' && target.discordLinked !== false;

  // Banning an address without banning the accounts on it is a door, not a
  // verdict — the same people return on a phone under the same names. So when
  // we know who is behind the address, this starts ON.
  const accounts = target.kind === 'ip' ? (target.accounts ?? []) : [];
  const canBanPlayers = accounts.length > 0;
  const [banPlayers, setBanPlayers] = useState(true);
  // Past this many, an address is a mobile carrier or a VPN exit holding
  // strangers rather than a household, and banning everyone behind it would
  // suspend people who have done nothing.
  const crowded = accounts.length > 8;

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
            onKeyDown={e => {
              if (e.key === 'Enter') onConfirm(reason.trim(), discordBan && canDiscordBan, banPlayers && canBanPlayers);
            }}
          />
        </div>

        <div className="field">
          <label>What they will see</label>
          <div className="ban-preview">{banMessagePreview(target.scope, reason)}</div>
        </div>

        {canBanPlayers && (
          <div className="field">
            <label className="ban-discord">
              <input
                type="checkbox" checked={banPlayers}
                onChange={e => setBanPlayers(e.target.checked)}
              />
              <span>
                Ban the {accounts.length} account{accounts.length === 1 ? '' : 's'} seen from this address too
                <span className="field-hint">
                  {crowded
                    ? `${accounts.length} accounts behind one address is typical of a mobile network or a VPN, not a household — this would suspend strangers. Check the names first.`
                    : 'Otherwise only the address is shut out, and they come back on a phone or a VPN under the same names.'}
                </span>
                <span className="ban-accounts">
                  {accounts.map(a => <span key={a.id} className="ban-account">{a.name}</span>)}
                </span>
              </span>
            </label>
          </div>
        )}

        {canDiscordBan && (
          <div className="field">
            <label className="ban-discord">
              <input
                type="checkbox" checked={discordBan}
                onChange={e => setDiscordBan(e.target.checked)}
              />
              <span>
                Ban from the Discord server too
                <span className="field-hint">
                  They are removed and cannot rejoin. Lifting this ban here lifts
                  that one as well — a ban you placed on Discord by hand is never
                  touched. Needs the bot to have Ban Members, with its role above
                  theirs.{target.discordLinked === undefined
                    ? ' If they signed in as a guest there is no Discord account to ban, and this says so.'
                    : ''}
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={() => onConfirm(reason.trim(), discordBan && canDiscordBan, banPlayers && canBanPlayers)}>
            {target.scope === 'lifetime' ? 'Suspend for life' : 'Suspend from this game'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
