// Site-wide switches. Anything off is refused by the server too, not merely
// hidden in the browser, so a switch is a real switch.
import { DEFAULT_FEATURES, type Features } from '../../shared/types.ts';
import { readJson, writeJson } from './jsonstore.ts';

const FILE = 'features.json';
let features: Features = { ...DEFAULT_FEATURES };

export function loadFeatures(): void {
  features = normalise({ ...DEFAULT_FEATURES, ...readJson<Partial<Features>>(FILE, {}) });
}

function normalise(f: Partial<Features>): Features {
  const out = { ...DEFAULT_FEATURES };
  for (const k of Object.keys(DEFAULT_FEATURES) as (keyof Features)[]) {
    if (typeof f[k] === 'boolean') out[k] = f[k] as boolean;
  }
  return out;
}

export function getFeatures(): Features {
  return { ...features };
}

export function isOn(name: keyof Features): boolean {
  return features[name];
}

/** Write first, believe it second: a switch that cannot be stored fails loudly. */
export function setFeatures(patch: Partial<Features>): Features {
  const next = normalise({ ...features, ...patch });
  writeJson(FILE, next);
  features = next;
  return { ...features };
}
