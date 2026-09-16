import express from 'express';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import {
  adminModeConfigured, demoMode, makeDemoProfile, makeDiscordProfile,
  signState, signToken, verifyState, verifyToken, withAdminFlag, withDiscord,
} from './auth.ts';
import {
  announceChannelId, authorizeUrl, botEnabled, completeOAuth, defaultGuildId,
  defaultInviteUrl, discordEnabled, fetchGuildRoles, postVerifyMessage,
  redirectUriFor, registerIdentity, sendDirectMessage,
} from './discord.ts';
import { handleInteraction, interactionsConfigured, validSignature } from './interactions.ts';
import {
  buttonFlowAvailable, codeStatus, codeVerifyAvailable, impliedGuildIds,
  primeVerifyChannel, startCode, verifyChannelId, verifyChannelName,
} from './verifycode.ts';
import {
  altGroups, auditCounts, connectionsFor, flaggedHands, forgetPlayer, loadAudit, playerRows, recentActions,
  saveAudit, suspiciousPairs,
} from './audit.ts';
import { BRAND } from '../../shared/brand.ts';
import { registry } from './registry.ts';
import { attachSockets, disconnectBanned, trustedProxyHops } from './sockets.ts';
import {
  allCashRecords, allRecords, archivedNames, findRecord, leaderboard, loadCashRecords, repairTournamentPlaces,
  loadResults, recentRecords, recordCount, removeCashRecord, removeRecord, repairKnownRecords, saveResults,
} from './store.ts';
import { armPersistence, lastSnapshotAge, restoreLive, snapshotLive } from './persist.ts';
import {
  addSong, listPlaylists, listSongs, loadSongs, manifestRows, MAX_SONG_BYTES,
  removeSong, renamePlaylist, songFilePath, updateSong, importFrom,
} from './music.ts';
import {
  addGraphic, graphicFilePath, listGraphics, loadGraphics, MAX_GRAPHIC_BYTES,
  removeGraphic, sanitizeTheme,
} from './graphics.ts';
import { getPromo, loadPromo, type Promo, publicPromo, setPromo } from './promo.ts';
import { type Features, getFeatures, isOn, loadFeatures, setFeatures } from './features.ts';
import {
  addBan, type BanKind, type BanScope, listBans, loadBans, normaliseIp, removeBan, removeGameBans,
} from './bans.ts';
import { chatEnabled, setChatEnabled } from './chatrules.ts';
import { eventsForGame, loadEvents, loggedGames } from './eventlog.ts';
import { hopCountHealth, ipSamples } from './ipdebug.ts';
import { printStartupReport } from './startupcheck.ts';
import { parseCustomLevels } from './tournament/blinds.ts';
import type { SocialRequirements, TournamentConfig } from '../../shared/types.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

const bootedAt = Date.now();

// Which build is actually running. Without this there is no way to answer
// "is the thing I am looking at the thing that was just pushed?" from the
// outside, and the whole afternoon can go on a change that shipped correctly
// and simply had not been deployed. Railway sets these on every build; the
// fallbacks keep it honest rather than inventing a value.
function buildStamp() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA
    ?? process.env.GIT_COMMIT_SHA
    ?? process.env.SOURCE_COMMIT
    ?? null;
  return {
    commit: sha ? sha.slice(0, 7) : 'unknown',
    branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    deployedAt: process.env.RAILWAY_DEPLOYMENT_ID ? new Date(bootedAt).toISOString() : null,
    startedAt: new Date(bootedAt).toISOString(),
  };
}

loadResults();
repairKnownRecords();
loadEvents();
loadAudit();
loadSongs();
loadGraphics();
loadPromo();
loadCashRecords();
loadBans();
loadFeatures();

const app = express();
// Behind Railway/Caddy — respect X-Forwarded-*. The count must match what
// the socket side counts back by, or `req.ip` and the address a ban is
// written against would disagree, and a player barred over HTTP would walk
// straight back in over the socket.
app.set('trust proxy', trustedProxyHops());

// Discord interactions must be verified against the RAW body, so this route
// is mounted with a raw parser ahead of express.json().
app.post('/api/discord/interactions', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  void (async () => {
    const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
    const sig = req.headers['x-signature-ed25519'] as string | undefined;
    const ts = req.headers['x-signature-timestamp'] as string | undefined;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    // Discord probes with a deliberately bad signature and requires a 401.
    if (!publicKey || !sig || !ts || !validSignature(publicKey, sig, ts, raw)) {
      res.status(401).json({ error: 'bad signature', publicKeyConfigured: !!publicKey });
      return;
    }
    let interaction: unknown;
    try {
      interaction = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'bad body' });
      return;
    }
    const mine = handleInteraction(interaction as Parameters<typeof handleInteraction>[0]);
    if (mine) { res.status(mine.status).json(mine.body); return; }
    // This site owns its Discord application outright — there is nowhere to
    // pass an unrecognised interaction on to.
    res.status(200).json({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } });
  })();
});

// Health probe for the interactions endpoint (open it in a browser). Discord
// only ever reports "could not be verified", so this says which piece is
// actually missing — in plain English, on the machine that has the answer.
app.get('/api/discord/interactions', (req, res) => {
  const key = process.env.DISCORD_PUBLIC_KEY?.trim() ?? '';
  // Discord public keys are exactly 32 bytes, hex encoded.
  const keyLooksValid = /^[0-9a-fA-F]{64}$/.test(key);
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!key) {
    problems.push(
      'DISCORD_PUBLIC_KEY is not set. Copy it from the Discord Developer Portal '
      + '(your app → General Information → Public Key) into this service\'s variables, '
      + 'wait for the redeploy, then save the Interactions Endpoint URL again.',
    );
  } else if (!keyLooksValid) {
    problems.push(
      `DISCORD_PUBLIC_KEY does not look like a public key: expected 64 hex characters, got ${key.length}. `
      + 'Make sure you copied the Public Key — not the Application ID, client secret or bot token.',
    );
  }
  if (!process.env.DISCORD_VERIFY_CHANNEL_ID?.trim()) {
    warnings.push('DISCORD_VERIFY_CHANNEL_ID is not set — "Post verify panel" has no default channel.');
  }

  // The public key is public by design (Discord prints it in the portal and it
  // can only verify signatures, never create them). Showing the ends of it lets
  // the operator confirm the value on THIS service matches the app they are
  // editing — the failure that looks identical to "key not set".
  const keyPreview = key ? `${key.slice(0, 8)}…${key.slice(-8)}` : null;

  res.json({
    ok: true,
    endpoint: 'discord-interactions',
    // The single question that matters: would Discord accept this URL now?
    readyForDiscord: keyLooksValid,
    // Paste this exact string into the portal — it is the URL you just opened.
    thisUrl: `${req.protocol}://${req.get('host')}/api/discord/interactions`,
    publicKeyConfigured: interactionsConfigured(),
    publicKeyLooksValid: keyLooksValid,
    publicKeyPreview: keyPreview,
    publicKeyLength: key.length,
    verifyChannelConfigured: !!process.env.DISCORD_VERIFY_CHANNEL_ID?.trim(),
    serverStartedAt: new Date(bootedAt).toISOString(),
    uptimeSec: Math.round(process.uptime()),
    problems,
    warnings,
    nextStep: keyLooksValid
      ? 'This endpoint is ready. Check publicKeyPreview matches the Public Key of the SAME Discord application whose '
        + 'Interactions Endpoint URL you are saving, then paste thisUrl into the portal and save. If the portal still '
        + 'refuses, reload this page first (a sleeping service can miss Discord’s 3-second check) and save again immediately.'
      : problems[0],
  });
});

