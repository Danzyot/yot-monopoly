// What a Chog Genesis token wears: its Head (a hat, hair or face prop), its
// Body (an outfit) and its Accessory (something in its hand), as 3D parts.
//
// Shapes are few and shared (tools/blender/chog_wear.py builds one node per
// shape: chog_Hat_<shape>, chog_Wear_<shape>, chog_Prop_<id>); what tells one
// trait value from another on the same shape is its paint: a ground colour,
// a few swatch colours (a brim, lapels, a gem: the shape says which is which),
// a repeating pattern and decals (the text or symbol printed on the front).
// The client paints each figure's own texture from these
// (client/src/three/characters/chogPaint.ts). Decal positions are in the
// slot's own units: `y` in head space for a hat (the head pivot), body space
// for an outfit (the feet); `x` round the front (arc length, + to its left).

export type ChogHatShape =
  | 'cap' | 'bucket' | 'beanie' | 'headband' | 'durag' | 'dome' | 'ushanka' | 'crown' | 'spartan' | 'clownNose' | 'plunger'
  | 'balaclava' | 'rainbowWig' | 'bob' | 'horns' | 'ramHorns' | 'thorns' | 'fedora' | 'gem' | 'thirdEye' | 'wreath' | 'banana'
  | 'seal' | 'shrooms' | 'laserEye'
  // A costume's own hood (painted in the hat slot: no costume comes with a Head).
  | 'hood' | 'sharkHood' | 'bananaHood' | 'dragonHood' | 'toadHood' | 'gangsterHood' | 'astroHelmet';

export type ChogWearShape =
  | 'tee' | 'tank' | 'hoodie' | 'track' | 'suit' | 'vest' | 'robe' | 'chinese' | 'yukata' | 'polo' | 'onesie' | 'astro'
  | 'armor' | 'duck';

export type ChogPropId = 'greenCandle' | 'redCandle' | 'coin' | 'cigar' | 'heart' | 'knife' | 'cup' | 'fwog' | 'pepe';

/** How much of the mane shows: all of it, all but the top spike, the side and back spikes, none of the spikes, or no hair at all. */
export type ChogMane = 'full' | 'crown' | 'cap' | 'hood' | 'none';

/** A repeating pattern over the ground colour, between heights `from` and `to` (y, units) when given. */
export type ChogPattern = { from?: number; to?: number } & (
  /** Knitted ribs running up and down. */
  | { kind: 'ribs'; color: string }
  /** Bands across, `period` apart, `width` wide (units); one wide band fills a range. */
  | { kind: 'stripes'; color: string; period: number; width: number }
  | { kind: 'stars' | 'rings' | 'flowers' | 'speckle' | 'camo' | 'paisley' | 'glitch' | 'patches' | 'quilt' | 'bandage' | 'swirl' | 'trim';
      color: string; color2?: string });

export interface ChogDecal {
  /** Text (`\n` between lines) or a symbol: '@mon', '@btc', '@peace', '@star', '@bolt', '@cloud', '@gear', '@eth', '@pizza', '@choggie', '@feather', '@8ball', '@dot', '@triangle', '@heart', '@flag', '@chog'. */
  text: string;
  color: string;
  /** Outline colour. */
  stroke?: string;
  /** A label behind it, in this colour. */
  box?: string;
  /** Centre: x round the front (+ to its left), y up (units). */
  x?: number;
  y: number;
  /** Height of a line of text or of the symbol (units). */
  size: number;
  /** Text is squeezed to this width (units). */
  w?: number;
  font?: 'block' | 'hand' | 'college' | 'round';
}

export interface ChogPaint {
  /** The ground colour of the projected parts. */
  base: string;
  /** Swatch colours by index (what each paints is up to the shape). */
  sw?: string[];
  pattern?: ChogPattern | ChogPattern[];
  decals?: ChogDecal[];
}

export interface ChogHatSpec {
  shape: ChogHatShape;
  paint: ChogPaint;
  /** Over the shape's own (HAT_MANE). */
  mane?: ChogMane;
  /** Covers the mouth (a ski mask, a bandana). */
  hidesMouth?: boolean;
}

