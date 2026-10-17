# 🎩 Yot Monopoly

A multiplayer 3D property-trading board game for the browser, with several maps,
custom editions (like the poker sites: one codebase, many branded versions),
mini-games, music, and a full operator dashboard.

## Features

**Play**
- **Many games at once** — every table is a room with a 5-letter code and an invite
  link; public or private; 2–8 players (default 6), plus spectators.
- **Three maps**, each with its own 3D surroundings:
  - **Classic** — 40 spaces, the standard game, in a cosy lounge. With the Classic edition
    it's a modelled, light-baked study (fireplace, moonlit window, bookshelf, Chesterfield).
  - **Speedway** — 32 spaces, two-street colour sets, two arcades; ~30-minute games at a racetrack.
  - **Metropolis** — 48 spaces, ten colour sets, two arcades; built for 5–8 players, on a night rooftop.
- **Editions** (skins that work on any map): Classic, **Chog** (built from the Chog
  Poker design system: purple room, Chog pink, Outfit font, the Chog character on the
  board) and **Takeprofit TV** (from the takeprofit-tv site: ink black, amber, colour-bar sets, Big Shoulders + Space Mono, the TPTV logo on the board). Card text always names the board's own spaces.
- **3D characters** instead of tokens — ten chibi figures (Spiky, Robo, Whiskers,
  Sir Deed, Merlot, Cosmo, Captain Cash, Shade, Chef Gusto, Zorp), modelled in Blender
  and tinted in each player's colour. They hop tile by tile, cheer when they buy or earn, slump in jail,
  fall over when bankrupt and dance when they win.
- **Full rules**: rent (sets, houses, railroads, utilities), doubles and jail, all
  Chance/Community Chest cards, auctions, even building, the 32/12 building supply,
  mortgages, debts, bankruptcy to a player or to the bank (the bank auctions the estate),
  trading (10% interest on mortgaged deeds received), and the official **Speed Die**
  variant (Mr. Monopoly, Bus, triples).
- **Mini-games** on arcade spaces (and optionally Free Parking on Classic): Dice Duel,
  High or Low, Reaction Race, Quick Math and Wheel Spin. Server-authoritative; bots play
  them too.
- **House rules** per room: starting cash, Free Parking jackpot, double on GO, auctions,
  even building, limited buildings, mini-games, Free Parking arcade, no rent in jail.
- **Timing**: a turn timer (off/30–120 s; the safe move is made on timeout, and after two
  in a row autopilot takes over until the player acts), a deadline for debts, an optional
  game length (richest player wins when it runs out), and pause/resume for the host.
- **Table styles** like the poker tables: seven table presets, a custom board logo and a
  backdrop image from the operator's graphics library.
- **Music & sound**: operator-uploaded music library with playlists, a built-in
  generative lounge soundtrack that works with nothing uploaded, and synthesised sound
  effects for dice, buying, rent, cards, jail, auctions and winning.
- **Bots** fill seats, and **autopilot** plays for anyone disconnected more than 45 s,
  away after timeouts, or handed to it by the host (never spending their money or
  trading for them). Reconnecting, or simply acting, reclaims the seat.
- Chat, leaderboard, and phone-friendly layout throughout.
- **Table social**: emoji reactions that pop over the sender's character (spectators'
  float up the side), and **pokes** for a player whose turn has dragged past 15 s.
- **Trading**: counter-offers (edit an incoming offer and send it back in one step) and
  a **portfolio** view of every player's deeds by colour set, cash, net worth and jail cards.
- **End of game**: final standings with net worth, turns, duration and awards (most rent
  collected, biggest rent paid, most properties bought, jailbird, arcade champ), and a
  host **rematch** that returns the table to the lobby with the same seats and settings.
- **Turn alerts**: the tab title flashes when the game is waiting on you, plus optional
  browser notifications (the 🔔 button). **Keyboard shortcuts**: Space/R roll, B buy,
  A auction, E end turn, P pay debt, T trade/portfolios, Esc close, ? help.

**Community**
- **Host transfer** — the host (or an operator) can make another seated player the host,
  in the lobby or mid-game. If the host leaves or is away for over 2 minutes, the
  longest-seated player who is still here takes over automatically.
- **Discord requirements** — a host can require membership of the site's Discord server
  (`DISCORD_GUILD_ID`) and optionally a role in it to take a seat; watching stays open and
  operators are never gated. Players who don't qualify get a checklist with the invite and
  a "Check again" button. Membership is checked by the bot; without one, only a fresh
  "Log in with Discord" can show a player's servers (sign-ins are forgotten on restart), and
  the checklist says so.
