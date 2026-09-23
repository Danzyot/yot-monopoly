// Accounts: search, a full audit view of one account (addresses and where
// they are, linked accounts, bans, current rooms) and every action on it.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '../Avatar.tsx';
import BanDialog, { type BanTarget } from './BanDialog.tsx';
import { BanRow } from './BansTab.tsx';
import {
  act, ago, del, expiry, flag, post, usePoll, when, type Account, type AccountDetail, type OnlineRow,
} from './adminApi.ts';

export default function PlayersTab() {
  // The open account lives in the address so it survives a refresh and can be linked to.
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  const open = (id: string | null) => setParams(p => {
    const next = new URLSearchParams(p);
    if (id) next.set('id', id); else next.delete('id');
    return next;
  });

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  // Search as you type, but not on every keystroke.
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const accounts = usePoll<Account[]>(`/api/admin/accounts?q=${encodeURIComponent(query)}`);
  const online = usePoll<OnlineRow[]>('/api/admin/online', 5_000);

  return (
    <div className={`adm-split ${openId ? 'has-detail' : ''}`}>
      <div className="adm-stack adm-list-col">
        <input type="search" value={q} placeholder="Search name, id, Discord or IP…" onChange={e => setQ(e.target.value)} />
        <section className="adm-card">
          <h3>Accounts {accounts.data && <small className="muted">{accounts.data.length}{accounts.data.length >= 200 ? '+' : ''}</small>}</h3>
          {accounts.error && <p className="warn small">{accounts.error}</p>}
          {accounts.data?.length === 0 && <p className="muted small">No accounts match.</p>}
          <ul className="adm-rows">
            {accounts.data?.slice(0, 100).map(a => (
              <li key={a.id}>
                <button className={`adm-rowbtn ${a.id === openId ? 'on' : ''}`} onClick={() => open(a.id)}>
                  <Avatar src={a.avatar} size={24} />
                  <span className="grow adm-ellipsis">
                    <b>{a.name}</b>{a.discordName && <span className="muted small"> @{a.discordName}</span>}
                    <br /><span className="muted small mono">{a.id}</span>
                  </span>
                  <span className="muted small">{ago(a.lastSeen)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="adm-card">
          <h3>Online now {online.data && <small className="muted">{online.data.length}</small>}</h3>
          {online.data?.length === 0 && <p className="muted small">Nobody connected.</p>}
          <ul className="adm-rows">
            {online.data?.map((o, i) => (
              <li key={`${o.id}-${i}`}>
                <button className="adm-rowbtn" disabled={o.id === '(guest)'} onClick={() => open(o.id)}>
                  <span className="adm-conn on" />
                  <span className="grow adm-ellipsis">{o.name} <span className="muted small mono">{o.ip ?? ''}</span></span>
                  {o.room && <span className="tag">{o.room}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="adm-detail-col">
        {openId ? <AccountView key={openId} id={openId} onOpen={open} onClose={() => open(null)}
          onErased={() => { open(null); void accounts.reload(); }} />
          : <p className="muted adm-hint">Pick an account to see its addresses, linked accounts and bans.</p>}
      </div>
    </div>
  );
}

const MUTES: [string, number | null][] = [['15 min', 15], ['1 hour', 60], ['24 hours', 1440], ['7 days', 10_080], ['Until lifted', null]];

function AccountView({ id, onOpen, onClose, onErased }: {
  id: string; onOpen: (id: string) => void; onClose: () => void; onErased: () => void;
}) {
  const { data: d, error, reload } = usePoll<AccountDetail>(`/api/admin/accounts/${encodeURIComponent(id)}`);
  const [ban, setBan] = useState<BanTarget | null>(null);
  const [muteFor, setMuteFor] = useState('1');
  const [dm, setDm] = useState('');

  if (error) return <div className="adm-card"><p className="warn">{error}</p><button className="btn small" onClick={onClose}>Back</button></div>;
  if (!d) return <div className="adm-card"><p className="muted">Loading…</p></div>;
  const a = d.account;
  const ips = Object.entries(a.ips).sort((x, y) => y[1].last - x[1].last);

  const mute = (minutes: number | null) => act(() => post('/api/admin/mutes', { id: a.id, name: a.name, minutes }), {
    ok: minutes === 0 ? `Unmuted ${a.name}` : `Muted ${a.name}`, after: reload,
  });

  return (
    <div className="adm-card adm-stack">
      <div className="row between">
        <div className="row">
          <Avatar src={a.avatar} size={40} />
          <div>
            <h2 className="adm-name">{a.name}</h2>
            <div className="muted small mono">{a.id}</div>
          </div>
        </div>
        <button className="btn tiny ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="small">
        {a.discordId ? <>Discord <b>@{a.discordName}</b> <span className="muted mono">{a.discordId}</span></> : <span className="muted">No Discord linked (demo account)</span>}
        <br /><span className="muted">First seen {when(a.firstSeen)} · last seen {ago(a.lastSeen)}</span>
      </div>

      <div className="row wrap">
        <button className="btn small danger" onClick={() => setBan({ kind: 'player', value: a.id, accountId: a.id, name: a.name, scope: 'lifetime', ips: ips.map(([ip]) => ip) })}>Ban account…</button>
        {d.mute ? (
          <button className="btn small" onClick={() => mute(0)}>Unmute <small className="muted">({expiry(d.mute.until)})</small></button>
        ) : (
          <span className="row adm-inline">
            <select value={muteFor} onChange={e => setMuteFor(e.target.value)} aria-label="Mute for">
              {MUTES.map(([label], i) => <option key={label} value={i}>{label}</option>)}
            </select>
            <button className="btn small" onClick={() => mute(MUTES[Number(muteFor)][1])}>Mute chat</button>
          </span>
        )}
        <button className="btn small ghost adm-danger-text" onClick={() => act(() => del(`/api/admin/accounts/${encodeURIComponent(a.id)}`), {
          confirm: `Erase the audit history (addresses, first/last seen) of ${a.name}? Their bans stay. This cannot be undone.`,
          ok: 'Audit history erased', after: onErased,
        })}>Erase history</button>
      </div>

      {d.rooms.length > 0 && (
        <div>
          <h4>In rooms</h4>
          <div className="row wrap">
            {d.rooms.map(r => <Link key={r.code} className="btn tiny" to={`/r/${r.code}?watch=1`}>{r.code} · {r.status}</Link>)}
          </div>
        </div>
      )}

      <div>
        <h4>Addresses <small className="muted">{ips.length}</small></h4>
        {ips.length === 0 && <p className="muted small">None recorded.</p>}
        <ul className="adm-rows">
          {ips.map(([ip, c]) => (
            <li key={ip} className="adm-ip">
              <span title={c.country ?? 'unknown country'}>{flag(c.country)}</span>
              <span className="grow adm-ellipsis"><span className="mono">{ip}</span> <span className="muted small">{c.country ?? '??'} · {c.count}× · last {ago(c.last)}</span></span>
              <button className="btn tiny ghost adm-danger-text" onClick={() => setBan({ kind: 'ip', value: ip, accountId: a.id, name: a.name, scope: 'lifetime', ips: [ip] })}>Ban IP…</button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4>Linked accounts <small className="muted">share an address</small></h4>
        {d.linked.length === 0 ? <p className="muted small">None.</p> : (
          <div className="row wrap">
            {d.linked.map(l => <button key={l.id} className="btn tiny" onClick={() => onOpen(l.id)}>{l.name}</button>)}
          </div>
        )}
      </div>

      <div>
        <h4>Bans <small className="muted">on this account, its Discord or its addresses</small></h4>
        {d.bans.length === 0 ? <p className="muted small">None.</p> : (
          <ul className="adm-rows">{d.bans.map(b => <BanRow key={`${b.kind}${b.value}${b.scope}${b.gameId}`} ban={b} after={reload} />)}</ul>
        )}
      </div>

      {a.discordId && (
        <form className="adm-stack" onSubmit={e => {
          e.preventDefault();
          void act(() => post('/api/admin/dm', { discordId: a.discordId, text: dm }), { ok: 'DM sent' }).then(ok => { if (ok) setDm(''); });
        }}>
          <h4>Direct message via the Discord bot</h4>
          <textarea value={dm} maxLength={1800} rows={3} placeholder={`Message to @${a.discordName}`} onChange={e => setDm(e.target.value)} />
          <div><button className="btn small" disabled={!dm.trim()}>Send DM</button></div>
        </form>
      )}

      {ban && <BanDialog target={ban} onClose={() => setBan(null)} onDone={reload} />}
    </div>
  );
}
