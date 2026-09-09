import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { LobbyView } from '../../../shared/types';
import { api } from '../api';
import { useAuth } from '../auth';
import AuthModal from '../components/AuthModal';
import Avatar from '../components/Avatar';
import { CreateCashModal, CreateTournamentModal } from '../components/CreateModals';
import GraphicsManager from '../components/GraphicsManager';
import MusicManager from '../components/MusicManager';
import { LiveGames, PastGames } from '../components/GameManager';
import BanManager from '../components/BanManager';
import ChatSwitch from '../components/ChatSwitch';
import FeatureManager from '../components/FeatureManager';
import { useFeatures } from '../features';
import { chips } from '../format';
import { getSocket, withResub } from '../socket';
import { IconChat, IconShield } from '../components/icons';
import { useToast } from '../toast';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Lobby() {
  const feat = useFeatures();
  const nav = useNavigate();
  const { profile, codeVerifyButton, codeVerifyChannel } = useAuth();
  const toast = useToast();
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [modal, setModal] = useState<'auth' | 'tournament' | 'cash' | null>(null);
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
  const needAuth = (next: 'tournament' | 'cash') => setModal(profile ? next : 'auth');

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
            <button className="btn" onClick={() => needAuth('cash')}>New cash table</button>
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

      <div className="section-title">Tournaments</div>
      {!lobby || lobby.tournaments.length === 0 ? (
        <div className="empty-note">
          {isAdmin ? 'No tournaments yet — create the first one.' : 'No tournaments scheduled right now. Check back soon!'}
        </div>
      ) : (
        <div className="game-grid">
          {lobby.tournaments.map(t => (
            <div key={t.id} className="game-card">
              <div className="gc-top">
                <h3>{t.name}</h3>
                {t.hasSocialReq && <span className="req-pill" title="Social requirements to register">Gated</span>}
                <span className={`state-badge state-${t.state}`}>
                  {t.state === 'registering' ? 'Registering' : t.state}
                </span>
              </div>
              <div className="gc-stats">
                <div className="gc-stat"><span className="k">Players</span><span className="v">{t.players}/{t.maxPlayers}</span></div>
                <div className="gc-stat"><span className="k">Stack</span><span className="v">{chips(t.startingStack)}</span></div>
                <div className="gc-stat"><span className="k">Speed</span><span className="v" style={{ textTransform: 'capitalize' }}>{t.structure}</span></div>
                {t.state !== 'registering' && t.state !== 'finished' && (
                  <div className="gc-stat"><span className="k">Level</span><span className="v">{t.level}</span></div>
                )}
              </div>

              {t.topPlayers.length > 0 && (
                <div className="top-players">
                  {t.topPlayers.map((p, i) => (
                    <div key={i} className="top-player-row">
                      <span className="medal">{t.state === 'finished' ? MEDALS[(p.place ?? i + 1) - 1] ?? p.place : MEDALS[i] ?? '·'}</span>
                      <span className="tp-name"><Avatar value={p.avatar} size={15} /> {p.name}</span>
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

      <div className="section-title">Cash tables</div>
      {!lobby || lobby.cashTables.length === 0 ? (
        <div className="empty-note">
          {isAdmin ? 'No cash tables running — start one.' : 'No cash tables running right now.'}
        </div>
      ) : (
        <div className="game-grid">
          {lobby.cashTables.map(t => (
            <div key={t.id} className="game-card">
              <div className="gc-top">
                <h3>{t.name}</h3>
                <span className="state-badge state-running">{t.sb}/{t.bb}</span>
              </div>
              <div className="gc-stats">
                <div className="gc-stat"><span className="k">Seats</span><span className="v">{t.players}/{t.maxSeats}</span></div>
                <div className="gc-stat"><span className="k">Buy-in</span><span className="v">{chips(t.minBuy)}–{chips(t.maxBuy)}</span></div>
                <div className="gc-stat"><span className="k">Host</span><span className="v">{t.hostName}</span></div>
              </div>
              <div className="gc-actions">
                <button className="btn btn-primary btn-sm" onClick={() => nav(`/table/${t.id}`)}>Join table</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Features</div>
      <FeatureManager />

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
      {modal === 'cash' && <CreateCashModal onClose={() => setModal(null)} />}
    </main>
  );
}
