// "Your Chogs": a verified Chog Genesis holder's tokens, with the NFT art,
// for the lobby character picker and the gallery. Holder status comes from the
// wallet API (client/src/wallet/walletApi.ts) and is re-checked each time the
// picker opens; anyone without a verified Chog sees the one-line nudge to
// link a wallet instead.

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { chogArtUrl, chogLook, chogName, isLegendary } from '../../../shared/chogs/traits.ts';
import { refreshHolderStatus, useWalletStatus, type WalletStatus } from '../wallet/walletApi.ts';
import { useAuth } from '../auth.tsx';

/** The gallery's "Play as Chog #n" remembers the token here, next to CHARACTER_PREF_KEY ('chog'). */
export const CHOG_TOKEN_PREF_KEY = 'yot:chog-token';

export function loadChogTokenPref(): number | null {
  try {
    const n = Number(localStorage.getItem(CHOG_TOKEN_PREF_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

export function saveChogTokenPref(token: number | null) {
  try {
    if (token) localStorage.setItem(CHOG_TOKEN_PREF_KEY, String(token));
    else localStorage.removeItem(CHOG_TOKEN_PREF_KEY);
  } catch { /* private mode */ }
}

/** The holder status, re-verified when the component using it mounts (the server rate-limits the chain read). */
export function useYourChogs(): WalletStatus | null {
  const status = useWalletStatus();
  useEffect(() => { refreshHolderStatus().catch(() => { /* signed out or offline: the last status stands */ }); }, []);
  return status;
}

/** A token's picture in a badge, framed in its background colour. */
export function ChogArt({ token, size = 30, className = '' }: { token: number; size?: number; className?: string }) {
  const look = chogLook(token);
  return (
    <img className={`chog-art ${className}`} src={chogArtUrl(token, size * 3)} alt={chogName(token)} width={size} height={size}
      loading="lazy" draggable={false} style={{ borderColor: look?.background }} />
  );
}

export default function ChogPicker({ selected, onPick, taken, label = 'Play as' }: {
  /** The token picked right now, if any. */
  selected?: number | null;
  onPick: (token: number) => void;
  /** Tokens someone else at the table already plays as (their name). */
  taken?: (token: number) => string | undefined;
  label?: string;
}) {
  const status = useYourChogs();
  const { profile, ready } = useAuth();
  // Signed out there is no wallet to check (the status never comes): straight to the nudge.
  const signedOut = ready && !profile;
  if (!status && !signedOut) return <p className="chog-nudge small muted">Checking your wallet for Chogs…</p>;
  if (!status || !status.holder || !status.chogs.length) {
    return <p className="chog-nudge small"><Link to="/wallet">Link your wallet to play as your Chog →</Link></p>;
  }
  return (
    <div className="chog-picker">
      <h4 className="chog-picker-head">Your Chogs <span className="small muted">{status.chogs.length}</span></h4>
      <div className="chog-tokens" role="group" aria-label="Your Chogs">
        {status.chogs.map(id => {
          const holder = taken?.(id);
          const look = chogLook(id);
          const on = selected === id;
          return (
            <button key={id} className={`chog-token ${on ? 'on' : ''}`} disabled={!!holder} aria-pressed={on}
              title={holder ? `${chogName(id)} — taken by ${holder}` : `${label} ${chogName(id)}${look?.fallback ? ' (some traits are still being modelled)' : ''}`}
              style={{ borderColor: on ? look?.background : undefined }} onClick={() => onPick(id)}>
              <ChogArt token={id} size={56} />
              <small>#{id}</small>
              {isLegendary(id) && <span className="chog-legendary" title={`Legendary 1:1 #${id}`}>1:1</span>}
              {holder && <span className="char-taken" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
