import type { BlindLevel, CustomBlindLevel } from '../../../shared/types.ts';

// Round a raw blind up to a "nice" poker number.
function nice(n: number): number {
  const magnitudes = [1, 10, 100, 1000, 10000, 100000];
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const m of magnitudes) {
    for (const st of steps) {
      const v = m * st * 100; // work in hundredths to allow 25/75 style
      if (v / 100 >= n && Number.isInteger(v / 100)) return v / 100;
    }
  }
  return n;
}

const GROWTH: Record<string, number> = { turbo: 1.55, regular: 1.4, deep: 1.3 };

// Validate host-supplied custom rows into a clean schedule, or null if the
// input has no playable rows. Shared by the create route and live settings.
export function parseCustomLevels(raw: unknown): CustomBlindLevel[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.max(min, Math.min(max, n));
  };
  const rows = raw.slice(0, 60).map(r => {
    const o = (r ?? {}) as Record<string, unknown>;
    const isBreak = !!o.isBreak;
    const sb = clampInt(o.sb, 1, 100_000_000, 25);
    return {
      isBreak,
      sb,
      bb: clampInt(o.bb, Math.max(2, sb), 200_000_000, sb * 2),
      ante: clampInt(o.ante, 0, 200_000_000, 0),
      // 0 minutes is only meaningful on the final row (plays forever).
      minutes: clampInt(o.minutes, 0, 720, 0),
    };
  });
  // Leading breaks make no sense — a tournament starts with cards in the air.
  while (rows.length && rows[0].isBreak) rows.shift();
  // Every row except the last needs a real duration.
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].minutes <= 0) rows[i].minutes = 5;
  }
  if (!rows.some(r => !r.isBreak)) return null;
  return rows;
}

// Turn custom rows into the structure the tournament runs on. Break rows
// inherit the blinds of the level before them so the HUD always has
// something sensible to show.
export function buildCustomStructure(rows: CustomBlindLevel[]): BlindLevel[] {
  let lvlNo = 0;
  let lastSb = rows.find(r => !r.isBreak)?.sb ?? 25;
  let lastBb = rows.find(r => !r.isBreak)?.bb ?? 50;
  let lastAnte = 0;
  return rows.map(r => {
    if (r.isBreak) {
      return { level: Math.max(1, lvlNo), sb: lastSb, bb: lastBb, ante: lastAnte, isBreak: true };
    }
    lvlNo += 1;
    lastSb = r.sb; lastBb = r.bb; lastAnte = r.ante;
    return { level: lvlNo, sb: r.sb, bb: r.bb, ante: r.ante };
  });
}

// Generate a blind schedule. Antes kick in from level 4 (~1/8 of BB).
export function generateStructure(kind: 'turbo' | 'regular' | 'deep', levels = 40): BlindLevel[] {
  const growth = GROWTH[kind] ?? 1.4;
  const out: BlindLevel[] = [];
  let bb = 50;
  for (let lvl = 1; lvl <= levels; lvl++) {
    const sb = Math.max(Math.floor(bb / 2 / 25) * 25, 25);
    const ante = lvl >= 4 ? Math.max(25, Math.round(bb / 8 / 25) * 25) : 0;
    out.push({ level: lvl, sb, bb, ante });
    bb = nice(bb * growth);
  }
  return out;
}
