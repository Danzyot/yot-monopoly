// Chog Genesis (Monad, 1,969 tokens): every token's traits, and how a token
// becomes a figure. A verified holder plays as their own Chog: the base Chog
// character (tools/blender/detailed.py) with its skin recoloured, its face
// parts swapped (tools/blender/chog_traits.py) and its aura drawn live.
//
// `chogLook(tokenId)` resolves the traits into render parameters. Where a
// trait value has no 3D part yet it maps to the nearest one that does and
// sets `fallback`, so the gaps are easy to list. Head, Body and Accessory
// (what it wears and holds) are in wear.ts; `chogParts` lists the nodes a look
// is built from.
//
// tokens.json is one row per token: [Skin, Eyes, Mouth, Head, Body, Accessory,
// Aura, Background, Tier, Side, Form, Base, Naked, art], `art` being the stem
// of the token's picture on OpenSea's CDN (see chogArtUrl).

import TOKENS from './tokens.json' with { type: 'json' };
import FACE_STYLE from './face-style.json' with { type: 'json' };
import {
  ACCESSORY_MAP, BODY_MAP, HAT_MANE, HEAD_MAP,
  type ChogHatShape, type ChogMane, type ChogPaint, type ChogPropId, type ChogWearShape,
} from './wear.ts';

import { CHOG_CONTRACT, CHOG_SUPPLY, chogName } from './meta.ts';

export * from './wear.ts';
export { CHOG_CONTRACT, CHOG_SUPPLY, chogName };

export type ChogSkin =
  | 'Pink' | 'Origin' | 'Red' | 'Black' | 'Yellow' | 'Blue' | 'White' | 'Green' | 'Purple' | 'Multi Colored'
  | 'Jade' | 'Beige' | 'Metal' | 'Grey';
export type ChogMouth =
  | 'normal smile' | 'Sad' | 'Drooling' | 'Smile' | 'Bubblegum' | 'Rainbow Puke' | 'Worried' | 'Gold Tooth' | 'wo'
  | 'Lip Bite' | 'BTC Coin' | 'Clown Mouth' | 'Flat' | 'Mon coin' | 'Grit';
export type ChogAura =
  | 'Burning Aura' | 'Fiery Aura' | 'Aqua Aura' | 'Rose Aura' | 'Purple' | 'Mint' | 'Wind' | 'Light Purple' | 'Clean'
  | 'Royal Blue Aura' | 'Smoke' | 'Cool Aura' | 'Violet' | 'Yellow Aura' | 'Fire' | 'Royal Aura' | 'Green Aura'
  | 'Rose Scent' | 'Royal Blue' | 'Pink Mist' | 'Electric Shock' | 'White Aura';
export type ChogBackground =
  | 'Light Purple' | 'Lemon' | 'Aqua' | 'Mon' | 'Sunlight' | 'Lemon Yellow' | 'Rosie' | 'Coral Pink' | 'Mint' | 'Peach Pink'
  | 'Light Magenta' | 'Soft Lavender' | 'Sky Blue' | 'Fresh Green' | 'Aqua Mint' | 'Rosy Pink' | 'Lime Green' | 'Deep Aqua'
  | 'Deep Blue' | 'Radioactive' | 'Gold' | 'Deep Purple' | 'Red Sky' | 'Magenta' | 'Supreme Purple' | 'Royal Blue'
  | 'Bright Yellow' | 'Afternoon Orange' | 'Aqua Blue' | 'Noble Blue' | 'Blood Red' | 'Rose Pink';
export type ChogTier = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export type ChogForm = 'Chog' | 'Skull';
export type ChogBase = 'Origin' | 'Skull' | 'Radioactive' | '1:1';

/** The traits as minted. Eyes has 58 values, Head 66, Body 96 (strings; see catalog). */
export interface ChogTraits {
  Skin?: ChogSkin;
  Eyes?: string;
  Mouth?: ChogMouth;
  Head?: string;
  Body?: string;
  Accessory?: string;
  Aura?: ChogAura;
  Background?: ChogBackground;
  Tier: ChogTier;
  Side?: 'Left' | 'Right';
  Form?: ChogForm;
  Base: ChogBase;
  Naked?: 'Yes' | 'No';
}

type Row = (string | null)[];
const ROWS = TOKENS as Record<string, Row>;
const COLS = ['Skin', 'Eyes', 'Mouth', 'Head', 'Body', 'Accessory', 'Aura', 'Background', 'Tier', 'Side', 'Form', 'Base', 'Naked'] as const;

