// Every live room, refreshed every few seconds: map, edition, phase, who is
// in it and their cash, and the levers — spectate, pause, fix the game, end,
// close, remove or ban a player. Every destructive action confirms in-style.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.ts';
import { useAuth } from '../../auth.tsx';
import { askConfirm, askText } from '../Modal.tsx';
import BanDialog, { type BanTarget } from './BanDialog.tsx';
import FixGamePanel from './FixGamePanel.tsx';
import { CopyId, MapThumb, Refresh, RelTime } from './bits.tsx';
import { act, del, post, useDebounced, usePoll, type AdminRoom } from './adminApi.ts';

const EVERY = 4_000;

const PHASE: Record<string, string> = {
  roll: 'waiting to roll', buy: 'buy or auction', auction: 'auction', minigame: 'mini-game',
  done: 'managing, then end turn', choose: 'choosing a move', over: 'over',
};

export default function RoomsTab() {
  const { data, error, reload, at, loading } = usePoll<AdminRoom[]>('/api/admin/rooms', EVERY);
  const [filter, setFilter] = useState<'all' | AdminRoom['status']>('all');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const needle = useDebounced(q.trim().toLowerCase());
  const [ban, setBan] = useState<BanTarget | null>(null);

  if (error && !data) return <p className="warn" role="alert">{error}</p>;
  if (!data) return <div className="adm-grid" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="sk sk-hero" />)}</div>;
  const rooms = data.filter(r => (filter === 'all' || r.status === filter)
    && (!needle || [r.code, r.hostName, r.map, r.edition, r.mapId].some(s => s.toLowerCase().includes(needle))));
  const count = (s: AdminRoom['status']) => data.filter(r => r.status === s).length;
  const search = (v: string) => {
    setQ(v);
    setParams(p => { const n = new URLSearchParams(p); if (v) n.set('q', v); else n.delete('q'); return n; }, { replace: true });
  };

  return (
    <div className="adm-stack">
      <div className="row between wrap">
        <h2 className="adm-h2">Rooms <span className="lb-count">{data.length}</span></h2>
        <Refresh at={at} every={EVERY} loading={loading} />
      </div>
      <div className="row wrap between adm-toolbar">
        <div className="adm-seg" role="group" aria-label="Filter by status">
          {(['all', 'lobby', 'playing', 'finished'] as const).map(f => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} <small className="muted">{f === 'all' ? data.length : count(f)}</small>
            </button>
          ))}
        </div>
        <label className="adm-search grow">
          <span className="sr-only">Search rooms by code, host or map</span>
          <input type="search" value={q} placeholder="Search code, host, map or edition…" onChange={e => search(e.target.value)} />
          {needle && <span className="muted small nowrap">{rooms.length} match{rooms.length === 1 ? '' : 'es'}</span>}
        </label>
      </div>
      {rooms.length === 0 && <p className="muted adm-hint">{needle ? 'No room matches.' : `No ${filter === 'all' ? '' : `${filter} `}rooms right now.`}</p>}
      <div className="adm-grid">
        {rooms.map(r => <RoomCard key={r.code} room={r} reload={reload} onBan={setBan} />)}
      </div>
      {ban && <BanDialog target={ban} onClose={() => setBan(null)} onDone={reload} />}
    </div>
  );
}

