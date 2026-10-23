// Lobby control for the room's Discord requirements. The host (or an operator)
// can require membership of the site's Discord server and optionally a role;
// everyone else just sees what is required. Hidden entirely on sites without a
// Discord server configured, unless an old requirement is still set.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { call } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { requirementSentence } from '../community.tsx';
import type { DiscordGateInfo, RoomView } from '../../../shared/types.ts';

export default function RequirementsPicker({ room, canEdit }: { room: RoomView; canEdit: boolean }) {
  const { profile } = useAuth();
  const [info, setInfo] = useState<DiscordGateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const req = room.requirements;

  useEffect(() => {
    if (!canEdit || !profile) return;
    let live = true;
    api<DiscordGateInfo>('/api/community/discord').then(i => { if (live) setInfo(i); }).catch(() => {});
    return () => { live = false; };
  }, [canEdit, profile]);

  const set = (p: { member: boolean; roleId: string | null }) => {
    setBusy(true);
    call('room:requirements', p).catch(toastError).finally(() => setBusy(false));
  };

  if (!canEdit || !info?.available) {
    // Nothing to show: no dead control, and no setup hint for players.
    if (!req) return null;
    return (
      <div className="req-summary">
        <span className="req-lock" aria-hidden>🔒</span>
        <span>{requirementSentence(req)}</span>
        {canEdit && <button className="btn tiny ghost" disabled={busy} onClick={() => set({ member: false, roleId: null })}>Remove</button>}
      </div>
    );
  }

  const roleKnown = !req?.roleId || !!info.roles?.some(r => r.id === req.roleId);
  return (
    <div className="req-picker">
      <label className="rule toggle" title="Only members of our Discord server can take a seat">
        <input type="checkbox" disabled={busy} checked={!!req}
          onChange={e => set({ member: e.target.checked, roleId: e.target.checked ? req?.roleId ?? null : null })} />
        <span>Discord members only<small className="muted"> — anyone can still watch</small></span>
      </label>
      {req && (
        <label className="rule">
          <span>Role</span>
          {info.roles ? (
            <select disabled={busy} value={req.roleId ?? ''} onChange={e => set({ member: true, roleId: e.target.value || null })}>
              <option value="">Any member</option>
              {!roleKnown && req.roleId && <option value={req.roleId}>{req.roleName ?? 'Unknown role'}</option>}
              {info.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          ) : <span className="muted small">{req.roleName ?? 'Any member'}</span>}
        </label>
      )}
      {req && info.rolesNote && <p className="muted small">{info.rolesNote}</p>}
    </div>
  );
}
