// The durable event logs: pick a room (or the "admin" log of operator
// actions) and read it oldest-to-newest, plus the latest finished games.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMap } from '../../../../shared/maps.ts';
import { getTheme } from '../../../../shared/themes.ts';
import { ago, clock, usePoll, when, type GameEvent, type GameRecord, type LoggedGame } from './adminApi.ts';

export default function LogsTab() {
  const [params, setParams] = useSearchParams();
  const games = usePoll<LoggedGame[]>('/api/admin/events', 15_000);
  const picked = params.get('room') ?? 'admin';
  const pick = (code: string) => setParams(p => { const n = new URLSearchParams(p); n.set('room', code); return n; });

  const list = games.data ?? [];
  // The admin log always heads the list, even before any operator action.
  const options = list.some(g => g.gameId === 'admin') ? list : [{ gameId: 'admin', gameName: 'Operator actions', events: 0, from: 0, to: 0 }, ...list];
  const sorted = [...options.filter(g => g.gameId === 'admin'), ...options.filter(g => g.gameId !== 'admin')];
  if (!sorted.some(g => g.gameId === picked)) sorted.push({ gameId: picked, gameName: '', events: 0, from: 0, to: 0 });

  return (
    <div className="adm-stack">
      <div className="row wrap">
        <select className="adm-auto grow" value={picked} onChange={e => pick(e.target.value)} aria-label="Log">
          {sorted.map(g => (
            <option key={g.gameId} value={g.gameId}>
              {g.gameId === 'admin' ? '🛡 Operator actions' : `${g.gameId}${g.gameName ? ` — ${g.gameName}` : ''}`}
              {g.events ? ` (${g.events}, ${ago(g.to)})` : ''}
            </option>
          ))}
        </select>
      </div>
      <EventLog key={picked} code={picked} />
      <Results />
    </div>
  );
}

function EventLog({ code }: { code: string }) {
  const { data, error, loading, reload } = usePoll<GameEvent[]>(`/api/admin/events/${encodeURIComponent(code)}`, 10_000);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter(e => !needle || e.text.toLowerCase().includes(needle));

  // Newest at the bottom, like a chat: keep the view pinned there unless the
  // operator has scrolled up to read something.
  const pinned = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, code]);

  let lastDay = '';
  return (
    <section className="adm-card adm-stack">
      <div className="row wrap between">
        <h3>{code === 'admin' ? 'Operator actions' : `Room ${code}`} <small className="muted">{data ? `${rows.length}${needle ? ` of ${data.length}` : ''} lines` : ''}</small></h3>
        <div className="row">
          <input type="search" value={q} placeholder="Search this log…" onChange={e => setQ(e.target.value)} />
          <button className="btn small ghost" onClick={() => void reload()} disabled={loading}>↻</button>
        </div>
      </div>
      {error && <p className="warn small">{error}</p>}
      <div className="adm-log" ref={box} onScroll={e => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}>
        {data && rows.length === 0 && <p className="muted small">{data.length ? 'No lines match.' : 'Nothing logged yet.'}</p>}
        {rows.map((e, i) => {
          const day = new Date(e.ts).toDateString();
          const head = day !== lastDay;
          lastDay = day;
          return (
            <div key={i}>
              {head && <div className="adm-log-day">{day}</div>}
              <div className="adm-log-line"><time className="muted mono" title={when(e.ts)}>{clock(e.ts)}</time> <span>{e.text}</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Results() {
  const { data } = usePoll<GameRecord[]>('/api/admin/results', 30_000);
  const [open, setOpen] = useState(true);
  const rows = data ?? [];
  return (
    <section className="adm-card">
      <div className="row between">
        <h3>Recent results <small className="muted">{rows.length}</small></h3>
        <button className="btn tiny ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (rows.length === 0 ? <p className="muted small">No finished games yet.</p> : (
        <div className="adm-scroll">
          <table className="table">
            <thead><tr><th>Ended</th><th>Room</th><th>Map / edition</th><th>Turns</th><th>Standings</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.code}${r.endedAt}`}>
                  <td className="nowrap">{when(r.endedAt)}</td>
                  <td className="mono">{r.code}</td>
                  <td>{getMap(r.mapId).name} · {getTheme(r.themeId).name}</td>
                  <td>{r.turns}</td>
                  <td>{r.places.map((p, i) => <span key={p.id} className={i === 0 ? 'accent' : ''}>{i ? ', ' : '🏆 '}{p.name}{p.isBot ? ' 🤖' : ''}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
