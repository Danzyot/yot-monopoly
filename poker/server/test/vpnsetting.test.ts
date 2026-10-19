// The VPN door's switch: stored setting versus environment.
//
// The asymmetry here is the whole design, so it is the whole test. The
// environment can force the door OPEN and nothing in the app may override
// that, because forcing it open from Railway is the recovery path for an
// operator the door has locked out. The environment must NOT be able to hold
// it shut against the dashboard, because then turning it off on screen would
// appear to work and quietly come back at the next restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-vpnset-'));
const { loadVpnSetting, setVpnBlock, vpnBlockOn, vpnBlockStored, envOverride } =
  await import('../src/vpnsetting.ts');

const clearEnv = () => { delete process.env.VPN_BLOCK; };

test('with nothing stored and nothing set, the door is open', () => {
  clearEnv();
  assert.equal(vpnBlockStored(), false);
  assert.equal(vpnBlockOn(), false,
    'shipping the feature must not start refusing anyone on any site');
});

test('VPN_BLOCK=1 is a starting value, not a lock', () => {
  clearEnv();
  process.env.VPN_BLOCK = '1';
  assert.equal(vpnBlockOn(), true, 'before any choice is made, the environment decides');
  // The operator turns it off in the dashboard. That has to STICK — the bug
  // this guards against is the switch flipping back at the next restart while
  // the dashboard kept saying off.
  setVpnBlock(false);
  assert.equal(vpnBlockOn(), false);
  assert.equal(vpnBlockStored(), true);
  clearEnv();
});

test('VPN_BLOCK=0 forces the door open and the dashboard cannot shut it', () => {
  clearEnv();
  setVpnBlock(true);
  assert.equal(vpnBlockOn(), true);
  process.env.VPN_BLOCK = '0';
  assert.equal(envOverride(), 'forced-off');
  assert.equal(vpnBlockOn(), false,
    'this is how a locked-out operator gets back in — nothing stored may beat it');
  // And the stored intention is not destroyed by the override: removing it
  // restores what the operator actually chose, rather than silently
  // resetting the site to open.
  clearEnv();
  assert.equal(vpnBlockOn(), true);
});

test('the setting survives a restart', () => {
  clearEnv();
  setVpnBlock(true);
  // A fresh load from the same directory, as a restarting process would do.
  loadVpnSetting();
  assert.equal(vpnBlockOn(), true);
  setVpnBlock(false);
  loadVpnSetting();
  assert.equal(vpnBlockOn(), false, 'off must persist too, not just on');
});

test('an unrelated VPN_BLOCK value is not read as an instruction', () => {
  clearEnv();
  setVpnBlock(false);
  for (const v of ['true', 'yes', 'ON', '2', '']) {
    process.env.VPN_BLOCK = v;
    assert.equal(vpnBlockOn(), false, `"${v}" must not turn the door on`);
    assert.equal(envOverride(), null, `"${v}" must not be read as the forced-off override`);
  }
  clearEnv();
});
