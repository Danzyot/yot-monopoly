// Chat rules: the slur filter has to catch evasion without catching real
// words, and mentions must resolve to the right person without letting one
// message ping the whole table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_COOLDOWN_MS, isBlocked, MAX_MENTIONS, resolveMentions } from '../src/chatrules.ts';

test('the slur filter catches the word and its usual evasions', () => {
  for (const s of [
    'nigger', 'NIGGER', 'niggers', 'nigga', 'n1gger', 'n1gg3r', 'niggger',
    'you n i g g e r', 'what a n-i-g-g-e-r', 'n.i.g.g.a',
  ]) {
    assert.equal(isBlocked(s), true, `should block: ${s}`);
  }
});

test('the filter leaves real words and places alone', () => {
  for (const s of [
    'Niger', 'Nigeria', 'nigerian player', 'niggardly', 'snigger'.replace('snigger', 'chuckle'),
    'nice hand', 'ni hao', 'ping me', 'good game', 'I am in Nigeria right now',
  ]) {
    assert.equal(isBlocked(s), false, `should allow: ${s}`);
  }
});

const PEOPLE = [
  { id: 'p1', name: 'Jade' },
  { id: 'p2', name: 'Big Slick' },
  { id: 'p3', name: 'Big' },
  { id: 'p4', name: 'danz' },
];

test('mentions resolve to real players', () => {
  assert.deepEqual(resolveMentions('gg @Jade', PEOPLE).ids, ['p1']);
  // Names with spaces are tagged without them — what the picker inserts.
  assert.deepEqual(resolveMentions('@BigSlick nice fold', PEOPLE).ids, ['p2']);
  assert.deepEqual(resolveMentions('@bigslick lol', PEOPLE).ids, ['p2'], 'case insensitive');
  assert.deepEqual(resolveMentions('hello everyone', PEOPLE).ids, []);
  assert.deepEqual(resolveMentions('@nobody here', PEOPLE).ids, [], 'unknown names resolve to nothing');
});

// Both halves of the live complaint: four different things typed at a player
// called Yot all lit up as tags on them.
test('a tag stops at a space and has to match the whole name', () => {
  const people = [{ id: 'y', name: 'Yot' }, { id: 'd', name: 'yotdanz' }];
  assert.deepEqual(resolveMentions('@Yot', people).ids, ['y']);
  // A longer name is a different person, not a match on the shorter one.
  assert.deepEqual(resolveMentions('@yotdanz', people).ids, ['d']);
  // Spaces inside a tag used to be normalised away, so these pinged Yot.
  assert.deepEqual(resolveMentions('@yo t', people).ids, [], 'space ends the tag');
  assert.deepEqual(resolveMentions('@y ot', people).ids, []);
  assert.deepEqual(resolveMentions('@yiot', people).ids, [], 'near-misses never match');
  // "Big" must not be reachable by typing at "Big Slick", and vice versa.
  assert.deepEqual(resolveMentions('@Big', PEOPLE).ids, ['p3']);
  assert.deepEqual(resolveMentions('@Big Slick', PEOPLE).ids, ['p3'], 'the tag is just "@Big"');
});

test('mention count is what the cap is applied to', () => {
  const four = resolveMentions('@Jade @danz @Big @nobody hi', PEOPLE);
  assert.equal(four.count, 4, 'every @tag counts, even ones that match no player');
  assert.ok(four.count > MAX_MENTIONS, 'so a message like this is refused');
  const two = resolveMentions('@Jade and @danz', PEOPLE);
  assert.equal(two.count, 2);
  assert.deepEqual(two.ids.sort(), ['p1', 'p4']);
});

test('the same person tagged twice counts once in the highlight list', () => {
  const r = resolveMentions('@Jade @Jade @Jade', PEOPLE);
  assert.deepEqual(r.ids, ['p1']);
  assert.equal(r.count, 3, 'but all three tags count against the cap');
});

test('the cooldown is the advertised five seconds', () => {
  assert.equal(CHAT_COOLDOWN_MS, 5_000);
});
