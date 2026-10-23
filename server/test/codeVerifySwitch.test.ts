// "Verify with a code" is a dashboard switch, off by default: while it is off the
// Discord Verify button and modal only say so, and no code is ever resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-codeverify-'));
process.env.DISCORD_PUBLIC_KEY = 'aa'; // the button flow counts as configured
const { DEFAULT_FEATURES } = await import('../../shared/types.ts');
const { loadFeatures, setFeatures } = await import('../src/features.ts');
const { handleInteraction } = await import('../src/interactions.ts');
const { startCode, codeStatus } = await import('../src/verifycode.ts');

const USER = { id: '123456789012345678', username: 'someone', global_name: 'Someone', avatar: null };
const button = { type: 3, data: { custom_id: 'mono_verify_button' } };
const modal = (value: string) => ({
  type: 5, guild_id: '876543210987654321',
  data: { custom_id: 'mono_verify_modal', components: [{ components: [{ custom_id: 'code', value }] }] },
  member: { user: USER },
});

test('code sign-in starts switched off', () => {
  assert.equal(DEFAULT_FEATURES.codeVerify, false);
});

test('switched off, the button and the modal only say so and the code stays unresolved', () => {
  loadFeatures();
  const { code } = startCode();
  for (const i of [button, modal(code)]) {
    const body = handleInteraction(i as never)!.body as { type: number; data: { content: string; flags: number } };
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, 64);
    assert.match(body.data.content, /switched off/);
  }
  assert.equal(codeStatus(code).resolution, null);
});

test('switched on, the button opens the modal and a code resolves', () => {
  setFeatures({ codeVerify: true });
  const open = handleInteraction(button as never)!.body as { type: number };
  assert.equal(open.type, 9);
  const { code } = startCode();
  handleInteraction(modal(code) as never);
  assert.equal(codeStatus(code).resolution?.id, USER.id);
  setFeatures({ codeVerify: false });
});