export interface ChogWearSpec {
  shape: ChogWearShape;
  paint: ChogPaint;
  /** Long sleeves: the arms (and legs: the onesie under it) take this colour. */
  sleeves?: string;
  /** A costume's hood, worn up. */
  hood?: ChogHatSpec;
}

/** The mane under each hat. */
export const HAT_MANE: Record<ChogHatShape, ChogMane> = {
  cap: 'cap', bucket: 'cap', beanie: 'cap', headband: 'full', durag: 'cap', dome: 'cap', ushanka: 'cap', crown: 'crown',
  spartan: 'none', clownNose: 'full', plunger: 'cap', balaclava: 'cap', rainbowWig: 'none', bob: 'none', horns: 'full',
  ramHorns: 'full', thorns: 'full', fedora: 'cap', gem: 'full', thirdEye: 'full', wreath: 'full', banana: 'full',
  seal: 'full', shrooms: 'full', laserEye: 'full',
  hood: 'hood', sharkHood: 'hood', bananaHood: 'hood', dragonHood: 'hood', toadHood: 'hood', gangsterHood: 'hood', astroHelmet: 'hood',
};

// ---- heads ----------------------------------------------------------------------

const W = '#ffffff';
const INK = '#1d1a24';

/** Text on the front of a cap's crown. */
const capText = (text: string, color: string, o: Partial<ChogDecal> = {}): ChogDecal =>
  ({ text, color, y: 0.118, size: 0.045, w: 0.22, font: 'block', ...o });
const bucketText = (text: string, color: string, o: Partial<ChogDecal> = {}): ChogDecal =>
  ({ text, color, y: 0.112, size: 0.042, w: 0.22, font: 'block', ...o });
const capSymbol = (text: string, color: string, o: Partial<ChogDecal> = {}): ChogDecal =>
  ({ text, color, y: 0.118, size: 0.05, ...o });

const cap = (base: string, brim: string, ...decals: ChogDecal[]): ChogHatSpec => ({ shape: 'cap', paint: { base, sw: [brim], decals } });
const bucket = (base: string, brim: string, ...decals: ChogDecal[]): ChogHatSpec => ({ shape: 'bucket', paint: { base, sw: [brim], decals } });
const beanie = (base: string, rib: string, ...decals: ChogDecal[]): ChogHatSpec =>
  ({ shape: 'beanie', paint: { base, pattern: { kind: 'ribs', color: rib }, decals } });
/** A patch on a beanie, over its right eye. */
const patch = (text: string, color: string, o: Partial<ChogDecal> = {}): ChogDecal => ({ text, color, x: -0.05, y: 0.128, size: 0.05, ...o });

const MCGA_TEXT = capText('MAKE CHOG\nGREAT AGAIN', W, { size: 0.03, font: 'hand', y: 0.122 });
const MON_CAP = cap('#6a4fd0', '#4a2fa8', capSymbol('@mon', W, { size: 0.044 }));
const BTC_CAP = cap('#f08a1c', '#5a3a28', capSymbol('@btc', W, { size: 0.056 }));
const JEET_CAP = cap('#2fae4e', '#7fd88f', capText('JEET', W, { stroke: '#1d5a2a' }));
const BOOB_CAP = cap('#f2671f', '#f2671f', capText('BOOB', W, { font: 'round' }));
const PEACE_CAP = bucket('#c6303a', '#a8242e', capSymbol('@peace', W, { y: 0.125, size: 0.045 }));

