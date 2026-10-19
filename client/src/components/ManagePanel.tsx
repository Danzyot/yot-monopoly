// Build & manage: every deed you own, grouped into colour sets, with + / −
// buttons for houses, a mortgage switch on each deed and what each change does
// to your cash and your rent. The same panel opens as "Raise cash" when you
// owe more than you hold, with how much is still missing. The rules (even
// building, the bank's stock, mortgages) come from shared/holdings.ts, the
// very checks the engine runs, so a live button is a move the server accepts.
import { useState } from 'react';
import { groupIndices, mortgageValue } from '../../../shared/board.ts';
import {
  buildProblem, liftCost, manageProblem, mortgageProblem, sellProblem, unmortgageProblem,
} from '../../../shared/holdings.ts';
import { resolveTheme } from '../../../shared/themes.ts';
import type { Action, GameView } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';
import { debtOf, groupLabel, ownedBy, ownsSet, propertyRent, raisable, setKey } from '../gameHelpers.ts';
import { CloseX, Modal } from './Modal.tsx';

export type ManageMode = 'build' | 'raise';

export default function ManagePanel({ game, me, mode, onClose, onPick }: {
  game: GameView; me: string; mode: ManageMode; onClose: () => void;
  /** Show a deed card (tapping a name). */
  onPick?: (space: number) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const spaces = theme.spaces;
  const cur = (n: number) => `${theme.currency}${n.toLocaleString()}`;
  const p = game.players.find(x => x.id === me);
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const cash = p.cash;
  const owe = debtOf(game, me);
  const raising = mode === 'raise' || owe > 0;
  const blocked = game.paused ? 'The game is paused' : game.phase === 'auction' ? 'Wait for the auction to finish'
    : game.phase === 'minigame' ? 'Wait for the mini-game to finish' : game.phase === 'over' ? 'The game is over' : null;

  const run = async (actions: Action[]) => {
    if (busy) return;
    setBusy(true);
    try {
      for (const a of actions) await act(a);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  // Group my deeds: colour sets in board order, then railroads, utilities.
  const mine = ownedBy(game, me);
  const groups: { key: string; spaces: number[] }[] = [];
  for (const i of mine) {
    const k = setKey(spaces[i]);
    const g = groups.find(x => x.key === k);
    if (g) g.spaces.push(i); else groups.push({ key: k, spaces: [i] });
  }
  const rank = (k: string) => (k === 'railroad' ? 1 : k === 'utility' ? 2 : 0);
  groups.sort((a, b) => rank(a.key) - rank(b.key));

  const need = Math.max(0, owe - cash);
  // Raising cash to buy the deed I'm standing on (no debt involved).
  const buyTarget = raising && owe === 0 && game.phase === 'buy' && game.current === me ? spaces[p.position] : null;
  const buyPrice = buyTarget?.price ?? 0;
  const max = raisable(game, spaces, me);
  const title = raising ? 'Raise cash' : 'Build & manage';

  return (
    <Modal onClose={onClose} labelledBy="manage-title" className="wide manage">
      <div className="manage-head">
        <h2 id="manage-title">{raising ? '💸' : '🏠'} {title}</h2>
        <CloseX onClick={onClose} />
      </div>

      <div className="manage-cash">
        <span className="manage-cash-now"><span className="muted">Cash</span> <b className="cash">{cur(cash)}</b></span>
        {game.rules.limitedBuildings && <span className="pill" title="Houses and hotels left in the bank">🏠 {game.housesLeft} · 🏨 {game.hotelsLeft}</span>}
      </div>

      {owe > 0 && (
        <div className={`manage-debt ${need === 0 ? 'ok' : ''}`} role="status">
          <div className="row between">
            <span>You owe <b>{cur(owe)}</b>{need > 0 ? <> · need <b>{cur(need)}</b> more</> : <> · you have enough!</>}</span>
            <button className="btn small primary" disabled={busy || need > 0} onClick={() => run([{ type: 'payDebt' }])}>Pay {cur(owe)}</button>
          </div>
          <div className="meter" aria-hidden><i style={{ width: `${Math.min(100, (cash / owe) * 100)}%` }} /></div>
          {max < owe && (
            <p className="small manage-warn">Even selling everything raises only {cur(max)}. You can keep trying a trade, or give up.</p>
          )}
          {need > 0 && max >= owe && <p className="small muted manage-tip">Sell houses first (half their cost back), then mortgage deeds (half their price).</p>}
        </div>
      )}

      {buyTarget && (
        <div className={`manage-debt goal ${cash >= buyPrice ? 'ok' : ''}`} role="status">
          <div className="row between">
            <span>To buy <b>{buyTarget.name}</b>: <b>{cur(buyPrice)}</b>{cash < buyPrice ? <> · need <b>{cur(buyPrice - cash)}</b> more</> : <> · you have enough!</>}</span>
            {cash >= buyPrice && <button className="btn small primary" disabled={busy} onClick={() => run([{ type: 'buy' }]).then(onClose)}>Buy it</button>}
          </div>
          <div className="meter" aria-hidden><i style={{ width: `${Math.min(100, (cash / Math.max(1, buyPrice)) * 100)}%` }} /></div>
        </div>
      )}

      {blocked && <p className="manage-blocked">⏳ {blocked}</p>}

      {groups.length === 0 && (
        <div className="manage-empty">
          <span aria-hidden>🏘️</span>
          <p>You don't own any property yet. Land on a free one and buy it!</p>
        </div>
      )}

      <div className="manage-groups">
        {groups.map(g => {
          const isProps = g.key !== 'railroad' && g.key !== 'utility';
          const full = isProps && ownsSet(game, spaces, me, g.key);
          const all = isProps ? groupIndices(spaces, g.key) : g.spaces;
          const color = theme.groupColors[g.key] ?? (g.key === 'railroad' ? '#30343c' : '#9aa3b2');
          const missing = isProps ? all.filter(i => game.owned[i]?.owner !== me) : [];
          // "Build a round": one house on each lowest deed, cheapest first (even-build order).
          const low = full ? Math.min(...all.map(i => game.owned[i].houses)) : 0;
          const roundSpaces = full ? all.filter(i => game.owned[i].houses === low) : [];
          const roundCost = roundSpaces.reduce((a, i) => a + (spaces[i].houseCost ?? 0), 0);
          const roundOk = full && !raising && !blocked && low < 5 && roundSpaces.length > 1
            && !buildProblem(game, spaces, me, roundSpaces[0], cash) && cash >= roundCost
            && (!game.rules.limitedBuildings || (low < 4 ? game.housesLeft >= roundSpaces.length : game.hotelsLeft >= roundSpaces.length));
          return (
            <section key={g.key} className={`bp-set ${full ? 'full' : ''}`} style={{ ['--set' as string]: color }}>
              <header className="bp-set-head">
                <i className="bp-swatch" />
                <b className="grow">{groupLabel(g.key)}</b>
                {isProps && (full
                  ? <span className="bp-badge">✓ Full set</span>
                  : <span className="small muted">{all.length - missing.length}/{all.length}</span>)}
              </header>
              {isProps && !full && (
                <p className="small muted bp-note">
                  Own all {all.length} to build. Missing: {missing.map(i => {
                    const owner = game.players.find(x => x.id === game.owned[i]?.owner);
                    return `${spaces[i].name}${owner ? ` (${owner.name})` : ''}`;
                  }).join(', ')}
                </p>
              )}
              {roundOk && (
                <button className="btn small gold bp-round" disabled={busy}
                  onClick={() => run(roundSpaces.map(i => ({ type: 'build', space: i }) as Action))}>
                  {low === 4 ? `🏨 Hotels on all · ${cur(roundCost)}` : `🏠 +1 house on each · ${cur(roundCost)}`}
                </button>
              )}
              <ul className="bp-deeds">
                {g.spaces.map(i => (
                  <DeedRow key={i} game={game} me={me} i={i} busy={busy || !!blocked}
                    full={full && (!raising || all.some(j => game.owned[j].houses > 0))} raising={raising}
                    cur={cur} run={run} onPick={onPick} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {!raising && game.rules.evenBuild && groups.some(g => ownsSet(game, spaces, me, g.key)) && (
        <p className="small muted manage-foot">Even building: each deed in a set must have a house before any gets a second.</p>
      )}
    </Modal>
  );
}

function DeedRow({ game, me, i, full, raising, busy, cur, run, onPick }: {
  game: GameView; me: string; i: number; full: boolean; raising: boolean; busy: boolean;
  cur: (n: number) => string; run: (a: Action[]) => void; onPick?: (i: number) => void;
}) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const spaces = theme.spaces;
  const s = spaces[i];
  const o = game.owned[i];
  const cash = game.players.find(x => x.id === me)?.cash ?? 0;
  const base = manageProblem(game, me, i);
  const why = {
    build: base ?? buildProblem(game, spaces, me, i, cash),
    sell: base ?? sellProblem(game, spaces, i),
    mortgage: base ?? mortgageProblem(game, spaces, i),
    unmortgage: base ?? unmortgageProblem(game, spaces, i, cash),
  };
  const isProp = s.kind === 'property';
  const rentNow = isProp ? propertyRent(game, spaces, i) : null;
  const rentNext = isProp && o.houses < 5 ? s.rent![o.houses + 1] : null;
  const half = Math.floor((s.houseCost ?? 0) / 2);
  // Hint for a blocked + on a full set: the rule says why (build evenly, bank empty, cash).
  const buildNote = isProp && full && !o.mortgaged && why.build && o.houses < 5 && !raising ? why.build : null;
  // Why − is off on a deed that has buildings (sell evenly), shown under the
  // name: touch screens never show the button's tooltip. An empty lot needs no note.
  const sellNote = isProp && full && o.houses > 0 && why.sell && !base ? why.sell : null;
  // The mortgage button's own reason, shown right under it when it is disabled.
  const mortWhy = raising && o.mortgaged ? null : o.mortgaged ? why.unmortgage : why.mortgage;

  return (
    <li className={`bp-deed ${o.mortgaged ? 'mortgaged' : ''}`}>
      <div className="bp-deed-main">
        <button className="bp-name" onClick={() => onPick?.(i)} title="Show the deed card">{s.name}</button>
        <div className="bp-sub small">
          {o.mortgaged ? <span className="tag warn">mortgaged</span>
            : isProp ? <>Rent <b>{cur(rentNow!)}</b>{full && rentNext !== null && !raising && <span className="muted"> → {cur(rentNext)}</span>}</>
              : <span className="muted">{s.kind === 'railroad' ? 'Railroad' : 'Utility'}</span>}
        </div>
        {buildNote && <div className="bp-why small">{buildNote}</div>}
        {sellNote && sellNote !== buildNote && <div id={`bp-sell-why-${i}`} className="bp-why small">{sellNote}</div>}
      </div>
      {isProp && full && (
        <div className="bp-build" role="group" aria-label={`Buildings on ${s.name}`}>
          <button className="btn tiny ghost bp-step" disabled={busy || !!why.sell} title={why.sell ?? `Sell one for ${cur(half)}`}
            aria-describedby={sellNote ? `bp-sell-why-${i}` : undefined} aria-label={`Sell a building on ${s.name} for ${cur(half)}`} onClick={() => run([{ type: 'sell', space: i }])}>−</button>
          <Pips houses={o.houses} />
          {!raising && (
            <button className="btn tiny primary bp-step" disabled={busy || !!why.build} title={why.build ?? `Build for ${cur(s.houseCost!)}`}
              aria-label={`${o.houses === 4 ? 'Build a hotel' : 'Build a house'} on ${s.name} for ${cur(s.houseCost!)}`}
              onClick={() => run([{ type: 'build', space: i }])}>+</button>
          )}
          <span className="bp-cost small">{raising ? `+${cur(half)}` : o.houses >= 5 ? 'max' : cur(s.houseCost!)}</span>
        </div>
      )}
      <div className="bp-mort">
        {o.mortgaged ? raising ? null : (
          <button className={`btn tiny ${mortWhy ? 'is-off' : ''}`} disabled={busy || !!why.unmortgage} title={why.unmortgage ?? undefined}
            aria-describedby={mortWhy ? `bp-why-${i}` : undefined}
            onClick={() => run([{ type: 'unmortgage', space: i }])}>Unmortgage −{cur(liftCost(spaces, i, o))}</button>
        ) : (
          <button className={`btn tiny ${raising ? 'gold' : 'ghost'} ${mortWhy ? 'is-off' : ''}`} disabled={busy || !!why.mortgage} title={why.mortgage ?? undefined}
            aria-describedby={mortWhy ? `bp-why-${i}` : undefined}
            onClick={() => run([{ type: 'mortgage', space: i }])}>Mortgage +{cur(mortgageValue(s))}</button>
        )}
        {mortWhy && <span id={`bp-why-${i}`} className="bp-off-why small">{mortWhy}</span>}
      </div>
    </li>
  );
}

/** Four house slots and a hotel, filled to the level built. */
function Pips({ houses }: { houses: number }) {
  if (houses === 5) return <span className="bp-pips" aria-label="Hotel"><i className="hotel">🏨</i></span>;
  return (
    <span className="bp-pips" aria-label={`${houses} house${houses === 1 ? '' : 's'}`}>
      {[0, 1, 2, 3].map(k => <i key={k} className={k < houses ? 'on' : ''} />)}
    </span>
  );
}
