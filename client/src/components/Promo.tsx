// The promo code advert. Two shapes for two jobs: a slim bar for
// pages people are reading anyway, and a card for the moments they have
// actually stopped to look at something (finishing a tournament, busting).
//
// It is deliberately absent from the felt during a hand — an advert that
// covers the action buttons stops being an advert and starts being a bug.
import { useEffect, useState } from 'react';
import { api, type PromoConfig } from '../api';
import { IconCopy } from './icons';

// One fetch shared by every mounted advert, so six firm cards and a code
// pill cost a single request.
let cached: Promise<PromoConfig | null> | null = null;
function loadPromo(): Promise<PromoConfig | null> {
  cached ??= api.promo().catch(() => null);
  return cached;
}

// Drop the cache so the next read goes back to the server. Called after an
// admin save, and whenever a backgrounded tab is looked at again.
export function refreshPromo() {
  cached = null;
}

export function usePromo(): PromoConfig | null {
  const [promo, setPromo] = useState<PromoConfig | null>(null);
  useEffect(() => {
    let stale = false;
    const pull = () => { void loadPromo().then(p => { if (!stale) setPromo(p); }); };
    pull();
    // Editing the advert in one tab used to leave a game open in another
    // showing the old firms until it was reloaded — the cache lasted as long
    // as the tab did. Coming back to a tab re-reads it.
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      refreshPromo();
      pull();
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      stale = true;
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return promo;
}

function CodePill({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context, older Safari) — selecting the
      // text is the fallback, so make sure it is selectable and say nothing.
    }
  };
  return (
    <button className={`promo-code${copied ? ' copied' : ''}`} onClick={copy}
      title="Copy the code">
      <span className="promo-code-text">{code}</span>
      {copied ? <span className="promo-copied">Copied</span> : <IconCopy size={13} />}
    </button>
  );
}

// The advert itself, given its copy. Exported so the admin editor previews
// exactly what players see rather than a lookalike that can drift.
export function PromoView({ promo, variant = 'bar' }: {
  promo: PromoConfig;
  variant?: 'bar' | 'card';
}) {
  return (
    <div className={`promo promo-${variant}`}>
      <div className="promo-text">
        <span className="promo-headline">{promo.headline}</span>
        {promo.blurb && <span className="promo-blurb">{promo.blurb}</span>}
      </div>
      <div className="promo-actions">
        {promo.code && <CodePill code={promo.code} />}
        {promo.url && (
          <a className="btn btn-primary btn-sm promo-cta" href={promo.url}
            target="_blank" rel="noopener noreferrer">
            {promo.ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}

export default function Promo({ variant = 'bar' }: { variant?: 'bar' | 'card' }) {
  const promo = usePromo();
  if (!promo) return null;
  return <PromoView promo={promo} variant={variant} />;
}