/** Every Head value → its part. */
export const HEAD_MAP: Record<string, ChogHatSpec> = {
  'Mon Cap': MON_CAP,
  'Russian Hat': { shape: 'ushanka', paint: { base: '#cfac80', sw: ['#ecd6b0'], pattern: { kind: 'speckle', color: '#b8946a' } } },
  'Balls Cap': bucket('#7d3cc8', '#7d3cc8', capSymbol('@gear', W, { y: 0.128, size: 0.05 })),
  'Horny Cap': bucket('#2f57d6', '#a99be8', bucketText('HORNY', '#f4b52c', { stroke: INK })),
  'Crown': { shape: 'crown', paint: { base: '#f2b532', sw: ['#d8263a', '#2f6fe0'] } },
  'Choggie Cap': bucket('#e9e6ee', '#e85aa6', bucketText('CHOG', '#6d3fc0', { stroke: INK })),
  'Durag': { shape: 'durag', paint: { base: '#4a4850', pattern: { kind: 'trim', color: '#3a3840' } } },
  'Cloud Cap': bucket('#2f57d6', '#2f57d6', capSymbol('@cloud', W, { y: 0.132, size: 0.036 })),
  'TISM Cap': bucket('#d8253a', '#24222a', bucketText('TISM', W)),
  'Blue Bucket Cap': bucket('#3a7be0', '#2e66c4'),
  'Wizard Hat': { shape: 'dome', paint: { base: '#1f2f7a', pattern: { kind: 'stars', color: '#f8c531' } } },
  'Boob Cap': BOOB_CAP,
  'BOOB Cap': BOOB_CAP,
  'Bob Hair': { shape: 'bob', paint: { base: '#e2302c', sw: ['#f4c22a'], pattern: { kind: 'trim', color: '#c42624' } } },
  'Orange Bucket Cap': bucket('#f27a2a', '#e0661c'),
  'Dollar Cap': bucket('#2fc8ea', '#2fb0d8', { text: 'JUST A KID WITH\n$1 AND A DREAM', color: INK, box: '#eaf8ff', y: 0.115, size: 0.02, w: 0.16, font: 'hand' }),
  'Thunder Cap': bucket('#2f86d8', '#2f78c4', capSymbol('@bolt', '#f8c531', { y: 0.135, size: 0.05 })),
  'Spartan Helmet': { shape: 'spartan', paint: { base: '#d8823a', sw: ['#d8823a', '#e0302c', '#7a4418'] } },
  'Star Cap': bucket('#4a4a52', '#3a3a42', capSymbol('@star', W, { y: 0.135, size: 0.042 })),
  'Red Peace Cap': PEACE_CAP,
  'Peace Cap': PEACE_CAP,
  'Gray Bucket Cap': bucket('#a6a8b0', '#8e9098'),
  'Peace hat': bucket('#5f7a6a', '#3e4e44', capSymbol('@peace', '#e8eee8', { y: 0.125, size: 0.05 })),
  'BTC Cap': BTC_CAP,
  'MCGA': cap('#7a4ad8', '#4e2aa8', MCGA_TEXT),
  'Chog Cap': cap('#7a4ad8', '#4e2aa8', MCGA_TEXT),
  'MMGA Cap': bucket('#cfd8e8', '#7fb4e8', bucketText('MMGA', '#2a3aa8', { stroke: '#101848' })),
  'Red Headband': { shape: 'headband', paint: { base: '#e2302c', pattern: { kind: 'trim', color: '#b8201e' } } },
  'Buttcoin Cap': cap('#f08a1c', '#5a3a28', capText('Buttcoin', W, { font: 'round', size: 0.034 })),
  'Clown Nose': { shape: 'clownNose', paint: { base: '#e8222c', sw: ['#e8222c'] } },
  'Japan Headband': { shape: 'headband', paint: { base: '#f4f4f0', decals: [{ text: '@dot', color: '#e0262c', y: 0.068, size: 0.024 }] } },
  'MEGA Chog': cap('#f2ecd8', '#f2671f', capText('MEGA\nCHOG', INK, { font: 'hand', size: 0.032 })),
  '10k TPS Cap': cap('#eeeef2', '#4a4a52', capText('10K\nTPS', '#5a3ab8', { size: 0.03, box: '#f6f4ff', stroke: '#5a3ab8' })),
  'JEET Cap': JEET_CAP,
  'Jeet Cap': JEET_CAP,
  'Wizard Beanie': {
    shape: 'beanie', paint: {
      base: '#2a4ed8', pattern: [{ kind: 'ribs', color: '#1e3cb0', to: 0.1 }, { kind: 'stripes', color: '#22308a', period: 1, width: 1, from: 0.1, to: 0.4 },
        { kind: 'rings', color: '#f8c531', from: 0.1 }],
    },
  },
  'RETARD Cap': cap('#b45ae8', '#d9a6f4', capText('RETARD', W, { stroke: '#4a2a6a', font: 'college' })),
  'Choggie Beanie': beanie('#3e3e46', '#2e2e36', patch('@choggie', '#a88ae8')),
  'BTC Beanie': beanie('#f05a1c', '#d24814', patch('@pizza', '#f8c531')),
  'Plumber': { shape: 'plunger', paint: { base: '#d8202c', sw: ['#d8202c', '#7a4a24'] } },
  'WAGMI Cap': cap('#e2338a', '#f088c0', capText('WAGMI', W, { stroke: '#6a1040', font: 'college' })),
  'RH Beanie': beanie('#c8f02a', '#a8d01a', patch('@feather', INK)),
  'NEET': cap('#f2f0ea', '#2f4ad0', capText('NEET', '#2f4ad0', { font: 'college', stroke: '#101a58' })),
  'Robber': { shape: 'balaclava', paint: { base: '#4a4a52', pattern: { kind: 'ribs', color: '#36363e' } }, hidesMouth: true },
  'Mon Beanie': { shape: 'beanie', paint: { base: '#2fa0e8', pattern: { kind: 'stripes', color: '#7a3ad8', period: 0.016, width: 0.008, from: 0.02, to: 0.11 } } },
  'MCGA Cap': cap('#e2262c', '#c81e24', capText('MCGA', '#f8b52c', { stroke: '#a01818', font: 'college' })),
  'Rainbow Wig': { shape: 'rainbowWig', paint: { base: '#f8c531', sw: ['#e8262c', '#f27a1c', '#f8d02a', '#4ac83a', '#2f86e8', '#8a3ad8'] } },
  'ETH Cap': cap('#dcdce2', '#8e9098', capSymbol('@eth', '#3a3a46', { size: 0.05 })),
  '8 Ball Beanie': beanie('#2e2e36', '#222228', patch('@8ball', W, { x: 0.04, size: 0.05 })),
  'Mafia Hat': { shape: 'fedora', paint: { base: '#2a2a30', sw: ['#2a2a30', '#e8e8ec'] } },
  // The rare (skull and Radioactive) heads.
  'Red Horn': { shape: 'ramHorns', paint: { base: '#a8584a', sw: ['#a8584a'] } },
  'Purple Horn': { shape: 'ramHorns', paint: { base: '#8a6ad8', sw: ['#8a6ad8'] } },
  'Demon Horn': { shape: 'horns', paint: { base: '#f0703a', sw: ['#f0703a'] } },
  'devil horn': { shape: 'horns', paint: { base: '#e2302c', sw: ['#e2302c'] } },
  'Void Horn': { shape: 'horns', paint: { base: '#9a6ae8', sw: ['#9a6ae8'] } },
  'Gold Thorn': { shape: 'thorns', paint: { base: '#e8a23a', sw: ['#e8a23a'] } },
  'Silver Thorn': { shape: 'thorns', paint: { base: '#9a9aa4', sw: ['#9a9aa4'] } },
  'Diamond': { shape: 'gem', paint: { base: '#7ad8f8', sw: ['#7ad8f8'] } },
  '3rd Eye': { shape: 'thirdEye', paint: { base: '#ffffff' } },
  'Red Bandana': { shape: 'headband', paint: { base: '#d8562c', pattern: { kind: 'paisley', color: '#f8d8c0' } } },
  'Silver wreath': { shape: 'wreath', paint: { base: '#c8c4b4', sw: ['#c8c4b4'] } },
  'Taped Banana': { shape: 'banana', paint: { base: '#f8d43a', sw: ['#f8d43a', '#a8a8b0'] } },
  'Head Wrap': { shape: 'durag', paint: { base: '#e8e2d2', pattern: { kind: 'bandage', color: '#c8bfa8' } } },
  // A golden seal floating over the top of the head: a netted ring with four knobbed spokes.
  'Holy Seal': { shape: 'seal', paint: { base: '#f8cc2a', sw: ['#f8cc2a', '#fff2a0'] } },
  // Toadstools sprouting from the mane: pale green caps (swatch 0) with orange spots (2) on pale stems (1), one little orange one.
  'Poison Shroom': { shape: 'shrooms', paint: { base: '#8cc47e', sw: ['#8cc47e', '#c4e0b0', '#ec9a3e'] } },
  // A third eye in the brow firing a laser (the beam is the figure's glow colour, cyan unless its eyes are lasers).
  'Blue Laser': { shape: 'laserEye', paint: { base: '#ffffff' } },
};

