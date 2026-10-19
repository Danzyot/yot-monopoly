import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import { chips, ordinal } from '../format';

export interface CashBustInfo {
  playerId: string;
  tableId: string;
  tableName: string;
  name: string;
  avatar: string;
  buyIn: number;
  net: number;
  rank: number;
  of: number;
  minBuy: number;
  maxBuy: number;
  secondsToRebuy: number;
}

// Running out of chips in a cash game is a decision, not an ending: this says
// where the session stands and offers the way back in. Without it a busted
// player simply sat at zero with no explanation, and the table — needing two
// players with chips — quietly stopped dealing.
export default function CashBustModal({ info, onRebuy, onClose }: {
  info: CashBustInfo;
  onRebuy: (amount: number) => void;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [amount, setAmount] = useState(Math.min(info.maxBuy, Math.max(info.minBuy, info.buyIn || info.minBuy)));
  const [left, setLeft] = useState(info.secondsToRebuy);

  // The seat is released when this runs out, so the count is the honest thing
  // to show rather than an open-ended dialog.
  useEffect(() => {
    const iv = setInterval(() => setLeft(v => Math.max(0, v - 1)), 1000);
    return () => clearInterval(iv);
  }, []);

  const won = info.net > 0;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal bust-modal" onClick={e => e.stopPropagation()}>
        <div className="bust-head">
          <Avatar value={info.avatar} size={40} />
          <div>
            <h3>Out of chips</h3>
            <p className="bust-sub">{info.tableName}</p>
          </div>
        </div>

        <div className="bust-figures">
          <div>
            <span className="bust-label">Session</span>
            <span className={`bust-net ${won ? 'pos' : 'neg'}`}>
              {won ? '+' : ''}{chips(info.net)}
            </span>
          </div>
          <div>
            <span className="bust-label">Bought in</span>
            <span className="bust-val">{chips(info.buyIn)}</span>
          </div>
          <div>
            <span className="bust-label">At this table</span>
            <span className="bust-val">{ordinal(info.rank)} of {info.of}</span>
          </div>
        </div>

        <p className="field-hint">
          {left > 0
            ? <>Your seat is held for <strong>{left}s</strong>. Buy back in to keep it, or leave and settle up.</>
            : <>Your seat has been released — you can still take an open one.</>}
        </p>

        <div className="field">
          <label>Buy back in for</label>
          <input
            className="input" type="number"
            min={info.minBuy} max={info.maxBuy} step={info.minBuy}
            value={amount}
            onChange={e => setAmount(Math.max(info.minBuy, Math.min(info.maxBuy, Math.floor(Number(e.target.value) || info.minBuy))))}
          />
          <p className="field-hint">
            Between {chips(info.minBuy)} and {chips(info.maxBuy)}.
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => { onClose(); nav('/'); }}>Leave table</button>
          <button className="btn btn-ghost" onClick={onClose}>Watch</button>
          <button className="btn btn-primary" onClick={() => { onRebuy(amount); onClose(); }}>
            Buy in for {chips(amount)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
