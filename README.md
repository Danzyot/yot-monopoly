# Chog Games

Multiplayer browser games starring Chog. Play free at **[choggames.com](https://choggames.com)**.

- **Monopoly**: 3D property trading on three boards, against friends or bots.
- **Cards**: a fast shedding card game for 2–10 players, with a chaos mode.
- **Poker**: No-Limit Hold'em tournaments.

Also: daily challenges with streaks and leaderboards, Discord sign-in shared across all three games, and Chog NFT holders can play as their own Chog.

## Stack

TypeScript everywhere. React, Three.js and Vite on the client; Node, Express and Socket.IO on the server. The 3D assets are made in Blender, and everything is hosted on Railway.

```
client/   hub front end (Monopoly, Cards, home, daily challenges)
server/   hub server
shared/   game rules and types used by both
poker/    poker app (own client and server)
tools/    Blender asset scripts and the trailer
```

## Run locally

Needs Node 22.

```
npm install
npm run dev          # hub: http://localhost:5173 (name-only sign-in in dev)
npm test
```

To run poker: `cd poker && npm install && npm run dev`.

## Credits

The trailer music is "Spy Jazz" by SergeQuadrado (Pixabay). Sound effects are from Kenney, Freesound (CC0) and Pixabay.