// ---- bodies ---------------------------------------------------------------------

/** Text across the chest. */
const chest = (text: string, color: string, o: Partial<ChogDecal> = {}): ChogDecal =>
  ({ text, color, y: 0.134, size: 0.024, w: 0.11, font: 'block', ...o });

const tee = (base: string, ...decals: ChogDecal[]): ChogWearSpec => ({ shape: 'tee', paint: { base, sw: [shade(base, -0.12)], decals } });
const tank = (base: string, trim = shade(base, -0.15), ...decals: ChogDecal[]): ChogWearSpec => ({ shape: 'tank', paint: { base, sw: [trim], decals } });
/** A basketball jersey: a tank with the number on. */
const jersey = (base: string, trim: string, number: string): ChogWearSpec =>
  ({ shape: 'tank', paint: { base, sw: [trim], decals: [chest('143', number, { size: 0.036, y: 0.122, font: 'college', stroke: trim })] } });
/** A suit: jacket, lapels, shirt, tie, buttons. */
const suit = (jacket: string, lapel = shade(jacket, -0.1), shirt = '#f4f4f2', tie = INK): ChogWearSpec =>
  ({ shape: 'suit', paint: { base: jacket, sw: [lapel, shirt, tie, shade(jacket, -0.3)] }, sleeves: jacket });
