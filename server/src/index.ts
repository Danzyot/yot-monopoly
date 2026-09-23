import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { adminModeConfigured, demoMode } from './auth.ts';
import { loadBans } from './bans.ts';
import { loadMutes } from './chat.ts';
import { loadAccounts } from './connections.ts';
import { defaultInviteUrl, discordEnabled } from './discord.ts';
import { loadEvents } from './eventlog.ts';
import { getFeatures, isOn, loadFeatures } from './features.ts';
import { rateLimit } from './http.ts';
import { trustedProxyHops } from './ip.ts';
import { armPersistence, restoreLive } from './persist.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes, mountInteractions } from './routes/auth.ts';
import { mountMusic } from './routes/music.ts';
import { attachSockets } from './sockets.ts';
import { leaderboard, loadResults } from './stats.ts';
import { buttonFlowAvailable, codeVerifyAvailable, primeVerifyChannel, verifyChannelName } from './verifycode.ts';
import type { SiteConfig } from '../../shared/types.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

loadFeatures();
loadBans();
loadMutes();
loadAccounts();
loadEvents();
loadResults();
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
  requestTimeout: 30_000,
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
});
const sockets = attachSockets(io);

const restored = restoreLive(sockets.registry);
if (restored) console.log(`Restored ${restored} live room(s) from the last snapshot`);
armPersistence(sockets.registry);

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
  };
  res.json(cfg);
});

app.use('/api/auth', authRoutes());
app.use('/api/admin', adminRoutes(sockets, () => loopLagMs));
mountMusic(app);

app.get('/api/leaderboard', (_req, res) => {
  if (!isOn('leaderboard')) { res.status(404).json({ error: 'The leaderboard is switched off' }); return; }
  res.json(leaderboard(100));
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: sockets.registry.rooms.size,
    sockets: sockets.connectedCount(),
    uptime: Math.round(process.uptime()),
    loopLagMs,
    persistentDisk: !!process.env.DATA_DIR,
  });
});

app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

// In production the server also serves the built client.
const dist = join(__dir, '../../client/dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

http.listen(PORT, () => {
  console.log(`Yot Monopoly server on :${PORT}`);
  if (demoMode()) console.warn('⚠️  DEMO_MODE=1 — anyone can sign in with just a name. Turn it off for real events.');
  if (!discordEnabled() && !demoMode()) console.warn('⚠️  No Discord app configured and DEMO_MODE is off — nobody can sign in.');
  if (!adminModeConfigured()) console.warn('⚠️  ADMIN_DISCORD_IDS is unset — every signed-in account is an operator.');
  if (!process.env.DATA_DIR) console.warn('⚠️  DATA_DIR is unset — bans, results and live games are stored in server/data (lost on redeploy without a volume).');
});
