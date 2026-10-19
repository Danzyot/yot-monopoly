# ♠ Chog Poker

A professional multi-table tournament poker platform. Host tournaments for hundreds of
players or spin up a cash table and share the link — no downloads, no friction.

![Chog Poker](https://img.shields.io/badge/No--Limit-Hold'em-d53f7c) ![Node](https://img.shields.io/badge/Node-%E2%89%A518-2b1764) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-4c9de8)

## Features

**Multi-table tournaments (MTT)**
- Up to 1,000 players, 9-max tables created and balanced automatically
- Automatic table breaking and seat balancing between hands
- Blind schedules (turbo / regular / deep) with antes and configurable level length
- Late registration, scheduled or manual start, breaks every N levels
- Live standings, average stack, payout table (industry-style top-heavy curve)
- Tournament director controls: start, pause, resume, cancel
- Tournament-wide chat + per-table chat

**Cash games**
- Instant shareable table links (PokerNow-style: create → share → play)
- Choose blinds, 2/6/9-max, buy-in range 40–200 BB, top-ups, sit-out, leave anytime

**Serious poker engine**
- Full No-Limit Hold'em rules: side pots, min-raise enforcement, short all-in
  (doesn't reopen action), big-blind option, heads-up button rules
- All-in runouts with paced street dealing
- 7-card evaluator with four-color deck rendering
- Per-decision action clock + one-time 30s time bank per player
- Crypto-grade shuffle (`crypto.randomInt` Fisher-Yates)
- Server-authoritative state — hole cards are never sent to other clients

**Single-operator platform**
- The site belongs to one operator: only you can create tournaments and cash
  tables (matched by your Discord ID, or unlocked with an admin key)
- Players sign in with **Discord** — the only way in — browse the lobby, and
  register; they can never create games

**Social requirements & Discord verification** (all optional, per tournament)
- Join a Discord server (invite link + real membership verification)
- Hold a specific **Discord role** (verified via bot token)
- Follow on X / follow on Instagram (click-through checklist — those platforms
  no longer offer free APIs to verify follows)
- Winners are announced to a Discord channel via webhook with @mentions and a
  ✅ verified badge; standings show every player's linked/verified Discord tag

**Tournaments, extended**
- Re-entry tournaments: busted players can buy back in while late registration
  is open; the prize pool grows with every entry
- Persistent all-time leaderboard (`/leaderboard`): points, wins, cashes and
  winnings aggregated across every finished tournament, stored on disk
- Turn alerts: chime + browser tab notification when it's your turn (mutable)

**Resilient realtime sync**
- WebSockets with automatic, unlimited reconnection; pages re-subscribe and
  resync state after any network blip
- Seats, stacks and hole cards live server-side — a disconnected player's seat
  survives and the action clock/time bank handles them fairly
- Cash-game ledger (buy-ins / cash-outs / net), PokerNow-style per-action hand
  log, and post-tournament podium with full results

## Deployment

Start with **[HANDOVER.md](./HANDOVER.md)** — what Chog needs in order
to own and run this: accounts, costs, the order to do things in, and how to
operate it around an event.

**[DEPLOY.md](./DEPLOY.md)** is the click-by-click Railway guide (Dockerfile and
`railway.toml` included) plus the load and DDoS notes. Verified under load: a
300-player tournament runs with 2–4ms median action latency and zero errors on a
single instance.

## Quick start

```bash
npm install
npm run dev        # server on :8080, client on :5173 (proxied)
```

Open http://localhost:5173, sign in, and create a game.

### Production

```bash
npm run build      # builds client into client/dist
npm start          # server serves API + built client on :8080
```

### Operator (owner) mode

The platform is designed for a single operator, identified by Discord id:

```bash
ADMIN_DISCORD_IDS=123456789012345678   # your Discord user id(s), comma-separated
```

With this set, only you can create tournaments/tables and control any
tournament. With it unset (local dev), every profile has operator rights.

### 500 simultaneous websockets

`npm run loadtest` opens 500 real websocket connections in one burst, holds
them open, registers them all into a tournament and plays it through them.

```bash
# terminal 1
PORT=8080 CHOG_SECRET=loadtest RATE_LIMIT_OFF=1 npm run dev -w server
# terminal 2
CHOG_SECRET=loadtest npm run loadtest -- --url http://127.0.0.1:8080 --clients 500 --hold 60000
```

Measured on a single container:

```
connected 500/500 in 411ms (failed 0)
connect time  p50 293ms  p95 315ms  max 390ms
socket RTT    p50 1ms  p95 433ms  max 658ms
loop lag      p50 0ms  p95 1ms  max 31ms
events pushed 267,681 over 60s (4,433/s across all sockets)
unexpected disconnects: 0, reconnects: 0
integrity: ok  alive=180 tables=20 spread=0 seatless=0 dup=0
```

The round-trip tail (p95 ~430ms) is queuing behind broadcast bursts when many
tables act at once, not the event loop, which stays under 1ms. The median
stays at 1ms.

### Discord integration (recommended)

**Discord setup** — this site uses its own Discord application. Every value
below comes from the Developer Portal entry for that one application; mixing a
client id from one app with a secret from another is the single most common
cause of "token exchange failed" on sign-in.

```bash
DISCORD_CLIENT_ID=...              # Application ID
DISCORD_CLIENT_SECRET=...          # OAuth2 → client secret, from the SAME app
DISCORD_BOT_TOKEN=...              # Bot → token, from the SAME app
DISCORD_GUILD_ID=...               # Chog server id → default for
                                   # verification, prefilled when creating
                                   # tournaments
DISCORD_INVITE_URL=https://discord.gg/...   # prefilled invite link
DISCORD_ANNOUNCE_CHANNEL_ID=...    # channel where the bot posts final results
                                   # (no webhook needed)
ADMIN_DISCORD_IDS=...              # your Discord user id → operator access
PUBLIC_URL=https://your-poker-domain
```

Then add one thing in the Developer Portal → your app → **OAuth2 → Redirects**:
`https://your-poker-domain/api/auth/discord/callback`. The bot needs no new
permissions beyond reading members and posting in the announce channel.

With the bot configured, the create-tournament form lists your server's roles
in a dropdown for role-gated events, and winners are posted by the bot
automatically.

**Starting from scratch instead:**

1. Create an application at https://discord.com/developers/applications
2. OAuth2 → add redirect `https://your-domain/api/auth/discord/callback`
   (or `http://localhost:8080/api/auth/discord/callback` for local dev)
3. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, optionally
   `DISCORD_BOT_TOKEN` + the variables above, and restart.

- Players click **Continue with Discord** to sign in; their identity and guild
  list are captured and membership is verified against the tournament's
  configured server ID.
- **Role requirements** need `DISCORD_BOT_TOKEN` — the bot reads the member's
  roles in your server; enter the role ID + display name when creating the
  tournament.
- To announce winners, paste a channel **webhook URL** into the tournament's
  social settings (Server Settings → Integrations → Webhooks).
- Without these variables the social requirements degrade to an honor-system
  checklist. Discord sign-in itself is not optional: with no Discord
  application configured, nobody can sign in at all.

Other environment variables:
- `PORT` — HTTP port (default 8080)
- `CHOG_SECRET` — HMAC secret for auth tokens (default: generated and stored in `server/data/`).
  Must equal the Chog Games hub's `APP_SECRET` for one sign-in across the games (`APP_SECRET`
  is read here too when `CHOG_SECRET` is unset)
- `HUB_URL` — the Chog Games hub (default `https://choggames.com`): header link + "Sign in via
  Chog Games". `off` for a standalone room
- `HUB_ORIGINS` — extra browser origins, comma separated, allowed to read the public leaderboard
  and results endpoints (the hub's Railway domain during cutover)
- `DISCORD_REDIRECT_URI` — override the computed OAuth redirect URI

## Architecture

```
shared/types.ts        Protocol types shared by server and client
server/
  src/engine/          cards, 7-card evaluator, NLHE hand state machine, table runner
  src/tournament/      blind structures, payout curves, MTT manager (balancing/breaking)
  src/auth.ts          HMAC-signed tokens, Discord sign-in
  src/registry.ts      in-memory registry of live games
  src/sockets.ts       Socket.IO rooms with per-player redacted views
  test/                engine + tournament test suite (node:test)
client/
  src/pages/           Home, Lobby, TournamentPage, TablePage
  src/components/      Felt/seats/cards, action bar with bet slider, chat, modals
```

- **Server-authoritative**: all game logic runs on the server; each client receives a
  personalized view with opponents' hole cards redacted until showdown.
- **The hand engine is a pure state machine** (no timers/I/O) — fully unit-tested.
  Tables own timers and pacing; tournaments own levels, balancing and payouts.
- **Scale**: a single Node process comfortably runs hundreds of concurrent players
  (an MTT with 500 players is ~56 tables, each with one active timer).

## Tests

```bash
npm test
```

Covers hand rankings, kickers, wheel straights, split pots, side pots, min-raise rules,
short all-in behavior, blind posting, antes, heads-up rules, payout distribution and
blind structure generation.

## Credits

Table reactions use the operator's own animated emoji set, keyed off their
white backgrounds into real transparency and stored as animated WebP in
`client/public/reactions/`. The source videos live in the branch history
(commit `ed0caab`) rather than the working tree — they are ~10 MB and would
otherwise ship inside every Docker image.

The all-in flame (`1f525.webp`) is from
[Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/)
by Google, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