const hoodie = (base: string, o: Partial<ChogPaint> = {}): ChogWearSpec =>
  ({ shape: 'hoodie', paint: { base, sw: [base, shade(base, -0.08), '#f4f4f2'], ...o }, sleeves: base });
const track = (base: string, stripe = '#f4f4f2', ...decals: ChogDecal[]): ChogWearSpec =>
  ({ shape: 'track', paint: { base, sw: [base, '#c8ccd6', stripe], decals }, sleeves: base });
const vest = (base: string, inner?: string): ChogWearSpec =>
  ({ shape: 'vest', paint: { base, sw: [shade(base, -0.08), '#c8ccd6'], pattern: { kind: 'quilt', color: shade(base, -0.22) } }, sleeves: inner });
const chinese = (base: string): ChogWearSpec => ({ shape: 'chinese', paint: { base, sw: [shade(base, -0.1), '#f2b532'] }, sleeves: base });
const costume = (base: string, belly: string, hood: ChogHatSpec): ChogWearSpec =>
  ({ shape: 'onesie', paint: { base, sw: [base, belly] }, sleeves: base, hood });
const homeless = (base: string): ChogWearSpec => ({ shape: 'tee', paint: { base, sw: [shade(base, -0.12)], pattern: { kind: 'patches', color: shade(base, -0.18), color2: shade(base, 0.15) } } });
const striped = (base: string, stripe: string): ChogWearSpec =>
  ({ shape: 'tee', paint: { base, sw: [stripe], pattern: { kind: 'stripes', color: stripe, period: 0.026, width: 0.013 } } });