/** Every token id, ascending. */
export const CHOG_TOKEN_IDS: number[] = Object.keys(ROWS).map(Number).sort((a, b) => a - b);

export function isChogTokenId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= CHOG_SUPPLY && String(v) in ROWS;
}

export function traitsOf(tokenId: number): ChogTraits | null {
  const row = ROWS[String(tokenId)];
  if (!row) return null;
  const t: Record<string, string> = {};
  COLS.forEach((c, i) => { if (row[i] != null) t[c] = row[i]!; });
  return t as unknown as ChogTraits;
}

/** The token's picture (OpenSea's CDN, 600px webp); `size` picks a smaller rendition. */
export function chogArtUrl(tokenId: number, size?: number): string {
  const stem = ROWS[String(tokenId)]?.[COLS.length];
  if (!stem) return '';
  const url = `https://i2c.seadn.io/monad/${CHOG_CONTRACT}/${stem.slice(2)}/${stem}.webp`;
  return size ? `${url}?w=${size}&auto=format` : url;
}

// ---- colours (sampled from the art) ----------------------------------------

/** Mane (the hair spikes) and face colour per Skin. The common skins share the cream face; Black is brown. */
export const SKIN_COLORS: Record<ChogSkin, { mane: string; face: string }> = {
  Pink: { mane: '#f26cb0', face: '#f3e6d2' },
  Origin: { mane: '#5b3aa8', face: '#f3e6d2' },
  Red: { mane: '#e8402c', face: '#f3e6d2' },
  Black: { mane: '#5a2a1e', face: '#5e3222' },
  Yellow: { mane: '#f5b916', face: '#f3e6d2' },
  Blue: { mane: '#4ab8e8', face: '#8ee6f2' },
  White: { mane: '#e8e8ec', face: '#f4f4f4' },
  Green: { mane: '#5fd01f', face: '#a8ef2a' },
  Purple: { mane: '#8a68d2', face: '#a58ae0' },
  'Multi Colored': { mane: '#c86ad8', face: '#f0b2cc' },
  Jade: { mane: '#5fbf8c', face: '#8ad9ac' },
  Beige: { mane: '#e2cfae', face: '#efe4cc' },
  Metal: { mane: '#5e6683', face: '#6f7692' },
  Grey: { mane: '#8a8c95', face: '#9c9ea6' },
};

// ---- face versions -------------------------------------------------------------
// The eyes and the Skull face come in versions (tools/blender/chog_faces.py);
// face-style.json picks the one built into the traits file and shown.

export type ChogEyesStyle = 'current' | 'refined' | 'decal' | 'bold';
export type ChogSkullStyle = 'current' | 'sculpted' | 'painted' | 'hybrid';
export interface ChogFaceStyle { eyes: ChogEyesStyle; skull: ChogSkullStyle }
export const CHOG_FACE_STYLE = FACE_STYLE as ChogFaceStyle;

/** A Skull's bone per Skin, sampled from the art (the newer skull versions; `current` derives it from the mane). */
export const SKULL_BONE: Partial<Record<ChogSkin, string>> = {
  White: '#f2f2f2', Red: '#c05854', Grey: '#999ca4', Metal: '#6a718e', Beige: '#efe7d8', Purple: '#9d81dc', Blue: '#65adcd',
  Black: '#3a3944', Yellow: '#efde7b', Jade: '#85d6a4',
};

/** The colour of a Skull's bone. */
export function skullBone(skin: ChogSkin | null, style: ChogSkullStyle = CHOG_FACE_STYLE.skull): string {
  if (style !== 'current' && skin && SKULL_BONE[skin]) return SKULL_BONE[skin]!;
  const sc = skin ? SKIN_COLORS[skin] : SKIN_COLORS.Origin;
  // Today's: bone in the skin's colour (the common skins' cream face does not apply to it).
  return skin && ['Pink', 'Origin', 'Red', 'Yellow', 'Black'].includes(skin) ? mix(sc.mane, '#ffffff', 0.35) : sc.face;
}

