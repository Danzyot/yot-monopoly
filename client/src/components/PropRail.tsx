// The partner rail that runs down the left of the felt. It is an advert at a
// poker table, so it earns its place by being small: a firm name, the offer,
// and the code. No feature lists, no paragraphs.
//
// On a phone there is no room for a column beside the table, so it collapses
// to a single tap-to-open strip that never sits over the cards or the action
// buttons.
import { useEffect, useState } from 'react';
import type { FirmConfig } from '../api';
import { usePromo } from './Promo';
import { IconChevron } from './icons';

function FirmCard({ firm, code }: { firm: FirmConfig; code: string }) {
  const inner = (
    <>
      <span className="pf-name">{firm.name}</span>
      {firm.offer && <span className="pf-offer">{firm.offer}</span>}
      <span className="pf-code">USE CODE {code}</span>
    </>
  );
  // A firm whose affiliate link is not set yet still advertises the code —
  // it just is not a link, rather than a link that goes nowhere.
  return firm.url ? (
    <a className={`prop-firm accent-${firm.accent}`} href={firm.url}
      target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  ) : (
    <div className={`prop-firm accent-${firm.accent}`}>{inner}</div>
  );
}

export default function PropRail() {
  const promo = usePromo();
  // Collapsed by default on a phone: the table comes first.
  const [open, setOpen] = useState(() => window.innerWidth > 900);

  // Coming back to a wide screen should not leave it stuck shut.
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 900) setOpen(true); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!promo?.railEnabled || promo.firms.length === 0) return null;

  return (
    <aside className={`prop-rail${open ? ' open' : ''}`}>
      <button className="prop-rail-toggle" onClick={() => setOpen(o => !o)}
        aria-expanded={open}>
        <span className="prt-code">CODE {promo.code}</span>
        <IconChevron size={14} className={open ? 'flip' : undefined} />
      </button>
      <div className="prop-rail-list">
        {promo.firms.map(f => <FirmCard key={f.id} firm={f} code={promo.code} />)}
      </div>
    </aside>
  );
}

// The same firms as a compact row, for the places a full rail would not fit:
// the elimination popup and the tournament lobby.
export function PropStrip({ title }: { title?: string }) {
  const promo = usePromo();
  if (!promo || promo.firms.length === 0) return null;
  return (
    <div className="prop-strip">
      <div className="prop-strip-head">
        {title ?? `Best deals with code ${promo.code}`}
      </div>
      <div className="prop-strip-list">
        {promo.firms.map(f => <FirmCard key={f.id} firm={f} code={promo.code} />)}
      </div>
    </div>
  );
}
