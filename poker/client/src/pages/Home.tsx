import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LobbyView } from '../../../shared/types';
import { useAuth } from '../auth';
import AuthModal from '../components/AuthModal';
import { BRAND } from '../../../shared/brand';
import ChogLogo from '../components/ChogLogo';
import Promo from '../components/Promo';
import { CreateCashModal, CreateTournamentModal } from '../components/CreateModals';
import { getSocket, withResub } from '../socket';

// Signed-in players used to hit a dead end here ("open your invite link").
// Show them what's actually running so they can join without one.
function LiveGames() {
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  useEffect(() => {
    const sock = getSocket();
    const onState = (v: LobbyView) => setLobby(v);
    sock.on('lobby:state', onState);
    const cleanup = withResub(() => sock.emit('lobby:sub'));
    return () => {
      cleanup();
      sock.emit('lobby:unsub');
      sock.off('lobby:state', onState);
    };
  }, []);

  const tournaments = (lobby?.tournaments ?? [])
    .filter(t => t.state !== 'finished' && t.state !== 'cancelled');
  const cashTables = lobby?.cashTables ?? [];
  if (tournaments.length === 0 && cashTables.length === 0) {
    return (
      <p className="tag" style={{ fontWeight: 600 }}>
        No games running right now — check back soon, or ask the host for an invite link.
      </p>
    );
  }
  return (
    <div className="live-games">
      {tournaments.map(t => (
        <Link key={t.id} className="live-game-row" to={`/t/${t.id}`}>
          <span className="lg-name">{t.name}</span>
          <span className={`state-badge state-${t.state}`}>
            {t.state === 'registering' ? 'Registering' : t.state}
          </span>
          <span className="lg-meta">
            {t.players} player{t.players === 1 ? '' : 's'}
            {t.playerHosted && <> · Hosted by {t.hostName}</>}
          </span>
        </Link>
      ))}
      {cashTables.map(t => (
        <Link key={t.id} className="live-game-row" to={`/table/${t.id}`}>
          <span className="lg-name">{t.name}</span>
          <span className="state-badge state-running">{t.sb}/{t.bb}</span>
          <span className="lg-meta">
            {t.players}/{t.maxSeats} seats
            {t.playerHosted && <> · Hosted by {t.hostName}</>}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const { profile, canHost } = useAuth();
  const [modal, setModal] = useState<'auth' | 'tournament' | 'cash' | null>(null);
  const isAdmin = !!profile?.isAdmin;

  return (
    <main className="page landing">
      <section className="landing-card">
        <div className="landing-mark"><ChogLogo className="brand-mark" height={96} /></div>
        <h1>{BRAND.org} <span className="accent">Poker</span></h1>
        {/* The second sentence is an instruction, so it only belongs in front
            of someone who still has to follow it. */}
        <p className="tag">
          Tournament poker for the {BRAND.org} community.
          {!profile && ' Sign in to see the games you have been invited to.'}
        </p>

        {canHost ? (
          <>
            <div className="landing-actions">
              <button className="btn btn-primary btn-lg" onClick={() => setModal('tournament')}>
                Host a tournament
              </button>
              <button className="btn btn-lg" onClick={() => setModal('cash')}>
                Start a cash game
              </button>
              {isAdmin && (
                <button className="btn btn-ghost btn-lg" onClick={() => nav('/lobby')}>
                  Dashboard →
                </button>
              )}
            </div>
            {/* A player host still wants to find the games running now,
                their own included. Operators have the dashboard for that. */}
            {!isAdmin && <LiveGames />}
          </>
        ) : profile ? (
          <LiveGames />
        ) : (
          /* The label named Discord unconditionally, on a deployment that may
             not have Discord configured at all — and then the modal it opens
             offers a name box instead, which reads as the site being broken.
             It says what it opens, and the modal says what is available. */
          <button className="btn btn-lit btn-lg" onClick={() => setModal('auth')}>
            Sign in
          </button>
        )}
      </section>

      <Promo />

      {modal === 'auth' && <AuthModal onClose={() => setModal(null)} />}
      {modal === 'tournament' && <CreateTournamentModal onClose={() => setModal(null)} />}
      {modal === 'cash' && <CreateCashModal onClose={() => setModal(null)} />}
    </main>
  );
}
