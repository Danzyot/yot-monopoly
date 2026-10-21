// The home page's "Chog of the Day": one Chog Genesis token per UTC day
// (shared/chogs/daily.ts), with its art, name, number and key traits, a link
// to it on OpenSea and the way to play as your own. "Spin it" turns the art
// into the live 3D figure, but only when asked: three.js and the models load
// then, never with the page (without WebGL it shows Chog's emoji badge).
//
// The trait table (shared/chogs/traits.ts, 318 KB) is not in the page: the
// day's traits come from the server (GET /api/chogs/:id, a few hundred bytes),
// asked for as the card first renders. Until they land the card is drawn in
// full with its tier and trait chips held invisible at a typical size.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { chogOfTheDay } from '../../../shared/chogs/daily.ts';
import { chogName } from '../../../shared/chogs/meta.ts';
import type { ChogCard } from '../../../shared/chogs/card.ts';
import type { ChogTraits } from '../../../shared/chogs/traits.ts';
import { openSeaUrl } from '../wallet/walletApi.ts';
import '../styles/home-alive.css';

const loadPreview = () => import('../three/characters/CharacterPreview.tsx');
const CharacterPreview = lazy(loadPreview);

/** The traits worth a chip, in the order a holder reads them. */
const KEY_TRAITS: (keyof ChogTraits)[] = ['Skin', 'Eyes', 'Head', 'Body', 'Accessory', 'Aura'];

/** Stand-ins for the wait, the size of a typical token's chips (most have four or five). */
const PLACEHOLDER_CHIPS = [['Skin', 'Origin'], ['Eyes', 'Round Crying'], ['Head', 'Chog Cap'], ['Body', 'Mon Hoodie']];

const cards = new Map<number, ChogCard | null>();
const pending = new Map<number, Promise<ChogCard | null>>();

/** A token's card data: from the server, or (an old server, or none) from the trait table, loaded only then. */
function loadCard(id: number): Promise<ChogCard | null> {
  let p = pending.get(id);
  if (!p) {
    p = fetch(`/api/chogs/${id}`)
      .then(r => (r.ok ? r.json() as Promise<ChogCard> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(() => import('../../../shared/chogs/card.ts').then(m => m.chogCard(id)))
      .catch(() => null)
      .then(c => { cards.set(id, c); return c; });
    pending.set(id, p);
  }
  return p;
}

export default function ChogOfTheDay() {
  const [id] = useState(() => chogOfTheDay());
  const [spin, setSpin] = useState(false);
  // Already here when the home page is opened again; otherwise asked for once the card is up.
  const [card, setCard] = useState<ChogCard | null | undefined>(() => cards.get(id));
  useEffect(() => {
    if (card !== undefined) return;
    let live = true;
    void loadCard(id).then(c => { if (live) setCard(c); });
    return () => { live = false; };
  }, [id, card]);
  const traits = card?.traits;
  const legendary = traits?.Base === '1:1';
  const ring = card?.background ?? '#eaa2f6';
  const chips = traits ? KEY_TRAITS.flatMap(k => (traits[k] ? [{ k, v: String(traits[k]) }] : [])) : [];
  const day = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const name = chogName(id);
  const art = (
    <img className="cotd-img" src={`/chogs/${id}.webp`} alt={name} width={128} height={128} loading="lazy" decoding="async" />
  );

  return (
    <section className="cotd" aria-labelledby="cotd-title">
      <div className="cotd-card" style={{ ['--cotd-ring' as string]: ring }}>
        <div className="cotd-art">
          {spin ? <Suspense fallback={art}><CharacterPreview character="chog" color="#7a4fe0" chogToken={id} /></Suspense> : art}
        </div>
        <div className="cotd-body">
          <p className="cotd-kicker">Chog of the Day <span>· {day}</span></p>
          <h2 id="cotd-title">
            {name} {traits
              ? <span className={`cotd-tier tier-${traits.Tier.toLowerCase()}`}>{legendary ? 'Legendary 1:1' : traits.Tier}</span>
              : card === undefined && <span className="cotd-tier" aria-hidden="true" style={{ visibility: 'hidden' }}>Uncommon</span>}
          </h2>
          {legendary
            ? <p className="cotd-note">One of ten hand-painted Chogs.</p>
            : traits
              ? (
                <ul className="cotd-traits" aria-label="Traits">
                  {chips.map(c => <li key={c.k}><span>{c.k}</span> {c.v}</li>)}
                </ul>
              )
              : card === undefined && (
                <ul className="cotd-traits" aria-hidden="true" style={{ visibility: 'hidden' }}>
                  {PLACEHOLDER_CHIPS.map(([k, v]) => <li key={k}><span>{k}</span> {v}</li>)}
                </ul>
              )}
          <div className="cotd-links">
            <a className="btn small ghost" href={openSeaUrl(id)} target="_blank" rel="noopener noreferrer">See it on OpenSea ↗</a>
            {spin
              ? <button type="button" className="btn small ghost" onClick={() => setSpin(false)}>See the NFT art</button>
              : (
                <button type="button" className="btn small ghost" onPointerEnter={() => { void loadPreview(); }}
                  onFocus={() => { void loadPreview(); }} onClick={() => setSpin(true)}>Spin it in 3D</button>
              )}
            <Link className="cotd-wallet" to="/wallet">Play as yours: link your wallet →</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
