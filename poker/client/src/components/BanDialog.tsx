// The one place a ban is confirmed, wherever it is started from.
//
// It replaced three window.prompt() calls, which could only ever ask for
// free text. A stock reason is a click here, a custom one is still typed,
// and both show a preview of the exact line the player will read — the
// operator should never have to guess what they are about to say to someone.
//
// It also shows who else this person looks like: the accounts behind the same
// browser or a shared address, with face, name and id, and one tick to ban all
// of them in the same action. Banning one alt of four achieves nothing.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BAN_REASONS, banMessageFor } from '../../../shared/types';
import { BRAND } from '../../../shared/brand';
import { api } from '../api';
import Avatar from './Avatar';
import CopyId from './CopyId';

type Account = { id: string; name: string; avatar?: string; discordTag?: string | null; discordId?: string | null };

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
  // For an address ban from the audit: who has been seen from it. Supplied
  // so the operator is told how many people "and the accounts behind it"
  // actually means BEFORE they agree to it.
  accounts?: Account[];
  // The account the ban was started from, when there is one. Callers carry
  // it as `playerId` (table, standings) or `value` (audit, player bans).
  playerId?: string;
  value?: string;
}

// Re-exported so callers preview the message without needing to know it
// comes from the shared module the server also builds it from.
export const banMessagePreview = banMessageFor;

type Alt = Awaited<ReturnType<typeof api.suspectedAlts>>['alts'][number];

