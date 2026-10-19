// Small shared pieces for the community features: profile links, the
// requirements label, and the "new host" notice.
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth.tsx';
import { toast } from './toast.tsx';
import type { JoinRequirements, RoomView } from '../../shared/types.ts';

export const profilePath = (id: string) => `/u/${encodeURIComponent(id)}`;

/**
 * A player's name linking to their public profile. Bots have none, and nothing
 * links while profiles are switched off. `newTab` is for rooms: following a
 * link must never pull someone out of their seat.
 */
export function ProfileLink({ id, isBot, newTab, children, className }: {
  id: string; isBot?: boolean; newTab?: boolean; children: ReactNode; className?: string;
}) {
  const { config } = useAuth();
  if (isBot || id.startsWith('bot-') || !config.features.leaderboard) return <span className={className} data-user-text>{children}</span>;
  return (
    <Link className={`plink ${className ?? ''}`} to={profilePath(id)} data-user-text
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>{children}</Link>
  );
}

/** "Discord members" / "Discord · VIP role" — for badges. */
export function requirementBadge(req: JoinRequirements): string {
  return req.roleId ? `Discord · ${req.roleName ?? 'role'}` : 'Discord members';
}

/** Full sentence for the lobby. */
export function requirementSentence(req: JoinRequirements): string {
  return req.roleId
    ? `Seats need the ${req.roleName ?? 'required'} role in our Discord server.`
    : 'Seats need membership of our Discord server.';
}

/** Tell everyone at the table when the host changes (it is logged server-side too). */
export function useHostNotice(room: RoomView | null, me: string) {
  const prev = useRef<{ code: string; host: string } | null>(null);
  useEffect(() => {
    if (!room) return;
    const was = prev.current;
    prev.current = { code: room.code, host: room.hostId };
    if (!was || was.code !== room.code || was.host === room.hostId || !room.hostId) return;
    const seat = room.seats.find(s => s.id === room.hostId);
    toast(room.hostId === me ? 'You are now the host' : `${seat?.name ?? 'Someone'} is now the host`);
  }, [room, me]);
}
