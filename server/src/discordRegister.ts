// Telling Discord which slash commands the bot has (discordCommands.ts).
//
// One bulk overwrite of the guild's commands (DISCORD_GUILD_ID), so they show
// up at once and anything removed from the list disappears. It runs at startup
// and when the leaderboard switch changes, but only when the definitions (or
// the app or guild) differ from the last ones Discord accepted: their hash is
// kept on the data volume, so redeploys do not re-register every time. The
// dashboard's "Re-register Discord commands" forces it.
//
// Failing to register never stops the site: the status says why (most often
// the bot was invited without the applications.commands scope) and the rest of
// the bot keeps working.
import { readJson, writeJson } from './jsonstore.ts';
import { commandDefinitions, commandsHash, type CommandDefinition } from './discordCommands.ts';

const API = 'https://discord.com/api/v10';
const FILE = 'discord-commands.json';

export type CommandSyncState = 'idle' | 'syncing' | 'registered' | 'unchanged' | 'failed' | 'not-configured';

export interface CommandSyncStatus {
  state: CommandSyncState;
  /** What happened, in a sentence for the dashboard. */
  message: string;
  /** When this status was set. */
  at: number | null;
  /** The commands as last sent to (or found unchanged at) Discord. */
  commands: string[];
  guildId: string | null;
  /** When Discord last accepted the commands (from the stored record, so it survives restarts). */
  registeredAt: number | null;
}

interface Stored { hash: string; at: number; appId: string; guildId: string; commands: string[] }

export interface SyncOptions {
  /** Register even when the definitions are unchanged (the dashboard button). */
  force?: boolean;
  /** Defaults to the live definitions (leaderboard switch, /daily available). */
  defs?: CommandDefinition[];
  env?: { appId?: string; botToken?: string; guildId?: string; publicKey?: string };
  fetchImpl?: typeof fetch;
  store?: { read(): Stored | null; write(s: Stored): void };
  /** Waits out a 429 (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const fileStore = {
  read: (): Stored | null => {
    const s = readJson<Stored | null>(FILE, null);
    return s && typeof s.hash === 'string' ? s : null;
  },
  write: (s: Stored) => writeJson(FILE, s),
};

let status: CommandSyncStatus = { state: 'idle', message: 'Not registered since the server started.', at: null, commands: [], guildId: null, registeredAt: null };
let inflight: Promise<CommandSyncStatus> | null = null;
let liveDefs: () => CommandDefinition[] = () => commandDefinitions({ statsPublic: true, daily: false });

/** index.ts says how to build the current definitions (they follow the leaderboard switch). */
export function configureCommandDefinitions(fn: () => CommandDefinition[]): void {
  liveDefs = fn;
}

export function commandSyncStatus(): CommandSyncStatus {
  if (status.registeredAt === null) {
    const stored = fileStore.read();
    if (stored) return { ...status, registeredAt: stored.at, commands: status.commands.length ? status.commands : stored.commands, guildId: status.guildId ?? stored.guildId };
  }
  return { ...status };
}

/** Register the commands unless Discord already has these exact ones. Never throws; one sync at a time. */
export function syncCommands(opts: SyncOptions = {}): Promise<CommandSyncStatus> {
  if (inflight) return inflight;
  inflight = doSync(opts).finally(() => { inflight = null; });
  return inflight;
}

async function doSync(opts: SyncOptions): Promise<CommandSyncStatus> {
  const now = opts.now ?? Date.now;
  const store = opts.store ?? fileStore;
  const env = opts.env ?? {
    appId: process.env.DISCORD_CLIENT_ID?.trim(),
    botToken: process.env.DISCORD_BOT_TOKEN?.trim(),
    guildId: process.env.DISCORD_GUILD_ID?.trim(),
    publicKey: process.env.DISCORD_PUBLIC_KEY?.trim(),
  };
  const set = (s: Partial<CommandSyncStatus> & Pick<CommandSyncStatus, 'state' | 'message'>) => {
    status = { ...status, ...s, at: now() };
    return { ...status };
  };

  const missing = [!env.appId && 'DISCORD_CLIENT_ID', !env.botToken && 'DISCORD_BOT_TOKEN', !env.guildId && 'DISCORD_GUILD_ID'].filter(Boolean);
  if (missing.length) {
    return set({ state: 'not-configured', message: `Slash commands are off: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`, guildId: env.guildId || null });
  }
  const appId = env.appId!, guildId = env.guildId!;
  let defs: CommandDefinition[];
  try {
    defs = opts.defs ?? liveDefs();
  } catch (e) {
    return set({ state: 'failed', message: `Could not build the command list: ${e instanceof Error ? e.message : String(e)}` });
  }
  const names = defs.map(d => `/${d.name}`);
  const hash = commandsHash(defs, { appId, guildId });
  const noKey = env.publicKey ? '' : ' DISCORD_PUBLIC_KEY is not set, so Discord cannot deliver them yet.';

  const stored = store.read();
  if (!opts.force && stored?.hash === hash) {
    return set({ state: 'unchanged', message: `Up to date: Discord already has these ${names.length} commands.${noKey}`, commands: names, guildId, registeredAt: stored.at });
  }

  set({ state: 'syncing', message: 'Registering…', commands: names, guildId });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const put = () => fetchImpl(`${API}/applications/${appId}/guilds/${guildId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${env.botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(defs),
    signal: AbortSignal.timeout(15_000),
  });

  try {
    let res = await put();
    if (res.status === 429) {
      // Rate limited: wait what Discord asks (bounded) and try once more.
      const body = await res.json().catch(() => ({})) as { retry_after?: number };
      const wait = Number(body.retry_after ?? res.headers.get('retry-after') ?? 1);
      await sleep(Math.min(10_000, Math.max(500, wait * 1000)));
      res = await put();
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      const why = res.status === 401
        ? 'Discord rejected the bot token (DISCORD_BOT_TOKEN).'
        : res.status === 403
          ? 'Discord said Missing Access: re-invite the bot with the "bot" and "applications.commands" scopes (Developer Portal → OAuth2 → URL Generator), and check DISCORD_GUILD_ID is the Chog server.'
          : `Discord returned ${res.status}${detail ? `: ${detail}` : ''}.`;
      console.error(`[discord] slash command registration failed: ${res.status} ${detail}`);
      return set({ state: 'failed', message: why });
    }
    const at = now();
    try {
      store.write({ hash, at, appId, guildId, commands: names });
    } catch (e) {
      // Registered all the same; the next start just registers again.
      console.error('[discord] could not store the command hash:', e);
    }
    console.log(`[discord] registered ${names.length} slash commands in guild ${guildId}: ${names.join(' ')}`);
    return set({ state: 'registered', message: `Registered ${names.length} commands with Discord.${noKey}`, commands: names, guildId, registeredAt: at });
  } catch (e) {
    console.error('[discord] slash command registration failed:', e);
    return set({ state: 'failed', message: `Could not reach Discord: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Tests: back to a fresh start. */
export function resetCommandSync(): void {
  status = { state: 'idle', message: 'Not registered since the server started.', at: null, commands: [], guildId: null, registeredAt: null };
  inflight = null;
}
