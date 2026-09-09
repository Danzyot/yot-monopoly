import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { BRAND } from '../../../shared/brand';
import AuthModal from './AuthModal';
import Avatar from './Avatar';
import MusicPlayer from './MusicPlayer';
import { IconDiscord } from './icons';
import ChogLogo from './ChogLogo';
import { useFeature } from '../features';

const SpadeLogo = () => (
  <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden>
    <defs>
      <linearGradient id="spadeGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#a7f3c4" />
        <stop offset="1" stopColor="#34b46a" />
      </linearGradient>
    </defs>
    <path d="M50 8 C36 28 20 39 20 55 c0 11 9 19 19 19 4 0 7-1 10-3 -1 8-4 13-10 18 v5 h22 v-5 c-6-5-9-10-10-18 3 2 6 3 10 3 10 0 19-8 19-19 C80 39 64 28 50 8 Z"
      fill="url(#spadeGold)" />
  </svg>
);

export default function Header() {
  const music = useFeature('music');
  const { profile, signOut, discordEnabled, linkDiscord, discordInviteUrl, demoMode } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const ref = useRef<HTMLElement>(null);

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

  return (
    <header className={`header${demoMode ? ' is-demo' : ''}`} ref={ref}>
      {/* Impossible to miss on purpose: a demo deployment lets anyone with the
          address sign in, so it must never be mistaken for the real room. */}
      {demoMode && <span className="demo-flag">DEMO</span>}
      <NavLink to="/" className="logo">
        {/* The word is in its own element so the narrowest phones can drop it
            and keep the mark, which links home just the same. */}
        <ChogLogo className="brand-lockup" height={30} word />
        <span className="logo-word">Poker</span>
      </NavLink>
      <nav>
        {profile?.isAdmin && (
          <NavLink to="/lobby" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
            Dashboard
          </NavLink>
        )}
      </nav>
      <div className="spacer" />
      {music && <MusicPlayer />}
      {/* Top right of every page, because the header is on every page. Hidden
          rather than dead when no invite is configured — a Discord button that
          goes nowhere is worse than no button. */}
      {discordInviteUrl && (
        <a
          className="discord-link"
          href={discordInviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`Join the ${BRAND.org} Discord`}
        >
          <IconDiscord size={30} />
          <span className="sr-only">Join the {BRAND.org} Discord</span>
        </a>
      )}
      {profile ? (
        <div className="profile-chip">
          <Avatar value={profile.avatar} size={22} />
          <span className="profile-name">{profile.name}</span>
          {profile.isAdmin && <span className="admin-badge">OPERATOR</span>}
          {profile.discord ? (
            <span className="discord-badge verified" title={`Discord: @${profile.discord.username}`}>
              @{profile.discord.username}
            </span>
          ) : discordEnabled ? (
            <button className="btn btn-ghost btn-sm" onClick={() => linkDiscord()}>Link Discord</button>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
        </div>
      ) : (
        <button className="btn btn-primary btn-sm" onClick={() => setShowAuth(true)}>Sign in</button>
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </header>
  );
}
