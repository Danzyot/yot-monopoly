// The Chog token a holder last picked to play as. Its own module so the home
// page's Play now (QuickPlay → cards/net.ts) can send it without loading the
// picker and the trait table (shared/chogs/traits.ts) with the page.

/** The gallery's "Play as Chog #n" remembers the token here, next to CHARACTER_PREF_KEY ('chog'). */
export const CHOG_TOKEN_PREF_KEY = 'yot:chog-token';

export function loadChogTokenPref(): number | null {
  try {
    const n = Number(localStorage.getItem(CHOG_TOKEN_PREF_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

export function saveChogTokenPref(token: number | null) {
  try {
    if (token) localStorage.setItem(CHOG_TOKEN_PREF_KEY, String(token));
    else localStorage.removeItem(CHOG_TOKEN_PREF_KEY);
  } catch { /* private mode */ }
}