// Explicit, and small. Every JSON body this server accepts is a handful of
// settings; the default 100kb is an invitation to send 100kb.
app.use(express.json({ limit: '64kb' }));

// The origin the user is actually browsing on (works for every attached domain).
function requestBase(req: express.Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

// Light per-IP rate limiting on auth/creation endpoints (in-memory buckets).
const buckets = new Map<string, { count: number; resetAt: number }>();
// A flood from spoofed or rotating addresses must not turn the limiter
// itself into the memory leak that takes the process down. Past this many
// tracked keys the oldest are dropped: the limiter degrades, the server does
// not fall over.
const MAX_BUCKETS = 20_000;

function rateLimit(max: number, windowMs: number): express.RequestHandler {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_OFF === '1') { next(); return; }
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      if (buckets.size >= MAX_BUCKETS) {
        // Map preserves insertion order, so the front is the oldest.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      res.status(429).json({ error: 'Too many requests — slow down' });
      return;
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 60_000).unref();

// Everything under /api gets a ceiling. Before this only sign-in and game
// creation were limited, which left every public endpoint — config, promo,
// results — as free work for anyone who wanted to spend the server's CPU.
// The number is far above what a real player generates in a minute.
app.use('/api', rateLimit(600, 60_000));
app.use('/api/auth', rateLimit(30, 60_000));
app.use(['/api/tables', '/api/tournaments'], rateLimit(20, 60_000));

// Dev CORS (Vite runs on another port).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Slowloris: a client opens a connection and dribbles a request out a byte at
// a time, holding a socket open for as long as the server will wait. Node's
// defaults are generous, so these are not.
//
// `connectionsCheckingInterval` is the one that actually matters and is easy
// to miss: the timeouts below are only enforced when Node sweeps for stale
// connections, and that sweep runs every 30s by default. Setting the timeouts
// without it means they fire up to half a minute late — which measured as
// "not firing at all" against a 26s test.
const httpServer = createServer({
  headersTimeout: 10_000,             // headers must arrive within 10s
  requestTimeout: 20_000,             // the whole request within 20s
  keepAliveTimeout: 8_000,            // idle keep-alive sockets are let go
  connectionsCheckingInterval: 2_000, // and we check often enough to mean it
}, app);
httpServer.maxHeadersCount = 100;     // no header-count flooding
const io = new Server(httpServer, {
  cors: { origin: true, credentials: false },
  pingInterval: 10_000,
  pingTimeout: 20_000,
  // Every message this game sends is a few hundred bytes; uploads go over
  // HTTP, not the socket. The default ceiling is 1MB, which is an invitation.
  maxHttpBufferSize: 32_000,
  // Don't let a half-opened handshake hold a slot indefinitely.
  connectTimeout: 10_000,
});
attachSockets(io);

// Bring back any games that were live when the previous process ended, then
// keep a rolling snapshot so the next restart can do the same.
const restored = restoreLive();
if (restored.tournaments || restored.cashTables) {
  console.log(`Restored ${restored.tournaments} tournament(s) and ${restored.cashTables} cash table(s) from the last snapshot`);
}
armPersistence();

// Event-loop lag: how far behind timers are running — the single best
// "is the server struggling" number for a Node process.
let loopLagMs = 0;
{
  let last = Date.now();
  const iv = setInterval(() => {
    const now = Date.now();
    loopLagMs = Math.max(0, now - last - 1000);
    last = now;
  }, 1000);
  iv.unref?.();
}

// Nothing under /api is cacheable. Every one of these is live state, and a
// cached copy of live state is indistinguishable from the server having
// ignored you: the operator flips a switch, the save lands, the page is
// reloaded, and a stale copy of /api/config puts the old answer back. That
// reads as "my settings do not save" and sends you looking at the disk, which
// is the one place that is working.
//
// It matters more than the usual "browsers are conservative with JSON"
// argument, because the response does not have to reach a browser cache to be
// stored — a CDN, a company proxy or a security suite doing TLS interception
// on the operator's own machine will all happily keep a response that never
// said not to.
app.use('/api', (_req, res, next) => {
  res.setHeader('cache-control', 'no-store, max-age=0');
  next();
});

// ---------- auth ----------
app.get('/api/config', (_req, res) => {
  res.json({
    chatEnabled: chatEnabled(),
    discordEnabled: discordEnabled(),
    demoMode: demoMode(),
    adminMode: adminModeConfigured(),
    codeVerify: codeVerifyAvailable(),
    codeVerifyChannel: verifyChannelName(),
    codeVerifyButton: buttonFlowAvailable(),
    features: getFeatures(),
    discord: {
      botEnabled: botEnabled(),
      guildId: defaultGuildId(),
      inviteUrl: defaultInviteUrl(),
      announceConfigured: !!announceChannelId(),
    },
  });
});

// ---------- the promo code the site advertises ----------
// Public: every visitor sees the advert, signed in or not.
app.get('/api/promo', (_req, res) => {
  // The feature switch wins over the promo's own enabled flag: turning the
  // advert off in one place has to be enough.
  res.json({ promo: publicPromo() });
});

app.get('/api/admin/promo', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ promo: getPromo() });
});

app.put('/api/admin/promo', (req, res) => {
  if (!requireAdmin(req, res)) return;
  // The whole body goes through. Listing the fields by hand here is what
  // dropped `firms` and `railEnabled` on the floor — edits saved as a 200
  // and came straight back unchanged. setPromo normalises and bounds every
  // field anyway, so forwarding is both safer and can't drift again.
  res.json({ promo: setPromo((req.body ?? {}) as Partial<Promo>) });
});

