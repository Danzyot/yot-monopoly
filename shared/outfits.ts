// Outfits: wearable items a player puts on their character, one per slot
// (head, eyes, neck, body, and a prop held in the right hand). The ids live here so server validation and every
// client view agree; the 3D models and their thumbnails are built by
// tools/blender/outfits.py, and how each item sits on each character is in
// client/src/three/characters/outfitFit.json.
//
// Signature items are a character's own clothes (CJ WAWA's tee and chain):
// only that character can wear them, they are what it wears by
// default, and the game draws them from the character's own model (garment
// nodes in models/characters/<id>.glb) instead of outfits.glb. Picking another item for the
// slot, or nothing, takes the garment off.

import type { CharacterId } from './characters.ts';

export type OutfitSlot = 'head' | 'eyes' | 'neck' | 'body' | 'held';

export const OUTFIT_SLOTS: { id: OutfitSlot; label: string; emoji: string }[] = [
  { id: 'head', label: 'Head', emoji: '🧢' },
  { id: 'eyes', label: 'Eyes', emoji: '🕶️' },
  { id: 'neck', label: 'Neck', emoji: '📿' },
  { id: 'body', label: 'Body', emoji: '🧥' },
  { id: 'held', label: 'Hand', emoji: '🎈' },
];

export interface OutfitItemDef {
  id: string;
  slot: OutfitSlot;
  name: string;
  /** A signature item: only this character wears it (and does by default). */
  only?: CharacterId;
  /** Its garment node in the character's model, models/characters/<only>.glb (`<only>_<node>`), shown while it is worn. */
  node?: string;
}

export const OUTFIT_ITEMS: OutfitItemDef[] = [
  { id: 'cap', slot: 'head', name: 'Cap' },
  { id: 'beanie', slot: 'head', name: 'Beanie' },
  { id: 'tophat', slot: 'head', name: 'Top hat' },
  { id: 'crown', slot: 'head', name: 'Crown' },
  { id: 'headphones', slot: 'head', name: 'Headphones' },
  { id: 'backcap', slot: 'head', name: 'Backwards cap' },
  { id: 'bucket', slot: 'head', name: 'Bucket hat' },
  { id: 'party', slot: 'head', name: 'Party hat' },
  { id: 'halo', slot: 'head', name: 'Halo' },
  { id: 'horns', slot: 'head', name: 'Devil horns' },
  { id: 'bunny', slot: 'head', name: 'Bunny ears' },
  { id: 'cowboy', slot: 'head', name: 'Cowboy hat' },
  { id: 'chef', slot: 'head', name: 'Chef’s hat' },
  { id: 'viking', slot: 'head', name: 'Viking helmet' },
  { id: 'wizard', slot: 'head', name: 'Wizard hat' },
  { id: 'flowers', slot: 'head', name: 'Flower crown' },
  { id: 'propeller', slot: 'head', name: 'Propeller cap' },
  { id: 'headband', slot: 'head', name: 'Sweatband' },
  { id: 'shades', slot: 'eyes', name: 'Sunglasses' },
  { id: 'specs', slot: 'eyes', name: 'Round glasses' },
  { id: 'aviators', slot: 'eyes', name: 'Aviators' },
  { id: 'hearts', slot: 'eyes', name: 'Heart glasses' },
  { id: 'stars', slot: 'eyes', name: 'Star glasses' },
  { id: 'monocle', slot: 'eyes', name: 'Monocle' },
  { id: 'eyepatch', slot: 'eyes', name: 'Eye patch' },
  { id: 'visor', slot: 'eyes', name: 'VR visor' },
  { id: 'glasses3d', slot: 'eyes', name: '3D glasses' },
  { id: 'pixel', slot: 'eyes', name: 'Pixel shades' },
  { id: 'chain', slot: 'neck', name: 'Gold chain' },
  { id: 'scarf', slot: 'neck', name: 'Scarf' },
  { id: 'bowtie', slot: 'neck', name: 'Bow tie' },
  { id: 'medal', slot: 'neck', name: 'Gold medal' },
  { id: 'bandana', slot: 'neck', name: 'Bandana' },
  { id: 'cape', slot: 'neck', name: 'Cape' },
  { id: 'pearls', slot: 'neck', name: 'Pearls' },
  { id: 'lei', slot: 'neck', name: 'Flower lei' },
  { id: 'tie', slot: 'neck', name: 'Necktie' },
  { id: 'hoodie', slot: 'body', name: 'Hoodie' },
  { id: 'jersey', slot: 'body', name: 'Jersey' },
  { id: 'suit', slot: 'body', name: 'Suit jacket' },
  { id: 'varsity', slot: 'body', name: 'Varsity jacket' },
  { id: 'tux', slot: 'body', name: 'Tuxedo' },
  { id: 'puffer', slot: 'body', name: 'Puffer jacket' },
  { id: 'overalls', slot: 'body', name: 'Overalls' },
  { id: 'monad', slot: 'body', name: 'Monad 143 jersey' },
  { id: 'tee', slot: 'body', name: 'Heart tee' },
  { id: 'apron', slot: 'body', name: 'Chef’s apron' },
  { id: 'ziphoodie', slot: 'body', name: 'Zip hoodie' },
  { id: 'coffee', slot: 'held', name: 'Coffee' },
  { id: 'flag', slot: 'held', name: 'Flag' },
  { id: 'balloon', slot: 'held', name: 'Balloon' },
  { id: 'chip', slot: 'held', name: 'Poker chip' },
  { id: 'trophy', slot: 'held', name: 'Trophy' },
  { id: 'dice', slot: 'held', name: 'Dice' },
  { id: 'cash', slot: 'held', name: 'Cash' },
  { id: 'lollipop', slot: 'held', name: 'Lollipop' },
  // Signature items.
  { id: 'wawa_tee', slot: 'body', name: 'WAWA tee', only: 'snacky', node: 'Top' },
  { id: 'cuban_chain', slot: 'neck', name: 'Cuban chain', only: 'snacky', node: 'Chain' },
];

