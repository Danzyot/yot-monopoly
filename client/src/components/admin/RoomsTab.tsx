// Every live room, refreshed every few seconds: who is in it, their cash,
// and the levers — spectate, pause, fix the game, end, close, remove or ban a player.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.ts';
import { useAuth } from '../../auth.tsx';
import BanDialog, { type BanTarget } from './BanDialog.tsx';
import FixGamePanel from './FixGamePanel.tsx';
import { act, ago, del, post, usePoll, type AdminRoom } from './adminApi.ts';

export default function RoomsTab() {
  const { data, error, reload } = usePoll<AdminRoom[]>('/api/admin/rooms', 4_000);
  const [filter, setFilter] = useState<'all' | AdminRoom['status']>('all');
  const [ban, setBan] = useState<BanTarget | null>(null);

  if (error && !data) return <p className="warn">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const rooms = data.filter(r => filter === 'all' || r.status === filter);
  const count = (s: AdminRoom['status']) => data.filter(r => r.status === s).length;

  return (
    <div className="adm-stack">
      <div className="row wrap between">
        <div className="adm-seg">
          {(['all', 'lobby', 'playing', 'finished'] as const).map(f => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} <small className="muted">{f === 'all' ? data.length : count(f)}</small>
            </button>
          ))}
        </div>
        <span className="muted small">Refreshes every 4 seconds.</span>
      </div>
      {rooms.length === 0 && <p className="muted">No {filter === 'all' ? '' : `${filter} `}rooms right now.</p>}
      <div className="adm-grid">
        {rooms.map(r => <RoomCard key={r.code} room={r} reload={reload} onBan={setBan} />)}
      </div>
      {ban && <BanDialog target={ban} onClose={() => setBan(null)} onDone={reload} />}
    </div>
  );
}

function RoomCard({ room: r, reload, onBan }: { room: AdminRoom; reload: () => unknown; onBan: (t: BanTarget) => void }) {
  const me = useAuth().profile?.id;
  const [ending, setEnding] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [reason, setReason] = useState('');
  const base = `/api/admin/rooms/${r.code}`;

  const end = async () => {
    if (await act(() => post(`${base}/end`, { reason }), { ok: `Ended ${r.code}`, after: reload })) {
      setEnding(false);
      setReason('');
    }
  };

  return (
    <div className="adm-card">
      <div className="row between wrap">
        <div className="row">
          <b className="mono accent adm-code">{r.code}</b>
          <span className={`adm-status ${r.status}`}>{r.status}</span>
          {r.private && <em className="tag">private</em>}
          {r.paused && <em className="tag warn" title={`Paused by ${r.paused.by}`}>paused</em>}
        </div>
        <div className="row">
          <Link className="btn tiny" to={`/r/${r.code}?watch=1`} title="Watch without taking a seat">Spectate</Link>
          <Link className="btn tiny ghost" to={`/r/${r.code}`} title="Open the room (takes a free lobby seat)">Open</Link>
        </div>
      </div>
      <div className="small muted">
        {r.map} · {r.edition} · host <b>{r.hostName}</b>
        {r.status !== 'lobby' && <> · turn {r.turn}</>}
        {' '}· created {ago(r.createdAt)}
        {r.spectators > 0 && <> · 👁 {r.spectators}</>}
      </div>

      <ul className="adm-seats">
        {r.seats.map(s => (
          <li key={s.id} className={s.bankrupt ? 'out' : ''}>
            <i className="adm-dot" style={{ background: s.color }} />
            <span className={`adm-conn ${s.connected ? 'on' : ''}`} title={s.connected ? 'connected' : 'disconnected'} />
            <span className="grow adm-ellipsis">
              {s.name}
              {s.id === r.hostId && <em className="tag">host</em>}
              {s.isBot && <em className="tag">bot</em>}
              {s.bankrupt && <em className="tag warn">bankrupt</em>}
              {!s.bankrupt && s.afk && <em className="tag warn">autopilot</em>}
            </span>
            {s.cash !== null && <span className="small cash">{s.cash.toLocaleString()}</span>}
            {/* Kept together so, when the card is narrow, the buttons wrap as one group. */}
            {!s.isBot && s.id !== me && (
              <span className="adm-seat-actions">
                {!s.bankrupt && r.status !== 'finished' && (
                  <button className="btn tiny ghost" title="Remove from this room (forfeits a running game)"
                    onClick={() => act(() => post(`${base}/kick`, { id: s.id }), {
                      confirm: `Remove ${s.name} from ${r.code}?${r.status === 'playing' ? ' They forfeit the game.' : ''}`,
                      ok: `Removed ${s.name}`, after: reload,
                    })}>Remove</button>
                )}
                <button className="btn tiny ghost" title={`Ban from room ${r.code}`}
                  onClick={() => onBan({ kind: 'player', value: s.id, accountId: s.id, name: s.name, scope: 'room', gameId: r.code })}>Ban here</button>
                <button className="btn tiny ghost adm-danger-text" title="Ban from the whole site"
                  onClick={() => void openSiteBan(s.id, s.name, onBan)}>Ban site</button>
              </span>
            )}
          </li>
        ))}
        {r.seats.length === 0 && <li className="muted small">Nobody seated.</li>}
      </ul>

      {fixing && r.status === 'playing' && <FixGamePanel code={r.code} onClose={() => setFixing(false)} onChanged={reload} />}

      {ending ? (
        <form className="row" onSubmit={e => { e.preventDefault(); void end(); }}>
          <input autoFocus value={reason} maxLength={200} placeholder="Reason (shown in the room log)" onChange={e => setReason(e.target.value)} />
          <button className="btn small danger" type="submit">End game</button>
          <button className="btn small ghost" type="button" onClick={() => setEnding(false)}>Cancel</button>
        </form>
      ) : (
        <div className="row wrap">
          {r.status === 'playing' && (
            <button className="btn small" onClick={() => act(() => post(`${base}/pause`, { paused: !r.paused }), {
              confirm: r.paused ? `Resume the game in ${r.code}?` : `Pause the game in ${r.code}? Every clock stops until it is resumed.`,
              ok: r.paused ? `Resumed ${r.code}` : `Paused ${r.code}`, after: reload,
            })}>{r.paused ? '▶️ Resume' : '⏸️ Pause'}</button>
          )}
          {r.status === 'playing' && <button className="btn small" onClick={() => setFixing(f => !f)}>🛠 Fix game…</button>}
          {r.status !== 'finished' && <button className="btn small" onClick={() => setEnding(true)}>End…</button>}
          <button className="btn small ghost adm-danger-text"
            onClick={() => act(() => del(base), {
              confirm: `Close room ${r.code}? Any game in it stops and the room is removed.`,
              ok: `Closed ${r.code}`, after: reload,
            })}>Close room</button>
          <Link className="btn small ghost" to={`/admin/logs?room=${r.code}`}>Log</Link>
        </div>
      )}
    </div>
  );
}

/** Site bans get the account's known addresses too, so the dialog can switch to an IP ban. */
async function openSiteBan(id: string, name: string, onBan: (t: BanTarget) => void) {
  let ips: string[] = [];
  try {
    const d = await api<{ account: { ips: Record<string, unknown> } }>(`/api/admin/accounts/${encodeURIComponent(id)}`);
    ips = Object.keys(d.account.ips);
  } catch { /* never connected with an address on record: account ban only */ }
  onBan({ kind: 'player', value: id, accountId: id, name, scope: 'lifetime', ips });
}
