// What this deployment is actually configured as, printed into the deploy log
// at boot.
//
// Every variable here is set in a hosting dashboard, in another tab, by hand.
// The failures that follow from getting one wrong are all silent and all look
// like something else: a volume that was never attached loses the whole
// leaderboard on the next deploy and reads as "the results page is broken";
// an empty ADMIN_DISCORD_IDS makes every visitor an operator and reads as
// nothing at all until someone cancels a tournament; a client id paired with
// another application's secret reads as "Discord sign-in is down". None of
// them are visible from inside the room, and all of them are knowable at
// startup.
//
// So the report is written to be read by whoever just clicked Deploy: what is
// wrong, what it will cost, and the exact thing to change.
import { accessSync, constants, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface ConfigReport {
  ok: boolean;
  problems: string[];
  warnings: string[];
  notes: string[];
}

// Discord snowflakes are 17–20 digits. Anything else in the operator list is
// a paste of a username, a role id or a truncated id, and will silently never
// match anyone.
const SNOWFLAKE = /^\d{17,20}$/;

// The secret variable is named after the deployment, so a copied variable set
// from a sibling site leaves the real one unset. That is survivable — the
// secret falls back to a file — but only while the volume is attached, and
// the two mistakes usually arrive together.
const SIBLING_SECRETS = ['WAWA_SECRET', 'LUCID_SECRET', 'TRADEIFY_SECRET', 'JO_SECRET'];

export interface ProbeResult {
  /** Whether DATA_DIR could be created and written to. */
  writable: boolean;
  /** Why not, when it could not. */
  error?: string;
}

export function probeDataDir(dir: string): ProbeResult {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return { writable: true };
  } catch (e) {
    return { writable: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function configReport(
  env: NodeJS.ProcessEnv,
  probe: (dir: string) => ProbeResult = probeDataDir,
): ConfigReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const val = (k: string) => env[k]?.trim() || '';

  // ---- durable storage ----
  const dataDir = val('DATA_DIR');
  if (!dataDir) {
    problems.push(
      'DATA_DIR is not set, so results, bans, uploaded graphics, the live-game '
      + 'snapshot and the sign-in secret are being written inside the container. '
      + 'All of it is destroyed by the next deploy or restart, and everyone is '
      + 'signed out. Fix: attach a volume (Railway → service → Volumes → mount '
      + 'path /data) and set DATA_DIR=/data.',
    );
  } else {
    const abs = isAbsolute(dataDir) ? dataDir : resolve(dataDir);
    const r = probe(abs);
    if (!r.writable) {
      problems.push(
        `DATA_DIR is ${abs} but it cannot be written to (${r.error ?? 'no write access'}). `
        + 'Nothing will persist. Check the volume is attached to THIS service and '
        + 'that its mount path matches DATA_DIR exactly.',
      );
    } else if (!isAbsolute(dataDir)) {
      warnings.push(
        `DATA_DIR is a relative path (${dataDir} → ${abs}). A volume mount is an `
        + 'absolute path; a relative one is almost always the container filesystem.',
      );
    } else {
      notes.push(`Durable data: ${abs}`);
    }
  }

  // ---- who may run games ----
  const adminRaw = val('ADMIN_DISCORD_IDS');
  const adminIds = adminRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (adminIds.length === 0) {
    problems.push(
      'ADMIN_DISCORD_IDS is empty, so EVERY signed-in visitor is an operator: '
      + 'anyone can create, cancel or end a tournament, ban players and read the '
      + 'audit. Fix: set it to your Discord user id (comma-separated for more '
      + 'than one).',
    );
  } else {
    const bad = adminIds.filter(id => !SNOWFLAKE.test(id));
    if (bad.length) {
      warnings.push(
        `ADMIN_DISCORD_IDS contains ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} `
        + `that ${bad.length === 1 ? 'is' : 'are'} not a Discord user id: ${bad.join(', ')}. `
        + 'A Discord id is 17–20 digits — enable Developer Mode, right-click your '
        + 'name, Copy User ID. Anything else never matches and grants nothing.',
      );
    }
    notes.push(`Operators: ${adminIds.length} Discord id${adminIds.length === 1 ? '' : 's'}`);
  }

  // ---- the address the world reaches this on ----
  const publicUrl = val('PUBLIC_URL');
  if (!publicUrl) {
    problems.push(
      'PUBLIC_URL is not set. Discord sign-in sends players back to it, so the '
      + 'round trip lands on the wrong host and fails. Fix: set it to this '
      + "service's public address, with no trailing slash (e.g. "
      + 'https://poker.example.com).',
    );
  } else {
    if (!/^https:\/\//i.test(publicUrl)) {
      warnings.push(
        `PUBLIC_URL is "${publicUrl}". Discord refuses a non-https redirect for `
        + 'anything but localhost.',
      );
    }
    if (publicUrl.endsWith('/')) {
      warnings.push(
        `PUBLIC_URL ends with a slash ("${publicUrl}"), which produces a double `
        + 'slash in the redirect and will not match what Discord has registered.',
      );
    }
    const base = publicUrl.replace(/\/+$/, '');
    const redirect = val('DISCORD_REDIRECT_URI') || `${base}/api/auth/discord/callback`;
    notes.push(`Discord redirect URI (must be registered in the portal): ${redirect}`);
    if (val('DISCORD_REDIRECT_URI') && val('DISCORD_REDIRECT_URI') !== `${base}/api/auth/discord/callback`) {
      warnings.push(
        'DISCORD_REDIRECT_URI is set and does not match PUBLIC_URL. That is only '
        + 'right if this service is reached through another host; otherwise unset '
        + 'it and let PUBLIC_URL decide.',
      );
    }
  }

  // ---- Discord ----
  const clientId = val('DISCORD_CLIENT_ID');
  const clientSecret = val('DISCORD_CLIENT_SECRET');
  if (!clientId && !clientSecret) {
    warnings.push(
      'Discord sign-in is off (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are '
      + 'both unset). Unless DEMO_MODE is on, nobody can sign in at all.',
    );
  } else if (!clientId || !clientSecret) {
    problems.push(
      `Discord sign-in is half configured: ${clientId ? 'DISCORD_CLIENT_SECRET' : 'DISCORD_CLIENT_ID'} `
      + 'is missing. Every sign-in will fail at the token exchange. Both values '
      + 'must come from the SAME application in the Discord Developer Portal.',
    );
  } else {
    // A note, not a warning: whether the two halves belong to the same
    // application cannot be known without asking Discord, and a warning that
    // fires on every healthy boot is one people stop reading — which is the
    // opposite of what this file is for. It rides along with the id so that
    // when sign-in does break, the answer is already on screen.
    notes.push(
      `Discord application: ${clientId} — the client id and secret must both `
      + 'come from THIS application. A pair from two apps fails as "token '
      + 'exchange failed" and looks like an outage.',
    );
  }
  if ((clientId || clientSecret) && !val('DISCORD_BOT_TOKEN')) {
    warnings.push(
      'DISCORD_BOT_TOKEN is not set. Sign-in still works, but role requirements, '
      + 'DMs to players and posting results to a channel do not.',
    );
  }
  if (!val('DISCORD_GUILD_ID')) {
    warnings.push('DISCORD_GUILD_ID is not set — new tournaments have no server to prefill.');
  }
  if (!val('DISCORD_INVITE_URL') && !val('NEXT_PUBLIC_DISCORD_INVITE_URL')) {
    notes.push('No DISCORD_INVITE_URL: the header shows no Discord button (by design, not an error).');
  }

  // ---- the sign-in secret ----
  if (val('CHOG_SECRET')) notes.push('Sign-in secret: CHOG_SECRET');
  else if (val('APP_SECRET')) notes.push('Sign-in secret: APP_SECRET');
  else notes.push('Sign-in secret: generated and stored in DATA_DIR (survives restarts only while the volume does)');
  const stale = SIBLING_SECRETS.filter(k => val(k));
  if (stale.length) {
    warnings.push(
      `${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} set but this `
      + 'deployment does not read that name — it reads CHOG_SECRET. Looks like a '
      + 'variable set copied from another site; check the rest of it too.',
    );
  }

  // ---- modes that must never be on in front of real players ----
  if (val('DEMO_MODE') === '1') {
    problems.push(
      'DEMO_MODE is on: anyone with the address can sign in without Discord, '
      + 'under any name. Unset it before this room runs a real event.',
    );
  }
  if (val('RATE_LIMIT_OFF')) {
    warnings.push('RATE_LIMIT_OFF is set — per-player rate limiting is disabled. This is a test-only switch.');
  }
  const hops = val('TRUSTED_PROXY_HOPS');
  if (hops) notes.push(`Trusted proxy hops: ${hops}`);

  return { ok: problems.length === 0, problems, warnings, notes };
}

export function printStartupReport(
  env: NodeJS.ProcessEnv = process.env,
  log: (s: string) => void = console.log,
  warn: (s: string) => void = console.warn,
): ConfigReport {
  const r = configReport(env);
  const line = '─'.repeat(64);
  log(line);
  log('Configuration check');
  for (const n of r.notes) log(`  ·  ${n}`);
  for (const w of r.warnings) warn(`  !  ${w}`);
  for (const p of r.problems) warn(`  ✗  ${p}`);
  log(r.ok
    ? '  ok — nothing here will lose data or let the wrong person host.'
    : `  ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} above must be fixed in this service's variables.`);
  log(line);
  return r;
}
