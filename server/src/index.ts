import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { adminModeConfigured, demoMode, isProduction } from './auth.ts';
import { loadBans } from './bans.ts';
import { loadMutes } from './chat.ts';
import { loadAccounts } from './connections.ts';
import { loadDisplayNames } from './displayNames.ts';
import { defaultInviteUrl, discordEnabled } from './discord.ts';
import { loadEvents } from './eventlog.ts';
import { getFeatures, isOn, loadFeatures } from './features.ts';
import { loadGraphics } from './graphics.ts';
import { authed, rateLimit, requireAdmin } from './http.ts';
import { clientIp, trustedProxyHops } from './ip.ts';
import { hopCountHealth, ipSamples } from './ipdebug.ts';
import { armPersistence, restoreLive } from './persist.ts';
import { adminRoutes } from './routes/admin.ts';
import { analyticsRoutes, onlinePlayers } from './routes/analytics.ts';
import { createLiveSampler } from './liveSamples.ts';
import { createVisitCounter } from './visits.ts';
import { authRoutes, mountInteractions, pokerOrigins } from './routes/auth.ts';
import { mountFriends } from './routes/friends.ts';
import { configureErase } from './erase.ts';
import { mountMusic } from './routes/music.ts';
import { mountGraphics } from './routes/graphics.ts';
import { mountTextOverrides } from './routes/textOverrides.ts';
import { mountContent } from './routes/content.ts';
import { mountCardsProfile } from './routes/cardsProfile.ts';
import { mountCardsDaily } from './routes/cardsDaily.ts';
import { mountPlayerCard } from './routes/playerCard.ts';
import { cardPath, configurePlayerCards, playerBanned, playerSnapshot, profileMeta } from './playerCard.ts';
import { commandDefinitions, configureSlashCommands, dailyAvailable } from './discordCommands.ts';
import { configureCommandDefinitions, syncCommands } from './discordRegister.ts';
import { walletRoutes } from './routes/wallet.ts';
import { holdsChog } from './wallet/holders.ts';
import { hostingRoutes } from './routes/hosting.ts';
import { mountHostingChogs } from './routes/hostingChogs.ts';
import { attachSockets } from './sockets.ts';
import { attachCardsSockets } from './cards/sockets.ts';
import { armCardsPersistence, restoreCardsLive } from './cards/persist.ts';
import { attachTournaments } from './tournament/sockets.ts';
import { cardsLeaderboard, loadCardsResults, recentCardsResults } from './cards/stats.ts';
import { cardsDailyInfo, loadCardsDaily, reconcileCardsDaily } from './cards/daily.ts';
import { dailyDate } from '../../shared/cards/daily.ts';
import { staticClient } from './staticFiles.ts';
import { mountCrawlerFiles, siteOrigin, spaHandler } from './seo.ts';
import { mountSite } from './routes/site.ts';
import { activitySources, mountActivity } from './routes/activity.ts';
import { mountChogs } from './routes/chogs.ts';
import { allResults, leaderboard, loadResults } from './stats.ts';
import { buildProfile } from './profiles.ts';
import { devFakeDiscord, gateInfo } from './requirements.ts';
import { buttonFlowAvailable, codeVerifyAvailable, primeVerifyChannel, verifyChannelName } from './verifycode.ts';
import type { SiteConfig } from '../../shared/types.ts';
import { BRAND } from '../../shared/brand.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

// Last line of defence. Room timers guard themselves (rooms.ts), but one stray
// bug anywhere must not end every game on the server: log it and keep going.
process.on('uncaughtException', e => console.error('Uncaught exception (still running):', e));
process.on('unhandledRejection', e => console.error('Unhandled rejection (still running):', e));

loadFeatures();
loadBans();
loadMutes();
loadAccounts();
loadDisplayNames();
loadEvents();
loadResults();
loadCardsResults();
loadCardsDaily();
loadGraphics();
void primeVerifyChannel();

