// Friends: requests, accepted pairs, and what a friend may see of another
// (online or not, which game, and a table code only when that table is
// public with a seat free). Kept in friends.json. Pure apart from the file:
// presence and names come in through FriendsDeps, so tests hand it fakes.
//
// Rules: a request goes only to an account the site has seen; asking someone
// who already asked you makes you friends at once; nobody under a site ban
// sends, accepts or shows up in anyone's list; lists are capped so one
// account cannot grow the file without bound.
import { debouncedWriter, readJson } from './jsonstore.ts';

export const MAX_FRIENDS = 200;
/** Requests one account may have waiting on others at once. */
export const MAX_OUTGOING = 50;
/** Requests one account may have waiting on it (older ones drop off). */
export const MAX_INCOMING = 100;

export type FriendGame = 'monopoly' | 'cards';

/** Where a friend is right now, as much as a friend may see. */
export interface FriendWhere {
  game: FriendGame;
  /** Only for a public table still in its lobby with a seat free. */
  code?: string;
}

export interface FriendRow {
  id: string;
  name: string;
  avatar: string;
  online: boolean;
  where?: FriendWhere;
  since: number;
}

export interface FriendRequestRow {
  id: string;
  name: string;
  avatar: string;
  at: number;
}

export interface FriendsView {
  friends: FriendRow[];
  incoming: FriendRequestRow[];
  outgoing: FriendRequestRow[];
}

export interface FriendsDeps {
  /** The account as the site last saw it, or null for an id it never has. */
  account(id: string): { name: string; avatar: string } | null;
  banned(id: string): boolean;
  /** Connected right now, and at which table if any (its own privacy rules applied by `joinable`). */
  presence(id: string): { online: boolean; game?: FriendGame; code?: string };
  /** A table a friend may be sent to: public, in its lobby, a seat free. */
  joinable(game: FriendGame, code: string): boolean;
}

interface FriendsFile {
  /** Unordered pairs, stored as "a|b" with a < b. */
  pairs: Record<string, number>;
  /** "from|to" → when asked. */
  requests: Record<string, number>;
}

