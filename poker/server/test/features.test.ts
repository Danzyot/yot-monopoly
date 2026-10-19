// Feature switches. The point of a switch is that the server obeys it, so
// what is pinned here is the storage and the defaults; the socket refusals
// are exercised against a live server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-feat-'));
const { getFeatures, isOn, setFeatures } = await import('../src/features.ts');

test('the room starts lean', () => {
  const f = getFeatures();
  // A clean table is the brief, so the extras are opt-in. Chat and the
  // session log stay because a poker room without them is worse than plain.
  assert.equal(f.chat, true);
  assert.equal(f.handLog, true);
  assert.equal(f.music, false);
  assert.equal(f.replay, false);
});

test('a switch flips and sticks', () => {
  setFeatures({ music: true });
  assert.equal(isOn('music'), true);
  setFeatures({ music: false });
  assert.equal(isOn('music'), false);
});

test('only the named switch moves', () => {
  const before = getFeatures();
  setFeatures({ replay: !before.replay });
  const after = getFeatures();
  for (const k of Object.keys(before) as (keyof typeof before)[]) {
    if (k === 'replay') continue;
    assert.equal(after[k], before[k], `${k} should not have moved`);
  }
});

test('anything that is not exactly true is off', () => {
  // The value comes off the wire, so "on" has to mean true and nothing else —
  // not "truthy", or a stray string in a hand-edited features.json would
  // silently switch a feature back on.
  for (const junk of ['true', 1, 'yes', {}, []] as unknown[]) {
    setFeatures({ music: junk as boolean });
    assert.equal(isOn('music'), false, `${JSON.stringify(junk)} must not count as on`);
  }
  setFeatures({ music: true });
  assert.equal(isOn('music'), true);
});
