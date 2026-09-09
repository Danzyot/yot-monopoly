// Felt presets for custom table looks. The ids are shared with the server's
// theme sanitizer — add a preset there too if one is added here.
export interface FeltPreset {
  id: string;
  name: string;
  felt1: string; // center of the radial gradient
  felt2: string; // outer edge
  edge: string;  // inner ring line
  rail: string;  // wooden rail border color
}

export const FELTS: FeltPreset[] = [
  // First in the list is the default look: `feltById` falls back to it and
  // every table without a chosen theme is painted from it, so this is the
  // felt almost every hand is played on. It is cut from the brand's darker
  // purple, the same value the CSS tokens carry.
  { id: 'chog', name: 'Chog Purple', felt1: '#3a1f78', felt2: '#170b34', edge: '#0a0418', rail: '#2b1a5c' },
  { id: 'green', name: 'Classic Green', felt1: '#1e6b47', felt2: '#114430', edge: '#0b2c1f', rail: '#4a2f18' },
  { id: 'midnight', name: 'Midnight Blue', felt1: '#1d4368', felt2: '#0f2740', edge: '#0a1c30', rail: '#22303f' },
  { id: 'wine', name: 'Wine Red', felt1: '#6b1e2e', felt2: '#40111c', edge: '#2c0b13', rail: '#3a2020' },
  { id: 'carbon', name: 'Carbon Black', felt1: '#3a3f46', felt2: '#1d2126', edge: '#121519', rail: '#2a2e33' },
  { id: 'royal', name: 'Royal Purple', felt1: '#4b2a6b', felt2: '#2b1740', edge: '#1d0f2c', rail: '#352044' },
];

export function feltById(id: string | undefined | null): FeltPreset {
  return FELTS.find(f => f.id === id) ?? FELTS[0];
}
