// Trading: the offer builder (pick a player, what you give, what you get,
// a summary with rough values and every reason the offer can't go yet), the
// short offer cards in the side panel, the full side-by-side view of any open
// trade (the Trades dialog: mine, sent and other players') with accept,
// decline and counter, and the pop-up notice for a new offer.
// The checks mirror the engine's (validateTrade in the engine): ownership,
// cash on hand, jail cards, no buildings in a traded deed's colour set, and
// no paying out cash that is already owed.
import { useEffect, useRef, useState } from 'react';
import { groupIndices, mortgageInterest, mortgageValue, type SpaceDef } from '../../../shared/board.ts';
import { resolveTheme, type Theme } from '../../../shared/themes.ts';
import type { GameView, PlayerState, Trade, TradeSide } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';
import { CharacterFace } from './CharacterFace.tsx';
import { debtOf, groupLabel, ownedBy, ownsSet } from '../gameHelpers.ts';
import { CloseX, Modal } from './Modal.tsx';

const EMPTY: TradeSide = { cash: 0, spaces: [], jailCards: 0 };
/** The engine's cap on open offers per player. */
const MAX_OPEN = 5;
/** A Get Out of Jail Free card is worth about the bail it saves. */
const JAIL_CARD_VALUE = 50;

const groupBuilt = (game: GameView, spaces: SpaceDef[], i: number) => {
  const g = spaces[i].group;
  return !!g && groupIndices(spaces, g).some(j => (game.owned[j]?.houses ?? 0) > 0);
};

/** Rough value of one side: cash, deed prices (half for a mortgaged one), jail cards. */
export function sideValue(game: GameView, spaces: SpaceDef[], s: TradeSide): number {
  return s.cash + s.jailCards * JAIL_CARD_VALUE
    + s.spaces.reduce((a, i) => a + (game.owned[i]?.mortgaged ? mortgageValue(spaces[i]) : spaces[i].price ?? 0), 0);
}

/** Why `owner` cannot hand over `side` right now (the engine's checks), or null. */
export function sideProblem(game: GameView, spaces: SpaceDef[], owner: PlayerState, side: TradeSide): string | null {
  if (side.cash > owner.cash) return `${owner.name} only has ${resolveTheme(game.themeId, game.mapId).currency}${owner.cash.toLocaleString()}`;
  if (side.jailCards > owner.jailCards.length) return `${owner.name} doesn't have that many jail cards`;
  for (const i of side.spaces) {
    if (game.owned[i]?.owner !== owner.id) return `${owner.name} no longer owns ${spaces[i].name}`;
    if (groupBuilt(game, spaces, i)) return `${spaces[i].name}'s set has buildings — they must be sold first`;
  }
  return null;
}

/**
 * Why a deal `from` → `to` could not go through right now (the engine's
 * validateTrade), or null: each side's own checks, then someone who owes may
 * not pay out, net, more than the cash they have over their debts.
 */
export function tradeProblem(game: GameView, spaces: SpaceDef[], from: PlayerState, to: PlayerState, give: TradeSide, get: TradeSide): string | null {
  const side = sideProblem(game, spaces, from, give) ?? sideProblem(game, spaces, to, get);
  if (side) return side;
  for (const [who, out, back] of [[from, give.cash, get.cash], [to, get.cash, give.cash]] as const) {
    const owe = debtOf(game, who.id);
    if (owe > 0 && out - back > Math.max(0, who.cash - owe)) {
      return `${who.name} owes ${resolveTheme(game.themeId, game.mapId).currency}${owe.toLocaleString()} and cannot pay out cash before settling it`;
    }
  }
  return null;
}

/** Would `id` own all of `space`'s colour set after taking `taking` (and giving away `giving`)? */
function completesSet(game: GameView, spaces: SpaceDef[], id: string, space: number, taking: number[], giving: number[] = []): boolean {
  const s = spaces[space];
  if (s.kind !== 'property' || !s.group) return false;
  return groupIndices(spaces, s.group).every(i => taking.includes(i) || (game.owned[i]?.owner === id && !giving.includes(i)));
}

