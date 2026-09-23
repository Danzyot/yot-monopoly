import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMyId, useRoom } from '../net.ts';
import { useAuth } from '../auth.tsx';
import Lobby from '../components/Lobby.tsx';
import GameScreen from '../components/GameScreen.tsx';

export default function RoomPage() {
  const { code = '' } = useParams();
  const { room, error, spectating, chat, skew } = useRoom(code.toUpperCase());
  const me = useMyId();
  const { profile, ready, openSignIn } = useAuth();

  useEffect(() => {
    document.title = room ? `${room.code} · Yot Monopoly` : 'Yot Monopoly';
  }, [room]);

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
    </>
  );
}
