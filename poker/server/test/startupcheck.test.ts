// The startup report exists to catch the mistakes that are invisible from
// inside the room, so what is tested is that each one is actually caught —
// and, just as much, that a correct deployment is reported as correct. A
// check that cries wolf on a healthy service is a check nobody reads.
import test from 'node:test';
import assert from 'node:assert/strict';

const { configReport } = await import('../src/startupcheck.ts');

const OK_ENV: NodeJS.ProcessEnv = {
  DATA_DIR: '/data',
  ADMIN_DISCORD_IDS: '123456789012345678',
  PUBLIC_URL: 'https://poker.example.com',
  DISCORD_CLIENT_ID: '1274819260077576364',
  DISCORD_CLIENT_SECRET: 'shhh',
  DISCORD_BOT_TOKEN: 'bot',
  DISCORD_GUILD_ID: '1274819260077576364',
  DISCORD_INVITE_URL: 'https://discord.gg/example',
};
const writable = () => ({ writable: true });
const report = (env: NodeJS.ProcessEnv) => configReport(env, writable);
const says = (lines: string[], needle: string) =>
  lines.some(l => l.toLowerCase().includes(needle.toLowerCase()));

test('a fully configured service reports no problems and no warnings', () => {
  const r = report(OK_ENV);
  assert.equal(r.ok, true, r.problems.join(' | '));
  assert.deepEqual(r.problems, []);
  // Nothing to nag about on a healthy deploy. A report that always shows a
  // warning is one that gets skimmed, and then the real one is skimmed too.
  assert.deepEqual(r.warnings, []);
  assert.ok(says(r.notes, 'Durable data: /data'));
  // The one thing an operator most often needs and cannot derive: the exact
  // string Discord has to have registered.
  assert.ok(says(r.notes, 'https://poker.example.com/api/auth/discord/callback'));
});

test('no volume is a problem, not a warning — a deploy destroys everything', () => {
  const { DATA_DIR: _drop, ...env } = OK_ENV;
  const r = report(env);
  assert.equal(r.ok, false);
  assert.ok(says(r.problems, 'DATA_DIR is not set'));
  assert.ok(says(r.problems, 'destroyed by the next deploy'));
});

test('a DATA_DIR that cannot be written to is caught, not assumed', () => {
  const r = configReport(OK_ENV, () => ({ writable: false, error: 'EACCES' }));
  assert.equal(r.ok, false);
  assert.ok(says(r.problems, 'cannot be written to'));
});

test('a relative DATA_DIR warns — a volume mount is never relative', () => {
  const r = report({ ...OK_ENV, DATA_DIR: 'data' });
  assert.ok(says(r.warnings, 'relative path'));
});

test('an empty operator list is a problem: it makes everyone an operator', () => {
  const r = report({ ...OK_ENV, ADMIN_DISCORD_IDS: '  ' });
  assert.equal(r.ok, false);
  assert.ok(says(r.problems, 'EVERY signed-in visitor is an operator'));
});

test('an operator id that is not a snowflake is named, since it silently grants nothing', () => {
  const r = report({ ...OK_ENV, ADMIN_DISCORD_IDS: '123456789012345678, cj_wawa' });
  assert.equal(r.ok, true, 'still usable — one id is valid');
  assert.ok(says(r.warnings, 'cj_wawa'));
});

test('half-configured Discord is a problem; no Discord at all is only a warning', () => {
  const half = report({ ...OK_ENV, DISCORD_CLIENT_SECRET: '' });
  assert.equal(half.ok, false);
  assert.ok(says(half.problems, 'DISCORD_CLIENT_SECRET'));

  const none = report({ ...OK_ENV, DISCORD_CLIENT_ID: '', DISCORD_CLIENT_SECRET: '' });
  assert.equal(none.ok, true);
  assert.ok(says(none.warnings, 'Discord sign-in is off'));
});

test('PUBLIC_URL is required, and its shape is checked', () => {
  const missing = report({ ...OK_ENV, PUBLIC_URL: '' });
  assert.equal(missing.ok, false);
  assert.ok(says(missing.problems, 'PUBLIC_URL is not set'));

  const slash = report({ ...OK_ENV, PUBLIC_URL: 'https://poker.example.com/' });
  assert.ok(says(slash.warnings, 'ends with a slash'));
  // The advertised redirect must not carry the double slash through.
  assert.ok(says(slash.notes, 'https://poker.example.com/api/auth/discord/callback'));

  const http = report({ ...OK_ENV, PUBLIC_URL: 'http://poker.example.com' });
  assert.ok(says(http.warnings, 'non-https'));
});

test('a redirect override that disagrees with PUBLIC_URL is called out', () => {
  const r = report({ ...OK_ENV, DISCORD_REDIRECT_URI: 'https://elsewhere.example/api/auth/discord/callback' });
  assert.ok(says(r.warnings, 'does not match PUBLIC_URL'));
  assert.ok(says(r.notes, 'https://elsewhere.example/api/auth/discord/callback'));
});

test('a variable set copied from a sibling site is recognised as such', () => {
  const r = report({ ...OK_ENV, TRADEIFY_SECRET: 'copied' });
  assert.ok(says(r.warnings, 'reads CHOG_SECRET'));
});

test('demo mode in front of real players is a problem', () => {
  const r = report({ ...OK_ENV, DEMO_MODE: '1' });
  assert.equal(r.ok, false);
  assert.ok(says(r.problems, 'DEMO_MODE is on'));
});

test('a variable set under a name that only looks right is named in the report', () => {
  // The failure this exists for: the dashboard shows ADMIN_DISCORD_IDS set,
  // the process does not have it, and both parties are certain the other is
  // wrong. Every one of these renders identically in a web UI.
  const { ADMIN_DISCORD_IDS: _gone, ...base } = OK_ENV;
  for (const [label, key] of [
    ['trailing space', 'ADMIN_DISCORD_IDS '],
    ['leading space', ' ADMIN_DISCORD_IDS'],
    ['non-breaking space', 'ADMIN_DISCORD_IDS '],
    ['zero-width joiner', 'ADMIN_DISCORD_IDS‍'],
    ['wrong case', 'Admin_Discord_Ids'],
  ] as const) {
    const r = report({ ...base, [key]: '123456789012345678' });
    assert.equal(r.ok, false, `${label}: must still be a problem`);
    const p = r.problems.find(x => /ADMIN_DISCORD_IDS is empty/.test(x))!;
    assert.ok(p, `${label}: the empty problem should be reported`);
    assert.ok(/this process CAN see/.test(p), `${label}: the near miss should be named`);
    assert.ok(/retype the name by hand/.test(p), `${label}: and say what to do`);
  }
});

test('an unrelated variable is not mistaken for a near miss', () => {
  const r = report({ ...OK_ENV, ADMIN_DISCORD_ID: '1', SOME_OTHER: 'x' });
  const p = r.problems.find(x => /ADMIN_DISCORD_IDS is empty/.test(x));
  assert.equal(p, undefined, 'a correctly set variable reports no problem at all');

  const { ADMIN_DISCORD_IDS: _gone, ...base } = OK_ENV;
  const r2 = report({ ...base, ADMIN_DISCORD_ID: '1' });
  const p2 = r2.problems.find(x => /ADMIN_DISCORD_IDS is empty/.test(x))!;
  assert.ok(!/this process CAN see/.test(p2),
    'ADMIN_DISCORD_ID is a different name, not an invisible-character twin');
});
