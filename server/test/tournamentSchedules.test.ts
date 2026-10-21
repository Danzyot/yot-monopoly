// Recurring tournaments: when the next occurrences fall (weekday wrap, plain
// UTC with no daylight saving), each one created exactly once (across a
// restart, a crash between two saves and a clock that steps back), skipped
// while the previous event is still running, pause and delete, every setting
// checked, and the operators-only socket API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-schedules-'));
process.env.ADMIN_DISCORD_IDS = '1001';
process.env.DEMO_MODE = '1';

const { TournamentManager } = await import('../src/tournament/manager.ts');
const { TournamentScheduler } = await import('../src/tournament/schedules.ts');
const { seeded } = await import('./helpers.ts');
const {
  DAY_MS, lastOccurrence, nextOccurrences, scheduleName, fmtDays, fmtUtcMinute, fmtLead,
} = await import('../../shared/tournamentSchedules.ts');
type Manager = InstanceType<typeof TournamentManager>;
type Adapter = ConstructorParameters<typeof TournamentManager>[0]['cards'];

const ADMIN = { id: 'dc_1001', name: 'Op', avatar: '🎩', isAdmin: true };
const PLAYER = { id: 'pl', name: 'Player', avatar: '🙂', isAdmin: false };
const p = (i: number) => ({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
const H = 3_600_000;
const MIN = 60_000;

/** Monday 19 October 2026, 00:00 UTC. */
const MON = Date.UTC(2026, 9, 19);

/** Tables that open, fill and then play for ever (the event stays running until it is cancelled). */
function endlessGame(): Adapter {
  let n = 0;
  const rooms = new Map<string, string[]>();
  return {
    graceMs: 0,
    open(_lock, players) { const code = `S${++n}`; rooms.set(code, players.map(x => x.id)); return code; },
    attach: code => rooms.has(code),
    present: code => rooms.get(code) ?? null,
    begin: code => rooms.has(code),
    result: code => (rooms.has(code) ? null : 'gone'),
    timeUp() {},
    isPaused: () => false,
    setPaused() {},
    remove() {},
    close(code) { rooms.delete(code); },
  };
}

function world(start = MON, files = { t: `t-${Math.random().toString(36).slice(2)}.json`, s: `s-${Math.random().toString(36).slice(2)}.json` }) {
  let clock = start;
  const now = () => clock;
  const boot = () => {
    const m: Manager = new TournamentManager({ cards: endlessGame() }, { onChange() {} }, { now, rng: seeded(4), file: files.t });
    const s = new TournamentScheduler(m, { onChange() {} }, { file: files.s });
    return { m, s };
  };
  let { m, s } = boot();
  const w = {
    get m() { return m; },
    get s() { return s; },
    files,
    now,
    set(at: number) { clock = at; m.tick(); s.tick(); },
    advance(ms: number) { w.set(clock + ms); },
    /** The server goes down (after its last save) and comes back. */
    restart() {
      m.saveNow();
      m.stop();
      s.stop();
      ({ m, s } = boot());
      m.restore();
      s.restore();
    },
  };
  return w;
}

const MONDAY_CUP = {
  name: 'Monday Night Cup', days: [1], minute: 20 * 60, leadMinutes: 360, prize: 'A Chog plushie',
  settings: { cardsMode: 'chaos', tableSize: 4 },
};

test('occurrences: the next starts on the chosen UTC weekdays, strictly after now', () => {
  assert.equal(new Date(MON).getUTCDay(), 1, 'the fixture is a Monday');
  const mon20 = MON + 20 * H;
  assert.deepEqual(nextOccurrences([1], 1200, MON, 3), [mon20, mon20 + 7 * DAY_MS, mon20 + 14 * DAY_MS]);
  assert.deepEqual(nextOccurrences([1], 1200, mon20 - 1, 1), [mon20], 'a minute before is still today');
  assert.deepEqual(nextOccurrences([1], 1200, mon20, 1), [mon20 + 7 * DAY_MS], 'exactly at the start is the next week');
  // Several days, in time order, across the week.
  const mwf = nextOccurrences([5, 1, 3], 1200, MON + 21 * H, 4);
  assert.deepEqual(mwf.map(t => new Date(t).getUTCDay()), [3, 5, 1, 3]);
  assert.deepEqual(nextOccurrences([], 1200, MON), [], 'no days, no occurrences');
  assert.deepEqual(nextOccurrences([1], 24 * 60, MON), [], 'a minute past the end of the day is refused');
});

test('occurrences: the weekday wraps into the next week, month and year', () => {
  const sat23 = MON + 5 * DAY_MS + 23 * H;
  assert.equal(new Date(sat23).getUTCDay(), 6);
  assert.deepEqual(nextOccurrences([0], 30, sat23, 1), [MON + 6 * DAY_MS + 30 * MIN], 'Saturday night to Sunday 00:30');
  assert.deepEqual(nextOccurrences([5], 1200, sat23, 1), [MON + 11 * DAY_MS + 20 * H], 'Saturday to next Friday');
  assert.deepEqual(nextOccurrences([1], 1200, MON + 21 * H, 1), [MON + 7 * DAY_MS + 20 * H], 'Monday after the start: next Monday');
  // Thursday 31 December 2026 to Friday 1 January 2027.
  assert.deepEqual(nextOccurrences([5], 9 * 60, Date.UTC(2026, 11, 31, 12), 1), [Date.UTC(2027, 0, 1, 9)]);
  // Every day at 23:59 just before midnight, then just after.
  assert.deepEqual(nextOccurrences([0, 1, 2, 3, 4, 5, 6], 1439, MON + 23 * H + 59 * MIN, 1), [MON + DAY_MS + 23 * H + 59 * MIN]);
});

test('occurrences: plain UTC, the same wall-clock hour through every daylight-saving change', () => {
  // Europe falls back on 25 October 2026 and the US on 1 November: UTC does neither.
  const weeks = nextOccurrences([1], 1200, MON, 6);
  for (let i = 1; i < weeks.length; i++) assert.equal(weeks[i] - weeks[i - 1], 7 * DAY_MS, `week ${i} is exactly 7 days`);
  for (const t of weeks) {
    assert.equal(new Date(t).getUTCHours(), 20);
    assert.equal(new Date(t).getUTCMinutes(), 0);
    assert.equal(new Date(t).getUTCDay(), 1);
  }
  // March 2027 (spring forward) as well.
  const spring = nextOccurrences([0], 1 * 60 + 30, Date.UTC(2027, 2, 20), 3);
  assert.deepEqual(spring, [Date.UTC(2027, 2, 21, 1, 30), Date.UTC(2027, 2, 28, 1, 30), Date.UTC(2027, 3, 4, 1, 30)]);
  // The latest start at or before a time, for passing over missed ones.
  assert.equal(lastOccurrence([1], 1200, MON + 20 * H), MON + 20 * H);
  assert.equal(lastOccurrence([1], 1200, MON + 20 * H - 1), MON + 20 * H - 7 * DAY_MS);
  assert.equal(lastOccurrence([], 1200, MON), null);
});

test('names and labels: the number goes at the end or where {n} is', () => {
  assert.equal(scheduleName('Monday Night Cup', 3), 'Monday Night Cup #3');
  assert.equal(scheduleName('Cup {n}: Chaos', 12), 'Cup 12: Chaos');
  assert.equal(fmtDays([1]), 'Mondays');
  assert.equal(fmtDays([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(fmtDays([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(fmtDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(fmtUtcMinute(1200), '20:00');
  assert.equal(fmtUtcMinute(65), '01:05');
  assert.equal(fmtLead(1440), '1 day');
  assert.equal(fmtLead(360), '6 h');
});

test('each occurrence is created once, at its lead time, as an ordinary operator tournament', () => {
  const w = world();
  const sched = w.s.save(ADMIN, MONDAY_CUP);
  assert.equal(sched.nextNumber, 1);
  assert.deepEqual(w.s.view(sched).next.map(o => o.name), ['Monday Night Cup #1', 'Monday Night Cup #2', 'Monday Night Cup #3']);
  assert.deepEqual(w.s.upcoming().map(e => [e.name, e.start, e.opensAt]), [['Monday Night Cup #1', MON + 20 * H, MON + 14 * H]]);

  w.set(MON + 14 * H - 1);
  assert.equal(w.m.tournaments.size, 0, 'not before the lead time');
  w.set(MON + 14 * H);
  assert.equal(w.m.tournaments.size, 1);
  const [t] = w.m.tournaments.values();
  assert.equal(t.d.name, 'Monday Night Cup #1');
  assert.equal(t.d.status, 'registering');
  assert.equal(t.d.prize, 'A Chog plushie');
  assert.equal(t.d.hostId, ADMIN.id, 'hosted by the operator who set the schedule up');
  assert.equal(t.d.settings.startAt, MON + 20 * H);
  assert.equal(t.d.settings.cardsMode, 'chaos');
  assert.equal(t.d.settings.tableSize, 4);
  assert.equal(t.d.settings.maxPlayers, null, 'no cap unless the schedule sets one');
  assert.deepEqual(t.d.schedule, { id: sched.id, slot: MON + 20 * H, n: 1 });
  assert.equal(w.m.summary(t).scheduleId, sched.id);
  assert.equal(w.s.upcoming()[0].name, 'Monday Night Cup #2', 'the list now shows the event itself, and #2 as scheduled');
  assert.equal(w.s.next()?.href, `/tournaments/${t.id}`);
  assert.equal(w.s.next()?.open, true);
  // Players register for it like any other.
  w.m.register(t.id, p(1));

  for (let i = 0; i < 20; i++) w.advance(5 * MIN);
  assert.equal(w.m.tournaments.size, 1, 'ticking on makes no second one');
  assert.equal(w.s.schedules.get(sched.id)!.nextNumber, 2);
  assert.equal(w.s.view(w.s.schedules.get(sched.id)!).log[0].kind, 'created');

  // The next Monday: #2 (the first was called off at its start with one player).
  w.set(MON + 7 * DAY_MS + 14 * H);
  assert.equal(t.d.status, 'cancelled');
  const names = [...w.m.tournaments.values()].map(x => x.d.name);
  assert.deepEqual(names, ['Monday Night Cup #1', 'Monday Night Cup #2']);
});

test('exactly once across a restart, a crash between the two saves, and a clock that steps back', () => {
  const w = world();
  const sched = w.s.save(ADMIN, MONDAY_CUP);
  const before = readFileSync(join(process.env.DATA_DIR!, w.files.s), 'utf8');
  w.set(MON + 15 * H);
  assert.equal(w.m.tournaments.size, 1);
  const id = [...w.m.tournaments.keys()][0];

  // A plain restart: the event and the schedule's watermark both came back.
  w.restart();
  w.advance(MIN);
  assert.deepEqual([...w.m.tournaments.keys()], [id], 'no second event after a restart');
  assert.equal(w.s.schedules.get(sched.id)!.nextNumber, 2);

  // The server died after saving the event but before saving the schedule.
  writeFileSync(join(process.env.DATA_DIR!, w.files.s), before);
  w.restart();
  assert.equal(w.s.schedules.get(sched.id)!.nextNumber, 1, 'the schedule came back from before the event');
  w.advance(MIN);
  assert.deepEqual([...w.m.tournaments.keys()], [id], 'the event already on the list counts as made');
  assert.equal(w.s.schedules.get(sched.id)!.nextNumber, 2, 'and its number is not used twice');
  assert.equal(w.s.schedules.get(sched.id)!.handledUntil, MON + 20 * H);

  // The clock steps back an hour, before the lead time, and forward again.
  w.set(MON + 13 * H);
  w.set(MON + 14 * H);
  w.set(MON + 19 * H);
  assert.equal(w.m.tournaments.size, 1, 'clock drift makes no second event');
  assert.equal(w.s.upcoming()[0].start, MON + 7 * DAY_MS + 20 * H);
});

test('an occurrence whose start passed while the server was down is not created late', () => {
  const w = world();
  w.s.save(ADMIN, { ...MONDAY_CUP, leadMinutes: 60 });
  w.set(MON + 18 * H);
  w.m.saveNow();
  // Down from 18:00 to 21:00: the 19:00 lead time and the 20:00 start both went by.
  w.restart();
  w.set(MON + 21 * H);
  assert.equal(w.m.tournaments.size, 0);
  const d = [...w.s.schedules.values()][0];
  assert.equal(d.log[0].kind, 'missed');
  assert.equal(d.log[0].slot, MON + 20 * H);
  assert.equal(d.nextNumber, 1, 'a missed one takes no number');
  w.set(MON + 7 * DAY_MS + 19 * H);
  assert.equal([...w.m.tournaments.values()][0].d.name, 'Monday Night Cup #1');
});

test('skipped while the previous event is still running, then back on schedule', () => {
  const w = world();
  // Every day at 20:00, created an hour ahead.
  const sched = w.s.save(ADMIN, { ...MONDAY_CUP, name: 'Daily Dash', days: [0, 1, 2, 3, 4, 5, 6], leadMinutes: 60 });
  w.set(MON + 19 * H);
  const first = [...w.m.tournaments.values()][0];
  for (let i = 0; i < 3; i++) w.m.register(first.id, p(i));
  w.set(MON + 20 * H);
  assert.equal(first.d.status, 'running');

  // Tuesday 19:00: due, but Monday's event is still being played.
  w.set(MON + DAY_MS + 19 * H);
  assert.equal(first.d.status, 'running');
  assert.equal(w.m.tournaments.size, 1, 'not created while the previous one runs');
  assert.equal(w.s.view(w.s.schedules.get(sched.id)!).waiting, true);
  w.set(MON + DAY_MS + 19 * H + 30 * MIN);
  assert.equal(w.m.tournaments.size, 1);
  // Its start comes and Monday's is still running: Tuesday's is skipped.
  w.set(MON + DAY_MS + 20 * H);
  assert.equal(w.m.tournaments.size, 1);
  const log = w.s.schedules.get(sched.id)!.log;
  assert.equal(log[0].kind, 'skipped');
  assert.equal(log[0].slot, MON + DAY_MS + 20 * H);
  assert.match(log[0].note!, /Daily Dash #1 was still running/);
  assert.equal(w.s.view(w.s.schedules.get(sched.id)!).waiting, false);
  assert.equal(w.s.schedules.get(sched.id)!.nextNumber, 2, 'a skipped one takes no number');

  // Monday's ends (called off here); Wednesday's is made as usual, as #2.
  w.m.cancel(first.id, ADMIN, 'Long enough');
  w.set(MON + 2 * DAY_MS + 19 * H);
  const names = [...w.m.tournaments.values()].map(t => t.d.name);
  assert.deepEqual(names, ['Daily Dash #1', 'Daily Dash #2']);
});

test('a previous event still running only holds the next one back until it finishes', () => {
  const w = world();
  w.s.save(ADMIN, { ...MONDAY_CUP, name: 'Daily Dash', days: [0, 1, 2, 3, 4, 5, 6], leadMinutes: 120 });
  w.set(MON + 18 * H);
  const first = [...w.m.tournaments.values()][0];
  for (let i = 0; i < 3; i++) w.m.register(first.id, p(i));
  w.set(MON + 20 * H);
  w.set(MON + DAY_MS + 18 * H);
  assert.equal(w.m.tournaments.size, 1, 'held back');
  w.m.cancel(first.id, ADMIN);
  w.advance(MIN);
  assert.equal(w.m.tournaments.size, 2, 'made as soon as the previous one is over, before its start');
});

test('lead times longer than the gap: several events open at once, each once', () => {
  const w = world();
  w.s.save(ADMIN, { ...MONDAY_CUP, name: 'Daily', days: [0, 1, 2, 3, 4, 5, 6], leadMinutes: 4320 });
  w.advance(MIN);
  assert.deepEqual([...w.m.tournaments.values()].map(t => t.d.name), ['Daily #1', 'Daily #2', 'Daily #3']);
  w.advance(MIN);
  assert.equal(w.m.tournaments.size, 3);
});

test('pause and delete: nothing created while paused, nothing made up afterwards; deleting keeps its events', () => {
  const w = world();
  const sched = w.s.save(ADMIN, MONDAY_CUP);
  w.s.setEnabled(ADMIN, sched.id, false);
  assert.deepEqual(w.s.upcoming(), [], 'a paused schedule is not on the public list');
  assert.deepEqual(w.s.view(sched).next, []);
  w.set(MON + 14 * H);
  w.set(MON + 21 * H);
  assert.equal(w.m.tournaments.size, 0, 'nothing while paused');

  // Carrying on after the start went by: that one is not made late, and not logged as missed.
  w.s.setEnabled(ADMIN, sched.id, true);
  assert.equal(w.m.tournaments.size, 0);
  assert.equal(w.s.schedules.get(sched.id)!.log.length, 0);
  assert.equal(w.s.upcoming()[0].start, MON + 7 * DAY_MS + 20 * H);
  w.set(MON + 7 * DAY_MS + 14 * H);
  assert.equal(w.m.tournaments.size, 1);

  // Paused and resumed inside the lead window: the already-made event is not made again.
  w.s.setEnabled(ADMIN, sched.id, false);
  w.s.setEnabled(ADMIN, sched.id, true);
  w.advance(MIN);
  assert.equal(w.m.tournaments.size, 1);

  // Paused across a restart stays paused.
  w.s.setEnabled(ADMIN, sched.id, false);
  w.restart();
  assert.equal(w.s.schedules.get(sched.id)!.enabled, false);
  w.set(MON + 14 * DAY_MS + 14 * H);
  assert.equal(w.m.tournaments.size, 1);

  // Deleting: gone for good (a restart does not bring it back); the event it made stays.
  w.s.remove(ADMIN, sched.id);
  assert.equal(w.s.schedules.size, 0);
  w.restart();
  assert.equal(w.s.schedules.size, 0);
  w.set(MON + 21 * DAY_MS + 14 * H);
  assert.equal(w.m.tournaments.size, 1);
  assert.throws(() => w.s.setEnabled(ADMIN, sched.id, true), /No schedule/);
});

test('editing: the new rule applies from now, numbers can be set, and every setting is checked', () => {
  const w = world();
  const sched = w.s.save(ADMIN, MONDAY_CUP);
  const edited = w.s.save(ADMIN, { ...MONDAY_CUP, id: sched.id, name: 'Cup {n} Chaos', days: [3], minute: 18 * 60 + 30, nextNumber: 7 });
  assert.equal(edited.id, sched.id);
  assert.equal(w.s.schedules.size, 1);
  assert.deepEqual(w.s.view(edited).next[0], {
    start: MON + 2 * DAY_MS + 18.5 * H, opensAt: MON + 2 * DAY_MS + 12.5 * H, n: 7, name: 'Cup 7 Chaos',
  });

  const bad: [Record<string, unknown>, RegExp][] = [
    [{ name: 'x' }, /name/],
    [{ days: [] }, /at least one day/],
    [{ days: [7] }, /Unknown day/],
    [{ minute: 1440 }, /start time/],
    [{ minute: 'soon' }, /start time/],
    [{ leadMinutes: 7 }, /lead time/],
    [{ nextNumber: 0 }, /next number/],
    [{ settings: { maxPlayers: 2 } }, /at least 3 players/],
    [{ settings: { cardsMode: 'party' } }, /Unknown mode/],
    [{ settings: { tableSize: 12 } }, /Tables seat/],
  ];
  for (const [patch, msg] of bad) assert.throws(() => w.s.save(ADMIN, { ...MONDAY_CUP, ...patch }), msg, JSON.stringify(patch));
  const capped = w.s.save(ADMIN, { ...MONDAY_CUP, settings: { maxPlayers: 32 } });
  assert.equal(capped.settings.maxPlayers, 32);
  assert.equal(capped.settings.cardsMode, 'classic', 'defaults for anything left out');
  assert.equal('startAt' in capped.settings, false, 'the schedule sets the start');
});

test('operators only: a player cannot list, create, edit, pause or delete schedules', () => {
  const w = world();
  const sched = w.s.save(ADMIN, MONDAY_CUP);
  assert.throws(() => w.s.list(PLAYER), /Only operators/);
  assert.throws(() => w.s.save(PLAYER, { ...MONDAY_CUP, name: 'Mine' }), /Only operators/);
  assert.throws(() => w.s.save(PLAYER, { ...MONDAY_CUP, id: sched.id, name: 'Mine' }), /Only operators/);
  assert.throws(() => w.s.setEnabled(PLAYER, sched.id, false), /Only operators/);
  assert.throws(() => w.s.remove(PLAYER, sched.id), /Only operators/);
  assert.equal(w.s.schedules.get(sched.id)!.name, 'Monday Night Cup');
  assert.equal(w.s.schedules.get(sched.id)!.enabled, true);
  assert.equal(w.s.list(ADMIN).length, 1);
});

test('the socket API: operators manage schedules, players and guests are refused, everyone sees the scheduled events', async () => {
  const { Server } = await import('socket.io');
  const { io: connect } = await import('socket.io-client');
  const { attachSockets } = await import('../src/sockets.ts');
  const { attachCardsSockets } = await import('../src/cards/sockets.ts');
  const { attachTournaments } = await import('../src/tournament/sockets.ts');
  const { signToken, makeDemoProfile } = await import('../src/auth.ts');

  const http = createServer();
  const io = new Server(http);
  const mono = attachSockets(io);
  const cards = attachCardsSockets(io, { taken: code => !!mono.registry.get(code) });
  const { manager, scheduler } = attachTournaments(io, { monopoly: mono, cards }, { tickMs: 0 });
  http.listen(0);
  await new Promise(r => http.once('listening', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  type Reply = { ok: boolean; error?: string; [k: string]: unknown };
  const client = async (token?: string) => {
    const c = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    await new Promise(r => c.once('hello', r));
    return { c, call: (event: string, payload?: unknown) => new Promise<Reply>(r => c.emit(event, payload, r)) };
  };
  const op = await client(signToken({ id: 'dc_1001', name: 'Op', avatar: '🎩', provider: 'discord', discord: { id: '1001', username: 'op' } }));
  const player = await client(signToken(makeDemoProfile('Player')));
  const guest = await client();
  try {
    // Every day, half a day away from now (real time here): nothing is due during the test.
    const minute = (new Date().getUTCHours() * 60 + 720) % 1440;
    const created = await op.call('tourney:sched:save', { ...MONDAY_CUP, days: [0, 1, 2, 3, 4, 5, 6], minute, leadMinutes: 60 });
    assert.equal(created.ok, true, created.error);
    const id = (created.schedule as { id: string }).id;

    for (const who of [player, guest]) {
      for (const [event, payload] of [
        ['tourney:sched:list', {}], ['tourney:sched:save', { ...MONDAY_CUP }], ['tourney:sched:save', { ...MONDAY_CUP, id, name: 'Hijack' }],
        ['tourney:sched:enable', { id, enabled: false }], ['tourney:sched:delete', { id }],
      ] as const) {
        const r = await who.call(event, payload);
        assert.equal(r.ok, false, `${event} refused`);
        assert.match(r.error!, who === guest ? /Sign in/ : /Only operators/);
      }
    }
    assert.equal(scheduler.schedules.size, 1);
    assert.equal(scheduler.schedules.get(id)!.name, 'Monday Night Cup');
    assert.equal(scheduler.schedules.get(id)!.enabled, true);

    // Everyone sees what is scheduled with the list; operators see the schedules themselves.
    const pub = await guest.call('tourney:list', {});
    assert.equal((pub.scheduled as unknown[]).length, 1);
    assert.equal('schedules' in pub, false);
    const listed = await op.call('tourney:sched:list', { subscribe: true });
    assert.equal((listed.schedules as { id: string }[])[0].id, id);

    // Operators following schedules hear of a change.
    const heard = new Promise<{ enabled: boolean }[]>(r => op.c.once('tourney:schedules', r));
    assert.equal((await op.call('tourney:sched:enable', { id, enabled: false })).ok, true);
    assert.equal((await heard)[0].enabled, false);
    assert.equal(((await guest.call('tourney:list', {})).scheduled as unknown[]).length, 0);
    assert.equal((await op.call('tourney:sched:delete', { id })).ok, true);
    assert.equal(scheduler.schedules.size, 0);
    assert.equal(manager.tournaments.size, 0);
  } finally {
    for (const c of [op, player, guest]) c.c.close();
    manager.stop();
    scheduler.stop();
    io.close();
  }
});
