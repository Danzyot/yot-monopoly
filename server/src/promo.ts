// The promo code the site advertises. It lives on the persistent
// volume rather than in an env var so the operator can change the code, the
// wording or the link from the admin dashboard without a redeploy — codes
// and partner offers change far more often than the code does.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

const FILE = join(DATA_DIR, 'promo.json');

// One partner firm on the rail. Deliberately thin: at a poker table there is
// room for a name, an offer and a link, and nothing else.
export interface Firm {
  id: string;
  name: string;
  // "40% OFF", "CODE CHOG" — the headline number, not a sentence.
  offer: string;
  url: string;
  // Which accent the card wears, so the rail reads as a set rather than six
  // identical boxes. Free-form; the client maps unknown values to purple.
  accent: 'purple' | 'green' | 'gold' | 'blue';
}

export interface Promo {
  enabled: boolean;
  // The code itself — shown in a copyable pill.
  code: string;
  // One line of pitch. Kept short: this sits above a poker table, not on a
  // landing page.
  headline: string;
  // Optional second line for the detail (discount, which firms honour it).
  blurb: string;
  // Where the code is redeemed. Empty means "show the code, no link".
  url: string;
  ctaLabel: string;
  // The partner rail shown beside the felt. Separate switch from `enabled`:
  // the operator may want the code advertised on the site but not in-game.
  railEnabled: boolean;
  firms: Firm[];
  // Which generation of SEED_FIRMS this config has already absorbed.
  seedVersion: number;
}

// Empty by design. This site belongs to a prop firm, so the rail that
// advertises prop firms starts switched off and with nothing in it — the
// upstream list was another firm's partners, several of them competitors,
// and shipping that here would have been worse than useless. The operator
// can add their own offers from the dashboard.
const SEED_FIRMS: Firm[] = [];

const SEED_VERSION = 2;

const DEFAULT: Promo = {
  // Off until the operator writes their own: an advert nobody configured is
  // just a broken-looking box on every page.
  enabled: false,
  code: '',
  headline: '',
  blurb: '',
  url: '',
  ctaLabel: 'Find out more',
  railEnabled: false,
  firms: SEED_FIRMS,
  seedVersion: SEED_VERSION,
};

let promo: Promo = { ...DEFAULT };

export function loadPromo(): void {
  try {
    if (!existsSync(FILE)) return;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Promo>;
    promo = normalise({ ...DEFAULT, ...parsed });
    if ((parsed.seedVersion ?? 0) < SEED_VERSION) backfillFromSeed();
  } catch (e) {
    console.error('Could not load promo config:', e);
  }
}

// One-time top-up for a config saved before the seed gained these links: a
// firm the operator has not given a link of its own takes the seed's.
function backfillFromSeed(): void {
  const firms = promo.firms.map(f => {
    if (f.url) return f;
    const seed = SEED_FIRMS.find(s => s.id === f.id);
    return seed?.url ? { ...f, url: seed.url } : f;
  });
  setPromo({ firms });
}

// Trim and bound everything — this text is rendered on every page, so a
// pasted essay or a javascript: URL must not make it that far.
const text = (s: unknown, max: number) =>
  String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Affiliate links are pasted by hand, so a typo or a stray scheme must fail
// closed rather than render on every page.
const link = (s: unknown) => {
  const raw = text(s, 300);
  return /^https?:\/\//i.test(raw) ? raw : '';
};

const ACCENTS: Firm['accent'][] = ['purple', 'green', 'gold', 'blue'];

const MAX_FIRMS = 12;

function normaliseFirms(list: unknown): Firm[] {
  if (!Array.isArray(list)) return [];
  const out: Firm[] = [];
  const seen = new Set<string>();
  for (const raw of list.slice(0, MAX_FIRMS)) {
    const f = raw as Partial<Firm>;
    const name = text(f?.name, 40);
    if (!name) continue; // a nameless card is just a hole in the rail
    // Ids key React rows and the admin editor; derive one when absent, and
    // never let two firms share it.
    let id = text(f?.id, 32).toLowerCase().replace(/[^a-z0-9]+/g, '')
      || name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
    while (seen.has(id)) id += 'x';
    seen.add(id);
    out.push({
      id,
      name,
      offer: text(f?.offer, 20).toUpperCase(),
      url: link(f?.url),
      accent: ACCENTS.includes(f?.accent as Firm['accent']) ? f!.accent as Firm['accent'] : 'purple',
    });
  }
  return out;
}

function normalise(p: Promo): Promo {
  return {
    enabled: p.enabled !== false,
    code: text(p.code, 32).toUpperCase(),
    headline: text(p.headline, 90),
    blurb: text(p.blurb, 140),
    url: link(p.url),
    ctaLabel: text(p.ctaLabel, 32) || DEFAULT.ctaLabel,
    railEnabled: p.railEnabled !== false,
    firms: normaliseFirms(p.firms),
    seedVersion: SEED_VERSION,
  };
}

export function getPromo(): Promo {
  return { ...promo };
}

// What players are shown. A promo with no code, no link and no firms has
// nothing to say, so it is treated as off rather than rendering an empty box.
export function publicPromo(): Promo | null {
  if (!promo.enabled) return null;
  if (!promo.code && !promo.url && promo.firms.length === 0) return null;
  return { ...promo, firms: promo.firms.map(f => ({ ...f })) };
}

export function setPromo(patch: Partial<Promo>): Promo {
  promo = normalise({ ...promo, ...patch });
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(promo, null, 2));
    renameSync(tmp, FILE);
  } catch (e) {
    console.error('Could not save promo config:', e);
  }
  return { ...promo };
}
