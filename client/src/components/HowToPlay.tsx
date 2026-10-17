// "How to play": the whole game in seven skimmable steps, reachable from the
// home page, the lobby and the game's "?" button (which also lists the
// keyboard shortcuts on devices that have a keyboard).
import { useState } from 'react';
import type { RuleConfig } from '../../../shared/themes.ts';
import { CloseX, Modal } from './Modal.tsx';
import { SHORTCUTS } from './Shortcuts.tsx';

interface Step { icon: string; title: string; text: string }

export function howToSteps(rules?: Partial<RuleConfig>): Step[] {
  const auctions = rules?.auctions !== false;
  const timed = (rules?.timeLimitMin ?? 0) > 0;
  return [
    { icon: '🎲', title: 'Roll & move', text: 'On your turn, hit GO to roll two dice and move. Doubles roll again — but three doubles in a row sends you to jail.' },
    { icon: '🏠', title: 'Buy property', text: `Land on a deed nobody owns and buy it.${auctions ? ' Skip it and it goes to auction — anyone can bid, even you.' : ''}` },
    { icon: '💰', title: 'Collect rent', text: 'Anyone landing on your deed pays you rent. Own a whole colour set and the rent doubles.' },
    { icon: '🏗️', title: 'Build houses', text: 'With a full set, tap Build: up to 4 houses, then a hotel. Rent skyrockets. Build evenly across the set.' },
    { icon: '🤝', title: 'Trade', text: 'Missing one deed of a set? Tap Trade (or ⇄ on a player) to swap deeds and cash. They can accept, decline or counter.' },
    { icon: '🔒', title: 'Jail & cash trouble', text: 'In jail: roll doubles (3 tries), pay bail or use a card. Short on cash? Sell houses or mortgage deeds to pay what you owe.' },
    { icon: '🏆', title: 'Win', text: timed ? 'Bankrupt everyone else — or be the richest when the clock runs out.' : 'Be the last player standing: everyone who can\'t pay goes bankrupt.' },
  ];
}

function Steps({ rules }: { rules?: Partial<RuleConfig> }) {
  return (
    <ol className="howto-steps">
      {howToSteps(rules).map((s, i) => (
        <li key={s.title}>
          <span className="howto-icon" aria-hidden>{s.icon}</span>
          <div>
            <b><span className="howto-n">{i + 1}</span>{s.title}</b>
            <p>{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const hasKeyboard = () => typeof window !== 'undefined' && !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

/** How to play (and, in a game with a keyboard, the shortcuts) in a dialog. */
export default function HowToPlay({ onClose, rules, shortcuts = false, startOn = 'rules' }: {
  onClose: () => void;
  /** The table's rules, to word the steps (auctions, game clock). */
  rules?: Partial<RuleConfig>;
  /** Offer the keyboard-shortcuts tab (in a game, on devices with a keyboard). */
  shortcuts?: boolean;
  startOn?: 'rules' | 'keys';
}) {
  const keys = shortcuts && hasKeyboard();
  const [tab, setTab] = useState<'rules' | 'keys'>(keys ? startOn : 'rules');
  return (
    <Modal onClose={onClose} labelledBy="howto-title" className="howto">
      <div className="howto-head">
        <h2 id="howto-title">How to play</h2>
        <CloseX onClick={onClose} />
      </div>
      {keys && (
        <div className="ux-seg howto-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>The game</button>
          <button role="tab" aria-selected={tab === 'keys'} className={tab === 'keys' ? 'on' : ''} onClick={() => setTab('keys')}>Keyboard</button>
        </div>
      )}
      {tab === 'rules' ? <Steps rules={rules} /> : (
        <table className="howto-keys">
          <tbody>{SHORTCUTS.map(([k, what]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{what}</td></tr>)}</tbody>
        </table>
      )}
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

/** A "How to play" button that opens the dialog (home page, lobby). */
export function HowToPlayButton({ rules, className = 'btn small ghost', label = '❓ How to play' }: {
  rules?: Partial<RuleConfig>; className?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => { setOpen(true); markHowToSeen(); }}>{label}</button>
      {open && <HowToPlay rules={rules} onClose={() => setOpen(false)} />}
    </>
  );
}
