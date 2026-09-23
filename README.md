# 🎩 Yot Monopoly

A multiplayer 3D property-trading board game for the browser, with custom editions
(the same idea as the poker sites: one codebase, many branded versions).

- **Many games at once**: each table is a room with a 5-letter code and a share link.
  One server runs as many rooms as you like, each with 2–8 players.
- **3D board** (three.js via React Three Fiber): each player picks one of ten procedural
  chibi characters (tinted in their colour) that hop tile by tile, cheer when they buy
  or earn, slump in jail and dance when they win; dice tumble, houses and hotels sit on
  the board, and owned deeds show the owner's colour. Each map has its own surroundings
  (a cosy lounge, a floodlit speedway, a night-time rooftop). Orbit, zoom, and click
  any space for its title deed.
- **Full rules engine**: rent (sets, houses, railroads, utilities), doubles and
  three-doubles jail, jail fines and cards, Chance and Community Chest (all 32 cards),
  auctions, even building, the 32/12 building supply, mortgages, debts, bankruptcy to a
  player or to the bank, and player-to-player trades.
- **House rules** per room: starting cash, Free Parking jackpot, double on GO, auctions
  on or off, even building, limited buildings, max players.
- **Bots** fill empty seats, and they also **autopilot anyone who disconnects** for more
  than 45 seconds, so one dropped phone can't freeze the table. A returning player gets
  their seat back (identity is a random key kept in the browser).
- Works on phones: invite links ask for a name inline, and the HUD folds down.

## Quick start

```bash
npm install
npm run dev        # server on :8080, client on :5173 (proxied)
```

Open http://localhost:5173, create a game, add a bot or two, and start.

```bash
npm test           # engine + room tests, including 40 full bot-vs-bot games
npm run typecheck
npm run build && npm start   # production: server serves the built client on :8080
```

Deploys like the poker sites: `Dockerfile` + `railway.toml` (health check `/api/health`).
It needs **one always-on process** because live games are held in memory.

## Adding an edition

Everything an edition changes lives in [`shared/themes.ts`](shared/themes.ts). Copy the
`YOT` block:

```ts
export const MY_EDITION = edition(CLASSIC, {
  id: 'chog',
  name: 'Chog Edition',
  tagline: '…',
  centerTitle: 'CHOG',
  currency: '$',
  deckNames: { chance: 'Chance', chest: 'Community Chest' },
  names: { 39: 'Chog Tower', 1: '…' },          // rename any space by index
  groupColors: { brown: '#…', /* … */ },         // recolour the sets
  palette: { sky, table, board, boardLine, boardText, accent },
  rules: { freeParkingPot: true },               // default house rules
});
export const THEMES = [CLASSIC, YOT, MY_EDITION];
```

You can also replace `chance`/`chest` with your own card lists (effects are data, see
[`shared/cards.ts`](shared/cards.ts)) or change prices/rents in `spaces`. The engine
never branches on the edition, and the board texture is drawn from this data.

## Architecture

```
shared/
  board.ts        40 spaces as data (prices, rents, groups)
  cards.ts        Chance / Community Chest as data
  themes.ts       editions + house-rule defaults
  types.ts        socket protocol (GameView, Action, RoomView)
server/
  src/engine/game.ts   pure rules state machine (injected RNG + clock, no timers)
  src/engine/bot.ts    bot / autopilot decisions
  src/rooms.ts         rooms & registry: lobby, auction timers, bot pacing, cleanup
  src/sockets.ts       Socket.IO wiring, identity, acks
  test/                node:test suite
client/
  src/three/           3D scene: board texture, layout maths, dice
  src/three/characters/  procedural character models, rig and piece animation
  src/three/environments/ per-map surroundings (lounge, speedway, skyline)
  src/components/      lobby, HUD, deeds, trades, auctions
  src/pages/           home, room
```

The server is authoritative. Clients send `Action`s and render the `GameView` the
server broadcasts after every change.

## Roadmap ideas

- Real 3D assets: characters are built from primitives on a shared rig
  (`client/src/three/characters/looks.tsx`); a GLB per character could replace a look
  without touching the animation. Same for houses and the table.
- Discord sign-in, leaderboard, and operator-only room creation (port from the poker repo).
- Persisting live games across restarts (snapshot `Game` to disk).
- Turn timer, sounds, camera follow.
