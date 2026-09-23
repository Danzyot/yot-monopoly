import { useAuth } from '../auth.tsx';

// Placeholder: the full operator dashboard is built in its own module.
export default function AdminPage() {
  const { profile, ready } = useAuth();
  if (!ready) return null;
  if (!profile?.isAdmin) return <div className="page"><p>Operators only.</p></div>;
  return <div className="page"><h1>Dashboard</h1><p className="muted">Coming up.</p></div>;
}