const app = express();
app.disable('x-powered-by');
// Must match ip.ts so HTTP and sockets agree on who someone is.
app.set('trust proxy', trustedProxyHops());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Discord signs the raw body, so this goes in before the JSON parser.
mountInteractions(app);
app.use(express.json({ limit: '64kb' }));

app.use('/api', rateLimit(600, 60_000));
app.use('/api/auth', rateLimit(40, 60_000));
app.use('/api', (_req, res, next) => {
  res.setHeader('cache-control', 'no-store, max-age=0');
  next();
});

// Slowloris guards: bounded header/request times, checked often.
const http = createServer({
  headersTimeout: 10_000,
  // Long enough for a 40 MB music upload on a slow line; slow-header attacks
  // are still cut off by headersTimeout.
  requestTimeout: 5 * 60_000,
  keepAliveTimeout: 8_000,
  connectionsCheckingInterval: 2_000,
}, app);
http.maxHeadersCount = 100;
const io = new Server(http, {
  cors: { origin: false },
  pingInterval: 10_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 32_000,
  connectTimeout: 10_000,
  // room:state is repetitive JSON (the log, players, seats): deflate shrinks it
  // ~4.5×, which matters on phones and with a crowd watching. Small messages
  // (acks, chat, reactions) go as they are. A small window and fast level keep
  // each socket's zlib state to ~64 KB and the CPU cost to tens of µs.
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: { level: 1, memLevel: 6 },
    serverMaxWindowBits: 13,
    clientMaxWindowBits: 13,
  },
});
const sockets = attachSockets(io);

// Operator renames first, so restored games resolve their board with them.
mountContent(app);
const restored = restoreLive(sockets.registry);
if (restored) console.log(`Restored ${restored} live room(s) from the last snapshot`);
armPersistence(sockets.registry);
// Chog Cards tables: their own registry and events (cards:*), same server and sign-in.
// Holders sit at card tables as their own Chogs too, checked against the same wallet store.
const cards = attachCardsSockets(io, { taken: code => !!sockets.registry.get(code), holdsChog });
sockets.registry.taken = code => !!cards.registry.get(code);
const restoredCards = restoreCardsLive(cards.registry);
if (restoredCards) console.log(`Restored ${restoredCards} live card table(s) from the last snapshot`);
armCardsPersistence(cards.registry);
// Daily attempts whose tables did not come back are walk-outs (losses).
reconcileCardsDaily(cards.registry);
// Tournaments (Cards only) seat their tables in the Cards registry, so they come back after it.
const tourneys = attachTournaments(io, { monopoly: sockets, cards });
const restoredTourneys = tourneys.manager.restore();
if (restoredTourneys) console.log(`Restored ${restoredTourneys} live tournament(s)`);
// Recurring schedules after the events they made, so none is made twice.
const restoredSchedules = tourneys.scheduler.restore();
if (restoredSchedules) console.log(`Restored ${restoredSchedules} running tournament schedule(s)`);
tourneys.manager.armPersistence();

// The Analytics tab's two aggregate counters (counts only, 90 days): peak
// connections sampled every few minutes, and page loads per page per day.
const liveSamples = createLiveSampler({ read: () => ({ sockets: sockets.connectedCount(), players: onlinePlayers(sockets) }) });
liveSamples.start();
const visits = createVisitCounter();

let loopLagMs = 0;
{
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    loopLagMs = Math.max(0, now - last - 1000);
    last = now;
  }, 1000).unref();
}

app.get('/api/config', (_req, res) => {
  const cfg: SiteConfig = {
    discordEnabled: discordEnabled(),
    demoMode: demoMode(),
    adminMode: adminModeConfigured(),
    codeVerify: codeVerifyAvailable(),
    codeVerifyChannel: verifyChannelName(),
    codeVerifyButton: buttonFlowAvailable(),
    inviteUrl: defaultInviteUrl(),
    features: getFeatures(),
    pokerOrigins: pokerOrigins(),
  };
  res.json(cfg);
});