// ---------- "verify with a code" sign-in (post a short code in Discord) ----------
app.post('/api/auth/code/start', (_req, res) => {
  try {
    res.json(startCode());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Not available' });
  }
});

app.get('/api/auth/code/status', (req, res) => {
  const status = codeStatus(String(req.query.code ?? ''));
  if (status.pending) { res.json({ pending: true }); return; }
  if (!status.resolution) { res.json({ pending: false, expired: true }); return; }
  const d = status.resolution;
  registerIdentity(d.id, d.username, impliedGuildIds());
  const profile = makeDiscordProfile({ id: d.id, username: d.username, avatarUrl: d.avatarUrl });
  res.json({ pending: false, token: signToken(profile), profile });
});

// Operator-only: list the guild's roles for the role-requirement picker.
app.get('/api/discord/roles', async (req, res) => {
  const me = authed(req);
  if (!me?.isAdmin) { res.status(403).json({ error: 'Operator only' }); return; }
  try {
    const guildId = String(req.query.guildId ?? defaultGuildId() ?? '').trim();
    if (!/^\d{5,25}$/.test(guildId)) { res.status(400).json({ error: 'Provide a valid server ID' }); return; }
    const roles = await fetchGuildRoles(guildId);
    res.json({ roles });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not fetch roles' });
  }
});

// ---------- Discord sign-in / account linking (OAuth redirect flow) ----------
// GET /api/auth/discord/start?return=<path>[&token=<existing token to link>]
// The redirect URI is derived from the domain the user is browsing on, so it
// works on the Railway domain and the custom domain alike — each domain's
// callback just needs to be registered in the Discord portal.
app.get('/api/auth/discord/start', (req, res) => {
  if (!discordEnabled()) { res.status(400).send('Discord sign-in is not configured'); return; }
  const ret = String(req.query.return ?? '/');
  const stateData: Record<string, string> = { return: ret.startsWith('/') ? ret : '/' };
  // Optional: link to an existing signed-in profile instead of a fresh sign-in.
  const token = String(req.query.token ?? '');
  if (token && verifyToken(token)) stateData.token = token;
  res.redirect(authorizeUrl(signState(stateData), redirectUriFor(requestBase(req))));
});

// Health probe for sign-in, in the same spirit as the interactions one below:
// open it in a browser ON THE DOMAIN THAT IS FAILING and it answers the only
// question that matters, which is one nobody can answer from the outside.
//
// Discord matches `redirect_uri` as an exact string, and this server derives
// it from the host in the address bar rather than from PUBLIC_URL — that is
// deliberate, so one deployment can serve a Railway domain and a custom domain
// at once. The cost is that "I registered the redirect" and "I registered the
// redirect for the domain I am actually using" are different statements, and
// Discord's error page says the same eleven words either way.
//
// Nothing secret is exposed: the client id and the redirect are both sent to
// Discord in a URL the player's own browser follows, and the secret is only
// ever reported as present or absent.
app.get('/api/auth/discord/check', (req, res) => {
  const base = requestBase(req);
  const override = process.env.DISCORD_REDIRECT_URI?.trim() || null;
  const derived = `${base.replace(/\/$/, '')}/api/auth/discord/callback`;
  const sent = redirectUriFor(base);
  const clientId = process.env.DISCORD_CLIENT_ID?.trim() ?? '';
  const hasSecret = !!process.env.DISCORD_CLIENT_SECRET?.trim();
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!clientId) {
    problems.push(
      'DISCORD_CLIENT_ID is not set, so the sign-in link goes to Discord with no '
      + 'application on it. Copy the Application ID from the Developer Portal '
      + '(your app → General Information) into this service\'s variables.',
    );
  } else if (!/^\d{17,20}$/.test(clientId)) {
    problems.push(
      `DISCORD_CLIENT_ID is "${clientId}", which is not an application id — those `
      + 'are 17–20 digits. Discord will refuse the authorize link outright. Make '
      + 'sure this is the Application ID and not the public key, bot token or '
      + 'client secret.',
    );
  }
  if (!hasSecret) {
    problems.push(
      'DISCORD_CLIENT_SECRET is not set. Sign-in is switched off entirely until '
      + 'it is — /api/auth/discord/start answers "not configured" rather than '
      + 'sending anyone to Discord.',
    );
  }
  // localhost is Discord's one exception to the https rule, so warning about
  // it while developing would be noise that trains the eye to skip the block.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(req.get('host') ?? '');
  if (req.protocol !== 'https' && !local) {
    warnings.push(
      `This request arrived as ${req.protocol}, so the redirect below is not https. `
      + 'Discord refuses a non-https redirect for anything but localhost. If you '
      + 'are on the real domain, the proxy header is not reaching us — check '
      + 'TRUSTED_PROXY_HOPS.',
    );
  }
  if (override && override !== derived) {
    warnings.push(
      `DISCORD_REDIRECT_URI is set to "${override}" and overrides everything, but `
      + `this domain would otherwise have used "${derived}". Sign-in on this `
      + 'domain works only if the override is the one registered in the portal. '
      + 'Unless this service is reached through another host, unset it.',
    );
  }

  res.json({
    ok: true,
    endpoint: 'discord-sign-in',
    // The single question that matters, and the exact string to paste.
    registerThisRedirectUri: sent,
    readyToTry: problems.length === 0,
    youAreOn: base,
    derivedFromThisDomain: derived,
    redirectUriOverride: override,
    clientId: clientId || null,
    clientSecretConfigured: hasSecret,
    botTokenConfigured: !!process.env.DISCORD_BOT_TOKEN?.trim(),
    signInEnabled: discordEnabled(),
    publicUrlVariable: process.env.PUBLIC_URL?.trim() || null,
    problems,
    warnings,
    nextStep: problems.length
      ? problems[0]
      : 'Discord Developer Portal → your application → OAuth2 → Redirects. The '
        + 'list must contain registerThisRedirectUri EXACTLY — same scheme, same '
        + 'host, no trailing slash — then press Save Changes. Discord compares it '
        + 'as plain text, so http vs https, a www that is or is not there, and '
        + 'the Railway domain vs your custom domain are each a different entry. '
        + 'Open this URL on every domain players reach the site on and register '
        + 'each answer. Check clientId is the same application whose redirect '
        + 'list you are editing.',
  });
});

