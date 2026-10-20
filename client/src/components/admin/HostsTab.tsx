// Hosting rights: who may host tournaments besides the operators. Chog
// Genesis holders host by holding (listed here, nothing to do); anyone else
// is added by hand, by Discord id or by picking a player who has signed in.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../Avatar.tsx';
import { RelTime } from './bits.tsx';
import { act, del, post, useDebounced, usePoll, type Account, type HostsInfo } from './adminApi.ts';

export default function HostsTab() {
  const hosts = usePoll<HostsInfo>('/api/admin/hosts', 30_000);
  const [id, setId] = useState('');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const found = usePoll<Account[]>(query ? `/api/admin/accounts?q=${encodeURIComponent(query)}` : null);

  const approved = hosts.data?.approved ?? [];
  const holders = hosts.data?.holders ?? [];
  const isApproved = new Set(approved.map(h => h.id));

  const add = (value: string, name = '') => act(() => post('/api/admin/hosts', { id: value, name }), {
    ok: 'Approved as a host',
    after: () => { setId(''); return hosts.reload(); },
  });
  const remove = (h: { id: string; name: string; holder: boolean }) => act(() => del(`/api/admin/hosts/${encodeURIComponent(h.id)}`), {
    confirm: `Remove ${h.name || h.id} from the approved hosts?${h.holder ? ' They hold a Chog, so they can still host until they sell it.' : ' Events they already created keep running.'}`,
    ok: 'Removed',
    after: hosts.reload,
  });

  if (hosts.error && !hosts.data) return <p className="warn">{hosts.error}</p>;

  return (
    <div className="adm-stack">
      <div className="row between wrap">
        <h2 className="adm-h2">Hosts <span className="lb-count">{approved.length + holders.length}</span></h2>
        <span className="muted small">Operators can always host and are not listed.</span>
      </div>
      <p className="muted small">
        A host can create tournaments (and poker tables), start, pause and cancel their own events and write the prize line.
        Kicking players, Discord role requirements and results posted to Discord stay with operators.
      </p>

      <section className="adm-card" aria-labelledby="adm-hosts-add-h">
        <h3 id="adm-hosts-add-h">Approve a host</h3>
        <form className="row wrap" onSubmit={e => { e.preventDefault(); if (id.trim()) void add(id.trim()); }}>
          <label className="grow">
            <span className="sr-only">Discord user id or player id</span>
            <input className="grow" value={id} placeholder="Discord user id (e.g. 340404007639973888) or dc_…" onChange={e => setId(e.target.value)} />
          </label>
          <button className="btn small primary" disabled={!id.trim()}>Approve</button>
        </form>
        <label className="adm-search">
          <span className="sr-only">Or find a player who has signed in</span>
          <input type="search" value={q} placeholder="…or find a player by name, Discord or id" onChange={e => setQ(e.target.value)} />
        </label>
        {query && found.data?.length === 0 && <p className="muted small">Nobody matches “{query}”.</p>}
        {query && (
          <ul className="adm-rows">
            {(found.data ?? []).slice(0, 8).map(a => (
              <li key={a.id} className="row">
                <Avatar src={a.avatar} size={22} />
                <span className="grow adm-ellipsis"><b>{a.name}</b>{a.discordName && <span className="muted small"> @{a.discordName}</span>} <span className="muted small mono">{a.id}</span></span>
                {isApproved.has(a.id)
                  ? <em className="tag">approved</em>
                  : <button className="btn tiny" onClick={() => void add(a.id, a.name)}>Approve</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="adm-card" aria-labelledby="adm-hosts-approved-h">
        <h3 id="adm-hosts-approved-h">Approved by an operator <span className="lb-count">{approved.length}</span></h3>
        {!hosts.data && <p className="muted small">Loading…</p>}
        {hosts.data && approved.length === 0 && <p className="muted small">Nobody yet. Holders below can host without being added.</p>}
        <ul className="adm-rows">
          {approved.map(h => (
            <li key={h.id} className="row">
              <Link className="grow adm-ellipsis" to={`/admin/players?id=${encodeURIComponent(h.id)}`}>
                <b>{h.name || 'Not seen yet'}</b> <span className="muted small mono">{h.id}</span>
              </Link>
              {h.holder && <em className="tag" title="Also holds a Chog">holder</em>}
              <span className="muted small nowrap">by {h.addedBy} · <RelTime ts={h.addedAt} /></span>
              <button className="btn tiny ghost adm-danger-text" onClick={() => void remove(h)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="adm-card" aria-labelledby="adm-hosts-holders-h">
        <h3 id="adm-hosts-holders-h">Hosts because they hold a Chog <span className="lb-count">{holders.length}</span></h3>
        <p className="muted small">From each linked wallet's last reading. Selling the Chog ends it; nothing to approve.</p>
        {hosts.data && holders.length === 0 && <p className="muted small">No linked wallet holds a Chog yet.</p>}
        <ul className="adm-rows">
          {holders.map(h => (
            <li key={h.id} className="row">
              <Link className="grow adm-ellipsis" to={`/admin/players?id=${encodeURIComponent(h.id)}`}>
                <b>{h.name || 'Unknown player'}</b> <span className="muted small mono">{h.id}</span>
              </Link>
              <span className="tag">{h.chogs} Chog{h.chogs === 1 ? '' : 's'}</span>
              <span className="muted small nowrap">checked <RelTime ts={h.checkedAt} /></span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
