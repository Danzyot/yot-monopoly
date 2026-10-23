// Sign-in: "Sign in with Discord" (OAuth), "Verify with a code" (the bot's
// Verify button or a verify channel), and demo sign-in when DEMO_MODE=1.
import express from 'express';
import {
  demoMode, makeDemoProfile, makeDiscordProfile, signState, signToken, verifyState,
} from '../auth.ts';
import { banMessage, findBan } from '../bans.ts';
import { canHost } from '../hosting.ts';
import { authorizeUrl, completeOAuth, discordEnabled, redirectUriFor } from '../discord.ts';
import { handleInteraction, interactionsConfigured, validSignature } from '../interactions.ts';
import { answerLiveCommand, type CommandInteraction } from '../discordCommands.ts';
import { codeStatus, startCode } from '../verifycode.ts';
import { getAccount } from '../connections.ts';
import { isOn } from '../features.ts';
import { setChosenName, withChosenName } from '../displayNames.ts';
import { authed, fail, rateLimit, requestBase } from '../http.ts';

/** An account first seen this recently (or not yet at all) gets the welcome tour. */
export const NEW_PLAYER_MS = 3 * 24 * 3_600_000;

/** Must be mounted BEFORE express.json(): Discord signs the raw body. */
export function mountInteractions(app: express.Express) {
  app.post('/api/discord/interactions', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
    const sig = req.headers['x-signature-ed25519'] as string | undefined;
    const ts = req.headers['x-signature-timestamp'] as string | undefined;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    // Discord probes with a deliberately bad signature and requires a 401.
    if (!publicKey || !sig || !ts || !validSignature(publicKey, sig, ts, raw)) {
      res.status(401).json({ error: 'bad signature' });
      return;
    }
    let body: unknown;
    try { body = JSON.parse(raw.toString('utf8')); } catch { res.status(400).json({ error: 'bad body' }); return; }
    // Slash commands (type 2): discordCommands.ts, deferred when slow.
    if ((body as { type?: unknown } | null)?.type === 2) {
      try {
        res.json(await answerLiveCommand(body as CommandInteraction));
      } catch (e) {
        console.error('[discord] command failed:', e);
        res.json({ type: 4, data: { content: 'Something went wrong on our side. Try again in a moment.', flags: 64 } });
      }
      return;
    }
    const out = handleInteraction(body as Parameters<typeof handleInteraction>[0]);
    if (out) { res.status(out.status).json(out.body); return; }
    res.json({ type: 4, data: { content: 'Unsupported interaction.', flags: 64 } });
  });

  // Open in a browser to see which Discord setting is missing.
  app.get('/api/discord/interactions', (req, res) => {
    const key = process.env.DISCORD_PUBLIC_KEY?.trim() ?? '';
    const ok = /^[0-9a-fA-F]{64}$/.test(key);
    res.json({
      readyForDiscord: ok,
      thisUrl: `${requestBase(req)}/api/discord/interactions`,
      publicKeyConfigured: interactionsConfigured(),
      publicKeyPreview: key ? `${key.slice(0, 8)}…${key.slice(-8)}` : null,
      problem: ok ? null : key
        ? `DISCORD_PUBLIC_KEY should be 64 hex characters (got ${key.length}) — copy the Public Key, not the app id or a token.`
        : 'DISCORD_PUBLIC_KEY is not set (Developer Portal → your app → General Information → Public Key).',
    });
  });
}

/**
 * Where sign-in may send a player back to: a path on this site, never anywhere else. Browsers read
 * `/\\host` and `//host` as another site, so the check is "resolves to our own origin", not a prefix
 * test; backslashes and control characters are refused outright.
 */
/**
 * POKER_ORIGINS: comma-separated https origins of poker besides POKER_URL
 * (its Railway domain, an old domain) that /sso may send a sign-in back to.
 */
export function pokerOrigins(raw = process.env.POKER_ORIGINS ?? ''): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    try {
      const u = new URL(part.trim());
      if (u.protocol === 'https:' && !u.username && !u.password) out.push(u.origin);
    } catch { /* not an address: skip */ }
  }
  return out;
}

export function localPath(raw: unknown): string {
  const ret = typeof raw === 'string' ? raw : '';
  if (!ret.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(ret)) return '/';
  try {
    const u = new URL(ret, 'https://local.invalid');
    return u.origin === 'https://local.invalid' ? `${u.pathname}${u.search}` : '/';
  } catch {
    return '/';
  }
}

