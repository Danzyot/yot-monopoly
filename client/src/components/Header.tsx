import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { getToken } from '../api.ts';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { Avatar } from './Avatar.tsx';
import { CloseX, Modal } from './Modal.tsx';
import { profilePath } from '../community.tsx';
import { EditTextToggle } from '../textEdit.tsx';
import WalletNavLink from '../wallet/WalletNavLink.tsx';
import { useFriends } from '../friends.ts';

const HEIGHT_KEY = 'yot:header-height';

/** One link of the site nav: in the bar (icon only on phones) and, named, in the phone's side menu. */
interface NavItem {
  to: string;
  icon: string;
  label: string;
  /** Spoken and hovered name, when longer than the label. */
  title?: string;
  className?: string;
  /** A number on the icon (friend requests waiting). */
  count?: number;
}

function navItems(opts: { leaderboard: boolean; admin: boolean; signedIn: boolean }): NavItem[] {
  return [
    // The games first.
    { to: GAMES.monopoly.path, icon: '🎩', label: GAMES.monopoly.name, className: 'nav-game nav-monopoly' },
    { to: GAMES.cards.path, icon: '🃏', label: GAMES.cards.name, className: 'nav-game nav-cards' },
    // Poker's home here (/poker) lists its tournaments; the games themselves are on poker's own site.
    { to: '/poker', icon: '♠️', label: GAMES.poker.name, className: 'nav-game nav-poker' },
    { to: '/daily', icon: '📅', label: 'Daily challenges' },
    { to: '/tournaments', icon: '🏟️', label: 'Tournaments' },
    { to: '/characters', icon: '🎭', label: 'Characters' },
    ...(opts.leaderboard ? [{ to: '/leaderboard', icon: '🏆', label: 'Leaderboard' }] : []),
    ...(opts.admin ? [{ to: '/admin', icon: '📊', label: 'Dashboard', className: 'accent' }] : []),
    ...(opts.signedIn ? [{ to: '/friends', icon: '👥', label: 'Friends', className: 'nav-friends' }] : []),
  ];
}

function BarLink({ item }: { item: NavItem }) {
  const title = item.count ? `${item.label}, ${item.count} new ${item.count === 1 ? 'request' : 'requests'}` : item.title ?? item.label;
  return (
    <NavLink className={`navlink nav-chars ${item.className ?? ''}`} to={item.to} aria-label={title} title={title}>
      <span className="nav-ico" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span>
      {!!item.count && <span className="nav-count" aria-hidden="true">{item.count > 9 ? '9+' : item.count}</span>}
    </NavLink>
  );
}

/** The side menu (phones): every link with its name, then the account. */
function NavMenu({ items, inviteUrl, onClose }: { items: NavItem[]; inviteUrl?: string; onClose: () => void }) {
  const { profile, config, openSignIn, signOut } = useAuth();
  const location = useLocation();
  // Going somewhere closes it.
  const from = useRef(location.pathname);
  useEffect(() => { if (location.pathname !== from.current) onClose(); }, [location.pathname, onClose]);
  return (
    <Modal onClose={onClose} label="Menu" className="nav-drawer" backClassName="nav-drawer-back">
      <div className="nav-drawer-head">
        <span className="nav-drawer-title">{BRAND.name}</span>
        <CloseX onClick={onClose} label="Close menu" />
      </div>
      <nav aria-label="Site menu">
        <ul className="nav-drawer-list">
          {items.map(item => (
            <li key={item.to}>
              <NavLink className={`nav-drawer-link ${item.className ?? ''}`} to={item.to} onClick={onClose}>
                <span className="nav-drawer-ico" aria-hidden="true">{item.icon}</span>
                <span className="nav-drawer-label">{item.title ?? item.label}</span>
                {!!item.count && <span className="nav-count" aria-label={`${item.count} new`}>{item.count > 9 ? '9+' : item.count}</span>}
              </NavLink>
            </li>
          ))}
          {profile && (
            <li>
              <NavLink className="nav-drawer-link" to="/wallet" onClick={onClose}>
                <span className="nav-drawer-ico" aria-hidden="true">🔗</span><span className="nav-drawer-label">Wallet</span>
              </NavLink>
            </li>
          )}
          {inviteUrl && (
            <li>
              <a className="nav-drawer-link" href={inviteUrl} target="_blank" rel="noreferrer" onClick={onClose}>
                <span className="nav-drawer-ico" aria-hidden="true">💬</span><span className="nav-drawer-label">Discord ↗</span>
              </a>
            </li>
          )}
        </ul>
      </nav>
      <div className="nav-drawer-me">
        {profile ? (
          <>
            {config.features.leaderboard
              ? <Link className="nav-drawer-link" to={profilePath(profile.id)} onClick={onClose}><Avatar src={profile.avatar} size={28} /><span className="nav-drawer-label">{profile.name}</span></Link>
              : <span className="nav-drawer-link static"><Avatar src={profile.avatar} size={28} /><span className="nav-drawer-label">{profile.name}</span></span>}
            <button type="button" className="btn small ghost" onClick={() => { onClose(); signOut(); }}>Sign out</button>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={() => { onClose(); openSignIn(); }} data-autofocus>Sign in</button>
        )}
      </div>
    </Modal>
  );
}

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
  const friends = useFriends(!!profile);
  const requests = friends?.incoming.length ?? 0;
  const items = navItems({ leaderboard: config.features.leaderboard, admin: !!profile?.isAdmin, signedIn: !!profile })
    .map(i => (i.to === '/friends' && requests ? { ...i, count: requests } : i));
  const [menu, setMenu] = useState(false);
  return (
    <header className="site-header" ref={ref} style={pending && minHeight ? { minHeight } : undefined}>
      <Link to="/" className="brand">
        {/* The Chog mark (client/public/brand/, from editions/chog/logo.png); 2x for sharp screens. */}
        <img className="brand-logo" src="/brand/chog-mark-64.webp" srcSet="/brand/chog-mark-64.webp 1x, /brand/chog-mark-128.webp 2x" alt="" width={32} height={32} decoding="async" />
        {BRAND.name}
      </Link>
      <nav className="row" aria-label="Site" style={pending ? { visibility: 'hidden' } : undefined}>
        {/* NavLink adds aria-current="page" on the active route; .navlink.active styles it. */}
        {/* Always shown: on phones each label shrinks to its icon (manage.css); the ☰ menu beside them lists the names. */}
        {items.map(item => <BarLink key={item.to} item={item} />)}
        {config.inviteUrl && <a className="navlink" href={config.inviteUrl} target="_blank" rel="noreferrer">Discord</a>}
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
        <button type="button" className="nav-menu-btn" onClick={() => setMenu(true)} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menu}>
          <span aria-hidden="true">☰</span>
        </button>
      </nav>
      {/* At the page root: the header's backdrop blur would otherwise pin the drawer inside the bar. */}
      {menu && createPortal(<NavMenu items={items} inviteUrl={config.inviteUrl ?? undefined} onClose={() => setMenu(false)} />, document.body)}
    </header>
  );
}
