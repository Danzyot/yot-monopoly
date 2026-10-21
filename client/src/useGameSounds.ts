// Turns game-state changes into sound effects. The server only sends whole
// GameView snapshots, so this diffs each one against the last and works out
// what just happened: a roll, a purchase, rent, a card, jail, an auction bid,
// a new turn, a bankruptcy, a winner. The pieces voice their own footfalls and
// reactions (three/characters/moveFx.ts), so nothing here repeats those.
import { useEffect, useRef } from 'react';
import { resolveTheme } from '../../shared/themes.ts';
import type { GameView } from '../../shared/types.ts';
import { routeBetween } from './three/layout.ts';
import {
  playArcadeStart, playBankrupt, playBid, playBuild, playBuy, playBuzz, playCardFlip, playDiceRoll, playDoubles,
  playAuctionStart, playGoLight, playJail, playJailOpen, playOffer, playPay, playReceive, playTrade, playWin,
  playYourTurn,
} from './sound.ts';
import * as PACE from '../../shared/pacing.ts';

// In step with the board animation (shared/pacing.ts) so ticks land with the
// piece, which waits for the dice to settle and the result to show before it walks.
const DICE_S = PACE.DICE_MS / 1000;
const WALK_S = PACE.WALK_DELAY_MS / 1000;
const HOP_S = PACE.HOP_MS / 1000;
const FLY_S = PACE.FLY_MS / 1000;
/** Longer moves (and jail) fly straight in Pieces.tsx rather than hopping. */
const MAX_HOPS = PACE.MAX_HOPS;

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
      if (game.dice && game.dice[0] === game.dice[1]) playDoubles(DICE_S);
    }

    for (const p of game.players) {
      const was = before.players.find(x => x.id === p.id);
      if (!was) continue;
      if (p.position !== was.position) {
        const steps = routeBetween(was.position, p.position, n).length;
        const start = rolled ? WALK_S : 0;
        if (!p.inJail && steps > 0 && steps <= MAX_HOPS) {
          // The footfalls come from the piece itself as each hop lands (Pieces.tsx).
          landAt = Math.max(landAt, start + steps * HOP_S + 0.1);
        } else {
          landAt = Math.max(landAt, start + FLY_S);
        }
      }
      if (p.inJail && !was.inJail) playJail(Math.max(landAt, rolled ? 0.4 : 0));
      if (!p.inJail && was.inJail && !p.bankrupt) playJailOpen(rolled ? WALK_S : 0);
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

    // Trades: an offer for me nudges; a deed changing owner (both before and
    // after, so not a purchase) is a completed trade; a new debt of mine buzzes
    // (no cash moved, so nothing above fired).
    if (game.trades.some(t => t.to === me && !before.trades.some(b => b.id === t.id))) playOffer(0.1);
    if (Object.entries(game.owned).some(([k, o]) => before.owned[Number(k)] && before.owned[Number(k)].owner !== o.owner)) playTrade(0.1);
    if (game.debts.some(d => d.from === me) && !before.debts.some(d => d.from === me)) playBuzz(landAt);

    // Auction: it opening, then each new high bid ticking for everyone watching.
    if (game.auction && !before.auction) playAuctionStart(landAt);
    if (game.auction && before.auction && game.auction.space === before.auction.space
      && game.auction.highBid > before.auction.highBid) playBid();

    if (game.winner && !before.winner) playWin(0.3);
    else if (game.current === me && before.current !== me && game.phase !== 'over') {
      playYourTurn(Math.max(0.2, landAt));
    }

    // Arcade mini-games: the moments the server decides (a new round, GO, a
    // false start, a roll, a card). The wheel's ticks and every round's win /
    // lose sting are timed by the panel itself, which knows when its
    // animations finish.
    const mg = game.minigame, was = before.minigame;
    if (mg && mg.seq !== was?.seq) playArcadeStart(Math.max(0.1, landAt));
    else if (mg && was && mg.stage === 'play') {
      if (mg.kind === 'reaction' && was.kind === 'reaction') {
        if (mg.go && !was.go) playGoLight();
        if (mg.early.includes(me) && !was.early.includes(me)) playBuzz();
      }
      if (mg.kind === 'quickMath' && was.kind === 'quickMath' && mg.locked.includes(me) && !was.locked.includes(me)) playBuzz();
      if (mg.kind === 'highLow' && was.kind === 'highLow' && mg.cards.length > was.cards.length) playCardFlip();
      if (mg.kind === 'diceDuel' && was.kind === 'diceDuel'
        && Object.keys(mg.rolls).length > Object.keys(was.rolls).length) playDiceRoll();
    } else if (mg && was && mg.stage === 'result' && was.stage === 'play') {
      if (mg.kind === 'highLow' && was.kind === 'highLow' && mg.cards.length > was.cards.length) playCardFlip();
      if (mg.kind === 'diceDuel' && was.kind === 'diceDuel'
        && Object.keys(mg.rolls).length > Object.keys(was.rolls).length) playDiceRoll();
    }
  }, [game, me]);
}
