// GET /api/admin/analytics?days=7|30|90: the dashboard's Analytics tab
// (../analytics.ts), wired to the real stores. Operators only, like the rest
// of /api/admin; this router checks for itself so it is safe wherever it is
// mounted. The answer is cached for a few seconds: a busy dashboard costs one
// pass over the results, however many tabs poll it.
import express from 'express';
import { buildAnalytics, type AnalyticsSources } from '../analytics.ts';
import { allCardsDailyAttempts } from '../cards/daily.ts';
import { allCardsResults } from '../cards/stats.ts';
import type { CardsRegistry } from '../cards/rooms.ts';
import { accountsFirstSeen } from '../connections.ts';
import { recentEvents } from '../eventlog.ts';
import { requireAdmin } from '../http.ts';
import type { LiveSampler } from '../liveSamples.ts';
import type { SocketLayer } from '../sockets.ts';
import { allResults } from '../stats.ts';
import type { TournamentManager } from '../tournament/manager.ts';
import type { VisitCounter } from '../visits.ts';
import { allLinks, getHoldings } from '../wallet/store.ts';
import { getMap } from '../../../shared/maps.ts';
import { analyticsPeriod, type AnalyticsPeriod, type AnalyticsReport } from '../../../shared/analytics.ts';

export interface AnalyticsDeps {
  sockets: Pick<SocketLayer, 'connectedCount' | 'online' | 'registry'>;
  cards: { registry: Pick<CardsRegistry, 'rooms'> };
  tournaments: Pick<TournamentManager, 'list'>;
  samples: Pick<LiveSampler, 'days'>;
  visits: Pick<VisitCounter, 'days'>;
}

const CACHE_MS = 5_000;

/** Distinct signed-in accounts with a connection open right now. */
export function onlinePlayers(sockets: Pick<SocketLayer, 'online'>): number {
  return new Set(sockets.online().map(o => o.id).filter(id => id && id !== '(guest)')).size;
}

export function analyticsSources(d: AnalyticsDeps): AnalyticsSources {
  return {
    monopolyResults: allResults,
    cardsResults: allCardsResults,
    dailyAttempts: allCardsDailyAttempts,
    tournaments: () => d.tournaments.list(10_000),
    accounts: accountsFirstSeen,
    wallets: () => allLinks().map(l => ({ owner: l.owner, linkedAt: l.linkedAt, holds: (getHoldings(l.address)?.balance ?? 0) > 0 })),
    live: () => {
      const monopoly = [...d.sockets.registry.rooms.values()];
      const cards = [...d.cards.registry.rooms.values()];
      return {
        sockets: d.sockets.connectedCount(),
        players: onlinePlayers(d.sockets),
        tables: monopoly.length + cards.length,
        playing: monopoly.filter(r => r.status === 'playing').length + cards.filter(r => r.status === 'playing').length,
      };
    },
    samples: () => d.samples.days(),
    visits: () => d.visits.days(),
    events: recentEvents,
    mapName: id => getMap(id).name,
    now: () => Date.now(),
  };
}

export function analyticsRoutes(deps: AnalyticsDeps, src: AnalyticsSources = analyticsSources(deps)): express.Router {
  const r = express.Router();
  r.use((req, res, next) => {
    if (!requireAdmin(req, res)) return;
    next();
  });
  const cache = new Map<AnalyticsPeriod, { at: number; report: AnalyticsReport }>();
  r.get('/', (req, res) => {
    const days = analyticsPeriod(req.query.days);
    const now = Date.now();
    let hit = cache.get(days);
    if (!hit || now - hit.at >= CACHE_MS || now < hit.at || req.query.fresh === '1') {
      hit = { at: now, report: buildAnalytics(src, days) };
      cache.set(days, hit);
    }
    res.json(hit.report);
  });
  return r;
}
