// How the site is doing at a glance: KPI tiles, charts and tables for the
// last 7, 30 or 90 days, all from GET /api/admin/analytics (the server's own
// records; nothing third-party). Every chart has a table view and a CSV
// export. Loaded lazily (tabs.tsx), so the charts cost nothing until opened.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Refresh } from './bits.tsx';
import { usePoll } from './adminApi.ts';
import {
  Columns, HBars, HeatStrip, Legend, Lines, SplitBars, compact, whole,
  type Row, type Series,
} from './charts.tsx';
import {
  ANALYTICS_PERIODS, analyticsPeriod, type AnalyticsGame, type AnalyticsPeriod, type AnalyticsReport,
} from '../../../../shared/analytics.ts';
import './analytics.css';

const EVERY = 60_000;

const GAME_LABEL: Record<AnalyticsGame, string> = { monopoly: 'Monopoly', cards: 'Cards', daily: 'Daily Challenge' };
const GAME_COLOR: Record<AnalyticsGame, string> = { monopoly: 'var(--an-monopoly)', cards: 'var(--an-cards)', daily: 'var(--an-daily)' };
const GAME_SERIES: Series[] = (['monopoly', 'cards', 'daily'] as const).map(g => ({ key: g, label: GAME_LABEL[g], color: GAME_COLOR[g] }));

// ---- CSV ----

type Cell = string | number | null | undefined;

function toCsv(rows: Cell[][]): string {
  const esc = (c: Cell) => {
    const s = c === null || c === undefined ? '' : String(c);
    // Quote what needs it, and keep spreadsheet formulas from running.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}

function downloadCsv(name: string, rows: Cell[][]) {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- a chart's frame: title, legend, chart or table, CSV ----

function ChartCard({ id, title, sub, legend, csv, children, wide, empty }: {
  id: string; title: string; sub?: ReactNode; legend?: ReactNode; wide?: boolean;
  /** Header row first. */
  csv: { name: string; rows: Cell[][] };
  children: ReactNode;
  /** Shown instead of the chart when there is nothing to draw. */
  empty?: string | false;
}) {
  const [table, setTable] = useState(false);
  const [head, ...body] = csv.rows;
  return (
    <section className={`adm-card an-card ${wide ? 'wide' : ''}`} aria-labelledby={`an-${id}`}>
      <header className="an-card-head">
        <div className="grow">
          <h3 id={`an-${id}`}>{title}</h3>
          {sub && <p className="muted small an-sub">{sub}</p>}
        </div>
        <div className="an-card-tools">
          <button type="button" className="btn tiny" aria-pressed={table} onClick={() => setTable(t => !t)}>{table ? 'Chart' : 'Table'}</button>
          <button type="button" className="btn tiny" onClick={() => downloadCsv(csv.name, csv.rows)} aria-label={`Download ${title} as CSV`}>⬇ CSV</button>
        </div>
      </header>
      {!table && legend}
      {table ? (
        <div className="adm-scroll an-table-wrap">
          <table className="an-table">
            <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
            <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c ?? '—'}</td>))}</tr>)}</tbody>
          </table>
        </div>
      ) : empty ? <p className="an-empty muted">{empty}</p> : children}
    </section>
  );
}

// ---- KPI tiles ----

interface Tile { icon: string; label: string; value: ReactNode; detail?: ReactNode; hint?: string }

