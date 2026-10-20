// /wallet: link a wallet by signing a message (free, no gas), or without
// connecting it by a self-transfer (SelfTxPanel), and see the Chog Genesis
// tokens the linked wallets hold.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.tsx';
import { askConfirm } from '../components/Modal.tsx';
import { toast, toastError } from '../toast.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { WALLET_DOWNLOADS, getProvider, shortAddress, walletName } from './eth.ts';
import SelfTxPanel from './SelfTxPanel.tsx';
import {
  fetchWalletStatus, linkWalletFlow, openSeaUrl, unlinkWallet, useWalletStatus,
  type LinkStep, type WalletRow, type WalletStatus,
} from './walletApi.ts';
import './wallet.css';

const STEP_LABEL: Record<LinkStep, string> = {
  connect: 'Connecting…',
  network: 'Switching to Monad…',
  sign: 'Waiting for your signature…',
  verify: 'Checking your Chogs…',
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function WalletPage() {
  const { profile, ready, openSignIn, canHost, refreshMe } = useAuth();
  const status = useWalletStatus();
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<LinkStep | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [selfTxActive, setSelfTxActive] = useState(false);
  const onSelfTx = useCallback((on: boolean) => setSelfTxActive(on), []);
  const provider = getProvider();

  useEffect(() => {
    document.title = `Wallet · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);

  useEffect(() => {
    if (!profile || status) return;
    let live = true;
    setLoading(true);
    fetchWalletStatus().catch(e => { if (live) setErr(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [profile, status]);

  // Holding is what makes a host: once the reading changes, ask again so
  // hosting on Poker is offered (or not) without a reload.
  const holder = status?.holder;
  useEffect(() => {
    if (profile && holder !== undefined) void refreshMe();
  }, [profile?.id, holder, refreshMe]);

  const link = async () => {
    setErr(null);
    try {
      const s = await linkWalletFlow(setStep);
      const w = s.wallet;
      toast(w.balance > 0 ? `Linked ${shortAddress(w.address)} — ${plural(w.balance, 'Chog')}!` : `Linked ${shortAddress(w.address)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
    }
  };

  const recheck = async () => {
    setErr(null);
    setChecking('all');
    try {
      const s = await fetchWalletStatus(true);
      if (!s.refreshed) toast('Checked less than a minute ago — showing that reading', 'info');
    } catch (e) { toastError(e); } finally { setChecking(null); }
  };

  const unlink = async (w: WalletRow) => {
    const ok = await askConfirm({
      title: `Unlink ${shortAddress(w.address)}?`,
      body: 'You can link it again any time, by signing another message or with a self-transfer.',
      confirm: 'Unlink', danger: true, icon: '🔗',
    });
    if (!ok) return;
    try { await unlinkWallet(w.address); toast(`Unlinked ${shortAddress(w.address)}`); } catch (e) { toastError(e); }
  };

  if (!ready) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page wl-page">
      <header className="lb-head">
        <h1 className="lb-title"><span aria-hidden>🔗</span> Link your wallet</h1>
        <p className="lb-blurb">Prove you hold a Chog Genesis and the game knows it. Holding a Chog lets you host Poker tables and tournaments. Two ways to prove it: connect your wallet and sign a message (free), or — without connecting anything — send a tiny amount from your wallet to itself.</p>
      </header>

      {!profile && (
        <section className="panel lb-empty">
          <div className="lb-empty-icon" aria-hidden>🎩</div>
          <h2>Sign in first</h2>
          <p className="muted">A wallet links to your {BRAND.name} account, so sign in and then connect it — or verify it with a self-transfer, no connection needed.</p>
          <button className="btn primary chunky" onClick={openSignIn}>Sign in</button>
        </section>
      )}

      {profile && <HolderBanner status={status} canHost={canHost} />}

      {profile && (
        <div className={`wl-methods ${selfTxActive ? 'selftx-on' : ''}`}>
          <section className="panel wl-method wl-connect" aria-labelledby="wl-connect-title">
            <h2 id="wl-connect-title" className="lb-h2 wl-method-title">
              <span>Connect wallet</span>
              <small className="wl-method-sub">sign a message, free</small>
            </h2>
            {provider ? (
              <>
                <ol className="wl-steps" aria-label="What happens">
                  <li><b>1</b> Connect {walletName(provider)}</li>
                  <li><b>2</b> Switch to Monad</li>
                  <li><b>3</b> Sign a message (free)</li>
                  <li><b>4</b> We count your Chogs</li>
                </ol>
                <div className="row wrap wl-actions">
                  <button className="btn primary chunky" onClick={link} disabled={!!step}>
                    {step ? <><span className="spinner" aria-hidden /> {STEP_LABEL[step]}</> : `Connect ${walletName(provider)}`}
                  </button>
                  <span className="small muted">Already linked a wallet? Connect another: an account can hold several.</span>
                </div>
              </>
            ) : (
              <div className="wl-nowallet">
                <p><b>No wallet extension found in this browser.</b> Install one and open it on this page — or skip connecting and use the self-transfer instead.</p>
                <div className="row wrap">
                  {WALLET_DOWNLOADS.map(w => <a key={w.name} className="btn" href={w.url} target="_blank" rel="noreferrer">Get {w.name} ↗</a>)}
                </div>
                <p className="small muted">On a phone, open <b>{location.host}</b> inside the wallet app's browser.</p>
              </div>
            )}
            {err && <p className="warn wl-err" role="alert">{err}</p>}
          </section>

          <section className="panel wl-method wl-selftx-card" aria-labelledby="wl-selftx-title">
            <h2 id="wl-selftx-title" className="lb-h2 wl-method-title">
              <span>No wallet connection</span>
              <small className="wl-method-sub">verify with a self-transfer</small>
            </h2>
            <SelfTxPanel onActive={onSelfTx} />
          </section>
        </div>
      )}

      {profile && (
        <section className="panel wl-wallets" aria-labelledby="wl-list-title">
          <div className="row between wrap">
            <h2 id="wl-list-title" className="lb-h2">Linked wallets <span className="lb-count">{status?.wallets.length ?? 0}</span></h2>
            {!!status?.wallets.length && (
              <button className="btn small" onClick={recheck} disabled={!!checking}>
                {checking ? <><span className="spinner" aria-hidden /> Checking…</> : 'Re-check holdings'}
              </button>
            )}
          </div>
          {loading && !status && <p className="muted">Loading…</p>}
          {status && status.wallets.length === 0 && (
            <p className="muted">Nothing linked yet. Connect a wallet above and sign the message it shows you, or verify one with a self-transfer.</p>
          )}
          {!!status?.wallets.length && (
            <ul className="wl-list">
              {status.wallets.map(w => <WalletCard key={w.address} w={w} contract={status.contract} onUnlink={() => unlink(w)} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function HolderBanner({ status, canHost }: { status: WalletStatus | null; canHost: boolean }) {
  if (!status) return null;
  const n = status.chogs.length;
  if (!status.holder) {
    if (!status.wallets.length) return null;
    return (
      <section className="panel wl-hero none" aria-live="polite">
        <span className="wl-hero-icon" aria-hidden>🔍</span>
        <div className="wl-hero-text">
          <b>No Chog Genesis found yet</b>
          <span>None of your linked wallets holds a Chog right now. Link the wallet that does, or re-check after a transfer. Holding a Chog lets you host Poker tables and tournaments.</span>
        </div>
      </section>
    );
  }
  return (
    <section className="panel wl-hero holder" aria-live="polite">
      <span className="wl-hero-icon" aria-hidden>✅</span>
      <div className="wl-hero-text">
        <b>Verified Chog holder — {plural(n, 'Chog')}</b>
        <span>{n ? 'Token ids: ' : ''}{status.chogs.map(id => `#${id}`).join(', ') || 'Holding confirmed; token ids could not be listed.'}</span>
        {canHost && <span className="wl-host-note"><span aria-hidden>🏆</span> Holding a Chog lets you host Poker tables and tournaments.</span>}
      </div>
    </section>
  );
}

function WalletCard({ w, contract, onUnlink }: { w: WalletRow; contract: string; onUnlink: () => void }) {
  const n = w.tokenIds.length;
  return (
    <li className={`wl-card ${w.balance > 0 ? 'holder' : ''}`}>
      <div className="wl-card-head">
        <span className="wl-addr mono" title={w.address}>{shortAddress(w.address)}</span>
        <span className={`wl-badge ${w.balance > 0 ? 'ok' : ''}`}>
          {w.balance > 0 ? `Verified Chog holder — ${plural(w.balance, 'Chog')}` : 'No Chogs in this wallet'}
        </span>
        <button className="btn tiny ghost wl-unlink" onClick={onUnlink} aria-label={`Unlink ${w.address}`}>Unlink</button>
      </div>
      <div className="wl-card-meta small muted">
        <span>Linked {when(w.linkedAt)}</span>
        {w.checkedAt > 0 && <span>Checked {when(w.checkedAt)}</span>}
        {w.error && <span className="warn">{w.error}</span>}
        {w.partial && <span className="warn">Only {n} of {w.balance} could be listed</span>}
      </div>
      {n > 0 && (
        <ul className="wl-tokens" aria-label={`Chogs in ${shortAddress(w.address)}`}>
          {w.tokenIds.map(id => (
            <li key={id}>
              <a className="wl-token" href={openSeaUrl(id, contract)} target="_blank" rel="noreferrer" title={`Chog Genesis #${id} on OpenSea`}>
                <span className="wl-token-emoji" aria-hidden>🦔</span> #{id} <span className="wl-token-ext" aria-hidden>↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
