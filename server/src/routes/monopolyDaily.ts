// The Monopoly Daily Challenge over HTTP (../monopolyDaily.ts), the same shape
// as the Cards one (./cardsDaily.ts), so one page can show both:
//   GET /api/monopoly/daily               today's game, the top 50 and (signed in) your status and streak
//   GET /api/monopoly/daily?date=Y-M-D    the same for a past day
//   GET /api/monopoly/daily/history       the days before today: players, wins, the best and your own row
// Playing goes over the socket (room:daily). The leaderboards ride on the
// leaderboard switch like every other published result; the game itself does not.
import type { Express } from 'express';
import { isOn } from '../features.ts';
import { authed } from '../http.ts';
import { monopolyDailyHistory, monopolyDailyInfo, reconcileMonopolyDaily } from '../monopolyDaily.ts';
import type { Registry } from '../rooms.ts';
import { dailyDate, isDailyDate, monopolyDailyNumber } from '../../../shared/monopolyDaily.ts';

export function mountMonopolyDaily(app: Express, registry: Registry, now: () => number = Date.now): void {
  app.get('/api/monopoly/daily', (req, res) => {
    const t = now();
    const today = dailyDate(t);
    const asked = typeof req.query.date === 'string' ? req.query.date : today;
    if (!isDailyDate(asked) || asked > today || monopolyDailyNumber(asked) < 1) {
      res.status(400).json({ error: 'No Daily Challenge on that date' });
      return;
    }
    const me = authed(req);
    // A table lost to a restart, or swept while nobody was at it: settled before anyone reads the day.
    reconcileMonopolyDaily(registry, t);
    res.json(monopolyDailyInfo(asked, { userId: me?.id, leaders: isOn('leaderboard'), now: t }));
  });

  app.get('/api/monopoly/daily/history', (req, res) => {
    if (!isOn('leaderboard')) { res.status(404).json({ error: 'The leaderboard is switched off' }); return; }
    const days = Number(req.query.days ?? 14);
    res.json({ days: monopolyDailyHistory({ days: Number.isFinite(days) ? days : 14, userId: authed(req)?.id, now: now() }) });
  });
}