app.get('/api/auth/discord/callback', async (req, res) => {
  try {
    const state = verifyState(String(req.query.state ?? ''));
    if (!state) throw new Error('Invalid or expired state');
    const discord = await completeOAuth(String(req.query.code ?? ''), redirectUriFor(requestBase(req)));
    const existing = state.token ? verifyToken(state.token) : null;
    const updated = existing
      ? withAdminFlag(withDiscord(existing, discord))
      : makeDiscordProfile(discord);
    const token = signToken(updated);
    const ret = state.return?.startsWith('/') ? state.return : '/';
    // Hand the refreshed token back to the SPA via URL hash.
    res.redirect(`${ret}#dtoken=${encodeURIComponent(token)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Discord sign-in failed';
    res.redirect(`/#derror=${encodeURIComponent(msg)}`);
  }
});

// Demo sign-in. Exists only when DEMO_MODE=1, which is how a deployment gets
// shown to someone before it has a Discord application of its own.
app.post('/api/auth/demo', (req, res) => {
  if (!demoMode()) { res.status(404).json({ error: 'Not found' }); return; }
  try {
    const profile = makeDemoProfile(String((req.body ?? {}).name ?? ''));
    res.json({ token: signToken(profile), profile });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
});

function authed(req: express.Request) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  return verifyToken(token);
}

// ---------- lobby / creation ----------
app.get('/api/lobby', (_req, res) => {
  res.json(registry.lobbyView(io.engine.clientsCount));
});

app.get('/api/leaderboard', (_req, res) => {
  res.json({ leaderboard: leaderboard(100), recent: recentRecords(15) });
});

app.get('/api/health', (_req, res) => {
  const mem = process.memoryUsage();
  let liveTables = registry.cashTables.size;
  let livePlayers = 0;
  for (const t of registry.tournaments.values()) {
    liveTables += t.tables.size;
    livePlayers += t.alivePlayers().length;
  }
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    connections: io.engine.clientsCount,
    tournaments: registry.tournaments.size,
    tables: liveTables,
    playersInPlay: livePlayers,
    finishedTournaments: recordCount(),
    rssMb: Math.round(mem.rss / 1024 / 1024),
    build: buildStamp(),
  });
});

function requireAdmin(req: express.Request, res: express.Response) {
  const me = authed(req);
  if (!me) { res.status(401).json({ error: 'Sign in first' }); return null; }
  if (!me.isAdmin) {
    res.status(403).json({ error: 'Only the site operator can create games' });
    return null;
  }
  return me;
}

// Operator: post the "Verify" button panel into the poker verify channel.
app.post('/api/discord/verify-message', (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  const channel = String(req.body?.channelId ?? '').trim() || verifyChannelId();
  if (!channel) {
    res.status(400).json({ error: 'Set DISCORD_VERIFY_CHANNEL_ID (or pass channelId)' });
    return;
  }
  if (!interactionsConfigured()) {
    res.status(400).json({
      error: 'Set DISCORD_PUBLIC_KEY and the portal Interactions Endpoint URL first — ' +
        'the button would do nothing without it',
    });
    return;
  }
  postVerifyMessage(channel, process.env.PUBLIC_URL?.trim() || requestBase(req))
    .then(() => res.json({ ok: true, channelId: channel }))
    .catch(e => res.status(400).json({ error: e instanceof Error ? e.message : 'Could not post' }));
});

// Operator audit views: who is playing, from where, and anything that looks
// like an alt account or two players moving chips one way between themselves.
app.get('/api/admin/audit', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    counts: auditCounts(),
    players: playerRows(),
    alts: altGroups(),
    pairs: suspiciousPairs(Number(req.query.minHands ?? 5)),
    flagged: flaggedHands(120),
  });
});

// Clear one player out of the audit. Housekeeping for test and demo accounts,
// not moderation — banning is its own thing and lives on the same row.
app.delete('/api/admin/audit/player/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id ?? '').slice(0, 64);
  if (!id) { res.status(400).json({ error: 'No player given' }); return; }
  res.json(forgetPlayer(id));
});

// One account, and every other account the addresses tie it to.
//
// The shared-address panel answers "which addresses have more than one
// account on them", which is a different question from "does THIS player have
// alts" and much harder to read when it is the one you have. Accepts a site
// id, a bare Discord id, a Discord tag or a name.
app.get('/api/admin/audit/player/:q', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = connectionsFor(String(req.params.q ?? ''));
  if (!r) { res.status(404).json({ error: 'No account matches that id, tag or name' }); return; }
  if (String(req.query.format ?? '') === 'text') {
    const when = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
    const L: string[] = [];
    L.push(`CONNECTIONS — ${r.subject.name}${r.subject.discordTag ? ` (@${r.subject.discordTag})` : ''}`);
    L.push(`id ${r.subject.id} · ${r.subject.handsPlayed} hands · ${r.subject.games} games · last seen ${when(r.subject.lastSeen)}`);
    L.push('');
    L.push(r.verdict);
    L.push('');
    L.push('THIS PLAYER\'S ADDRESSES');
    if (r.addresses.length === 0) L.push('  none recorded');
    for (const a of r.addresses) {
      L.push(`  ${a.ip}${a.country ? ` [${a.country}]` : ''} — ${a.accounts} account(s) on it`);
    }
    L.push('');
    L.push('LINKED ACCOUNTS');
    if (r.linked.length === 0) L.push('  none');
    for (const l of r.linked) {
      L.push(`  ${l.name}${l.discordTag ? ` (@${l.discordTag})` : ''} — `
        + (l.hops === 1 ? `shares ${l.sharedIps.join(', ')}` : `${l.hops} hops, via ${l.via}`)
        + `, biggest shared address holds ${l.crowd} account(s)`
        + `, ${l.playedTogether} game(s) in common, ${l.handsPlayed} hands`
        + `, last seen ${when(l.lastSeen)}`);
    }
    L.push('');
    L.push('Sharing an address is a prompt to look, never proof.');
    res.type('text/plain').send(L.join('\n'));
    return;
  }
  res.json(r);
});

