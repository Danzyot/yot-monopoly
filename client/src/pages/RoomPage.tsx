import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMyId, useRoom } from '../net.ts';
import { useAuth } from '../auth.tsx';
import Lobby from '../components/Lobby.tsx';
import GameScreen from '../components/GameScreen.tsx';
import RequirementsModal from '../components/RequirementsModal.tsx';
import { requirementBadge, useHostNotice } from '../community.tsx';

export default function RoomPage() {
  const { code = '' } = useParams();
  const watch = useSearchParams()[0].get('watch') === '1';
  const { room, error, spectating, chat, skew, blocked, recheck } = useRoom(code.toUpperCase(), watch);
  const me = useMyId();
  const { profile, ready, openSignIn } = useAuth();
  // "Watch instead" hides the requirements modal; a bar keeps it one tap away.
  const [reqHidden, setReqHidden] = useState(false);
  useHostNotice(room, me);

  // Keyed on the code, not every state: turn alerts flash the title in between.
  useEffect(() => {
    document.title = room ? `${room.code} · Yot Monopoly` : 'Yot Monopoly';
  }, [room?.code]);

  if (!ready) return <div className="center-msg"><p className="muted">Loading…</p></div>;
  if (error && !room) {
    return (
      <div className="center-msg">
        <p>{error}</p>
        <Link className="btn primary" to="/">Back</Link>
      </div>
    );
  }
  if (!room) return <div className="center-msg"><p className="muted">Joining {code}…</p></div>;

  const signInBar = !profile && (
    <div className="signin-bar">
      You're watching. <button className="btn small primary" onClick={openSignIn}>Sign in</button> to take a seat.
    </div>
  );
  return (
    <>
      {room.status === 'lobby' || !room.game
        ? <Lobby room={room} me={me} spectating={spectating} chat={chat} />
        : <GameScreen room={room} game={room.game} me={me} chat={chat} skew={skew} />}
      {room.status === 'lobby' && signInBar}
      {room.status === 'lobby' && blocked && !reqHidden && (
        <RequirementsModal failure={blocked} onRecheck={recheck} onClose={() => setReqHidden(true)} />
      )}
      {room.status === 'lobby' && blocked && reqHidden && (
        <div className="signin-bar req-bar">
          <span>🔒 You're watching — {requirementBadge(blocked.requirements)} only.</span>
          <button className="btn small primary" onClick={() => setReqHidden(false)}>How to sit down</button>
        </div>
      )}
    </>
  );
}
