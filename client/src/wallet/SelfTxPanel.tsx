// "No wallet connection": prove a wallet is yours by sending an exact, odd
// amount of MON from it to itself, from any wallet app. Only the owner can
// send from an address, so that transfer proves control; the MON comes
// straight back and only gas is spent. The server checks the transaction
// (pasted hash, or "Check automatically") and links the wallet the same way
// signing does.
import { useEffect, useRef, useState } from 'react';
import { toast } from '../toast.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { shortAddress } from './eth.ts';
import {
  autoCheckSelfTx, cancelSelfTx, fetchSelfTx, startSelfTx, txHashFrom, verifySelfTx,
  type LinkResult, type SelfTxChallenge,
} from './walletApi.ts';

/** How often the page asks the server to look for the transfer (the server allows one per 10 s). */
const AUTO_EVERY_MS = 15_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function useNow(on: boolean, ms = 1_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`), () => toast(`Could not copy — select it and copy by hand`, 'info'));
}

export default function SelfTxPanel({ onActive }: { onActive?: (active: boolean) => void }) {
  const [challenge, setChallenge] = useState<SelfTxChallenge | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [address, setAddress] = useState('');
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState<'start' | 'verify' | 'cancel' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [lastAuto, setLastAuto] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const addrInput = useRef<HTMLInputElement>(null);
  const now = useNow(!!challenge);
  const left = challenge ? challenge.expiresAt - now : 0;
  const expired = !!challenge && left <= 0;

  // A challenge survives a reload: pick it up.
  useEffect(() => {
    let live = true;
    fetchSelfTx().then(c => { if (live) setChallenge(c); }).catch(() => {}).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => { onActive?.(!!challenge); }, [challenge, onActive]);

  // /wallet#selftx (from the lobby's "no connection needed" link) lands here.
  useEffect(() => {
    if (!loaded || location.hash !== '#selftx') return;
    root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!challenge) addrInput.current?.focus({ preventScroll: true });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const linked = (r: LinkResult) => {
    const w = r.wallet;
    setChallenge(null);
    setHash('');
    setAddress('');
    setAutoNote(null);
    toast(w.balance > 0 ? `Verified ${shortAddress(w.address)} — ${plural(w.balance, 'Chog')}!` : `Linked ${shortAddress(w.address)}`);
  };

  const start = async () => {
    setErr(null);
    const a = address.trim();
    if (!ADDRESS.test(a)) { setErr('Paste your full wallet address: 0x followed by 40 characters'); return; }
    setBusy('start');
    try { setChallenge(await startSelfTx(a)); setAutoNote(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const verify = async () => {
    setErr(null);
    const h = txHashFrom(hash);
    if (!h) { setErr('Paste the transaction hash (0x followed by 64 characters) or its explorer link'); return; }
    setBusy('verify');
    try { linked(await verifySelfTx(h)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const startOver = async () => {
    setBusy('cancel');
    try { await cancelSelfTx(); } catch { /* it lapses on its own anyway */ } finally { setBusy(null); }
    if (challenge) setAddress(challenge.address);
    setChallenge(null);
    setErr(null);
    setAutoNote(null);
  };

  // "Check automatically": ask every 15 s while the tab is visible and the challenge is live.
  const verifying = busy === 'verify';
  useEffect(() => {
    if (!challenge || !auto || expired || verifying) return;
    let live = true;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await autoCheckSelfTx();
        if (!live) return;
        setLastAuto(Date.now());
        if (r.found) linked(r);
        else setAutoNote(r.hint ?? null);
      } catch (e) {
        if (!live) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (/pending|expired/i.test(msg)) setChallenge(null);
        setAutoNote(msg);
      }
    };
    const first = setTimeout(tick, 4_000);
    const t = setInterval(tick, AUTO_EVERY_MS);
    return () => { live = false; clearTimeout(first); clearInterval(t); };
  }, [challenge?.amountWei, auto, expired, verifying]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wl-selftx" ref={root} id="selftx">
      {!challenge && (
        <>
          <p className="wl-method-blurb">Nothing to connect: send a tiny, exact amount of MON <b>from your wallet to itself</b> in any wallet app. Only the owner can send from a wallet, so that proves it is yours. The MON comes straight back to you — you only pay gas.</p>
          <label className="wl-field">
            <span className="small muted">Your wallet address on Monad</span>
            <input ref={addrInput} className="mono" value={address} onChange={e => setAddress(e.target.value)} placeholder="0x…"
              inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Your wallet address"
              onKeyDown={e => { if (e.key === 'Enter') void start(); }} />
          </label>
          <div className="row wrap wl-actions">
            <button className="btn primary chunky" onClick={start} disabled={busy === 'start' || !loaded}>
              {busy === 'start' ? <><span className="spinner" aria-hidden /> Getting your amount…</> : 'Get my amount'}
            </button>
          </div>
        </>
      )}

      {challenge && (
        <>
          <div className="row between wrap wl-selftx-top">
            <span className="small muted">Wallet <b className="mono">{shortAddress(challenge.address)}</b></span>
            <span className={`wl-timer ${left < 5 * 60_000 ? 'hot' : ''}`} aria-live="off">
              {expired ? 'Expired' : <>Expires in <b className="mono">{clock(left)}</b></>}
            </span>
          </div>

          {expired ? (
            <div className="wl-expired">
              <p className="warn"><b>This amount expired.</b> Start again for a new amount — a transfer of the old one no longer counts.</p>
              <button className="btn primary" onClick={startOver} disabled={!!busy}>Start again</button>
            </div>
          ) : (
            <ol className="wl-selftx-steps">
              <li>
                <span className="wl-step-n" aria-hidden>1</span>
                <div className="wl-step-body">
                  <b>Send exactly this amount</b>
                  <div className="wl-amount-row">
                    <span className="wl-amount mono" aria-label={`${challenge.amountMon} MON`}>{challenge.amountMon}<small> MON</small></span>
                    <button className="btn small" onClick={() => copy(challenge.amountMon, 'Amount')}>Copy</button>
                  </div>
                  <span className="small muted">Every digit matters — paste it rather than typing it. On Monad (chain {challenge.chainId}), in MON.</span>
                </div>
              </li>
              <li>
                <span className="wl-step-n" aria-hidden>2</span>
                <div className="wl-step-body">
                  <b>From your wallet <em>to the same wallet</em></b>
                  <div className="wl-amount-row">
                    <span className="wl-to mono">{challenge.address}</span>
                    <button className="btn small" onClick={() => copy(challenge.address, 'Address')}>Copy</button>
                  </div>
                  <div className="wl-safety" role="note">
                    <span aria-hidden>⚠️</span>
                    <span>Send it to <b>your own address</b> — the one above, the same one you send from. <b>Never</b> send MON to anyone else's address: {BRAND.name} will never ask you to. If anyone does, it is a scam.</span>
                  </div>
                  <a className="small wl-open-app" href={challenge.paymentUri}>Open in a wallet app (phone) ↗</a>
                </div>
              </li>
              <li>
                <span className="wl-step-n" aria-hidden>3</span>
                <div className="wl-step-body">
                  <b>Paste the transaction hash</b>
                  <span className="small muted">In your wallet's activity, open the transfer and copy its hash (or its explorer link).</span>
                  <div className="wl-hash-row">
                    <input className="mono" value={hash} onChange={e => setHash(e.target.value)} placeholder="0x…"
                      autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Transaction hash"
                      onKeyDown={e => { if (e.key === 'Enter') void verify(); }} />
                    <button className="btn primary" onClick={verify} disabled={!!busy}>
                      {busy === 'verify' ? <><span className="spinner" aria-hidden /> Checking…</> : 'Verify'}
                    </button>
                  </div>
                  <label className="wl-auto">
                    <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
                    <span>Check automatically{auto && <span className="small muted"> — {lastAuto ? `watching Monad, last looked ${clock(now - lastAuto)} ago` : 'watching Monad for your transfer…'}</span>}</span>
                  </label>
                  {auto && autoNote && <p className="small warn wl-auto-note">{autoNote}</p>}
                </div>
              </li>
            </ol>
          )}

          <p className="small muted wl-why">Why this works: a transaction can only come <i>from</i> a wallet if its owner signs it, so a transfer of this exact amount from {shortAddress(challenge.address)} to itself, sent after you asked, proves the wallet is yours. Plain transfers only — a contract cannot do it for you.</p>
          {!expired && (
            <button className="btn tiny ghost" onClick={startOver} disabled={!!busy}>Use a different wallet</button>
          )}
        </>
      )}
      {err && <p className="warn wl-err" role="alert">{err}</p>}
    </div>
  );
}
