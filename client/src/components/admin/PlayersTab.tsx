// Accounts: debounced search with a result count, and a drawer for one
// account with tabs — Profile · IP history · Linked · Actions (ban, mute with
// presets, erase history, DM).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Avatar } from '../Avatar.tsx';
import BanDialog, { type BanTarget } from './BanDialog.tsx';
import { BanRow } from './BansTab.tsx';
import { CopyId, Refresh, RelTime } from './bits.tsx';
import {
  act, del, expiry, flag, post, useDebounced, usePoll, type Account, type AccountDetail, type OnlineRow,
} from './adminApi.ts';

const PAGE = 50;

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
  const query = useDebounced(q.trim(), 250);
  const accounts = usePoll<Account[]>(`/api/admin/accounts?q=${encodeURIComponent(query)}`);
  const online = usePoll<OnlineRow[]>('/api/admin/online', 5_000);
  const [shown, setShown] = useState(PAGE);
  const list = accounts.data ?? [];
  const searching = q.trim() !== query || accounts.loading;

  return (
    <div className={`adm-split ${openId ? 'has-detail' : ''}`}>
      <div className="adm-stack adm-list-col">
        <h2 className="adm-h2">Players</h2>
        <label className="adm-search">
          <span className="sr-only">Search accounts by name, id, Discord or IP</span>
          <input type="search" value={q} placeholder="Search name, id, Discord or IP…" onChange={e => { setQ(e.target.value); setShown(PAGE); }} />
          <span className="muted small nowrap" role="status">
            {searching ? <span className="spinner" aria-label="Searching" /> : accounts.data ? `${list.length}${list.length >= 200 ? '+' : ''} result${list.length === 1 ? '' : 's'}` : ''}
          </span>
        </label>
        <section className="adm-card" aria-labelledby="adm-acc-h">
          <h3 id="adm-acc-h">Accounts {accounts.data && <span className="lb-count">{list.length}{list.length >= 200 ? '+' : ''}</span>}</h3>
          {accounts.error && <p className="warn small" role="alert">{accounts.error}</p>}
          {accounts.data?.length === 0 && <p className="muted small">No accounts match{query ? ` “${query}”` : ''}.</p>}
          <ul className="adm-rows">
            {list.slice(0, shown).map(a => (
              <li key={a.id}>
                <button className={`adm-rowbtn ${a.id === openId ? 'on' : ''}`} aria-current={a.id === openId || undefined} onClick={() => open(a.id)}>
                  <Avatar src={a.avatar} size={24} />
                  <span className="grow adm-ellipsis">
                    <b>{a.name}</b>{a.discordName && <span className="muted small"> @{a.discordName}</span>}
                    <br /><span className="muted small mono">{a.id}</span>
                  </span>
                  <RelTime ts={a.lastSeen} className="muted small" />
                </button>
              </li>
            ))}
          </ul>
          {list.length > shown && <button className="btn small ghost adm-more-btn" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
        </section>
        <section className="adm-card" aria-labelledby="adm-online-h">
          <div className="row between wrap">
            <h3 id="adm-online-h">Online now {online.data && <span className="lb-count">{online.data.length}</span>}</h3>
            <Refresh at={online.at} every={5_000} loading={online.loading} />
          </div>
          {online.data?.length === 0 && <p className="muted small">Nobody connected.</p>}
          <ul className="adm-rows">
            {online.data?.map((o, i) => (
              <li key={`${o.id}-${i}`}>
                <button className="adm-rowbtn" disabled={o.id === '(guest)'} onClick={() => open(o.id)}>
                  <span className="adm-conn on" aria-hidden />
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
const TABS = ['Profile', 'IP history', 'Linked', 'Actions'] as const;
type Tab = typeof TABS[number];

function AccountView({ id, onOpen, onClose, onErased }: {
  id: string; onOpen: (id: string) => void; onClose: () => void; onErased: () => void;
}) {
  const { data: d, error, reload } = usePoll<AccountDetail>(`/api/admin/accounts/${encodeURIComponent(id)}`);
  const [ban, setBan] = useState<BanTarget | null>(null);
  const [tab, setTab] = useState<Tab>('Profile');
  const [muteFor, setMuteFor] = useState(1);
  const [muteWhy, setMuteWhy] = useState('');
  const [dm, setDm] = useState('');

  if (error) return <div className="adm-card"><p className="warn" role="alert">{error}</p><button className="btn small" onClick={onClose}>Back</button></div>;
  if (!d) return <div className="adm-card" aria-busy="true"><div className="sk sk-hero" /></div>;
  const a = d.account;
  const ips = Object.entries(a.ips).sort((x, y) => y[1].last - x[1].last);
  const counts: Partial<Record<Tab, number>> = { 'IP history': ips.length, Linked: d.linked.length, Actions: d.bans.length + (d.mute ? 1 : 0) };

  const mute = (minutes: number | null) => act(() => post('/api/admin/mutes', { id: a.id, name: a.name, minutes, reason: muteWhy.trim() || undefined }), {
    confirm: minutes === 0 ? undefined : `Mute ${a.name}'s chat ${minutes === null ? 'until lifted' : `for ${MUTES.find(m => m[1] === minutes)?.[0]}`}?`,
    ok: minutes === 0 ? `Unmuted ${a.name}` : `Muted ${a.name}`, after: reload,
  });

  return (
    <section className="adm-card adm-stack adm-drawer" aria-labelledby="adm-acc-name">
      <header className="row between">
        <div className="row">
          <Avatar src={a.avatar} size={44} />
          <div>
            <h2 id="adm-acc-name" className="adm-name">{a.name}</h2>
            <div className="muted small mono row adm-idrow">{a.id} <CopyId value={a.id} label="Copy account id" /></div>
          </div>
        </div>
        <button className="btn tiny ghost modal-x" onClick={onClose} aria-label="Close account">✕</button>
      </header>

      <div className="row wrap adm-badges small">
        {d.bans.some(b => b.scope === 'lifetime') && <em className="tag warn">site-banned</em>}
        {d.mute && <em className="tag warn">muted · {expiry(d.mute.until)}</em>}
        {d.rooms.map(r => <Link key={r.code} className="tag adm-roomtag" to={`/r/${r.code}?watch=1`}>in {r.code} · {r.status}</Link>)}
        {d.rooms.length === 0 && !d.mute && !d.bans.length && <span className="muted">No bans, not muted, not in a room.</span>}
      </div>

      <div className="adm-seg adm-drawer-tabs" role="tablist" aria-label="Account sections">
        {TABS.map(t => (
          <button key={t} role="tab" id={`acct-tab-${t}`} aria-selected={tab === t} aria-controls="acct-panel" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}{counts[t] !== undefined && <small className="muted"> {counts[t]}</small>}
          </button>
        ))}
      </div>

      <div id="acct-panel" role="tabpanel" aria-labelledby={`acct-tab-${tab}`} className="adm-stack">
        {tab === 'Profile' && (
          <dl className="adm-facts-list small">
            <div><dt>Account id</dt><dd className="mono row adm-idrow">{a.id} <CopyId value={a.id} label="Copy account id" /></dd></div>
            <div><dt>Discord</dt><dd>{a.discordId ? <>@{a.discordName} <span className="muted mono">{a.discordId}</span> <CopyId value={a.discordId} label="Copy Discord id" /></> : <span className="muted">none (demo account)</span>}</dd></div>
            <div><dt>First seen</dt><dd><RelTime ts={a.firstSeen} /></dd></div>
            <div><dt>Last seen</dt><dd><RelTime ts={a.lastSeen} /></dd></div>
            <div><dt>Addresses</dt><dd>{ips.length}</dd></div>
            <div><dt>Linked accounts</dt><dd>{d.linked.length}</dd></div>
          </dl>
        )}

        {tab === 'IP history' && (
          <>
            <p className="muted small">Every address this account has connected from, newest first. Banning one bars everyone on it.</p>
            {ips.length === 0 && <p className="muted small">None recorded.</p>}
            <ul className="adm-rows">
              {ips.map(([ip, c]) => (
                <li key={ip} className="adm-ip">
                  <span title={c.country ?? 'unknown country'} role="img" aria-label={c.country ?? 'unknown country'}>{flag(c.country)}</span>
                  <span className="grow adm-ellipsis"><span className="mono">{ip}</span> <CopyId value={ip} label="Copy address" /> <span className="muted small">{c.country ?? '??'} · {c.count}× · first <RelTime ts={c.first} /> · last <RelTime ts={c.last} /></span></span>
                  <button className="btn tiny ghost adm-danger-text" onClick={() => setBan({ kind: 'ip', value: ip, accountId: a.id, name: a.name, scope: 'lifetime', ips: [ip] })}>Ban IP…</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'Linked' && (
          <>
            <p className="muted small">Accounts that have shared an address with this one — alts, or a household.</p>
            {d.linked.length === 0 ? <p className="muted small">None.</p> : (
              <ul className="adm-rows">
                {d.linked.map(l => (
                  <li key={l.id}>
                    <button className="adm-rowbtn" onClick={() => onOpen(l.id)}>
                      <span className="grow adm-ellipsis"><b>{l.name}</b> <span className="muted small mono">{l.id}</span></span>
                      <span className="muted small">open →</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 'Actions' && (
          <>
            <div className="adm-action-block">
              <h4>Ban</h4>
              <div className="row wrap">
                <button className="btn small danger" onClick={() => setBan({ kind: 'player', value: a.id, accountId: a.id, name: a.name, scope: 'lifetime', ips: ips.map(([ip]) => ip) })}>Ban account…</button>
                <span className="muted small">Opens the ban form: scope, duration presets and a required reason.</span>
              </div>
              {d.bans.length > 0 && (
                <ul className="adm-rows">{d.bans.map(b => <BanRow key={`${b.kind}${b.value}${b.scope}${b.gameId}`} ban={b} after={reload} />)}</ul>
              )}
            </div>

            <div className="adm-action-block">
              <h4>Chat mute</h4>
              {d.mute ? (
                <div className="row wrap">
                  <span className="tag warn">muted · {expiry(d.mute.until)} · by {d.mute.by}</span>
                  <button className="btn small" onClick={() => mute(0)}>Unmute</button>
                </div>
              ) : (
                <form className="adm-stack" onSubmit={e => { e.preventDefault(); void mute(MUTES[muteFor][1]); }}>
                  <div className="adm-seg" role="group" aria-label="Mute duration">
                    {MUTES.map(([label], i) => <button key={label} type="button" className={muteFor === i ? 'on' : ''} aria-pressed={muteFor === i} onClick={() => setMuteFor(i)}>{label}</button>)}
                  </div>
                  <div className="row wrap">
                    <input className="grow" value={muteWhy} maxLength={120} placeholder="Reason (for the operator log)" aria-label="Mute reason" onChange={e => setMuteWhy(e.target.value)} />
                    <button className="btn small" type="submit">Mute chat</button>
                  </div>
                </form>
              )}
            </div>

            {a.discordId && (
              <form className="adm-action-block adm-stack" onSubmit={e => {
                e.preventDefault();
                void act(() => post('/api/admin/dm', { discordId: a.discordId, text: dm }), { ok: 'DM sent' }).then(ok => { if (ok) setDm(''); });
              }}>
                <h4><label htmlFor="adm-dm">Direct message via the Discord bot</label></h4>
                <textarea id="adm-dm" value={dm} maxLength={1800} rows={3} placeholder={`Message to @${a.discordName}`} onChange={e => setDm(e.target.value)} />
                <div><button className="btn small" disabled={!dm.trim()}>Send DM</button></div>
              </form>
            )}

            <div className="adm-action-block">
              <h4>Danger zone</h4>
              <div className="row wrap">
                <button className="btn small ghost adm-danger-text" onClick={() => act(() => del(`/api/admin/accounts/${encodeURIComponent(a.id)}`), {
                  confirm: `Erase the audit history (addresses, first/last seen) of ${a.name}? Their bans stay. This cannot be undone.`,
                  ok: 'Audit history erased', after: onErased,
                })}>Erase history</button>
                <span className="muted small">Removes addresses and first/last seen. Bans stay.</span>
              </div>
            </div>
          </>
        )}
      </div>

      {ban && <BanDialog target={ban} onClose={() => setBan(null)} onDone={reload} />}
    </section>
  );
}
