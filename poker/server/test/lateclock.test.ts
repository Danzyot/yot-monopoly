// Extra time near the end: once the field is down to the host's number of
// players, every decision gets extra seconds on top of the turn limit.
//
// Like the opening bet cap, it lives on the event and is read live by each
// table when a clock starts — so a table created late, a moved player or a
// restart can neither lose the extra time nor get it twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament, parseLateClock, SEATING_GRACE_MS } from '../src/tournament/tournament.ts';
import { joinEveryone } from './seating.ts';

type LC = { players: number; extraSeconds: number } | null;

function tourney(lateClock: LC, ctx: { after: (fn: () => void) => void }, chat: string[] = []) {
  const t = new Tournament(
    {
      name: `Late ${Math.random()}`, startingStack: 10_000, levelMinutes: 10,
      structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15,
      approveRegistrations: false, buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9,
      social: null, maxReentries: 0, prizeText: null, rabbitHunting: false,
      displayMode: 'chips', actionSeconds: 10, lateClock,
    },
    { id: 'host', name: 'Host' },
    {
      broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
      broadcastTourney: () => {}, tourneyChat: (_t: unknown, m: { text: string }) => chat.push(m.text),
      assigned: () => {}, lobbyChanged: () => {}, finished: () => {}, eliminated: () => {},
    } as never,
  );
  ctx.after(() => t.dispose());
  return t;
}

const field = (t: Tournament, n: number) => {
  for (let i = 0; i < n; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
};

test('off unless the host sends a sensible setting', () => {
  assert.equal(parseLateClock(undefined), null);
  assert.equal(parseLateClock(null), null);
  assert.equal(parseLateClock(true), null);
  assert.equal(parseLateClock({ players: 1, extraSeconds: 10 }), null, 'one player left is the winner');
  assert.equal(parseLateClock({ players: 30, extraSeconds: 0 }), null, 'no extra seconds is off');
  assert.deepEqual(parseLateClock({}), { players: 30, extraSeconds: 10 }, 'on with no numbers takes the defaults');
  assert.deepEqual(parseLateClock({ players: '25', extraSeconds: 999 }), { players: 25, extraSeconds: 120 });
});

test('nothing is added while the field is bigger than the mark', ctx => {
  const t = tourney({ players: 5, extraSeconds: 10 }, ctx);
  field(t, 12);
  t.start();
  joinEveryone(t);
  assert.equal(t.lateClockMs(), 0);
  for (const tb of t.tables.values()) assert.equal(tb.tourneyInfo!()!.lateClockSeconds, 0);
});

test('nothing before the start, and nothing when switched off', ctx => {
  const before = tourney({ players: 30, extraSeconds: 10 }, ctx);
  field(before, 4);
  assert.equal(before.lateClockMs(), 0, 'registration is not "near the end"');

  const off = tourney(null, ctx);
  field(off, 4);
  off.start();
  joinEveryone(off);
  assert.equal(off.lateClockMs(), 0);
});

test('at the mark every table shows it, and a turn really gets the extra seconds', ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = tourney({ players: 30, extraSeconds: 15 }, ctx);
  field(t, 12);
  t.start();
  joinEveryone(t);
  assert.equal(t.lateClockMs(), 15_000, '12 players is within the last 30');
  for (const tb of t.tables.values()) assert.equal(tb.tourneyInfo!()!.lateClockSeconds, 15);

  // Let the first hands deal and look at the clock the player was given.
  ctx.mock.timers.tick(SEATING_GRACE_MS + 10_000);
  const live = [...t.tables.values()].find(tb => tb.actionDeadline !== null);
  assert.ok(live, 'a hand is waiting on someone');
  assert.equal(live.actionDeadline! - live.actionStarted!, 10_000 + 15_000, 'turn limit plus the extra');
});

test('crossing the mark switches it on and tells everyone once', ctx => {
  const chat: string[] = [];
  const t = tourney({ players: 8, extraSeconds: 10 }, ctx, chat);
  field(t, 12);
  t.start();
  joinEveryone(t);
  assert.equal(t.lateClockMs(), 0);

  for (const id of ['p0', 'p1', 'p2', 'p3']) t.players.get(id)!.busted = true;
  assert.equal(t.lateClockMs(), 10_000, 'eight left is the mark');
  const announce = (t as unknown as { maybeAnnounceLateClock(): void }).maybeAnnounceLateClock.bind(t);
  announce();
  announce();
  const said = chat.filter(m => /\+10s on every decision/.test(m));
  assert.equal(said.length, 1, 'announced exactly once');
  assert.match(said[0], /Down to 8 players/);
});

test('the host can switch it on, change it and switch it off mid-event', ctx => {
  const t = tourney(null, ctx);
  field(t, 6);
  t.start();
  joinEveryone(t);
  t.updateSettings({ lateClock: { players: 30, extraSeconds: 20 } });
  assert.equal(t.lateClockMs(), 20_000);
  t.updateSettings({ lateClock: { players: 3, extraSeconds: 20 } });
  assert.equal(t.lateClockMs(), 0, 'six left is above a mark of three');
  t.updateSettings({ lateClock: null });
  assert.equal(t.config.lateClock, null);
  assert.equal(t.lateClockMs(), 0);
});

test('a restart keeps the setting and does not announce it again', ctx => {
  const chat: string[] = [];
  const t = tourney({ players: 30, extraSeconds: 10 }, ctx, chat);
  field(t, 4);
  t.start();
  joinEveryone(t);
  (t as unknown as { maybeAnnounceLateClock(): void }).maybeAnnounceLateClock();
  const snap = JSON.parse(JSON.stringify(t.snapshot()));
  const chat2: string[] = [];
  const r = Tournament.restore(snap, {
    broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
    broadcastTourney: () => {}, tourneyChat: (_t: unknown, m: { text: string }) => chat2.push(m.text),
    assigned: () => {}, lobbyChanged: () => {}, finished: () => {}, eliminated: () => {},
  } as never);
  ctx.after(() => r.dispose());
  assert.equal(r.lateClockMs(), 10_000);
  for (const tb of r.tables.values()) assert.equal(tb.extraActionMs!(), 10_000, 'restored tables ask the event too');
  (r as unknown as { maybeAnnounceLateClock(): void }).maybeAnnounceLateClock();
  assert.equal(chat2.filter(m => /on every decision/.test(m)).length, 0);
});
