// Two complaints, one missing step.
//
// "The chat duplicates when I switch tabs" and "the chat reloads fresh" are
// the same bug seen from two sides. Every subscribe replays the recent
// backlog, and a reconnect re-runs subscribe — so a sleeping tab waking up
// pasted the last stretch of conversation in again. Meanwhile the windows
// were short enough that a replay pushed the real history off the top, and a
// restart saved only a tail of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { ChatMsg, TournamentConfig } from '../../shared/types.ts';

const cb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
  lobbyChanged: () => {},
};

function makeT(ctx: { after: (fn: () => void) => void }) {
  const config = {
    name: `Chat ${Math.random()}`, startingStack: 10_000, levelMinutes: 60,
    structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0,
    approveRegistrations: false, buyIn: 0, prizeText: null, breakEveryLevels: 0,
    seatsPerTable: 9, social: null, maxReentries: 0, rabbitHunting: false,
    displayMode: 'chips',
  } as TournamentConfig;
  const t = new Tournament(config, { id: 'host', name: 'Host' }, cb as never);
  for (let i = 0; i < 3; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  ctx.after(() => t.dispose());
  return t;
}

test('a long conversation survives a restart intact', ctx => {
  const t = makeT(ctx);
  // A different speaker each time: slow mode is per player, and a real event
  // is hundreds of people talking, not one person spamming.
  for (let i = 0; i < 150; i++) {
    t.userChat({ id: `talker${i}`, name: `T${i}`, avatar: '🙂' }, `message ${i}`);
  }
  const snap = t.snapshot();
  assert.ok(
    snap.chatLog.length >= 150,
    `the snapshot carried ${snap.chatLog.length} of 150 messages — it used to keep 60`,
  );
  assert.equal(snap.chatLog[snap.chatLog.length - 1].text, 'message 149');
  // And the oldest one is still there, which is what "reloads fresh" was about.
  assert.ok(snap.chatLog.some(m => m.text === 'message 0'), 'the start of the conversation is kept');

  const back = Tournament.restore(snap, cb as never);
  ctx.after(() => back.dispose());
  assert.equal(back.chatLog.length, snap.chatLog.length, 'and it comes back');
});

test('every message carries an id the client can dedupe on', ctx => {
  const t = makeT(ctx);
  for (let i = 0; i < 20; i++) {
    t.userChat({ id: `talker${i}`, name: `T${i}`, avatar: '🙂' }, `m${i}`);
  }
  const ids = t.chatLog.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(ids.every(id => typeof id === 'string' && id.length > 0), true);
});

// The client-side half, exercised directly: a replayed backlog must fold into
// what is already held rather than stacking on top of it.
test('replaying a backlog does not duplicate what is already shown', async () => {
  const { mergeChat, CHAT_KEEP } = await import('../../client/src/chatlog.ts');
  const msg = (n: number): ChatMsg =>
    ({ id: `m${n}`, from: { id: 'p1', name: 'P1', avatar: '🙂' }, text: `m${n}`, ts: 1000 + n });

  let log: ChatMsg[] = [];
  for (let i = 0; i < 10; i++) log = mergeChat(log, msg(i));
  assert.equal(log.length, 10);

  // The tab wakes up and the server replays the last few.
  for (let i = 6; i < 10; i++) log = mergeChat(log, msg(i));
  assert.equal(log.length, 10, 'the replay changed nothing');
  assert.deepEqual(log.map(m => m.text), Array.from({ length: 10 }, (_, i) => `m${i}`));

  // A genuinely new one still lands.
  log = mergeChat(log, msg(10));
  assert.equal(log.length, 11);

  // Out-of-order arrivals are put back in time order.
  log = mergeChat(log, { ...msg(99), id: 'early', ts: 500, text: 'early' });
  assert.equal(log[0].text, 'early', 'sorted by time, not arrival');

  // And the window is deep enough that a replay cannot evict live history.
  let big: ChatMsg[] = [];
  for (let i = 0; i < CHAT_KEEP + 50; i++) big = mergeChat(big, msg(i));
  assert.equal(big.length, CHAT_KEEP);
});