export const BACKGROUND_COLORS: Record<ChogBackground, string> = {
  'Light Purple': '#eaa2f6', Lemon: '#f6f6a2', Aqua: '#96eaf6', Mon: '#96aef6', Sunlight: '#ead296', 'Lemon Yellow': '#f6f696',
  Rosie: '#f6a2c6', 'Coral Pink': '#ea9696', Mint: '#a2f6ba', 'Peach Pink': '#f6a296', 'Light Magenta': '#f696f6',
  'Soft Lavender': '#a28aea', 'Sky Blue': '#8ad2ea', 'Fresh Green': '#a2f696', 'Aqua Mint': '#96f6d2', 'Rosy Pink': '#f65a96',
  'Lime Green': '#5af67e', 'Deep Aqua': '#5aeaf6', 'Deep Blue': '#5a72f6', Radioactive: '#8ef65a', Gold: '#f6c636',
  'Deep Purple': '#6a3ab8', 'Red Sky': '#f66a5a', Magenta: '#e63ab8', 'Supreme Purple': '#8a4ae6', 'Royal Blue': '#3a5af6',
  'Bright Yellow': '#f6e63a', 'Afternoon Orange': '#f6a24a', 'Aqua Blue': '#5ac6f6', 'Noble Blue': '#2a4ab8', 'Blood Red': '#c62a3a',
  'Rose Pink': '#f67ab6',
};

// ---- face parts -------------------------------------------------------------
// Each variant is a node in models/characters/chog-traits.glb (chog_Eyes_<id>,
// chog_Mouth_<id>), built by tools/blender/chog_traits.py.

export type ChogEyesVariant =
  | 'normal' | 'happy' | 'side' | 'laser' | 'dead' | 'round' | 'roundSmall' | 'heart' | 'roundCrying' | 'roundTear'
  | 'closedCrying' | 'teary' | 'tired' | 'angry' | 'flat' | 'vertical' | 'base' | 'xd'
  | 'animeGlass' | 'retroGlass' | 'btcGlass' | 'glasses3d' | 'shades' | 'visor' | 'goggles'
  | 'smirk' | 'frog' | 'clown' | 'clownMix' | 'worried' | 'up' | 'vrModern' | 'vrClassic' | 'viper' | 'derp';

export const CHOG_EYES_VARIANTS: ChogEyesVariant[] = [
  'normal', 'happy', 'side', 'laser', 'dead', 'round', 'roundSmall', 'heart', 'roundCrying', 'roundTear',
  'closedCrying', 'teary', 'tired', 'angry', 'flat', 'vertical', 'base', 'xd',
  'animeGlass', 'retroGlass', 'btcGlass', 'glasses3d', 'shades', 'visor', 'goggles',
  'smirk', 'frog', 'clown', 'clownMix', 'worried', 'up', 'vrModern', 'vrClassic', 'viper', 'derp',
];

interface EyesSpec {
  id: ChogEyesVariant;
  /** Laser beam colour (the `glow` material; also a VR headset's neon rim). */
  laser?: string;
  /** Lens / visor colour (the `glass` material; also a clown's face paint and a smirk's iris). */
  lens?: string;
  /** Not quite this: the nearest part that exists (none left, but a new value would say so). */
  fallback?: true;
  /** The part the drawn eye versions use instead (face-style.json eyes other than `current`). */
  drawn?: ChogEyesVariant;
}

/** Retard: big round eyes, their little pupils looking two ways (today's build shows 3D glasses). */
const retard: EyesSpec = { id: 'glasses3d', lens: '#3a86ff', drawn: 'derp' };

const laser = (c: string): EyesSpec => ({ id: 'laser', laser: c });
const visor = (c: string): EyesSpec => ({ id: 'visor', lens: c });

