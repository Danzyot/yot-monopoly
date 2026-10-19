// Cutscene cues (shared/cutscenes.ts) and the room waiting for them before a bot moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUTSCENE_MS, cutscenesMs, pickCutscene, pickCutscenes, type CutsceneSnap } from '../../shared/cutscenes.ts';
import { Room } from '../src/rooms.ts';

const snap = (o: Partial<CutsceneSnap> = {}): CutsceneSnap => ({ jailed: [], out: [], pot: 0, winner: null, current: 'a', ...o });

test('cutscenes: one cue per change, the biggest wins', () => {
  assert.equal(pickCutscene(snap(), snap()), null);
  assert.deepEqual(pickCutscene(snap(), snap({ jailed: ['a'] })), { kind: 'jail', player: 'a' });
  assert.equal(pickCutscene(snap({ jailed: ['a'] }), snap({ jailed: ['a'] })), null, 'already in jail');
  assert.deepEqual(pickCutscene(snap({ pot: 350, current: 'b' }), snap({ pot: 0, current: 'b' })), { kind: 'jackpot', player: 'b', amount: 350 });
  assert.equal(pickCutscene(snap({ pot: 350 }), snap({ pot: 400 })), null, 'the pot growing is no jackpot');
  assert.deepEqual(pickCutscene(snap(), snap({ out: ['b'] })), { kind: 'bankrupt', player: 'b' });
  // The last rival going bankrupt ends the game: the loser's moment first, then the winner's.
  assert.deepEqual(pickCutscene(snap(), snap({ out: ['b'], winner: 'a' })), { kind: 'bankrupt', player: 'b' });
  assert.deepEqual(pickCutscenes(snap(), snap({ out: ['b'], winner: 'a' })), [{ kind: 'bankrupt', player: 'b' }, { kind: 'winner', player: 'a' }]);
  // Won some other way (the game-length limit): just the winner.
  assert.deepEqual(pickCutscenes(snap({ out: ['b'] }), snap({ out: ['b'], winner: 'a' })), [{ kind: 'winner', player: 'a' }]);
  assert.deepEqual(pickCutscenes(snap(), snap()), []);
  assert.equal(cutscenesMs(pickCutscenes(snap(), snap({ out: ['b'], winner: 'a' }))), CUTSCENE_MS.bankrupt + CUTSCENE_MS.winner);
  // Sent to jail and broke in one change: the bankruptcy.
  assert.equal(pickCutscene(snap(), snap({ out: ['b'], jailed: ['a'] }))!.kind, 'bankrupt');
  for (const ms of Object.values(CUTSCENE_MS)) assert.ok(ms > 0 && ms <= 6000, 'each cutscene stays short');
});

test('room: bots wait out a cutscene before their next move', () => {
  const r = new Room('CUTS', 'a', { onChange() {}, onEvent() {}, onFinished() {} });
  r.join({ id: 'a', name: 'A', avatar: '' });
  r.join({ id: 'b', name: 'B', avatar: '' });
  r.start('a', false);
  const until = () => (r as unknown as { sceneUntil: number }).sceneUntil;
  const before = Date.now();
  const other = r.game!.current.id === 'a' ? 'b' : 'a';
  r.adminFix(g => g.adminJail(other, true), 'jail', 'Operator');
  assert.ok(until() >= before + CUTSCENE_MS.jail, 'the jail cutscene is waited for');
  r.dispose();
});
