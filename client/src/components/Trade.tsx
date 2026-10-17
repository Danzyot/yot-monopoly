// Trading: the offer builder (pick a player, what you give, what you get,
// a summary with rough values and every reason the offer can't go yet) and
// the incoming / outgoing offer cards with accept, decline and counter.
// The checks mirror the engine's (validateTrade in the engine): ownership,
// cash on hand, jail cards, no buildings in a traded deed's colour set, and
// no paying out cash that is already owed.
import { useState } from 'react';
import { groupIndices, mortgageValue, type SpaceDef } from '../../../shared/board.ts';
import { resolveTheme, type Theme } from '../../../shared/themes.ts';
import type { GameView, PlayerState, Trade, TradeSide } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';
import { characterEmoji } from '../format.ts';
import { debtOf, groupLabel, ownedBy } from '../gameHelpers.ts';
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
      <h3 className="tr-side-title"><span className="tr-dot">{characterEmoji(who.character)}</span>{title}</h3>
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
  const interest = get.spaces.filter(i => game.owned[i]?.mortgaged).reduce((a, i) => a + Math.ceil(mortgageValue(spaces[i]) / 10), 0);
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
              <span className="tr-dot">{characterEmoji(p.character)}</span>{p.name}
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

function SideList({ game, theme, s }: { game: GameView; theme: Theme; s: TradeSide }) {
  const items: React.ReactNode[] = [];
  if (s.cash) items.push(<span key="c" className="of-chip cash">{theme.currency}{s.cash.toLocaleString()}</span>);
  for (const i of s.spaces) {
    const sp = theme.spaces[i];
    const color = sp.group ? theme.groupColors[sp.group] : sp.kind === 'railroad' ? '#30343c' : '#9aa3b2';
    items.push(<span key={i} className="of-chip" style={{ ['--set' as string]: color }}><i />{sp.name}{game.owned[i]?.mortgaged ? ' (m)' : ''}</span>);
  }
  if (s.jailCards) items.push(<span key="j" className="of-chip">🎫 ×{s.jailCards}</span>);
  return <div className="of-items">{items.length ? items : <span className="muted small">nothing</span>}</div>;
}

export function TradeOffers({ game, me, onCounter }: {
  game: GameView; me: string;
  /** Start a counter-offer to this incoming trade (absent: no Counter button). */
  onCounter?: (t: Trade) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
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
        return (
          <div key={t.id} className={`offer ${incoming ? 'in' : 'out'}`} style={{ ['--who' as string]: (incoming ? from : to).color }}>
            <div className="of-head">
              {incoming
                ? <><span className="of-icon" aria-hidden>📨</span><span><b style={{ color: from.color }}>{from.name}</b> offers you a trade</span></>
                : <><span className="of-icon" aria-hidden>⏳</span><span className="grow">Waiting for <b style={{ color: to.color }}>{to.name}</b>…</span>
                  <button className="btn tiny ghost" disabled={busy === t.id} onClick={() => run(t.id, { type: 'rejectTrade', id: t.id })}>Withdraw</button></>}
            </div>
            <div className="of-cols">
              <div><span className="of-label">You get</span><SideList game={game} theme={theme} s={incoming ? t.give : t.get} /></div>
              <div><span className="of-label">You give</span><SideList game={game} theme={theme} s={incoming ? t.get : t.give} /></div>
            </div>
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