/** Every Body value → its outfit. */
export const BODY_MAP: Record<string, ChogWearSpec> = {
  'Tuxedo': suit('#2a2a30', '#1e1e24'),
  'Kings Robe': { shape: 'robe', paint: { base: '#c42a3a', sw: ['#f6efe2', '#6a3ac8', '#6a3ac8'], pattern: { kind: 'speckle', color: '#b0222f' } }, sleeves: '#c42a3a' },
  'Gangster suit': {
    shape: 'hoodie', paint: { base: '#2e2e36', sw: ['#2e2e36', '#26262c', '#d0d0d6'] }, sleeves: '#2e2e36',
    hood: { shape: 'gangsterHood', paint: { base: '#d8222c', sw: ['#2e2e36'], pattern: { kind: 'paisley', color: '#f8f0f0' } }, hidesMouth: true },
  },
  'Black Trackset': track('#2a2a30'),
  'Farmer Shirt': tee('#f0961e'),
  'Squid Game Guard': hoodie('#e2337a', { decals: [{ text: '@triangle', color: W, y: 0.128, size: 0.028 }] }),
  'Black Vest': vest('#2e2e36', '#3a3a42'),
  'Inmate': tee('#f27a1c', chest('INMATE', INK, { x: 0.035, y: 0.095, size: 0.014, w: 0.06 })),
  'White tuxedo': suit('#f4f2ec', '#e2e0da', '#f4f4f2', '#d8d8d2'),
  'Red Tuxedo': suit('#8a1e2a', '#741822', '#f4f4f2', '#c42a3a'),
  'Prisoner': striped('#f4f4f2', '#1e1e24'),
  'Stripes': striped('#f4f4f2', '#e2302c'),
  'Six Seven': tee('#7fe0c0', chest('67', INK, { size: 0.044, y: 0.122, font: 'college', stroke: '#2a6a5a' })),
  'Fire Shirt': tee('#e2302c'),
  'Black Shirt': tee('#3a3a42'),
  'Cream Tuxedo': suit('#c8a27a', '#b08c66', '#f4f4f2', '#7a5a3a'),
  'Chug Life': tee('#f088c0', chest('CHUG LIFE', INK, { size: 0.022, font: 'hand' })),
  'Hawaiian Polo': { shape: 'polo', paint: { base: '#d8262c', sw: ['#d8262c', '#f4f4f2'], pattern: { kind: 'flowers', color: '#f4f4f2', color2: '#f8c531' } } },
  'Duck Float': { shape: 'duck', paint: { base: '#f8c531', sw: ['#f8c531', '#f27a1c'] } },
  'Blue Chinese': chinese('#2f4ad0'),
  'Tank Top': tank('#6a7a3a'),
  'White Pure Shirt': tee('#f4f4f2'),
  'CWO': tee('#a86ae8', chest('CWO', '#f8c531', { size: 0.036, font: 'college', stroke: INK })),
  'Yellow Yukata': { shape: 'yukata', paint: { base: '#f2a83a', sw: ['#d8742a', '#7a3a2a'], pattern: { kind: 'swirl', color: '#d87a2a' } }, sleeves: '#f2a83a' },
  'Yellow Shirt': tee('#f4e08a'),
  'Pink Tuxedo': suit('#f0a6d0', '#e290bc', '#f4f4f2', '#e86aa8'),
  'Shark Suit': costume('#3a9ee8', '#f4f4f2', { shape: 'sharkHood', paint: { base: '#3a9ee8', sw: ['#3a9ee8', '#f4f4f2'] } }),
  'Banana suit': costume('#f8c02a', '#f8d860', { shape: 'bananaHood', paint: { base: '#f8c02a', sw: ['#f8c02a', '#6a4a2a'] } }),
  'Red Chinese': chinese('#d8262c'),
  'Wizard': { shape: 'robe', paint: { base: '#1e2a5a', sw: ['#f2b532', '#2a2a3a', '#f2b532'], pattern: { kind: 'stars', color: '#f2b532' } }, sleeves: '#1e2a5a' },
  'Jesus': { shape: 'robe', paint: { base: '#f4f2ec', sw: ['#f4f2ec', '#e8e4da', '#c42a2a'] }, sleeves: '#f4f2ec' },
  'Aqua Tuxedo': suit('#8ad8f0', '#72c4e0', '#f4f4f2', '#2a6a9a'),
  'Astro Suit': { shape: 'astro', paint: { base: '#eef0f4', sw: ['#c8ccd6', '#7a8496', '#e2302c', '#2f86e8'], decals: [{ text: '@flag', color: W, x: -0.045, y: 0.13, size: 0.016 }] },
    sleeves: '#eef0f4', hood: { shape: 'astroHelmet', paint: { base: '#eef0f4', sw: ['#eef0f4', '#9aa2b2'] } } },
  'Red shirt': tee('#c8483a'),
  'Dragon suit': costume('#f05a2a', '#f8c531', { shape: 'dragonHood', paint: { base: '#f05a2a', sw: ['#f05a2a', '#f8c531'] } }),
  'Blue tuxedo': suit('#22307a', '#1a2666', '#f4f4f2', '#2f4ad0'),
  'MILF Lover': tee('#8ad0f0', chest('MILF ♥', INK, { size: 0.026, font: 'hand' })),
  'Red Trackset': track('#e2302c'),
  'Squid Game': track('#2f8a6a', '#f4f4f2', chest('069', W, { x: -0.03, y: 0.12, size: 0.024 })),
  'Orange Hoodie': hoodie('#f2671f'),
  'Cyan tuxedo': suit('#2fc0d8', '#28a8bc', '#f4f4f2', '#1a6a7a'),
  'Yellow Hoodie': {
    shape: 'hoodie', paint: { base: '#f2b02a', sw: ['#f2b02a', '#e09e1e', '#f4f4f2'] }, sleeves: '#f2b02a',
    hood: { shape: 'hood', paint: { base: '#f2b02a', sw: ['#f2b02a'] } },
  },
  'Golden Armor': { shape: 'armor', paint: { base: '#f2b532' }, sleeves: '#d89a2a' },
  'Orange Sleeveless': tank('#f2961e'),
  'Mon Hoodie': hoodie('#7a5ae0', { decals: [{ text: '@mon', color: W, x: -0.04, y: 0.105, size: 0.02 }] }),
  'Red Sleeveless': tank('#c8483a'),
  'pink vest': vest('#e8a0e8'),
  'Brown Homeless Shirt': homeless('#a87a52'),
  'White Sleeveless': tank('#f4f4f2', '#e2e2de'),
  'toad blue suit': costume('#3a7ae0', '#8ad8f0', { shape: 'toadHood', paint: { base: '#3a7ae0', sw: ['#3a7ae0', '#e8f8f0', '#4ac85a'] } }),
  'Yellow 143 Jersey': jersey('#f4dc8a', '#7a4ad8', '#f4f4f2'),
  'dark jacket': track('#2a2e4a', '#f4f4f2', { text: '@chog', color: '#f4f4f2', x: -0.04, y: 0.13, size: 0.014 }),
  'Blue 143 Jersey': jersey('#8ab8e8', '#4a6ac8', '#f4f4f2'),
  'Sci Fi': { shape: 'astro', paint: { base: '#f2a42a', sw: ['#3a3a42', '#2a2a30', '#2fd8e8', '#f8e04a'] }, sleeves: '#f2a42a' },
  'Virgin': tee('#f29a5a', chest('VIRGIN', W, { y: 0.115, size: 0.022 })),
  'Electro Hoodie': hoodie('#4a4a52', { pattern: { kind: 'stripes', color: '#f8d02a', period: 0.3, width: 0.006, from: 0.14, to: 0.2 } }),
  'Red jacket': track('#e2402c', '#f4f4f2', { text: '@chog', color: '#f8d02a', x: -0.04, y: 0.13, size: 0.014 }),
  'red tee': tee('#f05a2a', chest('im a Zynner', INK, { box: '#e8f0f8', size: 0.012, w: 0.07 })),
  'Grey Shirt': tee('#c8ccd2'),
  'Blue jacket': track('#2a40b8', '#f4f4f2', { text: '@chog', color: '#f4f4f2', x: -0.04, y: 0.13, size: 0.014 }),
  'Grey Homeless Shirt': homeless('#9aa0a8'),
  'White Shirt': tee('#f4f4f2'),
  'Purple Shirt': tee('#d8b0f0'),
  'blue tee': tee('#8ac0f0', chest('purple-pilled', '#4a3a8a', { size: 0.012, w: 0.08, font: 'hand' })),
  'Glitch Hoodie': hoodie('#3ab0e8', { pattern: { kind: 'glitch', color: '#1a6aa8', color2: '#8ae8f8' } }),
  'dark tee': tee('#3a3a42', chest('HODL', '#1e1e24', { size: 0.026 })),
  'Zero THOTS': tee('#c8a0f0', chest('ZERO THOTS', W, { size: 0.02 })),
  'Blue Sleeveless': tank('#8aa8e8'),
  'white tee': tee('#f4f4f2', chest('IDGAF', '#c42a2a', { size: 0.026 })),
  'White Yukata': { shape: 'yukata', paint: { base: '#f8f0f0', sw: ['#f0c0c8', '#d84a6a'], pattern: { kind: 'speckle', color: '#f0a0b0' } }, sleeves: '#f8f0f0' },
  'Army Vest': vest('#5a6a3a', '#7a5ae0'),
  'Sky Hoodie': hoodie('#3aa8e8'),
  'Blue Homeless Shirt': homeless('#8aa8e8'),
  'purple vest': vest('#a87ae8'),
  'dark vest': vest('#2e2e36'),
  'Toad green Suit': costume('#3ac89a', '#a8f0c0', { shape: 'toadHood', paint: { base: '#3ac89a', sw: ['#3ac89a', '#f8f0e8', '#f27a2a'] } }),
  'Pink Shirt': tee('#f0a090'),
  'Guko': { shape: 'yukata', paint: { base: '#f27a1c', sw: ['#2f4ad0', '#2f4ad0'] }, sleeves: '#2f4ad0' },
  'Red 143 Jersey': jersey('#d8483a', '#7a1e2a', '#f4f4f2'),
  'Toad pink suit': costume('#e8508a', '#f8b0c8', { shape: 'toadHood', paint: { base: '#e8508a', sw: ['#e8508a', '#f8f8f8', '#2fa0e8'] } }),
  'BBC': tee('#3a8ae0', chest('BBC', '#1e2a5a', { size: 0.034, font: 'college' })),
  'Peach Hoodie': hoodie('#f8c0a8', { pattern: { kind: 'speckle', color: '#e8907a' } }),
  'Cyan Shirt': tee('#7ae8e8'),
  'Wizard Cape': { shape: 'robe', paint: { base: '#2a2a4a', sw: ['#f2b532', '#3a3a5a', '#f2b532'], pattern: { kind: 'trim', color: '#f2b532' } }, sleeves: '#2a2a4a' },
  'Stripe Shirt': striped('#f4f4f2', '#e2302c'),
  'Stripe shirts': striped('#f4f4f2', '#e2302c'),
  'Gojo': chinese('#22264a'),
  'CEO Vest': vest('#3a3a46', '#f4f4f2'),
  'Mummy': { shape: 'tee', paint: { base: '#e8e2d2', sw: ['#d8d0bc'], pattern: { kind: 'bandage', color: '#bdb39a' } } },
  'Jesus Robe': { shape: 'robe', paint: { base: '#f4f2ec', sw: ['#f4f2ec', '#e8e4da', '#c42a2a'] }, sleeves: '#f4f2ec' },
  'Boner': tank('#d8e8e0', '#b8ccc2', chest('Boner', '#2a3a4a', { size: 0.024, font: 'hand' })),
  'Purple Tank': tank('#8a8a9a'),
  'Blue Mafia': suit('#22307a', '#1a2666', '#f4f4f2', '#c8a23a'),
  'White Tank': tank('#e8ece8'),
  'Blue Holed Jacket': hoodie('#3a9ae8', { pattern: { kind: 'patches', color: '#1e2a4a', color2: '#2a7ac8' } }),
  'Orange Holed Jacket': hoodie('#f27a2a', { pattern: { kind: 'patches', color: '#3a2a1e', color2: '#d8661c' } }),
};

// ---- accessories -------------------------------------------------------------------

export const ACCESSORY_MAP: Record<string, ChogPropId> = {
  'Fwog': 'fwog', 'SB': 'cup', 'Coin': 'coin', 'Cigar': 'cigar', 'Green Candle': 'greenCandle', 'Red Candle': 'redCandle',
  'Heart': 'heart', 'Knife': 'knife', 'PEPE': 'pepe',
};

/** A colour a little darker (t < 0) or lighter (t > 0). */
export function shade(hex: string, t: number): string {
  const c = parseInt(hex.slice(1), 16);
  const ch = (s: number) => {
    const v = (c >> s) & 255;
    return Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t);
  };
  return `#${[16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')}`;
}
