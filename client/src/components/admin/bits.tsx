// Small pieces shared by the dashboard tabs: relative times with the exact
// time on hover, copy-id buttons, the auto-refresh indicator and sortable
// table headers.
import { useEffect, useState } from 'react';
import { ago2, copyText, full } from './adminApi.ts';

/** Re-renders once a second so "3 sec ago" keeps counting. */
function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(n => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

/** "3 min ago", full date and time in the tooltip. */
export function RelTime({ ts, className = '' }: { ts: number | null | undefined; className?: string }) {
  useTick(10_000);
  if (!ts) return <span className={`muted ${className}`}>—</span>;
  return <time className={className} dateTime={new Date(ts).toISOString()} title={full(ts)}>{ago2(ts)}</time>;
}

/** A tiny ⧉ button that copies an id. */
export function CopyId({ value, label = 'Copy id' }: { value: string; label?: string }) {
  return (
    <button type="button" className="adm-copy" title={label} aria-label={`${label}: ${value}`}
      onClick={e => { e.stopPropagation(); void copyText(value, 'Copied to clipboard'); }}>⧉</button>
  );
}

/** Pulsing dot + "updated 3 sec ago" for a polled list. */
export function Refresh({ at, every, loading }: { at: number | null; every: number; loading?: boolean }) {
  useTick(1000);
  return (
    <span className={`adm-refresh ${loading ? 'busy' : ''}`} role="status" aria-live="off">
      <i aria-hidden /> {at ? `updated ${ago2(at)}` : 'loading…'} <span className="muted">· every {Math.round(every / 1000)}s</span>
    </span>
  );
}

/** A sortable column header. */
export function Th<K extends string>({ k, sort, children, className = '' }: {
  k: K; children: React.ReactNode; className?: string;
  sort: { key: K; dir: 1 | -1; toggle: (k: K) => void; aria: (k: K) => 'ascending' | 'descending' | 'none' };
}) {
  const on = sort.key === k;
  return (
    <th aria-sort={sort.aria(k)} className={`adm-th ${on ? 'on' : ''} ${className}`}>
      <button type="button" onClick={() => sort.toggle(k)}>
        {children} <span aria-hidden className="adm-sort">{on ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

/** Map thumbnail from /maps/<id>.webp, with a blank tile when missing. */
export function MapThumb({ id, name, size = 56 }: { id: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="adm-map" style={{ width: size, height: size }} title={name}>
      {!broken && <img src={`/maps/${id}.webp`} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />}
    </span>
  );
}