/** Every Eyes value in the collection → its part. */
export const EYES_MAP: Record<string, EyesSpec> = {
  'Happy': { id: 'happy' }, 'Side Eye': { id: 'side' }, 'Purple laser': laser('#c04cff'), 'fire laser': laser('#ff7a1a'),
  'Dead': { id: 'dead' }, 'Round': { id: 'round' }, 'Normal Eye': { id: 'normal' }, 'Heart': { id: 'heart' },
  'Round Crying': { id: 'roundCrying' }, 'Green laser': laser('#4cff5a'), 'Round Tear': { id: 'roundTear' },
  'Anime Glass': { id: 'animeGlass', lens: '#f4f8ff' }, 'Round Eye': { id: 'roundSmall' }, 'Gradient visor': visor('#d26ac8'),
  'Closed Eye Crying': { id: 'closedCrying' }, 'Tired': { id: 'tired' }, 'Retro Glass': { id: 'retroGlass', lens: '#a9dcff' },
  'Teary': { id: 'teary' }, 'Sunset visor': visor('#ff5a3a'), 'Plasma visor': visor('#2fd0c4'), 'Angry': { id: 'angry' },
  'Flat': { id: 'flat' }, 'Vertical': { id: 'vertical' }, 'Base': { id: 'base' }, 'MOG': { id: 'goggles', lens: '#ffb03a' },
  'Smirk': { id: 'smirk', lens: '#17171f' }, 'Frog': { id: 'frog' }, 'Clown Eye': { id: 'clown', lens: '#2a4cf0' },
  'Modern VR': { id: 'vrModern', lens: '#121219', laser: '#1a9cff' }, 'Chog Viper': { id: 'viper', lens: '#167ee0' },
  'Classic VR': { id: 'vrClassic', lens: '#141419' }, 'Clown Eye Mix': { id: 'clownMix', lens: '#2a4cf0' }, 'XD': { id: 'xd' },
  'Retard': retard, '3D Glass': { id: 'glasses3d', lens: '#3a86ff' }, 'Worried': { id: 'worried' },
  'BTC Glass': { id: 'btcGlass', lens: '#f4a21a' }, 'cyan laser': laser('#3ae8ff'), 'Thug': { id: 'shades' },
  'Red Round Eye': { id: 'roundSmall' }, 'Green Side Eye': { id: 'side' }, 'Blue Retard': retard,
  'Red Flat': { id: 'flat' }, 'Up': { id: 'up' }, 'Green Happy': { id: 'happy' }, 'Mixed Retard': retard,
  'Mixed Happy': { id: 'happy' }, 'Blue Round Eye': { id: 'roundSmall' }, 'Normal': { id: 'normal' }, 'Mixed Side Eye': { id: 'side' },
  'Blue Smirk': { id: 'smirk', lens: '#2f6ff0' }, 'Mixed Round Eye': { id: 'roundSmall' }, 'Blue Happy': { id: 'happy' }, 'Red Retard': retard,
  'Blue Flat': { id: 'flat' }, 'Green Round Eye': { id: 'roundSmall' }, 'Green Retard': retard, 'Green Smirk': { id: 'smirk', lens: '#2fb64a' },
};

export type ChogMouthVariant =
  | 'normalSmile' | 'sad' | 'drooling' | 'smile' | 'bubblegum' | 'rainbowPuke' | 'worried' | 'goldTooth' | 'wo'
  | 'lipBite' | 'btcCoin' | 'clownMouth' | 'flat' | 'monCoin' | 'grit';

export const MOUTH_MAP: Record<ChogMouth, ChogMouthVariant> = {
  'normal smile': 'normalSmile', Sad: 'sad', Drooling: 'drooling', Smile: 'smile', Bubblegum: 'bubblegum', 'Rainbow Puke': 'rainbowPuke',
  Worried: 'worried', 'Gold Tooth': 'goldTooth', wo: 'wo', 'Lip Bite': 'lipBite', 'BTC Coin': 'btcCoin', 'Clown Mouth': 'clownMouth',
  Flat: 'flat', 'Mon coin': 'monCoin', Grit: 'grit',
};
export const CHOG_MOUTH_VARIANTS = Object.values(MOUTH_MAP) as ChogMouthVariant[];

export type ChogAuraKind = 'fire' | 'smoke' | 'wind' | 'glow';

export const AURA_MAP: Record<ChogAura, { kind: ChogAuraKind; color: string }> = {
  'Burning Aura': { kind: 'fire', color: '#ff7a24' }, 'Fiery Aura': { kind: 'fire', color: '#ff5a1a' }, Fire: { kind: 'fire', color: '#ff8c2a' },
  Smoke: { kind: 'smoke', color: '#9a9aa6' }, Wind: { kind: 'wind', color: '#dfe8f2' },
  'Aqua Aura': { kind: 'glow', color: '#5ad8ee' }, 'Rose Aura': { kind: 'glow', color: '#ff7eb0' }, Purple: { kind: 'glow', color: '#9a5cff' },
  Mint: { kind: 'glow', color: '#7ff0c0' }, 'Light Purple': { kind: 'glow', color: '#c8a0ff' }, Clean: { kind: 'glow', color: '#ffffff' },
  'Royal Blue Aura': { kind: 'glow', color: '#3f6cff' }, 'Cool Aura': { kind: 'glow', color: '#60c8ff' }, Violet: { kind: 'glow', color: '#8a3fff' },
  'Yellow Aura': { kind: 'glow', color: '#ffd93a' }, 'Royal Aura': { kind: 'glow', color: '#ffd04a' }, 'Green Aura': { kind: 'glow', color: '#5cff5c' },
  'Rose Scent': { kind: 'glow', color: '#ffa0c8' }, 'Royal Blue': { kind: 'glow', color: '#3f6cff' }, 'Pink Mist': { kind: 'glow', color: '#ff9ad8' },
  'Electric Shock': { kind: 'glow', color: '#7ff0ff' }, 'White Aura': { kind: 'glow', color: '#ffffff' },
};

