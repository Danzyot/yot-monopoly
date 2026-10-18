// The durable event logs: pick a room (or the "admin" log of operator
// actions) and read it oldest-to-newest, with type chips, search, "show
// earlier" paging and a JSON export — plus the latest finished games, sortable.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMap } from '../../../../shared/maps.ts';
import { getTheme, tableLabel } from '../../../../shared/themes.ts';
import { Refresh, RelTime, Th } from './bits.tsx';
import { ago, clock, downloadJson, full, useDebounced, usePoll, useSort, type GameEvent, type GameRecord, type LoggedGame } from './adminApi.ts';

const PAGE = 300;

/** Rough type of a log line, from its wording, for the filter chips. */
type Kind = 'ban' | 'room' | 'money' | 'turn' | 'chat' | 'other';
const KINDS: [Kind, string][] = [['ban', 'Bans & mutes'], ['room', 'Rooms & operators'], ['money', 'Money & property'], ['turn', 'Turns & dice'], ['chat', 'Chat & social'], ['other', 'Other']];
function kindOf(text: string): Kind {
  const t = text.toLowerCase();
  if (/\b(ban|banned|unban|lift|mute|muted|unmuted|kick|removed)\b/.test(t)) return 'ban';
  if (/\b(room|paused|resumed|ended|closed|host|joined|left|spectat|feature|operator|fix)/.test(t)) return 'room';
  if (/\b(paid|pays|bought|buys|sold|rent|mortgage|auction|bid|house|hotel|trade|cash|\$\d)/.test(t)) return 'money';
  if (/\b(roll|rolled|dice|turn|moves|moved|jail|doubles|lands|landed|card|chance|chest)/.test(t)) return 'turn';
  if (/\b(says|chat|react|poke|emoji)/.test(t)) return 'chat';
  return 'other';
}

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
      <h2 className="adm-h2">Logs</h2>
      <div className="row wrap adm-toolbar">
        <label className="adm-search grow">
          <span className="sr-only">Which log</span>
          <select className="adm-auto grow" value={picked} onChange={e => pick(e.target.value)}>
            {sorted.map(g => (
              <option key={g.gameId} value={g.gameId}>
                {g.gameId === 'admin' ? '🛡 Operator actions' : `${g.gameId}${g.gameName ? ` — ${g.gameName}` : ''}`}
                {g.events ? ` (${g.events}, ${ago(g.to)})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <EventLog key={picked} code={picked} />
      <Results />
    </div>
  );
}

function EventLog({ code }: { code: string }) {
  const EVERY = 10_000;
  const { data, error, loading, reload, at } = usePoll<GameEvent[]>(`/api/admin/events/${encodeURIComponent(code)}`, EVERY);
  const [q, setQ] = useState('');
  const needle = useDebounced(q.trim().toLowerCase());
  const [kinds, setKinds] = useState<Set<Kind>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const box = useRef<HTMLDivElement>(null);

  const all = data ?? [];
  const present = new Set(all.map(e => kindOf(e.text)));
  const matching = all.filter(e => (!needle || e.text.toLowerCase().includes(needle)) && (kinds.size === 0 || kinds.has(kindOf(e.text))));
  // Newest at the bottom, like a chat; paging reveals earlier lines.
  const rows = matching.slice(Math.max(0, matching.length - limit));
  const hidden = matching.length - rows.length;

  const pinned = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, code]);

  const toggle = (k: Kind) => setKinds(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  let lastDay = '';
  return (
    <section className="adm-card adm-stack" aria-labelledby="adm-log-h">
      <div className="row wrap between">
        <h3 id="adm-log-h">{code === 'admin' ? 'Operator actions' : `Room ${code}`} <span className="lb-count">{data ? `${matching.length}${matching.length !== all.length ? ` of ${all.length}` : ''}` : '…'}</span></h3>
        <Refresh at={at} every={EVERY} loading={loading} />
      </div>
      <div className="row wrap adm-toolbar">
        <div className="adm-chips" role="group" aria-label="Filter by type">
          <button className={`adm-chipbtn ${kinds.size === 0 ? 'on' : ''}`} aria-pressed={kinds.size === 0} onClick={() => setKinds(new Set())}>All</button>
          {KINDS.filter(([k]) => present.has(k)).map(([k, label]) => (
            <button key={k} className={`adm-chipbtn ${kinds.has(k) ? 'on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => toggle(k)}>{label}</button>
          ))}
        </div>
        <label className="adm-search grow">
          <span className="sr-only">Search this log</span>
          <input type="search" value={q} placeholder="Search this log…" onChange={e => setQ(e.target.value)} />
        </label>
        <button className="btn small ghost" onClick={() => void reload()} disabled={loading} aria-label="Refresh now">↻</button>
        <button className="btn small ghost" disabled={!matching.length} title="Save the shown lines as JSON" onClick={() => downloadJson(`log-${code}-${new Date().toISOString().slice(0, 10)}`, matching)}>⬇ Export JSON</button>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="adm-log" ref={box} tabIndex={0} aria-label="Log lines" onScroll={e => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}>
        {hidden > 0 && (
          <div className="center"><button className="btn tiny ghost" onClick={() => { pinned.current = false; setLimit(n => n + PAGE); }}>Show {Math.min(PAGE, hidden)} earlier of {hidden}</button></div>
        )}
        {data && rows.length === 0 && <p className="muted small">{all.length ? 'No lines match.' : 'Nothing logged yet.'}</p>}
        {rows.map((e, i) => {
          const day = new Date(e.ts).toDateString();
          const head = day !== lastDay;
          lastDay = day;
          const k = kindOf(e.text);
          return (
            <div key={`${e.ts}-${i}`}>
              {head && <div className="adm-log-day">{day}</div>}
              <div className={`adm-log-line k-${k}`}><time className="muted mono" dateTime={new Date(e.ts).toISOString()} title={full(e.ts)}>{clock(e.ts)}</time> <span>{e.text}</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type RCol = 'endedAt' | 'code' | 'map' | 'turns' | 'winner';

function Results() {
  const { data } = usePoll<GameRecord[]>('/api/admin/results', 30_000);
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(25);
  const sort = useSort<RCol>('endedAt');
  const all = data ?? [];
  const key = (r: GameRecord): string | number => {
    switch (sort.key) {
      case 'endedAt': return r.endedAt;
      case 'code': return r.code;
      case 'map': return getMap(r.mapId).name;
      case 'turns': return r.turns;
      case 'winner': return (r.places[0]?.name ?? '').toLowerCase();
    }
  };
  const rows = [...all].sort((x, y) => { const a = key(x), b = key(y); return (a < b ? -1 : a > b ? 1 : 0) * sort.dir; }).slice(0, shown);
  return (
    <section className="adm-card" aria-labelledby="adm-results-h">
      <div className="row between wrap">
        <h3 id="adm-results-h">Recent results <span className="lb-count">{all.length}</span></h3>
        <div className="row">
          <button className="btn tiny ghost" disabled={!all.length} onClick={() => downloadJson(`results-${new Date().toISOString().slice(0, 10)}`, all)}>⬇ JSON</button>
          <button className="btn tiny ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      {open && (all.length === 0 ? <p className="muted small">No finished games yet.</p> : (
        <>
          <div className="adm-scroll">
            <table className="table adm-table">
              <thead>
                <tr>
                  <Th k="endedAt" sort={sort}>Ended</Th>
                  <Th k="code" sort={sort}>Room</Th>
                  <Th k="map" sort={sort}>Board / look</Th>
                  <Th k="turns" sort={sort}>Turns</Th>
                  <Th k="winner" sort={sort}>Standings</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.code}${r.endedAt}`}>
                    <td data-label="Ended" className="nowrap"><RelTime ts={r.endedAt} /></td>
                    <td data-label="Room" className="mono">{r.code}</td>
                    <td data-label="Board">{tableLabel(getMap(r.mapId).name, getTheme(r.themeId).name)}</td>
                    <td data-label="Turns">{r.turns}</td>
                    <td data-label="Standings" className="adm-c-reason">{r.places.map((p, i) => <span key={p.id} className={i === 0 ? 'accent' : ''}>{i ? ', ' : '🏆 '}{p.name}{p.isBot ? ' 🤖' : ''}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {all.length > shown && <button className="btn small ghost adm-more-btn" onClick={() => setShown(n => n + 25)}>Load {Math.min(25, all.length - shown)} more</button>}
        </>
      ))}
    </section>
  );
}
