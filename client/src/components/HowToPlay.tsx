// "How to play": for Monopoly the whole game on two short pages (the basics,
// then the extras: arcades, house rules, camera), reachable from the home page,
// the lobby and the game's "?" button, which also lists the keyboard shortcuts
// on devices that have a keyboard. Every Monopoly line below was checked against
// the engine (server/src/engine/game.ts) and the action bar, so keep them in step.
// The same dialog shows the Cards and Poker tutorials (HowToGames.tsx): the "?"
// on each hub card opens its game, the hero's button opens it with a tab per game.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { GAMES } from '../../../shared/brand.ts';
import type { RuleConfig } from '../../../shared/themes.ts';
import { MINIGAME_INFO, MINIGAME_KINDS } from '../../../shared/minigames.ts';
import { MAPS } from '../../../shared/maps.ts';
import { CAMERA_MODES } from '../three/camera.ts';
import { CloseX, Modal } from './Modal.tsx';
import { SHORTCUTS } from './Shortcuts.tsx';
import { cardsSteps, pokerSteps, type GuideStep } from './HowToGames.tsx';

type Step = GuideStep;

/** The hub's games, in the order the home page shows them. */
export type HowToGame = 'monopoly' | 'cards' | 'poker';
export const HOWTO_GAMES: { id: HowToGame; icon: string; name: string }[] = [
  { id: 'monopoly', icon: '🎩', name: GAMES.monopoly.name },
  { id: 'cards', icon: '🃏', name: GAMES.cards.name },
  { id: 'poker', icon: '♠️', name: GAMES.poker.name },
];

export function howToSteps(rules?: Partial<RuleConfig>, cur = '$'): Step[] {
  const auctions = rules?.auctions !== false;
  const timed = (rules?.timeLimitMin ?? 0) > 0;
  const fine = `${cur}${rules?.jailFine ?? 50}`;
  const salary = `${cur}${rules?.goSalary ?? 200}`;
  const even = rules?.evenBuild !== false;
  const limited = rules?.limitedBuildings !== false;
  return [
    { icon: '🎲', title: 'Roll & move', text: `Hit Roll on your turn and walk that many squares. Pass GO to collect ${salary}. Doubles earn another roll, but three doubles in a row sends you to jail.` },
    {
      icon: '🏠', title: auctions ? 'Buy or auction' : 'Buy it',
      text: auctions
        ? 'Land on a deed nobody owns? Buy it at the list price, or hit Auction it. Declining a deed in the buy phase always sends it to auction: everyone can bid, you included. The highest bid wins, each bid adds a few seconds, and you can never bid more than your cash.'
        : 'Land on a deed nobody owns? Buy it at the list price, or skip it and it stays with the bank.',
    },
    { icon: '💰', title: 'Rent', text: 'Land on someone else\'s deed and you pay them rent. A full colour set pays double, houses and hotels pay far more, stations pay more for each one owned, and utilities pay a multiple of your dice. Mortgaged deeds pay nothing.' },
    { icon: '🏗️', title: 'Build', text: `Own every deed of a colour (none mortgaged) and tap Build. Houses go up one at a time${even ? ', evenly across the set' : ''}: four houses, then a hotel.${limited ? ' The bank only has 32 houses and 12 hotels.' : ''} Selling a building gives back half.` },
    { icon: '🤝', title: 'Trade', text: 'Tap Trade (or the ⇄ on a player) to offer deeds, cash and jail cards for theirs. They can accept, decline or counter. Anytime, not only on your turn, though a deal waits while an auction or mini-game runs. No loans, a set with buildings has to be sold down before its deeds can move, and taking a mortgaged deed costs 10% interest at once.' },
    { icon: '🔒', title: 'Jail', text: `In via the Go to Jail square, three doubles or a card. To get out, pick one at the start of your turn: roll for doubles (three tries; miss the third and you pay ${fine} and move anyway), pay ${fine} bail, or use a Get Out of Jail Free card. ${rules?.noRentInJail ? 'At this table jailed owners collect no rent.' : 'You still collect rent while locked up.'}` },
    { icon: '💸', title: 'Short on cash?', text: `Tap Raise cash to sell buildings and mortgage deeds (you get half the price; lifting a mortgage costs 10% extra). If you cannot pay what you owe you go bankrupt: your things go to who you owe, or back to the bank${auctions ? ', which auctions the deeds' : ''}.` },
    {
      icon: '🏆', title: 'Win',
      text: timed
        ? 'Bankrupt everyone else, or be the richest (cash, deeds and buildings) when the game clock runs out.'
        : 'Be the last player standing. Everyone who cannot pay goes bankrupt.',
    },
  ];
}

