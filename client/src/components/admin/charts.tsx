// Hand-written SVG and HTML charts for the dashboard's Analytics tab. No chart
// library: a few shapes, drawn at the container's real width (so text stays
// legible on a phone), with a hover/focus tooltip on every mark and a table
// view beside each chart (AnalyticsTab). Colours come in as CSS custom
// properties (analytics.css) and text always wears the text tokens, never a
// series colour.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Series {
  key: string;
  label: string;
  /** A CSS colour, normally var(--an-…). */
  color: string;
}

export type Row = { date: string } & Record<string, number | string | null>;

// ---- formatting ----

const nf = new Intl.NumberFormat(undefined);
/** 1,284 / 12.9K / 4.2M. */
export function compact(n: number): string {
  if (Math.abs(n) < 1000) return nf.format(Math.round(n * 10) / 10);
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
export const whole = (n: number) => nf.format(n);

/** "Oct 21" for a UTC day. */
export function shortDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
/** "Tue, Oct 21" for a UTC day. */
export function longDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Clean axis ticks from 0 to at least `max`. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  const s = step < 1 ? 1 : step;
  const top = Math.ceil(max / s) * s;
  return Array.from({ length: Math.round(top / s) + 1 }, (_, i) => i * s);
}

// ---- measuring ----

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---- pieces ----

/** A column with a 4px rounded data end and a square foot on the baseline. */
function colPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
}

export function Legend({ series, extra }: { series: Series[]; extra?: ReactNode }) {
  return (
    <ul className="an-legend" aria-label="Legend">
      {series.map(s => (
        <li key={s.key}><i aria-hidden style={{ background: s.color }} />{s.label}</li>
      ))}
      {extra}
    </ul>
  );
}

interface Tip { x: number; y: number; title: string; lines: { label: string; value: string; color?: string }[] }

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const w = ref.current.offsetWidth;
    setLeft(Math.max(0, Math.min(width - w, tip.x - w / 2)));
  }, [tip, width]);
  if (!tip) return null;
  return (
    <div ref={ref} className="an-tip" style={{ left, top: Math.max(0, tip.y) }} role="status" aria-live="polite">
      <b>{tip.title}</b>
      {tip.lines.map(l => (
        <span key={l.label}>
          {l.color && <i aria-hidden style={{ background: l.color }} />}
          {l.label} <strong>{l.value}</strong>
        </span>
      ))}
    </div>
  );
}

/** Arrow keys move along the x axis while the chart has focus. */
function useIndexKeys(n: number, active: number | null, set: (i: number | null) => void) {
  return (e: KeyboardEvent) => {
    if (!n) return;
    const at = active ?? n - 1;
    const next = e.key === 'ArrowLeft' ? at - 1 : e.key === 'ArrowRight' ? at + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    set(Math.max(0, Math.min(n - 1, next)));
  };
}

const M = { top: 12, right: 10, bottom: 24, left: 36 };

function xTicks(n: number, width: number): number[] {
  const want = Math.max(2, Math.floor(width / 90));
  const step = Math.max(1, Math.ceil(n / want));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

function Axes({ ticks, y, plotW, n, band, dates, width, height }: {
  ticks: number[]; y: (v: number) => number; plotW: number; n: number; band: number; dates: string[]; width: number; height: number;
}) {
  return (
    <g className="an-axes" aria-hidden>
      {ticks.map(t => (
        <g key={t}>
          <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'an-base' : 'an-grid'} />
          <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{compact(t)}</text>
        </g>
      ))}
      {xTicks(n, width).map(i => (
        <text key={i} x={M.left + band * (i + 0.5)} y={height - 6} textAnchor="middle">{shortDay(dates[i])}</text>
      ))}
    </g>
  );
}

// ---- columns (stacked when there are several series) ----

