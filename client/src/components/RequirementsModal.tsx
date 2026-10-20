// Shown when a Discord-gated room refuses someone a seat. Adapted from the
// poker site's checklist: what the table needs, where each step stands, the
// invite, and "Check again". When we genuinely could not tell (no bot, sign-in
// forgotten after a restart) it says so instead of claiming they are not a member.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.tsx';
import { toast, toastError } from '../toast.tsx';
import type { RequirementFailure } from '../../../shared/types.ts';
import { Modal } from './Modal.tsx';

/** The server refuses to re-ask Discord more often than this. */
const RECHECK_GAP_MS = 3_000;

type Status = 'ok' | 'no' | 'unknown' | 'pending';

function Step({ status, title, detail }: { status: Status; title: string; detail: string }) {
  const icon = { ok: '✓', no: '✕', unknown: '?', pending: '•' }[status];
  return (
    <div className={`req-row ${status}`}>
      <span className="req-icon" aria-hidden>{icon}</span>
      <div className="req-body">
        <b>{title}</b>
        <span className="small muted">{detail}</span>
      </div>
    </div>
  );
}

export default function RequirementsModal({ failure, onRecheck, onClose }: {
  failure: RequirementFailure;
  onRecheck: () => Promise<RequirementFailure | null>;
  onClose: () => void;
}) {
  const { profile, config, signInDiscord } = useAuth();
  const [checking, setChecking] = useState(false);
  const [coolUntil, setCoolUntil] = useState(0);
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const req = failure.requirements;
  const m = failure.missing;
  const cooling = Date.now() < coolUntil;

  const recheck = async () => {
    setChecking(true);
    try {
      const again = await onRecheck();
      if (!again) toast('All set — you have a seat');
    } catch (e) {
      toastError(e);
    } finally {
      setChecking(false);
      setCoolUntil(Date.now() + RECHECK_GAP_MS);
      timer.current = setTimeout(() => setTick(t => t + 1), RECHECK_GAP_MS);
    }
  };

  const linked = m !== 'discord';
  const memberStatus: Status = m === 'discord' ? 'pending' : m === 'member' ? 'no' : m === 'unverifiable' ? 'unknown' : 'ok';
  const roleStatus: Status = m === 'role' ? 'no' : m === 'unverifiable' ? 'unknown' : 'pending';
  // Signing in with Discord (again) is the fix for "no Discord" and, without a
  // bot, for "we could not see your servers".
  const offerDiscordLogin = config.discordEnabled && (m === 'discord' || m === 'unverifiable');

  return (
    <Modal onClose={onClose} labelledBy="req-title" className="req-modal">
        <h2 id="req-title">This table needs Discord</h2>
        <p className="muted small">The host only seats {req.roleId ? <>players with the <b>{req.roleName ?? 'required'}</b> role in</> : 'members of'} our Discord server. You can still watch.</p>

        <div className="req-steps">
          <Step status={linked ? 'ok' : 'no'} title="Signed in with Discord"
            detail={linked ? (profile?.discord ? `As @${profile.discord.username}` : 'Signed in') : 'Needed so we can check your membership'} />
          <Step status={memberStatus} title="In our Discord server"
            detail={memberStatus === 'ok' ? 'Membership verified' : memberStatus === 'no' ? 'Not in the server yet'
              : memberStatus === 'unknown' ? 'We could not check this' : 'Checked after you sign in'} />
          {req.roleId && (
            <Step status={roleStatus} title={`Has the ${req.roleName ?? 'required'} role`}
              detail={roleStatus === 'no' ? 'Ask a server admin for the role' : roleStatus === 'unknown' ? 'We could not check this' : 'Checked once you are in the server'} />
          )}
        </div>

        <p className={`req-message ${m === 'unverifiable' ? 'unknown' : ''}`}>{failure.message}</p>

        <div className="req-actions">
          {failure.inviteUrl ? (
            <a className="btn discord" href={failure.inviteUrl} target="_blank" rel="noreferrer">Join the Discord server</a>
          ) : m === 'member' && <span className="small muted">Ask the host for an invite to the server.</span>}
          {offerDiscordLogin && <button className="btn" onClick={signInDiscord}>{m === 'discord' ? 'Sign in with Discord' : 'Sign in with Discord again'}</button>}
        </div>

        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Watch instead</button>
          <button className="btn primary" disabled={checking || cooling} onClick={() => void recheck()}>
            {checking ? <><span className="spinner" /> Checking…</> : 'Check again'}
          </button>
        </div>
    </Modal>
  );
}
