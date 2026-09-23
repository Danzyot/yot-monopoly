import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { call, getName, setName, useConnected, useRoomList } from '../net.ts';
import { THEMES, getTheme } from '../../../shared/themes.ts';
import { toastError } from '../toast.tsx';

export default function Home() {
  const nav = useNavigate();
  const [name, setNameState] = useState(getName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = useRoomList();
  const connected = useConnected();

  const needName = () => {
    if (!name.trim()) {
      toastError(new Error('Pick a name first'));
      return true;
    }
    setName(name);
    return false;
  };

  const create = async () => {
    if (needName()) return;
    setBusy(true);
    try {
      const r = await call<{ code: string }>('room:create', { name });
      nav(`/r/${r.code}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const join = (c: string) => {
    if (needName()) return;
    const clean = c.trim().toUpperCase();
    if (clean.length < 4) return toastError(new Error('Enter a room code'));
    nav(`/r/${clean}`);
  };

  return (
    <div className="home">
      <div className="home-hero">
        <div className="logo">🎩</div>
        <h1>Yot Monopoly</h1>
        <p className="muted">Buy it all. Bankrupt your friends. Several editions, many tables at once.</p>
      </div>

      <div className="home-grid">
        <section className="panel">
          <h2>Play</h2>
          <label className="field">
            <span>Your name</span>
            <input value={name} maxLength={20} placeholder="e.g. Rich Uncle"
              onChange={e => { setNameState(e.target.value); setName(e.target.value); }} />
          </label>
          <button className="btn primary big" disabled={busy || !connected} onClick={create}>
            Create a game
          </button>
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
                  <b className="mono">{r.code}</b> · {getTheme(r.themeId).name}
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
          <h2>Editions</h2>
          <div className="editions">
            {THEMES.map(t => (
              <div key={t.id} className="edition" style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.palette.boardLine }}>
                <div className="swatches">
                  {Object.values(t.groupColors).map(c => <i key={c} style={{ background: c }} />)}
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