function DeedChips({ game, theme, who, side, onChange, other, otherSide, mineSide }: {
  game: GameView; theme: Theme; who: PlayerState; side: TradeSide; onChange: (s: TradeSide) => void;
  /** The player who would receive these deeds. */
  other: PlayerState; otherSide: TradeSide;
  /** These are my deeds (the "you give" side). */
  mineSide: boolean;
}) {
  const spaces = theme.spaces;
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const deeds = ownedBy(game, who.id);
  if (!deeds.length) return <p className="muted small tr-none">No deeds to trade</p>;
  const toggle = (i: number) =>
    onChange({ ...side, spaces: side.spaces.includes(i) ? side.spaces.filter(x => x !== i) : [...side.spaces, i] });
  return (
    <div className="tr-deeds">
      {deeds.map(i => {
        const s = spaces[i];
        const o = game.owned[i];
        const built = groupBuilt(game, spaces, i);
        const on = side.spaces.includes(i);
        // Taking it completes a set for the receiver.
        const taking = [...side.spaces.filter(x => x !== i), i];
        const completes = completesSet(game, spaces, other.id, i, taking, otherSide.spaces);
        const color = s.group ? theme.groupColors[s.group] : s.kind === 'railroad' ? '#30343c' : '#9aa3b2';
        return (
          <button key={i} type="button" className={`tr-deed ${on ? 'on' : ''}`} disabled={built} aria-pressed={on}
            title={built ? `Sell the buildings in the ${groupLabel(s.group!)} set first` : `${s.name} · ${o.mortgaged ? 'mortgaged' : `price ${cur(s.price ?? 0)}`}`}
            onClick={() => toggle(i)} style={{ ['--set' as string]: color }}>
            <i className="tr-swatch" />
            <span className="tr-deed-name">{s.name}</span>
            <span className="tr-deed-meta">
              {built ? '🏠 built' : o.mortgaged ? 'mortgaged' : cur(s.price ?? 0)}
            </span>
            {completes && !built && (
              <span className={`tr-star ${mineSide ? 'warn' : ''}`}>{mineSide ? `⚠ completes ${other.name}'s set` : '⭐ completes your set'}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CashPicker({ theme, who, side, onChange }: { theme: Theme; who: PlayerState; side: TradeSide; onChange: (s: TradeSide) => void }) {
  const set = (n: number) => onChange({ ...side, cash: Math.max(0, Math.min(who.cash, Math.round(n) || 0)) });
  const quick = [50, 100, 500].filter(q => q <= Math.max(50, who.cash));
  return (
    <div className="tr-cash">
      <div className="tr-cash-row">
        <span className="tr-coin" aria-hidden>{theme.currency}</span>
        <input type="number" inputMode="numeric" min={0} max={who.cash} step={10} value={side.cash || ''} placeholder="0"
          aria-label={`Cash from ${who.name}`} onChange={e => set(Number(e.target.value))} />
        <span className="small muted tr-has">of {theme.currency}{who.cash.toLocaleString()}</span>
      </div>
      <input type="range" className="tr-slider" min={0} max={who.cash} step={who.cash > 500 ? 10 : 5} value={side.cash}
        aria-label={`Cash from ${who.name} (slider)`} onChange={e => set(Number(e.target.value))} />
      <div className="tr-quick">
        {quick.map(q => <button key={q} type="button" className="btn tiny ghost" disabled={side.cash + q > who.cash} onClick={() => set(side.cash + q)}>+{q}</button>)}
        <button type="button" className="btn tiny ghost" disabled={side.cash === 0} onClick={() => set(0)}>Clear</button>
      </div>
    </div>
  );
}

function SideCard({ game, theme, who, side, onChange, title, other, otherSide, mineSide }: {
  game: GameView; theme: Theme; who: PlayerState; side: TradeSide; onChange: (s: TradeSide) => void; title: string;
  other: PlayerState; otherSide: TradeSide; mineSide: boolean;
}) {
  return (
    <section className="tr-side" style={{ ['--who' as string]: who.color }}>
      <h3 className="tr-side-title"><span className="tr-dot"><CharacterFace id={who.character} /></span>{title}</h3>
      <CashPicker theme={theme} who={who} side={side} onChange={onChange} />
      {who.jailCards.length > 0 && (
        <div className="tr-jail">
          <span>🎫 Jail cards</span>
          <button type="button" className="btn tiny ghost" disabled={side.jailCards === 0} aria-label="One fewer jail card"
            onClick={() => onChange({ ...side, jailCards: side.jailCards - 1 })}>−</button>
          <b>{side.jailCards}</b>
          <button type="button" className="btn tiny ghost" disabled={side.jailCards >= who.jailCards.length} aria-label="One more jail card"
            onClick={() => onChange({ ...side, jailCards: side.jailCards + 1 })}>+</button>
          <span className="small muted">of {who.jailCards.length}</span>
        </div>
      )}
      <DeedChips game={game} theme={theme} who={who} side={side} onChange={onChange} other={other} otherSide={otherSide} mineSide={mineSide} />
    </section>
  );
}

/** A counter-offer being drafted: the original's sides, swapped to our point of view. */
export interface CounterDraft { counterOf: string; withId: string; give: TradeSide; get: TradeSide }

/** Open the trade dialog prefilled from an incoming offer, sides swapped. */
export function counterDraft(t: Trade): CounterDraft {
  return { counterOf: t.id, withId: t.from, give: { ...t.get, spaces: [...t.get.spaces] }, get: { ...t.give, spaces: [...t.give.spaces] } };
}

export function TradeModal({ game, me, withId, onClose, counter }: {
  game: GameView; me: string; withId: string; onClose: () => void;
  /** Counter an offer: starts from its terms, and sending replaces it. */
  counter?: CounterDraft;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const spaces = theme.spaces;
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const mine = game.players.find(p => p.id === me)!;
  const partners = game.players.filter(p => p.id !== me && !p.bankrupt);
  const [partner, setPartner] = useState(withId);
  const them = game.players.find(p => p.id === partner) ?? partners[0];
  const [give, setGive] = useState<TradeSide>(counter?.give ?? EMPTY);
  const [get, setGet] = useState<TradeSide>(counter?.get ?? EMPTY);
  const [busy, setBusy] = useState(false);
  if (!them) return null;

  const pick = (id: string) => {
    if (id === partner) return;
    setPartner(id);
    setGet(EMPTY); // their deeds and cash no longer apply
  };

  const empty = (s: TradeSide) => !s.cash && !s.spaces.length && !s.jailCards;
  const openOffers = game.trades.filter(t => t.from === me && t.id !== counter?.counterOf).length;
  const problem = empty(give) && empty(get) ? 'Pick something to give or to get'
    : them.bankrupt ? `${them.name} is out of the game`
      : !counter && openOffers >= MAX_OPEN ? `You already have ${MAX_OPEN} open offers — withdraw one first`
        : tradeProblem(game, spaces, mine, them, give, get);
  const giveValue = sideValue(game, spaces, give);
  const getValue = sideValue(game, spaces, get);
  const diff = getValue - giveValue;
  const interest = get.spaces.filter(i => game.owned[i]?.mortgaged).reduce((a, i) => a + mortgageInterest(spaces[i]), 0);
  const oneSided = !problem && (empty(give) || empty(get));

  const send = () => {
    if (problem || busy) return;
    setBusy(true);
    act({ type: 'proposeTrade', to: them.id, give, get, ...(counter ? { counterOf: counter.counterOf } : {}) })
      .then(onClose).catch(toastError).finally(() => setBusy(false));
  };

  return (
    <Modal onClose={onClose} labelledBy="trade-title" className="wide trade">
      <div className="tr-head">
        <h2 id="trade-title">🤝 {counter ? `Counter ${them.name}'s offer` : 'Make a trade'}</h2>
        <CloseX onClick={onClose} />
      </div>
      {counter ? (
        <p className="small muted tr-lede">Change the terms and send: your counter-offer replaces theirs.</p>
      ) : partners.length > 1 && (
        <div className="tr-partners" role="radiogroup" aria-label="Trade with">
          {partners.map(p => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === them.id}
              className={`tr-partner ${p.id === them.id ? 'on' : ''}`} style={{ ['--who' as string]: p.color }} onClick={() => pick(p.id)}>
              <span className="tr-dot"><CharacterFace id={p.character} /></span>{p.name}
            </button>
          ))}
        </div>
      )}

      <div className="tr-cols">
        <SideCard game={game} theme={theme} who={mine} side={give} onChange={setGive} title="You give" other={them} otherSide={get} mineSide />
        <div className="tr-swap" aria-hidden>⇄</div>
        <SideCard game={game} theme={theme} who={them} side={get} onChange={setGet} title={`You get from ${them.name}`} other={mine} otherSide={give} mineSide={false} />
      </div>

      <div className={`tr-summary ${problem ? 'bad' : ''}`} aria-live="polite">
        <div className="tr-values">
          <span>You give <b>≈ {cur(giveValue)}</b></span>
          <span className={`tr-verdict ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>
            {diff === 0 ? 'Even' : diff > 0 ? `+${cur(diff)} for you` : `+${cur(-diff)} for ${them.name}`}
          </span>
          <span>You get <b>≈ {cur(getValue)}</b></span>
        </div>
        {problem ? <p className="tr-problem">⚠ {problem}</p>
          : oneSided ? <p className="small muted tr-info">{empty(get) ? `A gift — you ask nothing back.` : `You give nothing back — ${them.name} may well say no.`}</p>
            : null}
        {!problem && interest > 0 && <p className="small muted tr-info">Mortgaged deeds you receive cost {cur(interest)} interest (10%) straight away.</p>}
        <p className="small muted tr-info">Deeds count at their price (half when mortgaged).</p>
      </div>

      <div className="tr-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary chunky" disabled={!!problem || busy} onClick={send}>{counter ? 'Send counter-offer' : `Send offer to ${them.name}`}</button>
      </div>
    </Modal>
  );
}

// ---- viewing offers ----------------------------------------------------------

/** The band colour of a deed: its colour set, else railroad dark or utility grey. */
const deedColor = (theme: Theme, s: SpaceDef) => (s.group ? theme.groupColors[s.group] : s.kind === 'railroad' ? '#30343c' : '#9aa3b2');

/** Open offers made to me: they need an answer (the badge counts). */
export function incomingTrades(game: GameView, me: string): Trade[] {
  return game.trades.filter(t => t.to === me);
}

/** One direction of a deal: `giver` hands `side` to `taker`, who hands `back` the other way. */
interface Leg { giver: PlayerState; taker: PlayerState; side: TradeSide; back: TradeSide }

/** How many of `kind` (railroads, utilities) `taker` would hold after the deal. */
function heldAfter(game: GameView, spaces: SpaceDef[], kind: SpaceDef['kind'], leg: Leg): number {
  return spaces.filter((s, j) => s.kind === kind
    && (leg.side.spaces.includes(j) || (game.owned[j]?.owner === leg.taker.id && !leg.back.spaces.includes(j)))).length;
}

/** A deed changing hands: colour band, price, rent for the new owner, mortgage, and what it does to sets. */
function DeedRow({ game, theme, me, i, leg }: { game: GameView; theme: Theme; me: string; i: number; leg: Leg }) {
  const spaces = theme.spaces;
  const s = spaces[i];
  const o = game.owned[i];
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const { giver, taker } = leg;
  const label = s.group ? groupLabel(s.group) : '';
  const completes = completesSet(game, spaces, taker.id, i, leg.side.spaces, leg.back.spaces);
  // Giving away a deed of a set you hold whole breaks it up (the set's double rent goes).
  const breaks = !!s.group && s.kind === 'property' && ownsSet(game, spaces, giver.id, s.group);
  let rent = '';
  if (s.kind === 'property' && s.rent) {
    rent = completes ? `rent ${cur(s.rent[0] * 2)} with the set` : `rent ${cur(s.rent[0])}`;
  } else if (s.kind === 'railroad') {
    const n = Math.max(1, heldAfter(game, spaces, 'railroad', leg));
    rent = `rent ${cur(25 * 2 ** (n - 1))} with ${n} railroad${n > 1 ? 's' : ''}`;
  } else if (s.kind === 'utility') {
    const all = spaces.filter(x => x.kind === 'utility').length;
    rent = all >= 2 && heldAfter(game, spaces, 'utility', leg) === all ? 'rent 10× dice' : 'rent 4× dice';
  }
  const payer = taker.id === me ? 'you pay' : `${taker.name} pays`;
  return (
    <li className={`tc-deed ${o?.mortgaged ? 'mort' : ''}`} style={{ ['--set' as string]: deedColor(theme, s) }}>
      <i className="tc-band" aria-hidden />
      <div className="tc-deed-body">
        <b className="tc-deed-name">{s.name}</b>
        <span className="tc-deed-meta">
          {label && <span className="tc-group">{label}</span>}
          <span>{cur(s.price ?? 0)}</span>
          {rent && <span>{rent}</span>}
        </span>
        {o?.mortgaged && (
          <span className="tc-flag mort" title="Worth half its price until the mortgage is lifted">
            Mortgaged · {payer} {cur(mortgageInterest(s))} interest on taking it
          </span>
        )}
        {completes && (
          <span className={`tc-flag ${taker.id === me ? 'good' : giver.id === me ? 'warn' : 'info'}`}>
            {taker.id === me ? `⭐ Completes your ${label} set!` : `${giver.id === me ? '⚠' : '⭐'} Completes ${taker.name}'s ${label} set`}
          </span>
        )}
        {breaks && (
          <span className={`tc-flag ${giver.id === me ? 'warn' : 'info'}`}>
            💔 Breaks up {giver.id === me ? 'your' : `${giver.name}'s`} {label} set
          </span>
        )}
      </div>
    </li>
  );
}

function TradeSideView({ game, theme, me, leg, title }: { game: GameView; theme: Theme; me: string; leg: Leg; title: string }) {
  const { side, giver } = leg;
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const nothing = !side.cash && !side.spaces.length && !side.jailCards;
  return (
    <section className="tc-side" style={{ ['--who' as string]: giver.color }}>
      <h4 className="tc-side-title"><span className="tr-dot" aria-hidden><CharacterFace id={giver.character} /></span>{title}</h4>
      {nothing ? <p className="tc-nothing">Nothing</p> : (
        <ul className="tc-items">
          {side.spaces.map(i => <DeedRow key={i} game={game} theme={theme} me={me} i={i} leg={leg} />)}
          {side.cash > 0 && <li className="tc-cash"><span className="tr-coin" aria-hidden>{theme.currency}</span><b>{cur(side.cash)}</b> cash</li>}
          {side.jailCards > 0 && (
            <li className="tc-jail"><span aria-hidden>🎫</span><b>{side.jailCards}</b> Get Out of Jail Free card{side.jailCards > 1 ? 's' : ''}</li>
          )}
        </ul>
      )}
      <div className="tc-worth">Worth ≈ <b>{cur(sideValue(game, theme.spaces, side))}</b></div>
    </section>
  );
}

/**
 * One open offer in full: both sides next to each other (what I give on the
 * left, what I get on the right; for someone else's trade, the proposer
 * first), each deed with its set colour, price, rent and mortgage, flags for
 * sets it completes or breaks, each side's rough value and the balance, then
 * big answer buttons for an offer made to me.
 */
export function TradeCard({ game, me, trade: t, onCounter, focused }: {
  game: GameView; me: string; trade: Trade;
  /** Start a counter-offer (absent: no Counter button). */
  onCounter?: (t: Trade) => void;
  /** Opened from a notice: stands out from the rest. */
  focused?: boolean;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const [busy, setBusy] = useState(false);
  const from = game.players.find(p => p.id === t.from);
  const to = game.players.find(p => p.id === t.to);
  if (!from || !to) return null;
  const incoming = t.to === me, outgoing = t.from === me;
  const proposed: Leg = { giver: from, taker: to, side: t.give, back: t.get };
  const asked: Leg = { giver: to, taker: from, side: t.get, back: t.give };
  // Mine on the left: what I give, then what I get.
  const [left, right] = incoming ? [asked, proposed] : [proposed, asked];
  const titles = incoming || outgoing ? ['You give', `You get from ${(incoming ? from : to).name}`] : [`${from.name} gives`, `${to.name} gives`];
  const leftValue = sideValue(game, theme.spaces, left.side), rightValue = sideValue(game, theme.spaces, right.side);
  // Positive: the left side's giver comes out ahead (they get more than they give).
  const diff = rightValue - leftValue;
  const ahead = diff > 0 ? left.giver : right.giver;
  const verdict = diff === 0 ? 'About even'
    : ahead.id === me ? `About ${cur(Math.abs(diff))} in your favour` : `About ${cur(Math.abs(diff))} in ${ahead.name}'s favour`;
  const tone = diff === 0 || !(incoming || outgoing) ? '' : ahead.id === me ? 'up' : 'down';
  const problem = tradeProblem(game, theme.spaces, from, to, t.give, t.get);
  const lockedPhase = game.phase === 'auction' ? 'after the auction' : game.phase === 'minigame' ? 'after the mini-game' : null;
  const run = (a: Parameters<typeof act>[0]) => {
    setBusy(true);
    act(a).catch(toastError).finally(() => setBusy(false));
  };
  return (
    <article className={`tcard ${incoming ? 'in' : outgoing ? 'out' : 'watch'} ${focused ? 'focus' : ''}`} data-trade={t.id}
      style={{ ['--from' as string]: from.color, ['--to' as string]: to.color }} aria-label={`Trade: ${from.name} to ${to.name}`}>
      <header className="tc-head">
        <span className="tc-icon" aria-hidden>{incoming ? '📨' : outgoing ? '⏳' : '👀'}</span>
        <span className="tc-headline">
          {incoming ? <><b style={{ color: from.color }}>{from.name}</b> offers you a trade</>
            : outgoing ? <>Your offer to <b style={{ color: to.color }}>{to.name}</b> · waiting for an answer</>
              : <><b style={{ color: from.color }}>{from.name}</b> offers <b style={{ color: to.color }}>{to.name}</b> a trade</>}
        </span>
      </header>
      <div className="tc-sides">
        <TradeSideView game={game} theme={theme} me={me} leg={left} title={titles[0]} />
        <div className="tc-swap" aria-hidden>⇄</div>
        <TradeSideView game={game} theme={theme} me={me} leg={right} title={titles[1]} />
      </div>
      <p className={`tc-verdict ${tone}`}>
        <span>⚖ {verdict}</span>
        <span className="tc-verdict-note">deeds at price, half when mortgaged</span>
      </p>
      {problem && <p className="tc-problem">⚠ {problem}</p>}
      {incoming && !problem && lockedPhase && <p className="tc-note">You can accept {lockedPhase}.</p>}
      {incoming && (
        <div className="tc-actions">
          <button className="btn danger chunky" disabled={busy} onClick={() => run({ type: 'rejectTrade', id: t.id })}>✕ Decline</button>
          {onCounter && <button className="btn chunky" disabled={busy} onClick={() => onCounter(t)}>↩ Counter</button>}
          <button className="btn primary chunky" disabled={busy || !!problem || !!lockedPhase}
            onClick={() => run({ type: 'acceptTrade', id: t.id })}>✓ Accept</button>
        </div>
      )}
      {outgoing && (
        <div className="tc-actions">
          <button className="btn ghost" disabled={busy} onClick={() => run({ type: 'rejectTrade', id: t.id })}>Withdraw offer</button>
        </div>
      )}
    </article>
  );
}

/**
 * Every open trade at the table: offers made to me first (they need an
 * answer), then mine waiting on others, then other players' deals to watch.
 */
export function TradeCenter({ game, me, focus, onClose, onCounter, onNew }: {
  game: GameView; me: string;
  /** Scroll to and highlight this offer. */
  focus?: string | null;
  onClose: () => void;
  onCounter?: (t: Trade) => void;
  /** Make a new offer (absent: not playing). */
  onNew?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    listRef.current?.querySelector(`[data-trade="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);
  const playing = game.players.some(p => p.id === me);
  const groups: { key: string; title: string; trades: Trade[]; empty?: string }[] = [
    ...(playing ? [
      { key: 'in', title: 'Offers for you', trades: incomingTrades(game, me), empty: 'No offers waiting for you.' },
      { key: 'out', title: 'Your offers', trades: game.trades.filter(t => t.from === me), empty: 'You have no offers out.' },
    ] : []),
    { key: 'others', title: playing ? 'Between other players' : 'Open trades', trades: game.trades.filter(t => t.from !== me && t.to !== me) },
  ];
  return (
    <Modal onClose={onClose} labelledBy="trades-title" className="wide trades-center">
      <div className="tr-head">
        <h2 id="trades-title">🤝 Trades</h2>
        {onNew && <button className="btn small primary" onClick={onNew}>+ New offer</button>}
        <CloseX onClick={onClose} />
      </div>
      <div className="tcs-list" ref={listRef}>
        {!game.trades.length && <p className="muted tcs-empty">No open trades right now.{onNew ? ' Make an offer: deeds, cash or jail cards for theirs.' : ''}</p>}
        {game.trades.length > 0 && groups.map(g => (g.trades.length || g.empty) && (
          <section key={g.key} className={`tcs-group ${g.key}`}>
            <h3 className="tcs-title">{g.title}{g.trades.length > 0 && <span className="tcs-count">{g.trades.length}</span>}</h3>
            {g.trades.length
              ? g.trades.map(t => <TradeCard key={t.id} game={game} me={me} trade={t} focused={t.id === focus}
                onCounter={g.key === 'in' ? onCounter : undefined} />)
              : <p className="muted small tcs-none">{g.empty}</p>}
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** A new offer for me pops up with a link to it, even with the side panel folded away. */
export function TradePing({ game, me, onView }: { game: GameView; me: string; onView: (id: string) => void }) {
  const seen = useRef(new Set(game.trades.map(t => t.id)));
  const [ping, setPing] = useState<string | null>(null);
  useEffect(() => {
    const fresh = game.trades.find(t => t.to === me && !seen.current.has(t.id));
    for (const t of game.trades) seen.current.add(t.id);
    if (fresh) setPing(fresh.id);
  }, [game.trades, me]);
  useEffect(() => {
    if (!ping) return;
    const h = setTimeout(() => setPing(null), 10_000);
    return () => clearTimeout(h);
  }, [ping]);
  // Answered or withdrawn meanwhile: nothing left to show.
  const t = ping ? game.trades.find(x => x.id === ping) : undefined;
  const from = t && game.players.find(p => p.id === t.from);
  if (!t || !from) return null;
  return (
    <div className="trade-ping" role="status" style={{ ['--who' as string]: from.color }}>
      <span className="tp-icon" aria-hidden>📨</span>
      <span className="tp-text"><b style={{ color: from.color }}>{from.name}</b> sent you a trade offer</span>
      <button className="btn small primary" onClick={() => { setPing(null); onView(t.id); }}>View offer</button>
      <button className="tp-x" aria-label="Dismiss" onClick={() => setPing(null)}>✕</button>
    </div>
  );
}

function SideList({ game, theme, s, me, leg }: { game: GameView; theme: Theme; s: TradeSide; me: string; leg: Leg }) {
  const items: React.ReactNode[] = [];
  if (s.cash) items.push(<span key="c" className="of-chip cash">{theme.currency}{s.cash.toLocaleString()}</span>);
  for (const i of s.spaces) {
    const sp = theme.spaces[i];
    // A deed that completes my set gets a star, even in the short list.
    const star = leg.taker.id === me && completesSet(game, theme.spaces, me, i, leg.side.spaces, leg.back.spaces);
    items.push(<span key={i} className={`of-chip ${star ? 'star' : ''}`} style={{ ['--set' as string]: deedColor(theme, sp) }}
      title={star ? `Completes your ${groupLabel(sp.group!)} set` : undefined}>
      <i />{sp.name}{game.owned[i]?.mortgaged ? ' (m)' : ''}{star ? ' ⭐' : ''}</span>);
  }
  if (s.jailCards) items.push(<span key="j" className="of-chip">🎫 ×{s.jailCards}</span>);
  return <div className="of-items">{items.length ? items : <span className="muted small">nothing</span>}</div>;
}

/** My offers in short, in the side panel: the ones made to me with quick answers, mine with Withdraw. */
export function TradeOffers({ game, me, onCounter, onView }: {
  game: GameView; me: string;
  /** Start a counter-offer to this incoming trade (absent: no Counter button). */
  onCounter?: (t: Trade) => void;
  /** Open the full view of an offer. */
  onView?: (id: string) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const [busy, setBusy] = useState<string | null>(null);
  const player = (id: string) => game.players.find(p => p.id === id);
  const relevant = game.trades.filter(t => t.to === me || t.from === me);
  if (!relevant.length) return null;
  const run = (id: string, a: Parameters<typeof act>[0]) => {
    setBusy(id);
    act(a).catch(toastError).finally(() => setBusy(null));
  };
  // Incoming first: they need an answer.
  const sorted = [...relevant].sort((a, b) => Number(b.to === me) - Number(a.to === me));
  const lockedPhase = game.phase === 'auction' ? 'after the auction' : game.phase === 'minigame' ? 'after the mini-game' : null;
  return (
    <div className="offers" aria-label="Trade offers">
      {sorted.map((t: Trade) => {
        const from = player(t.from), to = player(t.to);
        if (!from || !to) return null;
        const incoming = t.to === me;
        const problem = tradeProblem(game, theme.spaces, from, to, t.give, t.get);
        const mine: Leg = incoming ? { giver: to, taker: from, side: t.get, back: t.give } : { giver: from, taker: to, side: t.give, back: t.get };
        const theirs: Leg = incoming ? { giver: from, taker: to, side: t.give, back: t.get } : { giver: to, taker: from, side: t.get, back: t.give };
        const diff = sideValue(game, theme.spaces, theirs.side) - sideValue(game, theme.spaces, mine.side);
        const other = incoming ? from : to;
        return (
          <div key={t.id} className={`offer ${incoming ? 'in' : 'out'}`} style={{ ['--who' as string]: other.color }}>
            <div className="of-head">
              {incoming
                ? <><span className="of-icon" aria-hidden>📨</span><span className="grow"><b style={{ color: from.color }}>{from.name}</b> offers you a trade</span></>
                : <><span className="of-icon" aria-hidden>⏳</span><span className="grow">Waiting for <b style={{ color: to.color }}>{to.name}</b>…</span></>}
              {onView && <button className="btn tiny of-view" onClick={() => onView(t.id)} aria-label={`View the trade with ${other.name} in full`}>View</button>}
              {!incoming && <button className="btn tiny ghost" disabled={busy === t.id} onClick={() => run(t.id, { type: 'rejectTrade', id: t.id })}>Withdraw</button>}
            </div>
            <div className="of-cols">
              <div><span className="of-label">You get</span><SideList game={game} theme={theme} s={theirs.side} me={me} leg={theirs} /></div>
              <div><span className="of-label">You give</span><SideList game={game} theme={theme} s={mine.side} me={me} leg={mine} /></div>
            </div>
            <p className={`of-verdict ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>
              ⚖ {diff === 0 ? 'About even' : diff > 0 ? `About ${cur(diff)} in your favour` : `About ${cur(-diff)} in ${other.name}'s favour`}
            </p>
            {problem && <p className="of-problem small">⚠ {problem}</p>}
            {incoming && !problem && lockedPhase && <p className="small muted of-note">You can accept {lockedPhase}.</p>}
            {incoming && (
              <div className="of-actions">
                <button className="btn small danger" disabled={busy === t.id} onClick={() => run(t.id, { type: 'rejectTrade', id: t.id })}>Decline</button>
                {onCounter && <button className="btn small" disabled={busy === t.id} onClick={() => onCounter(t)}>Counter</button>}
                <button className="btn small primary" disabled={busy === t.id || !!problem || !!lockedPhase}
                  onClick={() => run(t.id, { type: 'acceptTrade', id: t.id })}>Deal! ✓</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
