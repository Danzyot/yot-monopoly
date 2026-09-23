// Health at a glance, refreshed every few seconds, with anything that needs
// an operator's attention spelled out above the numbers.
import { span, usePoll, type Overview } from './adminApi.ts';

function warnings(o: Overview): { level: 'bad' | 'warn'; text: string }[] {
  const w: { level: 'bad' | 'warn'; text: string }[] = [];
  if (!o.persistentDisk) w.push({ level: 'bad', text: `No persistent disk: DATA_DIR is unset, so bans, results, graphics and live games (${o.dataDir}) are lost on redeploy. Attach a volume and set DATA_DIR.` });
  if (o.lastSnapshotAgeMs === null && o.uptimeSec > 15) w.push({ level: 'bad', text: 'Live rooms have never been saved since boot — check the data volume is writable.' });
  else if (o.lastSnapshotAgeMs !== null && o.lastSnapshotAgeMs > 30_000) w.push({ level: 'bad', text: `Last live-room snapshot was ${span(o.lastSnapshotAgeMs / 1000)} ago (normally every 5s) — the disk may be full or read-only.` });
  if (o.loopLagMs > 200) w.push({ level: o.loopLagMs > 1000 ? 'bad' : 'warn', text: `Event loop lag is ${o.loopLagMs} ms — the server is struggling; games will feel slow.` });
  if (o.rssMb > 800) w.push({ level: 'warn', text: `Memory use is high (${o.rssMb} MB).` });
  if (o.demoMode) w.push({ level: 'warn', text: 'DEMO_MODE is on: anyone can sign in with just a name. Turn it off for real events.' });
  if (!o.adminMode) w.push({ level: 'warn', text: 'ADMIN_DISCORD_IDS is unset: every signed-in account is an operator.' });
  if (!o.discordBot) w.push({ level: 'warn', text: 'No Discord bot token: the Verify panel, DMs and result announcements are unavailable.' });
  return w;
}

export default function OverviewTab() {
  const { data: o, error } = usePoll<Overview>('/api/admin/overview', 5_000);
  if (error && !o) return <p className="warn">{error}</p>;
  if (!o) return <p className="muted">Loading…</p>;
  const w = warnings(o);
  const yes = (v: boolean) => <b className={v ? 'adm-good' : 'adm-bad'}>{v ? 'yes' : 'no'}</b>;
  // [label, value, detail line, tooltip]
  const stats: [string, React.ReactNode, string?, string?][] = [
    ['Uptime', span(o.uptimeSec)],
    ['Players online', o.players, 'seated, connected', 'Seated humans with a live connection'],
    ['Sockets', o.sockets, 'open tabs', 'Every open browser tab, signed in or not'],
    ['Rooms', o.rooms, `${o.playing} playing`],
    ['Memory', `${o.rssMb} MB`, `heap ${o.heapMb} MB`],
    ['Loop lag', <span className={o.loopLagMs > 200 ? 'adm-bad' : ''}>{o.loopLagMs} ms</span>],
    ['Persistent disk', yes(o.persistentDisk), o.dataDir, o.dataDir],
    ['Last snapshot', o.lastSnapshotAgeMs === null ? <span className="muted">never</span> : `${span(o.lastSnapshotAgeMs / 1000)} ago`, 'live rooms'],
    ['Discord bot', yes(o.discordBot)],
    ['Graphics', o.graphics, 'images in the library'],
    ['Node', o.node],
  ];
  return (
    <div className="adm-stack">
      {w.length === 0
        ? <div className="adm-alert good">All systems normal.</div>
        : w.map(x => <div key={x.text} className={`adm-alert ${x.level}`}>{x.level === 'bad' ? '⛔' : '⚠️'} {x.text}</div>)}
      <div className="adm-stats">
        {stats.map(([label, value, detail, hint]) => (
          <div key={label} className="adm-stat" title={hint}>
            <span className="muted small">{label}</span>
            <b>{value}</b>
            {detail && <span className="muted small adm-ellipsis">{detail}</span>}
          </div>
        ))}
      </div>
      {error && <p className="warn small">Refresh failed: {error}</p>}
      <p className="muted small">Refreshes every 5 seconds.</p>
    </div>
  );
}
