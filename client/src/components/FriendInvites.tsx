// Friends and tables: the pop-up when a friend invites you over
// (FriendInviteHost, mounted once in App) and the lobby's "Invite friends"
// button that sends one (InviteFriends).
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { inviteFriend, onFriendInvite, tablePath, useFriends, type FriendInvite } from '../friends.ts';
import { toast, toastError } from '../toast.tsx';
import { playPoke } from '../sound.ts';
import { GAMES } from '../../../shared/brand.ts';
import { Avatar } from './Avatar.tsx';
import '../styles/friends.css';

/** An invite stays up this long unless answered. */
const INVITE_MS = 30_000;
const GAME_NAME = { monopoly: GAMES.monopoly.name, cards: GAMES.cards.name } as const;

export function FriendInviteHost() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const path = useLocation().pathname;
  const [invites, setInvites] = useState<(FriendInvite & { key: number })[]>([]);
  const seq = useRef(0);
  const signedIn = !!profile;

  useEffect(() => {
    if (!signedIn) { setInvites([]); return; }
    return onFriendInvite(i => {
      const key = ++seq.current;
      setInvites(list => [...list.filter(x => x.from.id !== i.from.id), { ...i, key }].slice(-3));
      try { playPoke(); } catch { /* sound off */ }
      setTimeout(() => setInvites(list => list.filter(x => x.key !== key)), INVITE_MS);
    });
  }, [signedIn]);

  // Already at that table: nothing to show.
  const shown = invites.filter(i => path !== tablePath(i.game, i.code));
  if (!shown.length) return null;
  const drop = (key: number) => setInvites(list => list.filter(x => x.key !== key));
  return (
    <div className="fr-invites" role="region" aria-label="Invites from friends" aria-live="polite">
      {shown.map(i => (
        <div key={i.key} className="fr-invite">
          <Avatar src={i.from.avatar} size={36} />
          <p><b>{i.from.name}</b> invites you to {GAME_NAME[i.game]}</p>
          <div className="fr-invite-actions">
            <button type="button" className="btn small primary" onClick={() => { drop(i.key); nav(tablePath(i.game, i.code)); }}>Join</button>
            <button type="button" className="btn small ghost" onClick={() => drop(i.key)} aria-label={`Dismiss ${i.from.name}'s invite`}>Not now</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The lobby's button: online friends who are not at this table, one tap each to invite. */
export function InviteFriends({ seated }: { seated: readonly string[] }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const list = useFriends(!!profile, open);
  const [sent, setSent] = useState<Set<string>>(new Set());
  if (!profile || !list?.friends.length) return null;
  const here = new Set(seated);
  const online = list.friends.filter(f => f.online && !here.has(f.id));
  const send = async (id: string, name: string) => {
    try {
      await inviteFriend(id);
      setSent(s => new Set(s).add(id));
      toast(`Invite sent to ${name}`);
    } catch (e) { toastError(e); }
  };
  return (
    <div className="fr-invite-pick">
      <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        👥 Invite friends{online.length ? ` (${online.length} online)` : ''}
      </button>
      {open && (
        <ul className="fr-invite-list">
          {online.length ? online.map(f => (
            <li key={f.id}>
              <Avatar src={f.avatar} size={26} />
              <span className="fr-name">{f.name}</span>
              <button type="button" className="btn small" disabled={sent.has(f.id)} onClick={() => send(f.id, f.name)}>
                {sent.has(f.id) ? 'Sent' : 'Invite'}
              </button>
            </li>
          )) : <li className="muted small">None of your friends is online right now.</li>}
        </ul>
      )}
    </div>
  );
}
