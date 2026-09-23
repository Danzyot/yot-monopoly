// Chance / Community Chest. Effects are data so a theme can rewrite the text
// (and even the amounts) of every card while the engine stays untouched.

export type CardEffect =
  | { type: 'advance'; to: number }            // move forward to a space, collecting GO if passed
  | { type: 'nearest'; kind: 'railroad' | 'utility' } // advance; pay double / 10× dice if owned
  | { type: 'back'; steps: number }
  | { type: 'jail' }
  | { type: 'jailFree' }
  | { type: 'collect'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'payEach'; amount: number }        // pay every other player
  | { type: 'collectEach'; amount: number }    // every other player pays you
  | { type: 'repairs'; perHouse: number; perHotel: number };

export type DeckId = 'chance' | 'chest';

export interface CardDef {
  /**
   * Card text. `{12}` is replaced with the name of space 12 on the board it is
   * played on, `{jail}` with the jail's name, and `$` with the currency, so the
   * same card reads right on every map and edition.
   */
  text: string;
  effect: CardEffect;
}

/** Fill a card's placeholders from the board it is being played on. */
export function cardText(text: string, spaces: { name: string; kind: string }[], currency: string): string {
  const jail = spaces.find(s => s.kind === 'jail')?.name ?? 'Jail';
  return text
    .replace(/\{(\d+)\}/g, (_, n) => spaces[Number(n)]?.name ?? '?')
    .replace(/\{jail\}/g, jail)
    .replaceAll('$', currency);
}

/**
 * Decks for any board, built from its layout: named destinations are picked
 * from the map (its priciest property, first railroad, a mid-board street) so
 * a new map gets sensible Chance / Community Chest cards with no extra work.
 */
export function standardDecks(spaces: { kind: string; price?: number }[]): { chance: CardDef[]; chest: CardDef[] } {
  const props = spaces.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'property');
  const priciest = props.reduce((a, b) => ((b.s.price ?? 0) >= (a.s.price ?? 0) ? b : a)).i;
  const mid = props[Math.floor(props.length / 2)].i;
  const early = props[Math.floor(props.length / 4)].i;
  const rail = spaces.findIndex(s => s.kind === 'railroad');
  const chance: CardDef[] = [
    { text: `Advance to {${priciest}}.`, effect: { type: 'advance', to: priciest } },
    { text: 'Advance to {0}. Collect $200.', effect: { type: 'advance', to: 0 } },
    { text: `Advance to {${mid}}. If you pass {0}, collect $200.`, effect: { type: 'advance', to: mid } },
    { text: `Advance to {${early}}. If you pass {0}, collect $200.`, effect: { type: 'advance', to: early } },
    { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental.', effect: { type: 'nearest', kind: 'railroad' } },
    { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental.', effect: { type: 'nearest', kind: 'railroad' } },
    { text: 'Advance to the nearest Utility. If owned, roll the dice and pay the owner 10× the roll.', effect: { type: 'nearest', kind: 'utility' } },
    { text: 'Bank pays you a dividend of $50.', effect: { type: 'collect', amount: 50 } },
    { text: 'Get Out of Jail Free.', effect: { type: 'jailFree' } },
    { text: 'Go back 3 spaces.', effect: { type: 'back', steps: 3 } },
    { text: 'Go to {jail}. Do not pass {0}, do not collect $200.', effect: { type: 'jail' } },
    { text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', effect: { type: 'repairs', perHouse: 25, perHotel: 100 } },
    { text: 'Speeding fine $15.', effect: { type: 'pay', amount: 15 } },
    { text: 'You have been elected Chairman of the Board. Pay each player $50.', effect: { type: 'payEach', amount: 50 } },
    { text: 'Your building loan matures. Collect $150.', effect: { type: 'collect', amount: 150 } },
  ];
  if (rail >= 0) chance.push({ text: `Take a trip to {${rail}}. If you pass {0}, collect $200.`, effect: { type: 'advance', to: rail } });
  return { chance, chest: CLASSIC_CHEST };
}

export const CLASSIC_CHANCE: CardDef[] = [
  { text: 'Advance to {39}.', effect: { type: 'advance', to: 39 } },
  { text: 'Advance to {0}. Collect $200.', effect: { type: 'advance', to: 0 } },
  { text: 'Advance to {24}. If you pass {0}, collect $200.', effect: { type: 'advance', to: 24 } },
  { text: 'Advance to {11}. If you pass {0}, collect $200.', effect: { type: 'advance', to: 11 } },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental.', effect: { type: 'nearest', kind: 'railroad' } },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental.', effect: { type: 'nearest', kind: 'railroad' } },
  { text: 'Advance to the nearest Utility. If owned, roll the dice and pay the owner 10× the roll.', effect: { type: 'nearest', kind: 'utility' } },
  { text: 'Bank pays you a dividend of $50.', effect: { type: 'collect', amount: 50 } },
  { text: 'Get Out of Jail Free.', effect: { type: 'jailFree' } },
  { text: 'Go back 3 spaces.', effect: { type: 'back', steps: 3 } },
  { text: 'Go to {jail}. Do not pass {0}, do not collect $200.', effect: { type: 'jail' } },
  { text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', effect: { type: 'repairs', perHouse: 25, perHotel: 100 } },
  { text: 'Speeding fine $15.', effect: { type: 'pay', amount: 15 } },
  { text: 'Take a trip to {5}. If you pass {0}, collect $200.', effect: { type: 'advance', to: 5 } },
  { text: 'You have been elected Chairman of the Board. Pay each player $50.', effect: { type: 'payEach', amount: 50 } },
  { text: 'Your building loan matures. Collect $150.', effect: { type: 'collect', amount: 150 } },
];

export const CLASSIC_CHEST: CardDef[] = [
  { text: 'Advance to {0}. Collect $200.', effect: { type: 'advance', to: 0 } },
  { text: 'Bank error in your favour. Collect $200.', effect: { type: 'collect', amount: 200 } },
  { text: "Doctor's fee. Pay $50.", effect: { type: 'pay', amount: 50 } },
  { text: 'From sale of stock you get $50.', effect: { type: 'collect', amount: 50 } },
  { text: 'Get Out of Jail Free.', effect: { type: 'jailFree' } },
  { text: 'Go to {jail}. Do not pass {0}, do not collect $200.', effect: { type: 'jail' } },
  { text: 'Holiday fund matures. Receive $100.', effect: { type: 'collect', amount: 100 } },
  { text: 'Income tax refund. Collect $20.', effect: { type: 'collect', amount: 20 } },
  { text: 'It is your birthday. Collect $10 from every player.', effect: { type: 'collectEach', amount: 10 } },
  { text: 'Life insurance matures. Collect $100.', effect: { type: 'collect', amount: 100 } },
  { text: 'Pay hospital fees of $100.', effect: { type: 'pay', amount: 100 } },
  { text: 'Pay school fees of $50.', effect: { type: 'pay', amount: 50 } },
  { text: 'Receive $25 consultancy fee.', effect: { type: 'collect', amount: 25 } },
  { text: 'You are assessed for street repair: $40 per house, $115 per hotel.', effect: { type: 'repairs', perHouse: 40, perHotel: 115 } },
  { text: 'You have won second prize in a beauty contest. Collect $10.', effect: { type: 'collect', amount: 10 } },
  { text: 'You inherit $100.', effect: { type: 'collect', amount: 100 } },
];
