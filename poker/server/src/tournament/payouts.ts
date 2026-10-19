import type { PayoutEntry } from '../../../shared/types.ts';

// Percentage tables by paid places (industry-style top-heavy curves).
const TABLES: Record<number, number[]> = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 27, 18, 10],
  5: [40, 25, 16, 11, 8],
  6: [38, 23, 15, 10, 8, 6],
  7: [36, 22, 14, 10, 8, 6, 4],
  8: [35, 21, 13.5, 9.5, 7.5, 6, 4.5, 3],
  9: [33.5, 20, 13, 9.5, 7.5, 6, 4.5, 3.5, 2.5],
};

// How many places get paid for a field size (~12% of the field, capped sensibly).
export function paidPlaces(entries: number): number {
  if (entries <= 4) return 1;
  if (entries <= 7) return 2;
  if (entries <= 12) return 3;
  const p = Math.round(entries * 0.12);
  return Math.min(Math.max(p, 3), 100);
}

export function computePayouts(entries: number, prizePool: number): PayoutEntry[] {
  const places = paidPlaces(entries);
  let pcts: number[];
  if (places <= 9) {
    pcts = TABLES[places];
  } else {
    // Geometric decay beyond 9 places, normalized to 100.
    const decay = 0.82;
    const raw: number[] = [];
    for (let i = 0; i < places; i++) raw.push(Math.pow(decay, i));
    const sum = raw.reduce((a, b) => a + b, 0);
    pcts = raw.map(r => (r / sum) * 100);
  }
  const out: PayoutEntry[] = [];
  let allocated = 0;
  for (let i = 0; i < pcts.length; i++) {
    let amount = Math.floor((prizePool * pcts[i]) / 100);
    allocated += amount;
    out.push({ place: i + 1, amount, pct: Math.round(pcts[i] * 10) / 10 });
  }
  // Remainder to first place.
  if (out.length > 0) out[0].amount += prizePool - allocated;
  return out;
}
