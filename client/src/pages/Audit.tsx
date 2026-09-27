import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useToast } from '../toast';
import BanDialog, { type BanTarget } from '../components/BanDialog';
import { api } from '../api';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import CopyId, { discordIdOf } from '../components/CopyId';
import { IconArrowLeft, IconRefresh, IconShield } from '../components/icons';
import { chips, timeAgo } from '../format';

type Tab = 'flags' | 'lookup' | 'players' | 'alts' | 'devices' | 'pairs' | 'actions' | 'events' | 'ipcheck';

const RANK: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT = ['\u2660', '\u2665', '\u2666', '\u2663'];
const cardText = (c: { r: number; s: number }) => `${RANK[c.r] ?? c.r}${SUIT[c.s] ?? ''}`;

// A long-lived account collects dozens of addresses, and printing all of them
// turned one row into a 375px wall of digits that squeezed every other column
// — the last one straight off the edge of the panel. Show the few that matter
// and keep the rest a click away.
const IPS_SHOWN = 6;

function IpList({ ips }: { ips: string[] }) {
  const [all, setAll] = useState(false);
  if (ips.length === 0) return <>—</>;
  // Most recent first: audit.ts appends, so the tail is where "where are they
  // now" lives, and that is the question this column is usually asked.
  const ordered = [...ips].reverse();
  const shown = all ? ordered : ordered.slice(0, IPS_SHOWN);
  const rest = ordered.length - shown.length;
  return (
    <>
      {shown.join(', ')}
      {rest > 0 && (
        <button type="button" className="ip-more" onClick={() => setAll(true)}>
          +{rest} more
        </button>
      )}
      {all && ordered.length > IPS_SHOWN && (
        <button type="button" className="ip-more" onClick={() => setAll(false)}>
          show fewer
        </button>
      )}
    </>
  );
}

