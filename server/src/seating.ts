// Taking a seat when someone opens a room: the one place the Discord gate is
// enforced. Kept out of sockets.ts so it can be tested without a socket server.
import { checkRequirements } from './requirements.ts';
import { RoomError, type Room } from './rooms.ts';
import type { PlayerProfile, RequirementFailure } from '../../shared/types.ts';

export interface SeatResult {
  seated: boolean;
  /** Set when the room's requirements refused a seat; the player watches instead. */
  blocked: RequirementFailure | null;
}

/**
 * Seat the player if they may sit down; otherwise they watch. Watching is never
 * gated. Only a NEW seat is checked: reclaiming your own seat (a reconnect, a
 * refresh mid-game) must never depend on Discord answering.
 */
export async function takeSeat(room: Room, profile: PlayerProfile | null, watch: boolean): Promise<SeatResult> {
  if (!profile) return { seated: false, blocked: null };
  const mine = room.seat(profile.id);
  if (watch && !mine) return { seated: false, blocked: null };
  if (!mine && room.status === 'lobby' && room.requirements && room.seats.length < room.rules.maxPlayers && !room.wasKicked(profile.id)) {
    const blocked = await checkRequirements(profile, room.requirements);
    if (blocked) return { seated: false, blocked };
  }
  try {
    room.join({ id: profile.id, name: profile.name, avatar: profile.avatar });
    return { seated: true, blocked: null };
  } catch (e) {
    if (e instanceof RoomError) return { seated: false, blocked: null }; // started or full: watch instead
    throw e;
  }
}
