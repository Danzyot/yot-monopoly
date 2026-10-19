import { Suspense, lazy, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { call, useConnected, useRoomList } from '../net.ts';
import { getToken } from '../api.ts';
import { THEMES, resolveTheme } from '../../../shared/themes.ts';
import { MAPS, getMap } from '../../../shared/maps.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { CARDS_MAX_PLAYERS, CARDS_MIN_PLAYERS } from '../../../shared/cards/meta.ts';
import { CHARACTER_DEFS, type CharacterDef, type CharacterId } from '../../../shared/characters.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { requirementBadge, requirementSentence } from '../community.tsx';
import { useCardsRoomList } from '../cards/net.ts';
import { pokerHref } from '../pokerLink.ts';

// The home page has no WebGL at all: the board behind the hero is a still
// (client/public/home/, drifted by styles/home.css), so the page is up at once
// and the mouse wheel scrolls it. "How to play" lists the camera views, which
// live beside three.js, so its dialog is fetched when it is wanted (or the
// pointer heads for the button), never with the page.
const loadHowToPlay = () => import('../components/HowToPlay.tsx');
const HowToPlay = lazy(loadHowToPlay);

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: '🎮', title: 'Pick a game', body: `${GAMES.monopoly.name}, ${GAMES.cards.name} or ${GAMES.poker.name}. One sign-in works across all three.` },
  { icon: '🔗', title: 'Share the code', body: 'Every table has a five-letter code and an invite link — phones welcome. Short on people? Bots fill in.' },
  { icon: '🏆', title: 'Play', body: 'Roll, shed your hand or shove all-in. Wins against real people count on the leaderboard.' },
];

/** The hub's "tables open now" line under a game card. */
function liveLine(connected: boolean, open: number, playing: number): string {
  if (!connected) return 'Connecting…';
  if (open === 0) return 'No tables open — start one!';
  return `${open} table${open === 1 ? '' : 's'} open now${playing ? ` · ${playing} playing` : ''}`;
}

/** The two characters the home page puts first. */
const FEATURED: CharacterId[] = ['snacky', 'starer'];

/** The hero's "How to play" button; the same as components/HowToPlay's HowToPlayButton, without its code in the page. */
function HowToButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const warm = () => { void loadHowToPlay(); };
  return (
    <>
      <button type="button" className="btn small ghost" onPointerEnter={warm} onFocus={warm}
        onClick={() => { setOpen(true); void loadHowToPlay().then(m => m.markHowToSeen()); }}>{label}</button>
      {open && createPortal(<Suspense fallback={null}><HowToPlay onClose={() => setOpen(false)} /></Suspense>, document.body)}
    </>
  );
}

