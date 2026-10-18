import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { call, useConnected, useRoomList } from '../net.ts';
import { THEMES, getTheme } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { BRAND } from '../../../shared/brand.ts';
import { CHARACTER_DEFS, type CharacterDef, type CharacterId } from '../../../shared/characters.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { requirementBadge, requirementSentence } from '../community.tsx';
import BoardScene from '../three/BoardScene.tsx';
import { preloadEnvironment } from '../three/environments/index.tsx';
import { HowToPlayButton } from '../components/HowToPlay.tsx';

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: '🎲', title: 'Create a table', body: 'Pick a board, an edition and your house rules. Sign in with just a name.' },
  { icon: '🔗', title: 'Share the code', body: 'Friends join with the five-letter code or the invite link — phones welcome. Short on people? Bots fill in.' },
  { icon: '🚀', title: 'Roll', body: 'Buy, build, trade and auction your way to the last player standing.' },
];

/** The rooms the hero tours, one at a time, with a dip to dark between them. */
const DIORAMA: { themeId: string; mapId: string }[] = [
  { themeId: 'classic', mapId: 'classic' }, { themeId: 'chog', mapId: 'classic' }, { themeId: 'classic', mapId: 'speed' },
  { themeId: 'tptv', mapId: 'classic' }, { themeId: 'classic', mapId: 'metropolis' },
];
/** The two characters the home page puts first. */
const FEATURED: CharacterId[] = ['snacky', 'starer'];
const DIORAMA_MS = 16000;
const DIP_MS = 900;

function useDiorama(): [{ themeId: string; mapId: string }, boolean] {
  const [i, setI] = useState(0);
  const [dim, setDim] = useState(false);
  useEffect(() => {
    // Stay on one room for people who have asked their system for less motion.
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let swap: ReturnType<typeof setTimeout> | null = null;
    let at = 0;
    // Fetch the next room while this one is on, so the swap is seamless.
    const ahead = () => { const n = DIORAMA[(at + 1) % DIORAMA.length]; preloadEnvironment(getMap(n.mapId).environment, n.themeId); };
    const warm = setTimeout(ahead, 3000);
    const tick = setInterval(() => {
      setDim(true);
      swap = setTimeout(() => { at = (at + 1) % DIORAMA.length; setI(at); setDim(false); ahead(); }, DIP_MS);
    }, DIORAMA_MS);
    return () => { clearInterval(tick); clearTimeout(warm); if (swap) clearTimeout(swap); };
  }, []);
  return [DIORAMA[i], dim];
}

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
  const [scene, dim] = useDiorama();
  // Names come from the catalogue, so a rename there shows up here.
  const featured = FEATURED.map(id => CHARACTER_DEFS.find(c => c.id === id)).filter((c): c is CharacterDef => !!c);
  const others = CHARACTER_DEFS.filter(c => !FEATURED.includes(c.id));

  return (
    <div className="home">
      {/* A live board slowly turning behind the hero, touring every room: shows what the game is before a word is read. */}
      <div className={`home-bg ${dim ? 'dim' : ''}`} aria-hidden><BoardScene themeId={scene.themeId} mapId={scene.mapId} game={null} spin /></div>

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
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              onChange={e => setCode(e.target.value.toUpperCase())} />
            <button className="btn gold" type="submit">Join!</button>
          </form>
        </div>
        <div className="hero-howto">
          <HowToPlayButton className="btn small ghost" label="❓ New here? How to play" />
          <Link className="btn small ghost" to="/characters">🎭 Meet the characters</Link>
        </div>
        <p className="hero-status muted small" role="status">
          {!connected ? 'Connecting to server…'
            : rooms.length === 0 ? 'No tables open yet — start one and invite your friends!'
              : `${rooms.length} open table${rooms.length === 1 ? '' : 's'}${live ? ` · ${live} playing` : ''}`}
        </p>
      </section>

      {/* The cast: the two stars up front, everyone else a tap away on /characters. */}
      <section className="cast" aria-labelledby="cast-title">
        <div className="cast-head">
          <h2 id="cast-title">Meet the characters</h2>
          <Link className="cast-all" to="/characters">See all characters →</Link>
        </div>
        <div className="cast-stars">
          {featured.map(c => (
            <Link key={c.id} to="/characters" className="cast-star" aria-label={`${c.name}: ${c.blurb}`}>
              <span className="cast-emoji" aria-hidden>{c.emoji}</span>
              <span className="cast-text"><b>{c.name}</b><span>{c.blurb}</span></span>
            </Link>
          ))}
        </div>
        <p className="cast-more">
          <span className="cast-dots" aria-hidden>{others.map(c => <i key={c.id} title={c.name}>{c.emoji}</i>)}</span>
          <Link to="/characters">+ {others.length} more to play as</Link>
        </p>
      </section>

      <div className="home-body">
        <section className="panel how-panel" aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ol className="how-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="how-icon" aria-hidden>{s.icon}</span>
                <b><span className="how-n">{i + 1}</span>{s.title}</b>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {rooms.length > 0 && (
          <section className="panel" aria-labelledby="tables-title">
            <h2 id="tables-title">Live Tables</h2>
            <ul className="room-cards">
              {rooms.map(r => {
                const map = getMap(r.mapId);
                const theme = getTheme(r.themeId);
                const open = r.status === 'lobby';
                return (
                  <li key={r.code} className={`room-card ${r.status}`}>
                    <img className="room-thumb" src={`/maps/${map.id}.webp`} alt="" loading="lazy" />
                    <div className="room-main">
                      <div className="room-top">
                        <b className="mono room-code">{r.code}</b>
                        <span className={`room-status ${r.status}`}>{open ? 'Open' : 'Playing'}</span>
                      </div>
                      <div className="room-chips">
                        <span className="chip">{map.name}</span>
                        <span className="chip edition-chip" style={{ background: theme.palette.board, color: theme.palette.boardText, borderColor: theme.palette.accent }}>
                          {theme.name}
                        </span>
                        {r.requirements && <em className="tag req-tag" title={requirementSentence(r.requirements)}>🔒 {requirementBadge(r.requirements)}</em>}
                      </div>
                      <div className="muted small room-meta">host {r.hostName} · <b>{r.players}/{r.maxPlayers}</b> players</div>
                    </div>
                    <button className={`btn small ${open ? 'primary' : ''}`} onClick={() => join(r.code)}
                      aria-label={`${open ? 'Join' : 'Watch'} table ${r.code}`}>
                      {open ? 'Join!' : 'Watch'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="panel" aria-labelledby="boards-title">
          <h2 id="boards-title">Boards</h2>
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
          <h2 className="mt" id="editions-title">Editions</h2>
          <div className="card-grid">
            {THEMES.map(t => (
              <div key={t.id} className="info-card edition-card" style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.palette.boardLine }}>
                <div className="row">
                  {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" />}
                  <b>{t.name}</b>
                </div>
                <div className="swatches" aria-hidden>
                  {Object.values(t.groupColors).slice(0, 8).map((c, i) => <i key={`${c}${i}`} style={{ background: c }} />)}
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
