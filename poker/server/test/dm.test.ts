// The winner DM is the one piece of text that leaves the site and lands in
// someone's Discord inbox, so the bits that get it wrong in public — the
// ordinal, and claiming a prize that was never offered — are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordinal } from '../../client/src/format.ts';
import { draftFor } from '../../client/src/dmdraft.ts';

test('ordinals read correctly, including the teens', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  // The classic trap: 11/12/13 are "th", not "st/nd/rd".
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(13), '13th');
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(111), '111th');
});

test('the winner draft congratulates rather than reporting a placing', () => {
  const d = draftFor({ playerId: 'p', name: 'Jade', place: 1, tournamentName: 'Sunday Major' });
  assert.match(d, /you won Sunday Major/);
  assert.doesNotMatch(d, /1st/, 'first place is "you won", not "you finished 1st"');
});

test('everyone else gets their placing', () => {
  const d = draftFor({ playerId: 'p', name: 'Bob', place: 3, tournamentName: 'Sunday Major' });
  assert.match(d, /finished 3rd in Sunday Major/);
});

test('prizes appear only when the tournament actually offered some', () => {
  const withPrize = draftFor({
    playerId: 'p', name: 'Jade', place: 1, tournamentName: 'Major',
    prizeText: '1st: evaluation account',
  });
  assert.match(withPrize, /Prizes:\n1st: evaluation account/);

  for (const prizeText of [null, undefined, '']) {
    const none = draftFor({ playerId: 'p', name: 'Jade', place: 1, tournamentName: 'Major', prizeText });
    assert.doesNotMatch(none, /Prizes/, `no prize block for ${JSON.stringify(prizeText)}`);
  }
});

test('a player with no finish gets a blank draft to write themselves', () => {
  assert.equal(draftFor({ playerId: 'p', name: 'Jade' }), '');
  assert.equal(draftFor({ playerId: 'p', name: 'Jade', place: null, tournamentName: 'Major' }), '');
});