export default function Home() {
  const nav = useNavigate();
  const { profile, config, ready, openSignIn } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = useRoomList();
  const cardTables = useCardsRoomList();
  const connected = useConnected();
  const canCreate = !!profile && (config.features.publicRooms || profile.isAdmin);
  // While a stored sign-in is still being checked, show the button it will most
  // likely turn into, so the hero does not change shape a moment after it appears.
  const checking = !ready && !!getToken();

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
  const cardsLive = cardTables.filter(r => r.status !== 'lobby').length;
  // Names come from the catalogue, so a rename there shows up here.
  const featured = FEATURED.map(id => CHARACTER_DEFS.find(c => c.id === id)).filter((c): c is CharacterDef => !!c);
  const others = CHARACTER_DEFS.filter(c => !FEATURED.includes(c.id));

  return (
    <div className="home">
      {/* The board in its room behind the hero, drifting slowly: shows what the game is before a word is read. */}
      <div className="home-bg home-still" aria-hidden />

      <section className="home-hero gd hub-hero">
        <h1>{BRAND.name}</h1>
        <p className="home-tag">Monopoly, cards and poker with the Chog crew.</p>
        <div className="hero-howto">
          <HowToButton label="❓ New here? How to play" />
          <Link className="btn small ghost" to="/characters">🎭 Meet the characters</Link>
        </div>
      </section>

      {/* The hub: one card per game, with what is on right now. Monopoly's "Play"
          is the old hero button (create a table, or sign in first); Cards has its
          own home at /cards; Poker is its own site, reached with the sign-in in hand. */}
      <section className="hub" aria-labelledby="hub-title">
        <h2 id="hub-title" className="sr-only">Pick a game</h2>
        <ul className="hub-games">
          <li className="hub-game hub-monopoly">
            <img className="hub-thumb" src="/home/monopoly-640.webp" alt="" width={640} height={400} decoding="async" />
            <div className="hub-text">
              <h3>{GAMES.monopoly.name}</h3>
              <p>Buy, build and trade on three 3D boards, with the Chog crew as your pieces.</p>
              <span className="hub-meta">2–8 players · 45 min</span>
              <span className="hub-live" role="status">{liveLine(connected, rooms.length, live)}</span>
            </div>
            <div className="hub-actions">
              {profile || checking ? (
                <button className="btn primary hub-play" disabled={busy || !connected || !canCreate} onClick={create}>
                  {canCreate || checking ? `Play ${GAMES.monopoly.name}` : 'Tables are operators-only right now'}
                </button>
              ) : (
                <button className="btn primary hub-play" onClick={openSignIn}>Sign in to play</button>
              )}
              <form className="hub-join" onSubmit={e => { e.preventDefault(); join(code); }}>
                <input className="code-input" value={code} maxLength={5} placeholder="CODE" aria-label="Room code"
                  autoCapitalize="characters" autoComplete="off" spellCheck={false}
                  onChange={e => setCode(e.target.value.toUpperCase())} />
                <button className="btn gold small" type="submit">Join</button>
              </form>
            </div>
          </li>

          <li className="hub-game hub-cards">
            <img className="hub-thumb" src="/home/cards-640.webp" alt="" width={640} height={400} loading="lazy" decoding="async" />
            <div className="hub-text">
              <h3>{GAMES.cards.name}</h3>
              <p>Match colour, number or symbol and shed your hand first. Fast rounds, big tables.</p>
              <span className="hub-meta">{CARDS_MIN_PLAYERS}–{CARDS_MAX_PLAYERS} players · 15 min</span>
              <span className="hub-live" role="status">{liveLine(connected, cardTables.length, cardsLive)}</span>
            </div>
            <div className="hub-actions">
              <Link className="btn primary hub-play" to={GAMES.cards.path}>Play Cards</Link>
            </div>
          </li>

          <li className="hub-game hub-poker">
            <img className="hub-thumb" src="/home/poker-640.webp" alt="" width={640} height={400} loading="lazy" decoding="async" />
            <div className="hub-text">
              <h3>{GAMES.poker.name}</h3>
              <p>No-Limit Hold'em: cash tables you share by link, and tournaments for the whole club.</p>
              <span className="hub-meta">2–9 per table · cash & tournaments</span>
              <span className="hub-live">{profile ? 'Its own site — you stay signed in' : 'On its own site'}</span>
            </div>
            <div className="hub-actions">
              <a className="btn primary hub-play" href={pokerHref(profile ? getToken() : null)}>Play Poker</a>
            </div>
          </li>
        </ul>
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
                const theme = resolveTheme(r.themeId, r.mapId);
                const open = r.status === 'lobby';
                return (
                  <li key={r.code} className={`room-card ${r.status}`}>
                    <img className="room-thumb" src={`/maps/${map.id}.webp`} alt="" width={84} height={58} loading="lazy" decoding="async" />
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
                <img className="map-thumb" src={`/maps/${m.id}.webp`} alt="" width={320} height={200} loading="lazy" decoding="async" />
                <b>{m.name}</b>
                <span className="small muted">{m.description}</span>
                <span className="info-meta">{m.spaces.length} spaces · {m.players[0]}–{m.players[1]} players · {m.look.name} look</span>
              </div>
            ))}
          </div>
          <h2 className="mt" id="editions-title">Themes</h2>
          <p className="muted small">Any theme on any board. Original keeps each board’s own look.</p>
          <div className="card-grid">
            {THEMES.map(t => (
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
      </div>
    </div>
  );
}