export class FriendError extends Error {}
const fail = (msg: string): never => { throw new FriendError(msg); };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class FriendStore {
  private pairs = new Map<string, number>();
  private requests = new Map<string, number>();
  /** id → friend ids (both directions), rebuilt from pairs. */
  private byId = new Map<string, Set<string>>();
  private save: () => void;

  constructor(private deps: FriendsDeps, private file: string | null = 'friends.json') {
    this.save = file ? debouncedWriter(file, () => this.toJson(), 1_000) : () => {};
  }

  load(): void {
    if (!this.file) return;
    const f = readJson<Partial<FriendsFile>>(this.file, {});
    this.pairs.clear();
    this.requests.clear();
    this.byId.clear();
    for (const [k, at] of Object.entries(f.pairs ?? {})) {
      const [a, b] = k.split('|');
      if (a && b && a !== b) this.link(a, b, Number(at) || 0);
    }
    for (const [k, at] of Object.entries(f.requests ?? {})) {
      const [a, b] = k.split('|');
      if (a && b && a !== b && !this.areFriends(a, b)) this.requests.set(k, Number(at) || 0);
    }
  }

  private toJson(): FriendsFile {
    return { pairs: Object.fromEntries(this.pairs), requests: Object.fromEntries(this.requests) };
  }

  private link(a: string, b: string, at: number) {
    this.pairs.set(pairKey(a, b), at);
    for (const [x, y] of [[a, b], [b, a]]) {
      let s = this.byId.get(x);
      if (!s) this.byId.set(x, s = new Set());
      s.add(y);
    }
  }

  private unlink(a: string, b: string): boolean {
    const had = this.pairs.delete(pairKey(a, b));
    this.byId.get(a)?.delete(b);
    this.byId.get(b)?.delete(a);
    return had;
  }

  areFriends(a: string, b: string): boolean {
    return this.byId.get(a)?.has(b) ?? false;
  }

  friendIds(id: string): string[] {
    return [...(this.byId.get(id) ?? [])];
  }

  private requestsWhere(test: (from: string, to: string) => boolean): [string, string, number][] {
    const out: [string, string, number][] = [];
    for (const [k, at] of this.requests) {
      const [from, to] = k.split('|');
      if (test(from, to)) out.push([from, to, at]);
    }
    return out;
  }

  /**
   * Ask `to` to be friends. Returns 'friends' when `to` had already asked
   * `from` (accepted on the spot), else 'sent'.
   */
  request(from: string, to: string, now = Date.now()): 'sent' | 'friends' {
    if (from === to) fail('That is you');
    if (this.deps.banned(from)) fail('You cannot add friends');
    if (!this.deps.account(to) || this.deps.banned(to)) fail('No player with that id');
    if (this.areFriends(from, to)) fail('You are friends already');
    if (this.requests.has(`${to}|${from}`)) return this.accept(from, to, now) && 'friends';
    if (this.requests.has(`${from}|${to}`)) return 'sent';
    if (this.friendIds(from).length >= MAX_FRIENDS) fail(`You have ${MAX_FRIENDS} friends already`);
    if (this.requestsWhere(f => f === from).length >= MAX_OUTGOING) fail('You have too many requests waiting — cancel some first');
    const waiting = this.requestsWhere((_f, t) => t === to).sort((a, b) => a[2] - b[2]);
    // A flooded inbox keeps the newest; the oldest unanswered requests drop off.
    for (const [f] of waiting.slice(0, Math.max(0, waiting.length - MAX_INCOMING + 1))) this.requests.delete(`${f}|${to}`);
    this.requests.set(`${from}|${to}`, now);
    this.save();
    return 'sent';
  }

  /** `me` accepts `from`'s request. */
  accept(me: string, from: string, now = Date.now()): true {
    if (this.deps.banned(me) || this.deps.banned(from)) fail('That request is no longer open');
    if (!this.requests.delete(`${from}|${me}`)) fail('That request is no longer open');
    this.requests.delete(`${me}|${from}`);
    if (this.friendIds(me).length >= MAX_FRIENDS) fail(`You have ${MAX_FRIENDS} friends already`);
    if (this.friendIds(from).length >= MAX_FRIENDS) fail('They have no room for more friends');
    this.link(me, from, now);
    this.save();
    return true;
  }

  /** Unfriend, decline a request to me, or cancel mine: whichever applies. */
  remove(me: string, other: string): boolean {
    const had = this.unlink(me, other)
      || this.requests.delete(`${other}|${me}`)
      || this.requests.delete(`${me}|${other}`);
    if (had) this.save();
    return had;
  }

  /** Everyone `me` should hear about when they come online or change table. */
  view(me: string): FriendsView {
    const shown = (id: string) => !this.deps.banned(id) && this.deps.account(id);
    const row = (id: string, at: number): FriendRequestRow | null => {
      const a = shown(id);
      return a ? { id, name: a.name, avatar: a.avatar, at } : null;
    };
    const friends: FriendRow[] = [];
    for (const id of this.friendIds(me)) {
      const a = shown(id);
      if (!a) continue;
      const p = this.deps.presence(id);
      const where: FriendWhere | undefined = p.online && p.game
        ? { game: p.game, ...(p.code && this.deps.joinable(p.game, p.code) && { code: p.code }) }
        : undefined;
      friends.push({ id, name: a.name, avatar: a.avatar, online: p.online, ...(where && { where }), since: this.pairs.get(pairKey(me, id)) ?? 0 });
    }
    friends.sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
    const newest = (a: FriendRequestRow, b: FriendRequestRow) => b.at - a.at;
    return {
      friends,
      incoming: this.requestsWhere((_f, t) => t === me).map(([f, , at]) => row(f, at)).filter((r): r is FriendRequestRow => !!r).sort(newest),
      outgoing: this.requestsWhere(f => f === me).map(([, t, at]) => row(t, at)).filter((r): r is FriendRequestRow => !!r).sort(newest),
    };
  }

  /** A deleted player (erase.ts): every friendship and request either way. Returns the ids they were friends with. */
  forget(id: string): string[] {
    const friends = this.friendIds(id);
    for (const f of friends) this.unlink(id, f);
    for (const [from, to] of this.requestsWhere((f, t) => f === id || t === id)) this.requests.delete(`${from}|${to}`);
    this.byId.delete(id);
    this.save();
    return friends;
  }

  /** How `me` and `other` stand, for the button on a profile. */
  status(me: string, other: string): 'self' | 'friends' | 'sent' | 'received' | 'none' {
    if (me === other) return 'self';
    if (this.areFriends(me, other)) return 'friends';
    if (this.requests.has(`${me}|${other}`)) return 'sent';
    if (this.requests.has(`${other}|${me}`)) return 'received';
    return 'none';
  }
}
