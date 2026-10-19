// /cards/r/:code: one card table, lobby or match. Lazy-loaded with its styles,
// so none of this is in the Monopoly bundle.
import { useEffect, useRef } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMyId } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { CARDS_GAME_NAME } from '../../../shared/cards/meta.ts';
import { useCardsRoom } from './net.ts';
import CardsLobby from './CardsLobby.tsx';
import CardsTable from './CardsTable.tsx';
import './cards.css';

export default function CardsRoomPage() {
  const { code = '' } = useParams();
  const watch = useSearchParams()[0].get('watch') === '1';
  const upper = code.toUpperCase();
  const { room, error, spectating, chat, skew } = useCardsRoom(upper, watch);
  const me = useMyId();
  const { profile, ready, openSignIn } = useAuth();
  // Seen in the lobby: the first deal is staged rather than shown dealt.
  const sawLobby = useRef(false);
  if (room?.status === 'lobby') sawLobby.current = true;

  useEffect(() => {
    document.title = room ? `${room.code} · ${CARDS_GAME_NAME}` : CARDS_GAME_NAME;
  }, [room?.code]);

  if (!ready) return <div className="center-msg"><p className="muted">Loading…</p></div>;
  if (error && !room) {
    return (
      <div className="center-msg">
        <p>{error}</p>
        <Link className="btn primary" to="/cards">Back</Link>
      </div>
    );
  }
  if (!room) return <div className="center-msg"><p className="muted">Joining {upper}…</p></div>;

  return (
    <>
      {room.status === 'lobby' || !room.game
        ? <CardsLobby room={room} me={me} spectating={spectating} chat={chat} />
        : <CardsTable key={room.startedAt ?? 0} room={room} me={me} chat={chat} skew={skew} fromLobby={sawLobby.current} />}
      {room.status === 'lobby' && !profile && (
        <div className="signin-bar">
          You're watching. <button className="btn small primary" onClick={openSignIn}>Sign in</button> to take a seat.
        </div>
      )}
    </>
  );
}
