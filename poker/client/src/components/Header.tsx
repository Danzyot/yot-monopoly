import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { getToken } from '../api';
import { BRAND } from '../../../shared/brand';
import AuthModal from './AuthModal';
import Avatar from './Avatar';
import ChogPicker from './ChogPicker';
import { forgetMyChogs, loadMyChogs, myChog, useMyChogs } from '../chog';
import MusicPlayer from './MusicPlayer';
import { useFeature } from '../features';

// The hub's own header (choggames.com, client/src/components/Header.tsx
// there), so walking from the hub into a tournament stays on the same site:
// the Chog mark and "Chog Games", the same games and pages in the same order,
// the avatar and Sign out on the right. Poker is one of the hub's games, so
// its link is the one lit up. The links lead back to the hub at HUB_URL; on a
// standalone deployment (HUB_URL=off) only this room's own pages are left.

/** What the server says the hub is when HUB_URL is unset, used until /api/config answers. */
const DEFAULT_HUB = 'https://choggames.com';

interface HubLink { to: string; label: string; icon: string; game?: boolean; signedIn?: boolean; home?: boolean }
const HUB_LINKS: HubLink[] = [
  { to: '/', label: 'Monopoly', icon: '🎩', game: true, home: true },
  { to: '/cards', label: 'Cards', icon: '🃏', game: true },
  { to: '/poker', label: 'Poker', icon: '♠️', game: true },
  { to: '/tournaments', label: 'Tournaments', icon: '🏟️' },
  { to: '/characters', label: 'Characters', icon: '🎭' },
  { to: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { to: '/wallet', label: 'Wallet', icon: '🔗', signedIn: true },
];

/**
 * A plain click on a hub link carries the sign-in across (the hub reads
 * `#dtoken=` the way this room does), so nobody signs in twice. The token is
 * never in the href: copying or middle-clicking a link gives the bare page.
 */
function openHub(e: MouseEvent<HTMLAnchorElement>, href: string) {
  const token = getToken();
  if (!token || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const u = new URL(href);
  u.hash = `dtoken=${encodeURIComponent(token)}`;
  window.location.assign(u.href);
}

export default function Header() {
  const music = useFeature('music');
  const leaderboard = useFeature('leaderboard');
  const { profile, signOut, discordEnabled, linkDiscord, discordInviteUrl, demoMode, hubUrl, configLoaded } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [showChog, setShowChog] = useState(false);
  const chogs = useMyChogs();
  const ref = useRef<HTMLElement>(null);
  const hub = configLoaded ? hubUrl : DEFAULT_HUB;
  // Poker is the page you are on, except on the operator's Dashboard, which lights itself.
  const onDashboard = useLocation().pathname.startsWith('/lobby');

  // Your own Chog avatar, for the chip. Asked once per sign-in.
  const profileId = profile?.id ?? null;
  useEffect(() => {
    if (profileId) void loadMyChogs();
    else forgetMyChogs();
  }, [profileId]);

  // Publish the real header height so the table page can size itself to the
  // rest of the viewport exactly — felt and action buttons always on screen,
  // and nothing that scrolls the whole page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hubLink = (l: HubLink) => {
    const href = `${hub}${l.to === '/' ? '/' : l.to}`;
    const here = l.to === '/poker' && !onDashboard;
    return (
      <a
        key={l.to}
        className={`navlink nav-chars${l.game ? ' nav-game' : ''}${l.home ? ' nav-home' : ''}${here ? ' active' : ''}`}
        href={href}
        onClick={e => openHub(e, href)}
        aria-current={here ? 'page' : undefined}
        aria-label={l.label}
        title={l.label}
      >
        <span className="nav-ico" aria-hidden="true">{l.icon}</span><span className="nav-label">{l.label}</span>
      </a>
    );
  };

  return (
    <header className={`site-header${demoMode ? ' is-demo' : ''}`} ref={ref}>
      {hub ? (
        <a className="brand" href={`${hub}/`} onClick={e => openHub(e, `${hub}/`)}>
          {/* The hub's Chog mark (public/brand/, copied from the hub); 2x for sharp screens. */}
          <img className="brand-logo" src="/brand/chog-mark-64.webp" srcSet="/brand/chog-mark-64.webp 1x, /brand/chog-mark-128.webp 2x" alt="" width={32} height={32} decoding="async" />
          <span className="brand-word">{BRAND.hub}</span>
        </a>
      ) : (
        <Link className="brand" to="/">
          <img className="brand-logo" src="/brand/chog-mark-64.webp" srcSet="/brand/chog-mark-64.webp 1x, /brand/chog-mark-128.webp 2x" alt="" width={32} height={32} decoding="async" />
          <span className="brand-word">{BRAND.name}</span>
        </Link>
      )}
      {/* Impossible to miss on purpose: a demo deployment lets anyone with the
          address sign in, so it must never be mistaken for the real room.
          After the brand, so the brand keeps the left edge as on the hub. */}
      {demoMode && <span className="demo-flag">DEMO</span>}
      <nav className="row" aria-label="Site">
        {hub
          ? HUB_LINKS.filter(l => !l.signedIn).map(hubLink)
          : (
            <>
              <NavLink className="navlink nav-chars nav-game" to="/" end title="Poker"><span className="nav-ico" aria-hidden="true">♠️</span><span className="nav-label">Poker</span></NavLink>
              {leaderboard && <NavLink className="navlink nav-chars" to="/leaderboard" title="Leaderboard"><span className="nav-ico" aria-hidden="true">🏆</span><span className="nav-label">Leaderboard</span></NavLink>}
            </>
          )}
        {discordInviteUrl && (
          <a className="navlink nav-discord" href={discordInviteUrl} target="_blank" rel="noopener noreferrer" title={`Join the ${BRAND.org} Discord`}>Discord</a>
        )}
        {profile?.isAdmin && (
          <NavLink to="/lobby" className="navlink nav-chars accent" aria-label="Dashboard" title="Dashboard">
            <span className="nav-ico" aria-hidden="true">📊</span><span className="nav-label">Dashboard</span>
          </NavLink>
        )}
        {/* Signed-in pages (Wallet) after Dashboard, the hub's order. */}
        {hub && profile && HUB_LINKS.filter(l => l.signedIn).map(hubLink)}
        {music && <MusicPlayer />}
        {profile ? (
          <span className="row me">
            {chogs.data?.enabled ? (
              // The way into "Your Chog": the avatar itself.
              <button
                type="button" className="profile-avatar-btn me-link" onClick={() => setShowChog(true)}
                title="Your Chog — use one of your Chog NFTs as your avatar" aria-label="Your Chog avatar"
              >
                <Avatar value={profile.avatar} size={28} chog={myChog(chogs)} />
              </button>
            ) : (
              <span className="me-link"><Avatar value={profile.avatar} size={28} /></span>
            )}
            <span className="hide-sm profile-name">{profile.name}</span>
            {!profile.discord && discordEnabled && (
              <button className="btn btn-ghost btn-sm" onClick={() => linkDiscord()}>Link Discord</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={signOut} aria-label={`Sign out ${profile.name}`}>Sign out</button>
          </span>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setShowAuth(true)}>Sign in</button>
        )}
      </nav>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showChog && profile && <ChogPicker onClose={() => setShowChog(false)} />}
    </header>
  );
}
