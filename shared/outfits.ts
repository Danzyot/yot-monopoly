// Outfits: wearable items a player puts on their character, one per slot
// (head, eyes, neck, body). The ids live here so server validation and every
// client view agree; the 3D models and their thumbnails are built by
// tools/blender/outfits.py, and how each item sits on each character is in
// client/src/three/characters/outfitFit.json.

export type OutfitSlot = 'head' | 'eyes' | 'neck' | 'body';

export const OUTFIT_SLOTS: { id: OutfitSlot; label: string; emoji: string }[] = [
  { id: 'head', label: 'Head', emoji: '🧢' },
  { id: 'eyes', label: 'Eyes', emoji: '🕶️' },
  { id: 'neck', label: 'Neck', emoji: '📿' },
  { id: 'body', label: 'Body', emoji: '🧥' },
];

export interface OutfitItemDef {
  id: string;
  slot: OutfitSlot;
  name: string;
}

export const OUTFIT_ITEMS: OutfitItemDef[] = [
  { id: 'cap', slot: 'head', name: 'Cap' },
  { id: 'beanie', slot: 'head', name: 'Beanie' },
  { id: 'tophat', slot: 'head', name: 'Top hat' },
  { id: 'crown', slot: 'head', name: 'Crown' },
  { id: 'headphones', slot: 'head', name: 'Headphones' },
  { id: 'shades', slot: 'eyes', name: 'Sunglasses' },
  { id: 'specs', slot: 'eyes', name: 'Round glasses' },
  { id: 'chain', slot: 'neck', name: 'Gold chain' },
  { id: 'scarf', slot: 'neck', name: 'Scarf' },
  { id: 'bowtie', slot: 'neck', name: 'Bow tie' },
  { id: 'hoodie', slot: 'body', name: 'Hoodie' },
  { id: 'jersey', slot: 'body', name: 'Jersey' },
  { id: 'suit', slot: 'body', name: 'Suit jacket' },
  { id: 'varsity', slot: 'body', name: 'Varsity jacket' },
];

/** One item id per slot; a missing slot means nothing worn there. */
export type Outfit = Partial<Record<OutfitSlot, string>>;

const ITEMS = new Map(OUTFIT_ITEMS.map(i => [i.id, i]));
const SLOT_IDS = new Set<string>(OUTFIT_SLOTS.map(s => s.id));

export function getOutfitItem(id: string): OutfitItemDef | undefined {
  return ITEMS.get(id);
}

/**
 * Strict check for a pick sent by a client: an object whose keys are slots and
 * whose values are items of that slot (null or '' clears the slot). Returns the
 * cleaned outfit, or a reason it was refused.
 */
export function parseOutfit(raw: unknown): { ok: true; outfit: Outfit } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Unknown outfit' };
  const out: Outfit = {};
  for (const [slot, id] of Object.entries(raw as Record<string, unknown>)) {
    if (!SLOT_IDS.has(slot)) return { ok: false, error: 'Unknown outfit slot' };
    if (id === null || id === '' || id === undefined) continue;
    const item = typeof id === 'string' ? ITEMS.get(id) : undefined;
    if (!item || item.slot !== slot) return { ok: false, error: 'Unknown outfit item' };
    out[slot as OutfitSlot] = item.id;
  }
  return { ok: true, outfit: out };
}

/** Lenient version for stored data (snapshots, saved preferences): drops anything unknown. */
export function sanitizeOutfit(raw: unknown): Outfit {
  const out: Outfit = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const s of OUTFIT_SLOTS) {
    const id = (raw as Record<string, unknown>)[s.id];
    const item = typeof id === 'string' ? ITEMS.get(id) : undefined;
    if (item && item.slot === s.id) out[s.id] = item.id;
  }
  return out;
}

/** A random look for a bot: each slot filled about half the time. */
export function randomOutfit(rand: (n: number) => number): Outfit {
  const out: Outfit = {};
  for (const s of OUTFIT_SLOTS) {
    const items = OUTFIT_ITEMS.filter(i => i.slot === s.id);
    if (rand(2) === 0) out[s.id] = items[rand(items.length)].id;
  }
  return out;
}