// One plain-text report the operator can copy in a tap and hand to anyone
// (including a chat with me) — everything the Audit page shows, flattened.
app.get('/api/admin/audit/report', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const counts = auditCounts();
  const alts = altGroups();
  const pairs = suspiciousPairs(Number(req.query.minHands ?? 3));
  const flags = flaggedHands(120);
  const players = playerRows();
  const when = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
  const card = (c: { r: number; s: number }) =>
    `${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[c.r] ?? c.r}${['s', 'h', 'd', 'c'][c.s] ?? '?'}`;

  const L: string[] = [];
  L.push(`${BRAND.name.toUpperCase()} — AUDIT REPORT`);
  L.push(`generated ${when(Date.now())} UTC`);
  L.push(`${counts.players} players · ${counts.actions} actions · ${counts.pairs} pairs · ${counts.flagged} flagged hands`);
  L.push('');
  L.push('FLAGGED HANDS (chips lost with a holding that did not justify it)');
  if (flags.length === 0) L.push('  none');
  for (const f of flags) {
    L.push(`  ${when(f.ts)} ${f.tableName} #${f.handNumber}: ${f.playerName} [${f.cards.map(card).join(' ')}] `
      + `lost ${f.chips} (${f.stackPct}% of stack) to ${f.toName ?? '?'} — ${f.reason}`);
  }
  L.push('');
  L.push('PAIRS (one-way chip flow / repeated donations)');
  if (pairs.length === 0) L.push('  none above threshold');
  for (const p of pairs) {
    const dir = p.netAtoB >= 0 ? `${p.aName} → ${p.bName}` : `${p.bName} → ${p.aName}`;
    L.push(`  ${p.aName} vs ${p.bName}: ${p.headsUpPots} pots, net ${Math.abs(p.netAtoB)} ${dir}`
      + `, ${p.dumpHands} flagged hand(s) worth ${p.dumpChips}`
      + (p.sharedIps.length ? ` — SHARED IP ${p.sharedIps.join(',')}${p.sameIpOnly ? ' (only address for both)' : ''}` : ''));
  }
  L.push('');
  L.push('SHARED ADDRESSES (possible alts — or a shared household)');
  if (alts.length === 0) L.push('  none');
  for (const g of alts) {
    const where = g.addresses
      .map(a => `${a.ip}${a.country ? ` [${a.country}]` : ''}`).join(', ');
    L.push(`  ${g.players.map(p => `${p.name}${p.discordTag ? ` (@${p.discordTag})` : ''}`).join(', ')}`);
    L.push(`      from ${where}  ·  score ${g.score}  ·  ${g.reasons.join('; ')}`);
  }
  L.push('');
  L.push('PLAYERS');
  for (const p of players) {
    const where = [...new Set(p.countries.filter(Boolean))].join(', ');
    L.push(`  ${p.name}${p.discordTag ? ` (@${p.discordTag})` : ''} — ${p.handsPlayed} hands, `
      + `${p.games} games, ${p.ips.length} address(es)${where ? ` from ${where}` : ''}, `
      + `last seen ${when(p.lastSeen)}`);
  }
  L.push('');
  L.push('Flags are advisory. Normal bad play trips them occasionally — read the hands before acting.');
  res.type('text/plain').send(L.join('\n'));
});

// Authoritative integrity check on every running tournament.
app.get('/api/admin/integrity', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const report = [...registry.tournaments.values()]
    .filter(t => t.state === 'running' || t.state === 'break' || t.state === 'paused')
    .map(t => ({ id: t.id, name: t.config.name, ...t.integrity() }));
  res.json({ ok: report.every(r => r.ok), tournaments: report });
});

// Live server health for the operator dashboard.
app.get('/api/admin/ipdebug', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    // This request's own headers, so the operator can compare what the site
    // recorded for them against what their browser reports elsewhere.
    you: {
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      realIp: req.headers['x-real-ip'] ?? null,
      envoyExternal: req.headers['x-envoy-external-address'] ?? null,
      cfConnecting: req.headers['cf-connecting-ip'] ?? null,
      expressIp: req.ip ?? null,
      socketPeer: req.socket.remoteAddress ?? null,
    },
    trustedProxyHops: trustedProxyHops(),
    // A second opinion on whether that number is still right.
    hopCount: hopCountHealth(),
    recent: ipSamples(),
  });
});

app.get('/api/admin/health', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const mem = process.memoryUsage();
  let liveTournaments = 0;
  let liveTables = 0;
  let seatedPlayers = 0;
  let integrityIssues = 0;
  for (const t of registry.tournaments.values()) {
    if (t.state === 'running' || t.state === 'break' || t.state === 'paused') {
      liveTournaments += 1;
      for (const tb of t.tables.values()) {
        if (tb.closed) continue;
        liveTables += 1;
        seatedPlayers += tb.seatedCount();
      }
      const ig = t.integrity();
      if (!ig.ok) integrityIssues += ig.seatless.length + ig.duplicated.length + ig.overCapacity.length;
    }
  }
  for (const c of registry.cashTables.values()) {
    if (c.closed) continue;
    liveTables += 1;
    seatedPlayers += c.seatedCount();
  }
  res.json({
    uptimeSec: Math.round(process.uptime()),
    rssMb: Math.round(mem.rss / 1048576),
    heapMb: Math.round(mem.heapUsed / 1048576),
    sockets: io.engine.clientsCount,
    loopLagMs,
    liveTournaments,
    liveTables,
    seatedPlayers,
    integrityIssues,
    snapshotAgeMs: lastSnapshotAge(),
    persistentDisk: !!(process.env.DATA_DIR && process.env.DATA_DIR.trim()),
  });
});

app.get('/api/admin/actions', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const playerId = req.query.playerId ? String(req.query.playerId) : undefined;
  res.json({ actions: recentActions(clampInt(req.query.limit, 20, 1000, 300), playerId) });
});

// ---------- operator music library ----------
// The operator uploads audio straight from the dashboard; files live on the
// persistent volume and appear in every player's music panel via the merged
// public manifest below.
app.get('/api/admin/music', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ songs: listSongs() });
});

const musicBody = express.raw({ type: () => true, limit: MAX_SONG_BYTES });
app.post('/api/admin/music', (req, res) => {
  // Run the body parser by hand so its failures (too large, connection cut
  // mid-upload) come back as JSON the dashboard can show, not an HTML page.
  musicBody(req, res, (err?: unknown) => {
    if (err) {
      const code = (err as { type?: string }).type;
      console.error('Music upload body error:', code ?? err);
      res.status(413).json({
        error: code === 'entity.too.large'
          ? `File too large (max ${Math.round(MAX_SONG_BYTES / 1048576)} MB)`
          : 'The upload was interrupted before it finished — try again',
      });
      return;
    }
    if (!requireAdmin(req, res)) return;
    try {
      const row = addSong(
        String(req.query.name ?? ''),
        String(req.query.vibe ?? ''),
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
      );
      res.json({ song: row });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Upload failed' });
    }
  });
});

app.patch('/api/admin/music/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const row = updateSong(String(req.params.id), {
    name: typeof req.body?.name === 'string' ? req.body.name : undefined,
    vibe: typeof req.body?.vibe === 'string' ? req.body.vibe : undefined,
  });
  if (!row) { res.status(404).json({ error: 'No such song' }); return; }
  res.json({ song: row });
});

// Pull an entire library across from a sibling deployment in one call.
app.post('/api/admin/music/import', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const from = String(req.body?.from ?? '').trim();
  if (!from) { res.status(400).json({ error: 'Give the address of the site to import from' }); return; }
  const rename = req.body?.rename && typeof req.body.rename === 'object'
    ? req.body.rename as Record<string, string>
    : {};
  importFrom(from, rename)
    .then(r => res.json(r))
    .catch(e => res.status(400).json({ error: e instanceof Error ? e.message : 'Import failed' }));
});

