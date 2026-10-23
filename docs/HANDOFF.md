# Handoff (2026-10-23)

Where Chog Games stands, what's left, and how to finish it. Written so a new session can pick up without the old chat.

## TL;DR: what's left

**Deploy.** Everything is built and pushed on `claude/blissful-edison-6caook`. When this was written, nothing after `5dc1fcc` was live, because Railway had paused all deploys after an upstream issue on its side.

1. **Hub (`yot-monopoly` service):** deploy the latest commit of `claude/blissful-edison-6caook`. It auto-deploys on push once Railway is working again. If it doesn't, deploy by hand (below).
2. **Poker (`chog-poker` service):** auto-deploy is **off** on purpose. Deploy it by hand, **only between tournaments**, because a deploy restarts the server and drops live tables.
3. Check https://choggames.com:
   - the home page shows the video loop behind the hero and the trailer section under the game cards
   - the nav says "Daily challenges"
   - Poker is in the nav
   - https://poker.choggames.com still works

Nothing else is pending.

## Deploying on Railway

### By hand (dashboard)

Open the service, press Ctrl/Cmd-K and choose **Deploy latest commit**.

### From a session (API)

Needs `RAILWAY_TOKEN` in the environment. The user adds it in the Claude Code environment settings. It shows up only in sessions started after it was added. Never ask the user to paste a token into the chat.

- GraphQL endpoint: `https://backboard.railway.app/graphql/v2`
- Account or team token: header `Authorization: Bearer $RAILWAY_TOKEN`
- Project token: header `Project-Access-Token: $RAILWAY_TOKEN` instead

| Service | Project | serviceId | environmentId (production) |
| --- | --- | --- | --- |
| yot-monopoly (hub, choggames.com) | compassionate-warmth | `9ebc0a9e-ab4e-4a67-a4e1-16ae14865bb4` | `0bf8f2be-558e-432a-84a3-c93c59bd56ff` |
| chog-poker (poker.choggames.com) | chic-heart | `fb30fcc7-1e09-423b-b049-6dc9c11086a1` | `e935a00c-e37b-47fd-957f-33baded08ec3` |

Deploy a commit:

```bash
SHA=$(git rev-parse origin/claude/blissful-edison-6caook)
curl -s https://backboard.railway.app/graphql/v2 -H "Authorization: Bearer $RAILWAY_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"query\":\"mutation { serviceInstanceDeployV2(serviceId: \\\"9ebc0a9e-ab4e-4a67-a4e1-16ae14865bb4\\\", environmentId: \\\"0bf8f2be-558e-432a-84a3-c93c59bd56ff\\\", commitSha: \\\"$SHA\\\") }\"}"
```

Check the result:

```graphql
{ deployments(first: 3, input: { serviceId: "<serviceId>" }) { edges { node { id status createdAt meta } } } }
```

If deploys are still paused, the mutation errors or the deploy sits queued. Don't retry every few minutes; the user asked for that explicitly. Retry about hourly, or wait for the user to say Railway is back.

The full setup checklist (domains, variables, Discord, shared secret) is in `docs/CHOGGAMES-DEPLOY.md`.

## Standing rules (from the user)

- **Branch:** work and push only on `claude/blissful-edison-6caook`.
  - Before every push: `git fetch origin claude/blissful-edison-6caook && git merge origin/claude/blissful-edison-6caook`, then `git push -u origin claude/blissful-edison-6caook`.
  - Never push to another branch without asking.
  - No pull requests unless asked.
- **Never name the card game after the commercial game it resembles** (the three-letter brand, spelled U-N-O), anywhere in the repo: code, comments, docs or commit messages. It is "Cards" or "Chog Cards".
- **Process kills:** never use `pkill -f`, because it matches its own shell and kills it. Use `fuser -k PORT/tcp` or kill by pid.
- **Commits:**
  - no model names in commit messages
  - end each commit message with the Co-Authored-By and Claude-Session trailers that the session's system reminder gives
- **Security:** a Railway token was once pasted into chat. It's dead now, but the user should make sure it's revoked.

## What the last session shipped

All of this is on `claude/blissful-edison-6caook`, last commit `f784cd5` or later.

- **Poker in the hub:** the Poker nav item and page are live. Poker is its own service at poker.choggames.com, and sign-in is shared through the same secret and Discord app.
- **Daily challenges:** "dailies" was renamed everywhere players see it: the /daily page, nav, footer, hub link, profile button and SEO title. The user dislikes the word "dailies"; don't bring it back.
- **Trailer and video loop on the home page** (`client/src/components/HomeVideo.tsx`, `client/src/styles/home-video.css`, used in `client/src/pages/Home.tsx`):
  - `HeroLoop`: a silent 3D loop behind the hero (`client/public/video/hero-loop-*`).
  - `TrailerSection`: the 74 s trailer under the game cards. It autoplays muted and has sound and fullscreen buttons (`client/public/video/trailer-*`, poster `trailer-poster.jpg`).
  - Each video comes as a 1080p MP4 plus a 720p MP4 and WebM fallback.
- **Trailer content as approved:**
  - Music is "Spy Jazz", with its ticks tamed.
  - The footsteps are real recordings, synced to the measured footfalls.
  - Captions just say "Monopoly", "Cards" and "Poker".
  - The NFT line reads "Play as your Chog NFT."
  - No "Yot" anywhere: no "Built by Yot" on the end card, no name next to the avatar in the site captures, and the demo player is called "ChogFan".

## Trailer pipeline (only if it has to be rebuilt)

How it works is in `tools/trailer/README.md`, and the audio sources and licenses are in `tools/trailer/audio/README.md`.

The old session's scratch folder is gone. It held:

- the rendered 3D frames (about 2.8 GB of Blender Cycles output)
- the site captures
- the page assets (fonts, textures)

Rebuilding from nothing means re-rendering every shot (hours of CPU), so change the trailer only if the user asks.

The finished files are committed in `client/public/video/`. To tweak only the audio, remux the existing video with `-c:v copy` and a new mix rather than re-rendering.

Capture and render scripts hard-code the old scratch path (`S = /tmp/claude-0/.../scratchpad`). Point them at a new folder before running.
