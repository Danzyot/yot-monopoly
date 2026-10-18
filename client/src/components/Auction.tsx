// Auctions: the bidding panel and the "SOLD!" moment when the hammer falls.
//
// How the engine runs one (server/src/engine/game.ts): everyone still in the
// game may bid, in any order, any whole amount above the top bid that their
// cash (less what they owe) covers. The clock starts at AUCTION_MS and every
// bid puts at least AUCTION_EXTEND_MS back on it. The top bid when the clock
// runs out wins; it also ends early once everyone but the top bidder has
// dropped out, and a bid drops out whoever can no longer top it (deeds are
// locked during an auction, so their cash cannot grow). The top bidder cannot
// drop out. Nobody bids: it stays unsold.
// The panel says all of that in plain words, for someone who has never seen one.
import { useEffect, useRef, useState } from 'react';
import { AUCTION_EXTEND_MS, AUCTION_MS } from '../../../shared/pacing.ts';
import { resolveTheme } from '../../../shared/themes.ts';
import type { Auction, GameView } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';
import { characterEmoji } from '../format.ts';
import { debtOf, inkOn } from '../gameHelpers.ts';

/** The quick-bid raises, on top of the current top bid. */
export const QUICK_BIDS = [10, 50, 100];

/** "Going once…" as the clock runs down. */
function clockWords(left: number): string {
  if (left <= 1) return 'Last call!';
  if (left <= 2) return 'Going twice…';
  if (left <= 4) return 'Going once…';
  return `${left}s left`;
}

export function AuctionPanel({ game, me, skew }: { game: GameView; me: string; skew: number }) {
  const a = game.auction;
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const [, tick] = useState(0);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!a) return;
    const t = setInterval(() => tick(n => n + 1), 100);
    return () => clearInterval(t);
  }, [a]);
  if (!a) return null;
  const s = theme.spaces[a.space];
  const leader = game.players.find(p => p.id === a.highBidder);
  // Frozen at the pause while the game is paused. Read the clock now, not
  // from state: the panel stays mounted between auctions, so a remembered
  // "now" would be from long before this one began.
  const leftMs = Math.max(0, a.endsAt - (game.paused ? game.paused.at : Date.now() + skew));
  // A full bar is a fresh auction's clock; a bid tops it back up to at least half.
  const frac = Math.min(1, leftMs / AUCTION_MS);
  const left = Math.ceil(leftMs / 1000);
  const inIt = a.bidders.includes(me);
  const seated = game.players.some(p => p.id === me && !p.bankrupt);
  const me_ = game.players.find(p => p.id === me);
  const canSpend = Math.max(0, (me_?.cash ?? 0) - debtOf(game, me));
  const winning = a.highBidder === me;
  const color = s.group ? theme.groupColors[s.group] : '#2a3142';
  const minBid = a.highBid + 1;
  const customN = Math.floor(Number(custom));
  // Still in, but the top bid is already more than they can spend: dropping out is all that's left.
  const cantTop = inIt && !winning && canSpend < minBid;
  const name = (id: string) => (id === me ? 'You' : game.players.find(p => p.id === id)?.name ?? 'Someone');

  // Why this is happening, in one line.
  const lot = <b>{s.name}</b>;
  const bust = a.bank ? game.outOrder?.at(-1) : undefined;
  const why = a.bank
    ? <>{bust ? <>{name(bust)} went bankrupt, so </> : ''}the bank is selling {lot}</>
    : game.current === me
      ? <>You didn't buy {lot}, so it goes to auction</>
      : <>{name(game.current)} didn't buy {lot}, so it goes to auction</>;

  const send = (action: Parameters<typeof act>[0]) => {
    if (busy) return;
    setBusy(true);
    act(action).catch(toastError).finally(() => setBusy(false));
  };
  const bid = (amount: number) => send({ type: 'bid', amount });

  // Everyone who could bid, in seat order: still in, or dropped out.
  const field = game.players.filter(p => !p.bankrupt || a.bidders.includes(p.id));
  const lastIn = a.bidders.length === 1 && inIt && !leader;

  return (
    <div className={`auction ax ${winning ? 'winning' : ''}`} role="region" aria-label={`Auction for ${s.name}`}>
      <div className="ax-why">
        <span className="ax-kicker">{a.bank ? '🏦 Bank auction' : '🔨 Auction'}</span>
        <span className="ax-headline">{why}</span>
      </div>

      <div className="ax-top">
        <div className="ax-lot" style={{ ['--set' as string]: color, ['--set-ink' as string]: inkOn(color) }}>
          <span className="ax-lot-band">{s.kind === 'railroad' ? '🚂' : s.kind === 'utility' ? '💡' : ''}</span>
          <b className="ax-lot-name">{s.name}</b>
          {s.price !== undefined && <span className="ax-lot-price">List price <b>{cur(s.price)}</b></span>}
        </div>
        <div className="ax-lead" key={`${a.highBid}:${a.highBidder}`}>
          <span className="ax-label">{leader ? 'Top bid' : 'No bids yet'}</span>
          <b className="ax-bid">{leader ? cur(a.highBid) : '—'}</b>
          {leader
            ? <span className="ax-by">by <b style={{ color: leader.color }}>{characterEmoji(leader.character)} {winning ? 'you' : leader.name}</b></span>
            : <span className="ax-by">Opening bid: {cur(minBid)} or more</span>}
        </div>
      </div>

      <div className={`ax-clock ${left <= 3 && !game.paused ? 'urgent' : ''}`} role="timer"
        aria-label={game.paused ? 'Paused' : `${left} seconds left`}>
        <i style={{ width: `${frac * 100}%` }} />
        <span>{game.paused ? '⏸ Paused' : clockWords(left)}{!game.paused && left <= 4 ? ` · ${left}s` : ''}</span>
      </div>

      <div className="ax-body">
        {inIt && !winning && !cantTop && (
          <>
            <div className="ax-quick">
              {QUICK_BIDS.map(inc => {
                const amt = a.highBid + inc;
                return (
                  <button key={inc} className="btn gold ax-qb" disabled={busy || amt > canSpend} onClick={() => bid(amt)}
                    aria-label={`Bid ${cur(amt)}`} title={amt > canSpend ? `You can spend ${cur(canSpend)}` : undefined}>
                    <span className="ax-qb-inc">+{cur(inc)}</span><span className="ax-qb-amt">bid {cur(amt)}</span>
                  </button>
                );
              })}
            </div>
            <form className="ax-custom" onSubmit={e => { e.preventDefault(); if (customN >= minBid && customN <= canSpend) { bid(customN); setCustom(''); } }}>
              <input type="number" inputMode="numeric" min={minBid} max={canSpend} placeholder={`Any amount ${cur(minBid)}–${cur(canSpend)}`} value={custom}
                aria-label="Your own bid" onChange={e => setCustom(e.target.value)} />
              <button className="btn primary" type="submit" disabled={busy || !(customN >= minBid && customN <= canSpend)}>Bid</button>
            </form>
          </>
        )}
        {lastIn && <div className="ax-note good">Everyone else dropped out — bid any amount to take it.</div>}
        {winning && <div className="ax-note good">🏆 You're the top bidder. If nobody beats it before the clock runs out, it's yours.</div>}
        {cantTop && <div className="ax-note warn">You can spend {cur(canSpend)} — not enough to beat {cur(a.highBid)}.</div>}
        {inIt && !winning && (
          <div className="ax-foot">
            <span className="small muted">{cantTop ? '' : `You can spend ${cur(canSpend)}`}</span>
            <button className={`btn ${cantTop ? 'primary' : ''} ax-pass`} disabled={busy} onClick={() => send({ type: 'pass' })}
              title="Leave this auction: you can't bid on this lot again">✋ Pass · drop out</button>
          </div>
        )}
        {seated && !inIt && <div className="ax-note">You dropped out — watching the bidding.</div>}
        {!seated && <div className="ax-note">👀 Watching the bidding.</div>}

        <div className="ax-field" aria-label="Who is still bidding">
          <span className="ax-label">Still in</span>
          {field.map(p => {
            const still = a.bidders.includes(p.id);
            return (
              <span key={p.id} className={`ax-bidder ${still ? '' : 'out'} ${p.id === a.highBidder ? 'top' : ''}`} style={{ borderColor: p.color }}
                title={still ? `${p.name} is still in` : `${p.name} dropped out`}>
                {characterEmoji(p.character)} {p.id === me ? 'You' : p.name}{p.id === a.highBidder ? ' 🏆' : ''}
              </span>
            );
          })}
        </div>
        <p className="ax-how">
          <b>How it works:</b> anyone still in can bid at any time. Each bid puts at least {Math.round(AUCTION_EXTEND_MS / 1000)}s
          back on the clock; the top bid wins when it hits zero, or as soon as everyone else drops out.
        </p>
      </div>
    </div>
  );
}

