// The bot's slash commands: /play, /stats, /leaderboard, /tables, /daily and
// /chog. Discord delivers them to the same signed endpoint as the Verify button
// (POST /api/discord/interactions, routes/auth.ts); this module turns one into
// the reply. Registration (telling Discord the commands exist) is in
// discordRegister.ts.
//
// Everything a command reads comes in through SlashDeps, so the handlers are
// plain functions over in-memory stores and tests hand them fakes.
//
// What a reply may contain is what the public site already shows: display
// names, results, badges and table codes of public tables. Never wallet
// addresses, IPs, linked accounts or anything an operator sees; nobody banned
// from the site gets stats, a leaderboard row or an answer at all. Results ride
// on the leaderboard switch, like public profiles: with it off, /stats and
// /leaderboard are refused (and not registered).
//
// Successful replies are public, so the channel sees them; errors are
// ephemeral (only the person who asked sees them).
import { createHash } from 'node:crypto';
import { BRAND, GAMES } from '../../shared/brand.ts';
import { chogOfTheDay } from '../../shared/chogs/daily.ts';
import { BACKGROUND_COLORS, CHOG_SUPPLY, chogName, traitsOf, type ChogTraits } from '../../shared/chogs/traits.ts';
import { openSeaUrl } from '../../shared/chogs/meta.ts';
import type { Achievement } from '../../shared/achievements.ts';
import type { CardsProfile, PublicProfile } from '../../shared/types.ts';
import type { ActivityTable } from './activity.ts';

const API = 'https://discord.com/api/v10';
const PINK = 0xd53f7c;

// ---- Discord shapes (only the parts read or written here) ---------------------------------

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface CommandInteraction {
  type: number;
  application_id?: string;
  token?: string;
  guild_id?: string;
  data?: {
    name?: string;
    options?: CommandOption[];
    resolved?: { users?: Record<string, DiscordUser> };
  };
  member?: { user?: DiscordUser };
  user?: DiscordUser;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: { text: string };
}

export interface LinkButton { type: 2; style: 5; label: string; url: string; emoji?: { name: string } }
export interface ButtonRow { type: 1; components: LinkButton[] }

/** What a command answers; turned into Discord's message body by messageBody(). */
export interface Reply {
  /** Only the caller sees it: errors, refusals, "slow down". */
  ephemeral?: boolean;
  content?: string;
  embeds?: Embed[];
  components?: ButtonRow[];
}

// ---- what the commands read ---------------------------------------------------------------

export type LeaderGame = 'monopoly' | 'cards';

export interface LeaderEntry { id: string; name: string; games: number; wins: number; points: number }

/** As much of a player as /stats shows (playerCard.ts builds the real one). */
export interface StatsSnapshot {
  id: string;
  name: string;
  monopoly: Pick<PublicProfile, 'games' | 'wins' | 'winRate'> | null;
  cards: Pick<CardsProfile, 'games' | 'wins' | 'winRate'> | null;
  achievements: readonly Pick<Achievement, 'earned' | 'emoji' | 'name' | 'tier' | 'earnedAt'>[];
  games: number;
}

