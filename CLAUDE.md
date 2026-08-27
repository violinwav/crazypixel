# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repo.

## What this is

CrazyPixel — a pixel-art web clone of Brändi Dog (Swiss marble-race card game) with house
rules layered on top (split 7s, wild joker, blind steal, etc. — full list in `README.md`).
Monorepo: `packages/shared` (rules engine) → `packages/client` (React + Phaser UI) →
`packages/server` (Colyseus, runs real networked multiplayer). Local hotseat play and
online multiplayer (host/join by room code) both work today - see Architecture below.

## Design Context

(Full version in `.impeccable.md`, kept for the `impeccable` skill family.)

- **Users**: small friend groups, hotseat on one device or remote via room code, often on
  phones — the pregame menu is frequently one-handed while a friend reads out a code.
- **Personality**: retro-arcade terminal. Blocky, monochrome UI chrome (color is reserved
  for cards and marbles, never decoration) — booting into a cabinet, not a modern app.
- **Font**: single family throughout — **Departure Mono** (`public/fonts/`, SIL OFL),
  replacing the old Press Start 2P / Pixelify Sans pairing. One face carries title, body,
  and buttons; hierarchy comes from size/weight/spacing, not a second font.
- **Anti-reference**: generic SaaS dashboards, glassmorphism, gradient text — none of it
  fits a terminal/arcade voice.

## Architecture

- **`packages/shared`** is the single source of truth for every rule. Pure TypeScript, no
  React/Phaser/DOM imports. `GameEngine.ts` mutates `GameState` in place by design (see
  below) — `getLegalMoves(state, player, card)` enumerates legal `Move`s, `applyMove` commits
  one. The client never re-derives a rule the engine already knows; it calls into
  `getLegalMoves`/`planMovement` to preview paths and highlight targets.
