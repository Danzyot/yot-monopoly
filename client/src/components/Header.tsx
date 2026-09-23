import { Link } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { Avatar } from './Avatar.tsx';

export default function Header() {
  const { profile, config, openSignIn, signOut } = useAuth();
  return (
    <header className="site-header">
      <Link to="/" className="brand"><span className="brand-hat">🎩</span> {BRAND.name}</Link>
      <nav className="row">
        {config.features.leaderboard && <Link className="navlink" to="/leaderboard">Leaderboard</Link>}
        {config.inviteUrl && <a className="navlink" href={config.inviteUrl} target="_blank" rel="noreferrer">Discord</a>}
        {profile?.isAdmin && <Link className="navlink accent" to="/admin">Dashboard</Link>}
        {profile ? (
          <span className="row me">
            <Avatar src={profile.avatar} size={28} />
            <span className="hide-sm">{profile.name}</span>
            <button className="btn tiny ghost" onClick={signOut}>Sign out</button>
          </span>
        ) : (
          <button className="btn small primary" onClick={openSignIn}>Sign in</button>
        )}
      </nav>
    </header>
  );
}
