import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMyId, useRoom } from '../net.ts';
import { useAuth } from '../auth.tsx';
import Lobby from '../components/Lobby.tsx';
import GameScreen from '../components/GameScreen.tsx';
import RequirementsModal from '../components/RequirementsModal.tsx';
import { requirementBadge, useHostNotice } from '../community.tsx';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import TournamentBar from '../tournaments/TournamentBar.tsx';

/** The ?tv=1 broadcast view: only TVs and stream overlays need its code. */
const BroadcastScreen = lazy(() => import('../components/BroadcastScreen.tsx'));

export default function RoomPage() {
  const { code = '' } = useParams();
  const params = useSearchParams()[0];
  // ?tv=1: the broadcast view (a TV or stream overlay). It only ever watches.
  const tv = params.get('tv') === '1';
  const watch = params.get('watch') === '1' || tv;
  const { room, error, spectating, chat, skew, blocked, recheck } = useRoom(code.toUpperCase(), watch);
  const me = useMyId();
  const { profile, ready, openSignIn } = useAuth();
  // "Watch instead" hides the requirements modal; a bar keeps it one tap away.
  const [reqHidden, setReqHidden] = useState(false);
  useHostNotice(room, me);

  // Keyed on the code, not every state: turn alerts flash the title in between.
  useEffect(() => {
    if (tv) return; // the broadcast screen titles its own tab
    document.title = room ? `${room.code} · ${GAMES.monopoly.name} · ${BRAND.name}` : BRAND.name;
  }, [room?.code, tv]);

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
  if (tv) return <Suspense fallback={null}><BroadcastScreen room={room} me={me} /></Suspense>;

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
      {room.tournament && <TournamentBar info={room.tournament} status={room.status} skew={skew} />}
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
