// The advert's copy is operator-supplied and rendered on every page, so the
// interesting part is what setPromo refuses to store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a scratch directory before it is loaded, so running the
// suite never overwrites a real promo.json in the dev data dir.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-promo-'));
const { getPromo, publicPromo, setPromo } = await import('../src/promo.ts');

test('an untouched promo advertises nothing at all', () => {
  // This site sells nothing by default. The advert and the partner rail both
  // start empty so a fresh deployment shows no half-configured promo box, and
  // — since the operator is a prop firm — never ships a rival's offer.
  const p = getPromo();
  assert.equal(p.enabled, false);
  assert.equal(p.railEnabled, false);
  assert.equal(p.code, '');
  assert.deepEqual(p.firms, []);
  assert.equal(publicPromo(), null, 'so players are served nothing');
});

test('the code is upper-cased and text is trimmed and bounded', () => {
  const p = setPromo({
    code: '  wawa10 ',
    headline: `  spaced   out  ${'x'.repeat(200)}`,
    blurb: '\n\nlines\ncollapse\n',
  });
  assert.equal(p.code, 'WAWA10');
  assert.equal(p.headline.length, 90, 'headline is capped');
  assert.ok(p.headline.startsWith('spaced out x'), 'runs of whitespace collapse');
  assert.equal(p.blurb, 'lines collapse');
});

test('only http(s) links are kept', () => {
  assert.equal(setPromo({ url: 'javascript:alert(1)' }).url, '', 'no script URLs');
  assert.equal(setPromo({ url: 'data:text/html,<script>' }).url, '');
  assert.equal(setPromo({ url: 'wawa.trading' }).url, '', 'a bare host is not a link');
  assert.equal(setPromo({ url: 'https://wawa.trading/prop' }).url, 'https://wawa.trading/prop');
});

test('the button label never ends up blank', () => {
  assert.ok(setPromo({ ctaLabel: '   ' }).ctaLabel.length > 0);
});

test('players see nothing when it is switched off or empty', () => {
  setPromo({ enabled: false });
  assert.equal(publicPromo(), null, 'switched off');
  setPromo({ enabled: true, code: '', url: '', firms: [] });
  assert.equal(publicPromo(), null, 'nothing to advertise');
  setPromo({ code: 'WAWA' });
  assert.ok(publicPromo(), 'a code alone is enough');
  setPromo({ code: '', firms: [{ id: 'a', name: 'Apex', offer: '90% OFF', url: '', accent: 'blue' }] });
  assert.ok(publicPromo(), 'so is a firm on the rail');
});

test('firms are cleaned up, and a nameless one is dropped', () => {
  const p = setPromo({
    firms: [
      { id: 'Apex Trader!', name: '  Apex   Trader ', offer: '90% off', url: 'https://x.test/a', accent: 'blue' },
      { id: '', name: '', offer: 'FREE', url: 'https://x.test/b', accent: 'green' },
      { id: 'bad', name: 'Sketchy', offer: '', url: 'javascript:alert(1)', accent: 'purple' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'odd', name: 'Odd Accent', offer: '', url: '', accent: 'chartreuse' as any },
    ],
  });
  assert.equal(p.firms.length, 3, 'the nameless row is dropped');
  assert.equal(p.firms[0].id, 'apextrader', 'ids are slugified');
  assert.equal(p.firms[0].name, 'Apex Trader');
  assert.equal(p.firms[0].offer, '90% OFF', 'offers are upper-cased');
  assert.equal(p.firms[1].url, '', 'a script URL never reaches the page');
  assert.equal(p.firms[2].accent, 'purple', 'unknown accents fall back');
});

test('two firms can never end up sharing an id', () => {
  const p = setPromo({
    firms: [
      { id: 'apex', name: 'Apex', offer: '', url: '', accent: 'blue' },
      { id: 'apex', name: 'Apex Again', offer: '', url: '', accent: 'blue' },
    ],
  });
  assert.equal(new Set(p.firms.map(f => f.id)).size, p.firms.length);
});
