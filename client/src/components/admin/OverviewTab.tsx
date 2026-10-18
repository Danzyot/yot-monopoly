// Health at a glance, refreshed every few seconds: colour-coded stat tiles
// with a short trend bar (history is kept here, between polls), and a
// "needs attention" list above them — stuck debts, bans about to lapse, no disk.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Refresh } from './bits.tsx';
import { span, usePoll, type AdminRoom, type Ban, type Overview } from './adminApi.ts';

type Level = 'good' | 'warn' | 'bad';
interface Item { level: Level | 'info'; text: React.ReactNode; to?: string }

/** Recent samples per metric, kept across tab switches (module scope). */
const HISTORY = new Map<string, number[]>();
const KEEP = 24;
function remember(key: string, v: number): number[] {
  const h = HISTORY.get(key) ?? [];
  h.push(v);
  while (h.length > KEEP) h.shift();
  HISTORY.set(key, h);
  return h;
}

/** First time a room was seen owing money, so "stuck for 5 min" survives re-polls. */
const DEBT_SINCE = new Map<string, number>();
const STUCK_MS = 5 * 60_000;
const SOON_MS = 60 * 60_000;

function Trend({ values, level }: { values: number[]; level: Level }) {
  if (values.length < 2) return <span className="adm-trend empty" aria-hidden />;
  const max = Math.max(1, ...values);
  return (
    <span className="adm-trend" aria-hidden>
      {values.map((v, i) => <i key={i} className={level} style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }} />)}
    </span>
  );
}

function attention(o: Overview, rooms: AdminRoom[] | null, bans: Ban[] | null): Item[] {
  const now = Date.now();
  const w: Item[] = [];
  if (!o.persistentDisk) w.push({ level: 'bad', text: <>No persistent disk: <code>DATA_DIR</code> is unset, so bans, results, graphics and live games ({o.dataDir}) are lost on redeploy. Attach a volume and set <code>DATA_DIR</code>.</> });
  if (o.lastSnapshotAgeMs === null && o.uptimeSec > 15) w.push({ level: 'bad', text: 'Live rooms have never been saved since boot — check the data volume is writable.' });
  else if (o.lastSnapshotAgeMs !== null && o.lastSnapshotAgeMs > 30_000) w.push({ level: 'bad', text: `Last live-room snapshot was ${span(o.lastSnapshotAgeMs / 1000)} ago (normally every 5s) — the disk may be full or read-only.` });
  if (o.loopLagMs > 200) w.push({ level: o.loopLagMs > 1000 ? 'bad' : 'warn', text: `Event loop lag is ${o.loopLagMs} ms — the server is struggling; games will feel slow.` });
  if (o.rssMb > 800) w.push({ level: 'warn', text: `Memory use is high (${o.rssMb} MB).` });

  for (const r of rooms ?? []) {
    const owing = r.status === 'playing' && r.debts > 0 && !r.paused;
    if (!owing) { DEBT_SINCE.delete(r.code); continue; }
    const since = DEBT_SINCE.get(r.code) ?? now;
    DEBT_SINCE.set(r.code, since);
    const overdue = r.debtDeadline !== null && now - r.debtDeadline > STUCK_MS;
    if (overdue || now - since > STUCK_MS) {
      w.push({ level: 'warn', to: `/admin/rooms?q=${r.code}`, text: `Room ${r.code} has had ${r.debts} unpaid debt${r.debts === 1 ? '' : 's'} for ${span((now - Math.min(since, r.debtDeadline ?? since)) / 1000)} — the game may be stuck. Open it under Rooms and use Fix game.` });
    }
  }

  const soon = (bans ?? []).filter(b => b.expiresAt !== null && b.expiresAt - now < SOON_MS && b.expiresAt > now);
  if (soon.length) {
    w.push({ level: 'info', to: '/admin/bans', text: `${soon.length} ban${soon.length === 1 ? '' : 's'} expire${soon.length === 1 ? 's' : ''} within the hour: ${soon.slice(0, 4).map(b => b.name || b.value).join(', ')}${soon.length > 4 ? '…' : ''}.` });
  }

  if (o.demoMode) w.push({ level: 'warn', text: 'DEMO_MODE is on: anyone can sign in with just a name. Turn it off for real events.' });
  if (!o.adminMode) w.push({ level: 'warn', text: 'ADMIN_DISCORD_IDS is unset: every signed-in account is an operator.' });
  if (!o.discordBot) w.push({ level: 'info', text: 'No Discord bot token: the Verify panel, DMs and result announcements are unavailable.' });
  return w;
}

