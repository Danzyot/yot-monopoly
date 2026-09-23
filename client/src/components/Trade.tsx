import { useState } from 'react';
import { getTheme } from '../../../shared/themes.ts';
import type { GameView, PlayerState, Trade, TradeSide } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';

const EMPTY: TradeSide = { cash: 0, spaces: [], jailCards: 0 };

function SidePicker({ game, who, side, onChange, title }: {
  game: GameView; who: PlayerState; side: TradeSide; onChange: (s: TradeSide) => void; title: string;
}) {
  const theme = getTheme(game.themeId);
  const props = Object.entries(game.owned)
    .filter(([, o]) => o.owner === who.id)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  const toggle = (i: number) =>
    onChange({ ...side, spaces: side.spaces.includes(i) ? side.spaces.filter(x => x !== i) : [...side.spaces, i] });
  return (
    <div className="trade-side">
      <h4 style={{ color: who.color }}>{title}</h4>
      <label className="field">
        <span>Cash (has {theme.currency}{who.cash})</span>
        <input type="number" min={0} max={who.cash} step={10} value={side.cash || ''}
          onChange={e => onChange({ ...side, cash: Math.max(0, Math.min(who.cash, Math.round(Number(e.target.value) || 0))) })} />
      </label>
      {who.jailCards.length > 0 && (
        <label className="field">
          <span>Get Out of Jail Free cards</span>
          <input type="number" min={0} max={who.jailCards.length} value={side.jailCards}
            onChange={e => onChange({ ...side, jailCards: Math.max(0, Math.min(who.jailCards.length, Number(e.target.value) || 0)) })} />
        </label>
      )}
      <div className="chips">
        {props.length === 0 && <span className="muted small">No properties</span>}
        {props.map(i => {
          const s = theme.spaces[i];
          const o = game.owned[i];
          return (
            <button key={i} className={`chip ${side.spaces.includes(i) ? 'on' : ''}`}
              disabled={o.houses > 0} title={o.houses > 0 ? 'Sell buildings first' : ''}
              onClick={() => toggle(i)}>
              <i style={{ background: s.group ? theme.groupColors[s.group] : '#999' }} />
              {s.name}{o.mortgaged ? ' (m)' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TradeModal({ game, me, withId, onClose }: {
  game: GameView; me: string; withId: string; onClose: () => void;
}) {
  const mine = game.players.find(p => p.id === me)!;
  const them = game.players.find(p => p.id === withId)!;
  const [give, setGive] = useState<TradeSide>(EMPTY);
  const [get, setGet] = useState<TradeSide>(EMPTY);
  const send = () =>
    act({ type: 'proposeTrade', to: withId, give, get }).then(onClose).catch(toastError);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="row between"><h3>Trade with <span style={{ color: them.color }}>{them.name}</span></h3><button className="btn tiny ghost" onClick={onClose}>✕</button></div>
        <div className="trade-cols">
          <SidePicker game={game} who={mine} side={give} onChange={setGive} title="You give" />
          <div className="trade-arrow">⇄</div>
          <SidePicker game={game} who={them} side={get} onChange={setGet} title="You get" />
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={send}>Send offer</button>
        </div>
      </div>
    </div>
  );
}

function describe(game: GameView, s: TradeSide): string {
  const theme = getTheme(game.themeId);
  const parts = [
    ...(s.cash ? [`${theme.currency}${s.cash}`] : []),
    ...s.spaces.map(i => theme.spaces[i].name),
    ...(s.jailCards ? [`${s.jailCards}× jail card`] : []),
  ];
  return parts.length ? parts.join(', ') : 'nothing';
}

export function TradeOffers({ game, me }: { game: GameView; me: string }) {
  const name = (id: string) => game.players.find(p => p.id === id);
  const relevant = game.trades.filter(t => t.to === me || t.from === me);
  if (!relevant.length) return null;
  return (
    <div className="offers">
      {relevant.map((t: Trade) => {
        const from = name(t.from)!, to = name(t.to)!;
        const incoming = t.to === me;
        return (
          <div key={t.id} className="offer">
            <div className="small">
              {incoming
                ? <><b style={{ color: from.color }}>{from.name}</b> offers you</>
                : <>You offered <b style={{ color: to.color }}>{to.name}</b></>}
            </div>
            <div className="offer-line"><span className="muted">{incoming ? 'You get' : 'You give'}:</span> {describe(game, t.give)}</div>
            <div className="offer-line"><span className="muted">{incoming ? 'You give' : 'You get'}:</span> {describe(game, t.get)}</div>
            <div className="row end">
              {incoming ? (
                <>
                  <button className="btn small ghost" onClick={() => act({ type: 'rejectTrade', id: t.id }).catch(toastError)}>Decline</button>
                  <button className="btn small primary" onClick={() => act({ type: 'acceptTrade', id: t.id }).catch(toastError)}>Accept</button>
                </>
              ) : (
                <button className="btn small ghost" onClick={() => act({ type: 'rejectTrade', id: t.id }).catch(toastError)}>Withdraw</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
