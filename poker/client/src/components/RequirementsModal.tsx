import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { IconChat, IconLink } from './icons';
import { getSocket } from '../socket';
import type { TournamentView } from '../../../shared/types';

interface Props {
  view: TournamentView;
  onClose: () => void;
}

// Checklist gate shown before registering for a tournament with social requirements.
export default function RequirementsModal({ view, onClose }: Props) {
  const { profile, discordEnabled, linkDiscord } = useAuth();
  const req = view.social!;
  const my = view.mySocial;
  // Real Discord verification: membership is checked automatically via the bot.
  const autoVerify = !!req.discordGuildId && discordEnabled && !!profile?.discord;
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = (patch: { x?: boolean; ig?: boolean; discordJoined?: boolean }) => {
    getSocket().emit('tourney:confirmSocial', { id: view.id, ...patch });
  };

  const recheck = () => {
    setChecking(true);
    confirm({});
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(() => setChecking(false), 4000);
  };

  // Check membership as soon as the modal opens (and stop the spinner when
  // the refreshed state arrives).
  useEffect(() => {
    if (autoVerify) recheck();
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVerify]);

  useEffect(() => {
    setChecking(false);
  }, [my.discordVerified, my.discordJoined, my.discordRoleOk]);

  const needsDiscordLink = req.requireDiscord && discordEnabled && !profile?.discord;
  const needsVerify = req.requireDiscord && !!req.discordGuildId && discordEnabled;
  const needsRole = !!req.discordRoleId && discordEnabled;

  const allDone =
    (!req.xUrl || my.x) &&
    (!req.igUrl || my.ig) &&
    (!req.discordInviteUrl || my.discordJoined) &&
    (!needsDiscordLink) &&
    (!needsVerify || my.discordVerified) &&
    (!needsRole || my.discordRoleOk);

  const register = () => {
    getSocket().emit('tourney:register', view.id);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Complete these steps to register</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          The host requires the following before you can take a seat in <strong>{view.name}</strong>.
        </p>

        {req.xUrl && (
          <div className={`req-row${my.x ? ' done' : ''}`}>
            <span className="req-icon req-x">𝕏</span>
            <div className="req-body">
              <strong>Follow on X</strong>
              <a href={req.xUrl} target="_blank" rel="noreferrer" className="req-link">{req.xUrl}</a>
            </div>
            {my.x ? <span className="req-check">✓</span> : (
              <button className="btn btn-sm" onClick={() => { window.open(req.xUrl!, '_blank'); }}>
                Open
              </button>
            )}
            {!my.x && (
              <button className="btn btn-success btn-sm" onClick={() => confirm({ x: true })}>
                I followed
              </button>
            )}
          </div>
        )}

        {req.igUrl && (
          <div className={`req-row${my.ig ? ' done' : ''}`}>
            <span className="req-icon req-ig">IG</span>
            <div className="req-body">
              <strong>Follow on Instagram</strong>
              <a href={req.igUrl} target="_blank" rel="noreferrer" className="req-link">{req.igUrl}</a>
            </div>
            {my.ig ? <span className="req-check">✓</span> : (
              <>
                <button className="btn btn-sm" onClick={() => { window.open(req.igUrl!, '_blank'); }}>Open</button>
                <button className="btn btn-success btn-sm" onClick={() => confirm({ ig: true })}>I followed</button>
              </>
            )}
          </div>
        )}

        {req.discordInviteUrl && (
          <div className={`req-row${my.discordJoined ? ' done' : checking ? '' : autoVerify ? ' failed' : ''}`}>
            <span className="req-icon"><IconChat size={18} /></span>
            <div className="req-body">
              <strong>Join the Discord server</strong>
              {autoVerify ? (
                <span className="req-link">
                  {checking
                    ? 'Checking your membership…'
                    : my.discordJoined
                      ? 'Membership verified'
                      : 'You are not in the server yet — join, then re-check'}
                </span>
              ) : (
                <a href={req.discordInviteUrl} target="_blank" rel="noreferrer" className="req-link">{req.discordInviteUrl}</a>
              )}
            </div>
            {checking ? (
              <span className="req-spinner" aria-label="checking" />
            ) : my.discordJoined ? (
              <span className="req-check">✓</span>
            ) : autoVerify ? (
              <>
                <button className="btn btn-sm" onClick={() => { window.open(req.discordInviteUrl!, '_blank'); }}>Join</button>
                <button className="btn btn-success btn-sm" onClick={recheck}>Re-check</button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => { window.open(req.discordInviteUrl!, '_blank'); }}>Open</button>
                <button className="btn btn-success btn-sm" onClick={() => confirm({ discordJoined: true })}>I joined</button>
              </>
            )}
          </div>
        )}

        {req.requireDiscord && (
          <div className={`req-row${profile?.discord && (!needsVerify || my.discordVerified) ? ' done' : ''}`}>
            <span className="req-icon"><IconLink size={18} /></span>
            <div className="req-body">
              <strong>Connect Discord{needsVerify ? ' (membership verified)' : ''}</strong>
              <span className="req-link">
                {profile?.discord
                  ? needsVerify
                    ? my.discordVerified
                      ? `Verified as @${profile.discord.username}`
                      : `Linked as @${profile.discord.username} — membership not verified yet`
                    : `Linked as @${profile.discord.username}`
                  : discordEnabled
                    ? 'Proves your identity for prizes'
                    : 'Discord sign-in not configured on this server — join via invite above'}
              </span>
            </div>
            {profile?.discord && (!needsVerify || my.discordVerified) ? (
              <span className="req-check">✓</span>
            ) : discordEnabled ? (
              profile?.discord && needsVerify ? (
                <button className="btn btn-success btn-sm" onClick={() => confirm({})}>Re-check</button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => linkDiscord(`/t/${view.id}`)}>
                  Connect Discord
                </button>
              )
            ) : null}
          </div>
        )}

        {needsRole && (
          <div className={`req-row${my.discordRoleOk ? ' done' : ''}`}>
            <span className="req-icon">🎖</span>
            <div className="req-body">
              <strong>Hold the {req.discordRoleName ?? 'required'} role</strong>
              <span className="req-link">
                {my.discordRoleOk
                  ? 'Role verified'
                  : profile?.discord
                    ? 'Ask a server admin for the role, then re-check'
                    : 'Connect Discord first — the role is checked automatically'}
              </span>
            </div>
            {my.discordRoleOk ? (
              <span className="req-check">✓</span>
            ) : profile?.discord ? (
              <button className="btn btn-success btn-sm" onClick={() => confirm({})}>Re-check</button>
            ) : null}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Later</button>
          <button className="btn btn-primary" disabled={!allDone} onClick={register}>
            {allDone ? 'Register now' : 'Complete the steps above'}
          </button>
        </div>
      </div>
    </div>
  );
}