export default function BanDialog({ target, onConfirm, onCancel }: {
  target: BanTarget;
  onConfirm: (reason: string, discordBan: boolean, banPlayers: boolean, alsoBan: string[], includeMain: boolean) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  // Off by default and always a deliberate choice. A Discord ban is public,
  // reaches beyond the card room, and is not what every poker ban deserves.
  const [discordBan, setDiscordBan] = useState(false);

  // The account this ban is about, if any. An address ban started from a
  // player's seat or standings row has one; the audit's address chips do not.
  const subject = target.playerId ?? (target.kind === 'player' ? target.value : undefined);

  // Suspected alts of the subject, fetched when the screen opens.
  const [alts, setAlts] = useState<Alt[] | null>(null);
  const [self, setSelf] = useState<Account | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The player the ban was started from. Ticked by default; untick them to
  // ban only their alts and leave them alone.
  const [includeMain, setIncludeMain] = useState(true);
  useEffect(() => {
    if (!subject) { setAlts([]); return; }
    let stale = false;
    api.suspectedAlts(subject)
      .then(r => { if (!stale) { setAlts(r.alts); setSelf(r.self); } })
      .catch(() => { if (!stale) setAlts([]); });
    return () => { stale = true; };
  }, [subject]);
  const bannable = useMemo(() => (alts ?? []).filter(a => !a.alreadyBanned), [alts]);
  const allPicked = bannable.length > 0 && bannable.every(a => picked.has(a.id));
  const toggleAll = (on: boolean) => setPicked(on ? new Set(bannable.map(a => a.id)) : new Set());
  const toggleOne = (id: string) => setPicked(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Address bans from the audit: everyone seen on the address.
  const accounts = target.kind === 'ip' && !subject ? (target.accounts ?? []) : [];
  const canBanPlayers = accounts.length > 0;
  const [banPlayers, setBanPlayers] = useState(true);
  // Past this many, an address is a mobile carrier or a VPN exit holding
  // strangers rather than a household, and banning everyone behind it would
  // suspend people who have done nothing.
  const crowded = accounts.length > 8;

  // Discord is offered whenever this ban reaches an account: a player ban, an
  // address ban that takes the player's account with it, or alts picked here.
  const reachesAccount = (target.kind === 'player' && target.discordLinked !== false)
    || (target.kind === 'ip' && !!subject)
    || picked.size > 0
    || (canBanPlayers && banPlayers);

  const onlyAlts = !!subject && !includeMain;
  const what = onlyAlts
    ? `${target.name}'s alts — not ${target.name}`
    : target.kind === 'ip'
      ? (subject ? `${target.name} — their account and address` : `${target.name}'s address — and everyone else on it`)
      : target.name;
  // Built as whole sentences rather than a shared template with a slot: the
  // slot version read "removed from WAWA Poker tournaments, for good right
  // now", which is not English.
  const consequence = target.scope === 'lifetime'
    ? `They are removed from every ${BRAND.name} game right now, and can never come back.`
    : 'They are removed from this game right now and cannot come back — late registration included.';

  // Nothing to do when the player is unticked and no alt is picked.
  const nothing = onlyAlts && picked.size === 0;
  const confirm = () => {
    if (nothing) return;
    onConfirm(reason.trim(), discordBan && reachesAccount, banPlayers && canBanPlayers, [...picked], !onlyAlts);
  };

  const accountRow = (a: Account & { reasons?: string[]; alreadyBanned?: boolean }, control: React.ReactNode) => (
    <div key={a.id} className={`ban-alt${a.alreadyBanned ? ' banned' : ''}${a.id === subject ? ' main' : ''}`}>
      {control}
      <Avatar value={a.avatar ?? ''} size={28} />
      <span className="ban-alt-who">
        <span className="ban-alt-name">
          {a.name}{a.discordTag && a.discordTag !== a.name ? <span className="ban-alt-tag"> @{a.discordTag}</span> : null}
        </span>
        <span className="ban-alt-meta">
          <CopyId value={a.discordId ?? a.id} title={`Click to copy ${a.discordId ?? a.id}`} />
          {a.alreadyBanned
            ? <span className="ban-alt-reason">already banned</span>
            : (a.reasons ?? []).map(r => <span key={r} className="ban-alt-reason">{r}</span>)}
        </span>
      </span>
    </div>
  );

  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <h3>Suspend {what}</h3>
        <p className="tag">
          {onlyAlts
            ? `Only the ticked alts are suspended. ${target.name} keeps playing — their account and address are not touched.`
            : consequence}
          {!onlyAlts && target.kind === 'ip' && subject
            && ' Their account is banned along with the address, so another network or phone does not get them back in.'}
          {target.kind === 'ip' && !subject && ' Check the audit for a shared household first.'}
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
            onKeyDown={e => { if (e.key === 'Enter') confirm(); }}
          />
        </div>

        <div className="field">
          <label>What they will see</label>
          <div className="ban-preview">{banMessagePreview(target.scope, reason)}</div>
        </div>

        {subject && (
          <div className="field">
            <label>Suspected alts</label>
            {alts === null && <p className="field-hint">Looking…</p>}
            {alts !== null && alts.length === 0 && (
              <p className="field-hint">No other account shares a browser or an address with them.</p>
            )}
            {alts !== null && alts.length > 0 && (
              <>
                {bannable.length > 0 && (
                  <label className="ban-discord ban-alts-all">
                    <input type="checkbox" checked={allPicked} onChange={e => toggleAll(e.target.checked)} />
                    <span>
                      Ban all {bannable.length} suspected alt{bannable.length === 1 ? '' : 's'}{onlyAlts ? '' : ' too'}
                      <span className="field-hint">
                        Same browser is near certain. Same address can be a household — untick anyone
                        you are not sure about.
                      </span>
                    </span>
                  </label>
                )}
                <div className="ban-alts">
                  {accountRow(
                    { ...(self ?? { id: subject, name: target.name }), reasons: ['this player'] },
                    <input type="checkbox" className="ban-alt-box" checked={includeMain}
                      onChange={e => setIncludeMain(e.target.checked)} aria-label={`Ban ${target.name}`} />,
                  )}
                  {alts.map(a => accountRow(a, a.alreadyBanned
                    ? <span className="ban-alt-box" />
                    : <input type="checkbox" className="ban-alt-box" checked={picked.has(a.id)} onChange={() => toggleOne(a.id)} />))}
                </div>
              </>
            )}
          </div>
        )}

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
              </span>
            </label>
            <div className="ban-alts">
              {accounts.map(a => accountRow(a, <span className="ban-alt-box" />))}
            </div>
          </div>
        )}

        {reachesAccount && (
          <div className="field">
            <label className="ban-discord">
              <input
                type="checkbox" checked={discordBan}
                onChange={e => setDiscordBan(e.target.checked)}
              />
              <span>
                Ban from the Discord server too
                <span className="field-hint">
                  Every account banned here that has Discord linked is removed from the server and
                  cannot rejoin. Lifting a ban here lifts that one as well — a ban you placed on
                  Discord by hand is never touched. Needs the bot to have Ban Members, with its role
                  above theirs.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={confirm} disabled={nothing}>
            {onlyAlts
              ? (picked.size ? `Suspend ${picked.size} alt${picked.size === 1 ? '' : 's'} only` : 'Pick an alt to suspend')
              : <>{target.scope === 'lifetime' ? 'Suspend for life' : 'Suspend from this game'}{picked.size > 0 ? ` (+${picked.size})` : ''}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
