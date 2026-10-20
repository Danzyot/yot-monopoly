// The home page's "Chog of the Day": one Chog Genesis token per UTC day
// (shared/chogs/daily.ts), with its art, name, number and key traits, a link
// to it on OpenSea and the way to play as your own. "Spin it" turns the art
// into the live 3D figure, but only when asked: three.js and the models load
// then, never with the page (without WebGL it shows Chog's emoji badge).
import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import { chogOfTheDay } from '../../../shared/chogs/daily.ts';
import { BACKGROUND_COLORS, chogName, traitsOf, type ChogTraits } from '../../../shared/chogs/traits.ts';
import { openSeaUrl } from '../wallet/walletApi.ts';
import '../styles/home-alive.css';

const loadPreview = () => import('../three/characters/CharacterPreview.tsx');
const CharacterPreview = lazy(loadPreview);

/** The traits worth a chip, in the order a holder reads them. */
const KEY_TRAITS: (keyof ChogTraits)[] = ['Skin', 'Eyes', 'Head', 'Body', 'Accessory', 'Aura'];

export default function ChogOfTheDay() {
  const [id] = useState(() => chogOfTheDay());
  const [spin, setSpin] = useState(false);
  const traits = traitsOf(id);
  if (!traits) return null;
  const legendary = traits.Base === '1:1';
  const ring = (traits.Background && BACKGROUND_COLORS[traits.Background]) || '#eaa2f6';
  const chips = KEY_TRAITS.flatMap(k => (traits[k] ? [{ k, v: String(traits[k]) }] : []));
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
            {name} <span className={`cotd-tier tier-${traits.Tier.toLowerCase()}`}>{legendary ? 'Legendary 1:1' : traits.Tier}</span>
          </h2>
          {legendary
            ? <p className="cotd-note">One of ten hand-painted Chogs.</p>
            : (
              <ul className="cotd-traits" aria-label="Traits">
                {chips.map(c => <li key={c.k}><span>{c.k}</span> {c.v}</li>)}
              </ul>
            )}
          <div className="cotd-links">
            <a className="btn small ghost" href={openSeaUrl(id)} target="_blank" rel="noopener noreferrer">See it on OpenSea ↗</a>
            {!spin && (
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
