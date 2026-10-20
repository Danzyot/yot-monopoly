# Deploying Chog Poker

The server is one long-lived Node process — WebSockets plus in-memory game
state — so it needs a host that keeps it running. **Vercel will not work**, and
neither will anything that sleeps when idle: a sleeping server kills a
tournament in progress.

Railway is the path below (~$5/month Hobby). Any always-on VPS works too.

> **Part of Chog Games.** This room now lives in the Chog Games repo under
> `poker/` and runs as its own Railway service (Root Directory `poker`) at
> `poker.choggames.com`, next to the hub at `choggames.com`. The owner's
> step-by-step for the pair — both services, DNS, the one shared Discord
> application and the cutover — is **[`docs/CHOGGAMES-DEPLOY.md`](../docs/CHOGGAMES-DEPLOY.md)**
> at the repo root. The rest of this file still applies to the poker service
> on its own.
>
> **One sign-in across the games.** The hub and this room share one Discord
> application and one token secret, so a player signed in on the hub is signed
> in here. There is no `TRUST_HUB_TOKENS` switch and nothing to turn on: both
> sides mint the same token (`base64url(JSON profile + iat).HMAC-SHA256`), and
> this room accepts the hub's tokens exactly when the secret matches — the
> hub's `APP_SECRET` must equal this service's `CHOG_SECRET` (or `APP_SECRET`,
> which this room reads when `CHOG_SECRET` is unset). `server/test/hubtoken.test.ts`
> signs a token the hub's way and checks it is accepted with the shared secret
> and refused with any other. The hub bounces players back here through
> `GET <HUB_URL>/sso?return=<this page's URL>`, landing them on the same
> `#dtoken=` the Discord callback uses, which the client reads on every route.
>
> | Variable | Value |
> |---|---|
> | `HUB_URL` | `https://choggames.com` (the default). Puts the "Chog Games" link in the header and "Sign in via Chog Games" in the sign-in box. `off` hides both. |
> | `HUB_ORIGINS` | Extra origins, comma separated, allowed to read `/api/leaderboard` and `/api/results/:id` from a browser — the hub's `*.up.railway.app` domain during cutover. `HUB_URL` is always allowed. Nothing else on `/api` is reachable cross-origin in production. |
>
> **Chog seat avatars ("Your Chog").** A player who holds Chog Genesis NFTs
> (wallets linked on the hub's `/wallet` page) clicks their avatar in the
> header, picks one of their Chogs, and its art becomes their avatar at the
> seat, in chat, in the lobby, on the leaderboard and in results, ringed in
> the Chog's Aura colour, with a gold star on the ten Legendary 1:1s. Players
> without a Chog see nothing different.
>
> - **Nothing new to set.** It uses the two things the room already has:
>   `HUB_URL` (the hub's address) and the shared secret (`CHOG_SECRET` here =
>   the hub's `APP_SECRET`). The secret must be set **in the environment on
>   both services**; a secret generated onto the data volume is not shared, and
>   with it the feature simply stays off. `HUB_URL=off` also turns it off.
> - **How the check works.** This room asks the hub
>   `GET <HUB_URL>/api/hosting/chogs?id=<player>&ts=<ms>&sig=<hmac>`, signed
>   with the shared secret (`server/src/hubLink.ts`, and the hub's own
>   `server/src/hubLink.ts`); the hub refuses a bad signature or a timestamp
>   more than a minute off. The answer lists the player's Chogs with each one's
>   aura colour and legendary flag, so this room keeps no copy of the trait data.
> - **Caching.** An answer is kept for 10 minutes, then re-checked in the
>   background. A Chog that has left the player's wallets is dropped on the next
>   check. If the hub cannot be reached, nobody shows a Chog until it answers
>   again (re-tried every minute). Picks are kept, and play is never held up.
>   Picks are stored in `chogpicks.json` on the data volume.
> - **The art** is the hub's own static `/chogs/<id>.webp` (128×128, about 3.5 KB
>   each, cached for a week), loaded straight from `HUB_URL` by the browser.
> - **Deploying it.** This room is a separate Railway service and **does not
>   redeploy when the hub does. Redeploy poker by hand** (Railway → the poker
>   service → Deploy) after the hub deploy that adds `/api/hosting/chogs` and
>   the `/chogs/` thumbnails. If poker goes out first, the picker says it cannot
>   reach Chog Games and no Chogs show; nothing else changes.

> **Player hosts (hosting rights).** Besides the operators in
> `ADMIN_DISCORD_IDS`, Chog Genesis holders (verified wallet on the hub) and
> players an operator approved in the hub's Dashboard → Hosts may open cash
> tables and tournaments here. **No new variables.** It needs a poker deploy
> by hand (auto-deploy is off), after the hub is on a build that has
> `/api/hosting/can-host`.
>
> - **How poker asks.** When a non-operator presses Create, this server calls
>   `GET <HUB_URL>/api/hosting/can-host?id=<player id>` with
>   `X-Chog-Timestamp` (ms) and `X-Chog-Signature` =
>   `base64url(HMAC-SHA256(secret, "svc:hosting:can-host:<id>:<timestamp>"))`,
>   using the same shared secret as sign-in (`CHOG_SECRET` here = `APP_SECRET`
>   on the hub). The hub refuses unsigned or wrongly signed requests, and any
>   timestamp more than 60 s off, so the endpoint cannot be used to list
>   holders. The player id is the same on both sides (`dc_<Discord id>`).
>   Answers are cached for 60 s.
> - **Fails closed.** If the hub cannot be reached, answers 401 (the secrets
>   differ) or `HUB_URL=off`, non-operators get "Could not check your hosting
>   rights…" (or "only operators can host here") and nothing is created.
>   Operators never depend on the hub. The server log says
>   `Hub hosting check failed (401)` when the secrets differ.
> - **Limits for player hosts:** 1 live or upcoming tournament and 2 open cash
>   tables at a time; tournaments are clamped to 100 players, a 50,000 starting
>   stack, 20-minute levels, 60 minutes of late registration, 30 minutes to
>   join, 2 re-entries, a 60-minute bet cap and a start within 7 days, with no
>   custom blind schedule. The numbers are in `shared/hosting.ts`.
> - **What a player host may do** with their own event: start, pause, resume
>   and cancel it, write the prize line and set the start time; close their
>   own cash table. **Operators only:** kicking, approving registrations,
>   Discord role / social requirements, ending early, seating or reinstating,
>   reversing turns and moving chips, table settings, bans. A player-hosted
>   event never posts results to Discord (no announce channel, no webhook),
>   and its page says prizes are the host's responsibility, not Chog Games'.
> - **Operators** see player-hosted events marked in Dashboard → Manage games
>   ("Hosted by …") and can pause, end or delete any of them.

> **If a Vercel project has already been created for this site**, it cannot
> host it. Vercel runs serverless functions with no long-lived process and no
> persistent disk, so the socket connection every table depends on has nothing
> to stay connected to. Two ways forward, both fine:
>
> - **Simplest, and what the sibling sites do:** delete or ignore the Vercel
>   project and run the whole thing — server and the client it serves — as one
>   Railway service. The steps below are exactly that.
> - **If the domain is already pointed at Vercel:** keep Vercel for the
>   apex/marketing domain and give the poker room its own subdomain
>   (`poker.…`) pointed at Railway. Do not try to split the client onto Vercel
>   and the server onto Railway: the client is served by the same process that
>   holds the game state, and separating them buys nothing but a CORS
>   problem.

---

## What you need before you start

| # | Thing | Who gets it |
|---|-------|-------------|
| 1 | A GitHub repo holding this code | you |
| 2 | A Railway account + Hobby plan (~$5/mo) | you |
| 3 | A Railway **volume** attached to the service | you (see below) |
| 4 | A **Discord application** of Chog's own | Chog, or you on their behalf |
| 5 | A **Discord bot** in that application, invited to Chog's server | Chog (needs Manage Server) |
| 6 | A subdomain (e.g. `poker.chog.co`) + a DNS record | whoever runs chog.co |
| 7 | Chog's Discord **server id**, and the **channel ids** you want to use | Chog |
| 8 | The Discord **user id** of everyone who should be an operator | them |

Nothing here is shared with any other site. This deployment has its own
Discord application, its own database on its own volume, and its own players.

---

## 1. Create the service

1. Railway → **New Project** → **Deploy from GitHub repo** → this repo.
2. It builds from the `Dockerfile` automatically (`railway.toml` is already set
   up: healthcheck on `/api/health`, restart on failure).

## 2. Attach a volume — do this before the first real game

Service → **Variables**/**Settings** → **Volumes** → **New Volume**, mount path
`/data`. Then set `DATA_DIR=/data`.

Without it the container's disk is wiped on every deploy and every restart,
taking results, bans, uploaded music and the live-game snapshot with it. The
site runs fine without a volume right up until the moment it matters.

## 3. Discord application

Discord Developer Portal → **New Application** (name it *Chog Poker*).

- **OAuth2** → copy `CLIENT ID` and `CLIENT SECRET`.
- **OAuth2 → Redirects** → add `https://<your-domain>/api/auth/discord/callback`.
- **Bot** → Add Bot → copy the **token**. Enable **Server Members Intent**
  (needed to verify that a player is really in Chog's server).
- **General Information** → copy the **Public Key**.
- **Interactions Endpoint URL** → `https://<your-domain>/api/discord/interactions`.
  Save this *after* the service is deployed and `DISCORD_PUBLIC_KEY` is set, or
  Discord's check fails. Open that URL in a browser any time — it explains in
  plain English which piece is missing.
- Invite the bot to Chog's server with `bot` + `applications.commands` scopes.

## 4. Variables

| Variable | Value |
|---|---|
| `DATA_DIR` | `/data` (the volume mount) |
| `CHOG_SECRET` | any long random string — signs login tokens |
| `PUBLIC_URL` | `https://poker.chog.co` |
| `ADMIN_DISCORD_IDS` | comma-separated Discord user ids of the operators (Chog holders and approved hosts can also host — see "Player hosts" above) |
| `DEMO_MODE` | `1` turns on name-only sign-in for showing the room; leave unset otherwise |
| `DISCORD_CLIENT_ID` | from OAuth2 |
| `DISCORD_CLIENT_SECRET` | from OAuth2 |
| `DISCORD_BOT_TOKEN` | from Bot |
| `DISCORD_PUBLIC_KEY` | from General Information |
| `DISCORD_GUILD_ID` | Chog's Discord server id |
| `DISCORD_INVITE_URL` | a permanent invite to that server |
| `DISCORD_VERIFY_CHANNEL_ID` | channel for the "verify with a code" panel |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | where winners are announced (optional) |
| `DISCORD_AUDIT_CHANNEL_ID` | where cheat alerts go — operators only (optional) |

To get a Discord id: User Settings → Advanced → Developer Mode, then
right-click a server/channel/user → Copy ID.

### Check they took

Every one of these is typed into a dashboard in another tab, and every way of
getting one wrong is silent from inside the room. So the server prints what it
actually sees at boot. **Open Railway → the service → Deploy Logs** after the
deploy finishes and look for the block that starts `Configuration check`:

```
────────────────────────────────────────────────────────────────
Configuration check
  ·  Durable data: /data
  ·  Operators: 1 Discord id
  ·  Discord redirect URI (must be registered in the portal): https://poker.example.com/api/auth/discord/callback
  ·  Discord application: 1274819260077576364 — the client id and secret must both come from THIS application…
  ·  Sign-in secret: CHOG_SECRET
  ok — nothing here will lose data or let the wrong person host.
────────────────────────────────────────────────────────────────
```

`·` is a fact, `!` is worth knowing, `✗` is something that will cost you.
A healthy deployment prints no `!` and no `✗` at all. The three that matter
most, because each one is invisible until the worst moment:

- **`DATA_DIR is not set`** — the volume is not attached, or is attached to a
  different service. Everything is lost on the next deploy.
- **`ADMIN_DISCORD_IDS is empty`** — *every* signed-in visitor is an operator
  and can cancel a running tournament.
- **`Discord sign-in is half configured`** — one of the id/secret pair is
  missing, so every sign-in fails at the token exchange.

The redirect URI line is worth copying straight out of the log into the
Developer Portal: it is the exact string this deployment will send, which is
not always the one you think you registered.

## 5. Domain

Railway → service → **Settings** → **Networking** → **Custom Domain** → enter
the subdomain. Railway shows a `CNAME` target; add it at whatever DNS provider
holds `chog.co`:

```
Type: CNAME   Host: poker   Value: <the value Railway shows>
```

Wait for it to go green, then set `PUBLIC_URL` and the OAuth redirect to match.
The Railway-generated `*.up.railway.app` domain keeps working throughout, so
you can run games before DNS is sorted.

## 6. First run

1. Sign in with a Discord account whose id is in `ADMIN_DISCORD_IDS`.
2. **Dashboard** → create a tournament → share the invite link.
3. Optional: **Dashboard → Promo code advert** if Chog wants their own offer
   shown. It ships switched off and empty.

---

## Health and diagnosis

- `GET /api/health` — uptime, memory, sockets, live games, event-loop lag,
  whether the persistent disk is actually attached.
- `GET /api/discord/interactions` — open in a browser; says exactly which
  Discord setting is missing or wrong.


---

## Standing up to load, and to attack

### What the app does for itself

| Guard | Setting |
|---|---|
| HTTP requests per address | 600/min across `/api`, 30/min on sign-in, 20/min on game creation |
| Socket messages per connection | 40 per 2s; excess packets are refused, sustained flooding disconnects |
| Sockets per address, anonymous | 12 (`CHOG_MAX_ANON_SOCKETS_PER_IP`) |
| Sockets per address, signed in | 250 (`CHOG_MAX_SOCKETS_PER_IP`) |
| Socket message size | 32 KB |
| Handshake timeout | 10s |

The split between anonymous and signed-in matters for a big community. Mobile
carriers put thousands of users behind one address, so a single strict cap
would lock out real players on 4G. Signing in with Discord is the work an
attacker will not do at scale, so it buys the far higher ceiling. **If a
shared network ever gets squeezed, raise `CHOG_MAX_SOCKETS_PER_IP`** — the
server logs every time a cap is hit, with the address and which cap it was.

### What the app cannot do — put Cloudflare in front

None of the above stops a real distributed attack. A volumetric flood
(SYN/UDP/amplification) never reaches the application at all, and no amount of
application code helps: the pipe fills before Node sees a byte.

**Put the domain behind Cloudflare.** The free plan covers what a community
site needs:

1. Add `chog.co` to Cloudflare, or add the `poker` subdomain there.
2. Point the record at Railway's CNAME target with the **orange cloud on**
   (proxied). That hides the origin and absorbs L3/L4 floods.
3. Turn on **Bot Fight Mode** and set Security Level to Medium.
4. Optional: a rate-limiting rule on `/api/auth/*` as a second line.

Proxying WebSockets works on the free plan and needs no extra configuration.
Once proxied, the origin should only be reachable through Cloudflare — ask
Railway support to restrict it, or accept that the `*.up.railway.app` hostname
remains a bypass and simply do not publish it.

### Capacity, measured

A 1,000-socket test against one container, with a 684-player tournament
running across 76 tables:

- 15,700 events/second pushed to clients
- event-loop lag p95 **20ms** (the server is not CPU-bound)
- resident memory **~1.7 GB**
- integrity check clean throughout

Two caveats worth knowing. Socket round-trip p95 measured 3.4s, but the load
generator was 1,000 Socket.IO clients in a single Node process sharing a CPU
with the server — that number is at least partly the test harness queueing,
not the server, which the 20ms loop lag argues for. And memory is the real
planning constraint: **budget roughly 2.5 MB per concurrent player**, so size
the Railway container from the field you expect (1,000 players ≈ 4 GB).

## 2a. Blocking VPNs (optional, off unless you set it)

Turn a VPN or datacenter connection away at the front page, before anything
loads. Read the whole of this section before switching it on — it is the only
setting that can lock you out of your own dashboard.

| Variable | Value |
|---|---|
| *(the switch itself)* | **Dashboard → Access → Block VPN and datacenter connections.** Off everywhere until someone turns it on, and it takes effect immediately — no restart. |
| `VPN_BLOCK` | Not normally needed. `0` forces the block OFF and the dashboard cannot override it — this is how you get back in if the block locks you out. `1` only sets the starting value before anyone has used the switch. |
| `VPN_BYPASS_KEY` | A long random string. **Set this first.** Visiting `https://<your site>/?vpnbypass=<the key>` lets that browser through for 30 days, even from a VPN. It is how you get back in when the block misfires. |
| `VPN_ALLOW_IPS` | Comma-separated addresses that are never blocked. |
| `PROXYCHECK_API_KEY` | Optional. A [proxycheck.io](https://proxycheck.io/) key adds a second opinion on addresses the offline lists clear. The free tier is 1,000 lookups a day. Without it the offline lists work on their own. |

**Before you turn it on:** the switch itself names the accounts it would
refuse and says whether a bypass key is set, and asks you to confirm. For the
fuller picture, open the dashboard → Audit → Players. Any
account on a VPN or datacenter address is marked, and a line above the table
counts them and names them. Those are the people the block will refuse. Deal
with them first — allowlist them, or tell them — rather than finding out from
the ones who cannot reach you.

What it catches and what it does not: commercial VPNs and hosting networks,
reliably. Residential proxies, not at all — they come through real home
connections and cannot be told apart by address. Someone determined can still
get round it for a few dollars, so treat a flag as a prompt, never as proof.

The ranges are checked into the repo at `server/vpn-ranges/`, so nothing is
fetched at boot or at build time. Run `scripts/refresh-vpn-lists.sh` every
month or two and commit the result.

Never blocked, whatever the lists say: `/api/health` (so you can still tell a
blocked site from a dead one), the Discord interactions webhook (it arrives
from Discord's own servers, which are a datacenter by definition), and
anything on the allowlist or holding a valid bypass cookie.