/** One item id per slot; a missing slot means nothing worn there. */
export type Outfit = Partial<Record<OutfitSlot, string>>;

const ITEMS = new Map(OUTFIT_ITEMS.map(i => [i.id, i]));
const SLOT_IDS = new Set<string>(OUTFIT_SLOTS.map(s => s.id));

export function getOutfitItem(id: string): OutfitItemDef | undefined {
  return ITEMS.get(id);
}

/** True when `character` may wear `item` (signature items belong to one character). */
export function canWear(character: CharacterId, item: OutfitItemDef): boolean {
  return !item.only || item.only === character;
}

/** The items a character may pick: every shared item, plus its own signature items. */
export function wearableItems(character: CharacterId): OutfitItemDef[] {
  return OUTFIT_ITEMS.filter(i => canWear(character, i));
}

/** What a character wears until told otherwise: its signature items (nothing for most). */
export function defaultOutfit(character: CharacterId): Outfit {
  const out: Outfit = {};
  for (const i of OUTFIT_ITEMS) if (i.only === character) out[i.slot] = i.id;
  return out;
}

/**
 * An outfit carried over to another character: items it can't wear come off,
 * and slots left empty take its signature items.
 */
export function outfitForCharacter(outfit: Outfit, character: CharacterId): Outfit {
  const out: Outfit = { ...defaultOutfit(character) };
  for (const s of OUTFIT_SLOTS) {
    const item = outfit[s.id] ? ITEMS.get(outfit[s.id]!) : undefined;
    if (item && item.slot === s.id && canWear(character, item)) out[s.id] = item.id;
  }
  return out;
}

/**
 * Strict check for a pick sent by a client: an object whose keys are slots and
 * whose values are items of that slot (null or '' clears the slot). With a
 * character, another character's signature items are refused. Returns the
 * cleaned outfit, or a reason it was refused.
 */
export function parseOutfit(raw: unknown, character?: CharacterId): { ok: true; outfit: Outfit } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Unknown outfit' };
  const out: Outfit = {};
  for (const [slot, id] of Object.entries(raw as Record<string, unknown>)) {
    if (!SLOT_IDS.has(slot)) return { ok: false, error: 'Unknown outfit slot' };
    if (id === null || id === '' || id === undefined) continue;
    const item = typeof id === 'string' ? ITEMS.get(id) : undefined;
    if (!item || item.slot !== slot) return { ok: false, error: 'Unknown outfit item' };
    if (character && !canWear(character, item)) return { ok: false, error: 'That item belongs to another character' };
    out[slot as OutfitSlot] = item.id;
  }
  return { ok: true, outfit: out };
}

/**
 * Lenient version for stored data (snapshots, saved preferences): drops anything
 * unknown, and with a character, anything that character can't wear.
 */
export function sanitizeOutfit(raw: unknown, character?: CharacterId): Outfit {
  const out: Outfit = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const s of OUTFIT_SLOTS) {
    const id = (raw as Record<string, unknown>)[s.id];
    const item = typeof id === 'string' ? ITEMS.get(id) : undefined;
    if (item && item.slot === s.id && (!character || canWear(character, item))) out[s.id] = item.id;
  }
  return out;
}

/**
 * A random look for `character` (a bot's, or a player's "Surprise me"): its
 * signature items stay on; every other slot is filled about half the time
 * (`fill` of the time) from the shared items, or from those `fits` allows
 * (the client leaves out items a character's own hat or helmet hides).
 */
export function randomOutfit(
  rand: (n: number) => number, character: CharacterId,
  opts: { fill?: number; fits?: (item: OutfitItemDef) => boolean } = {},
): Outfit {
  const out = defaultOutfit(character);
  const fill = opts.fill ?? 0.5;
  for (const s of OUTFIT_SLOTS) {
    if (out[s.id]) continue;
    const items = OUTFIT_ITEMS.filter(i => i.slot === s.id && !i.only && (opts.fits?.(i) ?? true));
    if (items.length && rand(1000) < fill * 1000) out[s.id] = items[rand(items.length)].id;
  }
  return out;
}
