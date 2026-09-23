# Deploying Yot Monopoly

The server is one long-lived Node process — WebSockets plus in-memory game
state — so it needs a host that keeps it running. **Vercel/Netlify will not
work**, and neither will anything that sleeps when idle: a sleeping server ends
every game in progress.

Railway is the path below (~$5/month Hobby). Any always-on VPS with Docker
works the same way.

---

## What you need

| # | Thing | Notes |
|---|-------|-------|
| 1 | This repo on GitHub | Railway deploys from it |
| 2 | A Railway account (Hobby plan) | whoever owns the account owns the site |
| 3 | A Railway **volume** | bans, results, uploads and live games live here |
| 4 | A **Discord application** used only by this site | don't reuse another bot's app |
| 5 | A **bot** in that application, invited to your server | needed for "Verify with a code", DMs and announcements |
| 6 | A domain or subdomain (optional) | Railway's own `*.up.railway.app` works too |
| 7 | The Discord **user ids** of your operators | Discord → Settings → Advanced → Developer Mode → right-click a user → Copy User ID |

---

## 1. Create the service

Railway → **New Project** → **Deploy from GitHub repo** → this repo. It builds
from the `Dockerfile` automatically (`railway.toml` sets the health check to
`/api/health`).

## 2. Attach a volume — before the first real game

Service → **Volumes** → **New Volume**, mount path `/data`, then set the variable
`DATA_DIR=/data`. Without it every deploy wipes bans, results, the audit
history, uploaded music/graphics, the login secret and the live-game snapshot.
The dashboard's Overview tab warns you when no volume is attached.

## 3. Discord application

Discord Developer Portal → **New Application**.

1. **OAuth2** → copy the **Client ID** and **Client Secret**.
2. **OAuth2 → Redirects** → add `https://<your-domain>/api/auth/discord/callback`.
   Discord compares it as exact text: add one entry per domain players use
   (e.g. the railway.app one *and* your custom domain). Open
   `https://<your-domain>/api/auth/discord/check` — it prints the exact string
   to register for the domain you opened it on.
3. **Bot** → copy the **token**, and turn on **Server Members Intent**.
4. **General Information** → copy the **Public Key**.
5. After the service is deployed with `DISCORD_PUBLIC_KEY` set:
   **General Information → Interactions Endpoint URL** →
   `https://<your-domain>/api/discord/interactions`. Opening that URL in a
   browser explains in plain English what is missing if Discord refuses it.
6. Invite the bot to your server (OAuth2 → URL Generator → scopes `bot`,
   `applications.commands`; permissions: View Channels, Send Messages, Embed
   Links, Read Message History, Add Reactions).

## 4. Variables

| Variable | Needed? | Value |
|---|---|---|
| `DATA_DIR` | **yes** | `/data` (the volume mount) |
| `DISCORD_CLIENT_ID` | **yes** | Application ID |
| `DISCORD_CLIENT_SECRET` | **yes** | OAuth2 client secret (same app) |
| `ADMIN_DISCORD_IDS` | **yes** | comma-separated Discord user ids of operators. **Unset = everyone is an operator.** |
| `PUBLIC_URL` | recommended | `https://your-domain` (used in the Verify panel) |
| `DISCORD_BOT_TOKEN` | for code sign-in, DMs, announcements | bot token (same app) |
| `DISCORD_PUBLIC_KEY` | for the Verify button | Public Key (same app) |
| `DISCORD_VERIFY_CHANNEL_ID` | for code sign-in | channel where the Verify panel lives |
| `DISCORD_GUILD_ID` | optional | your server id |
| `DISCORD_INVITE_URL` | optional | shows a Discord link in the header |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | optional | the bot posts winners here (switch on "announceResults" in the dashboard) |
| `APP_SECRET` | optional | signs login tokens; if unset a random one is created on the volume |
| `TRUSTED_PROXY_HOPS` | if behind Cloudflare | `1` for Railway alone, `2` with Cloudflare in front |
| `DEMO_MODE` | never in production | `1` lets anyone sign in with just a name (for local dev and demos) |
| `MAX_SOCKETS_PER_IP` | optional | default 24 |

The two sign-in options players see:

- **Log in with Discord** — normal OAuth. Needs the client id/secret and the redirect.
- **Verify with a code** — the site shows a code like `MONO-AB12`; the player
  clicks **Verify** on the panel in your Discord and pastes it (needs
  `DISCORD_PUBLIC_KEY` + the interactions URL), or just posts it in the verify
  channel (needs the bot token + `DISCORD_VERIFY_CHANNEL_ID`). Post the panel
  from Dashboard → Discord.

## 5. Domain

Railway → Settings → Networking → **Custom Domain**, then add the CNAME it gives
you at your DNS provider. Register the new domain's redirect in Discord
(step 3.2) and set `PUBLIC_URL`.

If you put **Cloudflare** in front (recommended against floods: proxied DNS,
"Under Attack" mode when needed), set `TRUSTED_PROXY_HOPS=2` — otherwise the
site sees Cloudflare's address instead of the player's, and IP bans hit the
wrong people.

## 6. First run checklist

1. `GET /api/health` → `persistentDisk: true`.
2. Sign in with a Discord account listed in `ADMIN_DISCORD_IDS`; the header
   shows **Dashboard**.
3. Dashboard → Overview: no warnings.
4. Dashboard → Discord → post the Verify panel (if you use code sign-in).
5. Create a room, add a bot, play a few turns.

## Operating it

- **Deploy between games.** Live rooms are snapshotted every few seconds and on
  shutdown, and restored on boot — players reconnect to their seats and anyone
  who doesn't come back is auto-played after 45 s — but everyone still sees a
  short disconnect.
- **Backups:** everything durable is on the volume: `secret.key` (login signing
  — losing it signs everyone out, leaking it lets someone forge logins),
  `bans.json`, `accounts.json` (IP audit), `results.json`, `features.json`,
  `mutes.json`, `events.log`, `live.json`, and the `music/` and `graphics/`
  folders.
- **Memory** is what runs out first. The Overview tab shows RSS; raise the
  Railway plan if it climbs.