/** "SOLD to X for $Y!" when an auction closes (or "No bids" when nobody wanted it). */
export function SoldBanner({ game, me }: { game: GameView; me: string }) {
  const last = useRef<Auction | null>(game.auction);
  const [shown, setShown] = useState<{ a: Auction; seq: number } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const prev = last.current;
    last.current = game.auction;
    if (prev && (!game.auction || game.auction.space !== prev.space)) setShown({ a: prev, seq: ++seq.current });
  }, [game.auction]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 2800);
    return () => clearTimeout(t);
  }, [shown]);
  if (!shown) return null;
  const theme = resolveTheme(game.themeId, game.mapId);
  const a = shown.a;
  const s = theme.spaces[a.space];
  // The engine settles the last state we saw: the high bidder then wins.
  const owner = game.owned[a.space]?.owner;
  const winner = game.players.find(p => p.id === (owner ?? a.highBidder));
  const won = !!owner && !!winner;
  // The closing bid can land in the same update that ends the auction: read it from the log.
  const line = [...game.log].reverse().find(l => l.text.includes(` won ${s.name} for `));
  const logged = line ? Number(line.text.slice(line.text.lastIndexOf(' for ') + 5).replace(/[^0-9]/g, '')) : NaN;
  const price = Number.isFinite(logged) && logged > 0 ? logged : a.highBid;
  return (
    <div className="sold" role="status" aria-live="polite" onClick={() => setShown(null)} key={shown.seq}>
      <div className={`sold-card ${won ? '' : 'nobid'}`} style={{ ['--set' as string]: s.group ? theme.groupColors[s.group] : '#2a3142' }}>
        <div className="sold-stamp">{won ? (winner!.id === me ? "IT'S YOURS!" : 'SOLD!') : 'NO BIDS'}</div>
        <div className="sold-deed">{s.name}</div>
        {won ? (
          <div className="sold-to">
            to <b style={{ color: winner!.color }}>{winner!.id === me ? 'you' : winner!.name}</b> for <b className="sold-price">{theme.currency}{price.toLocaleString()}</b>
          </div>
        ) : <div className="sold-to">It stays with the bank.</div>}
      </div>
    </div>
  );
}