function Tiles({ r }: { r: AnalyticsReport }) {
  const k = r.kpis;
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const tiles: Tile[] = [
    { icon: '🟢', label: 'Online now', value: whole(k.onlineNow), detail: `${whole(k.socketsNow)} connections · ${whole(k.playingNow)}/${whole(k.tablesNow)} tables playing`, hint: 'Signed-in accounts with a connection open right now' },
    { icon: '🎲', label: 'Games today', value: whole(k.gamesToday), detail: `${k.gamesTodayBy.monopoly} Monopoly · ${k.gamesTodayBy.cards} Cards · ${k.gamesTodayBy.daily} Daily`, hint: 'Finished games since midnight UTC' },
    { icon: '✨', label: 'New today', value: whole(k.newToday), detail: `${whole(k.playersTotal)} players in all`, hint: 'Accounts first seen since midnight UTC' },
    { icon: '📅', label: 'New this week', value: whole(k.newWeek), detail: `${whole(k.newPeriod)} in ${r.days} days`, hint: 'Accounts first seen in the last 7 days, today included' },
    { icon: '👛', label: 'Linked wallets', value: whole(k.walletsLinked), detail: `${whole(k.walletAccounts)} accounts · ${whole(k.walletsNewPeriod)} new`, hint: `Wallets linked to accounts; new: linked in the last ${r.days} days` },
    { icon: '🐸', label: 'Holders', value: whole(k.holders), detail: k.walletAccounts ? `${pct(k.holders / k.walletAccounts)} of linked accounts` : 'no wallets linked yet', hint: 'Accounts whose wallets were last seen holding a Chog' },
    { icon: '🏆', label: 'Tournaments run', value: whole(k.tournamentsRun), detail: `${whole(k.tournamentsAllTime)} on record · ${whole(k.tournamentsLive)} live`, hint: `Finished in the last ${r.days} days` },
    { icon: '🃏', label: 'Daily Challenge', value: whole(k.dailyToday), detail: `${whole(k.dailyPlayers)} players · ${whole(k.dailyPeriod)} tries · ${pct(k.dailyWinRate)} won`, hint: `Official attempts today; the detail covers the last ${r.days} days` },
    { icon: '👀', label: 'Visitors today', value: whole(k.visitorsToday), detail: `${whole(k.viewsToday)} page loads`, hint: 'Counted on the server per day; no cookies, nothing stored per person' },
  ];
  return (
    <section aria-labelledby="an-kpi-h">
      <h3 id="an-kpi-h" className="sr-only">Key figures</h3>
      <div className="adm-stats an-kpis">
        {tiles.map(t => (
          <div key={t.label} className="adm-stat" title={t.hint}>
            <span className="adm-stat-icon" aria-hidden>{t.icon}</span>
            <span className="adm-stat-label">{t.label}</span>
            <b>{t.value}</b>
            {t.detail && <span className="muted small adm-stat-detail">{t.detail}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- the tab ----

export default function AnalyticsTab() {
  const [params, setParams] = useSearchParams();
  const days: AnalyticsPeriod = analyticsPeriod(params.get('days'));
  const setDays = (d: AnalyticsPeriod) => setParams(p => {
    const next = new URLSearchParams(p);
    next.set('days', String(d));
    return next;
  }, { replace: true });
  const { data: r, error, loading, at } = usePoll<AnalyticsReport>(`/api/admin/analytics?days=${days}`, EVERY);
  const stamp = r ? `${r.dates[0]}_to_${r.dates[r.dates.length - 1]}` : '';
  const file = (what: string) => `chog-${what}-${stamp}`;

  const charts = useMemo(() => (r ? buildCharts(r, file) : null), [r]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="adm-stack an-root">
      <div className="row between wrap an-toolbar">
        <h2 className="adm-h2">Analytics</h2>
        <div className="row wrap an-controls">
          <div className="adm-seg" role="group" aria-label="Period">
            {ANALYTICS_PERIODS.map(d => (
              <button key={d} type="button" className={d === days ? 'on' : ''} aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</button>
            ))}
          </div>
          <Refresh at={at} every={EVERY} loading={loading} />
        </div>
      </div>
      <p className="muted small an-note">
        Worked out on this server from its own records: results, live tables, accounts, wallet links, tournaments and the logs.
        No cookies and no third-party analytics. Visits are counted per page per day; visitors through a daily-rotating hash that is never stored. Days are UTC.
      </p>

      {error && !r && <p className="warn" role="alert">{error}</p>}
      {!r && !error && (
        <div aria-busy="true" className="adm-stack">
          <div className="adm-stats">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk sk-tile" />)}</div>
          <div className="an-grid">{Array.from({ length: 4 }, (_, i) => <div key={i} className="adm-card an-sk" />)}</div>
        </div>
      )}
      {r && charts && (
        <>
          <Tiles r={r} />
          <div className="an-grid">{charts}</div>
          <p className="muted small an-note">
            Logs in this period: {whole(r.logs.clientErrors)} client error report{r.logs.clientErrors === 1 ? '' : 's'} ·{' '}
            {whole(r.logs.adminActions)} operator action{r.logs.adminActions === 1 ? '' : 's'} · {whole(r.logs.gameEvents)} game events
            {' '}(<Link to="/admin/logs">open the logs</Link>).
          </p>
        </>
      )}
      {error && r && <p className="warn small" role="alert">Refresh failed: {error}</p>}
    </div>
  );
}

function buildCharts(r: AnalyticsReport, file: (what: string) => string): ReactNode {
  const n = r.days;
  const gameRows = r.gamesPerDay as unknown as Row[];
  const totalGames = r.gamesPerDay.reduce((a, d) => a + d.monopoly + d.cards + d.daily, 0);
  const newRows = r.newPlayersPerDay as unknown as Row[];
  const peakRows = r.peakPerDay as unknown as Row[];
  const visitRows = r.visits.perDay as unknown as Row[];
  const sampled = r.peakPerDay.some(d => d.sockets !== null);
  const visited = r.visits.perDay.some(d => d.views > 0);
  const boardsTotal = r.boards.reduce((a, b) => a + b.games, 0);
  const modesTotal = r.cardsModes.classic + r.cardsModes.chaos;
  const peakSeries: Series[] = [
    { key: 'sockets', label: 'Connections', color: 'var(--an-people)' },
    { key: 'players', label: 'Signed-in players', color: 'var(--an-people-2)' },
  ];
  const visitSeries: Series[] = [
    { key: 'views', label: 'Page loads', color: 'var(--an-people)' },
    { key: 'visitors', label: 'Visitors', color: 'var(--an-people-2)' },
  ];
  const share = (v: number, of: number) => (of ? `${Math.round((v / of) * 100)}%` : '—');
  const mins = (v: number | null) => (v === null ? '—' : v < 1 ? '<1 min' : `${compact(v)} min`);
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

  return (
    <>
      <ChartCard id="games" wide title="Games per day" sub={`${whole(totalGames)} finished games in ${n} days, by game`}
        legend={<Legend series={GAME_SERIES} />}
        empty={totalGames === 0 && 'No finished games in this period yet.'}
        csv={{ name: file('games-per-day'), rows: [['Date (UTC)', 'Monopoly', 'Cards', 'Daily Challenge', 'Total'], ...r.gamesPerDay.map(d => [d.date, d.monopoly, d.cards, d.daily, d.monopoly + d.cards + d.daily])] }}>
        <Columns rows={gameRows} series={GAME_SERIES} height={220} label={`Games per day over ${n} days, stacked by game`} />
      </ChartCard>

      <ChartCard id="new" title="New players per day" sub={`${whole(r.kpis.newPeriod)} accounts first seen in ${n} days`}
        empty={r.kpis.newPeriod === 0 && 'Nobody new in this period.'}
        csv={{ name: file('new-players'), rows: [['Date (UTC)', 'New players'], ...r.newPlayersPerDay.map(d => [d.date, d.players])] }}>
        <Columns rows={newRows} series={[{ key: 'players', label: 'New players', color: 'var(--an-people)' }]} label={`New players per day over ${n} days`} />
      </ChartCard>

      <ChartCard id="peak" title="Peak concurrent per day" sub="Highest counts sampled every 5 minutes; gaps are days the server was not sampling"
        legend={<Legend series={peakSeries} />}
        empty={!sampled && 'No samples yet: the server samples live counts every 5 minutes.'}
        csv={{ name: file('peak-concurrent'), rows: [['Date (UTC)', 'Peak connections', 'Peak signed-in players'], ...r.peakPerDay.map(d => [d.date, d.sockets, d.players])] }}>
        <Lines rows={peakRows} series={peakSeries} label={`Peak concurrent connections and signed-in players per day over ${n} days`} />
      </ChartCard>

      <ChartCard id="boards" title="Monopoly board popularity" sub={`${whole(boardsTotal)} Monopoly games by board`}
        empty={boardsTotal === 0 && 'No Monopoly games in this period.'}
        csv={{ name: file('monopoly-boards'), rows: [['Board', 'Games', 'Share'], ...r.boards.map(b => [b.name, b.games, share(b.games, boardsTotal)])] }}>
        <HBars label="Monopoly games by board" color="var(--an-monopoly)"
          rows={r.boards.map(b => ({ key: b.id, label: b.name, value: b.games, display: `${whole(b.games)} · ${share(b.games, boardsTotal)}` }))} />
      </ChartCard>

      <ChartCard id="modes" title="Cards: Classic vs Chog Chaos" sub={`${whole(modesTotal)} Cards matches (Daily Challenge deals not included)`}
        empty={modesTotal === 0 && 'No Cards matches in this period.'}
        csv={{ name: file('cards-modes'), rows: [['Mode', 'Matches', 'Share'], ['Classic', r.cardsModes.classic, share(r.cardsModes.classic, modesTotal)], ['Chog Chaos', r.cardsModes.chaos, share(r.cardsModes.chaos, modesTotal)]] }}>
        <SplitBars label="Cards matches by mode" rows={[{
          key: 'modes', label: 'Matches',
          parts: [
            { key: 'classic', label: 'Classic', value: r.cardsModes.classic, color: 'var(--an-cards)' },
            { key: 'chaos', label: 'Chog Chaos', value: r.cardsModes.chaos, color: 'var(--an-chaos)' },
          ],
        }]} />
      </ChartCard>

      <ChartCard id="length" title="Average game length" sub="Minutes from the deal to the result; the median is beside it"
        empty={r.gameLength.every(g => g.games === 0) && 'No finished games in this period.'}
        csv={{ name: file('game-length'), rows: [['Game', 'Games', 'Average (min)', 'Median (min)'], ...r.gameLength.map(g => [GAME_LABEL[g.game], g.games, g.avgMin, g.medianMin])] }}>
        <HBars label="Average game length by game" color="var(--an-monopoly)"
          rows={r.gameLength.map(g => ({
            key: g.game, label: GAME_LABEL[g.game], value: g.avgMin ?? 0, color: GAME_COLOR[g.game], display: mins(g.avgMin),
            note: g.games ? `median ${mins(g.medianMin)} · ${whole(g.games)} games` : 'no games',
          }))} />
      </ChartCard>

      <ChartCard id="bots" title="People vs bots" sub="Seats filled at finished games"
        legend={<Legend series={[{ key: 'h', label: 'People', color: 'var(--an-humans)' }, { key: 'b', label: 'Bots', color: 'var(--an-bots)' }]} />}
        empty={r.seats.every(s => s.humans + s.bots === 0) && 'No finished games in this period.'}
        csv={{ name: file('people-vs-bots'), rows: [['Game', 'People seats', 'Bot seats', 'People share'], ...r.seats.map(s => [GAME_LABEL[s.game], s.humans, s.bots, share(s.humans, s.humans + s.bots)])] }}>
        <SplitBars label="Seats by people and bots, per game" rows={r.seats.map(s => ({
          key: s.game, label: GAME_LABEL[s.game],
          parts: [
            { key: 'humans', label: 'People', value: s.humans, color: 'var(--an-humans)' },
            { key: 'bots', label: 'Bots', value: s.bots, color: 'var(--an-bots)' },
          ],
        }))} />
      </ChartCard>

      <ChartCard id="visits" wide title="Visits per day" sub="Page loads of the site (not the dashboard), and roughly how many different visitors"
        legend={<Legend series={visitSeries} />}
        empty={!visited && 'No visits counted yet. Page loads are counted when the server serves the built site.'}
        csv={{ name: file('visits'), rows: [['Date (UTC)', 'Page loads', 'Visitors'], ...r.visits.perDay.map(d => [d.date, d.views, d.visitors])] }}>
        <div className="an-visits">
          <Lines rows={visitRows} series={visitSeries} label={`Page loads and visitors per day over ${n} days`} />
          {r.visits.pages.length > 0 && (
            <div>
              <h4 className="an-subhead">Most loaded pages</h4>
              <HBars label="Page loads by page" color="var(--an-people)"
                rows={r.visits.pages.map(p => ({ key: p.page, label: p.page, value: p.views }))} />
            </div>
          )}
        </div>
      </ChartCard>

      <ChartCard id="players" wide title="Top players this period" sub="People with the most finished games; wins break ties"
        empty={r.topPlayers.length === 0 && 'No finished games in this period.'}
        csv={{ name: file('top-players'), rows: [['Player', 'Id', 'Games', 'Wins', 'Win rate', 'Monopoly', 'Cards', 'Daily Challenge'], ...r.topPlayers.map(p => [p.name, p.id, p.games, p.wins, share(p.wins, p.games), p.monopoly, p.cards, p.daily])] }}>
        <div className="adm-scroll">
          <table className="an-table an-players">
            <thead>
              <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Games</th><th scope="col">Wins</th><th scope="col">Win rate</th><th scope="col" className="an-opt">Monopoly</th><th scope="col" className="an-opt">Cards</th><th scope="col" className="an-opt">Daily</th></tr>
            </thead>
            <tbody>
              {r.topPlayers.map((p, i) => (
                <tr key={p.id}>
                  <td>{i + 1}</td>
                  <th scope="row"><Link to={`/admin/players?id=${encodeURIComponent(p.id)}`}><span aria-hidden>{p.avatar ?? '🎩'}</span> {p.name}</Link></th>
                  <td>{whole(p.games)}</td>
                  <td>{whole(p.wins)}</td>
                  <td>{share(p.wins, p.games)}</td>
                  <td className="an-opt">{whole(p.monopoly)}</td>
                  <td className="an-opt">{whole(p.cards)}</td>
                  <td className="an-opt">{whole(p.daily)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard id="hours" wide title="Most active hours (UTC)" sub={`Each row shaded against its own busiest hour, over ${n} days`}
        csv={{ name: file('active-hours'), rows: [['Hour (UTC)', 'Games started', 'Average peak connections', 'Page loads'], ...Array.from({ length: 24 }, (_, h) => [pad(h), r.hours.games[h], r.hours.sockets[h], r.hours.views[h]])] }}>
        <HeatStrip label={`Activity by UTC hour over ${n} days`} rows={[
          { key: 'games', label: 'Games started', values: r.hours.games },
          { key: 'sockets', label: 'Peak connections', values: r.hours.sockets, format: v => `${compact(v)} on average` },
          { key: 'views', label: 'Page loads', values: r.hours.views },
        ]} />
      </ChartCard>
    </>
  );
}

