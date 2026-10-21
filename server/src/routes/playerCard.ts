// A player's badges (GET /api/players/:id/achievements) and their share card
// (GET /api/players/:id/card.png, playerCard.ts). Public like the rest of the
// profile and on the same switch; nobody banned from the site gets a card.
import type { Express } from 'express';
import type { AchievementsReply } from '../../../shared/achievements.ts';
import { isOn } from '../features.ts';
import { achievementsOf, cachedCard, cardPng, playerBanned, playerSnapshot, CARD_TTL_MS } from '../playerCard.ts';
import { validPlayerId } from '../profiles.ts';

/** Cards drawn (cache misses) per address per minute: each one holds the event loop for about a tenth of a second. */
export const RENDERS_PER_MINUTE = 30;

export function mountPlayerCard(app: Express, opts: { rendersPerMinute?: number } = {}): void {
  const maxRenders = opts.rendersPerMinute ?? RENDERS_PER_MINUTE;
  const renders = new Map<string, number[]>();
  /** Counts a drawing for this address; false once it has had its share this minute. */
  const mayRender = (ip: string, now = Date.now()): boolean => {
    const recent = (renders.get(ip) ?? []).filter(t => now - t < 60_000);
    if (recent.length >= maxRenders) { renders.set(ip, recent); return false; }
    recent.push(now);
    renders.delete(ip); // re-insert: least recently used first
    renders.set(ip, recent);
    if (renders.size > 10_000) renders.delete(renders.keys().next().value!);
    return true;
  };

  app.get('/api/players/:id/achievements', (req, res) => {
    if (!isOn('leaderboard')) { res.status(404).json({ error: 'Player profiles are switched off' }); return; }
    const id = String(req.params.id);
    const reply: AchievementsReply = { achievements: validPlayerId(id) ? achievementsOf(id) : [], now: Date.now() };
    res.json(reply);
  });

  app.get('/api/players/:id/card.png', async (req, res) => {
    const id = String(req.params.id);
    const missing = () => res.status(404).json({ error: 'No card for this player' });
    // Checked on every request, cached card or not: switching profiles off or a ban takes effect at once.
    if (!isOn('leaderboard') || !validPlayerId(id) || playerBanned(id)) { missing(); return; }
    try {
      let png = cachedCard(id);
      if (!png) {
        const s = playerSnapshot(id);
        if (!s) { missing(); return; }
        if (!mayRender(req.ip ?? '')) {
          res.setHeader('Retry-After', '60');
          res.status(429).json({ error: 'Too many cards drawn — try again in a minute' });
          return;
        }
        png = await cardPng(s);
      }
      res.status(200).type('image/png');
      // After the /api no-store default: link previews and browsers may keep it as long as the server does.
      res.setHeader('Cache-Control', `public, max-age=${CARD_TTL_MS / 1000}`);
      res.send(png);
    } catch (e) {
      console.error('[card] could not draw', id, e);
      res.status(500).json({ error: 'Could not draw the card' });
    }
  });
}
