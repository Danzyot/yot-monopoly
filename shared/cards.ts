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
  text: string;
  effect: CardEffect;
}

export const CLASSIC_CHANCE: CardDef[] = [
  { text: 'Advance to Boardwalk.', effect: { type: 'advance', to: 39 } },
  { text: 'Advance to GO. Collect $200.', effect: { type: 'advance', to: 0 } },
  { text: 'Advance to Illinois Avenue. If you pass GO, collect $200.', effect: { type: 'advance', to: 24 } },
  { text: 'Advance to St. Charles Place. If you pass GO, collect $200.', effect: { type: 'advance', to: 11 } },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental.', effect: { type: 'nearest', kind: 'railroad' } },
  { text: 'Advance to the nearest Railroad. If owned, pay the owner twice the rental.', effect: { type: 'nearest', kind: 'railroad' } },
  { text: 'Advance to the nearest Utility. If owned, roll the dice and pay the owner 10× the roll.', effect: { type: 'nearest', kind: 'utility' } },
  { text: 'Bank pays you a dividend of $50.', effect: { type: 'collect', amount: 50 } },
  { text: 'Get Out of Jail Free.', effect: { type: 'jailFree' } },
  { text: 'Go back 3 spaces.', effect: { type: 'back', steps: 3 } },
  { text: 'Go to Jail. Do not pass GO, do not collect $200.', effect: { type: 'jail' } },
  { text: 'Make general repairs on all your property: $25 per house, $100 per hotel.', effect: { type: 'repairs', perHouse: 25, perHotel: 100 } },
  { text: 'Speeding fine $15.', effect: { type: 'pay', amount: 15 } },
  { text: 'Take a trip to Reading Railroad. If you pass GO, collect $200.', effect: { type: 'advance', to: 5 } },
  { text: 'You have been elected Chairman of the Board. Pay each player $50.', effect: { type: 'payEach', amount: 50 } },
  { text: 'Your building loan matures. Collect $150.', effect: { type: 'collect', amount: 150 } },
];

export const CLASSIC_CHEST: CardDef[] = [
  { text: 'Advance to GO. Collect $200.', effect: { type: 'advance', to: 0 } },
  { text: 'Bank error in your favour. Collect $200.', effect: { type: 'collect', amount: 200 } },
  { text: "Doctor's fee. Pay $50.", effect: { type: 'pay', amount: 50 } },
  { text: 'From sale of stock you get $50.', effect: { type: 'collect', amount: 50 } },
  { text: 'Get Out of Jail Free.', effect: { type: 'jailFree' } },
  { text: 'Go to Jail. Do not pass GO, do not collect $200.', effect: { type: 'jail' } },
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