export function authRoutes(): express.Router {
  const r = express.Router();

  r.get('/discord/start', (req, res) => {
    if (!discordEnabled()) { res.status(400).send('Discord sign-in is not configured'); return; }
    const ret = String(req.query.return ?? '/');
    const state = signState({ return: localPath(ret) });
    res.redirect(authorizeUrl(state, redirectUriFor(requestBase(req))));
  });

  // Open on the failing domain: says exactly which redirect to register.
  r.get('/discord/check', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim() ?? '';
    const problems: string[] = [];
    if (!clientId) problems.push('DISCORD_CLIENT_ID is not set.');
    else if (!/^\d{17,20}$/.test(clientId)) problems.push('DISCORD_CLIENT_ID is not an application id (17–20 digits).');
    if (!process.env.DISCORD_CLIENT_SECRET?.trim()) problems.push('DISCORD_CLIENT_SECRET is not set.');
    res.json({
      registerThisRedirectUri: redirectUriFor(requestBase(req)),
      readyToTry: problems.length === 0,
      clientId: clientId || null,
      botTokenConfigured: !!process.env.DISCORD_BOT_TOKEN?.trim(),
      problems,
    });
  });

  r.get('/discord/callback', async (req, res) => {
    // Back to the page sign-in started on (/monopoly, /cards, a room…), whether it worked or not.
    const state = verifyState(String(req.query.state ?? ''));
    const ret = state ? localPath(state.return) : '/';
    try {
      if (!state) throw new Error('That sign-in link expired — press Sign in again');
      if (req.query.error) throw new Error('Discord sign-in was cancelled');
      const d = await completeOAuth(String(req.query.code ?? ''), redirectUriFor(requestBase(req)));
      const profile = withChosenName(makeDiscordProfile(d));
      const ban = findBan({ id: profile.id, discordId: d.id, ip: req.ip });
      if (ban) throw new Error(banMessage(ban));
      res.redirect(`${ret}#dtoken=${encodeURIComponent(signToken(profile))}`);
    } catch (e) {
      res.redirect(`${ret}#derror=${encodeURIComponent(e instanceof Error ? e.message : 'Discord sign-in failed')}`);
    }
  });

  r.post('/code/start', (_req, res) => {
    if (!isOn('codeVerify')) { res.status(404).json({ error: 'Verify with a code is switched off. Sign in with Discord instead.' }); return; }
    try { res.json(startCode()); } catch (e) { fail(res, e); }
  });

  r.get('/code/status', (req, res) => {
    if (!isOn('codeVerify')) { res.status(404).json({ error: 'Verify with a code is switched off. Sign in with Discord instead.' }); return; }
    const { pending, resolution } = codeStatus(String(req.query.code ?? ''));
    if (!resolution) { res.json({ pending }); return; }
    const profile = withChosenName(makeDiscordProfile(resolution));
    const ban = findBan({ id: profile.id, discordId: resolution.id, ip: req.ip });
    if (ban) { res.status(403).json({ error: banMessage(ban) }); return; }
    res.json({ pending: false, token: signToken(profile), profile });
  });

  r.post('/demo', (req, res) => {
    if (!demoMode()) { res.status(404).json({ error: 'Not found' }); return; }
    try {
      const ban = findBan({ ip: req.ip });
      if (ban) { res.status(403).json({ error: banMessage(ban) }); return; }
      const profile = makeDemoProfile(String(req.body?.name ?? ''));
      res.json({ token: signToken(profile), profile });
    } catch (e) { fail(res, e); }
  });

  r.get('/me', (req, res) => {
    const p = authed(req);
    if (!p) { res.status(401).json({ error: 'Not signed in' }); return; }
    const ban = findBan({ id: p.id, discordId: p.discord?.id, ip: req.ip });
    if (ban) { res.status(403).json({ error: banMessage(ban) }); return; }
    // Whether this player may host on Poker (operator, Chog holder or approved host),
    // and whether they are new here (the client shows the welcome tour once).
    const seen = getAccount(p.id)?.firstSeen;
    res.json({ profile: p, canHost: canHost(p.id), newPlayer: seen === undefined || Date.now() - seen < NEW_PLAYER_MS });
  });

  // Choose the name to play under (the welcome tour). Answers a fresh session
  // token carrying it; the next Discord sign-in keeps it too.
  r.post('/name', rateLimit(10, 60 * 60_000), (req, res) => {
    const p = authed(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return; }
    const ban = findBan({ id: p.id, discordId: p.discord?.id, ip: req.ip });
    if (ban) { res.status(403).json({ error: banMessage(ban) }); return; }
    try {
      const profile = { ...p, name: setChosenName(p.id, req.body?.name) };
      res.json({ token: signToken(profile), profile });
    } catch (e) { fail(res, e); }
  });

  return r;
}
