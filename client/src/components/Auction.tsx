// Auctions: the bidding panel (a draining timer bar, who's winning, quick
// bids sized to the deed's price) and the "SOLD!" moment when the hammer falls.
import { useEffect, useRef, useState } from 'react';
import { resolveTheme } from '../../../shared/themes.ts';
import type { Auction, GameView } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';
import { characterEmoji } from '../format.ts';
import { debtOf, inkOn } from '../gameHelpers.ts';

/** Quick-bid steps that make sense for a deed of this price. */
export function bidSteps(price: number): number[] {
  if (price <= 100) return [1, 5, 10, 25];
  if (price <= 200) return [5, 10, 25, 50];
  if (price <= 300) return [10, 25, 50, 100];
  return [10, 50, 100, 200];
}

export function AuctionPanel({ game, me, skew }: { game: GameView; me: string; skew: number }) {
  const a = game.auction;
  const theme = resolveTheme(game.themeId, game.mapId);
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const [now, setNow] = useState(Date.now());
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  // The longest countdown seen in this auction: the timer bar's full width.
  const span = useRef<{ key: string; ms: number }>({ key: '', ms: 1 });
  useEffect(() => {
    if (!a) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [a]);
  if (!a) return null;
  const s = theme.spaces[a.space];
  const leader = game.players.find(p => p.id === a.highBidder);
  // Frozen at the pause while the game is paused.
  const leftMs = Math.max(0, a.endsAt - (game.paused ? game.paused.at : now + skew));
  const key = `${a.space}:${a.bank ? 'b' : ''}`;
  if (span.current.key !== key) span.current = { key, ms: Math.max(leftMs, 1) };
  else span.current.ms = Math.max(span.current.ms, leftMs);
  const frac = Math.min(1, leftMs / span.current.ms);
  const left = Math.ceil(leftMs / 1000);
  const inIt = a.bidders.includes(me);
  const seated = game.players.some(p => p.id === me && !p.bankrupt);
  const me_ = game.players.find(p => p.id === me);
  const canSpend = Math.max(0, (me_?.cash ?? 0) - debtOf(game, me));
  const winning = a.highBidder === me;
  const color = s.group ? theme.groupColors[s.group] : '#2a3142';

  const bid = (amount: number) => {
    if (busy) return;
    setBusy(true);
    act({ type: 'bid', amount }).catch(toastError).finally(() => setBusy(false));
  };
  const minBid = a.highBid + 1;
  const customN = Math.floor(Number(custom));

  return (
    <div className={`auction ${winning ? 'winning' : ''}`} role="region" aria-label={`Auction for ${s.name}`}>
      <div className={`auction-head ${inkOn(color) === '#fff' ? 'dark' : ''}`} style={{ background: color, color: inkOn(color) }}>
        <small>{a.bank ? '🏦 Bank auction' : '🔨 Auction'}</small>
        <b>{s.name}</b>
        {s.price !== undefined && <span className="auction-list">List price {cur(s.price)}</span>}
      </div>
      <div className={`auction-timer ${left <= 3 ? 'urgent' : ''}`} role="timer" aria-label={`${left} seconds left`}>
        <i style={{ width: `${frac * 100}%` }} />
        <span>{game.paused ? '⏸ paused' : `${left}s`}</span>
      </div>
      <div className="auction-body">
        <div className="auction-lead" key={`${a.highBid}:${a.highBidder}`}>
          {leader ? (
            <>
              <span className="token-badge" style={{ background: leader.color }}>{characterEmoji(leader.character)}</span>
              <div className="grow">
                <div className="small muted">{winning ? 'You lead!' : 'Top bid'}</div>
                <b className="auction-leader" style={{ color: winning ? undefined : leader.color }}>{winning ? 'You' : leader.name}</b>
              </div>
              <b className="big-num">{cur(a.highBid)}</b>
            </>
          ) : (
            <div className="grow auction-none">No bids yet — {inIt ? 'open the bidding!' : 'waiting…'}</div>
          )}
        </div>

        {inIt && !winning && (
          <>
            <div className="auction-quick">
              {bidSteps(s.price ?? 100).map(inc => {
                const amt = a.highBid + inc;
                return (
                  <button key={inc} className="btn small gold" disabled={busy || amt > canSpend} onClick={() => bid(amt)}
                    aria-label={`Bid ${cur(amt)}`}>
                    <span className="aq-inc">+{inc}</span><span className="aq-amt">{cur(amt)}</span>
                  </button>
                );
              })}
            </div>
            <form className="auction-custom" onSubmit={e => { e.preventDefault(); if (customN >= minBid) { bid(customN); setCustom(''); } }}>
              <input type="number" inputMode="numeric" min={minBid} max={canSpend} placeholder={`${cur(minBid)} or more`} value={custom}
                aria-label="Your bid" onChange={e => setCustom(e.target.value)} />
              <button className="btn small primary" type="submit" disabled={busy || !(customN >= minBid && customN <= canSpend)}>Bid</button>
            </form>
            <div className="row between auction-foot">
              <span className="small muted">You can spend {cur(canSpend)}</span>
              <button className="btn tiny danger" disabled={busy} onClick={() => act({ type: 'pass' }).catch(toastError)}>Drop out</button>
            </div>
          </>
        )}
        {winning && <div className="win-note">🏆 You're winning — hold tight!</div>}
        {seated && !inIt && <div className="small muted">You dropped out — watching the bidding.</div>}
        <div className="auction-bidders small">
          {a.bidders.map(id => {
            const p = game.players.find(x => x.id === id);
            return p ? <span key={id} className="auction-bidder" style={{ borderColor: p.color }} title={`${p.name} is still bidding`}>{characterEmoji(p.character)} {p.id === me ? 'You' : p.name}</span> : null;
          })}
        </div>
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
