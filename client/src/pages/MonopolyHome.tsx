// /monopoly: the Monopoly home, as /cards is Chog Cards'. Open a table (or
// sign in first), join one by code or from the live list, how a game goes in
// three steps, the boards and their look, and the top players. The hub at /
// is about all three games; this page is about this one.
//
// No WebGL here either: the board behind the hero is the same drifting still
// as the hub's (styles/home.css, preloaded by index.html), and "How to play"
// fetches its dialog (which lists the camera views, beside three.js) only
// when it is wanted.
import { Suspense, lazy, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { call, useConnected, useRoomList } from '../net.ts';
import { api, getToken } from '../api.ts';
import { THEMES, getTheme, resolveTheme } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { CHOG_SEASON, SEASON_THEME_ID, mapThumbUrl, themeAvailable } from '../../../shared/season.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { requirementBadge, requirementSentence } from '../community.tsx';
import MonopolyDailyCard from '../monopolyDaily/MonopolyDailyCard.tsx';
import '../styles/monopoly-home.css';

const loadHowToPlay = () => import('../components/HowToPlay.tsx');
const HowToPlay = lazy(loadHowToPlay);

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: '🎩', title: 'Open a table', body: 'Pick a board, the house rules and how long it runs. Bots fill the empty seats.' },
  { icon: '🔗', title: 'Share the code', body: 'Friends join with the five-letter code or the invite link, on a phone or a laptop.' },
  { icon: '🏠', title: 'Buy it all', body: 'Roll, buy, trade and build. Last one standing wins; wins against real people count on the leaderboard.' },
];

interface Leader { id: string; name: string; games: number; wins: number; points: number }

/** The hero's "How to play" button: components/HowToPlay's HowToPlayButton, without its code in the page. */
function HowToButton() {
  const [open, setOpen] = useState(false);
  const warm = () => { void loadHowToPlay(); };
  return (
    <>
      <button type="button" className="btn small ghost" onPointerEnter={warm} onFocus={warm} aria-label="How to play Monopoly"
        onClick={() => { setOpen(true); void loadHowToPlay().then(m => m.markHowToSeen()); }}>❓ How to play</button>
      {open && createPortal(<Suspense fallback={null}><HowToPlay onClose={() => setOpen(false)} /></Suspense>, document.body)}
    </>
  );
}

export default function MonopolyHome() {
  const nav = useNavigate();
  const { profile, config, ready, openSignIn } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const rooms = useRoomList();
  const connected = useConnected();
  const canCreate = !!profile && (config.features.publicRooms || profile.isAdmin);
  // While a stored sign-in is still being checked, show the button it will most
  // likely turn into, so the hero does not change shape a moment after it appears.
  const checking = !ready && !!getToken();

  useEffect(() => {
    document.title = `${GAMES.monopoly.name} · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);
  useEffect(() => {
    if (!config.features.leaderboard) return;
    api<Leader[]>('/api/leaderboard').then(r => setLeaders(r.slice(0, 5))).catch(() => {});
  }, [config.features.leaderboard]);

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
  const looks = THEMES.filter(t => themeAvailable(t.id));

  return (
    <div className="home mono-home">
      {/* The board in its room behind the hero, drifting slowly. */}
      <div className="home-bg home-still" aria-hidden />

      <section className="home-hero gd mono-hero">
        <h1>{GAMES.monopoly.name}</h1>
        <p className="home-tag">Roll the dice. Buy it all. Bankrupt your friends!</p>
        <div className="hero-actions">
          {profile || checking ? (
            <button className="btn primary hero-cta mono-play" disabled={busy || !connected || !canCreate} onClick={create}>
              {canCreate || checking ? `Play ${GAMES.monopoly.name}` : 'Tables are operators-only right now'}
            </button>
          ) : (
            <button className="btn primary hero-cta mono-play" onClick={openSignIn}>Play {GAMES.monopoly.name}</button>
          )}
          <form className="hero-join" onSubmit={e => { e.preventDefault(); join(code); }}>
            <input className="code-input" value={code} maxLength={5} placeholder="CODE" aria-label="Room code"
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              onChange={e => setCode(e.target.value.toUpperCase())} />
            <button className="btn gold" type="submit">Join!</button>
          </form>
        </div>
        <div className="hero-howto">
          <HowToButton />
          <Link className="btn small ghost" to="/characters">{CHOG_SEASON ? '💜 Meet Chog' : '🎭 Characters'}</Link>
        </div>
        <p className="hero-status muted small" role="status">
          {!connected ? 'Connecting…'
            : rooms.length === 0 ? 'No tables open yet — start one and invite your friends!'
              : `${rooms.length} table${rooms.length === 1 ? '' : 's'} open${live ? ` · ${live} playing` : ''}`}
        </p>
      </section>

      <div className="home-body">
        {/* Today's Daily Challenge: one seeded game for everyone, one try each. */}
        <MonopolyDailyCard />

        {rooms.length > 0 && (
          <section className="panel" aria-labelledby="tables-title">
            <h2 id="tables-title">Live tables</h2>
            <ul className="room-cards">
              {rooms.map(r => {
                const map = getMap(r.mapId);
                const theme = resolveTheme(r.themeId, r.mapId);
                const open = r.status === 'lobby';
                return (
                  <li key={r.code} className={`room-card ${r.status}`}>
                    <img className="room-thumb" src={mapThumbUrl(map.id)} alt="" width={84} height={58} loading="lazy" decoding="async" />
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
                      {open ? 'Join' : 'Watch'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="panel how-panel" aria-labelledby="mono-how">
          <h2 id="mono-how">How it works</h2>
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

        <section className="panel" aria-labelledby="boards-title">
          <h2 id="boards-title">Boards</h2>
          <div className="card-grid">
            {MAPS.map(m => (
              <div key={m.id} className="info-card">
                <img className="map-thumb" src={mapThumbUrl(m.id)} alt="" width={320} height={200} loading="lazy" decoding="async" />
                <b>{m.name}</b>
                <span className="small muted">{m.description}</span>
                <span className="info-meta">{m.spaces.length} spaces · {m.players[0]}–{m.players[1]} players · {CHOG_SEASON ? `${getTheme(SEASON_THEME_ID).name} look` : `${m.look.name} look`}</span>
              </div>
            ))}
          </div>
          <h2 className="mt" id="editions-title">{looks.length === 1 ? 'The look' : 'Themes'}</h2>
          <p className="muted small">{looks.length === 1 ? `Every board is in the ${looks[0].name} look right now.` : 'Any theme on any board. Original keeps each board’s own look.'}</p>
          <div className="card-grid">
            {looks.map(t => (
              <div key={t.id} className="info-card edition-card" style={{ background: t.palette.board, color: t.palette.boardText, borderColor: t.palette.boardLine }}>
                <div className="row">
                  {t.logoUrl && <img className="edition-logo" src={t.logoUrl} alt="" width={34} height={34} loading="lazy" decoding="async" />}
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

        {leaders.length > 0 && (
          <section className="panel" aria-labelledby="mono-top">
            <h2 id="mono-top">Top players</h2>
            <ol className="mono-leaders">
              {leaders.map(l => <li key={l.id}><b>{l.name}</b> <span className="muted small">{l.wins} win{l.wins === 1 ? '' : 's'} · {l.games} game{l.games === 1 ? '' : 's'}</span></li>)}
            </ol>
            <Link className="small" to="/leaderboard">Full leaderboard →</Link>
          </section>
        )}
        <p className="mono-foot muted small"><Link to="/">← All {BRAND.name}</Link></p>
      </div>
    </div>
  );
}