app.get('/api/admin/playlists', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ playlists: listPlaylists() });
});

app.patch('/api/admin/playlists', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const b = req.body ?? {};
    const moved = renamePlaylist(String(b.from ?? ''), String(b.to ?? ''));
    res.json({ moved, playlists: listPlaylists() });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not rename' });
  }
});

app.delete('/api/admin/music/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!removeSong(String(req.params.id))) { res.status(404).json({ error: 'No such song' }); return; }
  res.json({ ok: true });
});

// ---------- operator table graphics ----------
// Felt logos and backgrounds for custom table themes. Same pattern as the
// music library: admin CRUD, magic-byte sniffing, volume-backed storage.
app.get('/api/admin/graphics', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ graphics: listGraphics() });
});

const graphicBody = express.raw({ type: () => true, limit: MAX_GRAPHIC_BYTES });
app.post('/api/admin/graphics', (req, res) => {
  graphicBody(req, res, (err?: unknown) => {
    if (err) {
      res.status(413).json({
        error: (err as { type?: string }).type === 'entity.too.large'
          ? `Image too large (max ${Math.round(MAX_GRAPHIC_BYTES / 1048576)} MB)`
          : 'The upload was interrupted before it finished — try again',
      });
      return;
    }
    if (!requireAdmin(req, res)) return;
    try {
      const row = addGraphic(
        String(req.query.name ?? ''),
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
      );
      res.json({ graphic: row });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Upload failed' });
    }
  });
});

app.delete('/api/admin/graphics/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!removeGraphic(String(req.params.id))) { res.status(404).json({ error: 'No such image' }); return; }
  res.json({ ok: true });
});

// Public: the images themselves — every table viewer loads these.
app.get('/graphics/lib/:file', (req, res) => {
  const full = graphicFilePath(String(req.params.file));
  if (!full) { res.status(404).end(); return; }
  res.setHeader('cache-control', 'public, max-age=86400');
  res.sendFile(full);
});

// Public: the library, which is exactly what the operator uploaded. There is
// no bundled catalogue to merge in any more — a room plays its own music.
app.get('/music/manifest.json', (_req, res) => {
  if (!isOn('music')) { res.json([]); return; }
  res.setHeader('cache-control', 'no-store');
  res.json(manifestRows());
});

// Public: the audio itself. sendFile handles range requests, so seeking works.
app.get('/music/lib/:file', (req, res) => {
  const full = songFilePath(String(req.params.file));
  if (!full) { res.status(404).end(); return; }
  res.sendFile(full);
});

app.post('/api/tables', (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  try {
    const b = req.body ?? {};
    const sb = clampInt(b.sb, 1, 1_000_000, 5);
    const bb = clampInt(b.bb, sb, 2_000_000, sb * 2);
    const minBuy = clampInt(b.minBuy, bb * 10, 10_000_000, bb * 40);
    const maxBuy = clampInt(b.maxBuy, minBuy, 50_000_000, bb * 200);
    const maxSeats = clampInt(b.maxSeats, 2, 9, 9);
    const ante = clampInt(b.ante, 0, bb, 0);
    const name = requireFreeName(b.name, 'table');
    const cashLevels = parseCustomLevels(b.customLevels);
    const table = registry.createCashTable(
      {
        name, sb, bb, ante, minBuy, maxBuy, maxSeats,
        rabbitHunting: !!b.rabbitHunting,
        actionSeconds: clampInt(b.actionSeconds, 5, 120, 22),
        timebankSeconds: clampInt(b.timebankSeconds, 0, 120, 0),
        // Optional rising blinds, validated by the same parser the tournament
        // form's schedules go through.
        levels: cashLevels,
        displayMode: b.displayMode === 'bb' ? 'bb' : 'chips',
        theme: sanitizeTheme(b.theme),
      },
      { id: me.id, name: me.name },
    );
    res.json({ id: table.id });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
});

// ---------- feature switches ----------
app.get('/api/admin/features', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ features: getFeatures() });
});

app.put('/api/admin/features', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ features: setFeatures((req.body ?? {}) as Partial<Features>) });
  } catch (e) {
    // The only way this throws is a disk that would not take the write, which
    // is the same disk the results and the sign-in secret live on. Say so.
    console.error('Could not save features:', e);
    res.status(500).json({
      error: 'Could not save to disk — this deployment has no working persistent '
        + 'volume, so nothing here will survive a restart. Check DATA_DIR and the '
        + 'attached volume.',
    });
  }
});

// ---------- direct messages ----------
// Discord ids are never sent to the browser: the client names one of our own
// player ids and the server resolves it, so a page cannot be used to harvest
// Discord accounts even by an operator's own browser extension.
app.post('/api/admin/dm', (req, res) => {
  void (async () => {
    const me = requireAdmin(req, res);
    if (!me) return;
    try {
      const b = req.body ?? {};
      const message = String(b.message ?? '');
      const row = playerRows().find(p => p.id === String(b.playerId ?? ''));
      if (!row) throw new Error('No such player');
      if (!row.discordVerifiedId) {
        throw new Error(`${row.name} has no verified Discord account to message`);
      }
      await sendDirectMessage(row.discordVerifiedId, message);
      res.json({ ok: true, name: row.name });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not send' });
    }
  })();
});

// ---------- bans ----------
// Two kinds: the account (which also covers its verified Discord id) and the
// address. Banning does not wait for the next login — anyone caught by it is
// taken out of whatever they are playing right now.
app.get('/api/admin/bans', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ bans: listBans() });
});

function banKind(v: unknown): BanKind {
  if (v !== 'player' && v !== 'ip') throw new Error('ban kind must be player or ip');
  return v;
}

// Every live game, so the dashboard can offer "ban from this one".
app.get('/api/admin/bannable-games', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    games: [
      ...[...registry.tournaments.values()]
        .filter(t => t.state !== 'finished' && t.state !== 'cancelled')
        .map(t => ({ id: t.id, name: t.config.name, kind: 'tournament' as const })),
      ...[...registry.cashTables.values()]
        .filter(t => !t.closed)
        .map(t => ({ id: t.id, name: t.name, kind: 'cash' as const })),
    ],
  });
});