const HOUSE_RULES: { key: keyof RuleConfig; label: string; text: string }[] = [
  { key: 'freeParkingPot', label: 'Free Parking jackpot', text: 'Taxes, card fines (repairs included) and arcade losses pile up in the middle. Jail bail goes to the bank. Land on Free Parking to scoop the lot.' },
  { key: 'doubleOnGo', label: 'Double on GO', text: 'Land exactly on GO and the salary is doubled.' },
  { key: 'noRentInJail', label: 'No rent in jail', text: 'Owners sitting in jail collect no rent.' },
  { key: 'speedDie', label: 'Speed Die', text: 'Once you have passed GO a third die joins: Mr. Monopoly sends you on to the next deed to buy or pay, the Bus lets you pick one die or the sum, and triples let you jump anywhere.' },
  { key: 'arcadeParking', label: 'Free Parking arcade', text: 'Free Parking starts a mini-game too.' },
];

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="howto-steps">
      {steps.map((s, i) => (
        <li key={s.title}>
          <span className="howto-icon" aria-hidden>{s.icon}</span>
          <div>
            <b><span className="howto-n">{i + 1}</span>{s.title}</b>
            <p>{s.text}</p>
            {s.art}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Arcades, house rules, the boards' own rules and the camera: what the first page leaves out. */
function Extras({ rules, mapId, cur }: { rules?: Partial<RuleConfig>; mapId?: string; cur: string }) {
  // At a table, its own board's rules; elsewhere, every board that has some.
  const boards = MAPS.filter(m => m.special && (!mapId || m.id === mapId));
  const arcades = rules?.minigames !== false;
  // At a table, what Free Parking does there; on the home page, what it can do.
  const jackpot = !!rules?.freeParkingPot, parkArcade = !!rules?.arcadeParking && arcades;
  const parking = !rules
    ? 'Free Parking is a rest stop, unless the table turns on the Free Parking jackpot (land there to scoop the taxes, card fines and arcade losses paid in) or the Free Parking arcade (it starts a mini-game)'
    : jackpot && parkArcade ? 'Free Parking pays out the jackpot and starts a mini-game'
      : jackpot ? 'Free Parking pays out the jackpot (the taxes, card fines and arcade losses paid in)'
        : parkArcade ? 'Free Parking starts a mini-game' : 'Free Parking is a rest stop';
  return (
    <div className="howto-extras">
      <section>
        <h3>🃏 Chance, Chest, tax</h3>
        <p>Those squares draw a card or take a fee. Go to Jail sends you straight there, and {parking}.</p>
      </section>
      {arcades && (
        <section>
          <h3>🕹️ Arcade squares</h3>
          <p>Landing on one starts a quick mini-game for cash prizes from the bank (a bad spin can cost you). A random one each time:</p>
          <ul className="howto-games">
            {MINIGAME_KINDS.map(k => <li key={k}><b>{MINIGAME_INFO[k].icon} {MINIGAME_INFO[k].title}</b> {MINIGAME_INFO[k].blurb}</li>)}
          </ul>
          <p className="muted">The Speedway, Metropolis, Blitz and Crossroads boards have arcade squares. On the Classic board the host can turn Free Parking into one.</p>
        </section>
      )}
      {boards.map(m => (
        <section key={m.id}>
          <h3>🗺️ The {m.name} board</h3>
          <p>{m.special!.replaceAll('$', cur)}</p>
        </section>
      ))}
      <section>
        <h3>🏠 House rules{rules ? ' at this table' : ''}</h3>
        <p className="muted">The host picks these in the lobby. Auctions, even building and limited houses are covered on the first page.</p>
        <ul className="howto-rules">
          {HOUSE_RULES.filter(r => r.key !== 'arcadeParking' || arcades).map(r => {
            const state = rules ? !!rules[r.key] : undefined;
            return (
              <li key={r.key} className={state === false ? 'off' : ''}>
                <b>{r.label}</b>
                {state !== undefined && <em className={`howto-flag ${state ? 'on' : ''}`}>{state ? 'on' : 'off'}</em>}
                <span>{r.text}</span>
              </li>
            );
          })}
          {(rules?.turnSeconds ?? 0) > 0 && (
            <li><b>Turn clock</b><em className="howto-flag on">{rules!.turnSeconds}s</em><span>Out of time and auto-play plays that step for you.</span></li>
          )}
          {(rules?.timeLimitMin ?? 0) > 0 && (
            <li><b>Game clock</b><em className="howto-flag on">{rules!.timeLimitMin} min</em><span>When it runs out the richest player wins.</span></li>
          )}
        </ul>
      </section>
      <section>
        <h3>🎥 Camera</h3>
        <p>The camera button in the bottom-left dock (or C) cycles the views: {CAMERA_MODES.map(m => m.label).join(', ')}. In Free, drag to orbit, scroll or pinch to zoom, right-drag to pan. Cinematic adds close-ups for big moments.</p>
      </section>
    </div>
  );
}

type Tab = 'rules' | 'extras' | 'keys';

const hasKeyboard = () => typeof window !== 'undefined' && !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

/** How to play (and, in a game with a keyboard, the shortcuts) in a dialog. */
export default function HowToPlay({ onClose, game = 'monopoly', pickGame = false, rules, mapId, shortcuts = false, startOn = 'rules', currency = '$' }: {
  onClose: () => void;
  /** Which game's tutorial to show (first, with pickGame). */
  game?: HowToGame;
  /** A tab per game on top, to switch between the three (the home page's hero button). */
  pickGame?: boolean;
  /** Monopoly: the table's rules, to word the steps (auctions, game clock). */
  rules?: Partial<RuleConfig>;
  /** Monopoly: the table's board, for its own rules (Blitz, Crossroads); absent: every board's. */
  mapId?: string;
  /** Monopoly: offer the keyboard-shortcuts tab (in a game, on devices with a keyboard). */
  shortcuts?: boolean;
  startOn?: Tab;
  /** Monopoly: the edition's money symbol. */
  currency?: string;
}) {
  const keys = shortcuts && hasKeyboard();
  const [g, setG] = useState<HowToGame>(game);
  const [tab, setTab] = useState<Tab>(startOn === 'keys' && !keys ? 'rules' : startOn);
  const tabs: [Tab, string][] = [['rules', 'The basics'], ['extras', 'Extras'], ...(keys ? [['keys', 'Keys'] as [Tab, string]] : [])];
  // At a Monopoly table it is plainly "How to play"; elsewhere it says which game.
  const title = pickGame || (g === 'monopoly' && rules) ? 'How to play' : `How to play ${HOWTO_GAMES.find(x => x.id === g)!.name}`;
  return (
    <Modal onClose={onClose} labelledBy="howto-title" className={`howto howto-${g}`}>
      <div className="howto-head">
        <h2 id="howto-title">{title}</h2>
        <CloseX onClick={onClose} />
      </div>
      {pickGame && (
        <div className="howto-pick" role="tablist" aria-label="Game">
          {HOWTO_GAMES.map(x => (
            <button key={x.id} type="button" role="tab" aria-selected={g === x.id} className={g === x.id ? 'on' : ''}
              onClick={() => { setG(x.id); setTab('rules'); }}>
              <span aria-hidden>{x.icon}</span> {x.name}
            </button>
          ))}
        </div>
      )}
      {g === 'monopoly' && (
        <>
          <div className="ux-seg howto-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'rules' && <Steps steps={howToSteps(rules, currency)} />}
          {tab === 'extras' && <Extras rules={rules} mapId={mapId} cur={currency} />}
          {tab === 'keys' && (
            <table className="howto-keys">
              <tbody>{SHORTCUTS.map(([k, what]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{what}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
      {g === 'cards' && <Steps steps={cardsSteps()} />}
      {g === 'poker' && <Steps steps={pokerSteps()} />}
      <button className="btn primary big howto-go" onClick={onClose} data-autofocus>Let's play!</button>
    </Modal>
  );
}

const SEEN_KEY = 'yot:howto-seen';
export function howToSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}
export function markHowToSeen(): void {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
}

/**
 * A "How to play" button that opens the dialog (home page, lobby). The dialog
 * goes to <body>: inside the home page's hero it sat in the hero's stacking
 * layer, under the character cards below it.
 */
export function HowToPlayButton({ rules, mapId, game, className = 'btn small ghost', label = '❓ How to play' }: {
  rules?: Partial<RuleConfig>; mapId?: string; game?: HowToGame; className?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => { setOpen(true); if (!game || game === 'monopoly') markHowToSeen(); }}>{label}</button>
      {open && createPortal(<HowToPlay game={game} rules={rules} mapId={mapId} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