- **`packages/client`** splits rendering across two layers that share one coordinate system
  (`game/boardLayout.ts`'s `computeBoardGeometry`):
  - Phaser (`TableScene.ts`) draws the board, marbles, and cards on a `Canvas2D` renderer
    (`Phaser.CANVAS`, not WebGL — chosen for reliability, don't switch it without a reason).
  - A React DOM layer (`BoardOverlay.tsx` + friends) sits on top, rendering real
    `<button>`s positioned to match what Phaser drew, so every legal move is a keyboard/
    screen-reader-operable element, not just a canvas pixel.
  Both read the same `computeBoardGeometry(width, height, trackLength)` so a track square's
  Phaser position and its DOM hit-target always agree.
  - **Local vs. online play share one rendering component**, `GameBoard.tsx`, fed either by
    `useGameState` (local hotseat, mutates a local `GameState` clone per turn) or
    `useOnlineGameState` (online, sends `play`/`passHand` messages to the server and
    re-renders off whatever `GameState` comes back - never mutates locally). `GameBoard`
    takes a `mySeat` prop and only renders the hand panel and board overlay when
    `mySeat === state.currentPlayer` - correct by construction for local hotseat (`mySeat`
    is always `state.currentPlayer` there) and how online play hides other players' hands
    (you see your own hand only on your turn; a "Waiting for Player N" message shows the
    rest of the time). The marble-path walk animation (`lastPlanRef`) is always empty
    online - the client only sees before/after `GameState` snapshots for other players'
    moves, not the `Move` itself, so there's nothing to build a real path animation from.
- **`packages/server`** runs real networked multiplayer via a single Colyseus room,
  `GameRoom.ts`. It's server-authoritative: it runs the unmodified `@crazypixel/shared`
  engine and only accepts a client's `play`/`passHand` message if `getLegalMoves` actually
  offers that move to that seat on its turn. Room state syncs as one `stateJson` field
  (`JSON.stringify(GameState)`), not per-field `@colyseus/schema` mirroring - see
  `docs/superpowers/specs/2026-08-22-online-multiplayer-lobbies-design.md` for why. The
  join "code" players share is just Colyseus's own `room.id`; there's no separate
  matchmaking/room-list registry. **Not implemented:** reconnect after a disconnect (a
  dropped seat just freezes mid-game), rematch/"Play Again" in online mode, spectators, and
  any persistence (rooms are in-memory, gone when empty or the process restarts).

## Non-obvious things that will bite you

- **React 18 StrictMode double-invokes.** State updaters *and* effects with no cleanup run
  twice in dev. `useGameState.ts` clones state before mutating specifically so the engine's
  in-place mutation stays safe under StrictMode's double-invoke. Any new `useEffect` that
  calls something with a real side effect (like `onPlay`, which advances the turn) needs a
  `useRef` guard, or it silently fires twice — this has caused a real "turn skips a player"
  bug in this codebase before. Search this file's history / `BoardOverlay.tsx` for
  `autoPlayedKeyRef` for the pattern.
- **`pointer-events: none` on `.board-overlay`.** The overlay container disables pointer
  events so path/figure decorations don't block clicks through to the board, but that means
  every *real* interactive element inside it (buttons, the Back button, etc.) needs an
  explicit `pointer-events: auto` or it renders but silently can't be tapped.
- **7-split legality is sequential, not independent.** `generateSevenSplits` in
  `GameEngine.ts` has to consider that earlier segments of the same play change what later
  segments can legally do (e.g. moving a blocking marble out of the way first, then finishing
  another marble through the now-clear square) — and has to search execution *order*, not
  just which marble gets how many steps, since only some orders are legal. It uses a
  lightweight partial state clone (`stateAfterSegments`, marbles-only, not the full
  `GameState`) for performance — don't swap that back to `structuredClone(state)`, it made an
  8-marble split take ~17s instead of well under 100ms.
- **CSS cascade order for hand cards.** `.playing-card.hand-panel__card` is a deliberate
  combined selector, not two separate rules — a plain `.playing-card` rule elsewhere in the
  file has equal specificity and *will* win on file order alone if this gets split apart,
  silently breaking responsive card sizing on narrow viewports.
- **Backward movement (the 4 card) never enters home directly.** It's a plain wraparound walk
  around the track; landing exactly on your own base square by going backward earns the
  *right* to enter home on a later, separate forward move — `planMovement` doesn't special-
  case this at all, it falls out of the ordinary forward-overflow-into-home branch for free.
- **`@colyseus/schema`'s `@type` decorators need `experimentalDecorators: true` *and*
  `useDefineForClassFields: false`.** Both set in `packages/server/tsconfig.json` for
  `GameRoom.ts`'s `RoomState` class. Missing the second one is the nastier failure mode: it
  doesn't error anywhere, decorators still apply, `onStateChange` still fires on clients -
  but every field decorated with `@type(...)` and given a class-field default
  (`@type('string') phase = 'waiting'`) silently decodes as `undefined` on every client
  forever, because TS's ES2022+ native class-field init (`useDefineForClassFields: true`,
  the default at `target: "ES2022"`) overwrites the property descriptor the decorator set
  up. Confirmed via a throwaway `colyseus.js` script connecting two clients and logging
  `room.state` before/after - don't trust reasoning alone on this one, the actual decoded
  values are the only way to tell "silently broken" from "working."

## Conventions

- No comments that restate what code does — only ones explaining *why*, especially for the
  gotchas above. Match that style in new code.
- Don't add a dependency (npm package, UI library) without checking it's actually needed —
  this project is deliberately dependency-light (Phaser + React + `colyseus.js`, nothing
  else on the client).
- Sprites are procedurally generated (`packages/client/scripts/generate-sprites.py`, Pillow),
  never hand-drawn image files or AI-generated art. Palette lives in three places kept in
  sync by hand: `styles/theme.css` (CSS strings), `game/theme.ts` (hex, for Phaser), and the
  sprite script (RGB tuples). Change a color in one, update the other two.

## Verifying changes

- Typecheck each package independently — there's no single root command that checks all
  three:
  ```bash
  cd packages/shared && npx tsc --noEmit
  cd packages/client && npx tsc --noEmit
  cd packages/server && npx tsc --noEmit
  ```
- For rules-engine changes, prefer a quick throwaway script over trusting reasoning alone —
  `npx tsx` against `packages/shared/src/index.ts` directly (see git history for examples of
  constructing a `GameState` by hand and calling `getLegalMoves`/`planMovement`). This is how
  several real bugs in the 7-split and home-stretch logic were actually confirmed and
  verified fixed in this project, not just reasoned about.
- For UI changes, run the dev server and check it in an actual browser — this is a game with
  a lot of positioning/animation logic (board geometry, overlay targets, deal/capture
  animations) that's easy to get subtly wrong in a way TypeScript won't catch.
