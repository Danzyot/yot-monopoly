// Characters: the figure each player walks around the board as. The id list
// lives here (not in types.ts) so the catalogue — names, blurbs, 2D badges —
// has one home that server validation and every client view read from. The 3D
// models are built in tools/blender/characters.py; their drawn stand-ins and
// the rig live in client/src/three/characters/.

export type CharacterId =
  | 'snacky' | 'starer'
  | 'spiky' | 'robot' | 'cat' | 'knight' | 'wizard'
  | 'astronaut' | 'pirate' | 'ninja' | 'chef' | 'alien';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** One line for the lobby picker. */
  blurb: string;
  /** Shown in 2D badges (player lists, seats) where a 3D render is overkill. */
  emoji: string;
}

export const CHARACTER_DEFS: CharacterDef[] = [
  { id: 'snacky', name: 'CJ WAWA', blurb: 'White tee, silver chain, half a smile. Buys the block and keeps it casual.', emoji: '😏' },
  { id: 'starer', name: 'Yot', blurb: 'Has not blinked since the first roll. He is looking at your hotels.', emoji: '👀' },
  { id: 'spiky', name: 'Spiky', blurb: 'Purple, pointy and always in a hurry.', emoji: '🦔' },
  { id: 'robot', name: 'Robo', blurb: 'Counts rent to the last cent.', emoji: '🤖' },
  { id: 'cat', name: 'Whiskers', blurb: 'Lands on its feet. Usually on your hotel.', emoji: '🐱' },
  { id: 'knight', name: 'Sir Deed', blurb: 'Defends every square of the realm.', emoji: '🛡️' },
  { id: 'wizard', name: 'Merlot', blurb: 'Conjures doubles out of thin air.', emoji: '🧙' },
  { id: 'astronaut', name: 'Cosmo', blurb: 'Rent is astronomical up here.', emoji: '🧑‍🚀' },
  { id: 'pirate', name: 'Captain Cash', blurb: 'Plunders the Free Parking pot.', emoji: '🏴‍☠️' },
  { id: 'ninja', name: 'Shade', blurb: 'In and out of jail without a sound.', emoji: '🥷' },
  { id: 'chef', name: 'Chef Gusto', blurb: 'Cooks up monopolies to order.', emoji: '👨‍🍳' },
  { id: 'alien', name: 'Zorp', blurb: 'Came for the board, stayed for the hotels.', emoji: '👽' },
];

export const CHARACTERS: CharacterId[] = CHARACTER_DEFS.map(c => c.id);

const BY_ID = new Map(CHARACTER_DEFS.map(c => [c.id, c]));

export function isCharacterId(v: unknown): v is CharacterId {
  return typeof v === 'string' && BY_ID.has(v as CharacterId);
}

export function getCharacter(id: string): CharacterDef {
  return BY_ID.get(id as CharacterId) ?? CHARACTER_DEFS[0];
}

// Rooms snapshotted before characters existed stored a `token` (car, hat…).
// Map those onto characters so a restored game keeps everyone distinct.
const LEGACY_TOKENS: Record<string, CharacterId> = {
  car: 'spiky', hat: 'wizard', dog: 'knight', ship: 'pirate',
  boot: 'ninja', iron: 'robot', cat: 'cat', duck: 'alien',
};

/** Character for a persisted seat/player, accepting the old `token` field. */
export function migrateCharacter(x: { character?: unknown; token?: unknown }): CharacterId {
  if (isCharacterId(x.character)) return x.character;
  if (typeof x.token === 'string' && LEGACY_TOKENS[x.token]) return LEGACY_TOKENS[x.token];
  return CHARACTERS[0];
}
