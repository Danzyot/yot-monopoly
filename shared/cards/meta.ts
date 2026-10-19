// The shedding card game's name and fixed numbers. The display name is a
// working title: rename the game here and nowhere else.

/** Internal id (rooms, routes, stats keys). Never shown to players. */
export const CARDS_GAME_ID = 'cards' as const;
/** What players read. */
export const CARDS_GAME_NAME = 'Chog Cards';
/** The call-out a player makes when they are down to one card. */
export const LAST_CARD_CALL = 'Last card!';

export const CARDS_MIN_PLAYERS = 2;
export const CARDS_MAX_PLAYERS = 10;
/** Cards dealt to each player at the start of a round. */
export const CARDS_HAND_SIZE = 7;
/** Every card in the game: 4 colours × 25, plus 4 Wild and 4 Wild Draw Four. */
export const CARDS_DECK_SIZE = 108;
