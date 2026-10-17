// Audit → Discord invites: who joined the Discord through whose invite.
//
// The question it answers is "is this member bringing in their own alts".
// So the members who invited the most suspicious joins are at the top, and
// each join says what makes it suspicious: a Discord account days old, or an
// account that then signed in to the site from the inviter's browser or
// address. An empty page because a switch is off on Discord's side would look
// exactly like a quiet server, so the connection's state is always shown,
// with what to change when it is not working.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type DiscordInvitesReport } from '../api';
import Avatar from './Avatar';
import CopyId from './CopyId';
import { timeAgo } from '../format';

type Join = DiscordInvitesReport['joins'][number];

export default function DiscordInvites({ onBan, onLookup }: {
  onBan: (t: { value: string; name: string; discordLinked: boolean }) => void;
  onLookup: (siteId: string) => void;
}) {
  const [data, setData] = useState<DiscordInvitesReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState<string | null>(null); // inviter filter
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.discordInvites()); setErr(null); } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the invite log');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const reconnect = async () => {
    setBusy(true);
    try { await api.discordInvitesReconnect(); } catch { /* the reload shows the state */ }
    // Give it a moment to say hello to Discord before reading the state.
    setTimeout(() => { void load().finally(() => setBusy(false)); }, 2500);
  };

  const joins = useMemo(() => (data?.joins ?? []).filter(j =>
    (!only || j.inviterId === only) && (!flaggedOnly || j.flags.some(f => !f.startsWith('banned')))), [data, only, flaggedOnly]);

  if (err) return <div className="empty-note">{err}</div>;
  if (!data) return <div className="empty-note">Loading…</div>;
  const st = data.status;

  return (
    <>
      <p className="audit-note">
        Everyone who joined the Discord, and whose invite they used. A member bringing in
        Discord accounts only <strong>days old</strong>, or accounts that then sign in here from
        <strong> their browser or address</strong>, is the alt pattern. A friend inviting friends
        is not — an old account through someone's invite is not flagged. The bot works this out by
        comparing every invite's use count before and after each join, so it only knows about
        joins from when it was connected.
      </p>

      <div className={`invite-status ${st.state}`}>
        <span className="invite-dot" />
        <span className="invite-status-text">
          <strong>
            {st.state === 'ready' ? 'Watching joins' : st.state === 'connecting' ? 'Connecting'
              : st.state === 'failed' ? 'Not working' : 'Off'}
          </strong>
          {' — '}{st.detail}
          {st.state === 'ready' && st.invitesReadable && <> · {st.invitesTracked} invites tracked</>}
          {st.lastJoinAt && <> · last join {timeAgo(st.lastJoinAt)}</>}
        </span>
        {data.wanted && (
          <button className="btn btn-sm" disabled={busy} onClick={() => void reconnect()}>
            {busy ? 'Reconnecting…' : 'Reconnect'}
          </button>
        )}
      </div>
      {st.state === 'ready' && st.invitesReadable === false && (
        <p className="audit-note vpn-note">
          Joins are being logged, but without who invited them: the bot needs <strong>Manage Server</strong> in
          the Discord server to read the invite list.
        </p>
      )}

      {data.inviters.length > 0 && (
        <>
          <h4 className="invite-h">Inviters</h4>
          <div className="table-scroll">
            <table className="standings-table wide">
              <thead>
                <tr><th>Member</th><th>Invited</th><th>Fresh accounts</th><th>Flagged</th><th /></tr>
              </thead>
              <tbody>
                {data.inviters.map(r => (
                  <tr key={r.inviterId} className={r.flagged > 0 ? 'invite-flagged' : undefined}>
                    <td>
                      <span className="invite-who">
                        <Avatar value={r.inviter?.avatar ?? ''} size={22} />
                        <span>{r.inviter?.name ?? r.inviterName}{r.banned && <span className="invite-flag banned">banned</span>}</span>
                        <CopyId value={r.inviterId} title={`Click to copy ${r.inviterId}`} />
                      </span>
                    </td>
                    <td>{r.invited}</td>
                    <td>{r.fresh}</td>
                    <td>{r.flagged}</td>
                    <td className="invite-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setOnly(only === r.inviterId ? null : r.inviterId)}>
                        {only === r.inviterId ? 'Show all' : 'Their joins'}
                      </button>
                      {r.inviter && (
                        <button className="btn btn-ghost btn-sm" onClick={() => onLookup(r.inviter!.id)}>Look up</button>
                      )}
                      {!r.banned && (
                        <button className="btn btn-ghost btn-sm invite-ban" title="Opens the ban screen, which lists everyone they invited that looks like an alt"
                          onClick={() => onBan({ value: r.inviter?.id ?? r.inviterId, name: r.inviter?.name ?? r.inviterName, discordLinked: true })}>
                          Ban…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h4 className="invite-h">
        Joins{only ? ` through ${data.inviters.find(r => r.inviterId === only)?.inviterName ?? 'one member'}'s invites` : ''}
        <label className="invite-filter">
          <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
          <span>Flagged only</span>
        </label>
      </h4>
      {joins.length === 0 ? (
        <div className="empty-note">
          {data.total === 0
            ? 'No joins logged yet. They appear here as people join the Discord while the bot is connected.'
            : 'Nothing matches.'}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="standings-table wide">
            <thead>
              <tr><th>Joined</th><th>Member</th><th>Account age</th><th>Invited by</th><th>Flags</th><th /></tr>
            </thead>
            <tbody>
              {joins.map(j => <JoinRow key={`${j.memberId}-${j.joinedAt}`} j={j} onBan={onBan} onLookup={onLookup} />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function JoinRow({ j, onBan, onLookup }: {
  j: Join;
  onBan: (t: { value: string; name: string; discordLinked: boolean }) => void;
  onLookup: (siteId: string) => void;
}) {
  const how = j.how === 'invite'
    ? <>{j.inviter?.name ?? j.inviterName ?? j.inviterId} <span className="mono invite-dim">{j.code}</span></>
    : j.how === 'vanity' ? <span className="invite-dim">the server's vanity link</span>
      : j.how === 'ambiguous'
        ? <span className="invite-dim">one of {(j.candidates ?? []).map(c => c.inviterName ?? c.inviterId).join(', ')}</span>
        : <span className="invite-dim">unknown</span>;
  const banned = j.flags.includes('banned');
  return (
    <tr className={j.flags.some(f => !f.startsWith('banned') && f !== 'inviter is banned') ? 'invite-flagged' : undefined}>
      <td title={new Date(j.joinedAt).toLocaleString()}>{timeAgo(j.joinedAt)}</td>
      <td>
        <span className="invite-who">
          <Avatar value={j.member?.avatar ?? j.memberAvatar ?? ''} size={22} />
          <span>
            {j.memberName}
            {j.member && j.member.name !== j.memberName && <span className="invite-dim"> · {j.member.name} here</span>}
            {!j.member && <span className="invite-dim"> · not signed in here</span>}
          </span>
          <CopyId value={j.memberId} title={`Click to copy ${j.memberId}`} />
        </span>
      </td>
      <td className={j.young ? 'invite-young' : undefined}>
        {j.ageDays === 0 ? 'under a day' : `${j.ageDays} day${j.ageDays === 1 ? '' : 's'}`}
      </td>
      <td>{how}</td>
      <td>
        <span className="invite-flags">
          {j.flags.map(f => <span key={f} className={`invite-flag${f.startsWith('same ') ? ' strong' : ''}`}>{f}</span>)}
        </span>
      </td>
      <td className="invite-actions">
        {j.member && <button className="btn btn-ghost btn-sm" onClick={() => onLookup(j.member!.id)}>Look up</button>}
        {!banned && (
          <button className="btn btn-ghost btn-sm invite-ban"
            onClick={() => onBan({ value: j.member?.id ?? j.memberId, name: j.member?.name ?? j.memberName, discordLinked: true })}>
            Ban…
          </button>
        )}
      </td>
    </tr>
  );
}