- **Profiles** (`/u/:id`) — games, wins, win rate, leaderboard points, favourite map and
  character, and recent games with linked opponents. Follow the leaderboard switch; built
  only from results, never from the accounts audit.

**Sign-in** (ported from the poker room): **Log in with Discord** (OAuth) or **Verify with
a code** (the player pastes `MONO-XXXX` into the bot's Verify button in your Discord, or
posts it in a verify channel). `DEMO_MODE=1` adds a name-only sign-in for development.

**Operator dashboard** (`/admin`, for the Discord ids in `ADMIN_DISCORD_IDS`):
- Overview — health, memory, loop lag, sockets, persistent-disk and snapshot status.
- Rooms — live rooms, spectate, pause/resume, end/close, remove or ban players, and
  "Fix game" (cash, deeds, jail cards, debts, jail), all logged.
- Players — search by name/id/Discord/IP, IP history with countries, linked accounts,
  bans, mutes, Discord DM, erase history; who is online now.
- Alts — accounts sharing an IP address.
- Bans — by account or IP, site-wide or one room, permanent or timed, with reasons and a
  preview of what the player sees. Enforced on connect, on join, and instantly when added.
- Logs — durable per-room event logs (moves, chat, joins, kicks) and a log of every
  operator action; recent results.
- Features — switch chat, reactions & pokes, music, mini-games, bots, public room creation, the leaderboard
  and Discord result announcements on or off (enforced server-side).
- Discord — post the Verify panel, DM players, sign-in/interactions diagnostics.
- Graphics and Music libraries.

**Hardening**: trusted-proxy client IPs, per-IP socket cap, action and HTTP rate limits,
slow-request guards, chat filter and cooldown, HMAC-signed sessions, magic-byte checks on
uploads, and live rooms that survive restarts and deploys.

## Quick start

```bash
npm install
npm run dev        # server :8080 (DEMO_MODE on), client :5173 (proxied)
```

Open http://localhost:5173, sign in with any name, create a game, add a bot or two, start.

```bash
npm test           # engine, rooms, bans/IP, mini-games, music, graphics — incl. full bot games on every map
npm run typecheck
npm run build && npm start   # production: the server serves the built client on :8080
```

Deploying (Railway + Discord setup, every environment variable): **[DEPLOY.md](DEPLOY.md)**.

## Adding an edition

Everything an edition changes lives in [`shared/themes.ts`](shared/themes.ts) — copy the
`CHOG` or `TPTV` block: name, centre title, currency, deck names, set colours, palette
(board, table, sky, dice, houses), optional UI skin and font, optional logo
(`client/public/editions/<id>/`), default house rules, and `names` to rename spaces
(per map via `mapNames`). The engine never branches on the edition.

## Adding a map

Maps live in [`shared/maps.ts`](shared/maps.ts): a square board (multiple of 4 spaces;
GO, jail, Free Parking and Go To Jail on the corners), its spaces (prices/rents can use
the helpers that scale the classic curve), decks (`standardDecks()` builds sensible
Chance/Community Chest cards for any layout) and an `environment` for the 3D scene
(`client/src/three/environments/`). `validateMap()` and the test suite check every map ×
edition combination, and bots play complete games on every map in the tests.

## Architecture

```
shared/                  types and data used by both sides
  board.ts, cards.ts     spaces and card effects as data
  maps.ts, themes.ts     maps (structure/economy) and editions (skins)
  characters.ts, minigames.ts, tableStyles.ts
server/src/
  engine/game.ts         pure rules state machine (injected RNG + clock, snapshot/restore)
  engine/bot.ts          bot / autopilot decisions
  engine/minigames/      the five mini-games
  rooms.ts               rooms, lobby, timers (auctions, mini-games, bots), persistence
  sockets.ts             Socket.IO: identity, bans, rate limits, chat
  auth.ts, discord.ts, verifycode.ts, interactions.ts   sign-in
  bans.ts, ip.ts, connections.ts, chat.ts, features.ts, eventlog.ts, stats.ts
  music.ts, graphics.ts  operator libraries
  routes/                auth, admin, music, graphics
client/src/
  three/                 3D: board texture, layout, characters, environments, dice, models
client/public/models/    GLB models + lightmaps, built by tools/blender (see its README)
tools/blender/           headless-Blender build scripts for every model
  components/            lobby, HUD, deeds, trades, auctions, mini-games, music, admin/
  pages/                 home, room, leaderboard, admin
```

The server is authoritative: clients send actions and render the state the server
broadcasts after every change.
