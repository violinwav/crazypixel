# Online multiplayer lobbies — design

Date: 2026-08-22

## Goal

Real networked multiplayer: a host creates a room, other players join with a
short code from separate browser windows/machines, and the game plays out
live across clients instead of hotseat-on-one-screen. `packages/server`
(Colyseus, currently a stub) becomes the authority for game state and move
legality; `packages/client` gains an online lobby flow alongside the existing
local hotseat mode.

## Decisions locked in during brainstorming

- **Join mechanism**: room code, not a public room list. The code *is*
  Colyseus's own `room.id` (a short random string it already generates) —
  no custom code-generation/registry needed.
- **State sync**: one `stateJson: string` schema field holding
  `JSON.stringify(GameState)`. The server runs the existing
  `@crazypixel/shared` engine completely unmodified; no per-field
  `@colyseus/schema` mirroring of marbles/hands/piles. Trades fine-grained
  delta compression for much less code and zero drift risk against
  `@crazypixel/shared`'s evolving `GameState` shape.
- **Move authority**: server-authoritative. The server re-derives legal
  moves via `getLegalMoves` and only accepts a submitted move if it matches
  one, and only from the seat whose turn it is.
- **Disconnects**: seat freezes, no reconnect support in this pass. Matches
  "get real multiplayer working" scope — reconnection is real added
  complexity (session tokens, timeout windows) that isn't needed to
  validate the core loop.
- **Room start**: auto-starts the moment all seats (per the host-chosen
  player count) are filled. No manual "ready up" step, no bot fallback for
  empty seats.
- **Rematch**: out of scope. Online `WinScreen` doesn't offer "Play Again";
  players start a fresh room instead.

## Server (`packages/server`)

### `GameRoom.ts` rewrite

Colyseus room state (a `@colyseus/schema` `Schema` subclass, `RoomState`):

```ts
class RoomState extends Schema {
  @type('string') phase: 'waiting' | 'playing' = 'waiting';
  @type('number') playerCount!: number;
  @type('string') mode!: GameMode;
  @type(['number']) colors = new ArraySchema<number>();
  @type(['string']) seatSessionIds = new ArraySchema<string>();
  @type('string') stateJson = '';
}
```

- `onCreate(options)`: `options` = `{ playerCount, mode, colors }` from the
  host's lobby config (same shape `Lobby.tsx` already builds today). Sets
  `maxClients = playerCount`, seeds `RoomState` fields, `phase = 'waiting'`.
  No `GameState` yet — nothing to sync until seats are full.
- `onJoin(client, options)`: push `client.sessionId` onto `seatSessionIds`;
  the index is that client's seat. Send it back explicitly —
  `client.send('assignedSeat', seatIndex)` — rather than making the client
  infer its seat from the schema, since schema sync timing vs. the join
  promise resolving isn't guaranteed-ordered from the client's point of
  view. If `seatSessionIds.length === playerCount`: build
  `createInitialState({ playerCount, mode })`, `startGame(state)`,
  `phase = 'playing'`, `stateJson = JSON.stringify(state)`.
- `onMessage('play', (client, { move }))`:
  1. Reject if `phase !== 'playing'`.
  2. `seat = seatSessionIds.indexOf(client.sessionId)`; reject if
     `seat !== gameState.currentPlayer`.
  3. `candidates = getLegalMoves(gameState, seat, move.card)`; reject
     unless some candidate is deep-equal (`JSON.stringify` compare — `Move`
     is plain data, no functions) to the submitted `move`.
  4. `next = structuredClone(gameState)`; `applyMove(next, seat, move)`;
     `advanceTurn(next)`; `gameState = next`; `stateJson = JSON.stringify(next)`.
  5. On any rejection: `client.send('moveRejected', { reason })`, no state
     change. (Rejections shouldn't happen in normal play since the client
     only ever submits moves the shared engine itself offered — this is a
     backstop against a stale/buggy/malicious client, not expected traffic.)
- `onMessage('passHand', (client))`: same seat/turn check, plus reject
  unless every card in `gameState.hands[seat]` has zero legal moves
  (`getLegalMoves(gameState, seat, card).length === 0` for all). Otherwise
  clone, `passHand`, `advanceTurn`, update `stateJson`.
- `onLeave(client)`: if `phase === 'waiting'`, remove the seat (reopens it
  for another joiner). If `phase === 'playing'`, leave the seat's
  session ID in place but do nothing further — that seat simply never
  sends moves again, consistent with "freezes, no reconnect."

`structuredClone(gameState)` — used once per accepted move at the top
level, not inside `generateSevenSplits`'s internal per-candidate-order
search — is a different, cheap call site from the `stateAfterSegments`
optimization `GameEngine.ts` already warns not to disturb.

### `index.ts`

Unchanged — already wires `GameRoom` to `'game'`.

## Client (`packages/client`)

### New dependency

`colyseus.js` — the client counterpart to the server's existing `colyseus`
package. Needed to open a `Client`, call `create`/`joinById`, and read
schema state changes; nothing else in the client stack covers this.

### `game/network.ts` (new)

