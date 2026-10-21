// The light half of outfits on the client: the saved pick both games' lobbies
// and /characters share, and item thumbnails for 2D badges. No three.js here
// (OutfitPicker.tsx brings that), so the card table can show what a seat
// wears without loading the 3D figures.

import { ASSETS } from '../three/assets.gen.ts';
import type { CharacterId } from '../../../shared/characters.ts';
import {
  OUTFIT_SLOTS, defaultOutfit, getOutfitItem, outfitForCharacter, sanitizeOutfit, type Outfit,
} from '../../../shared/outfits.ts';

const THUMBS = ASSETS.outfits as Record<string, string>;

/** The outfit chosen on /characters or last worn (Monopoly or Cards), carried into the next lobby, and who it was chosen for. */
export const OUTFIT_PREF_KEY = 'yot:outfit';
const OUTFIT_FOR_KEY = 'yot:outfit-for';

/**
 * The saved outfit, as worn by `character`: exactly as saved when it was chosen
 * for them (an emptied slot stays empty), carried over otherwise (another
 * character's own clothes come off, empty slots take this one's). Nothing
 * saved: the character's own look.
 */
export function loadOutfitPref(character: CharacterId): Outfit {
  try {
    const raw = localStorage.getItem(OUTFIT_PREF_KEY);
    if (raw === null) return defaultOutfit(character);
    const saved = sanitizeOutfit(JSON.parse(raw));
    return localStorage.getItem(OUTFIT_FOR_KEY) === character ? sanitizeOutfit(saved, character) : outfitForCharacter(saved, character);
  } catch { return defaultOutfit(character); }
}

export function saveOutfitPref(o: Outfit, character: CharacterId) {
  try {
    localStorage.setItem(OUTFIT_PREF_KEY, JSON.stringify(o));
    localStorage.setItem(OUTFIT_FOR_KEY, character);
  } catch { /* private mode */ }
}

/** The colour picked in the welcome tour: worn at the next table when it is free there. */
export const COLOR_PREF_KEY = 'yot:color';

export function loadColorPref(): string | null {
  try {
    const c = localStorage.getItem(COLOR_PREF_KEY);
    return c && /^#[0-9a-f]{6}$/i.test(c) ? c : null;
  } catch { return null; }
}

export function saveColorPref(c: string) {
  try { localStorage.setItem(COLOR_PREF_KEY, c); } catch { /* private mode */ }
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

/** The items worn, in slot order (head first). */
export function wornItems(outfit: Outfit | undefined): string[] {
  return OUTFIT_SLOTS.flatMap(s => (outfit?.[s.id] && THUMBS[outfit[s.id]!] ? [outfit[s.id]!] : []));
}

/** "Cap, Sunglasses" for a title or a label; '' when nothing is worn. */
export function outfitLabel(outfit: Outfit | undefined): string {
  return wornItems(outfit).map(id => getOutfitItem(id)?.name ?? id).join(', ');
}

/** A small row of what a seat wears, for 2D seat badges. Nothing when nothing is worn. */
export function WornItems({ outfit, color, size = 18, className = '' }: { outfit: Outfit | undefined; color: string; size?: number; className?: string }) {
  const items = wornItems(outfit);
  if (!items.length) return null;
  return (
    <span className={`outfit-worn ${className}`} role="img" aria-label={`Wearing ${outfitLabel(outfit)}`} title={outfitLabel(outfit)}>
      {items.map(id => <OutfitThumb key={id} id={id} color={color} size={size} />)}
    </span>
  );
}
