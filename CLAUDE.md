# Chog Games (choggames.com)

A browser games hub (Monopoly, Cards, Poker) with the purple Chog mascot. There are two Railway services from this one repo:

- the hub (repo root, service `yot-monopoly`)
- Chog Poker (`poker/`, service `chog-poker`)

**Start with `docs/HANDOFF.md`.** It covers the current state, what's left (deploying), the Railway service IDs, the deploy API call, and the trailer pipeline. `docs/CHOGGAMES-DEPLOY.md` is the full setup checklist.

## Rules from the owner

- **Branch:** work and push only on `claude/blissful-edison-6caook`.
  - Before every push: `git fetch origin claude/blissful-edison-6caook && git merge origin/claude/blissful-edison-6caook`, then `git push -u origin claude/blissful-edison-6caook`.
  - Never push to another branch without asking. No pull requests unless asked.
- **Card game name:** never name it after the commercial game it resembles (the three-letter brand, spelled U-N-O), anywhere: code, comments, docs or commits. Say "Cards" or "Chog Cards".
- **Daily challenges:** call the daily puzzles "daily challenges", never "dailies".
- **Deploys:**
  - The hub auto-deploys on push.
  - Poker deploys by hand, only between tournaments.
  - Deploy from a session needs `RAILWAY_TOKEN` from the environment settings. Never ask for a token in chat.
  - When Railway is down, don't poll it often.
- **Process kills:** never use `pkill -f`. Use `fuser -k PORT/tcp` or kill by pid.
- **Commits:** no model names in commit messages, PR text or code.

## Checks before pushing

- `npm run typecheck`, which covers the server and client
- `npm test`, the server tests
- `npm run build`, the client build
