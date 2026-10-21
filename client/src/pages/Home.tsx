import { Suspense, lazy, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useConnected, useRoomList } from '../net.ts';
import { getToken } from '../api.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { CARDS_MAX_PLAYERS, CARDS_MIN_PLAYERS } from '../../../shared/cards/meta.ts';
import { dailyDate, dailyNumber } from '../../../shared/cards/daily.ts';
import type { CharacterDef, CharacterId } from '../../../shared/characters.ts';
import { CHOG_SEASON, availableCharacters } from '../../../shared/season.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { useCardsRoomList } from '../cards/net.ts';
import { goToPoker, pokerTarget } from '../pokerLink.ts';
import QuickPlay from '../components/QuickPlay.tsx';
import ActivityTicker from '../components/ActivityTicker.tsx';
import ChogOfTheDay from '../components/ChogOfTheDay.tsx';
import ChogRoamer from '../components/roamer/ChogRoamer.tsx';
import { NextTournamentLink } from '../tournaments/NextTournament.tsx';
import { Face } from '../components/CharacterFace.tsx';

// The home page has no WebGL at all: the board behind the hero is a still
// (client/public/home/, drifted by styles/home.css), so the page is up at once
// and the mouse wheel scrolls it. "How to play" lists the camera views, which
// live beside three.js, so its dialog is fetched when it is wanted (or the
// pointer heads for the button), never with the page.
const loadHowToPlay = () => import('../components/HowToPlay.tsx');
const HowToPlay = lazy(loadHowToPlay);
type HowToGame = import('../components/HowToPlay.tsx').HowToGame;

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: '🎮', title: 'Pick a game', body: `${GAMES.monopoly.name}, ${GAMES.cards.name} or ${GAMES.poker.name}. One sign-in works across all three.` },
  { icon: '🔗', title: 'Share the code', body: 'Every table has a five-letter code and an invite link — phones welcome. Short on people? Bots fill in.' },
  { icon: '🏆', title: 'Play', body: CHOG_SEASON
    ? 'Roll, shed your hand or shove all-in, Chog against Chog. Wins against real people count on the leaderboard.'
    : 'Roll, shed your hand or shove all-in. Wins against real people count on the leaderboard.' },
];


/** The game cards' one-liners: Chog-flavoured for the season (shared/season.ts). */
const BLURBS = CHOG_SEASON ? {
  monopoly: 'Buy, build and trade on three 3D boards, in Chog’s purple poker lounge.',
  cards: 'Match colour, number or symbol and empty your hand before the other Chogs.',
  poker: 'No-Limit Hold’em tournaments in the Chog room, for the whole club.',
} : {
  monopoly: 'Buy, build and trade on three 3D boards, with the Chog crew as your pieces.',
  cards: 'Match colour, number or symbol and shed your hand first. Fast rounds, big tables.',
  poker: 'No-Limit Hold’em tournaments for the whole club.',
};

/** The hub's "tables open now" line under a game card. */
function liveLine(connected: boolean, open: number, playing: number): string {
  if (!connected) return 'Connecting…';
  if (open === 0) return 'No tables open — start one!';
  return `${open} table${open === 1 ? '' : 's'} open now${playing ? ` · ${playing} playing` : ''}`;
}

/** The characters the home page puts first: just Chog during the Chog season. */
const FEATURED: CharacterId[] = CHOG_SEASON ? ['chog'] : ['chog', 'snacky', 'starer'];

/**
 * A "How to play" button; the same as components/HowToPlay's HowToPlayButton,
 * without its code in the page. With a game (the "?" on a hub card) it opens
 * that game's tutorial; without one (the hero) it opens with a tab per game.
 */
function HowToButton({ game, label, className = 'btn small ghost', aria }: {
  game?: HowToGame; label: string; className?: string; aria?: string;
}) {
  const [open, setOpen] = useState(false);
  const warm = () => { void loadHowToPlay(); };
  return (
    <>
      <button type="button" className={className} aria-label={aria} title={aria} onPointerEnter={warm} onFocus={warm}
        onClick={() => {
          setOpen(true);
          // "Seen" is Monopoly's: it quiets the welcome hint at a Monopoly table.
          if (game !== 'cards' && game !== 'poker') void loadHowToPlay().then(m => m.markHowToSeen());
        }}>{label}</button>
      {open && createPortal(
        <Suspense fallback={null}><HowToPlay game={game} pickGame={!game} onClose={() => setOpen(false)} /></Suspense>,
        document.body)}
    </>
  );
}