app.post('/api/admin/bans', (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  try {
    const b = req.body ?? {};
    const kind = banKind(b.kind);
    const scope: BanScope = b.scope === 'game' ? 'game' : 'lifetime';
    const gameId = scope === 'game' ? String(b.gameId ?? '').trim() : null;
    // Name the game from the server's own records rather than trusting the
    // label the client sent.
    const liveName = gameId
      ? (registry.tournaments.get(gameId)?.config.name ?? registry.cashTables.get(gameId)?.name ?? '')
      : '';
    if (scope === 'game' && !liveName) throw new Error('That game is not running');
    // An IP ban can name the player instead of the address: the operator sees
    // a cheat at a table, not an IP, and should not have to go and look it up.
    let value = String(b.value ?? '');
    if (kind === 'ip' && !value.trim() && b.playerId) {
      const row = playerRows().find(p => p.id === String(b.playerId));
      value = row?.ips.at(-1) ?? '';
      if (!value) throw new Error('No address on record for that player yet');
    }
    const ban = addBan({
      kind, scope, gameId, gameName: liveName,
      value,
      name: String(b.name ?? ''),
      reason: String(b.reason ?? ''),
      by: me.name,
    });

    // Who to remove: a player ban names them, an IP ban has to look them up.
    const targets = kind === 'player'
      ? [ban.value]
      : playerRows()
        .filter(p => p.ips.some(ip => normaliseIp(ip) === normaliseIp(ban.value)))
        .map(p => p.id);

    let ejected = { tournaments: 0, tables: 0 };
    for (const pid of targets) {
      // A lifetime ban clears them out everywhere; a game ban only out of the
      // game it names — they keep the rest of the site.
      const r = ban.scope === 'game' && ban.gameId
        ? registry.ejectFromGame(ban.gameId, pid)
        : registry.ejectPlayer(pid);
      ejected = { tournaments: ejected.tournaments + r.tournaments, tables: ejected.tables + r.tables };
    }
    // A lifetime ban also cuts live connections; a game ban must not, or it
    // would knock someone off the whole site over one event.
    const disconnected = ban.scope === 'lifetime' ? disconnectBanned() : 0;
    res.json({ ban, ejected, disconnected });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not ban' });
  }
});

app.delete('/api/admin/bans/:kind/:value', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const scope: BanScope = req.query.scope === 'game' ? 'game' : 'lifetime';
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : null;
    const gone = removeBan(banKind(req.params.kind), String(req.params.value), scope, gameId);
    if (!gone) { res.status(404).json({ error: 'No such ban' }); return; }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
});

// ---------- operator game management ----------
// Every live game with enough detail to decide whether to end it.
app.get('/api/admin/games', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    tournaments: [...registry.tournaments.values()].map(t => ({
      id: t.id, name: t.config.name, state: t.state,
      players: t.players.size,
      alive: t.standings().filter(s => !s.busted).length,
      level: t.level.level,
      createdAt: t.createdAt,
      startedAt: t.startedAt ?? null,
    })),
    cashTables: [...registry.cashTables.values()].map(t => ({
      id: t.id, name: t.name, sb: t.sb, bb: t.bb,
      players: t.seatedCount(), maxSeats: t.maxSeats,
      hands: t.handNumber, closed: t.closed,
      createdAt: t.createdAt,
    })),
  });
});

function gameKind(v: unknown): 'cash' | 'tournament' {
  if (v !== 'cash' && v !== 'tournament') throw new Error('unknown game type');
  return v;
}

app.post('/api/admin/games/:kind/:id/stop', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    registry.stopGame(gameKind(req.params.kind), String(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not stop it' });
  }
});

app.delete('/api/admin/games/:kind/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = String(req.params.id);
    registry.deleteGame(gameKind(req.params.kind), id);
    // Bans that only applied to this game have nothing left to apply to.
    removeGameBans(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not delete it' });
  }
});

// Finished games, with their final detail. Deleting one here is also what
// releases its name for reuse.
app.get('/api/admin/archive', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ tournaments: allRecords(), cash: allCashRecords() });
});

app.delete('/api/admin/archive/:kind/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id);
  let gone = false;
  try {
    gone = gameKind(req.params.kind) === 'cash' ? removeCashRecord(id) : removeRecord(id);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
    return;
  }
  if (!gone) { res.status(404).json({ error: 'No such record' }); return; }
  res.json({ ok: true });
});

// The operator's chat switch: off refuses every send server-side.
app.put('/api/admin/chat', (req, res) => {
  if (!requireAdmin(req, res)) return;
  setChatEnabled((req.body ?? {}).enabled !== false);
  res.json({ enabled: chatEnabled() });
});
app.get('/api/admin/chat', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ enabled: chatEnabled() });
});

// What a game actually did, as plain text the operator can read or hand to
// someone else. This is the record that did not exist for the first live
// event: the running commentary was overwritten in memory during the event,
// and the engine writes almost nothing to the platform's console.
app.get('/api/admin/events', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ games: loggedGames() });
});

app.get('/api/admin/events/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id);
  const events = eventsForGame(id);
  if (events.length === 0) {
    res.status(404).type('text/plain').send(`No events logged for ${id}.`);
    return;
  }
  const when = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  const started = events[0].ts;
  const mins = (ts: number) => `${String(Math.floor((ts - started) / 60_000)).padStart(4)}m`;
  // Counts first, so the shape of the event is readable without reading
  // every line of it.
  const count = (re: RegExp) => events.filter(e => re.test(e.text)).length;
  const L: string[] = [];
  L.push(`EVENT LOG — ${events[0].gameName}`);
  L.push(`game ${id} · ${events.length} events · ${when(started)} to ${when(events[events.length - 1].ts)} UTC`);
  L.push('');
  L.push('SUMMARY');
  L.push(`  players registered: ${count(/ registered \(/)}`);
  L.push(`  removed for inactivity: ${count(/ was removed /)}`);
  L.push(`  moved to balance tables: ${count(/ to balance tables$/)}`);
  L.push(`  tables broken: ${count(/^Breaking /)}`);
  L.push(`  blind levels reached: ${count(/^Level \d/)}`);
  L.push(`  players eliminated: ${count(/ eliminated in /)}`);
  L.push('');
  L.push('TIMELINE  (minutes from the first event)');
  for (const e of events) L.push(`  ${mins(e.ts)}  ${e.text}`);
  res.type('text/plain').send(L.join('\n'));
});

// Repair a finished tournament's finishing places (see store.ts for why).
// Dry-run by default: shows before/after and writes nothing until {commit:true}.
app.post('/api/admin/results/:id/repair-places', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const b = req.body ?? {};
  const out = repairTournamentPlaces(
    String(req.params.id), String(b.winnerId ?? ''), b.commit === true);
  res.status(out.ok ? 200 : 400).json(out);
});

