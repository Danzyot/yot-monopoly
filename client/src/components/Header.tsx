import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { Avatar } from './Avatar.tsx';
import { profilePath } from '../community.tsx';
import { EditTextToggle } from '../textEdit.tsx';

export default function Header() {
  const { profile, config, openSignIn, signOut } = useAuth();
  return (
    <header className="site-header">
      <Link to="/" className="brand"><span className="brand-hat">🎩</span> {BRAND.name}</Link>
      <nav className="row" aria-label="Site">
        {/* NavLink adds aria-current="page" on the active route; .navlink.active styles it. */}
        <NavLink className="navlink hide-sm" to="/characters">Characters</NavLink>
        {config.features.leaderboard && <NavLink className="navlink" to="/leaderboard">Leaderboard</NavLink>}
        {config.inviteUrl && <a className="navlink" href={config.inviteUrl} target="_blank" rel="noreferrer">Discord</a>}
        {profile?.isAdmin && <Link className="navlink accent" to="/admin">Dashboard</Link>}
        {profile && config.features.leaderboard && <NavLink className="navlink hide-sm" to={profilePath(profile.id)}>My profile</NavLink>}
        <EditTextToggle />
        {profile ? (
          <span className="row me">
            {/* The avatar doubles as the profile link where "My profile" is hidden (phones). */}
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
