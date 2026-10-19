// Lookalike names and invisible characters: two players must never render the
// same, and chat must not carry bidi overrides or zero-width tricks. Plus the
// demo text editor, which rewrites the site for everyone: operators only.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-names-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { cleanName, makeDemoProfile, makeDiscordProfile, signToken, verifyToken } = await import('../src/auth.ts');
const { checkChat } = await import('../src/chat.ts');
const { mountTextOverrides } = await import('../src/routes/textOverrides.ts');
const { setTextOverride } = await import('../src/textOverrides.ts');

// ---- cleanName ----------------------------------------------------------------

test('cleanName: zero-width, bidi and BOM characters are removed', () => {
  assert.equal(cleanName('Alice​'), 'Alice');
  assert.equal(cleanName('﻿Al‌ice‍'), 'Alice');
  assert.equal(cleanName('‮ecilA'), 'ecilA', 'right-to-left override');
  assert.equal(cleanName('⁦Alice⁩'), 'Alice', 'isolates');
  assert.equal(cleanName('Al⁠ice᠎'), 'Alice', 'word joiner, Mongolian vowel separator');
  assert.equal(cleanName('Ali­ce'), 'Alice', 'soft hyphen');
});

test('cleanName: NFKC folds styled and fullwidth letters to plain ones', () => {
  assert.equal(cleanName('Ａｌｉｃｅ'), 'Alice');
  assert.equal(cleanName('𝐀𝐥𝐢𝐜𝐞'), 'Alice');
  assert.equal(cleanName('Alíce'), 'Alíce', 'a combining accent composes');
});

test('cleanName: controls become spaces and whitespace collapses', () => {
  assert.equal(cleanName('  Big\n\t  Bob  '), 'Big Bob');
  assert.equal(cleanName('A\u0000\u0007lice'), 'A lice');
  assert.equal(cleanName('Bob　 Smith'), 'Bob Smith');
});

test('cleanName: combining-mark floods are capped at three', () => {
  const zalgo = 'Z' + '̶̷̸̹̺'.repeat(4) + 'ed';
  const out = cleanName(zalgo);
  assert.equal(out, 'Z̶̷̸ed');
  assert.ok(!/\p{M}{4}/u.test(cleanName('x' + '̀'.repeat(50) + 'y')));
});

test('cleanName: blank-looking letters do not count as a name', () => {
  assert.equal(cleanName('ㅤㅤㅤ'), '');
  assert.equal(cleanName('A⠀⠀'), '');
  assert.equal(cleanName('Boﾠb'), 'Bob');
});

test('cleanName: at least two visible characters, at most max', () => {
  assert.equal(cleanName(''), '');
  assert.equal(cleanName('A'), '');
  assert.equal(cleanName('A​​'), '');
  assert.equal(cleanName('A' + '́'.repeat(5)), '', 'marks are not characters');
  assert.equal(cleanName('   '), '');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('Al'), 'Al');
  assert.equal(cleanName('x'.repeat(40)), 'x'.repeat(24));
  assert.equal(cleanName('x'.repeat(40), 20), 'x'.repeat(20));
  assert.equal(cleanName('a'.repeat(19) + ' bcd', 20), 'a'.repeat(19), 'no trailing space after the cut');
  assert.equal(cleanName('😀'.repeat(30)), '😀'.repeat(24), 'cut by character, never mid-emoji');
});

test('cleanName: emoji survive, joined emoji stay joined', () => {
  assert.equal(cleanName('Ann 🎩'), 'Ann 🎩');
  assert.equal(cleanName('Fam 👨‍👩‍👧'), 'Fam 👨‍👩‍👧');
  assert.equal(cleanName('Ann❤️'), 'Ann❤️', 'variation selectors are kept');
  assert.equal(cleanName('👩🏾‍💻 Dev'), '👩🏾‍💻 Dev', 'a skin tone before the joiner');
  assert.equal(cleanName('👨🏽‍👩🏽‍👧🏽 fam'), '👨🏽‍👩🏽‍👧🏽 fam');
  const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  assert.equal(cleanName(`${england} Jo`), `${england} Jo`, 'subdivision flags keep their tags');
});

test('cleanName: scripts that need joiners and stacked marks keep them', () => {
  assert.equal(cleanName('ශ්\u200dරී ලංකා'), 'ශ්\u200dරී ලංකා', 'Sinhala joiner');
  assert.equal(cleanName('علی\u200cرضا'), 'علی\u200cرضا', 'Persian non-joiner');
  assert.equal(cleanName('ကျော်ဇင်'), 'ကျော်ဇင်', 'Burmese syllable marks');
  assert.equal(cleanName('မြို့သူ'), 'မြို့သူ');
  assert.equal(cleanName('Al\u200dice'), 'Alice', 'but not inside a Latin name');
});

