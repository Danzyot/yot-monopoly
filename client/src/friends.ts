// Friends on the client (server/src/routes/friends.ts): the list, requests,
// and invites to a table. One shared copy of the list per tab, fetched when
// something asks for it, again whenever the server says it changed
// (friends:changed), and every half minute while a page shows it (who is
// online and where moves without any event).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { call, getSocket } from './net.ts';

export type FriendGame = 'monopoly' | 'cards';
export interface FriendRow {
  id: string; name: string; avatar: string; online: boolean; since: number;
  where?: { game: FriendGame; code?: string };
}
export interface FriendRequestRow { id: string; name: string; avatar: string; at: number }
export interface FriendsView { friends: FriendRow[]; incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }
export type FriendStatus = 'self' | 'friends' | 'sent' | 'received' | 'none';
export interface FriendInvite { from: { id: string; name: string; avatar: string }; game: FriendGame; code: string }

const POLL_MS = 30_000;

let view: FriendsView | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (v: FriendsView | null) => { view = v; listeners.forEach(f => f()); };

export function refreshFriends(): Promise<void> {
  loading ??= api<FriendsView>('/api/friends')
    .then(publish)
    .catch(() => { /* signed out or offline: keep what we had */ })
    .finally(() => { loading = null; });
  return loading;
}

/** Forget the list (sign-out). */
export function clearFriends() {
  publish(null);
}

let wired = false;
/** Listen for the server's nudges once per tab. */
function wire() {
  if (wired) return;
  wired = true;
  getSocket().on('friends:changed', () => { void refreshFriends(); });
}

/** The shared list; `poll` keeps it fresh while the caller is on screen. */
export function useFriends(signedIn: boolean, poll = false): FriendsView | null {
  const v = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => view);
  useEffect(() => {
    if (!signedIn) { clearFriends(); return; }
    wire();
    void refreshFriends();
    if (!poll) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') void refreshFriends(); }, POLL_MS);
    return () => clearInterval(id);
  }, [signedIn, poll]);
  return signedIn ? v : null;
}

const post = (path: string, id: string) => api<Record<string, unknown>>(`/api/friends/${path}`, { method: 'POST', json: { id } });

export async function addFriend(id: string): Promise<'sent' | 'friends'> {
  const r = await post('request', id);
  void refreshFriends();
  return r.status as 'sent' | 'friends';
}
export async function acceptFriend(id: string) { await post('accept', id); void refreshFriends(); }
/** Unfriend, decline or cancel. */
export async function removeFriend(id: string) { await post('remove', id); void refreshFriends(); }

/** How the signed-in player stands with `id` (a profile's button). */
export function useFriendStatus(id: string, signedIn: boolean): [FriendStatus | null, () => void] {
  const [status, setStatus] = useState<FriendStatus | null>(null);
  const [n, setN] = useState(0);
  const list = useFriends(signedIn);
  useEffect(() => {
    if (!signedIn) { setStatus(null); return; }
    let live = true;
    api<{ status: FriendStatus }>(`/api/friends/status/${encodeURIComponent(id)}`)
      .then(r => { if (live) setStatus(r.status); })
      .catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
    // The list changing (an accept from the other side) re-asks too.
  }, [id, signedIn, n, list]);
  return [status, () => setN(x => x + 1)];
}

/** Invite a friend to the table you are seated at (they get a pop-up with Join). */
export const inviteFriend = (id: string) => call('friends:invite', { id });

/** Invites as they arrive, newest last. */
export function onFriendInvite(fn: (i: FriendInvite) => void): () => void {
  const s = getSocket();
  s.on('friends:invited', fn);
  return () => { s.off('friends:invited', fn); };
}

export const tablePath = (game: FriendGame, code: string) => (game === 'cards' ? `/cards/r/${code}` : `/r/${code}`);
