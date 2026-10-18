// Every live ban (expired ones drop off by themselves) and every chat mute:
// a sortable table with relative times, filter chips, "load more" and a
// client-side JSON export. Lifting always confirms in-style.
import { useState } from 'react';
import BanDialog from './BanDialog.tsx';
import { Refresh, RelTime, Th } from './bits.tsx';
import { act, del, downloadJson, expiry, post, useDebounced, usePoll, useSort, type Ban, type Mute } from './adminApi.ts';

const PAGE = 50;
type Col = 'who' | 'kind' | 'scope' | 'reason' | 'by' | 'at' | 'expiresAt';

const lift = (b: Ban, after: () => unknown) => act(() => del('/api/admin/bans', { kind: b.kind, value: b.value, scope: b.scope, gameId: b.gameId }), {
  confirm: `Lift the ${b.scope === 'room' ? `room ${b.gameId}` : 'site-wide'} ban on ${b.name || b.value}?`,
  ok: 'Ban lifted', after,
});

/** One ban, as a compact row. Used by the Players drawer. */
export function BanRow({ ban: b, after }: { ban: Ban; after: () => unknown }) {
  return (
    <li className="adm-ban-row">
      <div className="grow">
        <div className="row wrap">
          <span className={`tag ${b.kind === 'ip' ? 'warn' : ''}`}>{b.kind === 'ip' ? 'IP' : 'account'}</span>
          <span className="tag">{b.scope === 'room' ? `room ${b.gameId}` : 'site-wide'}</span>
          <b className="adm-ellipsis">{b.name || b.value}</b>
          {b.name && <span className="muted small mono adm-ellipsis">{b.value}</span>}
        </div>
        <div className="small">{b.reason || <span className="muted">no reason given</span>}</div>
        <div className="muted small">
          by {b.by || '?'} · <RelTime ts={b.at} /> · <span className={b.expiresAt ? 'warn' : ''}>{expiry(b.expiresAt)}</span>
        </div>
      </div>
      <button className="btn tiny" onClick={() => lift(b, after)}>Lift</button>
    </li>
  );
}

