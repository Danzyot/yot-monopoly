// Whether the VPN door is shut, stored so the dashboard can change it.
//
// Kept out of features.ts on purpose. Those switches are parts of the room a
// player enjoys — music, chat, the replayer — and this deployment defaults
// every one of them ON, because they had all been running for months before
// the switches existed. A door that refuses people cannot live in a list with
// that default: adding it there would have turned VPN blocking on for every
// site the moment the switch shipped.
//
// It is also not the same KIND of setting. The others change what a signed-in
// player can see. This one decides who gets to load the page at all, which is
// why it carries an override the operator can reach from the host panel
// without the site being reachable at all.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

const FILE = join(DATA_DIR, 'vpnblock.json');

let enabled: boolean | null = null; // null = nothing stored yet

export function loadVpnSetting(): void {
  try {
    if (!existsSync(FILE)) return;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as { enabled?: unknown };
    enabled = parsed.enabled === true;
  } catch (e) {
    console.error('Could not load the VPN block setting:', e);
  }
}

// How the environment and the stored switch combine.
//
// VPN_BLOCK=0 is a hard OFF that the dashboard cannot override. It is the
// recovery path: if the block misfires and locks the operator out, they set
// it in Railway and restart, and they are back in without needing the bypass
// key or a deploy. Nothing in the app can undo it, which is the point.
//
// VPN_BLOCK=1 is only a starting value, used when nothing has been stored
// yet. Once the switch has been flipped in the dashboard, the stored answer
// is the one that counts — otherwise turning it off on screen would appear to
// work and then come back at the next restart.
export type VpnOverride = 'forced-off' | null;

export function envOverride(): VpnOverride {
  return process.env.VPN_BLOCK === '0' ? 'forced-off' : null;
}

export function vpnBlockOn(): boolean {
  if (envOverride() === 'forced-off') return false;
  if (enabled !== null) return enabled;
  return process.env.VPN_BLOCK === '1';
}

// True once the operator has made a choice, so the panel can say whether it
// is showing a stored decision or the environment's starting value.
export function vpnBlockStored(): boolean {
  return enabled !== null;
}

export function setVpnBlock(on: boolean): boolean {
  // Write first, believe it second — same reason as the feature switches. A
  // door that reports itself shut and is open again after a restart is worse
  // than one that never claimed to work.
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ enabled: on }, null, 2));
  renameSync(tmp, FILE);
  enabled = on;
  return vpnBlockOn();
}