Thin wrapper: `connect()` returns a `colyseus.js` `Client` pointed at a
`VITE_SERVER_URL` env var (default `ws://localhost:2567`);
`createRoom(config, colors)` and `joinRoom(code)` return the joined `Room`.

### `Lobby.tsx`

Gains a Local/Online toggle at the top. Local branch is today's existing
flow, untouched. Online branch renders new `OnlineLobby.tsx`.

### `OnlineLobby.tsx` (new)

- **Choose**: "Host a Game" / "Join a Game".
- **Host**: same player-count/mode/color pickers as local Lobby (reused,
  not duplicated — likely a shared sub-component extracted from `Lobby.tsx`
  for the picker UI), then "Create Room" → calls `network.createRoom`.
- **Join**: a code input + "Join" button → calls `network.joinRoom(code)`.
  Invalid/full/missing room → inline error message, stays on the form.
- **Waiting screen** (shared by both paths once a room is joined): shows
  the code (host view only — joiners already used it), a seat list with
  fill state and assigned colors, "waiting for N more players." Watches
  `room.state.phase`; once it flips to `'playing'`, hands the room + this
  client's assigned seat up to `App.tsx` to mount `OnlineGameView`.

### `GameBoard.tsx` (new, extracted from today's `GameView.tsx`)

Pure rendering component, no data-sourcing hooks inside it. Props:
`state, play, passCurrentHand, restart, lastPlanRef, mySeat, colors`. Same
JSX `GameView.tsx` has today, with one behavioral addition: `HandPanel` and
`BoardOverlay` (and the pass control) only render when
`mySeat === state.currentPlayer`; otherwise render a
"Waiting for Player N" message in their place.

*Why gating instead of reworking `HandPanel`/`BoardOverlay`*: both
components hardcode `state.hands[state.currentPlayer]` /
`player = state.currentPlayer` as "the" hand to show and act on — correct
for hotseat, where the active player always *is* whoever's looking at the
screen. Online, that's not true — the viewer isn't necessarily the current
player. Reworking both components to take an independent "viewer seat" vs.
"acting player" would mean plumbing that distinction through
`figureTargets.ts`, `moveTargets.ts`, `SevenSplitOverlay`, and
`StealCardOverlay` too. Gating at `GameBoard` instead means: on your turn,
everything works exactly as it does today (you *are* `state.currentPlayer`,
same code path, zero changes to those components); off your turn, you see
a wait message instead of the board's interactive layer. Trade-off: you
don't see your own hand while waiting — accepted per your review of the
design.

`restart` is only ever passed a real callback from local `GameView`; the
online path passes `undefined`/omits the "Play Again" button in
`WinScreen` (rematch is out of scope, see Decisions).

### `GameView.tsx` (local, shrinks)

Keeps `useGameState(setup.config)`. `mySeat = state.currentPlayer` always
(hotseat: whoever's turn it is is always "you"). Renders `GameBoard`.

### `OnlineGameView.tsx` (new)

Takes `{ room, mySeat, colors }`. Uses new `useOnlineGameState(room)` hook:

- Subscribes to `room.state.listen('stateJson', ...)` (or `onChange`),
  parses `JSON.parse` into `GameState`, stores in React state.
- `play(player, move)` → `room.send('play', { move })` (no local mutation
  — server is authoritative, the UI just waits for the next `stateJson`
  broadcast to reflect it).
- `passCurrentHand()` → `room.send('passHand')`.
- No `restart`, no `lastPlanRef` animation plan (see Testing/scope note
  below) — returns `EMPTY_TURN_ANIMATION` so `GameBoard` doesn't need a
  separate branch for "animations exist" vs. not.
- Returns the same shape `useGameState` does (minus `restart`) so
  `GameBoard` doesn't care which hook produced its props.

### `App.tsx`

Adds a second piece of state alongside `setup: GameSetup | null` — an
`onlineSession: { room: Room; mySeat: PlayerId; colors: number[] } | null`
— set once `OnlineLobby`'s waiting screen sees `phase: 'playing'`. Renders
`OnlineGameView` when that's set, `GameView` when `setup` is set, `Lobby`
otherwise.

## Explicitly out of scope for this pass

- Reconnection after disconnect.
- Rematch/"Play Again" in online mode.
- Public room listing/matchmaking.
- Spectator mode.
- Any server-side persistence (rooms are purely in-memory, gone when empty
  or the process restarts).
- Move/pass animations (`FlyingCard`, `DealAnimation`) driven from server
  state changes — `lastPlanRef` stays local-only; online moves apply
  instantly with no fly/deal animation. Worth a follow-up pass once the
  core networked loop is validated.

## Testing/verification plan

- `cd packages/shared && npx tsc --noEmit`, same for `client` and `server`
  (no single root command — per project convention).
- Manual: run `packages/server` dev server, run `packages/client` dev
  server, open 2+ browser windows, host from one, join with the code from
  the others, play a full round through to a completed turn cycle,
  confirm state matches across windows and turn gating (can't act out of
  turn) holds.
- No automated test suite exists in this repo today for either package —
  not introducing one as part of this feature (matches existing project
  scope; flag to the user separately if they want that established).
