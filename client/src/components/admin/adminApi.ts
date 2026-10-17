// Shapes of the operator API (server/src/routes/admin.ts, routes/graphics.ts)
// and the small helpers every dashboard tab uses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { toast, toastError } from '../../toast.tsx';
import type { BanKind, BanScope } from '../../../../shared/types.ts';
import { askConfirm } from '../Modal.tsx';

export interface Overview {
  uptimeSec: number;
  rssMb: number;
  heapMb: number;
  loopLagMs: number;
  sockets: number;
  rooms: number;
  playing: number;
  players: number;
  dataDir: string;
  persistentDisk: boolean;
  lastSnapshotAgeMs: number | null;
  discordBot: boolean;
  demoMode: boolean;
  adminMode: boolean;
  graphics: number;
  node: string;
}

export interface AdminSeat {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  color: string;
  cash: number | null;
  bankrupt: boolean;
  /** Autopilot is playing for them (away after timeouts, or handed over). */
  afk?: boolean;
}

export interface AdminRoom {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  map: string;
  edition: string;
  private: boolean;
  hostId: string;
  hostName: string;
  createdAt: number;
  startedAt: number | null;
  turn: number;
  spectators: number;
  paused?: { by: string; at: number } | null;
  seats: AdminSeat[];
}

export interface OnlineRow { id: string; name: string; ip: string | null; room: string | null }

export interface IpCell { country: string | null; first: number; last: number; count: number }

export interface Account {
  id: string;
  name: string;
  discordId: string | null;
  discordName: string | null;
  avatar: string;
  firstSeen: number;
  lastSeen: number;
  ips: Record<string, IpCell>;
}

export interface Ban {
  kind: BanKind;
  scope: BanScope;
  gameId: string | null;
  gameName: string;
  value: string;
  name: string;
  reason: string;
  at: number;
  by: string;
  expiresAt: number | null;
}

export interface Mute { id: string; name: string; until: number | null; by: string }

export interface AccountDetail {
  account: Account;
  bans: Ban[];
  rooms: { code: string; status: string }[];
  linked: { id: string; name: string }[];
  mute: Mute | null;
}

export interface AltGroup { ip: string; country: string | null; accounts: { id: string; name: string }[] }

export interface LoggedGame { gameId: string; gameName: string; events: number; from: number; to: number }
export interface GameEvent { ts: number; gameId: string; gameName: string; text: string }

export interface GameRecord {
  code: string;
  mapId: string;
  themeId: string;
  startedAt: number;
  endedAt: number;
  turns: number;
  places: { id: string; name: string; isBot: boolean; netWorth: number }[];
}

export interface GraphicRow {
  id: string;
  name: string;
  file: string;
  size: number;
  type: string;
  addedAt: number;
  addedBy: string;
  url: string;
}

/**
 * GET a path now and every `ms` after (0 = once). Polling pauses while the tab
 * is hidden, so a dashboard left open in the background costs nothing.
 */
export function usePoll<T>(path: string | null, ms = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the newest request may land, so switching quickly never shows stale data.
  const seq = useRef(0);

  const reload = useCallback(() => {
    if (!path) return Promise.resolve();
    const mine = ++seq.current;
    setLoading(true);
    return api<T>(path)
      .then(d => { if (mine === seq.current) { setData(d); setError(null); } })
      .catch((e: Error) => { if (mine === seq.current) setError(e.message); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [path]);

  useEffect(() => {
    setData(null);
    void reload();
    if (!ms) return;
    const t = setInterval(() => { if (!document.hidden) void reload(); }, ms);
    const wake = () => { if (!document.hidden) void reload(); };
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', wake); };
  }, [reload, ms]);

  return { data, error, loading, reload };
}

/**
 * Run an operator action: optional confirmation first, a toast either way,
 * then `after` (usually a reload). Resolves true when it went through.
 */
export async function act(
  fn: () => Promise<unknown>,
  opts: { confirm?: string; ok?: string; after?: () => unknown } = {},
): Promise<boolean> {
  if (opts.confirm && !(await askConfirm({ title: 'Are you sure?', body: opts.confirm, confirm: 'Yes, do it' }))) return false;
  try {
    await fn();
    if (opts.ok) toast(opts.ok);
    await opts.after?.();
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export const post = (path: string, json?: unknown) => api(path, { method: 'POST', json: json ?? {} });
export const del = (path: string, json?: unknown) => api(path, { method: 'DELETE', json: json ?? {} });

// ---- formatting ----

export function ago(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function span(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86_400)}d ${Math.floor((sec % 86_400) / 3600)}h`;
}

/** "in 3h" / "permanent" for ban and mute expiries. */
export function expiry(ts: number | null): string {
  if (ts === null) return 'permanent';
  const s = (ts - Date.now()) / 1000;
  return s <= 0 ? 'expired' : `ends in ${span(s)}`;
}

export const when = (ts: number) => new Date(ts).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const clock = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const kb = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Two-letter country code to its flag emoji. */
export function flag(cc: string | null): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '🏳️';
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0)));
}
