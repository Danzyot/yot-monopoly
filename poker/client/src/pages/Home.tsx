import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { LobbyTournament, LobbyView } from '../../../shared/types';
import { useAuth } from '../auth';
import AuthModal from '../components/AuthModal';
import { BRAND } from '../../../shared/brand';
import ChogLogo from '../components/ChogLogo';
import Promo from '../components/Promo';
import { CreateTournamentModal } from '../components/CreateModals';
import { getSocket, withResub } from '../socket';
import { fieldLabel, groupTournaments, startLabel } from '../tourneys';

// Finished events stay on the home page long enough to find a result, not forever.
const RECENT_FINISHED = 5;

function TourneyRow({ t }: { t: LobbyTournament }) {
  const winner = t.state === 'finished' ? t.topPlayers.find(p => p.place === 1) : null;
  const meta = t.state === 'registering' ? `${startLabel(t.scheduledStart)} · ${fieldLabel(t)}`
    : t.state === 'finished' ? (winner ? `Won by ${winner.name}` : fieldLabel(t))
    : `${fieldLabel(t)} · level ${t.level}`;
  return (
    <Link className="live-game-row" to={`/t/${t.id}`}>
      <span className="lg-name">{t.name}</span>
      <span className={`state-badge state-${t.state}`}>
        {t.state === 'registering' ? 'Registering' : t.state}
      </span>
      <span className="lg-meta">
        {meta}
        {t.playerHosted && <> · Hosted by {t.hostName}</>}
      </span>
    </Link>
  );
}

// Signed-in players used to hit a dead end here ("open your invite link").
// Show them the tournaments — playing now, coming up, just finished — so they
// can join or look up a result without one.
function Tournaments() {
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

  const { live, upcoming, finished } = groupTournaments(lobby?.tournaments ?? []);
  if (live.length + upcoming.length + finished.length === 0) {
    return (
      <p className="tag" style={{ fontWeight: 600 }}>
        No tournaments right now — check back soon, or ask the host for an invite link.
      </p>
    );
  }
  const group = (title: string, rows: LobbyTournament[]) => rows.length > 0 && (
    <>
      <div className="lg-group">{title}</div>
      {rows.map(t => <TourneyRow key={t.id} t={t} />)}
    </>
  );
  return (
    <div className="live-games">
      {group('Live now', live)}
      {group('Upcoming', upcoming)}
      {group('Recently finished', finished.slice(0, RECENT_FINISHED))}
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const { profile, canHost } = useAuth();
  const [modal, setModal] = useState<'auth' | 'tournament' | null>(null);
  const isAdmin = !!profile?.isAdmin;

  // The hub's "Host a tournament" lands here as /?host=1: open the create form
  // once this room agrees they may host (that answer arrives a moment after
  // the sign-in does), and drop the flag so a reload does not reopen it.
  const [params, setParams] = useSearchParams();
  const hostAsked = params.get('host') === '1';
  useEffect(() => {
    if (!hostAsked || !canHost) return;
    setModal('tournament');
    setParams(p => { p.delete('host'); return p; }, { replace: true });
  }, [hostAsked, canHost, setParams]);

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
              {isAdmin && (
                <button className="btn btn-ghost btn-lg" onClick={() => nav('/lobby')}>
                  Dashboard →
                </button>
              )}
            </div>
            {/* A player host still wants to find the tournaments on now,
                their own included. Operators have the dashboard for that. */}
            {!isAdmin && <Tournaments />}
          </>
        ) : profile ? (
          <Tournaments />
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
    </main>
  );
}
