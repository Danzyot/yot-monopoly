import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { BRAND } from '../../../shared/brand';
import { useToast } from '../toast';

const DiscordMark = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.8 13.8 0 0 0-.64 1.28 18.3 18.3 0 0 0-5.5 0 13.8 13.8 0 0 0-.64-1.28c-1.71.29-3.37.8-4.93 1.51A20.3 20.3 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.93-1.37 1.3-2.1a12.9 12.9 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.16 0c.17.13.33.26.5.38-.65.39-1.34.71-2.05.98.37.73.81 1.44 1.3 2.1a19.9 19.9 0 0 0 6.07-3.03 20.3 20.3 0 0 0-3.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
  </svg>
);

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { signInDiscord, discordEnabled, demoMode, signInDemo, codeVerify, codeVerifyChannel, codeVerifyButton, acceptAuth } = useAuth();
  const [demoName, setDemoName] = useState('');
  const [joining, setJoining] = useState(false);
  const toast = useToast();
  // "Verify with a code" flow.
  const [code, setCode] = useState<string | null>(null);
  const [codeExpired, setCodeExpired] = useState(false);

  const beginCode = async () => {
    try {
      const { code } = await api.codeStart();
      setCode(code);
      setCodeExpired(false);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Code verification unavailable');
    }
  };

  // Poll until the code is spotted in the Discord channel.
  useEffect(() => {
    if (!code || codeExpired) return;
    const iv = setInterval(async () => {
      try {
        const s = await api.codeStatus(code);
        if (s.token && s.profile) {
          clearInterval(iv);
          acceptAuth(s.token, s.profile);
          toast('success', `Welcome, ${s.profile.name}!`);
          onClose();
        } else if (!s.pending) {
          clearInterval(iv);
          setCodeExpired(true);
        }
      } catch {
        // transient — keep polling
      }
    }, 3000);
    return () => clearInterval(iv);
    // Only the code itself may restart the poll. The callbacks are stored in
    // refs-by-closure here on purpose: onClose/toast are fresh arrow props on
    // every parent render, and depending on them tears the interval down each
    // time a table broadcast re-renders the parent — often faster than the 3s
    // tick, so the poll would never fire at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, codeExpired]);

  const startDemo = async () => {
    setJoining(true);
    try {
      await signInDemo(demoName);
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not start the demo');
    } finally {
      setJoining(false);
    }
  };

  // Portaled to <body>: the sticky header's backdrop-filter otherwise turns
  // it into the containing block for position:fixed, pinning the modal to
  // the top strip of the screen.
  // Code-verification screen replaces the modal body while active.
  if (code) {
    return createPortal(
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <h3>Verify with a code</h3>
          {codeExpired ? (
            <>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.92rem' }}>
                That code expired. Grab a fresh one and try again.
              </p>
              <button className="btn btn-primary" onClick={() => void beginCode()}>New code</button>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.92rem', lineHeight: 1.6 }}>
                {codeVerifyButton ? (
                  <>
                    Go to <strong>{codeVerifyChannel ? `#${codeVerifyChannel}` : 'the poker verify channel'}</strong>{' '}
                    on the {BRAND.org} Discord, hit the green <strong>Verify</strong> button
                    and paste this code in. You'll be signed in automatically.
                  </>
                ) : (
                  <>
                    Send this code as a normal chat message in{' '}
                    <strong>{codeVerifyChannel ? `#${codeVerifyChannel}` : 'the poker verify channel'}</strong>{' '}
                    on the {BRAND.org} Discord. We'll spot it and sign you in automatically.
                  </>
                )}
              </p>
              <div className="verify-code">{code}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <span className="req-spinner" />
                <span style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>Waiting for your message…</span>
              </div>
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setCode(null)}>Back</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Sign in to {BRAND.name}</h3>
        {/* Only on a deployment that was started as a demo. Pick a name and
            play — the point is to show the room working before there is a
            Discord application to sign in with. */}
        {demoMode && (
          <div className="demo-signin">
            <p className="tag">
              This is a demo of the room. Choose a name to look around — no
              account, and nothing here is kept.
            </p>
            <div className="field">
              <label htmlFor="demo-name">Your name</label>
              <input
                id="demo-name" className="input" maxLength={24} value={demoName}
                placeholder="e.g. RiverQueen" autoFocus
                onChange={e => setDemoName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && demoName.trim().length >= 2) void startDemo(); }}
              />
            </div>
            <button
              className="btn btn-primary btn-lg"
              disabled={joining || demoName.trim().length < 2}
              onClick={() => void startDemo()}
            >
              {joining ? 'Joining…' : 'Start looking around'}
            </button>
            {discordEnabled && <div className="divider">or</div>}
          </div>
        )}
        {discordEnabled && (
          <>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', lineHeight: 1.55 }}>
              Your Discord identity is used to verify tournament eligibility and
              confirm winners.
            </p>
            <button className="btn btn-discord btn-lg" onClick={() => signInDiscord()}>
              <DiscordMark /> Log in with Discord
            </button>
            {codeVerify && (
              <button className="btn btn-lg" onClick={() => void beginCode()}>
                Verify with a code
              </button>
            )}
            {codeVerify && (
              <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', textAlign: 'center' }}>
                No login — {codeVerifyButton ? 'paste a short code into the Verify button in' : 'send a short code in'}{' '}
                {codeVerifyChannel ? `#${codeVerifyChannel}` : `the ${BRAND.org} Discord verify channel`}.
              </p>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
