// Full numbers with separators — 20,000, never "20K".
export function chips(n: number): string {
  return n.toLocaleString('en-US');
}

// Stacks and bets can be read as chip counts or as big blinds. The game sets
// the default; each player can flip it for themselves and it sticks.
export type DisplayMode = 'chips' | 'bb';
const DISPLAY_KEY = 'chog.display';

// The preference is per table, and the host's choice for that table is the
// default. It used to be one key for the whole site, so flipping to big blinds
// once — in any game, ever — silently turned every other table into big
// blinds with no way to tell where the setting had come from.
export function getDisplayMode(fallback: DisplayMode = 'chips', tableId?: string): DisplayMode {
  try {
    const v = localStorage.getItem(tableId ? `${DISPLAY_KEY}.${tableId}` : DISPLAY_KEY);
    return v === 'bb' || v === 'chips' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setDisplayMode(mode: DisplayMode, tableId?: string) {
  try {
    localStorage.setItem(tableId ? `${DISPLAY_KEY}.${tableId}` : DISPLAY_KEY, mode);
  } catch { /* private mode */ }
}

// `bb` is the current big blind; 0/undefined falls back to raw chips.
export function amount(n: number, mode: DisplayMode, bb: number): string {
  if (mode !== 'bb' || !bb) return chips(n);
  const inBb = n / bb;
  if (inBb === 0) return '0 BB';
  if (inBb < 10) return `${(Math.round(inBb * 10) / 10).toString()} BB`;
  return `${Math.round(inBb)} BB`;
}

export function clock(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