// A game's name has to be given, and has to be free. Names are matched
// loosely — case and spacing ignored — because "Sunday Major" and "sunday
// major" are the same tournament to everyone reading the lobby.
const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function requireFreeName(raw: unknown, what: 'table' | 'tournament'): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
  if (!name) throw new Error(`Give the ${what} a name.`);
  const key = nameKey(name);
  // Quote the existing game's spelling, not the one just typed — that is the
  // name the operator will be looking for on the dashboard.
  const live = registry.liveNames().find(g => nameKey(g.name) === key);
  if (live) {
    throw new Error(live.over
      ? `"${live.name}" is still on the dashboard. Pick another name, or delete it from Manage games.`
      : `A live game is already called "${live.name}". Pick another name, or end that one first.`);
  }
  const past = archivedNames().find(n => nameKey(n) === key);
  if (past) {
    throw new Error(
      `"${past}" was used by a past game. Pick another name, or delete that game from Past games on the dashboard.`,
    );
  }
  return name;
}

// An old tournament link: if the live game is gone, serve its final results.
app.get('/api/results/:id', (req, res) => {
  const rec = findRecord(String(req.params.id));
  if (!rec) { res.status(404).json({ error: 'No record for that tournament' }); return; }
  res.json({ record: rec });
});

app.post('/api/tournaments', (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  try {
    const b = req.body ?? {};
    const config: TournamentConfig = {
      name: requireFreeName(b.name, 'tournament'),
      startingStack: clampInt(b.startingStack, 100, 100_000_000, 10_000),
      levelMinutes: clampInt(b.levelMinutes, 1, 60, 8),
      structure: ['turbo', 'regular', 'deep'].includes(b.structure) ? b.structure : 'regular',
      maxPlayers: clampInt(b.maxPlayers, 2, 1_000, 500),
      minPlayers: clampInt(b.minPlayers, 2, 100, 2),
      lateRegMinutes: clampInt(b.lateRegMinutes, 0, 240, 15),
      joinMinutes: clampInt(b.joinMinutes, 1, 240, 15),
      approveRegistrations: !!b.approveRegistrations,
      buyIn: 0, // no in-site currency — prizes are described in prizeText
      prizeText: typeof b.prizeText === 'string' && b.prizeText.trim()
        ? b.prizeText.trim().slice(0, 500) : null,
      breakEveryLevels: clampInt(b.breakEveryLevels, 0, 20, 6),
      seatsPerTable: clampInt(b.seatsPerTable, 2, 9, 9),
      social: parseSocial(b.social),
      maxReentries: clampInt(b.maxReentries, 0, 10, 0),
      rabbitHunting: !!b.rabbitHunting,
      displayMode: b.displayMode === 'bb' ? 'bb' : 'chips',
      customLevels: parseCustomLevels(b.customLevels),
      actionSeconds: clampInt(b.actionSeconds, 5, 120, 20),
      timebankSeconds: clampInt(b.timebankSeconds, 0, 120, 0),
      theme: sanitizeTheme(b.theme),
    };
    let scheduledStart: number | null = null;
    if (b.scheduledStart) {
      const ts = Number(b.scheduledStart);
      if (Number.isFinite(ts) && ts > Date.now()) scheduledStart = ts;
    }
    const webhook = sanitizeWebhook(b.discordWebhookUrl);
    const t = registry.createTournament(config, { id: me.id, name: me.name }, scheduledStart, webhook);
    res.json({ id: t.id });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
});

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function sanitizeUrl(v: unknown, hosts: string[]): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:') return null;
    if (hosts.length && !hosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) return null;
    return u.toString().slice(0, 200);
  } catch {
    return null;
  }
}

function sanitizeWebhook(v: unknown): string | null {
  const url = sanitizeUrl(v, ['discord.com', 'discordapp.com']);
  if (!url || !/\/api\/webhooks\//.test(url)) return null;
  return url;
}

function parseSocial(v: unknown): SocialRequirements | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  const social: SocialRequirements = {
    xUrl: sanitizeUrl(b.xUrl, ['x.com', 'twitter.com']),
    igUrl: sanitizeUrl(b.igUrl, ['instagram.com']),
    discordInviteUrl: sanitizeUrl(b.discordInviteUrl, ['discord.gg', 'discord.com']),
    discordGuildId: typeof b.discordGuildId === 'string' && /^\d{5,25}$/.test(b.discordGuildId.trim())
      ? b.discordGuildId.trim() : null,
    discordRoleId: typeof b.discordRoleId === 'string' && /^\d{5,25}$/.test(b.discordRoleId.trim())
      ? b.discordRoleId.trim() : null,
    discordRoleName: typeof b.discordRoleName === 'string' && b.discordRoleName.trim()
      ? b.discordRoleName.trim().slice(0, 48) : null,
    requireDiscord: !!b.requireDiscord,
  };
  // A role requirement only makes sense with a guild + linked Discord.
  if (social.discordRoleId && !social.discordGuildId) social.discordRoleId = null;
  if (social.discordRoleId) social.requireDiscord = true;
  const any = social.xUrl || social.igUrl || social.discordInviteUrl || social.requireDiscord;
  return any ? social : null;
}

// ---------- static client (production build) ----------
const clientDist = join(__dir, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  // Hashed assets can cache forever; index.html must always revalidate or
  // phones keep running last week's app after a deploy.
  app.use(express.static(clientDist, {
    index: false,
    setHeaders: (res, path) => {
      if (path.includes(`${sep}assets${sep}`)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      } else if (path.includes(`${sep}reactions${sep}`)) {
        // Animated emoji are hundreds of KB each and never change in place.
        res.setHeader('cache-control', 'public, max-age=604800');
      } else {
        res.setHeader('cache-control', 'no-cache');
      }
    },
  }));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'), {
      headers: { 'cache-control': 'no-cache' },
    });
  });
}

httpServer.listen(PORT, () => {
  console.log(`${BRAND.name} server listening on http://localhost:${PORT}`);
  // After the address, before anyone can reach it: what this deployment is
  // actually configured as. See startupcheck.ts for why it is printed rather
  // than merely available.
  printStartupReport();
  if (demoMode()) {
    console.warn('DEMO MODE — anyone with the address can sign in without Discord.');
    console.warn('Unset DEMO_MODE before this room runs a real event.');
  }
  // Resolve the verify channel's name so sign-in can name it exactly.
  void primeVerifyChannel();
  if (existsSync(clientDist)) console.log('Serving built client from client/dist');
  else console.log('Client dev server: run `npm run dev -w client` (http://localhost:5173)');
});

// Graceful shutdown: flush results, close sockets cleanly.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down`);
  snapshotLive(); // live games survive the restart
  saveAudit();
  saveResults();
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
