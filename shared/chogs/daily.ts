// The home page's "Chog of the Day": one Chog Genesis token per UTC day, the
// same for everyone and every reload. Days step through the collection by a
// stride coprime with the supply (1,969 = 11 × 179), so neighbouring days show
// unrelated Chogs and every token gets its day once in 1,969 days.
import { CHOG_SUPPLY } from './meta.ts';

const STRIDE = 997;
const OFFSET = 409;
const DAY_MS = 86_400_000;

/** The UTC day number of `date` (days since 1970-01-01). */
export const utcDay = (date: Date | number = Date.now()) => Math.floor(Number(date) / DAY_MS);

/** The token for the UTC day `date` falls on (1 … CHOG_SUPPLY). */
export function chogOfTheDay(date: Date | number = Date.now()): number {
  const day = utcDay(date);
  return ((((day * STRIDE + OFFSET) % CHOG_SUPPLY) + CHOG_SUPPLY) % CHOG_SUPPLY) + 1;
}
