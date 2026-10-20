# Chog Games — deploy checklist

How `choggames.com` is put together, and the exact clicks to get there.

**Two Railway services, one repo, one Discord application, one secret.**

| | Hub | Poker |
|---|---|---|
| What | Monopoly + Chog Cards | Chog Poker |
| Address | `https://choggames.com` (and `www`) | `https://poker.choggames.com` |
| Railway service | the existing **yot-monopoly** service | the existing **chog-poker** service, re-pointed at this repo |
| Builds from | repo root (`Dockerfile`, `railway.toml`) | `poker/` (`poker/Dockerfile`, `poker/railway.toml`) |
| Deploys | automatically on push (fine: no tournaments live here) | **by hand, between tournaments** |
| Volume | `/data` | `/data` (the one it already has — keep it) |

A player who signs in on either site is signed in on both, because both
services sign login tokens with the **same secret** and the **same Discord
application**. That is the whole trick, and it is also why the secret and the
Discord values must be *identical* on both services (section 2).

Work through the sections in order. Each one says what to open and what to
type. Field names are Railway's/Cloudflare's/Discord's own; if a label has
moved, it is the one that means the same thing.

---

## 0. Have these open before you start

1. **Railway** → the project holding `yot-monopoly` and `chog-poker`.
2. **Wix** → **Domains** → `choggames.com` (the domain is registered there),
   and a free **Cloudflare** account (section 3 moves the DNS there).
3. **Discord Developer Portal** → the **Monopoly bot's** application (the one
   whose Client ID is in the **hub's** `yot-monopoly` variables). *This is the
   only application and bot both sites use from now on; the old Chekr poker
   bot is retired.*
4. The poker service's **Variables** tab. Copy the value of **`CHOG_SECRET`**
   somewhere safe — you will paste it into the hub as `APP_SECRET`.

> **If the poker service has no `CHOG_SECRET` variable at all**, its secret is
> a random file on the volume (`/data/secret.key`) that cannot be typed into a
> variable. Make a new one instead: any random string of 48+ letters and
> digits (a password generator is fine). Set it as `CHOG_SECRET` on poker *and*
> `APP_SECRET` on the hub in the same sitting. This is the one case where
> poker players are signed out once — do it between tournaments.

---

## 1. Railway — the two services

### 1a. Hub (the existing `yot-monopoly` service)

Service → **Settings**:

| Field | Value |
|---|---|
| Source → **Repository** | this repo (`yot-monopoly`) |
| Source → **Branch** | the branch you deploy from (today: `claude/blissful-edison-6caook`) |
| Source → **Root Directory** | leave **empty** (repo root) |
| Source → **Watch Paths** | optional: `!/poker/**` so a poker-only commit does not rebuild the hub |
| **Volumes** | one volume, **Mount Path** `/data` |
| Networking → **Custom Domain** | `choggames.com` and `www.choggames.com` (Railway shows a CNAME value for each — keep this tab open for section 3) |

Variables: section 2.

### 1b. Poker (the existing `chog-poker` service, re-pointed)

Do **not** create a new service — the current one owns the volume with every
result, ban and the sign-in secret. Change where it builds from:

Service → **Settings**:

| Field | Value |
|---|---|
| Source → **Repository** | **Disconnect** the old poker repo, then **Connect** this repo (`yot-monopoly`) |
| Source → **Branch** | same branch as the hub |
| Source → **Root Directory** | `poker` |
| Source → **Watch Paths** | `/poker/**` |
| Source → automatic deploys (the toggle under the repo, labelled **Automatic deployments** / **Deploy on push** / **Auto Deploy**) | **off** |
| Build → **Builder** / **Dockerfile Path** | leave as detected: `poker/railway.toml` already says `Dockerfile` (relative to `poker/`) |
| **Volumes** | confirm the existing volume is still there, **Mount Path** `/data` |
| Networking → **Custom Domain** | add `poker.choggames.com`; keep the old domain(s) attached until the cutover is done |

