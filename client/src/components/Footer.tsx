// The site footer, under every page except the game screens (App.tsx): the
// games, the community links, the info pages and the copyright line. Loaded
// after the page (lazy in App.tsx) so it never adds to the home page's first
// download; its styles come with it (styles/footer.css).
import { Suspense, lazy, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { openPoker } from '../pokerLink.ts';
import { WELCOME_EVENT } from './WelcomeHost.tsx';
import { BRAND, GAMES, POKER_URL } from '../../../shared/brand.ts';
import { OPENSEA_URL } from '../../../shared/seo.ts';
import '../styles/footer.css';

const HowToPlay = lazy(() => import('./HowToPlay.tsx'));

/** Poker's page on this site once there is one (GAMES.poker.path), else its own site. */
const POKER_PATH = (GAMES.poker as { path?: string }).path;

export default function Footer() {
  const { config, profile } = useAuth();
  const [howTo, setHowTo] = useState(false);
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="ft-inner">
        <div className="ft-brand">
          <Link to="/" className="ft-logo">
            <img src="/brand/chog-mark-64.webp" srcSet="/brand/chog-mark-64.webp 1x, /brand/chog-mark-128.webp 2x" alt="" width={40} height={40} loading="lazy" decoding="async" />
            <span>{BRAND.name}</span>
          </Link>
          <p className="ft-tag">Monopoly, cards and poker with the Chog crew. Free to play, no real money.</p>
        </div>

        <nav className="ft-cols" aria-label="Footer">
          <div className="ft-col">
            <h2 className="ft-h">Play</h2>
            <ul>
              <li><Link to={GAMES.monopoly.path}>{GAMES.monopoly.name}</Link></li>
              <li><Link to={GAMES.cards.path}>{GAMES.cards.name}</Link></li>
              <li>
                {POKER_PATH
                  ? <Link to={POKER_PATH}>{GAMES.poker.name}</Link>
                  : <a href={POKER_URL} onClick={e => openPoker(e, !!profile)}>{GAMES.poker.name}</a>}
              </li>
              <li><Link to="/daily">Daily</Link></li>
              <li><Link to="/tournaments">Tournaments</Link></li>
              <li><button type="button" className="ft-link" onClick={() => setHowTo(true)}>How to play</button></li>
              {profile && <li><button type="button" className="ft-link" onClick={() => window.dispatchEvent(new Event(WELCOME_EVENT))}>Replay the welcome tour</button></li>}
              {profile && <li><Link to="/settings">Email notifications</Link></li>}
            </ul>
          </div>
          <div className="ft-col">
            <h2 className="ft-h">Community</h2>
            <ul>
              <li><Link to="/characters">Characters</Link></li>
              {config.features.leaderboard && <li><Link to="/leaderboard">Leaderboard</Link></li>}
              {config.inviteUrl && <li><a href={config.inviteUrl} target="_blank" rel="noopener noreferrer">Discord<span className="sr-only"> (opens in a new tab)</span></a></li>}
              <li><a href={OPENSEA_URL} target="_blank" rel="noopener noreferrer">Chog Genesis on OpenSea<span className="sr-only"> (opens in a new tab)</span></a></li>
            </ul>
          </div>
          <div className="ft-col">
            <h2 className="ft-h">Info</h2>
            <ul>
              <li><Link to="/terms">Terms of use</Link></li>
              <li><Link to="/privacy">Privacy</Link></li>
              <li><Link to="/fair-play">Fair play</Link></li>
            </ul>
          </div>
        </nav>
      </div>
      <p className="ft-legal">
        © {year} {BRAND.name}. A fan-made community project. Play chips and game money only: nothing here has cash value.
      </p>
      {howTo && createPortal(
        <Suspense fallback={null}><HowToPlay pickGame onClose={() => setHowTo(false)} /></Suspense>,
        document.body)}
    </footer>
  );
}
