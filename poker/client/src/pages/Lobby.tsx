import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { LobbyTournament, LobbyView } from '../../../shared/types';
import { api } from '../api';
import { useAuth } from '../auth';
import AuthModal from '../components/AuthModal';
import Avatar from '../components/Avatar';
import { CreateTournamentModal } from '../components/CreateModals';
import GraphicsManager from '../components/GraphicsManager';
import MusicManager from '../components/MusicManager';
import { LiveGames, PastGames } from '../components/GameManager';
import BanManager from '../components/BanManager';
import ChatSwitch from '../components/ChatSwitch';
import FeatureManager from '../components/FeatureManager';
import VpnBlock from '../components/VpnBlock';
import { useFeatures } from '../features';
import { chips } from '../format';
import { getSocket, withResub } from '../socket';
import { IconChat, IconShield } from '../components/icons';
import { useToast } from '../toast';
import { fieldLabel, groupTournaments, startLabel } from '../tourneys';

const MEDALS = ['🥇', '🥈', '🥉'];

// One state of the lobby — live, upcoming or finished — as a grid of cards.
function TourneyGrid({ title, rows, empty }: { title: string; rows: LobbyTournament[]; empty: string }) {
  const nav = useNavigate();
  return (
    <>
      <div className="section-title">{title}</div>
      {rows.length === 0 ? (
        <div className="empty-note">{empty}</div>
      ) : (
        <div className="game-grid">
          {rows.map(t => (
            <div key={t.id} className="game-card">
              <div className="gc-top">
                <h3>{t.name}</h3>
                {t.hasSocialReq && <span className="req-pill" title="Social requirements to register">Gated</span>}
                {t.playerHosted && <span className="req-pill host-pill" title={`Hosted by ${t.hostName}, a player host — prizes are the host's responsibility`}>Player host</span>}
                <span className={`state-badge state-${t.state}`}>
                  {t.state === 'registering' ? 'Registering' : t.state}
                </span>
              </div>
              <div className="gc-stats">
                <div className="gc-stat"><span className="k">Players</span><span className="v">{fieldLabel(t)}</span></div>
                <div className="gc-stat"><span className="k">Stack</span><span className="v">{chips(t.startingStack)}</span></div>
                <div className="gc-stat"><span className="k">Speed</span><span className="v" style={{ textTransform: 'capitalize' }}>{t.structure}</span></div>
                {t.state !== 'registering' && t.state !== 'finished' && (
                  <div className="gc-stat"><span className="k">Level</span><span className="v">{t.level}</span></div>
                )}
              </div>
              {t.state === 'registering' && <div className="gc-when">{startLabel(t.scheduledStart)}</div>}

              {t.topPlayers.length > 0 && (
                <div className="top-players">
                  {t.topPlayers.map((p, i) => (
                    <div key={i} className="top-player-row">
                      <span className="medal">{t.state === 'finished' ? MEDALS[(p.place ?? i + 1) - 1] ?? p.place : MEDALS[i] ?? '·'}</span>
                      <span className="tp-name"><Avatar value={p.avatar} size={15} chog={p.chog} /> {p.name}</span>
                      <span className="tp-val">
                        {t.state === 'finished'
                          ? p.prize ? `${p.prize.toLocaleString()} cr` : ''
                          : chips(p.stack)}
                      </span>
                    </div>
          ))}
            </div>
          )}

          <div className="gc-actions">
            <button className="btn btn-primary btn-sm" onClick={() => nav(`/t/${t.id}`)}>
              {t.state === 'registering' ? 'Register' : t.state === 'finished' ? 'Results' : 'Open'}
            </button>
            <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem', alignSelf: 'center' }}>
              hosted by {t.hostName}
            </span>
          </div>
        </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function Lobby() {
  const feat = useFeatures();
  const { profile, codeVerifyButton, codeVerifyChannel } = useAuth();
  const toast = useToast();
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [modal, setModal] = useState<'auth' | 'tournament' | null>(null);
  const [postingPanel, setPostingPanel] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);

  // Live server health, refreshed every 5s while the dashboard is open.
  useEffect(() => {
    if (!profile?.isAdmin) return;
    const tick = () => api.health().then(setHealth).catch(() => {});
    tick();
    const iv = setInterval(tick, 5_000);
    return () => clearInterval(iv);
  }, [profile?.isAdmin]);

  const postVerifyPanel = async () => {
    setPostingPanel(true);
    try {
      await api.postVerifyMessage();
      toast('success', `Verify panel posted${codeVerifyChannel ? ` in #${codeVerifyChannel}` : ''}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not post the panel');
    } finally {
      setPostingPanel(false);
    }
  };

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

  const isAdmin = !!profile?.isAdmin;
  const groups = groupTournaments(lobby?.tournaments ?? []);
  const needAuth = (next: 'tournament') => setModal(profile ? next : 'auth');

  // The dashboard is operator-only — players join games through invite links.
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <main className="page">
      <div className="page-head">
        <h2>Dashboard</h2>
        {lobby && <span className="online-pill">{lobby.online} online</span>}
        <div className="spacer" />
        {isAdmin && (
          <>
            {codeVerifyButton && (
              <button
                className="btn btn-sm" disabled={postingPanel}
                title="Post the Verify button panel into the Discord verify channel"
                onClick={() => void postVerifyPanel()}
              >
                {postingPanel ? 'Posting…' : <><IconChat /> Post verify panel</>}
              </button>
            )}
            <Link className="btn btn-sm" to="/audit"><IconShield /> Audit</Link>
            <button className="btn btn-primary" onClick={() => needAuth('tournament')}>New tournament</button>
          </>
        )}
      </div>

      {health && (
        <div className="health-strip">
          <span className="health-pill">{health.sockets} connections</span>
          <span className="health-pill">{health.liveTournaments} live tournaments</span>
          <span className="health-pill">{health.liveTables} tables · {health.seatedPlayers} seated</span>
          {health.liveTournaments > 0 && (
            health.integrityIssues === 0 ? (
              <span className="health-pill ok" title="Every player has exactly one seat, no table is over capacity, table sizes are balanced">
                integrity ✓
              </span>
            ) : (
              <span className="health-pill warn" title="Seat accounting problem detected — check the tournament">
                integrity: {health.integrityIssues} issues
              </span>
            )
          )}
          <span className={`health-pill${health.loopLagMs > 200 ? ' warn' : ''}`}>
            lag {health.loopLagMs}ms
          </span>
          <span className="health-pill">{health.rssMb} MB memory</span>
          <span className="health-pill">
            up {health.uptimeSec >= 3600
              ? `${Math.floor(health.uptimeSec / 3600)}h ${Math.floor((health.uptimeSec % 3600) / 60)}m`
              : `${Math.floor(health.uptimeSec / 60)}m`}
          </span>
          {health.persistentDisk ? (
            <span className="health-pill ok" title="Live games are snapshotted to the volume and survive deploys and crashes">
              crash-safe ✓
            </span>
          ) : (
            <span className="health-pill warn" title="Attach a Railway volume and set DATA_DIR to its mount path so games survive deploys">
              no persistent disk
            </span>
          )}
        </div>
      )}

      {!lobby || lobby.tournaments.length === 0 ? (
        <>
          <div className="section-title">Tournaments</div>
          <div className="empty-note">No tournaments yet — create the first one.</div>
        </>
      ) : (
        <>
          <TourneyGrid title="Live now" rows={groups.live} empty="Nothing is playing right now." />
          <TourneyGrid title="Upcoming" rows={groups.upcoming} empty="Nothing scheduled — create a tournament." />
          <TourneyGrid title="Finished" rows={groups.finished} empty="No finished tournaments on the board." />
        </>
      )}

      <div className="section-title">Features</div>
      <FeatureManager />

      <div className="section-title">Access</div>
      <VpnBlock />

      <div className="section-title">Manage games</div>
      <LiveGames />

      <div className="section-title">Bans</div>
      <ChatSwitch />
      <BanManager />

      <div className="section-title">Past games</div>
      <PastGames />

      {feat.music && (
        <>
          <div className="section-title">Site music</div>
          <MusicManager />
        </>
      )}

      <div className="section-title">Table graphics</div>
      <GraphicsManager />

      {modal === 'auth' && <AuthModal onClose={() => setModal(null)} />}
      {modal === 'tournament' && <CreateTournamentModal onClose={() => setModal(null)} />}
    </main>
  );
}