test('lookalike names no longer collide', () => {
  const variants = ['Alice', 'Alice​', '​Alice', 'Ａlice', 'Alice⁠', '‭Alice‬', 'Alice '];
  assert.deepEqual(new Set(variants.map(v => cleanName(v))), new Set(['Alice']));
});

// ---- where names come from ----------------------------------------------------

test('demo sign-in cleans the name and refuses an invisible one', () => {
  assert.equal(makeDemoProfile('Alice​').name, 'Alice');
  assert.equal(makeDemoProfile('x'.repeat(30)).name, 'x'.repeat(20));
  assert.throws(() => makeDemoProfile('​​A​'), /at least 2/);
  assert.throws(() => makeDemoProfile('ㅤㅤ'), /at least 2/);
});

test('Discord sign-in cleans the name and falls back when nothing is left', () => {
  assert.equal(makeDiscordProfile({ id: '1', username: '‮Alice​' }).name, 'Alice');
  assert.equal(makeDiscordProfile({ id: '2', username: '​' }).name, 'Player');
});

test('tokens are re-cleaned on read, and an invisible name falls back to Player', () => {
  const old = signToken({ id: 'demo_old', name: 'Alice​‮', avatar: '🎩', provider: 'demo' });
  assert.equal(verifyToken(old)?.name, 'Alice');
  const blank = signToken({ id: 'demo_blank', name: '​​​', avatar: '🎩', provider: 'demo' });
  assert.equal(verifyToken(blank)?.name, 'Player');
});

// ---- chat ---------------------------------------------------------------------

test('chat strips bidi controls and zero-width characters', () => {
  assert.equal(checkChat('chat_1', 'hi ‮olleh‬'), 'hi olleh');
  assert.equal(checkChat('chat_2', 'Alice​: gg﻿'), 'Alice: gg');
  assert.equal(checkChat('chat_3', 'line\none'), 'line one');
  assert.equal(checkChat('chat_4', 'fam 👨‍👩‍👧'), 'fam 👨‍👩‍👧');
  assert.throws(() => checkChat('chat_5', '​⁦⁩'), /Empty/);
});

// ---- text overrides: operators only -----------------------------------------------

let server: Server;
let base = '';
before(async () => {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  mountTextOverrides(app);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function put(token: string, body: unknown) {
  const res = await fetch(`${base}/api/text-overrides`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as { error?: string; overrides?: Record<string, string> } };
}
const get = async () => (await (await fetch(`${base}/api/text-overrides`)).json() as { overrides: Record<string, string> }).overrides;

test('with operators configured, only they may save or reset text overrides', async () => {
  process.env.ADMIN_DISCORD_IDS = '999';
  try {
    const pleb = signToken({ id: 'demo_pleb', name: 'Pleb', avatar: '🎩', provider: 'demo' });
    const notOp = signToken({ id: 'dc_1', name: 'Nope', avatar: '🎩', provider: 'discord', discord: { id: '1', username: 'nope' } });
    const op = signToken({ id: 'dc_999', name: 'Op', avatar: '🎩', provider: 'discord', discord: { id: '999', username: 'op' } });

    const r = await put(pleb, { original: 'Rich Uncle', text: 'Rich Uncle (cheater, banned)' });
    assert.equal(r.status, 403);
    assert.match(r.body.error ?? '', /Operators only/);
    assert.equal((await put(notOp, { original: 'Rich Uncle', text: 'x' })).status, 403);
    assert.deepEqual(await get(), {});

    assert.equal((await put(op, { original: 'Play now', text: 'Go' })).status, 200);
    assert.deepEqual(await get(), { 'Play now': 'Go' });
    assert.equal((await put(pleb, { original: 'Play now', text: null })).status, 403, 'nor reset one');
    assert.deepEqual(await get(), { 'Play now': 'Go' });
    assert.equal((await put(op, { original: 'Play now', text: null })).status, 200);
    assert.deepEqual(await get(), {});
  } finally {
    delete process.env.ADMIN_DISCORD_IDS;
    setTextOverride('Play now', null);
  }
});

test('with no operators configured (local demo), every signed-in account may edit', async () => {
  const pleb = signToken({ id: 'demo_pleb2', name: 'Pleb', avatar: '🎩', provider: 'demo' });
  assert.equal((await put(pleb, { original: 'Hello', text: 'Hi' })).status, 200);
  assert.equal((await put(pleb, { original: 'Hello', text: null })).status, 200);
});
