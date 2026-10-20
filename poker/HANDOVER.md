# Chog Poker — handover

This is the whole poker room: source code, deployment config, and the notes
below. Once the steps here are done, Chog runs it. Nothing in it
phones home, nothing depends on an account belonging to whoever built it, and
there is no licence key to renew.

Read this first. [`DEPLOY.md`](DEPLOY.md) has the click-by-click detail for
each step; [`README.md`](README.md) is for a developer changing the code.

---

## 1. What you are taking on

**One always-on server.** The poker engine keeps every live hand in memory and
pushes updates over WebSockets. That has consequences worth knowing up front:

- It cannot go on Vercel, Netlify, or anything that sleeps when idle or runs
  as serverless functions. A server that sleeps mid-tournament ends the
  tournament.
- It must have a **persistent disk**. Without one, every deploy and every
  restart wipes results, bans, uploaded music and the live-game snapshot.
- Restarting it is safe *between* games and disruptive *during* one. The
  server snapshots live games to disk and restores them, but players still see
  a disconnect. Deploy between events.

**Costs.** Railway Hobby is about $5/month and covers a normal club night.
Memory is the thing that scales: budget roughly **2.5 MB per concurrent
player**, so a 1,000-player event wants ~4 GB and a bigger Railway plan. A
domain is whatever you already pay. Cloudflare's free plan is enough.

---

## 2. Accounts to create, and who has to do it

| # | Thing | Who can do it | Notes |
|---|-------|---------------|-------|
| 1 | A **GitHub repo** holding this code | anyone at Chog | Private is fine. Railway deploys from it. |
| 2 | A **Railway** account on the Hobby plan | whoever holds the card | This becomes the owner of the running site. |
| 3 | A **Discord application** | anyone | Chog's own — see the warning below. |
| 4 | A **bot** in that application, invited to Chog's server | someone with **Manage Server** on the Discord | Needs the Server Members Intent turned on. |
| 5 | A **subdomain** + DNS record, e.g. `poker.chog.co` | whoever controls `chog.co` | A CNAME. Railway tells you the target. |
| 6 | The **Discord user id** of every person who should run games | them | These are your operators. |

> **Create a new Discord application for this.** Do not reuse one that already
> powers another bot or site. The application's client secret and bot token
> are entered into this deployment, and sharing them means sharing control of
> everything else that application touches.

Whoever owns the Railway account owns the site. If that should be Chog rather
than an individual, create it under a Chog email address now — moving a
project between accounts later is more annoying than starting in the right
place.

---

## 3. Order of operations

Do these in order; several steps depend on the one before.

1. **Push this code to your GitHub repo.**
2. **Create the Railway service** from that repo. It builds from the
   `Dockerfile` on its own — no build settings to configure.
3. **Attach a volume** at mount path `/data`, and set `DATA_DIR=/data`.
   *Do this before the first real game.* The site works perfectly without a
   volume right up until the moment it matters.
4. **Create the Discord application**, its bot, and invite the bot to Chog's
   server.
5. **Set the environment variables** (the table in `DEPLOY.md`). The two that
   decide whether anyone can get in at all are `DISCORD_CLIENT_ID` /
   `DISCORD_CLIENT_SECRET`, and the one that decides who can run games is
   `ADMIN_DISCORD_IDS`.
6. **Add the custom domain** in Railway, then the CNAME at your DNS provider.
   Railway's own `*.up.railway.app` address works throughout, so you can run
   games before DNS resolves.
7. **Point the OAuth redirect and `PUBLIC_URL` at the final domain** once it
   goes green.
8. **Sign in** with an account listed in `ADMIN_DISCORD_IDS` and create a test
   tournament before announcing anything.

`GET /api/discord/interactions` in a browser will tell you in plain English
which Discord setting is missing or wrong, at any point.

---

## 4. Things about this build worth knowing

**Discord is the only way in**, for any deployment running real events. No
email signup, no password. If the Discord application is misconfigured, nobody
can sign in — including you. That is deliberate: it is what makes bans
meaningful, since a banned account cannot come back as a fresh guest. (The one
exception is the demo flag below, which exists to show the room and is off
unless it is switched on by name.)

**Showing the room before it is set up.** Starting the server with
`DEMO_MODE=1` adds a "pick a name and look around" sign-in that needs no
Discord application at all. It is meant for demos and nothing else:

- Off unless the value is exactly `1`, and the server says so loudly on boot.
- The page wears an amber **DEMO** badge so it cannot be mistaken for the room.
- Anyone with the address can sign in, and with `ADMIN_DISCORD_IDS` unset they
  are an operator — which is the point for a demo, and the reason a demo URL is
  not something to post publicly.
