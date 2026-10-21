// /friends: your friends (online first, which game they are in, Join when their
// table is public with a seat free), requests to answer, requests you sent, and
// your own profile link to send to people you want to add.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { ProfileLink, profilePath } from '../community.tsx';
import { acceptFriend, removeFriend, tablePath, useFriends, type FriendRow } from '../friends.ts';
import { toast, toastError } from '../toast.tsx';
import { askConfirm } from '../components/Modal.tsx';
import { GAMES } from '../../../shared/brand.ts';
import '../styles/friends.css';

const GAME_NAME = { monopoly: GAMES.monopoly.name, cards: GAMES.cards.name } as const;

function whereText(f: FriendRow): string {
  if (!f.online) return 'Offline';
  if (!f.where) return 'Online';
  return f.where.code ? `In a ${GAME_NAME[f.where.game]} lobby · seat free` : `Playing ${GAME_NAME[f.where.game]}`;
}

export default function Friends() {
  const { profile, ready, openSignIn } = useAuth();
  const list = useFriends(!!profile, true);
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    try { await f(); } catch (e) { toastError(e); } finally { setBusy(null); }
  };

  if (ready && !profile) {
    return (
      <div className="page friends-page">
        <section className="panel fr-empty">
          <div className="fr-empty-icon" aria-hidden>👥</div>
          <h1>Friends</h1>
          <p className="muted">Sign in to add friends, see when they are online and invite them to your table.</p>
          <button type="button" className="btn primary chunky" onClick={openSignIn}>Sign in</button>
        </section>
      </div>
    );
  }

  const link = profile ? `${location.origin}${profilePath(profile.id)}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied — send it to a friend'); } catch { toast(link); }
  };
  const online = list?.friends.filter(f => f.online).length ?? 0;

  return (
    <div className="page friends-page">
      <header className="fr-head">
        <h1>👥 Friends</h1>
        {list && <p className="muted">{list.friends.length ? `${list.friends.length} ${list.friends.length === 1 ? 'friend' : 'friends'} · ${online} online` : 'No friends yet'}</p>}
      </header>

      {!list && <div className="lb-skeleton" aria-busy="true"><div className="sk sk-row" /><div className="sk sk-row" /></div>}

      {list && list.incoming.length > 0 && (
        <section className="panel fr-section" aria-labelledby="fr-in">
          <h2 id="fr-in">Friend requests <span className="fr-count">{list.incoming.length}</span></h2>
          <ul className="fr-list">
            {list.incoming.map(r => (
              <li key={r.id} className="fr-row">
                <Avatar src={r.avatar} size={40} />
                <ProfileLink id={r.id} className="fr-name">{r.name}</ProfileLink>
                <span className="fr-actions">
                  <button type="button" className="btn small primary" disabled={busy === r.id}
                    onClick={() => run(r.id, async () => { await acceptFriend(r.id); toast(`You and ${r.name} are friends`); })}>Accept</button>
                  <button type="button" className="btn small ghost" disabled={busy === r.id} onClick={() => run(r.id, () => removeFriend(r.id))}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {list && (
        <section className="panel fr-section" aria-labelledby="fr-all">
          <h2 id="fr-all">Your friends</h2>
          {list.friends.length ? (
            <ul className="fr-list">
              {list.friends.map(f => (
                <li key={f.id} className={`fr-row ${f.online ? 'on' : ''}`}>
                  <span className="fr-av">
                    <Avatar src={f.avatar} size={40} />
                    <i className="fr-dot" aria-hidden />
                  </span>
                  <span className="fr-who">
                    <ProfileLink id={f.id} className="fr-name">{f.name}</ProfileLink>
                    <small className="fr-where">{whereText(f)}</small>
                  </span>
                  <span className="fr-actions">
                    {f.where?.code && (
                      <button type="button" className="btn small primary" onClick={() => nav(tablePath(f.where!.game, f.where!.code!))}>Join</button>
                    )}
                    <button type="button" className="btn small ghost" disabled={busy === f.id} aria-label={`Unfriend ${f.name}`}
                      onClick={() => run(f.id, async () => {
                        if (await askConfirm({ title: `Unfriend ${f.name}?`, body: 'You can add each other again any time.', confirm: 'Unfriend' })) await removeFriend(f.id);
                      })}>✕</button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="fr-none">
              <p>Add people from their profile: tap a name at a table or on the <Link to="/leaderboard">leaderboard</Link>, then <b>Add friend</b>. Or send them your link:</p>
            </div>
          )}
          <div className="fr-share">
            <input readOnly value={link} aria-label="Your profile link" onFocus={e => e.currentTarget.select()} />
            <button type="button" className="btn small" onClick={copy}>Copy link</button>
          </div>
          {list.friends.length > 0 && <p className="muted small">At a table, use <b>Invite friends</b> in the lobby to bring an online friend over.</p>}
        </section>
      )}

      {list && list.outgoing.length > 0 && (
        <section className="panel fr-section" aria-labelledby="fr-out">
          <h2 id="fr-out">Waiting for an answer</h2>
          <ul className="fr-list">
            {list.outgoing.map(r => (
              <li key={r.id} className="fr-row">
                <Avatar src={r.avatar} size={40} />
                <ProfileLink id={r.id} className="fr-name">{r.name}</ProfileLink>
                <span className="fr-actions">
                  <button type="button" className="btn small ghost" disabled={busy === r.id} onClick={() => run(r.id, () => removeFriend(r.id))}>Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
