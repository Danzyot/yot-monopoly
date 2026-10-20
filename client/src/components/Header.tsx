import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { getToken } from '../api.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { Avatar } from './Avatar.tsx';
import { profilePath } from '../community.tsx';
import { EditTextToggle } from '../textEdit.tsx';
import WalletNavLink from '../wallet/WalletNavLink.tsx';
import { openPoker } from '../pokerLink.ts';
import { POKER_URL } from '../../../shared/brand.ts';

const HEIGHT_KEY = 'yot:header-height';

/** The header's height the last time it settled, if that was at about this window width. */
function lastHeight(): number {
  try {
    const v = JSON.parse(localStorage.getItem(HEIGHT_KEY) ?? 'null') as { w: number; h: number } | null;
    return v && Math.abs(v.w - window.innerWidth) < 40 ? v.h : 0;
  } catch {
    return 0;
  }
}

export default function Header() {
  const { profile, config, ready, openSignIn, signOut } = useAuth();
  // A stored sign-in is checked just after the first paint, and what it brings
  // (the avatar, more links) can take the header onto two rows on a phone.
  // Until it is checked the links wait and the header keeps the height it
  // settled at last time, so the page under it does not jump a moment later.
  const pending = !ready && !!getToken();
  const [minHeight] = useState(lastHeight);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    try { localStorage.setItem(HEIGHT_KEY, JSON.stringify({ w: window.innerWidth, h: el.offsetHeight })); } catch { /* private mode */ }
  }, [ready, profile, config]);
  return (
    <header className="site-header" ref={ref} style={pending && minHeight ? { minHeight } : undefined}>
      <Link to="/" className="brand">
        {/* The Chog mark (client/public/brand/, from editions/chog/logo.png); 2x for sharp screens. */}
        <img className="brand-logo" src="/brand/chog-mark-64.webp" srcSet="/brand/chog-mark-64.webp 1x, /brand/chog-mark-128.webp 2x" alt="" width={32} height={32} decoding="async" />
        {BRAND.name}
      </Link>
      <nav className="row" aria-label="Site" style={pending ? { visibility: 'hidden' } : undefined}>
        {/* NavLink adds aria-current="page" on the active route; .navlink.active styles it. */}
        {/* The games first. Always shown: on phones the label shrinks to its icon (see manage.css) so nothing wraps or overflows. */}
        <NavLink className="navlink nav-chars nav-game nav-home" to="/" end aria-label={GAMES.monopoly.name} title={GAMES.monopoly.name}><span className="nav-ico" aria-hidden="true">🎩</span><span className="nav-label">{GAMES.monopoly.name}</span></NavLink>
        <NavLink className="navlink nav-chars nav-game nav-cards" to={GAMES.cards.path} aria-label={GAMES.cards.name} title={GAMES.cards.name}><span className="nav-ico" aria-hidden="true">🃏</span><span className="nav-label">{GAMES.cards.name}</span></NavLink>
        {/* Poker is its own site; a signed-in player carries their sign-in across (pokerLink.ts). Same tab, like the other games. */}
        <a className="navlink nav-chars nav-game" href={POKER_URL} onClick={e => openPoker(e, !!profile)} aria-label={GAMES.poker.name} title={GAMES.poker.name}><span className="nav-ico" aria-hidden="true">♠️</span><span className="nav-label">{GAMES.poker.name}</span></a>
        <NavLink className="navlink nav-chars" to="/tournaments" aria-label="Tournaments" title="Tournaments"><span className="nav-ico" aria-hidden="true">🏟️</span><span className="nav-label">Tournaments</span></NavLink>
        <NavLink className="navlink nav-chars" to="/characters" aria-label="Characters" title="Characters"><span className="nav-ico" aria-hidden="true">🎭</span><span className="nav-label">Characters</span></NavLink>
        {config.features.leaderboard && <NavLink className="navlink nav-chars" to="/leaderboard" aria-label="Leaderboard" title="Leaderboard"><span className="nav-ico" aria-hidden="true">🏆</span><span className="nav-label">Leaderboard</span></NavLink>}
        {config.inviteUrl && <a className="navlink" href={config.inviteUrl} target="_blank" rel="noreferrer">Discord</a>}
        {profile?.isAdmin && <Link className="navlink nav-chars accent" to="/admin" aria-label="Dashboard" title="Dashboard"><span className="nav-ico" aria-hidden="true">📊</span><span className="nav-label">Dashboard</span></Link>}
        <WalletNavLink />
        <EditTextToggle />
        {profile ? (
          <span className="row me">
            {/* The avatar is the profile link. */}
            {config.features.leaderboard
              ? <Link className="me-link" to={profilePath(profile.id)} title="My profile" aria-label="My profile"><Avatar src={profile.avatar} size={28} /></Link>
              : <Avatar src={profile.avatar} size={28} />}
            <span className="hide-sm">{profile.name}</span>
            <button className="btn tiny ghost" onClick={signOut} aria-label={`Sign out ${profile.name}`}>Sign out</button>
          </span>
        ) : (
          <button className="btn small primary" onClick={openSignIn}>Sign in</button>
        )}
      </nav>
    </header>
  );
}
