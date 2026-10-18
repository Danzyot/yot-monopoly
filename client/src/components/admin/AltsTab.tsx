// Addresses used by more than one account — the likeliest alts. A shared
// address can also be a household or a café, so every ban still goes through
// the dialog rather than happening on one click.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import BanDialog, { type BanTarget } from './BanDialog.tsx';
import { flag, usePoll, type AltGroup, type Ban } from './adminApi.ts';

export default function AltsTab() {
  const { data, error, reload } = usePoll<AltGroup[]>('/api/admin/alts', 30_000);
  const bans = usePoll<Ban[]>('/api/admin/bans', 30_000);
  const [ban, setBan] = useState<BanTarget | null>(null);
  const [q, setQ] = useState('');

  if (error && !data) return <p className="warn">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const banned = new Set((bans.data ?? []).filter(b => b.scope === 'lifetime').map(b => `${b.kind}:${b.value}`));
  const needle = q.trim().toLowerCase();
  const groups = data.filter(g => !needle || g.ip.includes(needle) || g.accounts.some(a => a.name.toLowerCase().includes(needle) || a.id.includes(needle)));

  return (
    <div className="adm-stack">
      <div className="row between wrap">
        <h2 className="adm-h2">Alts <span className="lb-count">{data.length}</span></h2>
        <span className="muted small">{data.length} shared address{data.length === 1 ? '' : 'es'}</span>
      </div>
      <label className="adm-search">
        <span className="sr-only">Filter by IP or name</span>
        <input className="grow" type="search" value={q} placeholder="Filter by IP or name…" onChange={e => setQ(e.target.value)} />
        {needle && <span className="muted small nowrap">{groups.length} match{groups.length === 1 ? '' : 'es'}</span>}
      </label>
      {groups.length === 0 && <p className="muted">{data.length ? 'Nothing matches.' : 'No two accounts have shared an address yet.'}</p>}
      <div className="adm-grid">
        {groups.map(g => (
          <div key={g.ip} className="adm-card">
            <div className="row between">
              <span className="row"><span title={g.country ?? 'unknown'} role="img" aria-label={g.country ?? 'unknown country'}>{flag(g.country)}</span><h3 className="mono adm-ip-h">{g.ip}</h3>
                {banned.has(`ip:${g.ip}`) && <em className="tag warn">banned</em>}</span>
              <button className="btn tiny danger" disabled={banned.has(`ip:${g.ip}`)}
                onClick={() => setBan({ kind: 'ip', value: g.ip, name: `${g.accounts.length} accounts on ${g.ip}`, scope: 'lifetime', ips: [g.ip] })}>Ban IP</button>
            </div>
            <ul className="adm-rows">
              {g.accounts.map(a => (
                <li key={a.id} className="row">
                  <Link className="grow adm-ellipsis" to={`/admin/players?id=${encodeURIComponent(a.id)}`}>{a.name} <span className="muted small mono">{a.id}</span></Link>
                  {banned.has(`player:${a.id}`)
                    ? <em className="tag warn">banned</em>
                    : <button className="btn tiny ghost adm-danger-text" onClick={() => setBan({ kind: 'player', value: a.id, accountId: a.id, name: a.name, scope: 'lifetime', ips: [g.ip] })}>Ban</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {ban && <BanDialog target={ban} onClose={() => setBan(null)} onDone={() => { void reload(); void bans.reload(); }} />}
    </div>
  );
}