/** Today's Cards Daily Challenge, as /daily shows it. */
export interface DailyInfo {
  title: string;
  description: string;
  /** Where to play it (site-relative or absolute). */
  path: string;
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface SlashDeps {
  /** The site's canonical origin (PUBLIC_URL, else choggames.com). */
  origin(): string;
  /** The leaderboard switch: stats and leaderboards are public only while it is on. */
  statsPublic(): boolean;
  /** Under a site-wide ban (player id `dc_<discord id>`, or any other player id). */
  banned(playerId: string): boolean;
  /** A player's public numbers, or null (switch off, banned, never finished a game). */
  snapshot(playerId: string): StatsSnapshot | null;
  /** The site's share-card path for a snapshot (cache-busted by games played). */
  cardPath(s: StatsSnapshot): string;
  leaders(game: LeaderGame, limit: number): readonly LeaderEntry[];
  /** Live tables of one game (private ones included; the commands filter them). */
  tables(game: LeaderGame): readonly ActivityTable[];
  /** Today's Cards Daily Challenge; absent when the site has no such feature. */
  daily?: () => DailyInfo | null | Promise<DailyInfo | null>;
  now(): number;
}

// ---- definitions --------------------------------------------------------------------------

const OPT = { STRING: 3, INTEGER: 4, USER: 6 } as const;

export interface CommandDefinition {
  name: string;
  description: string;
  type: 1;
  options?: Record<string, unknown>[];
}

export interface DefinitionFlags {
  /** The leaderboard switch: without it /stats and /leaderboard are not offered. */
  statsPublic: boolean;
  /** The site has a Cards Daily Challenge. */
  daily: boolean;
}

/** The commands Discord is told about, in a fixed order (the hash depends on it). */
export function commandDefinitions(f: DefinitionFlags): CommandDefinition[] {
  const defs: CommandDefinition[] = [
    { name: 'play', type: 1, description: `Play ${GAMES.monopoly.name}, ${GAMES.cards.name} or ${GAMES.poker.name} on ${BRAND.name}` },
  ];
  if (f.statsPublic) {
    defs.push({
      name: 'stats', type: 1, description: `A player's ${BRAND.name} stats and badges`,
      options: [{ type: OPT.USER, name: 'user', description: 'Whose stats (you, if left blank)', required: false }],
    });
    defs.push({
      name: 'leaderboard', type: 1, description: `The top 10 ${BRAND.name} players`,
      options: [{
        type: OPT.STRING, name: 'game', description: 'Which game (Monopoly, if left blank)', required: false,
        choices: [{ name: GAMES.monopoly.name, value: 'monopoly' }, { name: GAMES.cards.name, value: 'cards' }],
      }],
    });
  }
  defs.push({ name: 'tables', type: 1, description: 'Open public tables you can join right now' });
  if (f.daily) defs.push({ name: 'daily', type: 1, description: `Today's ${GAMES.cards.name} Daily Challenge` });
  defs.push({
    name: 'chog', type: 1, description: 'Show a Chog Genesis NFT (the Chog of the Day, if no id)',
    options: [{ type: OPT.INTEGER, name: 'id', description: `Token id, 1 to ${CHOG_SUPPLY}`, required: false, min_value: 1, max_value: CHOG_SUPPLY }],
  });
  return defs;
}

/** JSON with object keys sorted, so the same definitions always hash the same. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** What a registration is keyed on: the definitions and where they go. Any change re-registers. */
export function commandsHash(defs: readonly CommandDefinition[], scope: { appId: string; guildId: string }): string {
  return createHash('sha256').update(stableJson({ scope, defs })).digest('hex');
}

// ---- formatting -----------------------------------------------------------------------------

/** One short line: no control or direction-override characters, at most `max` long. */
export function plainName(name: string, max = 32): string {
  // eslint-disable-next-line no-control-regex
  const one = name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim() || 'Player';
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** A display name made safe inside Discord markdown (descriptions, fields): no formatting, links or mentions. */
export function safeName(name: string, max = 32): string {
  return plainName(name, max).replace(/([\\*_~`|>[\]()<@#])/g, '\\$1');
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const button = (label: string, url: string, emoji?: string): LinkButton =>
  ({ type: 2, style: 5, label, url, ...(emoji && { emoji: { name: emoji } }) });
const tableUrl = (origin: string, game: LeaderGame, code: string) => `${origin}${game === 'cards' ? '/cards/r/' : '/r/'}${encodeURIComponent(code)}`;
export const profileUrl = (origin: string, id: string) => `${origin}/u/${encodeURIComponent(id)}`;
const absolute = (origin: string, path: string) => (/^https?:\/\//.test(path) ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`);

export const oops = (content: string): Reply => ({ ephemeral: true, content });

/** The JSON a reply becomes, for the interaction response and for webhook edits. Never pings anyone. */
export function messageBody(r: Reply): Record<string, unknown> {
  return {
    ...(r.content !== undefined && { content: r.content }),
    ...(r.embeds && { embeds: r.embeds }),
    ...(r.components && { components: r.components }),
    allowed_mentions: { parse: [] },
    ...(r.ephemeral && { flags: 64 }),
  };
}

// ---- rate limit -----------------------------------------------------------------------------

/** A sliding window per Discord user: `max` commands per `windowMs`. */
export function createUserLimiter(max = 5, windowMs = 20_000, cap = 10_000) {
  const hits = new Map<string, number[]>();
  return {
    /** Counts the attempt; false once the user is over the limit. */
    allow(userId: string, now: number): boolean {
      const recent = (hits.get(userId) ?? []).filter(t => now - t < windowMs);
      if (recent.length >= max) { hits.set(userId, recent); return false; }
      recent.push(now);
      hits.delete(userId); // re-insert: the map's order is least recently used first
      hits.set(userId, recent);
      if (hits.size > cap) hits.delete(hits.keys().next().value!);
      return true;
    },
    clear() { hits.clear(); },
  };
}

// ---- the commands -------------------------------------------------------------------------

function liveTables(deps: SlashDeps, game: LeaderGame) {
  const pub = deps.tables(game).filter(t => !t.private && t.occupied && !t.restricted);
  return {
    playing: pub.filter(t => t.status === 'playing'),
    open: pub.filter(t => t.status === 'lobby' && t.players < t.maxPlayers).sort((a, b) => b.createdAt - a.createdAt),
  };
}

function play(deps: SlashDeps): Reply {
  const o = deps.origin();
  const line = (game: LeaderGame) => {
    const t = liveTables(deps, game);
    if (!t.playing.length && !t.open.length) return 'No public tables right now: open one and share the code';
    return `${plural(t.playing.length, 'table')} playing · ${plural(t.open.length, 'lobby', 'lobbies')} with seats free`;
  };
  return {
    embeds: [{
      title: `🎲 Play on ${BRAND.name}`,
      url: `${o}/`,
      color: PINK,
      description: 'Free, in your browser, nothing to download. Sign in with Discord and you are at the table.',
      fields: [
        { name: `🎩 ${GAMES.monopoly.name}`, value: line('monopoly') },
        { name: `🃏 ${GAMES.cards.name}`, value: line('cards') },
        { name: `♠️ ${GAMES.poker.name}`, value: "Texas Hold'em tournaments, play chips only" },
      ],
      footer: { text: 'Use /tables to see the open tables' },
    }],
    components: [{
      type: 1,
      components: [
        button(GAMES.monopoly.name, `${o}${GAMES.monopoly.path}`, '🎩'),
        button(GAMES.cards.name, `${o}${GAMES.cards.path}`, '🃏'),
        button(GAMES.poker.name, `${o}${GAMES.poker.path}`, '♠️'),
      ],
    }],
  };
}

function gameLine(p: { games: number; wins: number; winRate: number } | null): string {
  if (!p) return 'Not played yet';
  return `**${p.games}** ${p.games === 1 ? 'game' : 'games'} · **${p.wins}** ${p.wins === 1 ? 'win' : 'wins'} · **${pct(p.winRate)}** win rate`;
}

function topBadges(list: StatsSnapshot['achievements'], n: number) {
  return list.filter(a => a.earned).sort((a, b) => b.tier - a.tier || (b.earnedAt ?? 0) - (a.earnedAt ?? 0)).slice(0, n);
}

function stats(i: CommandInteraction, caller: DiscordUser, deps: SlashDeps): Reply {
  if (!deps.statsPublic()) return oops('Player stats are switched off on the site right now.');
  const optId = i.data?.options?.find(x => x.name === 'user')?.value;
  const targetId = typeof optId === 'string' && /^\d{5,25}$/.test(optId) ? optId : caller.id;
  const target = i.data?.resolved?.users?.[targetId] ?? (targetId === caller.id ? caller : null);
  const self = targetId === caller.id;
  if (target?.bot) return oops('Bots do not play here. Try a person.');
  const playerId = `dc_${targetId}`;
  // A banned player gets nothing, and the reply does not say why.
  if (deps.banned(playerId)) return oops('There are no stats to show for that player.');
  const s = deps.snapshot(playerId);
  if (!s) {
    return oops(self
      ? `You have not finished a game on ${BRAND.name} yet. Use /play to find a table.`
      : `<@${targetId}> has not finished a game on ${BRAND.name} yet.`);
  }
  const o = deps.origin();
  const url = profileUrl(o, s.id);
  const wins = (s.monopoly?.wins ?? 0) + (s.cards?.wins ?? 0);
  const badges = topBadges(s.achievements, 5);
  const earned = s.achievements.filter(a => a.earned).length;
  const fields: NonNullable<Embed['fields']> = [
    { name: `🎩 ${GAMES.monopoly.name}`, value: gameLine(s.monopoly) },
    { name: `🃏 ${GAMES.cards.name}`, value: gameLine(s.cards) },
  ];
  if (badges.length) {
    fields.push({
      name: `🏅 Top badges (${earned} earned)`,
      value: badges.map(b => `${b.emoji} ${b.name}`).join('\n'),
    });
  }
  return {
    embeds: [{
      title: plainName(s.name),
      url,
      color: PINK,
      description: `${plural(wins, 'win')} in ${plural(s.games, 'game')}`,
      fields,
      image: { url: absolute(o, deps.cardPath(s)) },
      footer: { text: `${BRAND.name} profile` },
    }],
    components: [{ type: 1, components: [button('View profile', url, '👤')] }],
  };
}

function leaderboardCmd(i: CommandInteraction, deps: SlashDeps): Reply {
  if (!deps.statsPublic()) return oops('The leaderboard is switched off on the site right now.');
  const raw = i.data?.options?.find(x => x.name === 'game')?.value;
  const game: LeaderGame = raw === 'cards' ? 'cards' : 'monopoly';
  const o = deps.origin();
  // Asked for more than ten so that leaving out banned players still fills the board.
  const rows = deps.leaders(game, 50).filter(r => !deps.banned(r.id)).slice(0, 10);
  const medal = ['🥇', '🥈', '🥉'];
  const title = `🏆 ${GAMES[game].name} leaderboard`;
  if (!rows.length) {
    return {
      embeds: [{ title, url: `${o}/leaderboard`, color: PINK, description: 'No ranked games yet. Games with at least two people count: be the first.' }],
    };
  }
  return {
    embeds: [{
      title,
      url: `${o}/leaderboard`,
      color: PINK,
      description: rows.map((r, n) =>
        `${medal[n] ?? `**${n + 1}.**`} [${safeName(r.name, 24)}](${profileUrl(o, r.id)}) · **${r.points}** pts · ${plural(r.wins, 'win')} in ${plural(r.games, 'game')}`).join('\n'),
      footer: { text: 'A point for every opponent you outlast. Games against bots only do not count.' },
    }],
    components: [{ type: 1, components: [button('Full leaderboard', `${o}/leaderboard`, '🏆')] }],
  };
}

function tables(deps: SlashDeps): Reply {
  const o = deps.origin();
  const fields: NonNullable<Embed['fields']> = [];
  const buttons: LinkButton[] = [];
  let open = 0;
  for (const game of ['monopoly', 'cards'] as const) {
    const t = liveTables(deps, game);
    open += t.open.length;
    const shown = t.open.slice(0, 8);
    const lines = shown.map(x => {
      const free = x.maxPlayers - x.players;
      return `[\`${x.code}\`](${tableUrl(o, game, x.code)}) · ${x.players}/${x.maxPlayers} players · ${plural(free, 'seat')} free`;
    });
    if (t.open.length > shown.length) lines.push(`…and ${t.open.length - shown.length} more`);
    if (t.playing.length) lines.push(`*${plural(t.playing.length, 'table')} playing now*`);
    fields.push({ name: `${game === 'cards' ? '🃏' : '🎩'} ${GAMES[game].name}`, value: lines.join('\n') || 'No open tables' });
    for (const x of shown) if (buttons.length < 5) buttons.push(button(`Join ${x.code}`, tableUrl(o, game, x.code)));
  }
  if (!open) {
    return {
      embeds: [{
        title: '🪑 Open tables', url: `${o}/`, color: PINK, fields,
        description: 'No public table has a free seat right now. Open one and share the code!',
      }],
      components: [{
        type: 1,
        components: [button(`Open a ${GAMES.monopoly.name} table`, `${o}${GAMES.monopoly.path}`, '🎩'), button(`Open a ${GAMES.cards.name} table`, `${o}${GAMES.cards.path}`, '🃏')],
      }],
    };
  }
  return {
    embeds: [{ title: '🪑 Open tables', url: `${o}/`, color: PINK, description: `${plural(open, 'table')} with seats free right now.`, fields }],
    components: [{ type: 1, components: buttons }],
  };
}

async function daily(deps: SlashDeps): Promise<Reply> {
  if (!deps.daily) return oops(`There is no Daily Challenge on ${BRAND.name} yet.`);
  const d = await deps.daily();
  if (!d) return oops("Today's Daily Challenge is not ready yet. Try again in a little while.");
  const url = absolute(deps.origin(), d.path);
  return {
    embeds: [{ title: `📅 ${plainName(d.title, 80)}`, url, color: PINK, description: d.description.slice(0, 2000), ...(d.fields?.length && { fields: d.fields }) }],
    components: [{ type: 1, components: [button("Play today's challenge", url, '🃏')] }],
  };
}

const TRAIT_ORDER: (keyof ChogTraits)[] = ['Tier', 'Base', 'Form', 'Skin', 'Eyes', 'Mouth', 'Head', 'Body', 'Accessory', 'Aura', 'Background', 'Side'];

function chog(i: CommandInteraction, deps: SlashDeps): Reply {
  const raw = i.data?.options?.find(x => x.name === 'id')?.value;
  const ofTheDay = raw === undefined;
  const id = ofTheDay ? chogOfTheDay(deps.now()) : Number(raw);
  const traits = Number.isInteger(id) ? traitsOf(id) : null;
  if (!traits) return oops(`There is no Chog #${String(raw).slice(0, 8)}. Chog Genesis runs from 1 to ${CHOG_SUPPLY}.`);
  const o = deps.origin();
  const hex = (traits.Background && BACKGROUND_COLORS[traits.Background]) || '#eaa2f6';
  const fields = TRAIT_ORDER.flatMap(k => (traits[k] ? [{ name: k, value: plainName(String(traits[k]), 60), inline: true }] : []));
  return {
    embeds: [{
      title: `${ofTheDay ? '☀️ Chog of the Day: ' : ''}${chogName(id)}`,
      url: openSeaUrl(id),
      color: Number.parseInt(hex.slice(1, 7), 16) || PINK,
      fields,
      image: { url: `${o}/chogs/${id}.webp` },
      footer: { text: ofTheDay ? 'A new Chog every day at 00:00 UTC' : 'Chog Genesis' },
    }],
    components: [{ type: 1, components: [button('See it on OpenSea', openSeaUrl(id), '🌊')] }],
  };
}

export interface HandleOptions {
  limiter?: ReturnType<typeof createUserLimiter>;
}

/**
 * One slash command to its reply. Never throws: a failure inside a command is
 * logged and answered with an ephemeral apology.
 */
export async function handleCommand(i: CommandInteraction, deps: SlashDeps, opts: HandleOptions = {}): Promise<Reply> {
  const caller = i.member?.user ?? i.user;
  if (!caller?.id) return oops("Couldn't read your Discord account. Try again.");
  if (opts.limiter && !opts.limiter.allow(caller.id, deps.now())) {
    return oops('Slow down a little: try that again in a few seconds.');
  }
  // A banned player gets nothing from the bot either.
  if (deps.banned(`dc_${caller.id}`)) return oops(`You can't use ${BRAND.name} commands.`);
  try {
    switch (i.data?.name) {
      case 'play': return play(deps);
      case 'stats': return stats(i, caller, deps);
      case 'leaderboard': return leaderboardCmd(i, deps);
      case 'tables': return tables(deps);
      case 'daily': return await daily(deps);
      case 'chog': return chog(i, deps);
      default: return oops("I don't know that command. It may have been removed: try /play.");
    }
  } catch (e) {
    console.error(`[discord] /${i.data?.name} failed:`, e);
    return oops('Something went wrong on our side. Try again in a moment.');
  }
}

// ---- answering in time ----------------------------------------------------------------------

/** Discord waits 3 s for the first response. Anything slower than this is deferred. */
export const DEFER_AFTER_MS = 2_000;

export interface AnswerOptions extends HandleOptions {
  deferAfterMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * The HTTP response body for a command interaction. When the reply is ready
 * within `deferAfterMs` it goes straight back (type 4); otherwise Discord is
 * told "thinking…" (type 5) and the reply follows as an edit of that message.
 */
export async function answerCommand(i: CommandInteraction, deps: SlashDeps, opts: AnswerOptions = {}): Promise<Record<string, unknown>> {
  const work = handleCommand(i, deps, opts);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), opts.deferAfterMs ?? DEFER_AFTER_MS); });
  const first = await Promise.race([work, late]);
  clearTimeout(timer);
  if (first) return { type: 4, data: messageBody(first) };
  void work.then(reply => finishDeferred(i, reply, opts.fetchImpl ?? fetch)).catch(e => console.error('[discord] deferred reply failed:', e));
  return { type: 5 };
}

/**
 * Deliver a deferred reply. The "thinking…" message is public, so a public
 * reply replaces it; an ephemeral one (an error) removes it and is sent as an
 * ephemeral follow-up instead.
 */
export async function finishDeferred(i: CommandInteraction, reply: Reply, fetchImpl: typeof fetch = fetch): Promise<void> {
  const app = i.application_id ?? process.env.DISCORD_CLIENT_ID?.trim();
  if (!app || !i.token) return;
  const hook = `${API}/webhooks/${app}/${i.token}`;
  const json = { 'content-type': 'application/json' };
  const signal = () => AbortSignal.timeout(10_000);
  if (!reply.ephemeral) {
    const res = await fetchImpl(`${hook}/messages/@original`, { method: 'PATCH', headers: json, body: JSON.stringify(messageBody(reply)), signal: signal() });
    if (!res.ok) console.error('[discord] could not edit the deferred reply:', res.status);
    return;
  }
  await fetchImpl(`${hook}/messages/@original`, { method: 'DELETE', signal: signal() }).catch(() => undefined);
  const res = await fetchImpl(hook, { method: 'POST', headers: json, body: JSON.stringify(messageBody(reply)), signal: signal() });
  if (!res.ok) console.error('[discord] could not send the deferred reply:', res.status);
}

// ---- the live wiring ------------------------------------------------------------------------

let liveDeps: SlashDeps | null = null;
const limiter = createUserLimiter();

/** index.ts hands over the real stores once the game registries exist. */
export function configureSlashCommands(deps: SlashDeps): void {
  liveDeps = deps;
}

export function slashDeps(): SlashDeps | null {
  return liveDeps;
}

/** Whether /daily is offered (the site has a Cards Daily Challenge). */
export function dailyAvailable(): boolean {
  return !!liveDeps?.daily;
}

/** The route's entry point: the real stores, the shared per-user limit. */
export async function answerLiveCommand(i: CommandInteraction): Promise<Record<string, unknown>> {
  if (!liveDeps) return { type: 4, data: messageBody(oops(`${BRAND.name} is still starting up. Try again in a few seconds.`)) };
  return answerCommand(i, liveDeps, { limiter });
}
