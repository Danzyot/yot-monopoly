// Turns game-state changes into sound effects. The server only sends whole
// GameView snapshots, so this diffs each one against the last and works out
// what just happened: a roll, a hop across the board, a purchase, rent, a
// card, jail, an auction bid, a new turn, a bankruptcy, a winner.
import { useEffect, useRef } from 'react';
import { resolveTheme } from '../../shared/themes.ts';
import type { GameView } from '../../shared/types.ts';
import {
  playBankrupt, playBid, playBuild, playBuy, playCardFlip, playDiceRoll, playDoubles, playHop, playJail,
  playJailOpen, playPay, playReceive, playWin, playYourTurn,
} from './sound.ts';

// Keep in step with the board animation (three/sequence.ts DICE_MS and
// three/characters/Pieces.tsx HOP_MS) so ticks land with the piece, which
// waits for the dice to settle before it walks.
const DICE_S = 1.1;
const HOP_S = 0.19;
/** Longer moves (and jail) fly straight in Tokens.tsx rather than hopping. */
const MAX_HOPS = 12;

export function useGameSounds(game: GameView | null, me: string): void {
  const prev = useRef<GameView | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    // First snapshot (joining, reconnecting, a new game): nothing "happened",
    // so play nothing rather than a burst of everything at once.
    if (!game || !before || before.themeId !== game.themeId || game.turnNumber < before.turnNumber) return;

    const n = resolveTheme(game.themeId, game.mapId).spaces.length;
    const rolled = game.rollSeq > before.rollSeq;
    let landAt = 0; // when the moving piece arrives: money and cards wait for it

    if (rolled) {
      playDiceRoll();
      if (game.dice && game.dice[0] === game.dice[1]) playDoubles(DICE_S * 0.8);
    }

    for (const p of game.players) {
      const was = before.players.find(x => x.id === p.id);
      if (!was) continue;
      if (p.position !== was.position) {
        const steps = (p.position - was.position + n) % n;
        const start = rolled ? DICE_S : 0;
        if (!p.inJail && steps > 0 && steps <= MAX_HOPS) {
          for (let k = 0; k < steps; k++) playHop(start + k * HOP_S + 0.05);
          landAt = Math.max(landAt, start + steps * HOP_S + 0.1);
        } else {
          landAt = Math.max(landAt, start + 0.75);
        }
      }
      if (p.inJail && !was.inJail) playJail(Math.max(landAt, rolled ? 0.4 : 0));
      if (!p.inJail && was.inJail && !p.bankrupt) playJailOpen(rolled ? DICE_S : 0);
      if (p.bankrupt && !was.bankrupt) playBankrupt(landAt);
    }

    if (game.lastCard && game.lastCard.seq !== before.lastCard?.seq) playCardFlip(landAt);

    // Purchases: a space that had no owner now has one (bought outright or won
    // at auction). Deeds changing hands in a trade are not purchases.
    let iBought = false;
    let someoneBought = false;
    for (const [k, o] of Object.entries(game.owned)) {
      if (before.owned[Number(k)]) continue;
      someoneBought = true;
      if (o.owner === me) iBought = true;
    }
    if (someoneBought) playBuy(landAt);
    // Building: a clack as each new house or hotel drops onto its lot.
    let built = 0;
    for (const [k, o] of Object.entries(game.owned)) {
      const was = before.owned[Number(k)];
      if (was && o.houses > was.houses) built += o.houses === 5 ? 1 : o.houses - was.houses;
    }
    for (let i = 0; i < Math.min(built, 4); i++) playBuild(0.3 + i * 0.12);

    // Money is only voiced for this player: everyone else's rent would be noise.
    const mine = game.players.find(p => p.id === me);
    const mineBefore = before.players.find(p => p.id === me);
    if (mine && mineBefore && !mine.bankrupt) {
      const delta = mine.cash - mineBefore.cash;
      const cardExtra = game.lastCard?.seq !== before.lastCard?.seq ? 0.35 : 0;
      if (delta > 0) playReceive(landAt + cardExtra);
      else if (delta < 0 && !iBought) playPay(landAt + cardExtra);
    }

    // Auction: a new high bid ticks for everyone watching.
    if (game.auction && before.auction && game.auction.space === before.auction.space
      && game.auction.highBid > before.auction.highBid) playBid();

    if (game.winner && !before.winner) playWin(0.3);
    else if (game.current === me && before.current !== me && game.phase !== 'over') {
      playYourTurn(Math.max(0.2, landAt));
    }
  }, [game, me]);
}