- Turning the flag off logs every demo visitor out. The check happens when a
  session is read, not when it is issued, so demo sessions cannot outlive the
  flag.

Unset it before the room runs a real event.

**One operator group, plus player hosts.** Discord ids listed in
`ADMIN_DISCORD_IDS` can create and control any game. With that variable unset,
*every* account is an operator — fine on a laptop, wrong in production. Set it
before you go live. Chog Genesis holders and players approved in the hub's
Dashboard → Hosts may also open tournaments, with limits, and run only their
own (start, pause, cancel, prizes); this room asks the hub, signed with the
shared secret. See "Player hosts" in `DEPLOY.md`.

**Tournaments only.** There are no cash tables. Tournaments have no player
cap unless an operator sets one (Max players on the form, empty by default).
The first boot after the build that removed cash tables closes any cash table
still in the live snapshot and files it under Past games; see "Tournaments
only" in `DEPLOY.md`. As with every poker change, nothing reaches the live
room until the owner presses **Deploy** on the poker service in Railway.

**The audit channel is for operators only.** `DISCORD_AUDIT_CHANNEL_ID`
receives cheating alerts, including player names and IP-derived countries.
Point it at a private channel.

**Anti-cheat advises, it never acts.** Collusion and timing analysis flag
hands for a human to look at. Nothing is auto-kicked and nothing is
auto-banned — a false positive that ejects an honest player mid-tournament
costs more than a missed cheat.

**Features you can switch off** live under Dashboard → Features: chat, session
log, hand replayer, music, rabbit hunting, leaderboard. Each switch is enforced
on the server, not merely hidden in the browser. Emoji reactions are always on.
The promo advert has no editor in this build — Chog's will be a different
thing from the one it replaced, and the plumbing is still there waiting for
it.

**There is no in-site currency.** Prizes are free text you write into the
tournament and hand out yourself. The site never touches money.

---

## 5. Running it

**Before an event.** Deploy any code changes now, not later. Check
`GET /api/health` shows `persistentDisk: true`. Create the tournament, set late
registration and any Discord requirements, and share the invite link.

**During an event.** Do not deploy. The Dashboard gives you the live tools:
adjust a player's stack, reverse the last action at one table, ban from this
game or for life, and DM a winner through the bot.

**After an event.** Results persist automatically and appear on the
leaderboard. Past games stay in Dashboard → Past games until you delete them;
deleting one frees its name for reuse and clears bans scoped to that game.

**Backups.** Everything durable lives on the volume: `results.json`,
`bans.json`, `audit.json`, `cash-history.json` (sessions from before cash
tables were retired; the room is tournaments only now), `promo.json`, `features.json`,
`live.json`, `secret.key`, and the `music/` and `graphics/` folders holding
whatever you uploaded. Railway can snapshot the volume; copying those files
somewhere else occasionally is a reasonable substitute. **`secret.key` signs
login tokens — losing it signs everyone out; leaking it lets someone forge an
operator login.**

---

## 6. When something is wrong

| Symptom | Look at |
|---|---|
| Nobody can sign in | Discord client id/secret, and the redirect URI matching `PUBLIC_URL` exactly |
| You can sign in but cannot create games | Your Discord id is not in `ADMIN_DISCORD_IDS`; for a player host, "Could not check your hosting rights" means the hub is unreachable or `CHOG_SECRET` differs from the hub's `APP_SECRET` |
| Results vanished after a deploy | No volume attached, or `DATA_DIR` not set to its mount path |
| Discord verification fails | Bot not in the server, or the Server Members Intent is off |
| Site is slow with a big field | Memory. `GET /api/health` shows RSS; raise the Railway plan |
| Under attack | See "Standing up to load, and to attack" in `DEPLOY.md` — put Cloudflare in front |

`GET /api/health` reports uptime, memory, socket count, live games,
event-loop lag, and whether the persistent disk is really attached. It is the
first thing to check for anything performance-shaped.

---

## 7. Capacity, measured

Against a single container, with 1,000 sockets open and a 684-player
tournament running across 76 tables:

- 15,700 events/second pushed to clients
- event-loop lag p95 **20ms** — the server was not CPU-bound
- resident memory **~1.7 GB**
- integrity checks clean throughout

You can reproduce this yourself; `README.md` has the command. Two honest
caveats: socket round-trip p95 measured 3.4s, but the load generator was 1,000
clients in one Node process sharing a CPU with the server, so much of that is
the harness queueing rather than the server — the 20ms loop lag is the better
signal. And memory, not CPU, is what you will run out of first.