export default function BansTab() {
  const bans = usePoll<Ban[]>('/api/admin/bans', 15_000);
  const mutes = usePoll<Mute[]>('/api/admin/mutes', 15_000);
  const [kind, setKind] = useState<'all' | Ban['kind']>('all');
  const [scope, setScope] = useState<'all' | Ban['scope']>('all');
  const [text, setText] = useState('');
  const needle = useDebounced(text.trim().toLowerCase());
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const sort = useSort<Col>('at');

  const all = bans.data ?? [];
  const filtered = all.filter(b => (kind === 'all' || b.kind === kind) && (scope === 'all' || b.scope === scope)
    && (!needle || [b.value, b.name, b.reason, b.by, b.gameId ?? ''].some(s => s.toLowerCase().includes(needle))));
  const key = (b: Ban): string | number => {
    switch (sort.key) {
      case 'who': return (b.name || b.value).toLowerCase();
      case 'kind': return b.kind;
      case 'scope': return b.scope === 'room' ? `room ${b.gameId}` : 'site';
      case 'reason': return b.reason.toLowerCase();
      case 'by': return b.by.toLowerCase();
      case 'at': return b.at;
      case 'expiresAt': return b.expiresAt ?? Number.MAX_SAFE_INTEGER;
    }
  };
  const sorted = [...filtered].sort((x, y) => { const a = key(x), b = key(y); return (a < b ? -1 : a > b ? 1 : 0) * sort.dir; });
  const rows = sorted.slice(0, shown);

  const chip = <T extends string>(value: T, cur: T, set: (v: T) => void, label: string) => (
    <button key={value} className={cur === value ? 'on' : ''} aria-pressed={cur === value} onClick={() => { set(value); setShown(PAGE); }}>{label}</button>
  );

  return (
    <div className="adm-stack">
      <div className="row between wrap">
        <h2 className="adm-h2">Bans <span className="lb-count">{all.length}</span></h2>
        <Refresh at={bans.at} every={15_000} loading={bans.loading} />
      </div>
      <div className="row wrap adm-toolbar">
        <button className="btn small danger" onClick={() => setAdding(true)}>+ Add ban</button>
        <div className="adm-seg" role="group" aria-label="Kind">
          {chip('all', kind, setKind, 'All kinds')}{chip('player', kind, setKind, 'Accounts')}{chip('ip', kind, setKind, 'IP addresses')}
        </div>
        <div className="adm-seg" role="group" aria-label="Scope">
          {chip('all', scope, setScope, 'All scopes')}{chip('lifetime', scope, setScope, 'Site-wide')}{chip('room', scope, setScope, 'One room')}
        </div>
        <label className="adm-search grow">
          <span className="sr-only">Filter bans</span>
          <input type="search" value={text} placeholder="Filter by name, id, IP, reason, operator…" onChange={e => { setText(e.target.value); setShown(PAGE); }} />
        </label>
        <button className="btn small ghost" disabled={!filtered.length} title="Save the filtered list as JSON" onClick={() => downloadJson(`bans-${new Date().toISOString().slice(0, 10)}`, sorted)}>⬇ Export JSON</button>
      </div>

      <section className="adm-card" aria-labelledby="adm-bans-h">
        <h3 id="adm-bans-h">Bans <span className="lb-count">{filtered.length}{filtered.length !== all.length ? ` of ${all.length}` : ''}</span></h3>
        {bans.error && <p className="warn small" role="alert">{bans.error}</p>}
        {bans.data && filtered.length === 0 && <p className="muted small">{all.length ? 'No bans match.' : 'Nobody is banned.'}</p>}
        {rows.length > 0 && (
          <div className="adm-scroll">
            <table className="table adm-table">
              <thead>
                <tr>
                  <Th k="who" sort={sort}>Who</Th>
                  <Th k="kind" sort={sort}>Kind</Th>
                  <Th k="scope" sort={sort}>Scope</Th>
                  <Th k="reason" sort={sort}>Reason</Th>
                  <Th k="by" sort={sort}>By</Th>
                  <Th k="at" sort={sort}>When</Th>
                  <Th k="expiresAt" sort={sort}>Expires</Th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(b => (
                  <tr key={`${b.kind}${b.value}${b.scope}${b.gameId}`}>
                    <td data-label="Who" className="adm-c-who"><b>{b.name || b.value}</b>{b.name && <><br /><span className="muted small mono">{b.value}</span></>}</td>
                    <td data-label="Kind"><span className={`tag ${b.kind === 'ip' ? 'warn' : ''}`}>{b.kind === 'ip' ? 'IP' : 'account'}</span></td>
                    <td data-label="Scope"><span className="tag">{b.scope === 'room' ? `room ${b.gameId}` : 'site-wide'}</span></td>
                    <td data-label="Reason" className="adm-c-reason">{b.reason || <span className="muted">no reason given</span>}</td>
                    <td data-label="By">{b.by || '?'}</td>
                    <td data-label="When" className="nowrap"><RelTime ts={b.at} /></td>
                    <td data-label="Expires" className={`nowrap ${b.expiresAt ? 'warn' : 'muted'}`} title={b.expiresAt ? new Date(b.expiresAt).toLocaleString() : 'never'}>{expiry(b.expiresAt)}</td>
                    <td className="adm-c-act"><button className="btn tiny" onClick={() => lift(b, bans.reload)}>Lift</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > shown && <button className="btn small ghost adm-more-btn" onClick={() => setShown(n => n + PAGE)}>Load {Math.min(PAGE, filtered.length - shown)} more</button>}
      </section>

      <section className="adm-card" aria-labelledby="adm-mutes-h">
        <h3 id="adm-mutes-h">Chat mutes <span className="lb-count">{mutes.data?.length ?? 0}</span></h3>
        {mutes.data?.length === 0 && <p className="muted small">Nobody is muted. Mute someone from the Players tab.</p>}
        <ul className="adm-rows">
          {mutes.data?.map(m => (
            <li key={m.id} className="adm-ban-row">
              <div className="grow">
                <b>{m.name}</b> <span className="muted small mono">{m.id}</span>
                <div className="muted small">by {m.by} · <span className={m.until ? 'warn' : ''}>{expiry(m.until)}</span></div>
              </div>
              <button className="btn tiny" onClick={() => act(() => post('/api/admin/mutes', { id: m.id, name: m.name, minutes: 0 }), {
                confirm: `Unmute ${m.name}?`, ok: `Unmuted ${m.name}`, after: mutes.reload,
              })}>Unmute</button>
            </li>
          ))}
        </ul>
      </section>

      {adding && <BanDialog target={{ kind: 'player', scope: 'lifetime' }} onClose={() => setAdding(false)} onDone={bans.reload} />}
    </div>
  );
}
