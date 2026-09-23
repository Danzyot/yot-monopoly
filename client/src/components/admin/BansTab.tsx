// Every live ban (expired ones drop off by themselves) and every chat mute,
// filterable, with who/when/why and a one-click lift.
import { useState } from 'react';
import BanDialog from './BanDialog.tsx';
import { act, ago, del, expiry, post, usePoll, when, type Ban, type Mute } from './adminApi.ts';

/** One ban, as a row. Shared with the Players tab. */
export function BanRow({ ban: b, after }: { ban: Ban; after: () => unknown }) {
  const lift = () => act(() => del('/api/admin/bans', { kind: b.kind, value: b.value, scope: b.scope, gameId: b.gameId }), {
    confirm: `Lift the ${b.scope === 'room' ? `room ${b.gameId}` : 'site-wide'} ban on ${b.name || b.value}?`,
    ok: 'Ban lifted', after,
  });
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
          by {b.by || '?'} · {when(b.at)} ({ago(b.at)}) · <span className={b.expiresAt ? 'warn' : ''}>{expiry(b.expiresAt)}</span>
        </div>
      </div>
      <button className="btn tiny" onClick={lift}>Lift</button>
    </li>
  );
}

export default function BansTab() {
  const bans = usePoll<Ban[]>('/api/admin/bans', 15_000);
  const mutes = usePoll<Mute[]>('/api/admin/mutes', 15_000);
  const [kind, setKind] = useState<'all' | Ban['kind']>('all');
  const [scope, setScope] = useState<'all' | Ban['scope']>('all');
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);

  const needle = text.trim().toLowerCase();
  const shown = (bans.data ?? []).filter(b => (kind === 'all' || b.kind === kind) && (scope === 'all' || b.scope === scope)
    && (!needle || [b.value, b.name, b.reason, b.by, b.gameId ?? ''].some(s => s.toLowerCase().includes(needle))));

  return (
    <div className="adm-stack">
      <div className="row wrap">
        <button className="btn small danger" onClick={() => setAdding(true)}>+ Add ban</button>
        <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} aria-label="Kind" className="adm-auto">
          <option value="all">All kinds</option>
          <option value="player">Accounts</option>
          <option value="ip">IP addresses</option>
        </select>
        <select value={scope} onChange={e => setScope(e.target.value as typeof scope)} aria-label="Scope" className="adm-auto">
          <option value="all">All scopes</option>
          <option value="lifetime">Site-wide</option>
          <option value="room">One room</option>
        </select>
        <input className="grow" type="search" value={text} placeholder="Filter by name, id, IP, reason…" onChange={e => setText(e.target.value)} />
      </div>

      <section className="adm-card">
        <h3>Bans <small className="muted">{shown.length}{shown.length !== (bans.data?.length ?? 0) ? ` of ${bans.data?.length}` : ''}</small></h3>
        {bans.error && <p className="warn small">{bans.error}</p>}
        {bans.data && shown.length === 0 && <p className="muted small">{bans.data.length ? 'No bans match.' : 'Nobody is banned.'}</p>}
        <ul className="adm-rows">{shown.map(b => <BanRow key={`${b.kind}${b.value}${b.scope}${b.gameId}`} ban={b} after={bans.reload} />)}</ul>
      </section>

      <section className="adm-card">
        <h3>Chat mutes <small className="muted">{mutes.data?.length ?? ''}</small></h3>
        {mutes.data?.length === 0 && <p className="muted small">Nobody is muted. Mute someone from the Players tab.</p>}
        <ul className="adm-rows">
          {mutes.data?.map(m => (
            <li key={m.id} className="adm-ban-row">
              <div className="grow">
                <b>{m.name}</b> <span className="muted small mono">{m.id}</span>
                <div className="muted small">by {m.by} · {expiry(m.until)}</div>
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
