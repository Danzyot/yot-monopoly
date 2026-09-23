import { useEffect } from 'react';
import { useAuth } from '../auth.tsx';
import { onBanned } from '../net.ts';

/** Takes over the page when the server refuses this account or address. */
export default function BanScreen() {
  const { banned, setBanned, signOut } = useAuth();
  useEffect(() => onBanned(msg => setBanned(msg)), [setBanned]);
  if (!banned) return null;
  return (
    <div className="ban-screen">
      <div className="panel">
        <div className="trophy">⛔</div>
        <h2>Access restricted</h2>
        <p>{banned}</p>
        <button className="btn ghost" onClick={() => { signOut(); setBanned(null); location.reload(); }}>Sign out</button>
      </div>
    </div>
  );
}
