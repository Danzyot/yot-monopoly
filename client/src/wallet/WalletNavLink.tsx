// The header's "Wallet" link. Signed-in only (linking needs an account), and
// it is where holdings get re-verified on sign-in: the first read after the
// profile appears makes the server refresh any reading older than ten minutes.
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { clearWalletStatus, fetchWalletStatus, useWalletStatus } from './walletApi.ts';
import './wallet.css';

export default function WalletNavLink() {
  const { profile } = useAuth();
  const status = useWalletStatus();
  const id = profile?.id;

  useEffect(() => {
    if (!id) { clearWalletStatus(); return; }
    fetchWalletStatus().catch(() => { /* the page says more if they open it */ });
  }, [id]);

  if (!profile) return null;
  const n = status?.chogs.length ?? 0;
  return (
    // Icon-only on narrow phones (wallet.css), like the Characters link; the aria-label keeps the name.
    <NavLink className="navlink wl-navlink" to="/wallet" aria-label="Wallet" title={status?.holder ? `Verified Chog holder — ${n} Chog${n === 1 ? '' : 's'}` : 'Link your wallet'}>
      <span className="wl-nav-ico" aria-hidden="true">🔗</span><span className="wl-nav-label">Wallet</span>
      {status?.holder && <span className="wl-nav-badge" aria-label="Verified Chog holder">✓</span>}
    </NavLink>
  );
}
