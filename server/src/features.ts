// Which parts of the site are switched on.
//
// The brief for this deployment is a clean, simple interface — so the extras
// the engine can do are toggles rather than fixtures, and the operator turns
// on only what their room actually uses. Anything off is not merely hidden:
// the server refuses the matching actions too, so a toggle is a real switch
// and not a suggestion to the browser.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

const FILE = join(DATA_DIR, 'features.json');

export interface Features {
  music: boolean;        // the in-page music player
  handLog: boolean;      // the session log / hands tab
  replay: boolean;       // the hand replayer
  chat: boolean;         // table and lobby chat
  leaderboard: boolean;  // the all-time leaderboard page
  rabbitHunting: boolean; // offering the "what would have come" reveal
}

// Deliberately lean. A room that wants more turns it on; a room that never
// looks at it never has to see it.
//
// Emoji reactions and the promo advert are deliberately absent: they are
// permanent parts of the room. The advert still has an off switch, but it is
// its own `enabled` flag in promo.json, edited alongside the copy it controls
// — one advert with two separate switches was a way to have it configured and
// still invisible.
const DEFAULT: Features = {
  music: false,
  handLog: true,
  replay: false,
  chat: true,
  leaderboard: true,
  rabbitHunting: false,
};

let features: Features = { ...DEFAULT };

export function loadFeatures(): void {
  try {
    if (!existsSync(FILE)) return;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Features>;
    features = normalise({ ...DEFAULT, ...parsed });
  } catch (e) {
    console.error('Could not load features:', e);
  }
}

function normalise(f: Features): Features {
  const out = {} as Features;
  for (const k of Object.keys(DEFAULT) as (keyof Features)[]) {
    out[k] = f[k] === true;
  }
  return out;
}

export function getFeatures(): Features {
  return { ...features };
}

export function isOn(name: keyof Features): boolean {
  return features[name] === true;
}

export function setFeatures(patch: Partial<Features>): Features {
  features = normalise({ ...features, ...patch });
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(features, null, 2));
    renameSync(tmp, FILE);
  } catch (e) {
    console.error('Could not save features:', e);
  }
  return { ...features };
}
