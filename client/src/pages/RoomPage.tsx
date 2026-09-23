import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getName, setName, useMyId, useRoom } from '../net.ts';
import Lobby from '../components/Lobby.tsx';
import GameScreen from '../components/GameScreen.tsx';

export default function RoomPage() {
  const [named, setNamed] = useState(!!getName());
  if (!named) return <NamePrompt onDone={() => setNamed(true)} />;
  return <Room />;
}

/** Invite links land here, so ask for a name inline instead of bouncing home. */
function NamePrompt({ onDone }: { onDone: () => void }) {
  const [name, setLocal] = useState('');
  return (
    <div className="center-msg">
      <form className="panel" style={{ width: 'min(360px, calc(100vw - 32px))' }}
        onSubmit={e => { e.preventDefault(); if (name.trim()) { setName(name); onDone(); } }}>
        <h2>Join the game</h2>
        <label className="field">
          <span>Your name</span>
          <input autoFocus value={name} maxLength={20} placeholder="e.g. Rich Uncle" onChange={e => setLocal(e.target.value)} />
        </label>
        <button className="btn primary big" type="submit" disabled={!name.trim()}>Join</button>
      </form>
    </div>
  );
}

function Room() {
  const { code = '' } = useParams();
  const { room, error, spectating, chat, skew } = useRoom(code.toUpperCase());
  const me = useMyId();

  useEffect(() => {
    document.title = room ? `${room.code} · Yot Monopoly` : 'Yot Monopoly';
  }, [room]);

  if (error && !room) {
    return (
      <div className="center-msg">
        <p>{error}</p>
        <Link className="btn primary" to="/">Back</Link>
      </div>
    );
  }
  if (!room) return <div className="center-msg"><p className="muted">Joining {code}…</p></div>;
  if (room.status === 'lobby' || !room.game) return <Lobby room={room} me={me} spectating={spectating} chat={chat} />;
  return <GameScreen room={room} game={room.game} me={me} chat={chat} skew={skew} />;
}
