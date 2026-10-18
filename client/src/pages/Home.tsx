import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { call, useConnected, useRoomList } from '../net.ts';
import { THEMES, getTheme } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { BRAND } from '../../../shared/brand.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { requirementBadge, requirementSentence } from '../community.tsx';
import BoardScene from '../three/BoardScene.tsx';
import { HowToPlayButton } from '../components/HowToPlay.tsx';

export default function Home() {
  const nav = useNavigate();
  const { profile, config, openSignIn } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = useRoomList();
  const connected = useConnected();
  const canCreate = !!profile && (config.features.publicRooms || profile.isAdmin);

  const create = async () => {
    if (!profile) return openSignIn();
    setBusy(true);
    try {
      const r = await call<{ code: string }>('room:create');
      nav(`/r/${r.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const join = (c: string) => {
    const clean = c.trim().toUpperCase();
    if (clean.length < 4) return toastError(new Error('Enter a room code'));
    nav(`/r/${clean}`);
  };

  const live = rooms.filter(r => r.status !== 'lobby').length;

  return (
    <div className="home">
      {/* A live board slowly turning behind the hero: shows what the game is before a word is read. */}
      <div className="home-bg" aria-hidden><BoardScene themeId="classic" mapId="classic" game={null} spin /></div>

      <section className="home-hero">
        <h1>{BRAND.name}</h1>
        <p className="home-tag">Roll the dice. Buy it all. Bankrupt your friends!</p>
        <div className="hero-actions">
          {profile ? (
            <button className="btn primary hero-cta" disabled={busy || !connected || !canCreate} onClick={create}>
              {canCreate ? 'Create Game' : 'Room creation is operators-only right now'}
            </button>
          ) : (
            <button className="btn primary hero-cta" onClick={openSignIn}>Sign In to Play</button>
          )}
          <form className="hero-join" onSubmit={e => { e.preventDefault(); join(code); }}>
            <input className="code-input" value={code} maxLength={5} placeholder="CODE" aria-label="Room code"
              onChange={e => setCode(e.target.value.toUpperCase())} />
            <button className="btn gold" type="submit">Join!</button>
          </form>
        </div>
        <div className="hero-howto">
          <HowToPlayButton className="btn small ghost" label="❓ New here? How to play" />
          <Link className="btn small ghost" to="/characters">🎭 Meet the characters</Link>
        </div>
        <p className="hero-status muted small">
          {!connected ? 'Connecting to server…'
            : rooms.length === 0 ? 'No tables open yet — start one and invite your friends!'
              : `${rooms.length} open table${rooms.length === 1 ? '' : 's'}${live ? ` · ${live} playing` : ''}`}
        </p>
      </section>

      <div className="home-body">
        {rooms.length > 0 && (
          <section className="panel">
            <h2>Live Tables</h2>
            <ul className="room-list">
              {rooms.map(r => (
                <li key={r.code}>
                  <span className={`room-status ${r.status}`}>{r.status === 'lobby' ? 'Open' : 'Playing'}</span>
                  <div className="grow">
                    <b className="mono">{r.code}</b> · {getMap(r.mapId).name === getTheme(r.themeId).name ? getMap(r.mapId).name : `${getMap(r.mapId).name} · ${getTheme(r.themeId).name}`}
                    {r.requirements && <em className="tag req-tag" title={requirementSentence(r.requirements)}>🔒 {requirementBadge(r.requirements)}</em>}
                    <div className="muted small">host {r.hostName} · {r.players}/{r.maxPlayers} players</div>
                  </div>
                  <button className={`btn small ${r.status === 'lobby' ? 'primary' : ''}`} onClick={() => join(r.code)}>
                    {r.status === 'lobby' ? 'Join!' : 'Watch'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel">
          <h2>Boards</h2>
          <div className="card-grid">
            {MAPS.map(m => (
              <div key={m.id} className="info-card">
                <img className="map-thumb" src={`/maps/${m.id}.webp`} alt="" loading="lazy" />
                <b>{m.name}</b>
                <span className="small muted">{m.description}</span>
                <span className="info-meta">{m.spaces.length} spaces · {m.players[0]}–{m.players[1]} players</span>
              </div>
            ))}
          </div>
          <h2 className="mt">Editions</h2>
          <div className="card-grid">
            {THEMES.map(t => (
              <div key={t.id} className="info-card edition-card" style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.palette.boardLine }}>
                <div className="row">
                  {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" />}
                  <b>{t.name}</b>
                </div>
                <div className="swatches">
                  {Object.values(t.groupColors).slice(0, 8).map(c => <i key={c} style={{ background: c }} />)}
                </div>
                <span className="small">{t.tagline}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