export function Columns({ rows, series, height = 200, label, unit = '' }: {
  rows: Row[]; series: Series[]; height?: number; label: string; unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = rows.length;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const totals = rows.map(r => series.reduce((a, s) => a + (Number(r[s.key]) || 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const band = n ? plotW / n : 0;
  const gap = band >= 6 ? 2 : band >= 3 ? 1 : 0;
  const barW = Math.max(1, Math.min(24, band - gap));
  const onKey = useIndexKeys(n, active, setActive);

  const tip: Tip | null = active === null || !rows[active] ? null : {
    x: M.left + band * (active + 0.5), y: 0, title: longDay(rows[active].date),
    lines: [
      ...series.map(s => ({ label: s.label, value: `${whole(Number(rows[active][s.key]) || 0)}${unit}`, color: s.color })),
      ...(series.length > 1 ? [{ label: 'Total', value: `${whole(totals[active])}${unit}` }] : []),
    ],
  };

  return (
    <div ref={ref} className="an-plot" onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={onKey}
          onFocus={() => setActive(a => a ?? n - 1)} onBlur={() => setActive(null)}>
          <Axes ticks={ticks} y={y} plotW={plotW} n={n} band={band} dates={rows.map(r => r.date)} width={plotW} height={height} />
          {active !== null && <rect className="an-hover" x={M.left + band * active} y={M.top} width={band} height={plotH} />}
          {rows.map((r, i) => {
            const x = M.left + band * i + (band - barW) / 2;
            let base = y(0);
            const parts = series.map(s => ({ s, v: Number(r[s.key]) || 0 })).filter(p => p.v > 0);
            return (
              <g key={r.date}>
                {parts.map((p, j) => {
                  const h = (p.v / top) * plotH;
                  const last = j === parts.length - 1;
                  // A 2px surface gap above every segment that has another on top.
                  const drawn = last ? h : Math.max(0.5, h - 2);
                  const yTop = base - h;
                  base = yTop;
                  return <path key={p.s.key} d={colPath(x, yTop + (h - drawn), barW, drawn, last)} style={{ fill: p.s.color }} />;
                })}
              </g>
            );
          })}
          {rows.map((r, i) => (
            <rect key={r.date} className="an-hit" x={M.left + band * i} y={M.top} width={band} height={plotH}
              onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---- lines ----

export function Lines({ rows, series, height = 200, label }: { rows: Row[]; series: Series[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = rows.length;
  const plotW = Math.max(0, width - M.left - M.right - 26);
  const plotH = height - M.top - M.bottom;
  const vals = rows.flatMap(r => series.map(s => r[s.key])).filter((v): v is number => typeof v === 'number');
  const ticks = niceTicks(Math.max(...vals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const band = n ? plotW / n : 0;
  const x = (i: number) => M.left + band * (i + 0.5);
  const onKey = useIndexKeys(n, active, setActive);

  const path = (key: string) => {
    let d = '', pen = false;
    rows.forEach((r, i) => {
      const v = r[key];
      if (typeof v !== 'number') { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastOf = (key: string) => {
    for (let i = n - 1; i >= 0; i--) if (typeof rows[i][key] === 'number') return i;
    return -1;
  };
  /** Points with no neighbour on either side draw as a dot, or they would vanish. */
  const lonely = (key: string, i: number) => typeof rows[i][key] === 'number'
    && typeof rows[i - 1]?.[key] !== 'number' && typeof rows[i + 1]?.[key] !== 'number';

  const tip: Tip | null = active === null || !rows[active] ? null : {
    x: x(active), y: 0, title: longDay(rows[active].date),
    lines: series.map(s => {
      const v = rows[active][s.key];
      return { label: s.label, value: typeof v === 'number' ? whole(v) : 'not sampled', color: s.color };
    }),
  };

  return (
    <div ref={ref} className="an-plot" onMouseLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={onKey}
          onFocus={() => setActive(a => a ?? n - 1)} onBlur={() => setActive(null)}>
          <Axes ticks={ticks} y={y} plotW={plotW} n={n} band={band} dates={rows.map(r => r.date)} width={plotW} height={height} />
          {active !== null && <line className="an-cross" x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} />}
          {series.map(s => (
            <g key={s.key}>
              <path d={path(s.key)} className="an-line" style={{ stroke: s.color }} />
              {rows.map((r, i) => (lonely(s.key, i) || i === active || i === lastOf(s.key)) && typeof r[s.key] === 'number' ? (
                <circle key={i} cx={x(i)} cy={y(r[s.key] as number)} r={4} className="an-dot" style={{ fill: s.color }} />
              ) : null)}
            </g>
          ))}
          {/* The latest value at each line's end (the one figure worth labelling). */}
          {series.map((s, k) => {
            const i = lastOf(s.key);
            if (i < 0) return null;
            const v = rows[i][s.key] as number;
            const other = series.find((o, j) => j !== k && lastOf(o.key) === i && Math.abs(y(rows[i][o.key] as number) - y(v)) < 12);
            const nudge = other ? (series.indexOf(other) > k ? -7 : 7) : 0;
            return <text key={s.key} className="an-end" x={x(i) + 8} y={y(v) + nudge} dy="0.32em">{compact(v)}</text>;
          })}
          {rows.map((r, i) => (
            <rect key={r.date} className="an-hit" x={M.left + band * i} y={M.top} width={band} height={plotH}
              onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
          ))}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

// ---- horizontal bars (HTML: labels wrap and stay legible at any width) ----

export interface BarRow { key: string; label: string; value: number; display?: string; note?: string; color?: string }

export function HBars({ rows, color, label }: { rows: BarRow[]; color: string; label: string }) {
  const max = Math.max(...rows.map(r => r.value), 0) || 1;
  return (
    <ul className="an-hbars" aria-label={label}>
      {rows.map(r => (
        <li key={r.key} title={r.note ? `${r.label}: ${r.display ?? whole(r.value)} (${r.note})` : undefined}>
          <span className="an-hbar-label">{r.label}</span>
          <span className="an-hbar-track">
            <i style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
            <b style={{ left: `${(r.value / max) * 100}%` }}>{r.display ?? whole(r.value)}</b>
          </span>
          {r.note && <span className="an-hbar-note muted small">{r.note}</span>}
        </li>
      ))}
    </ul>
  );
}

// ---- 100% split bars (two or three parts per row) ----

export interface SplitRow { key: string; label: string; parts: { key: string; label: string; value: number; color: string }[] }

export function SplitBars({ rows, label }: { rows: SplitRow[]; label: string }) {
  return (
    <ul className="an-split" aria-label={label}>
      {rows.map(r => {
        const total = r.parts.reduce((a, p) => a + p.value, 0);
        const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
        return (
          <li key={r.key}>
            <span className="an-split-label">{r.label} <span className="muted small">{whole(total)}</span></span>
            <span className="an-split-bar">
              {total === 0 ? <i className="an-split-empty" /> : r.parts.filter(p => p.value > 0).map(p => (
                <i key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${whole(p.value)} (${pct(p.value)}%)`}>
                  {/* Inside only when it fits; the line below always carries it. */}
                  {pct(p.value) >= 18 && <em>{pct(p.value)}%</em>}
                </i>
              ))}
            </span>
            <span className="an-split-vals small">
              {r.parts.map(p => (
                <span key={p.key}><i aria-hidden style={{ background: p.color }} />{p.label} <b>{pct(p.value)}%</b> <span className="muted">({whole(p.value)})</span></span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- the 24-hour heat strip ----

export interface HeatRow { key: string; label: string; values: (number | null)[]; format?: (v: number) => string }

export function HeatStrip({ rows, label }: { rows: HeatRow[]; label: string }) {
  const [tip, setTip] = useState<{ row: string; h: number } | null>(null);
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    window.addEventListener('scroll', off, { passive: true });
    return () => window.removeEventListener('scroll', off);
  }, [tip]);
  return (
    <div className="an-heat" role="img" aria-label={label} onMouseLeave={() => setTip(null)}>
      {rows.map(r => {
        const max = Math.max(...r.values.map(v => v ?? 0), 0);
        const peak = max > 0 ? r.values.indexOf(max) : -1;
        return (
          <div key={r.key} className="an-heat-row">
            <span className="an-heat-label">{r.label}</span>
            <span className="an-heat-cells">
              {r.values.map((v, h) => {
                const share = v === null || max === 0 ? 0 : v / max;
                const on = tip?.row === r.key && tip.h === h;
                return (
                  <i key={h} className={`${v === null ? 'none' : ''} ${on ? 'on' : ''}`}
                    style={v === null ? undefined : { background: `color-mix(in oklab, var(--an-seq) ${Math.round(8 + share * 92)}%, var(--an-seq-floor))` }}
                    onMouseEnter={() => setTip({ row: r.key, h })} onClick={() => setTip({ row: r.key, h })}>
                    {on && (
                      <span className="an-heat-tip">
                        <b>{String(h).padStart(2, '0')}:00–{String(h).padStart(2, '0')}:59 UTC</b>
                        {r.label}: <strong>{v === null ? 'no data' : (r.format ?? whole)(v)}</strong>
                      </span>
                    )}
                  </i>
                );
              })}
            </span>
            <span className="an-heat-peak small muted">{peak >= 0 ? `peak ${String(peak).padStart(2, '0')}:00` : 'no data'}</span>
          </div>
        );
      })}
      <div className="an-heat-row an-heat-axis" aria-hidden>
        <span className="an-heat-label" />
        <span className="an-heat-cells">
          {Array.from({ length: 24 }, (_, h) => <i key={h}>{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</i>)}
        </span>
        <span className="an-heat-peak" />
      </div>
    </div>
  );
}
