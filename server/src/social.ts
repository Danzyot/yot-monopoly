// Table social: emoji reactions and pokes. Neither touches the game, so they
// live beside it: the socket layer relays them to the room after these
// checks. Kept free of sockets so the rules can be tested directly.

import { POKE_AFTER_MS, REACTION_EMOJI, type PokeView, type ReactionEmoji } from '../../shared/types.ts';
import { RoomError, type Room } from './rooms.ts';

/** Reactions: one per this long on average, with a small burst allowance. */
export const REACTION_EVERY_MS = 1_500;
export const REACTION_BURST = 3;

export function isReactionEmoji(e: unknown): e is ReactionEmoji {
  return typeof e === 'string' && (REACTION_EMOJI as readonly string[]).includes(e);
}

/**
 * Token bucket per player (not per socket: a second tab must not double the
 * allowance). Separate from the action bucket so reacting never eats into
 * the budget for real moves.
 */
export class ReactionLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  take(id: string, now = Date.now()): boolean {
    const b = this.buckets.get(id) ?? { tokens: REACTION_BURST, at: now };
    b.tokens = Math.min(REACTION_BURST, b.tokens + (now - b.at) / REACTION_EVERY_MS);
    b.at = now;
    if (this.buckets.size > 20_000) this.buckets.clear(); // bounded memory; a reset only forgives
    this.buckets.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

interface TurnWatch {
  key: string;
  since: number;
  pokedBy: Set<string>;
}

/**
 * Tracks when each room's current turn began, by watching every state the
 * room broadcasts. The engine has no wall clock of its own for this, and a
 * turn is identified by its number plus whose it is (doubles keep both).
 */
export class PokeTracker {
  private turns = new WeakMap<Room, TurnWatch>();

  /** Call whenever the room's state is about to be broadcast. */
  observe(room: Room, now = Date.now()): TurnWatch | null {
    const g = room.game;
    if (!g || room.status !== 'playing') {
      this.turns.delete(room);
      return null;
    }
    const key = `${g.turnNumber}:${g.current.id}`;
    let w = this.turns.get(room);
    if (!w || w.key !== key) {
      w = { key, since: now, pokedBy: new Set() };
      this.turns.set(room, w);
    }
    return w;
  }

  view(room: Room, now = Date.now()): PokeView | null {
    const w = this.observe(room, now);
    return w ? { since: w.since, pokedBy: [...w.pokedBy] } : null;
  }

  /** Validate and record a poke; returns who was poked. Throws RoomError with the reason. */
  poke(room: Room, fromId: string, now = Date.now()): string {
    const g = room.game;
    const w = this.observe(room, now);
    if (!g || !w) throw new RoomError('No game is running');
    if (!g.players.some(p => p.id === fromId)) throw new RoomError('Only players at the table can poke');
    const target = g.current;
    if (target.id === fromId) throw new RoomError('It is your own turn');
    if (target.isBot) throw new RoomError('Bots never keep you waiting');
    // Only while the game is waiting on them (not an auction or a mini-game).
    if (!['roll', 'buy', 'done'].includes(g.phase)) throw new RoomError(`${target.name} is not holding things up`);
    const wait = POKE_AFTER_MS - (now - w.since);
    if (wait > 0) throw new RoomError(`Give ${target.name} ${Math.ceil(wait / 1000)}s more`);
    if (w.pokedBy.has(fromId)) throw new RoomError(`You already poked ${target.name} this turn`);
    w.pokedBy.add(fromId);
    return target.id;
  }
}