app.use('/api/auth', authRoutes());
app.use('/api/admin/analytics', analyticsRoutes({ sockets, cards, tournaments: tourneys.manager, samples: liveSamples, visits }));
// What the proxies in front actually send, and whether TRUSTED_PROXY_HOPS reads it right (operators only).
app.get('/api/admin/ipdebug', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    you: {
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      realIp: req.headers['x-real-ip'] ?? null,
      envoyExternal: req.headers['x-envoy-external-address'] ?? null,
      cfConnecting: req.headers['cf-connecting-ip'] ?? null,
      expressIp: req.ip ?? null,
      resolved: clientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress ?? null, req.headers),
      socketPeer: req.socket.remoteAddress ?? null,
    },
    trustedProxyHops: trustedProxyHops(),
    hopCount: hopCountHealth(),
    recent: ipSamples(),
  });
});
app.use('/api/admin', adminRoutes(sockets, () => loopLagMs));
app.use('/api/wallet', walletRoutes());
// Chog Poker asks which Chogs a player holds (signed, server to server).
mountHostingChogs(app);
// Poker asks here (signed) whether a player may host; see routes/hosting.ts.
app.use('/api/hosting', hostingRoutes());
mountMusic(app);
mountGraphics(app, sockets);
mountTextOverrides(app);
// The info pages (/terms, /privacy, /fair-play) and the app's crash reports.
mountSite(app);
// The home page's live ticker: recent wins, tables starting, champions (public, cached 10 s).
mountActivity(app, { monopoly: sockets.registry, cards: cards.registry, tournaments: tourneys.manager });
// One token's traits for the home page's Chog of the Day (the page does not ship the trait table).
mountChogs(app);
// Friends: requests, who is online and where, invites to your table.
const friends = mountFriends(app, io, { monopoly: sockets.registry, cards: cards.registry });
// Deleting a player's data from the dashboard (erase.ts) reaches every store above.
configureErase({
  seatedAt: id => [
    ...sockets.registry.roomsOf(id).filter(r => r.status !== 'finished').map(r => `Monopoly ${r.code}`),
    ...[...cards.registry.rooms.values()].filter(r => r.status !== 'finished' && r.seats.some(s => s.id === id)).map(r => `Cards ${r.code}`),
  ],
  tournaments: tourneys.manager,
  friends: friends.store,
  friendsChanged: ids => friends.changed(...ids),
});

app.get('/api/leaderboard', (_req, res) => {
  if (!isOn('leaderboard')) { res.status(404).json({ error: 'The leaderboard is switched off' }); return; }
  res.json(leaderboard(100));
});

app.get('/api/cards/leaderboard', (_req, res) => {
  if (!isOn('leaderboard')) { res.status(404).json({ error: 'The leaderboard is switched off' }); return; }
  res.json({ leaders: cardsLeaderboard(50), recent: recentCardsResults(10) });
});

// Public profiles ride on the leaderboard switch: both publish players' results.
app.get('/api/players/:id', (req, res) => {
  if (!isOn('leaderboard')) { res.status(404).json({ error: 'Player profiles are switched off' }); return; }
  // An unknown player is an ordinary answer ({ profile: null }), not an error:
  // a shared link to someone with no finished games is expected, and the page
  // explains it rather than the console logging a failed request.
  res.json({ profile: buildProfile(String(req.params.id), allResults()) });
});
// ...and the Cards half (/api/players/:id/cards).
mountCardsProfile(app);
// The Cards Daily Challenge: today's deal, its leaderboard and the days before.
mountCardsDaily(app, cards.registry);
// Badges (/api/players/:id/achievements) and the share card (/api/players/:id/card.png).
configurePlayerCards({ tournamentsOf: id => tourneys.manager.resultsOf(id, 1000) });
mountPlayerCard(app);

