# CLAUDE.md

FireRed rebuilt in Phaser 3 + TypeScript (Vite). See README.md for setup and architecture.

- Decomp: `/Users/joshua/Coding/PokemonProjects/pret/firered` is the source of truth. Before implementing a mechanic,
  read the corresponding C in `src/` and match it, citing the original function name in a comment where useful.
- Never commit or hand-copy game assets/text into `src/`. Add new data to `tools/extract.py`, which writes to `public/gen/`
  (gitignored), then rerun `npm run extract`.
- Prefer reading constants (behavior ids, etc.) from extracted JSON over hardcoding numbers.
- Game logic ticks at a fixed 60 Hz (`OverworldScene.tick`), so express timings in GBA frames.
- Coordinates: entities use world tile coordinates; map-local = world - chunk origin.
- Verify with `npm run typecheck`, `npm test` (unit) and `npm run test:e2e` (headless playthroughs; see tests/README.md).
  When you check a mechanic at runtime, prefer writing it as an e2e test (tests/e2e/) over a one-off script, so it keeps
  being checked. For quick looks: `?map=Name&x=&y=`, `?start=after-rival` (story preset), `window.game` / `window.__test`
  in dev, and `tools/browser-test.mjs`.
- Keep PROGRESS.md current: tick the checklist, update "Where to resume", and append a log entry for each change.
- Git: never commit (or push). The user makes all commits; leave changes in the working tree.
