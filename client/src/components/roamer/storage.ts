// What the home page's roaming Chog remembers (per browser; every access may throw in private modes).

/** '1' once the visitor sent the Chog away ("Hide the Chog"): it does not come back. */
export const HIDDEN_KEY = 'chogRoamer.hidden';
/** When the visitor last closed the Chog's message (ms): it does not pop up by itself for a day after. */
export const DISMISSED_KEY = 'chogRoamer.dismissedAt';
