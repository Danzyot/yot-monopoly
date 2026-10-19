// Does THIS player have alts?
//
// The shared-address panel answers a different question — "which addresses
// carry more than one account" — and a person with three accounts across two
// addresses shows up in two unrelated-looking rows there. This walks out from
// one account instead, and the walk is where the judgement lives: one step is
// a shared address, two steps is an alt of an alt, and a carrier-sized address
// must never be stepped through or the whole site ends up connected to itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionsFor, findPlayer, noteSeen } from '../src/audit.ts';

let n = 0;
const uid = () => `cx${++n}_${process.pid}`;

function seen(id: string, name: string, ips: string[], discord?: string) {
  for (const ip of ips) {
    noteSeen(
      { id, name, avatar: '🙂', discord: discord ? { id: discord, username: name.toLowerCase() } : null },
      ip,
    );
  }
}

test('an account nobody shares an address with comes back clean', () => {
  const id = uid();
  seen(id, 'Solo', ['203.0.113.10']);
  const r = connectionsFor(id)!;
  assert.ok(r, 'the player is found');
  assert.equal(r.linked.length, 0);
  assert.match(r.verdict, /No other account/);
  assert.deepEqual(r.addresses.map(a => a.ip), ['203.0.113.10']);
  assert.equal(r.addresses[0].accounts, 1);
});

test('two accounts on one address find each other', () => {
  const a = uid(); const b = uid();
  seen(a, 'Main', ['198.51.100.7']);
  seen(b, 'Alt', ['198.51.100.7']);
  const r = connectionsFor(a)!;
  const hit = r.linked.find(l => l.id === b)!;
  assert.ok(hit, 'the other account is reported');
  assert.equal(hit.hops, 1, 'a direct share');
  assert.deepEqual(hit.sharedIps, ['198.51.100.7']);
  assert.equal(hit.crowd, 2, 'a household-sized group');
  assert.equal(hit.playedTogether, 0);
});

test('an alt of an alt is reached, and the bridge is named', () => {
  const a = uid(); const b = uid(); const c = uid();
  seen(a, 'First', ['198.51.100.20']);
  seen(b, 'Bridge', ['198.51.100.20', '198.51.100.21']);
  seen(c, 'Third', ['198.51.100.21']);
  const r = connectionsFor(a)!;
  const third = r.linked.find(l => l.id === c)!;
  assert.ok(third, 'the account two steps out is reported');
  assert.equal(third.hops, 2);
  assert.equal(third.via, 'Bridge', 'and the account that bridges it is named');
  // Direct links sort above indirect ones — the stronger lead reads first.
  assert.ok(r.linked.findIndex(l => l.id === b) < r.linked.findIndex(l => l.id === c));
});

// The failure that makes the whole panel useless: a mobile carrier or a VPN
// exit puts hundreds of unrelated strangers on one address. Walking THROUGH
// one links every one of them to every other, and the tool stops meaning
// anything. Sitting on one directly is still reported — flagged by its size,
// for a human to weigh — but the walk stops there.
test('a carrier-sized address is reported but never stepped through', () => {
  const vpnIp = '198.51.100.99';
  const subject = uid();
  seen(subject, 'Subject', ['203.0.113.55', vpnIp]);
  const crowd: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = uid();
    crowd.push(id);
    seen(id, `Stranger${i}`, [vpnIp]);
  }
  // One of the strangers has a private address of their own, with a friend on
  // it. That friend must NOT be dragged in through the carrier.
  const friend = uid();
  seen(crowd[0], 'Stranger0', ['203.0.113.77']);
  seen(friend, 'Friend', ['203.0.113.77']);

  const r = connectionsFor(subject)!;
  const strangers = r.linked.filter(l => crowd.includes(l.id));
  assert.equal(strangers.length, 12, 'everyone on the shared address is still listed');
  assert.ok(strangers.every(l => l.crowd >= 12), 'and each is flagged as a crowd');
  assert.equal(
    r.linked.find(l => l.id === friend), undefined,
    'but a stranger\'s own household is not dragged in through the carrier',
  );
  assert.match(r.verdict, /mobile network or VPN/);
});

test('a player is found by Discord id, tag or name, not just site id', () => {
  const id = `dc_9${process.pid}`;
  noteSeen(
    { id, name: 'Discordy', avatar: '🙂', discord: { id: `9${process.pid}`, username: 'discordy' } },
    '203.0.113.200',
  );
  assert.equal(findPlayer(id)?.id, id, 'by site id');
  assert.equal(findPlayer(`9${process.pid}`)?.id, id, 'by bare Discord id');
  assert.equal(findPlayer('@discordy')?.id, id, 'by @tag');
  assert.equal(findPlayer('Discordy')?.id, id, 'by name');
  assert.equal(findPlayer('nobody at all here'), null, 'and nothing when there is nothing');
});