// ---- the look ----------------------------------------------------------------

/** The per-figure material colours a token sets (keys of the character material set, parts.tsx). */
export interface ChogColors {
  /** Face (skull for the Skull form). */
  skin: string;
  /** The mane. */
  hair: string;
  /** Laser beams. */
  glow: string;
  /** Visor and glasses lenses. */
  glass: string;
  /** Blush, nose, bubblegum. */
  accent: string;
  /** Red: hearts, clown mouth, the 3D glasses' left lens, the rainbow's first stripe. */
  c1: string;
  /** Light blue: tears, drool. */
  c2: string;
  /** Purple: the Mon coin. */
  c3: string;
  /** Green: the rainbow's middle stripe. */
  denim: string;
  /** The onesie (arms and legs) under a long-sleeved outfit; otherwise the player's colour. */
  cloth?: string;
}

export interface ChogLook {
  token: number;
  name: string;
  tier: ChogTier;
  side: 'left' | 'right';
  /** A hand-painted 1:1 (no traits): shown as the base Chog with a badge. */
  legendary: boolean;
  form: 'chog' | 'skull';
  base: 'origin' | 'radioactive';
  skin: ChogSkin | null;
  eyes: ChogEyesVariant;
  /** The eyes blink with the base model's lids (only the base eye shape fits them). */
  lids: boolean;
  /** None for the Skull form (its teeth are the mouth) and the 1:1s. */
  mouth: ChogMouthVariant | null;
  aura: { kind: ChogAuraKind; color: string } | null;
  /** The token's background colour: name tag, plinth ring, card frame, gallery stand. */
  background: string;
  /** What it wears on its head (its Head, or its costume's hood), painted per value. */
  head: { value: string; shape: ChogHatShape; paint: ChogPaint } | null;
  /** Its outfit. */
  body: { value: string; shape: ChogWearShape; paint: ChogPaint } | null;
  /** What it holds in its right hand. */
  accessory: ChogPropId | null;
  /** How much of the mane shows under the hat (none on a skull: they are bald). */
  mane: ChogMane;
  colors: ChogColors;
  /** Some trait fell back to the nearest existing part; `fallbacks` says which. */
  fallback: boolean;
  fallbacks: string[];
}

const DEFAULT_COLORS: Omit<ChogColors, 'skin' | 'hair'> = {
  glow: '#7ff6ff', glass: '#1c2438', accent: '#ec6f98', c1: '#e8323c', c2: '#8fd3ff', c3: '#7b4fd8', denim: '#3cc35a',
};

function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((ca >> s) & 255) * (1 - t) + ((cb >> s) & 255) * t);
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/** The base Chog's own colours (looks.tsx), for the 1:1s and anything unresolved. */
const ORIGIN_SKIN = SKIN_COLORS.Origin;