// The bot's slash commands (discordCommands.ts), answered at /api/discord/interactions,
// read the same public stores as the pages above.
{
  const live = activitySources({ monopoly: sockets.registry, cards: cards.registry, tournaments: tourneys.manager });
  configureSlashCommands({
    origin: () => siteOrigin(),
    statsPublic: () => isOn('leaderboard'),
    banned: playerBanned,
    snapshot: playerSnapshot,
    cardPath,
    leaders: (game, n) => (game === 'cards' ? cardsLeaderboard(n) : leaderboard(n)),
    tables: game => [...(game === 'cards' ? live.cardsTables() : live.monopolyTables())],
    // Today's Cards Daily Challenge, as GET /api/cards/daily reads it (settled first, like there).
    daily: () => {
      const t = Date.now();
      reconcileCardsDaily(cards.registry, t);
      return cardsDailyInfo(dailyDate(t), { leaders: isOn('leaderboard'), now: t });
    },
    now: () => Date.now(),
  });
  configureCommandDefinitions(() => commandDefinitions({ statsPublic: isOn('leaderboard'), daily: dailyAvailable() }));
}

// What the lobby's Discord requirement picker can offer. Any signed-in player
// may host, so any signed-in player may ask; roles are cached (requirements.ts).
app.get('/api/community/discord', async (req, res) => {
  if (!authed(req)) { res.status(401).json({ error: 'Sign in first' }); return; }
  res.json(await gateInfo());
});

// Finished tournaments on a player's profile; public like the profile itself.
app.get('/api/tournaments/player/:id', (req, res) => {
  if (!isOn('leaderboard')) { res.status(404).json({ error: 'Player profiles are switched off' }); return; }
  res.json({ results: tourneys.manager.resultsOf(String(req.params.id)) });
});

// The soonest tournament to look forward to (the Cards page and the hub's Cards card).
app.get('/api/tournaments/next', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ next: tourneys.scheduler.next() });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: sockets.registry.rooms.size,
    cardTables: cards.registry.rooms.size,
    sockets: sockets.connectedCount(),
    uptime: Math.round(process.uptime()),
    loopLagMs,
    persistentDisk: !!process.env.DATA_DIR,
  });
});

app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

// In production the server also serves the built client.
// robots.txt and sitemap.xml, from shared/seo.ts's list of public pages.
mountCrawlerFiles(app);
const dist = join(__dir, '../../client/dist');
if (existsSync(dist)) {
  app.use(staticClient(dist));
  // Every page is index.html, with that page's title, description and share
  // tags written in (seo.ts), and status 404 where no page answers.
  // A profile's preview is the player's own card (playerCard.ts).
  // Page loads are counted on the way (visits.ts: counts only, no cookies).
  app.get(/^\/(?!api|socket\.io).*/, visits.middleware(), spaHandler(join(dist, 'index.html'), profileMeta));
}

// Failing to listen (port taken) is fatal: without this it would only be logged above.
http.on('error', e => {
  console.error('HTTP server error:', e);
  process.exit(1);
});
http.listen(PORT, () => {
  console.log(`${BRAND.name} server on :${PORT}`);
  if (demoMode()) console.warn('⚠️  DEMO_MODE=1 — anyone can sign in with just a name. Turn it off for real events.');
  if (devFakeDiscord()) console.warn('⚠️  DEV_FAKE_DISCORD=1 — Discord requirements use a fake server (demo names decide membership).');
  if (!discordEnabled() && !demoMode()) console.warn('⚠️  No Discord app configured and DEMO_MODE is off — nobody can sign in.');
  if (!adminModeConfigured()) {
    console.warn(isProduction()
      ? '⚠️  ADMIN_DISCORD_IDS is unset — nobody is an operator (NODE_ENV=production fails closed).'
      : '⚠️  ADMIN_DISCORD_IDS is unset — every signed-in account is an operator.');
  }
  if (!process.env.DATA_DIR) console.warn('⚠️  DATA_DIR is unset — bans, results and live games are stored in server/data (lost on redeploy without a volume).');
  // Slash commands: a bulk overwrite in the guild, skipped when Discord already has these ones.
  void syncCommands().then(s => {
    // Not configured is the norm on a dev machine; worth a line only where a bot exists.
    if (s.state === 'failed' || (s.state === 'not-configured' && process.env.DISCORD_BOT_TOKEN)) console.warn(`⚠️  Discord slash commands: ${s.message}`);
  });
});
