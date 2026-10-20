// GET /api/activity?limit=20: the home page's live ticker (../activity.ts),
// wired to the real stores. Public, cached for ten seconds on the server (and
// as long in the browser), so polling it costs next to nothing.
import type express from 'express';
import { createActivityFeed, type ActivitySources, type ActivityTable } from '../activity.ts';
import { findBan } from '../bans.ts';
import { getAccount, newAccounts } from '../connections.ts';
import { isOn } from '../features.ts';
import { recentResults } from '../stats.ts';
import { recentCardsResults } from '../cards/stats.ts';
import type { Registry } from '../rooms.ts';
import type { CardsRegistry } from '../cards/rooms.ts';
import type { TournamentManager } from '../tournament/manager.ts';
import { getMap } from '../../../shared/maps.ts';

/** How many of the latest results are looked at (the ticker shows a handful). */
const RESULTS_SCAN = 60;

export interface ActivityDeps {
  monopoly: Registry;
  cards: CardsRegistry;
  tournaments: TournamentManager;
}

export function activitySources(d: ActivityDeps): ActivitySources {
  return {
    monopolyResults: () => recentResults(RESULTS_SCAN),
    cardsResults: () => recentCardsResults(RESULTS_SCAN),
    *monopolyTables(): Iterable<ActivityTable> {
      for (const r of d.monopoly.rooms.values()) {
        yield {
          code: r.code, private: r.private, status: r.status, players: r.seats.length, maxPlayers: r.rules.maxPlayers,
          createdAt: r.createdAt, startedAt: r.startedAt, occupied: r.hasConnectedHumans(), restricted: !!r.requirements,
        };
      }
    },
    *cardsTables(): Iterable<ActivityTable> {
      for (const r of d.cards.rooms.values()) {
        yield {
          code: r.code, private: r.private, status: r.status, players: r.seats.length, maxPlayers: r.maxPlayers,
          createdAt: r.createdAt, startedAt: r.startedAt, occupied: r.hasConnectedHumans(), restricted: !!r.tournament,
        };
      }
    },
    tournaments: () => d.tournaments.list(),
    newAccounts,
    resultsPublic: () => isOn('leaderboard'),
    banned: id => !!findBan({ id, discordId: getAccount(id)?.discordId ?? null }),
    mapName: id => getMap(id).name,
    now: () => Date.now(),
  };
}

export function mountActivity(app: express.Express, deps: ActivityDeps): void {
  const feed = createActivityFeed(activitySources(deps));
  app.get('/api/activity', (req, res) => {
    // After the /api no-store default: this one may be kept for its ten seconds.
    res.setHeader('cache-control', 'public, max-age=10');
    res.json(feed.get(Number(req.query.limit ?? 20)));
  });
}
