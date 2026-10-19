// The director's override — seat anyone, right now, with any stack.
//
// Every other way into a tournament enforces a rule: late registration has to
// be open, the field cannot be over its cap, a busted player needs re-entries
// left. Those rules are right for players and wrong for the person running the
// event, who needs a way out when something has gone wrong that no rule
// anticipated — a player dropped by a bad deploy, a registration that never
// landed, a table that has to be kept playable. So this panel checks none of
// them, and it is host-only for exactly that reason.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Avatar from './Avatar';
import { getSocket } from '../socket';
import { useToast } from '../toast';

export interface SeatCandidate {
  id: string;
  name: string;
  avatar: string;
  // unseated: in the field, no chips in front of them (never joined, or
  // between tables). busted: out. playing: already sitting somewhere — listed
  // so the roster reads completely, but not selectable. new: a name the site
  // knows that is not in this tournament at all.
  status: 'unseated' | 'busted' | 'playing' | 'new';
  lastStack: number | null;
}

const LABEL: Record<SeatCandidate['status'], string> = {
  unseated: 'not seated',
  busted: 'out',
  playing: 'at a table',
  new: 'not entered',
};

export default function SeatPlayerPanel({
  tournamentId, startingStack,
}: { tournamentId: string; startingStack: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<SeatCandidate[] | null>(null);
  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [stack, setStack] = useState(String(startingStack));
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getSocket().emit('tourney:people', tournamentId, (rows: SeatCandidate[]) => {
      setPeople(Array.isArray(rows) ? rows : []);
    });
  }, [tournamentId]);

  // Refreshed on open rather than polled: the list only matters while the
  // panel is in front of someone, and it is the whole player directory.
  useEffect(() => { if (open) load(); }, [open, load]);

  const picked = useMemo(
    () => people?.find(p => p.id === pickedId) ?? null,
    [people, pickedId],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = (people ?? []).filter(p => p.status !== 'playing');
    if (!q) return pool.slice(0, 12);
    return pool.filter(p => p.name.toLowerCase().includes(q)).slice(0, 12);
  }, [people, query]);

  const choose = (p: SeatCandidate) => {
    setPickedId(p.id);
    setQuery(p.name);
    // What they were sitting behind when they went out is nearly always the
    // right answer, so it is filled in — still editable.
    setStack(String(p.lastStack ?? startingStack));
  };

  const submit = () => {
    if (!picked) { toast('error', 'Pick a player from the list first.'); return; }
    const n = Math.floor(Number(stack));
    if (!Number.isFinite(n) || n < 1) { toast('error', 'Give a chip count above zero.'); return; }
    setBusy(true);
    getSocket().emit('tourney:seatPlayer', {
      id: tournamentId, playerId: picked.id, name: picked.name,
      avatar: picked.avatar, stack: n,
    });
    // The server toasts the outcome; this just clears the form for the next one.
    window.setTimeout(() => {
      setBusy(false);
      setPickedId(null);
      setQuery('');
      setStack(String(startingStack));
      load();
    }, 400);
  };

  if (!open) {
    return (
      <div className="panel seat-in-panel">
        <h3>
          Director tools
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}>
            Seat a player
          </button>
        </h3>
        <div className="seat-in-hint">
          Put anyone at a table right now with a stack you choose — ignores late
          registration, the player cap and re-entry limits.
        </div>
      </div>
    );
  }

  return (
    <div className="panel seat-in-panel">
      <h3>
        Seat a player
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>
          Close
        </button>
      </h3>

      <input
        className="input" placeholder="Search a name…" value={query} autoFocus
        onChange={e => { setQuery(e.target.value); setPickedId(null); }}
      />

      {people === null ? (
        <div className="seat-in-hint">Loading players…</div>
      ) : matches.length === 0 ? (
        <div className="seat-in-hint">No one matches “{query.trim()}”.</div>
      ) : (
        <div className="seat-in-list">
          {matches.map(p => (
            <button
              key={p.id} type="button"
              className={`seat-in-row${p.id === pickedId ? ' picked' : ''}`}
              onClick={() => choose(p)}
            >
              <Avatar value={p.avatar} size={20} />
              <span className="seat-in-name">{p.name}</span>
              <span className={`seat-in-tag ${p.status}`}>{LABEL[p.status]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="seat-in-go">
        <label className="seat-in-stack">
          <span>Chips</span>
          <input
            className="input" type="number" min={1} value={stack}
            onChange={e => setStack(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" disabled={!picked || busy} onClick={submit}>
          {picked ? `Seat ${picked.name}` : 'Seat player'}
        </button>
      </div>

      {picked && (
        <div className="seat-in-hint">
          {picked.status === 'busted'
            ? `${picked.name} is out. Putting them back does not cost an entry and does not change the prize pool.`
            : picked.status === 'new'
              ? `${picked.name} is not in this tournament. They will be entered now — this counts as an entry and grows the prize pool.`
              : `${picked.name} is already in the field but has no seat. They keep the entry they already have.`}
        </div>
      )}
    </div>
  );
}