function RoomCard({ room: r, reload, onBan }: { room: AdminRoom; reload: () => unknown; onBan: (t: BanTarget) => void }) {
  const me = useAuth().profile?.id;
  const [fixing, setFixing] = useState(false);
  const [more, setMore] = useState(false);
  const base = `/api/admin/rooms/${r.code}`;
  const humans = r.seats.filter(s => !s.isBot).length;
  const stuck = r.status === 'playing' && r.debts > 0 && r.debtDeadline !== null && Date.now() - r.debtDeadline > 5 * 60_000;

  const end = async () => {
    const reason = await askText({
      title: `End the game in ${r.code}?`,
      body: 'The game stops where it stands and the room shows its result screen. The reason is written to the room log.',
      placeholder: 'Reason (shown in the room log)', confirm: 'End game', maxLength: 200,
    });
    if (reason === null) return;
    await act(() => post(`${base}/end`, { reason }), { ok: `Ended ${r.code}`, after: reload });
  };

  const close = async () => {
    if (!(await askConfirm({ title: `Close room ${r.code}?`, body: 'Any game in it stops and the room is removed for everyone.', confirm: 'Close room', danger: true }))) return;
    await act(() => del(base), { ok: `Closed ${r.code}`, after: reload });
  };

  const pause = () => act(() => post(`${base}/pause`, { paused: !r.paused }), {
    confirm: r.paused ? `Resume the game in ${r.code}?` : `Pause the game in ${r.code}? Every clock stops until it is resumed.`,
    ok: r.paused ? `Resumed ${r.code}` : `Paused ${r.code}`, after: reload,
  });

  return (
    <article className={`adm-card adm-room ${stuck ? 'stuck' : ''}`} aria-labelledby={`room-${r.code}`}>
      <header className="adm-room-head">
        <MapThumb id={r.mapId} name={r.map} />
        <div className="grow adm-stack-tight">
          <div className="row wrap">
            <h3 id={`room-${r.code}`} className="mono adm-code">{r.code}</h3>
            <CopyId value={r.code} label="Copy room code" />
            <span className={`adm-status ${r.status}`}>{r.status}</span>
            {r.private && <em className="tag">private</em>}
            {r.paused && <em className="tag warn" title={`Paused by ${r.paused.by}`}>paused</em>}
            {stuck && <em className="tag warn" title="A debt has been outstanding past its deadline for over 5 minutes">stuck?</em>}
          </div>
          <div className="row wrap small adm-room-meta">
            <span className="adm-chip map">{r.map}</span>
            <span className="adm-chip edition">{r.edition}</span>
            {r.status === 'playing' && r.phase && <span className="adm-chip phase" title="Current phase">{PHASE[r.phase] ?? r.phase}</span>}
          </div>
        </div>
      </header>

      <dl className="adm-room-facts small">
        <div><dt>Host</dt><dd className="adm-ellipsis">{r.hostName}</dd></div>
        {r.status !== 'lobby' && <div><dt>Turn</dt><dd>{r.turn}</dd></div>}
        <div><dt>Players</dt><dd>{humans}<span className="muted">{r.seats.length - humans ? ` + ${r.seats.length - humans} bots` : ''}</span></dd></div>
        <div><dt>Spectators</dt><dd>{r.spectators}</dd></div>
        <div><dt>Age</dt><dd><RelTime ts={r.createdAt} /></dd></div>
        {r.debts > 0 && <div><dt>Debts</dt><dd className="warn">{r.debts} unpaid</dd></div>}
      </dl>

      <ul className="adm-seats" aria-label="Seats">
        {r.seats.map(s => (
          <li key={s.id} className={s.bankrupt ? 'out' : ''}>
            <span className="adm-avatar" style={{ background: s.color }} aria-hidden>{s.isBot ? '🤖' : s.name.slice(0, 1).toUpperCase()}</span>
            <span className={`adm-conn ${s.connected ? 'on' : ''}`} role="img" aria-label={s.connected ? 'connected' : 'disconnected'} title={s.connected ? 'connected' : 'disconnected'} />
            <span className="grow adm-ellipsis">
              {s.name}
              {s.id === r.hostId && <em className="tag">host</em>}
              {s.isBot && <em className="tag">bot</em>}
              {s.bankrupt && <em className="tag warn">bankrupt</em>}
              {!s.bankrupt && s.afk && <em className="tag warn">autopilot</em>}
            </span>
            {s.cash !== null && <span className="small cash">${s.cash.toLocaleString()}</span>}
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

      <footer className="adm-actions">
        <div className="adm-actions-group" role="group" aria-label="Watch">
          <Link className="btn tiny" to={`/r/${r.code}?watch=1`} title="Watch without taking a seat">👁 Spectate</Link>
          <Link className="btn tiny ghost" to={`/admin/logs?room=${r.code}`}>Log</Link>
        </div>
        {r.status === 'playing' && (
          <div className="adm-actions-group" role="group" aria-label="Control the game">
            <button className="btn tiny" onClick={pause}>{r.paused ? '▶️ Resume' : '⏸ Pause'}</button>
            <button className="btn tiny" aria-expanded={fixing} onClick={() => setFixing(f => !f)}>🛠 Fix…</button>
          </div>
        )}
        <div className="adm-actions-group adm-actions-danger" role="group" aria-label="Stop">
          {r.status !== 'finished' && <button className="btn tiny ghost adm-danger-text" onClick={() => void end()}>End…</button>}
          <button className="btn tiny ghost adm-danger-text" onClick={() => void close()}>Close</button>
          <button className="btn tiny ghost" aria-expanded={more} aria-label="More actions" onClick={() => setMore(m => !m)}>⋯</button>
        </div>
      </footer>
      {more && (
        <div className="row wrap small adm-more">
          <Link className="btn tiny ghost" to={`/r/${r.code}`} title="Open the room (takes a free lobby seat)">Open as player</Link>
          <Link className="btn tiny ghost" to={`/admin/players?id=${encodeURIComponent(r.hostId)}`}>Host's account</Link>
          <span className="muted">created <RelTime ts={r.createdAt} />{r.startedAt && <> · started <RelTime ts={r.startedAt} /></>}</span>
        </div>
      )}
    </article>
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