With auto-deploy off, shipping poker is: **Deployments** tab → the latest
commit → **Deploy** (or `Cmd/Ctrl-K` → *Deploy latest commit*). Nothing
deploys unless you press it.

Variables: section 2.

---

## 2. Variables

Set these on **both** services, **identical** on both. Copy-paste, do not
retype.

| Variable | Value | Why identical |
|---|---|---|
| `APP_SECRET` | the poker service's current `CHOG_SECRET` (section 0) | signs login tokens; same value = one sign-in |
| `DISCORD_CLIENT_ID` | the **Monopoly bot** application's **Application ID** (the hub already has it — copy it to poker) | one Discord app |
| `DISCORD_CLIENT_SECRET` | OAuth2 → **Client Secret** of the Monopoly bot app (copy the hub's) | same |
| `DISCORD_BOT_TOKEN` | Bot → **Token** of the Monopoly bot (copy the hub's) | same bot verifies members on both |
| `ADMIN_DISCORD_IDS` | comma-separated Discord user ids of the operators | an operator on one is an operator on the other |
| `DISCORD_GUILD_ID` | the Chog server id | same community |
| `DISCORD_INVITE_URL` | the permanent invite | header link on both |
| `DATA_DIR` | `/data` | each service's own volume |
| `TRUSTED_PROXY_HOPS` | `2` | both sit behind Cloudflare → Railway (section 3) |
| `NODE_ENV` | `production` | the Dockerfiles set it; setting it again does no harm and the hub refuses to make everyone an operator only when it is set |
| `DEMO_MODE` | **not set** (delete it if present) | demo sign-in must be off on a live site |

Poker keeps its existing `CHOG_SECRET` as well — it reads that first, and
`APP_SECRET` only when `CHOG_SECRET` is unset. Both must hold the same value.

Per-service, **different**:

| Variable | Hub | Poker |
|---|---|---|
| `PUBLIC_URL` | `https://choggames.com` | `https://poker.choggames.com` |
| `HUB_URL` | — | `https://choggames.com` (this is the default; set it anyway so it is visible) |
| `HUB_ORIGINS` | — | the hub's Railway domain, e.g. `https://yot-monopoly-production.up.railway.app` — lets the hub show poker's leaderboard on profiles before DNS moves; remove after cutover |
| `DISCORD_PUBLIC_KEY` | the app's **Public Key** (General Information) | **unset** — see section 4 |
| `DISCORD_VERIFY_CHANNEL_ID` | the verify channel (hub's Verify button panel) | the same channel, or a poker one — section 4 |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | where Monopoly results post (optional) | where poker results post (optional) |
| `DISCORD_AUDIT_CHANNEL_ID` | — | the operators-only alerts channel (optional) |

Poker-only extras (`VPN_*`, `PROXYCHECK_API_KEY`, `CHOG_MAX_SOCKETS_PER_IP`)
stay exactly as they are today.

**Check they took.** After each deploy open **Deploy Logs** and find the block
headed `Configuration check` (poker) — a healthy service prints no `!` and no
`✗`. Then open `https://<service domain>/api/health` → `"persistentDisk": true`
on both.

---

## 3. DNS — the domain is at Wix, the DNS moves to Cloudflare

**Why not just use Wix's DNS:** Railway needs a `CNAME` for each address,
and the bare `choggames.com` (the "root" or `@`) cannot be a `CNAME` at Wix —
Wix's DNS has no CNAME flattening or ALIAS records, which is what Railway
requires for a root domain. Subdomains (`www`, `poker`) would work at Wix,
the root would not. Cloudflare's free plan flattens a root `CNAME`
automatically, so the DNS moves there. **The domain stays registered (and
paid for) at Wix**; only who answers DNS changes. (A full transfer away from
Wix is not possible anyway for 60 days after purchase.)

### 3a. Add the domain to Cloudflare

1. Cloudflare → **Add a domain** → `choggames.com` → **Free** plan.
2. Cloudflare scans the existing records. **Delete** any `A`/`CNAME` records
   it imported for `@` and `www` that point at Wix (Wix parking or site).
   Keep any `MX`/`TXT` records if you use email on this domain.
3. Cloudflare shows **two nameservers** (`<name>.ns.cloudflare.com`). Copy them.

### 3b. Point Wix at Cloudflare's nameservers

Wix → **Domains** → `choggames.com` → **⋯ / Manage** → **Advanced** →
**Change nameservers** (or **DNS records → Nameservers → Edit**; the label
moves around) → choose custom nameservers → paste Cloudflare's two → **Save**.
If the domain is connected to a Wix site, Wix asks you to disconnect it first —
do that. Back in Cloudflare press **Check nameservers**; it usually goes
active within an hour (up to 48 h).

**If Wix does not offer a nameserver option** for your domain: ask Wix
support to change the nameservers (they can), or use the fallback in 3d.

### 3c. Records in Cloudflare

Cloudflare → `choggames.com` → **DNS → Records** → **Add record**. The
**Target** values come from Railway → each service → Settings → Networking →
Custom Domain (Railway shows them after you add the domain in section 1).

| Type | Name | Target | Proxy status |
|---|---|---|---|
| `CNAME` | `@` | the value Railway shows for `choggames.com` on the **hub** service | **Proxied** (orange cloud) |
| `CNAME` | `www` | the value Railway shows for `www.choggames.com` on the **hub** service | **Proxied** |
| `CNAME` | `poker` | the value Railway shows for `poker.choggames.com` on the **poker** service | **Proxied** |

Railway may also show a `TXT` record (`_railway-verify…`) per domain: add it
exactly as shown, **DNS only**.

**Add the three `CNAME`s as DNS only (grey cloud) first.** Railway issues
each domain's certificate only once it can see its own records; when a
domain shows as ready (green) in Railway, switch that `CNAME` to **Proxied**.
Then:

- **SSL/TLS → Overview**: **Full** (not Full (strict) — Railway's community
  answers report strict blocking certificate issuance; not Flexible either,
  which loops redirects).
- **Network**: **WebSockets** on (it is by default — both games run on them).
- **Security**: Bot Fight Mode on, Security Level Medium (as poker's DEPLOY.md recommends).

**`TRUSTED_PROXY_HOPS=2` on both services** (section 2). With Cloudflare
proxying in front of Railway there are two proxies between a player and the
app; with `1` both sites record Cloudflare's address instead of the player's,
and IP bans hit the wrong people. The hub's default is `1`, poker's is `2`, so
set it explicitly on both rather than relying on either. If you ever turn the
orange cloud off, change both to `1`. Poker's **Audit → Address check** tab
(the `/api/admin/ipdebug` probe) says in plain words whether the number is
right, by comparing what the proxy reports with what is being recorded.

### 3d. Fallback: stay on Wix DNS (no bare domain)

Only if the nameservers cannot be moved. At Wix → **DNS records** add
`CNAME` `www` → the hub's Railway target and `CNAME` `poker` → poker's
target (plus Railway's `TXT` records). The site then lives at
**`https://www.choggames.com`**; plain `choggames.com` will not reach it.
Adjust section 2 accordingly: hub `PUBLIC_URL=https://www.choggames.com`,
poker `HUB_URL=https://www.choggames.com`, and **`TRUSTED_PROXY_HOPS=1`** on
both (no Cloudflare in front). Only `www.choggames.com` is added as the
hub's custom domain in Railway.

Railway's own `*.up.railway.app` addresses keep working throughout and are
your fallback if DNS misbehaves.

---

## 4. Discord Developer Portal (the one application: the Monopoly bot)

Both sites sign in and run their bot features through the **Monopoly bot**
application. Poker's old (Chekr) application is no longer used once poker's
`DISCORD_*` variables are switched to the Monopoly bot's (section 2).

**Make sure the Monopoly bot can do poker's jobs too.** Poker's bot features
need more than the hub's did:

- Developer Portal → **Bot** → **Privileged Gateway Intents**: **Server
  Members Intent** on (poker's invite tracking and member checks), and
  **Message Content Intent** on (poker's "post the code in the verify
  channel" sign-in reads the code from the message).
- In the Chog server, the bot's role needs: **View Channels**, **Send
  Messages**, **Read Message History**, **Manage Messages** (it tidies code
  messages), **Embed Links**, **Manage Server** (to read invites: who invited
  whom), and **Ban Members** if poker's operators ban from the dashboard.
  Its role must sit **above** the roles of anyone it may need to ban.
- The simplest way to grant all of that: Developer Portal → **OAuth2 → URL
  Generator** → scopes `bot` → tick the permissions above → open the URL →
  pick the Chog server → **Authorize** (re-authorising updates the existing
  bot's permissions; it does not add a second bot).
- After poker deploys with the new token, its **Deploy Logs →
  `Configuration check`** and its dashboard's Discord status say plainly if an
  intent or permission is still missing.
- Once poker runs on the Monopoly bot, **kick the old Chekr poker bot** from
  the Chog server so two bots don't answer the same things.

Players who signed in to poker with Discord before will be asked to approve
the Monopoly bot app once the next time they use "Log in with Discord" on
poker; their account, results and bans are kept (they are keyed by Discord
user id, which is the same whichever app asks).

Application → **OAuth2** → **Redirects** → add, one per line (Discord matches
these as exact text):

```
https://choggames.com/api/auth/discord/callback
https://www.choggames.com/api/auth/discord/callback
https://poker.choggames.com/api/auth/discord/callback
```

Also add poker's **current** addresses (its Railway domain and any old poker
domain — copy them from the old Chekr app's Redirects list) so poker keeps
working before DNS moves, and **keep** the hub's Railway domain:
`https://<hub>.up.railway.app/api/auth/discord/callback`. Each site prints
the exact string to register for the domain you open it on:
`https://<any of them>/api/auth/discord/check`.

**General Information → Interactions Endpoint URL** — this can point at only
**one** service, and it goes on the **hub**:

```
https://choggames.com/api/discord/interactions
```

Save it *after* the hub is deployed with `DISCORD_PUBLIC_KEY` set, or Discord
refuses it. Open that URL in a browser any time: it says which piece is missing.

**What this means for poker.** Button clicks from the Verify panel in Discord
now reach the hub, not poker. Poker's "Verify with a code" has two flows:

- *Verify button → modal* — needs the interactions URL, so it **stops working
  on poker** (a `POKER-` code pasted into the hub's modal is refused as not a
  hub code). That is why `DISCORD_PUBLIC_KEY` is **left unset on poker**:
  with it unset, poker stops telling players to use the button.
- *Post the code as a message in the verify channel* — needs only
  `DISCORD_BOT_TOKEN` + `DISCORD_VERIFY_CHANNEL_ID`, and **keeps working**.
  Delete any old poker Verify-button message from the channel so nobody clicks
  it.

Simpler still: players press **Sign in via Chog Games** on poker, sign in on
the hub (button, code or Discord login — all of them work there) and are sent
straight back to the poker page they were on, signed in. Poker's own "Log in
with Discord" also still works exactly as before.

**Bot**: nothing changes — it is already in the server with Server Members
Intent on.

---

## 5. Cutover, in order

**A day ahead (nothing visible changes):** add `choggames.com` to Cloudflare
and switch Wix's nameservers to it (section 3a–3b), since that can take hours
to go active. Leave Cloudflare without the Railway records for now.

**Freeze first.** Pick a window with no tournament scheduled and none
running, and tell operators not to create one until you say so.

0. **Monopoly bot ready for poker** (section 4): intents on, permissions
   granted, and poker's *current* addresses added to its Redirects. Copy
   poker's old `DISCORD_*` values somewhere safe (rollback).
1. **Hub variables** (section 2), including `APP_SECRET` = poker's
   `CHOG_SECRET`. Deploy the hub. Check `/api/health` on its Railway domain and
   sign in there with Discord.
2. **Re-point the poker service** (section 1b): repo, Root Directory `poker`,
   Watch Paths, auto-deploy off. Set `DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` to the **Monopoly bot's**
   (copy from the hub). Add `HUB_URL`, `HUB_ORIGINS`,
   `TRUSTED_PROXY_HOPS=2`, remove `DISCORD_PUBLIC_KEY`. Press **Deploy**. Watch
   the build finish, then: `/api/health` → `persistentDisk: true`, Deploy Logs
   → `Configuration check` clean, and open poker on its *current* domain — you
   are still signed in (same secret, same volume).
3. **Discord redirects** (section 4) — all of them, before DNS.
4. **DNS** (section 3). Wait for Railway to show each domain as ready.
5. **`PUBLIC_URL`** on both services set to the new addresses (section 2).
6. **Interactions Endpoint URL** → the hub (section 4).
7. **Test the loop**: open `https://poker.choggames.com` in a private window →
   Sign in → *Sign in via Chog Games* → sign in on the hub → you land back on
   poker signed in. Then the other direction: sign out everywhere, sign in on
   poker with Discord, open the hub — signed in. An operator account should
   show **Dashboard** on both.
8. Remove `HUB_ORIGINS` from poker once the hub is on `choggames.com`
   (`HUB_URL` already covers it). Old poker domains can be detached from the
   service a week later, once players have followed the new link.
9. Kick the old Chekr poker bot from the Chog server.
10. Announce. Unfreeze.

**Who gets signed out**

- **Monopoly / Chog Cards players: once**, when the hub's `APP_SECRET` changes
  to poker's value (if the hub was never live before, nobody notices).
- **Poker players: not at all** on the domain they already use — the secret,
  the volume and the browser's stored sign-in are all unchanged. The *new* address
  `poker.choggames.com` is a different site to the browser, so everyone signs
  in there once; "Sign in via Chog Games" makes that one click.
- The exception is the no-`CHOG_SECRET` case in section 0.

**Deploy freeze, standing rule**

- Poker: never deploy from one hour before a tournament until its results are
  posted. Live games survive a restart (they are snapshotted to the volume),
  but every player sees a disconnect and the clock keeps running.
- Hub deploys do not touch poker (separate service, separate container), so
  the hub can ship any time.
- **Never rotate `APP_SECRET`/`CHOG_SECRET` on one service alone.** Changing
  it on both signs *everyone* out of *both* — do it between events, both at once.

**Rollback**

- A bad deploy on either service: Railway → **Deployments** → the previous
  green deployment → **⋯ → Rollback** (or Redeploy). The volume is untouched.
- Poker built from the wrong place: Settings → Source → point **Repository**
  back at the old poker repo (Root Directory empty) and press Deploy. Same
  volume, same data.
- DNS: switch the Cloudflare records back to the old targets (they take
  effect in a minute or two when proxied).
- Discord: poker can go back to the old Chekr app by restoring its old
  `DISCORD_*` values (keep a copy before you overwrite them).
- Do **not** undo the secret unless you must; it signs everyone out again.

---

## For whoever builds the hub's `/sso`

Poker sends the browser to `GET https://choggames.com/sso?return=<URL>` where
`<URL>` is the absolute address of the poker page the player was on
(`encodeURIComponent`'d). The hub should:

1. Accept `return` only when its origin is `https://poker.choggames.com` (and
   whatever other game origins it knows); otherwise ignore it and go home.
2. If the visitor is signed in, redirect to `<return>#dtoken=<token>` using
   the same `signToken` the Discord callback uses. If not, show sign-in and
   do the same once they are.

Poker reads `#dtoken=` on every route, stores it under its own `localStorage`
key, strips the hash, and asks its server who the token is (so operator rights
come from `ADMIN_DISCORD_IDS`, never from the payload). The hub can also read
`https://poker.choggames.com/api/leaderboard` and `/api/results/<id>` from a
browser on `choggames.com` — those two, read-only, and nothing else.
