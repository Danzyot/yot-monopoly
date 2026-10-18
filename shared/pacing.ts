// How long the client takes to stage a roll, shared so the server's bots wait
// for exactly what players see (server/src/rooms.ts) and the HUD, the board
// and the sound effects stay in step (client three/sequence.ts, Dice.tsx,
// characters/Pieces.tsx, useGameSounds.ts).
//
// Every roll plays as three beats:
//   1. the dice tumble and settle                         DICE_MS
//   2. the result pops up big ("4 + 3 = 7"), holds, then
//      flies down into the action bar                      RESULT_MS
//   3. the piece walks, one hop per space                  HOP_MS each
// and only then do the buttons, cards and rent come up.

/** The dice tumble, bounce and settle. */
export const DICE_MS = 1400;
/** The result pops in at the centre of the screen. */
export const RESULT_IN_MS = 220;
/** ...holds there to be read... */
export const RESULT_HOLD_MS = 900;
/** ...then flies into the action bar's dice readout. */
export const RESULT_FLY_MS = 380;
/** The whole result beat: the piece starts walking once it is over. */
export const RESULT_MS = RESULT_IN_MS + RESULT_HOLD_MS + RESULT_FLY_MS;
/** From the roll arriving to the piece's first hop. */
export const WALK_DELAY_MS = DICE_MS + RESULT_MS;
/** One tile-to-tile hop. */
export const HOP_MS = 230;
/** Moves longer than this many spaces (and jail) fly straight instead of hopping. */
export const MAX_HOPS = 12;
/** A teleport (jail, a long card jump) flies straight in this long. */
export const FLY_MS = 750;
/** A drawn card flies from its pile and is read. */
export const CARD_MS = 1600;
/** The landing squash and a breath before the HUD comes back. */
export const SETTLE_MS = 400;

/** How long the scene takes to play a roll that moves a piece `steps` spaces (0: no move). */
export function walkMs(steps: number, jailed = false): number {
  if (steps <= 0) return 0;
  return !jailed && steps <= MAX_HOPS ? steps * HOP_MS : FLY_MS;
}

/** An auction runs this long when nobody bids... */
export const AUCTION_MS = 12_000;
/** ...and each bid puts at least this long back on the clock for someone to answer. */
export const AUCTION_EXTEND_MS = 6_000;
