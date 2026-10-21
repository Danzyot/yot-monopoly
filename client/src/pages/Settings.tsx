// /settings: your own settings. For now one section, Notifications: which
// emails you get (components/NotificationSettings.tsx). Every email's footer
// links here.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { profilePath } from '../community.tsx';
import NotificationSettings from '../components/NotificationSettings.tsx';
import { BRAND } from '../../../shared/brand.ts';
import '../styles/notifications.css';

export default function Settings() {
  const { profile, ready, openSignIn } = useAuth();

  useEffect(() => {
    document.title = `Settings · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);

  if (!ready) return <div className="page settings-page"><div className="sk sk-card" /></div>;
  if (!profile) {
    return (
      <div className="page settings-page">
        <section className="panel">
          <h1>Settings</h1>
          <p className="muted">Sign in to choose which emails you get. Already unsubscribed from a link in an email? That's done; nothing else is needed.</p>
          <div><button type="button" className="btn primary chunky" onClick={openSignIn}>Sign in</button></div>
        </section>
      </div>
    );
  }
  return (
    <div className="page settings-page">
      <div>
        <h1>Settings</h1>
        <p className="muted">Signed in as <Link to={profilePath(profile.id)}>{profile.name}</Link>.</p>
      </div>
      <section className="panel" aria-labelledby="settings-notifications">
        <h2 id="settings-notifications"><span aria-hidden>🔔</span> Notifications</h2>
        <NotificationSettings />
      </section>
    </div>
  );
}
