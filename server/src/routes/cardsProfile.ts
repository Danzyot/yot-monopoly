// The Cards half of a public profile: GET /api/players/:id/cards. Public like
// the Monopoly profile beside it (/api/players/:id), and on the same switch:
// both publish players' results. An unknown player is { profile: null }.
import type { Express } from 'express';
import { isOn } from '../features.ts';
import { validPlayerId } from '../profiles.ts';
import { buildCardsProfile } from '../cards/stats.ts';
import { cardsDailyProfile } from '../cards/daily.ts';

export function mountCardsProfile(app: Express): void {
  app.get('/api/players/:id/cards', (req, res) => {
    if (!isOn('leaderboard')) { res.status(404).json({ error: 'Player profiles are switched off' }); return; }
    const id = String(req.params.id);
    if (!validPlayerId(id)) { res.json({ profile: null }); return; }
    const profile = buildCardsProfile(id);
    const daily = cardsDailyProfile(id);
    res.json({ profile: profile && daily ? { ...profile, daily } : profile });
  });
}
