# CrazyPixel

Pixel-art, retro-styled take on the Swiss card/board game *Brändi Dog*, with two house rules:

- **2**: move 2, or force an opponent to draw a card.
- **8**: move 8, or replay the effect of whatever card was played last.

Not affiliated with Stiftung Brändi. Game mechanics aren't copyrightable, so the rules are
reimplemented from scratch here — but the artwork, text and the "Brändi" name are original
to Stiftung Brändi. Keep this project's name/art/copy independent of theirs, especially if
it ever goes public.

## Stack

- **packages/shared** — pure TypeScript rules engine (deck, board, legal moves, move
  application). No rendering or network code. Runs identically on the client (local play)
  and, later, inside the server room (as the authority for online play).
- **packages/client** — Vite + React shell around a Phaser 3 canvas. React owns menus/lobby
  (cheap to build there, and where session/join-code UI will live later); Phaser owns the
  board.
- **packages/server** — Colyseus skeleton. Boots, not wired to real games yet — see Status.

## Running it

```bash
npm install
npm run dev:client   # http://localhost:5173
npm run dev:server   # ws://localhost:2567 (boots, not yet playable)
```

## Status

**Implemented:** deck/dealing, round size cycling (6→5→4→3→2), starting marbles, normal
movement with landing capture, the start-square blockade, the Jack swap, the 7-card split
(with its pass-over capture), and both custom rules (2 and 8).

**Not implemented yet:**

- **Home stretch entry / win condition.** The source rulebook's wording on exactly when a
  marble may leave the main loop for home was ambiguous in translation — marbles currently
  just loop the 64-square track forever. See the TODO in `GameEngine.ts`. Needs a rules
  clarification pass before the game is actually winnable.
- **Turn order enforcement / Zugzwang** (must play a legal move if one exists). The engine
  exposes `getLegalMoves`; nothing yet forces the UI/room to use it.
- **Online sessions.** `packages/server` boots but `GameRoom` just holds a fresh game state.
  State isn't yet expressed as `@colyseus/schema` (needed for real client-server sync), and
  no moves are wired through it. The shared engine was written so this is additive, not a
  rewrite — the room will call the same `getLegalMoves` / `applyMove` used locally today.

## Assumptions worth double-checking against your own read of the rules

- Copying an 8 with another 8 is disallowed (must move 8 instead) — avoids open-ended
  recursion, wasn't specified in the source text.
- Custom 2's "draw opponent's card" targets any player on the other team, chosen by the
  player who played the 2.
- The blockade blocks *everyone*, including the guarding player's own other marbles, per a
  literal read of "auch für die eigenen gesperrt."

## Design system

- Palette, fonts and component styles live in `packages/client/src/styles/theme.css` and
  `packages/client/src/game/theme.ts` (canvas needs the colors as numbers, CSS needs them as
  strings — kept in sync by hand for now).
- Display font (`Press Start 2P`) is reserved for short titles/headers — it's unreadable at
  body-text sizes. Everything else uses `Pixelify Sans`, which is still pixel-styled but
  legible at small sizes.
- Card suits are distinguished by glyph shape (♠ ♥ ♦ ♣), not color alone.
