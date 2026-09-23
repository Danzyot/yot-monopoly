// Host controls for a table in progress: put the last turn back, and correct
// stacks. Both exist for the same reason — when a cheat is caught mid-game,
// the damage has to be undoable without tearing the whole event down.
//
// They live behind a modal rather than on the felt: these are rare, deliberate
// actions, and a button that moves chips has no business next to Fold.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { TableView } from '../../../shared/types';
import Avatar from './Avatar';
import { api } from '../api';
import { useAuth } from '../auth';
import { getSocket } from '../socket';
import { useToast } from '../toast';
import BanDialog, { type BanTarget } from './BanDialog';
import { discordIdOf } from './CopyId';

export default function HostTools({ view, onClose }: { view: TableView; onClose: () => void }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [banning, setBanning] = useState<string | null>(null);
  // The ban being confirmed, if any — the dialog carries the reason picker.
  const [pending, setPending] = useState<
    (BanTarget & { playerId: string }) | null
  >(null);
  // Draft stacks, keyed by seat, so a half-typed number never gets sent.
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const reverse = () => {
    getSocket().emit('table:reverseTurn', view.id);
  };

  const commit = (seatIdx: number, playerId: string) => {
    const raw = drafts[seatIdx];
    if (raw === undefined || raw.trim() === '') return;
    const stack = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(stack)) return;
    getSocket().emit('table:setStack', { tableId: view.id, playerId, stack });
    setDrafts(d => { const n = { ...d }; delete n[seatIdx]; return n; });
  };

  const seated = view.seats.filter(s => s.player);

  // A game ban is aimed at the event where that makes sense: for a
  // tournament table it is the tournament, so a banned player cannot simply
  // be moved to another table of the same event.
  const gameId = view.tournamentId ?? view.id;
  const gameLabel = view.tournamentId ? 'this tournament' : 'this table';

  const confirmBan = async (reason: string, discordBan = false) => {
    if (!pending) return;
    const { playerId, name, kind, scope } = pending;
    setPending(null);
    setBanning(playerId);
    try {
      const r = await api.ban({
        kind, scope,
        gameId: scope === 'game' ? gameId : null,
        ...(kind === 'ip' ? { playerId } : { value: playerId }),
        name, reason, discordBan,
      });
      const base = `${name} suspended ${scope === 'game' ? `from ${gameLabel}` : 'for life'}`;
      // A Discord ban that quietly did not happen is worse than one never
      // attempted — the operator would believe they were gone.
      const failed = !!r.discordNote && /NOT on Discord/.test(r.discordNote);
      toast(failed ? 'error' : 'success', r.discordNote ? `${base}. ${r.discordNote}` : base);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not ban');
    } finally {
      setBanning(null);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <h3>Host tools — {view.name}</h3>

        <div className="host-section">
          <div className="host-section-head">Reverse the last turn</div>
          <p className="tag">
            Puts this table back to just before the last action — the same player is
            on the clock again, with their chips, the pot and the deck exactly as
            they were. It only reaches back within the hand in progress, and
            everyone at the table is told it happened.
          </p>
          <button className="btn btn-primary" disabled={!view.canReverseTurn} onClick={reverse}>
            Reverse last turn
          </button>
          {!view.canReverseTurn && (
            <span className="tag" style={{ marginLeft: 10 }}>
              Nothing to reverse — no action has been taken in this hand yet.
            </span>
          )}
        </div>

        <div className="host-section">
          <div className="host-section-head">Adjust stacks</div>
          <p className="tag">
            For putting chips back where they belong after a cheat is dealt with.
            Every change is written to the session log and announced at the table.
            A player in a live hand cannot be adjusted — reverse the turn or let
            the hand finish first.
          </p>
          {seated.length === 0 && <p className="tag">Nobody is seated.</p>}
          {seated.map(s => (
            <div key={s.idx} className="host-stack-row">
              <Avatar value={s.player!.avatar} size={18} />
              <span className="hs-name">{s.player!.name}</span>
              <span className="hs-now">{s.stack.toLocaleString()}</span>
              <input
                type="number" min={0} inputMode="numeric"
                placeholder="new stack"
                value={drafts[s.idx] ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [s.idx]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') commit(s.idx, s.player!.id); }}
              />
              <button
                className="btn btn-sm"
                disabled={(drafts[s.idx] ?? '').trim() === ''}
                onClick={() => commit(s.idx, s.player!.id)}
              >
                Set
              </button>
            </div>
          ))}
        </div>

        {profile?.isAdmin && (
          <div className="host-section">
            <div className="host-section-head">Ban a player</div>
            <p className="tag">
              A game ban costs them {gameLabel} — including coming back through
              late registration — and nothing else. A lifetime ban keeps them off
              the site. Either way they are removed from the game right now.
            </p>
            {seated.map(s => (
              <div key={s.idx} className="host-ban-row">
                <Avatar value={s.player!.avatar} size={18} />
                <span className="hs-name">{s.player!.name}</span>
                <div className="host-ban-btns">
                  <button className="btn btn-sm" disabled={banning === s.player!.id}
                    onClick={() => setPending({
                      playerId: s.player!.id, name: s.player!.name, kind: 'player', scope: 'game',
                      discordLinked: !!discordIdOf(s.player!.id),
                    })}>Ban</button>
                  <button className="btn btn-sm" disabled={banning === s.player!.id}
                    onClick={() => setPending({ playerId: s.player!.id, name: s.player!.name, kind: 'ip', scope: 'game' })}>Ban IP</button>
                  <button className="btn btn-sm btn-danger" disabled={banning === s.player!.id}
                    onClick={() => setPending({
                      playerId: s.player!.id, name: s.player!.name, kind: 'player', scope: 'lifetime',
                      discordLinked: !!discordIdOf(s.player!.id),
                    })}>Lifetime</button>
                  <button className="btn btn-sm btn-danger" disabled={banning === s.player!.id}
                    onClick={() => setPending({ playerId: s.player!.id, name: s.player!.name, kind: 'ip', scope: 'lifetime' })}>Lifetime IP</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
      {pending && (
        <BanDialog
          target={pending}
          onConfirm={(r, d) => void confirmBan(r, d)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>,
    document.body,
  );
}
