// The Cards Daily Challenge over HTTP (../cards/daily.ts):
//   GET /api/cards/daily               today's table, the top 50 and (signed in) your status and streak
//   GET /api/cards/daily?date=Y-M-D    the same for a past day
//   GET /api/cards/daily/history       the days before today: players, wins, the winner and your own row
// Playing goes over the socket (cards:daily). The leaderboards ride on the
// leaderboard switch like every other published result; the table itself does not.
import type { Express } from 'express';
import { isOn } from '../features.ts';
import { authed } from '../http.ts';
import { cardsDailyHistory, cardsDailyInfo, reconcileCardsDaily } from '../cards/daily.ts';
import type { CardsRegistry } from '../cards/rooms.ts';
import { dailyDate, dailyNumber, isDailyDate } from '../../../shared/cards/daily.ts';

export function mountCardsDaily(app: Express, registry: CardsRegistry, now: () => number = Date.now): void {
  app.get('/api/cards/daily', (req, res) => {
    const t = now();
    const today = dailyDate(t);
    const asked = typeof req.query.date === 'string' ? req.query.date : today;
    if (!isDailyDate(asked) || asked > today || dailyNumber(asked) < 1) {
      res.status(400).json({ error: 'No Daily Challenge on that date' });
      return;
    }
    const me = authed(req);
    // A table lost to a restart, or swept while nobody was at it: settled before anyone reads the day.
    reconcileCardsDaily(registry, t);
    res.json(cardsDailyInfo(asked, { userId: me?.id, leaders: isOn('leaderboard'), now: t }));
  });

  app.get('/api/cards/daily/history', (req, res) => {
    if (!isOn('leaderboard')) { res.status(404).json({ error: 'The leaderboard is switched off' }); return; }
    const days = Number(req.query.days ?? 14);
    res.json({ days: cardsDailyHistory({ days: Number.isFinite(days) ? days : 14, userId: authed(req)?.id, now: now() }) });
  });
}
