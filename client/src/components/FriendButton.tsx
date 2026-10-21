// "Add friend" on someone's profile, and what it turns into: request sent
// (cancel), they asked you (accept), friends (unfriend, after a confirm).
import { useState } from 'react';
import { useAuth } from '../auth.tsx';
import { acceptFriend, addFriend, removeFriend, useFriendStatus } from '../friends.ts';
import { toast, toastError } from '../toast.tsx';
import { askConfirm } from './Modal.tsx';

export default function FriendButton({ id, name }: { id: string; name: string }) {
  const { profile, openSignIn } = useAuth();
  const [status, reload] = useFriendStatus(id, !!profile);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); } catch (e) { toastError(e); } finally { setBusy(false); reload(); }
  };

  if (!profile) return <button type="button" className="btn small" onClick={openSignIn}>👥 Add friend</button>;
  if (!status || status === 'self') return null;
  if (status === 'friends') {
    return (
      <button type="button" className="btn small ghost" disabled={busy} aria-label={`Friends with ${name}. Unfriend`}
        onClick={() => run(async () => {
          if (await askConfirm({ title: `Unfriend ${name}?`, body: 'You can add each other again any time.', confirm: 'Unfriend' })) await removeFriend(id);
        })}>
        ✓ Friends
      </button>
    );
  }
  if (status === 'sent') {
    return <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(() => removeFriend(id))}>Request sent · Cancel</button>;
  }
  if (status === 'received') {
    return (
      <span className="row wrap" style={{ gap: 6 }}>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => run(async () => { await acceptFriend(id); toast(`You and ${name} are friends`); })}>Accept friend request</button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(() => removeFriend(id))}>Decline</button>
      </span>
    );
  }
  return (
    <button type="button" className="btn small" disabled={busy}
      onClick={() => run(async () => {
        const r = await addFriend(id);
        toast(r === 'friends' ? `You and ${name} are friends` : `Friend request sent to ${name}`);
      })}>
      👥 Add friend
    </button>
  );
}
