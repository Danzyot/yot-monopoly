# Browser captures for the trailer

- `site/` — the site and its games captured from local production builds with a frozen clock
  (1/24 s per frame). `capture-all.sh` starts and seeds throwaway servers (local-only secrets),
  captures every sequence to `<scratch>/bl/screens/<name>/` and stops them.
- `chog-page/` — a page that renders NFT-trait Chogs with the game's own character code, with
  `window.draw(t)` for frame-exact output (`?mode=run` or `?mode=turn&token=N`). It has to live inside
  `client/` for its imports to resolve: copy it to `client/.film/chog/` (git-excluded) to use it.
- `chog/` — `render-chog.mjs` steps that page frame by frame; `render-all.sh` renders the run and the
  turn sequences; `footcheck.mjs` checks planted feet don't slide.

The scripts carry the scratch paths of the session that made them; adjust `S` at the top before re-running.