/** A hub card's title with its small round "?" beside it. */
function HubTitle({ game }: { game: HowToGame }) {
  const name = GAMES[game].name;
  return (
    <div className="hub-title">
      <h3>{name}</h3>
      <HowToButton game={game} label="?" className="hub-help" aria={`How to play ${name}`} />
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const { profile, ready } = useAuth();
  const [code, setCode] = useState('');
  const [cardsCode, setCardsCode] = useState('');
  const [pokerCode, setPokerCode] = useState('');
  const rooms = useRoomList();
  const cardTables = useCardsRoomList();
  const connected = useConnected();
  // While a stored sign-in is still being checked, show the line it will most
  // likely turn into, so the poker card does not change a moment after it appears.
  const checking = !ready && !!getToken();
  // The hub is no one game's page: the site's name in the tab (a game's page or a room may have left theirs).
  useEffect(() => { document.title = BRAND.name; }, []);

  const join = (c: string) => {
    const clean = c.trim().toUpperCase();
    if (clean.length < 4) return toastError(new Error('Enter a room code'));
    nav(`/r/${clean}`);
  };
  const joinPoker = (c: string) => {
    const target = pokerTarget(c);
    if (!target) return toastError(new Error('Enter a tournament code or paste the tournament link'));
    goToPoker(target, !!profile);
  };
  const joinCards = (c: string) => {
    const clean = c.trim().toUpperCase();
    if (clean.length < 4) return toastError(new Error('Enter a table code'));
    nav(`/cards/r/${clean}`);
  };

  const live = rooms.filter(r => r.status !== 'lobby').length;
  const cardsLive = cardTables.filter(r => r.status !== 'lobby').length;
  // Names come from the catalogue, so a rename there shows up here. Only the
  // characters the season lets people play are shown (just Chog while CHOG_SEASON is on).
  const playable = availableCharacters();
  const featured = FEATURED.map(id => playable.find(c => c.id === id)).filter((c): c is CharacterDef => !!c);
  const others = playable.filter(c => !FEATURED.includes(c.id));
  const castTitle = featured.length === 1 && others.length === 0 ? `Meet ${featured[0].name}` : 'Meet the characters';

  return (
    <div className="home">
      {/* The board in its room behind the hero, drifting slowly: shows what the game is before a word is read. */}
      <div className="home-bg home-still" aria-hidden />

      <section className="home-hero gd hub-hero">
        <h1>{BRAND.name}</h1>
        <p className="home-tag">Monopoly, cards and poker with the Chog crew.</p>
        {/* One tap into a game: the next table to fill, or a new one with bots. */}
        <QuickPlay />
        <div className="hero-howto">
          <HowToButton label="❓ New here? How to play" />
          <Link className="btn small ghost" to="/characters">{CHOG_SEASON ? <Face emoji="💜" image="/faces/chog.webp" /> : '🎭'} {castTitle}</Link>
        </div>
      </section>

      {/* What just happened across the site; hidden when nothing has. */}
      <ActivityTicker />

      {/* The hub: one card per game, with what is on right now. Each game has its
          own home (/monopoly, /cards, /poker): Play goes there, the code box joins
          a table (or a poker tournament on poker's own site) directly. */}
      <section className="hub" aria-labelledby="hub-title">
        <h2 id="hub-title" className="sr-only">Pick a game</h2>
        <ul className="hub-games">
          <li className="hub-game hub-monopoly">
            <img className="hub-thumb" src="/home/monopoly-640.webp" alt="" width={640} height={400} decoding="async" />
            <div className="hub-text">
              <HubTitle game="monopoly" />
              <p>{BLURBS.monopoly}</p>
              <span className="hub-meta">2–8 players · 45 min</span>
              <span className="hub-live" role="status">{liveLine(connected, rooms.length, live)}</span>
            </div>
            <div className="hub-actions">
              <form className="hub-join" onSubmit={e => { e.preventDefault(); join(code); }}>
                <input className="code-input" value={code} maxLength={5} placeholder="CODE" aria-label="Room code"
                  autoCapitalize="characters" autoComplete="off" spellCheck={false}
                  onChange={e => setCode(e.target.value.toUpperCase())} />
                <button className="btn gold small" type="submit">Join</button>
              </form>
              <Link className="btn primary hub-play" to={GAMES.monopoly.path}>Play {GAMES.monopoly.name}</Link>
            </div>
          </li>

          <li className="hub-game hub-cards">
            <img className="hub-thumb" src="/home/cards-640.webp" alt="" width={640} height={400} loading="lazy" decoding="async" />
            <div className="hub-text">
              <HubTitle game="cards" />
              <p>{BLURBS.cards}</p>
              <span className="hub-meta">{CARDS_MIN_PLAYERS}–{CARDS_MAX_PLAYERS} players · 15 min · <NextTournamentLink /></span>
              <span className="hub-live" role="status">{liveLine(connected, cardTables.length, cardsLive)}</span>
            </div>
            <div className="hub-actions">
              <form className="hub-join" onSubmit={e => { e.preventDefault(); joinCards(cardsCode); }}>
                <input className="code-input" value={cardsCode} maxLength={5} placeholder="CODE" aria-label="Cards table code"
                  autoCapitalize="characters" autoComplete="off" spellCheck={false}
                  onChange={e => setCardsCode(e.target.value.toUpperCase())} />
                <button className="btn gold small" type="submit">Join</button>
              </form>
              <Link className="btn primary hub-play" to={GAMES.cards.path}>Play {GAMES.cards.name}</Link>
            </div>
          </li>

          <li className="hub-game hub-poker">
            <img className="hub-thumb" src="/home/poker-640.webp" alt="" width={640} height={400} loading="lazy" decoding="async" />
            <div className="hub-text">
              <HubTitle game="poker" />
              <p>{BLURBS.poker}</p>
              <span className="hub-meta">Multi-table tournaments</span>
              {/* One short line either way, so the card keeps its height when a stored sign-in is confirmed. */}
              <span className="hub-live">{profile || checking ? 'You stay signed in there' : 'On its own site'}</span>
            </div>
            <div className="hub-actions">
              <form className="hub-join" onSubmit={e => { e.preventDefault(); joinPoker(pokerCode); }}>
                <input className="code-input" value={pokerCode} placeholder="CODE" aria-label="Poker tournament code or link"
                  autoCapitalize="none" autoComplete="off" spellCheck={false}
                  onChange={e => setPokerCode(e.target.value)} />
                <button className="btn gold small" type="submit">Join</button>
              </form>
              <Link className="btn primary hub-play" to={GAMES.poker.path}>Play {GAMES.poker.name}</Link>
            </div>
          </li>
        </ul>
        {/* Today's dailies, all three games on one page (/daily). The number is worked out here, nothing is fetched. */}
        <Link className="hub-dailies" to="/daily">
          <span aria-hidden>📅</span> <b>Daily #{dailyNumber(dailyDate())}</b> <span className="hub-dailies-text">A puzzle for each game, one try each</span> <span aria-hidden>→</span>
        </Link>
      </section>

      {/* The cast: the stars up front, everyone else a tap away on /characters. */}
      <section className="cast" aria-labelledby="cast-title">
        <div className="cast-head">
          <h2 id="cast-title">{castTitle}</h2>
          {others.length > 0 && <Link className="cast-all" to="/characters">See all characters →</Link>}
        </div>
        <div className={`cast-stars${featured.length === 1 ? ' solo' : ''}`}>
          {featured.map(c => (
            <Link key={c.id} to="/characters" className="cast-star" aria-label={`${c.name}: ${c.blurb}`}>
              <span className="cast-emoji" aria-hidden><Face emoji={c.emoji} image={c.face} /></span>
              <span className="cast-text"><b>{c.name}</b><span>{c.blurb}</span></span>
            </Link>
          ))}
        </div>
        {others.length > 0 && (
          <p className="cast-more">
            <span className="cast-dots" aria-hidden>{others.map(c => <i key={c.id} title={c.name}><Face emoji={c.emoji} image={c.face} /></i>)}</span>
            <Link to="/characters">+ {others.length} more to play as</Link>
          </p>
        )}
        {/* The wallet nudge lives on the Chog of the Day card just below. */}
      </section>

      {/* One Chog Genesis in the spotlight, a new one every UTC day. */}
      <ChogOfTheDay />

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
      </div>
      <ChogRoamer />
    </div>
  );
}
