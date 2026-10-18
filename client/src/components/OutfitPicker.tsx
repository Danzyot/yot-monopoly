// The outfit picker: one tab per slot, a grid of item thumbnails (rendered in
// Blender by tools/blender/outfits.py) under it. Thumbnails draw the
// colour-following parts white plus a mask of them, which is filled with the
// player's colour and multiplied over the picture, so the pictures always
// match the colour the player wears.

import { useState } from 'react';
import { ASSETS } from '../three/assets.gen.ts';
import { itemFits } from '../three/characters/Outfit.tsx';
import { getCharacter, type CharacterId } from '../../../shared/characters.ts';
import {
  OUTFIT_ITEMS, OUTFIT_SLOTS, getOutfitItem, sanitizeOutfit, type Outfit, type OutfitSlot,
} from '../../../shared/outfits.ts';

const THUMBS = ASSETS.outfits as Record<string, string>;

/** The outfit chosen on /characters or last worn, carried into the next lobby. */
export const OUTFIT_PREF_KEY = 'yot:outfit';

export function loadOutfitPref(): Outfit {
  try { return sanitizeOutfit(JSON.parse(localStorage.getItem(OUTFIT_PREF_KEY) ?? '{}')); } catch { return {}; }
}

export function saveOutfitPref(o: Outfit) {
  try { localStorage.setItem(OUTFIT_PREF_KEY, JSON.stringify(o)); } catch { /* private mode */ }
}

export const sameOutfit = (a: Outfit | undefined, b: Outfit | undefined) =>
  OUTFIT_SLOTS.every(s => (a?.[s.id] ?? '') === (b?.[s.id] ?? ''));

/** An item's picture, its colour parts in `color`. */
export function OutfitThumb({ id, color, size = 56 }: { id: string; color: string; size?: number }) {
  const tint = THUMBS[`${id}-tint`];
  return (
    <span className="outfit-thumb" style={{ width: size, height: size }} aria-hidden>
      <img src={THUMBS[id]} alt="" width={size} height={size} loading="lazy" draggable={false} />
      {tint && <span className="outfit-tint" style={{ background: color, maskImage: `url(${tint})`, WebkitMaskImage: `url(${tint})` }} />}
    </span>
  );
}

export default function OutfitPicker({ outfit, color, character, onChange, disabled }: {
  outfit: Outfit;
  color: string;
  character: CharacterId;
  onChange: (o: Outfit) => void;
  disabled?: boolean;
}) {
  const [slot, setSlot] = useState<OutfitSlot>('head');
  const name = getCharacter(character).name;
  const pick = (id: string | null) => {
    const next: Outfit = { ...outfit };
    if (id) next[slot] = id; else delete next[slot];
    onChange(next);
  };
  const items = OUTFIT_ITEMS.filter(i => i.slot === slot);
  const tabId = (s: string) => `outfit-tab-${s}`;
  return (
    <div className="outfit-picker">
      <div className="outfit-tabs" role="tablist" aria-label="Outfit slots">
        {OUTFIT_SLOTS.map(s => {
          const worn = outfit[s.id];
          return (
            <button key={s.id} id={tabId(s.id)} role="tab" aria-selected={slot === s.id} aria-controls="outfit-panel"
              className={`outfit-tab ${slot === s.id ? 'on' : ''}`} onClick={() => setSlot(s.id)}
              title={worn ? `${s.label}: ${getOutfitItem(worn)?.name}` : `${s.label}: nothing`}>
              {worn ? <OutfitThumb id={worn} color={color} size={22} /> : <span className="outfit-tab-empty" aria-hidden>{s.emoji}</span>}
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
      <div id="outfit-panel" className="outfit-grid" role="tabpanel" aria-labelledby={tabId(slot)}>
        <button className={`outfit-item none ${!outfit[slot] ? 'on' : ''}`} aria-pressed={!outfit[slot]} disabled={disabled}
          onClick={() => pick(null)} title="Nothing">
          <span className="outfit-none" aria-hidden>∅</span>
          <small>None</small>
        </button>
        {items.map(i => {
          const fits = itemFits(character, i.id);
          return (
            <button key={i.id} className={`outfit-item ${outfit[slot] === i.id ? 'on' : ''} ${fits ? '' : 'nofit'}`}
              aria-pressed={outfit[slot] === i.id} disabled={disabled} onClick={() => pick(i.id)}
              title={fits ? i.name : `${i.name} — doesn't fit ${name} (hidden on them)`}
              aria-label={fits ? i.name : `${i.name}, hidden on ${name}`}>
              <OutfitThumb id={i.id} color={color} />
              <small>{i.name}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
