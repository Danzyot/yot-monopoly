import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { call, useConnected, useRoomList } from '../net.ts';
import { THEMES, getTheme } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { BRAND } from '../../../shared/brand.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';

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

  return (
    <div className="home">
      <div className="home-hero">
        <div className="logo">🎩</div>
        <h1>{BRAND.name}</h1>
        <p className="muted">Buy it all. Bankrupt your friends. Several maps and editions, many tables at once.</p>
      </div>

      <div className="home-grid">
        <section className="panel">
          <h2>Play</h2>
          {profile ? (
            <button className="btn primary big" disabled={busy || !connected || !canCreate} onClick={create}>
              {canCreate ? 'Create a game' : 'Room creation is operators-only right now'}
            </button>
          ) : (
            <button className="btn primary big" onClick={openSignIn}>Sign in to play</button>
          )}
          <div className="or">or join with a code</div>
          <form className="row" onSubmit={e => { e.preventDefault(); join(code); }}>
            <input className="code-input" value={code} maxLength={5} placeholder="ABCDE"
              onChange={e => setCode(e.target.value.toUpperCase())} />
            <button className="btn" type="submit">Join</button>
          </form>
          {!connected && <p className="muted small">Connecting to server…</p>}
        </section>

        <section className="panel">
          <h2>Open tables</h2>
          {rooms.length === 0 && <p className="muted">No games right now — start one.</p>}
          <ul className="room-list">
            {rooms.map(r => (
              <li key={r.code}>
                <div>
                  <b className="mono">{r.code}</b> · {getMap(r.mapId).name} · {getTheme(r.themeId).name}
                  <div className="muted small">host {r.hostName} · {r.players}/{r.maxPlayers} players</div>
                </div>
                <button className="btn small" onClick={() => join(r.code)}>
                  {r.status === 'lobby' ? 'Join' : 'Watch'}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel wide">
          <h2>Maps</h2>
          <div className="editions">
            {MAPS.map(m => (
              <div key={m.id} className="edition map-card">
                <b>{m.name}</b>
                <span className="small muted">{m.description}</span>
                <span className="small">{m.spaces.length} spaces · {m.players[0]}–{m.players[1]} players</span>
              </div>
            ))}
          </div>
          <h2 style={{ marginTop: 18 }}>Editions</h2>
          <div className="editions">
            {THEMES.map(t => (
              <div key={t.id} className="edition" style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.palette.boardLine }}>
                {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" />}
                <div className="swatches">
                  {Object.values(t.groupColors).slice(0, 8).map(c => <i key={c} style={{ background: c }} />)}
                </div>
                <b>{t.name}</b>
                <span className="small">{t.tagline}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
