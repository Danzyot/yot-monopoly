import { useEffect } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { ADMIN_TABS } from '../components/admin/tabs.tsx';
import { BRAND } from '../../../shared/brand.ts';

// Operator dashboard at /admin/<tab>. The server checks operator rights on
// every call; this check only decides what to render.
export default function AdminPage() {
  const { profile, ready, openSignIn } = useAuth();
  const tabId = useParams()['*']?.split('/')[0] || '';
  const tab = ADMIN_TABS.find(t => t.id === tabId);

  useEffect(() => {
    document.title = `${tab ? `${tab.label} · ` : ''}Dashboard · ${BRAND.name}`;
  }, [tab]);

  if (!ready) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!profile) {
    return <div className="page"><p>Operators only.</p><button className="btn primary" onClick={openSignIn}>Sign in</button></div>;
  }
  if (!profile.isAdmin) return <div className="page"><p>Operators only.</p></div>;
  if (!tab) return <Navigate to={`/admin/${ADMIN_TABS[0].id}`} replace />;

  const Body = tab.Component;
  return (
    <div className="page adm">
      <h1 className="sr-only">Operator dashboard</h1>
      <nav className="adm-tabs" aria-label="Dashboard sections">
        {ADMIN_TABS.map(t => (
          <NavLink key={t.id} to={`/admin/${t.id}`} className={({ isActive }) => (isActive ? 'on' : '')}
            aria-current={t.id === tab.id ? 'page' : undefined}>
            <span aria-hidden>{t.icon}</span> {t.label}
          </NavLink>
        ))}
      </nav>
      <main className="adm-body" key={tab.id}>
        <Body />
      </main>
    </div>
  );
}