/** `style`: the face versions to resolve for (default: the ones built, face-style.json). */
export function chogLook(tokenId: number, style: ChogFaceStyle = CHOG_FACE_STYLE): ChogLook | null {
  const t = traitsOf(tokenId);
  if (!t) return null;
  const fallbacks: string[] = [];
  const legendary = t.Base === '1:1';
  const skin = t.Skin && t.Skin in SKIN_COLORS ? t.Skin : null;
  if (!legendary && !skin) fallbacks.push(`Skin: ${t.Skin ?? 'none'}`);
  const form: ChogLook['form'] = t.Form === 'Skull' ? 'skull' : 'chog';
  const sc = skin ? SKIN_COLORS[skin] : ORIGIN_SKIN;
  const face = form === 'skull' ? skullBone(skin, style.skull) : sc.face;

  let eyes: EyesSpec = { id: 'normal' };
  if (t.Eyes) {
    const spec = EYES_MAP[t.Eyes];
    if (spec) eyes = spec;
    else fallbacks.push(`Eyes: ${t.Eyes}`);
    if (spec?.fallback) fallbacks.push(`Eyes: ${t.Eyes}`);
  }
  const eyesId = style.eyes !== 'current' && eyes.drawn ? eyes.drawn : eyes.id;
  let mouth: ChogMouthVariant | null = null;
  if (t.Mouth) {
    mouth = MOUTH_MAP[t.Mouth] ?? null;
    if (!mouth) fallbacks.push(`Mouth: ${t.Mouth}`);
  } else if (form === 'chog' && !legendary) {
    mouth = 'normalSmile';
  }
  // What it wears: a Head of its own, or its costume's hood (no costume comes with a Head).
  const bodySpec = t.Body ? BODY_MAP[t.Body] : undefined;
  if (t.Body && !bodySpec) fallbacks.push(`Body: ${t.Body}`);
  const headSpec = t.Head ? HEAD_MAP[t.Head] : bodySpec?.hood;
  if (t.Head && !HEAD_MAP[t.Head]) fallbacks.push(`Head: ${t.Head}`);
  const accessory = t.Accessory ? ACCESSORY_MAP[t.Accessory] ?? null : null;
  if (t.Accessory && !accessory) fallbacks.push(`Accessory: ${t.Accessory}`);
  const headValue = t.Head ?? t.Body;
  const mane: ChogMane = form === 'skull' ? 'none' : headSpec ? headSpec.mane ?? HAT_MANE[headSpec.shape] : 'full';
  if (headSpec?.hidesMouth) mouth = null;
  const aura = t.Aura ? AURA_MAP[t.Aura] ?? null : null;
  if (t.Aura && !aura) fallbacks.push(`Aura: ${t.Aura}`);
  const background = (t.Background && BACKGROUND_COLORS[t.Background]) || (legendary ? '#f6c636' : '#eaa2f6');
  if (t.Background && !BACKGROUND_COLORS[t.Background]) fallbacks.push(`Background: ${t.Background}`);

  return {
    token: tokenId,
    name: chogName(tokenId),
    tier: t.Tier,
    side: t.Side === 'Left' ? 'left' : 'right',
    legendary,
    form,
    base: t.Base === 'Radioactive' ? 'radioactive' : 'origin',
    skin,
    eyes: eyesId,
    lids: eyesId === 'normal' && form === 'chog',
    mouth,
    aura,
    background,
    head: headSpec && headValue ? { value: headValue, shape: headSpec.shape, paint: headSpec.paint } : null,
    body: bodySpec && t.Body ? { value: t.Body, shape: bodySpec.shape, paint: bodySpec.paint } : null,
    accessory,
    mane,
    colors: {
      ...DEFAULT_COLORS,
      ...(bodySpec?.sleeves ? { cloth: bodySpec.sleeves } : {}),
      skin: face,
      hair: sc.mane,
      glow: eyes.laser ?? DEFAULT_COLORS.glow,
      glass: eyes.lens ?? DEFAULT_COLORS.glass,
    },
    fallback: fallbacks.length > 0,
    fallbacks,
  };
}

/**
 * The trait parts a look is built from, as node names in the traits file
 * (models/characters/chog-traits.glb), by the rig bone they hang on.
 * `beams`: the laser beams (off on Low, where they are the parts reaching out past the figure).
 */
export function chogParts(look: ChogLook, beams: boolean): { Head: string[]; Body: string[]; HandR: string[] } {
  const head = [look.form === 'skull' ? 'chog_HeadSkull' : 'chog_HeadBare', `chog_Eyes_${look.eyes}`];
  if (look.mane !== 'none') head.push(`chog_Hair_${look.mane}`);
  if (look.eyes === 'laser' && beams) head.push('chog_LaserBeams');
  if (look.mouth) head.push(`chog_Mouth_${look.mouth}`);
  if (look.head) head.push(`chog_Hat_${look.head.shape}`);
  // The Blue Laser's beam out of its third eye (off on Low, like the eyes' beams).
  if (look.head?.shape === 'laserEye' && beams) head.push('chog_BrowBeam');
  return {
    Head: head,
    Body: look.body ? [`chog_Wear_${look.body.shape}`] : [],
    HandR: look.accessory ? [`chog_Prop_${look.accessory}`] : [],
  };
}

let resolved: number[] | null = null;
/**
 * Tokens whose every trait has a part of its own (no 1:1s, no fallbacks):
 * the ones bots play as, so a table of bots looks like a crowd of real Chogs.
 */
export function resolvedChogTokens(): number[] {
  return (resolved ??= CHOG_TOKEN_IDS.filter(id => {
    const look = chogLook(id);
    return !!look && !look.legendary && !look.fallback;
  }));
}

/** Which of a holder's tokens are 1:1 Legendaries (shown as the base Chog with a badge). */
export const isLegendary = (tokenId: number) => traitsOf(tokenId)?.Base === '1:1';
