// GET /api/chogs/:id — one Chog Genesis token's traits and frame colour
// (shared/chogs/card.ts), for the home page's Chog of the Day. Public; a
// token's traits never change, so browsers and caches keep the answer a day.
import type express from 'express';
import { chogCard } from '../../../shared/chogs/card.ts';

export function mountChogs(app: express.Express): void {
  app.get('/api/chogs/:id', (req, res) => {
    const id = /^\d{1,5}$/.test(req.params.id) ? Number(req.params.id) : NaN;
    const card = Number.isInteger(id) ? chogCard(id) : null;
    if (!card) { res.status(404).json({ error: 'No such Chog' }); return; }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json(card);
  });
}