export default function Audit() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('flags');
  const [copied, setCopied] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.audit>> | null>(null);
  const [actions, setActions] = useState<Awaited<ReturnType<typeof api.auditActions>>['actions']>([]);
  const [focus, setFocus] = useState<string | null>(null); // playerId filter
  // One account at a time. The shared-address panel answers "which addresses
  // carry more than one account", which is a different question from "does
  // THIS player have alts" and much harder to read when that is the one you
  // have.
  const [lookupQ, setLookupQ] = useState('');
  const [lookup, setLookup] = useState<Awaited<ReturnType<typeof api.playerConnections>> | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [ipInfo, setIpInfo] = useState<Awaited<ReturnType<typeof api.ipDebug>> | null>(null);
  const [ipErr, setIpErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Event logs: what each game DID, minute by minute. Read through the app
  // rather than by opening the endpoint directly — admin calls carry the
  // signed-in token, and a plain browser tab has no way to send it.
  const [evGames, setEvGames] = useState<Awaited<ReturnType<typeof api.eventGames>>['games'] | null>(null);
  const [evText, setEvText] = useState<string>('');
  const [evPicked, setEvPicked] = useState<string>('');
  const [evErr, setEvErr] = useState<string | null>(null);
  const [evCopied, setEvCopied] = useState(false);
  // Shown in place when the clipboard refuses the full report.
  const [reportText, setReportText] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.audit());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (tab !== 'events') return;
    let stale = false;
    setEvErr(null);
    api.eventGames()
      .then(r => {
        if (stale) return;
        setEvGames(r.games);
        // Default to the most recent game, which is nearly always the question.
        if (!evPicked && r.games.length) setEvPicked(r.games[0].gameId);
      })
      .catch(e => { if (!stale) setEvErr(e instanceof Error ? e.message : 'Could not load'); });
    return () => { stale = true; };
  }, [tab, evPicked]);

  useEffect(() => {
    if (tab !== 'events' || !evPicked) return;
    let stale = false;
    setEvErr(null);
    api.eventLog(evPicked)
      .then(t => { if (!stale) setEvText(t); })
      .catch(e => { if (!stale) { setEvText(''); setEvErr(e instanceof Error ? e.message : 'Could not load'); } });
    return () => { stale = true; };
  }, [tab, evPicked]);

  useEffect(() => {
    if (tab !== 'actions') return;
    let stale = false;
    api.auditActions(focus ?? undefined)
      .then(r => { if (!stale) setActions(r.actions); })
      .catch(() => {});
    return () => { stale = true; };
  }, [tab, focus]);

  const toast = useToast();
  const [pendingBan, setPendingBan] = useState<(BanTarget & { value: string }) | null>(null);

  if (!profile?.isAdmin) return <Navigate to="/" replace />;

  // Banning from here is the natural flow: this is the screen where a cheat
  // gets identified, so the action belongs on the row that proves it. These
  // are the lifetime ones — a single event is barred from that event's own
  // screen, where the game is unambiguous.
  const confirmBan = async (reason: string, discordBan: boolean, banPlayers: boolean) => {
    if (!pendingBan) return;
    const { value, name, kind } = pendingBan;
    setPendingBan(null);
    try {
      const r = await api.ban({ kind, scope: 'lifetime', value, name, reason, discordBan, banPlayers });
      const gone = r.ejected.tournaments + r.ejected.tables;
      const also = r.alsoBanned?.length
        ? ` — and ${r.alsoBanned.length} account${r.alsoBanned.length === 1 ? '' : 's'}: ${r.alsoBanned.join(', ')}`
        : '';
      const base = (gone
        ? `${name} suspended, and removed from ${gone} live game${gone === 1 ? '' : 's'}`
        : `${name} suspended`) + also;
      // A Discord ban that quietly did not happen is worse than one never
      // attempted — the operator would believe they were gone.
      const failed = !!r.discordNote && /NOT on Discord/.test(r.discordNote);
      toast(failed ? 'error' : 'success', r.discordNote ? `${base}. ${r.discordNote}` : base);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not ban');
    }
  };

  // Clearing an account out of the audit. This is housekeeping — test and demo
  // sign-ins that were never really players — so it asks first and says plainly
  // that it is not a ban, and it never touches a flag that indicts someone else.
  const forget = async (p: { id: string; name: string; handsPlayed: number }) => {
    const played = p.handsPlayed > 0
      ? `\n\nThey have ${p.handsPlayed} hand${p.handsPlayed === 1 ? '' : 's'} on record, which will go too.`
      : '';
    if (!window.confirm(
      `Remove ${p.name} from the audit?${played}`
      + '\n\nThis clears their record and their moves. It is not a ban — if they '
      + 'come back they are recorded again.',
    )) return;
    try {
      const r = await api.auditForgetPlayer(p.id);
      toast('success', r.actions
        ? `Removed ${p.name} and ${r.actions} move${r.actions === 1 ? '' : 's'}`
        : `Removed ${p.name}`);
      await load();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not remove');
    }
  };

  // Banning one router of four achieves nothing, so the panel offers the whole
  // group at once. It is still a lifetime address ban with everything that
  // implies, so it asks first and names the count.
  const banEveryAddress = async (ips: string[], names: string[]) => {
    const ok = window.confirm(
      `Lifetime ban on ${ips.length} addresses?\n\n${ips.join('\n')}\n\n`
      + `This also suspends the ${names.length} account${names.length === 1 ? '' : 's'} `
      + `behind them:\n${names.join(', ')}\n\n`
      + 'Anyone who merely shares a carrier or a household with the group is '
      + 'caught as well.');
    if (!ok) return;
    let done = 0;
    for (const ip of ips) {
      try {
        await api.ban({
          kind: 'ip', scope: 'lifetime', value: ip, name: ip,
          reason: 'shared-address group', banPlayers: true,
        });
        done += 1;
      } catch (e) {
        toast('error', `${ip}: ${e instanceof Error ? e.message : 'ban failed'}`);
      }
    }
    if (done > 0) toast('success', `${done} of ${ips.length} addresses banned, with the accounts behind them`);
    void load();
  };

  // One tap to get everything as plain text — for sharing or a second opinion.
  const copyReport = async () => {
    let text: string;
    try {
      text = await api.auditReport();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not load the report');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (it needs https and permission). Show the report on
      // the page to be selected by hand — opening the endpoint in a tab looks
      // like the obvious fallback and cannot work, because admin requests are
      // proved by a token this app holds and a bare tab cannot send it.
      setReportText(text);
      toast('info', 'Clipboard blocked — the report is below, select and copy it.');
    }
  };

  const runLookup = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setLookupBusy(true);
    setLookupErr(null);
    try {
      setLookup(await api.playerConnections(query));
    } catch (e) {
      setLookup(null);
      setLookupErr(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLookupBusy(false);
    }
  };

  // Loaded on demand rather than with the rest of the page: these are raw
  // connection headers, and there is no reason to hold them unless asked for.
  const loadIpCheck = useCallback(async () => {
    setIpErr(null);
    try {
      setIpInfo(await api.ipDebug());
    } catch (e) {
      setIpErr(e instanceof Error ? e.message : 'Could not read the address check');
    }
  }, []);
  useEffect(() => { if (tab === 'ipcheck' && !ipInfo) void loadIpCheck(); }, [tab, ipInfo, loadIpCheck]);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'lookup', label: 'Find a player' },
    { key: 'flags', label: `Flagged hands${data ? ` (${data.flagged.length})` : ''}` },
    { key: 'players', label: `Players${data ? ` (${data.players.length})` : ''}` },
    { key: 'alts', label: `Shared IPs${data ? ` (${data.alts.length})` : ''}` },
    { key: 'devices', label: `Shared devices${data ? ` (${data.devices.length})` : ''}` },
    { key: 'pairs', label: `Chip flow${data ? ` (${data.pairs.length})` : ''}` },
    { key: 'actions', label: 'Move log' },
    { key: 'events', label: 'Event logs' },
    { key: 'ipcheck', label: 'Address check' },
  ];

  return (
    <main className="page">
      {pendingBan && (
        <BanDialog
          target={pendingBan}
          onConfirm={(r, d, bp) => void confirmBan(r, d, bp)}
          onCancel={() => setPendingBan(null)}
        />
      )}
      <div className="page-head">
        <h2><IconShield size={21} /> Audit</h2>
        {data && (
          <span className="online-pill">
            {data.counts.players} players · {data.counts.actions} moves logged
          </span>
        )}
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => void copyReport()}>
          {copied ? 'Copied \u2713' : 'Copy full report'}
        </button>
        <button className="btn btn-sm" onClick={() => void load()}><IconRefresh /> Refresh</button>
        <Link className="btn btn-ghost btn-sm" to="/lobby"><IconArrowLeft /> Dashboard</Link>
      </div>

      {err && <div className="empty-note">{err}</div>}

      {reportText && (
        <div className="panel">
          <div className="audit-note" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>The full report — select it all and copy.</span>
            <button className="btn btn-sm" onClick={() => setReportText('')}>Hide</button>
          </div>
          <pre className="event-log">{reportText}</pre>
        </div>
      )}

      <div className="audit-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`audit-tab${tab === t.key ? ' sel' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!data ? <div className="empty-note">Loading…</div> : (
        <div className="panel" style={{ overflowX: 'auto' }}>
          {tab === 'lookup' && (
            <>
              <p className="audit-note">
                Start from one account and walk outwards. Paste a Discord id, a
                Discord tag, a site id or a name. It reports that player's own
                addresses, every other account ever seen on them, and accounts
                reached one further step along — an alt of an alt is the shape
                somebody takes when they are trying not to be obvious. It will
                not step through a crowded address: a mobile network or a VPN
                exit puts hundreds of strangers behind one, and hopping through
                those would eventually connect the whole site to itself.
              </p>
              <div className="lookup-bar">
                <input
                  className="input" placeholder="Discord id, @tag, or name"
                  value={lookupQ}
                  onChange={e => setLookupQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void runLookup(lookupQ); }}
                />
                <button className="btn btn-primary" disabled={lookupBusy}
                  onClick={() => void runLookup(lookupQ)}>
                  {lookupBusy ? 'Looking…' : 'Look up'}
                </button>
              </div>

              {lookupErr && <div className="empty-note">{lookupErr}</div>}

              {lookup && (
                <div className="lookup-result">
                  <div className="lookup-subject">
                    <Avatar value={lookup.subject.avatar} size={30} />
                    <div>
                      <div className="lookup-name">
                        {lookup.subject.name}
                        {lookup.subject.discordTag && (
                          <span className="alt-country">@{lookup.subject.discordTag}</span>
                        )}
                      </div>
                      <div className="lookup-sub">
                        <CopyId value={lookup.subject.id} title={`Site id — click to copy ${lookup.subject.id}`} />
                        {discordIdOf(lookup.subject.id) && (
                          <CopyId
                            value={discordIdOf(lookup.subject.id)!}
                            label={`Discord ${discordIdOf(lookup.subject.id)}`}
                            title={`Discord id — click to copy ${discordIdOf(lookup.subject.id)}`}
                          />
                        )}
                        <span className="mono">
                          {lookup.subject.handsPlayed} hands · {lookup.subject.games} games ·{' '}
                          last seen {timeAgo(lookup.subject.lastSeen)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="lookup-verdict">{lookup.verdict}</div>

                  <h4 className="lookup-h">Their addresses</h4>
                  {lookup.addresses.length === 0 ? (
                    <div className="empty-note">
                      No address recorded for this account. Anything from before
                      the proxy handling was corrected was filed under our own
                      infrastructure and is deliberately excluded.
                    </div>
                  ) : (
                    <table className="standings-table">
                      <thead><tr><th>Address</th><th>Country</th><th>Accounts on it</th><th /></tr></thead>
                      <tbody>
                        {lookup.addresses.map(a => (
                          <tr key={a.ip}>
                            <td className="mono">{a.ip}</td>
                            <td>{a.country ?? '—'}</td>
                            <td>
                              {a.accounts}
                              {a.accounts > 8 && (
                                <span className="alt-reason" style={{ marginLeft: 6 }}>
                                  carrier-sized — weak signal
                                </span>
                              )}
                            </td>
                            <td>
                              <button
                                className="btn btn-danger btn-sm"
                                title="Lifetime IP ban — removes EVERY account on this address"
                                onClick={() => setPendingBan({ value: a.ip, name: a.ip, kind: 'ip', scope: 'lifetime' })}
                              >Ban address</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <h4 className="lookup-h">Linked accounts ({lookup.linked.length})</h4>
                  {lookup.linked.length === 0 ? (
                    <div className="empty-note">
                      No other account has ever been seen from this player's addresses.
                    </div>
                  ) : (
                    <table className="standings-table">
                      <thead>
                        <tr>
                          <th>Account</th><th>Link</th><th>Group size</th>
                          <th>Games together</th><th>Hands</th><th>Last seen</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {lookup.linked.map(l => (
                          <tr key={l.id}>
                            <td>
                              <div><Avatar value={l.avatar} size={16} /> {l.name}
                                {l.discordTag && <span className="alt-country">@{l.discordTag}</span>}
                              </div>
                              <div className="id-cell">
                                <CopyId value={l.id} title={`Site id — click to copy ${l.id}`} />
                                {discordIdOf(l.id) && (
                                  <CopyId
                                    value={discordIdOf(l.id)!}
                                    label={`Discord ${discordIdOf(l.id)}`}
                                    title={`Discord id — click to copy ${discordIdOf(l.id)}`}
                                  />
                                )}
                              </div>
                            </td>
                            <td className="mono">
                              {l.hops === 1
                                ? l.sharedIps.join(', ')
                                : `${l.hops} steps, via ${l.via}`}
                            </td>
                            <td>
                              {l.crowd}
                              {l.crowd > 8 && (
                                <span className="alt-reason" style={{ marginLeft: 6 }}>carrier</span>
                              )}
                            </td>
                            <td className={l.playedTogether > 0 ? 'alt-hot' : ''}>{l.playedTogether}</td>
                            <td>{l.handsPlayed}</td>
                            <td>{timeAgo(l.lastSeen)}</td>
                            <td>
                              <button className="btn btn-sm"
                                onClick={() => { setLookupQ(l.id); void runLookup(l.id); }}>
                                Follow
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="audit-note">
                    Sharing an address is a prompt to look, never proof. Read the
                    hands in Chip flow and Flagged hands before acting on any of this.
                  </p>
                </div>
              )}
            </>
          )}

          {tab === 'ipcheck' && (
            <>
              <p className="audit-note">
                Whether address detection is working at all. Everything else on
                this page is worthless if it is not: get the proxy hop count
                wrong and every player is filed under whichever proxy they
                arrived through, which is exactly what happened before, silently,
                for weeks. Compare the raw chain each connection delivered against
                what we resolved from it.
              </p>
              {ipErr && <div className="empty-note">{ipErr}</div>}
              {!ipInfo ? <div className="empty-note">Reading…</div> : (
                <>
                  {/* Zero comparable connections is not a clean bill of
                      health — it is no evidence either way, and reading it as
                      "working" is how a broken hop count stays unnoticed. */}
                  <div className={`lookup-verdict${
                    ipInfo.hopCount.samples === 0 ? '' : ipInfo.hopCount.healthy ? '' : ' bad'}`}
                  >
                    {ipInfo.hopCount.samples === 0
                      ? 'Cannot tell yet: '
                      : ipInfo.hopCount.healthy ? 'Working: ' : 'Check this: '}
                    {ipInfo.hopCount.hint}
                  </div>
                  <div className="audit-note">
                    TRUSTED_PROXY_HOPS = <strong>{ipInfo.trustedProxyHops}</strong> ·{' '}
                    {ipInfo.hopCount.samples} connection(s) compared,{' '}
                    {ipInfo.hopCount.disagreeing} disagreeing
                  </div>

                  <h4 className="lookup-h">This connection — yours</h4>
                  <table className="standings-table">
                    <tbody>
                      <tr><td>x-forwarded-for</td><td className="mono">{ipInfo.you.forwardedFor ?? '—'}</td></tr>
                      <tr><td>x-real-ip</td><td className="mono">{ipInfo.you.realIp ?? '—'}</td></tr>
                      <tr><td>x-envoy-external-address</td><td className="mono">{ipInfo.you.envoyExternal ?? '—'}</td></tr>
                      <tr><td>cf-connecting-ip</td><td className="mono">{ipInfo.you.cfConnecting ?? '—'}</td></tr>
                      <tr><td>socket peer</td><td className="mono">{ipInfo.you.socketPeer ?? '—'}</td></tr>
                    </tbody>
                  </table>

                  <h4 className="lookup-h">Recent connections ({ipInfo.recent.length})</h4>
                  <table className="standings-table">
                    <thead>
                      <tr><th>When</th><th>Who</th><th>Chain delivered</th><th>Proxy says</th><th>We recorded</th></tr>
                    </thead>
                    <tbody>
                      {ipInfo.recent.map((r, i) => (
                        <tr key={`${r.at}-${i}`} className={r.realIp && r.resolved && r.realIp !== r.resolved ? 'busted' : ''}>
                          <td>{timeAgo(r.at)}</td>
                          <td>{r.who ?? '—'}</td>
                          <td className="mono">{r.forwardedFor ?? '—'}</td>
                          <td className="mono">{r.realIp ?? r.envoyExternal ?? '—'}</td>
                          <td className="mono">{r.resolved ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ipInfo.recent.length === 0 && (
                    <div className="empty-note">
                      Nothing recorded since the last restart — this is memory only,
                      never written to disk. Have someone connect and refresh.
                    </div>
                  )}
                  <button className="btn btn-sm" onClick={() => void loadIpCheck()}>
                    <IconRefresh /> Refresh
                  </button>
                </>
              )}
            </>
          )}

          {tab === 'flags' && (
            data.flagged.length === 0 ? (
              <p style={{ color: 'var(--text-faint)' }}>
                No hands flagged. This looks for chips lost with a holding that could not
                justify the bet — the shape of a deliberate donation.
              </p>
            ) : (
              <>
                <p className="field-hint" style={{ marginBottom: 10 }}>
                  Hands where someone committed a big share of their stack with a holding that
                  did not justify it. <strong>Advisory only</strong> — loose players trip these
                  honestly, so read the hand before acting. Repeats against the <em>same</em>
                  opponent are what matter.
                </p>
                <table className="standings-table">
                  <thead>
                    <tr><th>When</th><th>Table</th><th>Player</th><th>Held</th><th>Lost</th><th>To</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {data.flagged.map((f, i) => (
                      <tr key={`${f.playerId}-${f.handNumber}-${i}`}>
                        <td>{timeAgo(f.ts)}</td>
                        <td>{f.tableName} #{f.handNumber}</td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => { setFocus(f.playerId); setTab('actions'); }}>{f.playerName}</button></td>
                        <td style={{ fontWeight: 700 }}>{f.cards.map(cardText).join(' ')}</td>
                        <td>{chips(f.chips)} <span style={{ color: 'var(--text-faint)' }}>({f.stackPct}%)</span></td>
                        <td>{f.toName ?? '\u2014'}</td>
                        <td style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          )}

          {tab === 'players' && (
            <>
            {/* Said before the table rather than left to be counted by eye:
                switching the block on is not reversible from inside a blocked
                browser, so the number of people it would turn away is the one
                thing worth knowing first. */}
            {(() => {
              const hit = data.players.filter(p => p.vpn);
              if (hit.length === 0) return null;
              return (
                <p className="audit-note vpn-note">
                  <strong>{hit.length}</strong> of {data.players.length} accounts are on a VPN or
                  datacenter address right now: {hit.map(p => p.name).join(', ')}. With the VPN
                  block switched on, they would be refused at the front page. Add their addresses
                  to <code>VPN_ALLOW_IPS</code>, or give yourself a <code>VPN_BYPASS_KEY</code>,
                  before turning it on.
                </p>
              );
            })()}
            <div className="table-scroll">
            <table className="standings-table wide">
              <thead>
                <tr><th>Player</th><th>Discord</th><th>IPs</th><th>Country</th><th>Hands</th><th>Games</th><th>Last seen</th><th /><th /><th /></tr>
              </thead>
              <tbody>
                {data.players.map(p => (
                  <tr key={p.id}>
                    <td><Avatar value={p.avatar} size={16} /> {p.name}</td>
                    <td>{p.discordTag ? <span className="discord-badge verified">@{p.discordTag}</span> : '—'}</td>
                    <td className="mono">
                      {p.vpn && (
                        <span className={`vpn-flag ${p.vpn}`} title={
                          p.vpn === 'vpn'
                            ? 'Their most recent address belongs to a commercial VPN. With the VPN block on, they would be turned away.'
                            : 'Their most recent address is a hosting or datacenter network, not a home connection. With the VPN block on, they would be turned away.'
                        }>{p.vpn === 'vpn' ? 'VPN' : 'DC'}</span>
                      )}
                      <IpList ips={p.ips} />
                    </td>
                    <td>{[...new Set(p.countries.filter(Boolean))].join(', ') || '—'}</td>
                    <td>{p.handsPlayed}</td>
                    <td>{p.games}</td>
                    <td>{timeAgo(p.lastSeen)}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-danger"
                        title="Lifetime ban for this account (covers their Discord too)"
                        onClick={() => setPendingBan({
                          value: p.id, name: p.name, kind: 'player', scope: 'lifetime',
                          discordLinked: !!discordIdOf(p.id),
                        })}
                      >
                        Lifetime ban
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => { setFocus(p.id); setTab('actions'); }}>
                        Moves
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-ghost"
                        title="Clear this account out of the audit. Housekeeping, not a ban — they are recorded again if they come back."
                        onClick={() => void forget(p)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {data.players.length === 0 && (
                  <tr><td colSpan={10} style={{ color: 'var(--text-faint)' }}>Nobody has connected yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
            </>
          )}

          {tab === 'alts' && (
            <>
              <p className="audit-note">
                Accounts seen from the same address. Shared connections and phone networks
                produce false positives — treat this as a prompt to look, not proof.
              </p>
              {data.alts.map(g => (
                <div key={g.key} className="alt-group">
                  <div className="alt-head">
                    <span
                      className={`alt-score${g.score >= 70 ? ' hot' : g.score >= 40 ? ' warm' : ''}`}
                      title="How much this group is worth reading — not a probability of guilt"
                    >
                      {g.score}
                    </span>
                    <span className="alt-title">
                      {g.players.length} accounts
                      {g.addresses.length > 1 && ` · ${g.addresses.length} addresses`}
                    </span>
                    <div className="alt-reasons">
                      {g.reasons.map(r => <span key={r} className="alt-reason">{r}</span>)}
                    </div>
                  </div>

                  <div className="alt-players">
                    {g.players.map(p => (
                      <span key={p.id} className="alt-chip">
                        <span className="alt-chip-name">
                          {p.name}{p.discordTag && p.discordTag !== p.name ? ` · @${p.discordTag}` : ''}
                        </span>
                        <CopyId
                          value={discordIdOf(p.id) ?? p.id}
                          label={discordIdOf(p.id) ?? p.id}
                          title={`Click to copy ${discordIdOf(p.id) ?? p.id}`}
                        />
                        <button
                          className="alt-follow"
                          title={`Look this account up on its own`}
                          onClick={() => { setLookupQ(p.id); setTab('lookup'); void runLookup(p.id); }}
                        >
                          look up
                        </button>
                        {/* The account itself, not the router it sits behind.
                            This panel is where an alt is identified, so the
                            action that follows belongs on the person. */}
                        <button
                          className="alt-ban"
                          title={`Lifetime ban on ${p.name}'s account`}
                          onClick={() => setPendingBan({
                            value: p.id, name: p.name, kind: 'player', scope: 'lifetime',
                            discordLinked: !!discordIdOf(p.id),
                          })}
                        >
                          ban
                        </button>
                      </span>
                    ))}
                  </div>

                  {/* Every address the group has been seen from, each bannable
                      on its own. A group-wide ban is offered too, because
                      banning one router of four achieves nothing — but it is
                      spelled out, since it reaches everyone behind all of them. */}
                  <div className="alt-addrs">
                    {g.addresses.map(a => (
                      <span key={a.ip} className="alt-addr mono">
                        {a.ip}
                        {a.country ? <span className="alt-country">{a.country}</span> : null}
                        <button
                          className="alt-ban"
                          title={`Lifetime ban on ${a.ip} — removes every account ever seen from it`}
                          onClick={() => setPendingBan({
                            value: a.ip, name: a.ip, kind: 'ip', scope: 'lifetime',
                            accounts: a.accounts,
                          })}
                        >
                          ban
                        </button>
                      </span>
                    ))}
                    {g.addresses.length > 1 && (
                      <button
                        className="btn btn-sm btn-danger"
                        title={`Lifetime ban on all ${g.addresses.length} addresses — reaches every account behind any of them`}
                        onClick={() => void banEveryAddress(
                          g.addresses.map(a => a.ip),
                          [...new Set(g.addresses.flatMap(a => a.accounts.map(x => x.name)))],
                        )}
                      >
                        Ban all {g.addresses.length}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {data.alts.length === 0 && <div className="empty-note">No shared addresses.</div>}
            </>
          )}

          {tab === 'devices' && (
            <>
              <p className="audit-note">
                Accounts that have signed in from the <strong>same browser</strong>. This is the
                signal an address cannot give: an alt on a hotspot, a second SIM or a friend's
                wifi has a different address every time and the same phone every time. A{' '}
                <strong>same browser</strong> group is one browser that has held several
                accounts — a fact about that browser. A <strong>same traits</strong> group is
                browsers that report identical hardware and settings — a hint, because two of the
                same phone on the same OS version look alike; one that also shares an address is
                a much stronger hint.
              </p>
              {data.devices.map(g => (
                <div key={g.key} className={`alt-group${g.strength === 'device' ? ' device-group' : ''}`}>
                  <div className="alt-head">
                    <span className="alt-title">
                      {g.strength === 'device' ? 'Same browser' : 'Same traits'} · {g.players.length} accounts
                    </span>
                    <div className="alt-reasons">
                      <span className="alt-reason">
                        {g.strength === 'device' ? 'stored browser id matches' : 'hardware and settings match'}
                      </span>
                      {g.sharedIps.length > 0 && (
                        <span className="alt-reason">also share {g.sharedIps.length} address{g.sharedIps.length === 1 ? '' : 'es'}</span>
                      )}
                      <span className="alt-reason">last seen {timeAgo(g.lastSeen)}</span>
                    </div>
                  </div>
                  <div className="alt-players">
                    {g.players.map(p => (
                      <span key={p.id} className="alt-chip">
                        <span className="alt-chip-name">
                          {p.name}{p.discordTag && p.discordTag !== p.name ? ` · @${p.discordTag}` : ''}
                        </span>
                        <CopyId
                          value={discordIdOf(p.id) ?? p.id}
                          label={discordIdOf(p.id) ?? p.id}
                          title={`Click to copy ${discordIdOf(p.id) ?? p.id}`}
                        />
                        <button
                          className="alt-follow"
                          title="Look this account up on its own"
                          onClick={() => { setLookupQ(p.id); setTab('lookup'); void runLookup(p.id); }}
                        >
                          look up
                        </button>
                        <button
                          className="alt-ban"
                          title={`Lifetime ban on ${p.name}'s account`}
                          onClick={() => setPendingBan({
                            value: p.id, name: p.name, kind: 'player', scope: 'lifetime',
                            discordLinked: !!discordIdOf(p.id),
                          })}
                        >
                          ban
                        </button>
                      </span>
                    ))}
                  </div>
                  {g.sharedIps.length > 0 && (
                    <div className="alt-addrs">
                      {g.sharedIps.map(ip => <span key={ip} className="alt-addr mono">{ip}</span>)}
                    </div>
                  )}
                </div>
              ))}
              {data.devices.length === 0 && (
                <div className="empty-note">
                  No two accounts have signed in from the same browser yet. Browsers are only
                  recorded from now on, so this fills in as people connect.
                </div>
              )}
            </>
          )}

          {tab === 'pairs' && (
            <>
              <p className="audit-note">
                Pairs who played enough hands together, or who have any flagged hand between
                them, ordered by flagged donations first and then by how one-sided the chip
                flow was. A large one-way number plus flagged hands is what dumping looks like.
              </p>
              <table className="standings-table">
                <thead>
                  <tr><th>Pair</th><th>Heads-up pots</th><th>Flagged</th><th>Net flow</th><th>Shared IP</th></tr>
                </thead>
                <tbody>
                  {data.pairs.map(p => (
                    <tr key={`${p.a}-${p.b}`} className={p.sameIpOnly ? 'busted' : ''}>
                      <td>{p.aName} ↔ {p.bName}</td>
                      <td>{p.headsUpPots}</td>
                      <td>{p.dumpHands > 0
                        ? <strong style={{ color: 'var(--red, #e05d5d)' }}>{p.dumpHands} ({chips(p.dumpChips)})</strong>
                        : '—'}</td>
                      <td className={p.netAtoB >= 0 ? 'pos' : 'neg'}>
                        {p.netAtoB >= 0
                          ? `${p.aName} → ${p.bName} ${chips(Math.abs(p.netAtoB))}`
                          : `${p.bName} → ${p.aName} ${chips(Math.abs(p.netAtoB))}`}
                      </td>
                      <td className="mono">{p.sharedIps.join(', ') || '—'}</td>
                    </tr>
                  ))}
                  {data.pairs.length === 0 && (
                    <tr><td colSpan={5} style={{ color: 'var(--text-faint)' }}>
                      Nothing to review — pairs appear once they have played enough hands together.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}

          {tab === 'events' && (
            <>
              <div className="audit-note">
                Everything a game did, in order — registrations, the start, blind
                levels, eliminations, table breaks, players removed for
                inactivity, and every move made to balance the tables.
              </div>
              <div className="field" style={{ maxWidth: 460, marginBottom: 12 }}>
                <label>Game</label>
                <select className="input" value={evPicked} onChange={e => setEvPicked(e.target.value)}>
                  {evGames?.length === 0 && <option value="">No games have left a record yet</option>}
                  {evGames?.map(g => (
                    <option key={g.gameId} value={g.gameId}>
                      {g.gameName} — {g.events} events, {timeAgo(g.to)}
                    </option>
                  ))}
                </select>
              </div>
              {evErr && <div className="empty-note">{evErr}</div>}
              {evText && (
                <>
                  <button
                    className="btn btn-sm"
                    style={{ marginBottom: 10 }}
                    onClick={() => {
                      navigator.clipboard.writeText(evText).then(
                        () => { setEvCopied(true); setTimeout(() => setEvCopied(false), 2500); },
                        () => { /* clipboard blocked: the text is on screen to select */ },
                      );
                    }}
                  >
                    {evCopied ? 'Copied \u2713' : 'Copy this log'}
                  </button>
                  <pre className="event-log">{evText}</pre>
                </>
              )}
              {!evText && !evErr && evGames && evGames.length > 0 && (
                <div className="empty-note">Loading…</div>
              )}
            </>
          )}

          {tab === 'actions' && (
            <>
              <div className="audit-note" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {focus
                  ? <>Showing moves by <strong>{data.players.find(p => p.id === focus)?.name ?? focus}</strong></>
                  : <>Showing the most recent moves across all tables</>}
                {focus && <button className="btn btn-sm" onClick={() => setFocus(null)}>Show all</button>}
              </div>
              <table className="standings-table">
                <thead>
                  <tr><th>Time</th><th>Table</th><th>Hand</th><th>Player</th><th>Move</th><th>Pot</th></tr>
                </thead>
                <tbody>
                  {actions.map((a, i) => (
                    <tr key={i}>
                      <td>{new Date(a.ts).toLocaleTimeString()}</td>
                      <td>{a.tableName}</td>
                      <td>#{a.handNumber}</td>
                      <td>{a.playerName}</td>
                      <td>{a.action}</td>
                      <td>{chips(a.pot)}</td>
                    </tr>
                  ))}
                  {actions.length === 0 && (
                    <tr><td colSpan={6} style={{ color: 'var(--text-faint)' }}>No moves recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </main>
  );
}