export default function OverviewTab() {
  const EVERY = 5_000;
  const { data: o, error, at, loading } = usePoll<Overview>('/api/admin/overview', EVERY);
  const rooms = usePoll<AdminRoom[]>('/api/admin/rooms', EVERY);
  const bans = usePoll<Ban[]>('/api/admin/bans', 30_000);
  // One sample per poll, not per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trends = useMemo(() => (o ? {
    rooms: remember('rooms', o.rooms), players: remember('players', o.players), sockets: remember('sockets', o.sockets),
    lag: remember('lag', o.loopLagMs), rss: remember('rss', o.rssMb),
  } : null), [at]);
  if (error && !o) return <p className="warn" role="alert">{error}</p>;
  if (!o) return <div className="adm-stats" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk sk-tile" />)}</div>;

  const list = attention(o, rooms.data, bans.data);
  const lagLevel: Level = o.loopLagMs > 1000 ? 'bad' : o.loopLagMs > 200 ? 'warn' : 'good';
  const memLevel: Level = o.rssMb > 1200 ? 'bad' : o.rssMb > 800 ? 'warn' : 'good';
  const snapLevel: Level = o.lastSnapshotAgeMs === null ? (o.uptimeSec > 15 ? 'bad' : 'warn') : o.lastSnapshotAgeMs > 30_000 ? 'bad' : 'good';
  const diskLevel: Level = o.persistentDisk ? 'good' : 'bad';

  interface Tile { label: string; value: React.ReactNode; detail?: React.ReactNode; level?: Level; trend?: number[]; hint?: string; icon: string }
  const tiles: Tile[] = [
    { icon: '🎲', label: 'Rooms live', value: o.rooms, detail: `${o.playing} playing`, trend: trends?.rooms, level: 'good' },
    { icon: '👥', label: 'Players online', value: o.players, detail: 'seated & connected', hint: 'Seated humans with a live connection', trend: trends?.players, level: 'good' },
    { icon: '🔌', label: 'Sockets', value: o.sockets, detail: 'open tabs', hint: 'Every open browser tab, signed in or not', trend: trends?.sockets, level: 'good' },
    { icon: '⏱', label: 'Uptime', value: span(o.uptimeSec), detail: `Node ${o.node}`, level: 'good' },
    { icon: '〰️', label: 'Loop lag', value: `${o.loopLagMs} ms`, detail: lagLevel === 'good' ? 'under 200 ms' : lagLevel === 'warn' ? 'over 200 ms' : 'over 1 s', level: lagLevel, trend: trends?.lag },
    { icon: '🧠', label: 'Memory', value: `${o.rssMb} MB`, detail: `heap ${o.heapMb} MB`, level: memLevel, trend: trends?.rss },
    { icon: '💾', label: 'Persistent disk', value: o.persistentDisk ? 'yes' : 'no', detail: o.dataDir, hint: o.dataDir, level: diskLevel },
    { icon: '📸', label: 'Last snapshot', value: o.lastSnapshotAgeMs === null ? 'never' : `${span(o.lastSnapshotAgeMs / 1000)} ago`, detail: 'live rooms, every 5s', level: snapLevel },
  ];

  return (
    <div className="adm-stack">
      <div className="row between wrap">
        <h2 className="adm-h2">Overview</h2>
        <Refresh at={at} every={EVERY} loading={loading} />
      </div>

      <section className="adm-card adm-attn" aria-labelledby="adm-attn-h">
        <h3 id="adm-attn-h">What needs attention <span className="lb-count">{list.length}</span></h3>
        {list.length === 0
          ? <div className="adm-alert good">✅ All systems normal.</div>
          : (
            <ul className="adm-attn-list">
              {list.map((x, i) => (
                <li key={i} className={`adm-alert ${x.level}`}>
                  <span aria-hidden>{x.level === 'bad' ? '⛔' : x.level === 'warn' ? '⚠️' : 'ℹ️'}</span>
                  <span className="grow">{x.text}</span>
                  {x.to && <Link className="btn tiny" to={x.to}>Open</Link>}
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby="adm-stats-h">
        <h3 id="adm-stats-h" className="sr-only">Server statistics</h3>
        <div className="adm-stats">
          {tiles.map(t => (
            <div key={t.label} className={`adm-stat ${t.level ?? ''}`} title={t.hint}>
              <span className="adm-stat-icon" aria-hidden>{t.icon}</span>
              <span className="adm-stat-label">{t.label}</span>
              <b>{t.value}</b>
              {t.detail && <span className="muted small adm-ellipsis adm-stat-detail">{t.detail}</span>}
              {t.trend && <Trend values={t.trend} level={t.level ?? 'good'} />}
            </div>
          ))}
        </div>
      </section>

      <div className="row wrap adm-facts small muted">
        <span>Discord bot <b className={o.discordBot ? 'adm-good' : 'adm-bad'}>{o.discordBot ? 'on' : 'off'}</b></span>
        <span>Graphics library <b>{o.graphics}</b></span>
        <span>Demo mode <b className={o.demoMode ? 'warn' : ''}>{o.demoMode ? 'on' : 'off'}</b></span>
        <span>Operator list <b className={o.adminMode ? '' : 'warn'}>{o.adminMode ? 'set' : 'unset'}</b></span>
      </div>
      {error && <p className="warn small" role="alert">Refresh failed: {error}</p>}
    </div>
  );
}
