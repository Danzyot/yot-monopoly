import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { toast, toastError } from '../toast.tsx';
import { BRAND } from '../../../shared/brand.ts';
import type { PlayerProfile } from '../../../shared/types.ts';
import { Modal } from './Modal.tsx';

export const DiscordMark = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.8 13.8 0 0 0-.64 1.28 18.3 18.3 0 0 0-5.5 0 13.8 13.8 0 0 0-.64-1.28c-1.71.29-3.37.8-4.93 1.51A20.3 20.3 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.93-1.37 1.3-2.1a12.9 12.9 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.16 0c.17.13.33.26.5.38-.65.39-1.34.71-2.05.98.37.73.81 1.44 1.3 2.1a19.9 19.9 0 0 0 6.07-3.03 20.3 20.3 0 0 0-3.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
  </svg>
);

/** Sign-in dialog: Sign in with Discord, or Verify with a code (plus demo mode). */
export function AuthModalHost() {
  const auth = useAuth();
  if (!auth.signInOpen) return null;
  return <AuthModal onClose={auth.closeSignIn} />;
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const { config, signInDiscord, signInDemo, acceptAuth } = useAuth();
  const [demoName, setDemoName] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const beginCode = async () => {
    try {
      const r = await api<{ code: string }>('/api/auth/code/start', { method: 'POST' });
      setCode(r.code);
      setExpired(false);
    } catch (e) { toastError(e); }
  };

  // Poll until the bot sees the code in Discord.
  useEffect(() => {
    if (!code || expired) return;
    const iv = setInterval(async () => {
      try {
        const s = await api<{ pending: boolean; token?: string; profile?: PlayerProfile }>(`/api/auth/code/status?code=${encodeURIComponent(code)}`);
        if (s.token && s.profile) {
          clearInterval(iv);
          acceptAuth(s.token, s.profile);
          toast(`Welcome, ${s.profile.name}!`);
        } else if (!s.pending) {
          clearInterval(iv);
          setExpired(true);
        }
      } catch (e) {
        if ((e as { status?: number }).status === 403) { clearInterval(iv); toastError(e); setCode(null); }
      }
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, expired]);

  const where = config.codeVerifyChannel ? `#${config.codeVerifyChannel}` : `the ${BRAND.org} Discord verify channel`;

  const body = code ? (
    <>
      <h3>Verify with a code</h3>
      {expired ? (
        <>
          <p className="muted">That code expired. Grab a fresh one.</p>
          <button className="btn primary" onClick={() => void beginCode()}>New code</button>
        </>
      ) : (
        <>
          <p className="muted">
            {config.codeVerifyButton
              ? <>Go to <b>{where}</b>, press the green <b>Verify</b> button and paste this code. You'll be signed in automatically.</>
              : <>Send this code as a message in <b>{where}</b>. We'll spot it and sign you in automatically.</>}
          </p>
          <div className="verify-code">{code}</div>
          <div className="row center"><span className="spinner" /><span className="muted small">Waiting for Discord…</span></div>
        </>
      )}
      <div className="row end"><button className="btn ghost" onClick={() => setCode(null)}>Back</button></div>
    </>
  ) : (
    <>
      <h3>Sign in to {BRAND.name}</h3>
      {config.discordEnabled && (
        <>
          <button className="btn discord big" onClick={signInDiscord}><DiscordMark /> Sign in with Discord</button>
          {config.codeVerify && (
            <>
              <button className="btn big" onClick={() => void beginCode()}>Verify with a code</button>
              <p className="muted small center">No login — {config.codeVerifyButton ? 'paste a short code into the Verify button in' : 'send a short code in'} {where}.</p>
            </>
          )}
        </>
      )}
      {config.demoMode && (
        <form className="demo" onSubmit={e => {
          e.preventDefault();
          setBusy(true);
          signInDemo(demoName).catch(toastError).finally(() => setBusy(false));
        }}>
          {config.discordEnabled && <div className="or">or</div>}
          <p className="tag warn">Demo mode — pick a name, nothing is verified.</p>
          <input autoFocus data-autofocus value={demoName} maxLength={20} placeholder="Your name" onChange={e => setDemoName(e.target.value)} />
          <button className="btn primary big" disabled={busy || demoName.trim().length < 2}>{busy ? 'Joining…' : 'Play!'}</button>
        </form>
      )}
      {!config.discordEnabled && !config.demoMode && (
        <p className="muted">Sign-in isn't set up on this server yet (no Discord application configured).</p>
      )}
      <div className="row end"><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </>
  );

  return createPortal(
    <Modal onClose={onClose} label="Sign in" className="auth">{body}</Modal>,
    document.body,
  );
}
