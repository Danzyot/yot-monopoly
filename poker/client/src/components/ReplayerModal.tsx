import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HandHistoryEntry } from '../../../shared/types';
import { chips } from '../format';
import { getSocket } from '../socket';
import Avatar from './Avatar';
import CardView from './CardView';
import { IconPause, IconPlay } from './icons';

export default function ReplayerModal({ tableId, onClose }: {
  tableId: string;
  onClose: () => void;
}) {
  const [hands, setHands] = useState<HandHistoryEntry[] | null>(null);
  const [handIdx, setHandIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let stale = false;
    // Ack-style fetch; hole cards arrive already redacted for this viewer.
    (getSocket() as unknown as {
      emit: (ev: string, id: string, cb: (h: HandHistoryEntry[]) => void) => void;
    }).emit('table:history', tableId, hs => {
      if (stale) return;
      setHands(hs);
      setHandIdx(Math.max(0, hs.length - 1));
      setStepIdx(0);
    });
    return () => { stale = true; };
  }, [tableId]);

  const hand = hands?.[handIdx] ?? null;
  const step = hand?.steps[Math.min(stepIdx, hand.steps.length - 1)] ?? null;
  const atEnd = !!hand && stepIdx >= hand.steps.length - 1;

  // Auto-advance while playing.
  useEffect(() => {
    if (!playing || !hand) return;
    if (atEnd) { setPlaying(false); return; }
    const t = setTimeout(() => setStepIdx(i => i + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, stepIdx, hand, atEnd]);

  const pickHand = (i: number) => { setHandIdx(i); setStepIdx(0); setPlaying(false); };

  const winnersBySeat = useMemo(
    () => new Map((hand?.winners ?? []).map(w => [w.seat, w])),
    [hand],
  );

  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide replayer" onClick={e => e.stopPropagation()}>
        <h3>Game Replayer</h3>
        {!hands && <div className="empty-note">Loading hands…</div>}
        {hands && hands.length === 0 && (
          <div className="empty-note">No hands recorded yet — play a hand first.</div>
        )}
        {hand && step && (
          <>
            <div className="replay-hands">
              {hands!.map((h, i) => (
                <button key={h.number} className={`replay-hand-chip${i === handIdx ? ' sel' : ''}`}
                  onClick={() => pickHand(i)}>
                  #{h.number}
                </button>
              ))}
            </div>
            <div className="replay-meta">
              <span>Hand #{hand.number}</span>
              <span>Blinds {hand.sb}/{hand.bb}{hand.ante ? ` (${hand.ante})` : ''}</span>
              <span>{time(hand.startedAt)}</span>
            </div>

            <div className="replay-board">
              {[0, 1, 2, 3, 4].map(i => step.board[i]
                ? <CardView key={i} card={step.board[i]} small />
                : <div key={i} className="slot" />)}
              <span className="replay-pot"><span className="chip-disc" />{chips(step.pot)}</span>
            </div>

            <div className="replay-players">
              {hand.players.map(p => {
                const s = step.seats.find(x => x.seat === p.seat);
                const hole = hand.holeCards.find(h => h.seat === p.seat)?.cards ?? null;
                const win = atEnd ? winnersBySeat.get(p.seat) : undefined;
                return (
                  <div key={p.seat}
                    className={`replay-player${s?.folded ? ' folded' : ''}${win ? ' winner' : ''}`}>
                    <Avatar value={p.avatar} size={20} />
                    <span className="rp-name">
                      {p.name}{p.seat === hand.buttonSeat ? ' Ⓓ' : ''}
                    </span>
                    <span className="rp-cards">
                      {(hole ?? [null, null]).map((c, i) => <CardView key={i} card={c} small />)}
                    </span>
                    <span className="rp-stack">{s ? chips(s.stack) : '—'}</span>
                    <span className="rp-bet">{s && s.bet > 0 ? `bet ${chips(s.bet)}` : s?.allIn ? 'all-in' : ''}</span>
                    {win && <span className="rp-win">+{chips(win.amount)}{win.handName ? ` · ${win.handName}` : ''}</span>}
                  </div>
                );
              })}
            </div>

            <div className="replay-step-text">{step.text}</div>

            <div className="replay-controls">
              <button className="btn btn-sm" disabled={handIdx === 0}
                onClick={() => pickHand(handIdx - 1)}>‹ Hand</button>
              <button className="btn btn-sm" disabled={stepIdx === 0}
                onClick={() => { setStepIdx(i => Math.max(0, i - 1)); setPlaying(false); }}>‹</button>
              <button className="btn btn-primary btn-sm" onClick={() => {
                if (atEnd) { setStepIdx(0); setPlaying(true); }
                else setPlaying(p => !p);
              }}>
                {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
              </button>
              <button className="btn btn-sm" disabled={atEnd}
                onClick={() => { setStepIdx(i => i + 1); setPlaying(false); }}>›</button>
              <button className="btn btn-sm" disabled={handIdx >= hands!.length - 1}
                onClick={() => pickHand(handIdx + 1)}>Hand ›</button>
              <span className="replay-progress">{Math.min(stepIdx + 1, hand.steps.length)}/{hand.steps.length}</span>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
