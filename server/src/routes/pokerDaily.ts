// The Poker Daily over HTTP (../poker/daily.ts):
//   GET  /api/poker/daily               today's leaderboard and (signed in) your status and streak
//   GET  /api/poker/daily?date=Y-M-D    the same for a past day
//   GET  /api/poker/daily/history       the days before today: players, the winner and your own row
//   POST /api/poker/daily/play          start or carry on: { practice?, fresh? } → the run, with the hand to answer
//   POST /api/poker/daily/answer        { run, index, choice } → that hand's answer
//   POST /api/poker/daily/leave         { run } → an official run locks in; practice is dropped
//   GET  /api/players/:id/poker-daily   the profile panel
// The leaderboards ride on the leaderboard switch like every other published result.
import type { Express, Request, Response } from 'express';
import { findBan, banMessage } from '../bans.ts';
import { isOn } from '../features.ts';
import { authed } from '../http.ts';
import {
  PokerDailyError, answerPokerDaily, leavePokerDaily, playPokerDaily, pokerDailyHistory, pokerDailyInfo, pokerDailyProfile,
  reconcilePokerDaily, warmPokerDaily, type Player,
} from '../poker/daily.ts';
import { dailyDate, dailyNumber, isDailyDate } from '../../../shared/daily.ts';

export function mountPokerDaily(app: Express, now: () => number = Date.now): void {
  /** The signed-in, unbanned player, or an answer saying why not. */
  const player = (req: Request, res: Response): Player | null => {
    const me = authed(req);
    if (!me) { res.status(401).json({ error: 'Sign in to play' }); return null; }
    const ban = findBan({ id: me.id, discordId: me.discord?.id, ip: req.ip });
    if (ban) { res.status(403).json({ error: banMessage(ban) }); return null; }
    return { id: me.id, name: me.name, ...(me.avatar && { avatar: me.avatar }) };
  };
  const failed = (res: Response, e: unknown) => {
    if (e instanceof PokerDailyError) res.status(e.status).json({ error: e.message });
    else {
      console.error('Poker Daily:', e);
      res.status(500).json({ error: 'Something went wrong dealing that hand' });
    }
  };

  app.get('/api/poker/daily', (req, res) => {
    const t = now();
    const today = dailyDate(t);
    const asked = typeof req.query.date === 'string' ? req.query.date : today;
    if (!isDailyDate(asked) || asked > today || dailyNumber(asked) < 1) {
      res.status(400).json({ error: 'No Poker Daily on that date' });
      return;
    }
    reconcilePokerDaily(t);
    // Today's hands get dealt in the background, so the first to play never waits.
    if (asked === today) warmPokerDaily(today);
    res.json(pokerDailyInfo(asked, { userId: authed(req)?.id, leaders: isOn('leaderboard'), now: t }));
  });

  app.get('/api/poker/daily/history', (req, res) => {
    if (!isOn('leaderboard')) { res.status(404).json({ error: 'The leaderboard is switched off' }); return; }
    const days = Number(req.query.days ?? 14);
    reconcilePokerDaily(now());
    res.json({ days: pokerDailyHistory({ days: Number.isFinite(days) ? days : 14, userId: authed(req)?.id, now: now() }) });
  });

  app.post('/api/poker/daily/play', async (req, res) => {
    const p = player(req, res);
    if (!p) return;
    try {
      res.json(await playPokerDaily(p, { practice: req.body?.practice === true, fresh: req.body?.fresh === true, now: now() }));
    } catch (e) { failed(res, e); }
  });

  app.post('/api/poker/daily/answer', async (req, res) => {
    const p = player(req, res);
    if (!p) return;
    const { run, index, choice } = req.body ?? {};
    if (typeof run !== 'string' || run.length > 64 || !Number.isInteger(index) || typeof choice !== 'string' || choice.length > 16) {
      res.status(400).json({ error: 'Pick a move' });
      return;
    }
    try {
      res.json(await answerPokerDaily(p, { run, index, choice }, { now: now() }));
    } catch (e) { failed(res, e); }
  });

  app.post('/api/poker/daily/leave', (req, res) => {
    const p = player(req, res);
    if (!p) return;
    const run = req.body?.run;
    if (typeof run !== 'string' || run.length > 64) { res.status(400).json({ error: 'Which run?' }); return; }
    res.json(leavePokerDaily(p, run, now()));
  });

  app.get('/api/players/:id/poker-daily', (req, res) => {
    if (!isOn('leaderboard')) { res.status(404).json({ error: 'Player profiles are switched off' }); return; }
    reconcilePokerDaily(now());
    res.json({ profile: pokerDailyProfile(String(req.params.id), now()) });
  });
}
