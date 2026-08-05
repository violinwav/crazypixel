# CrazyPixel 🎲

A pixel-art web clone of **Brändi Dog** (the Swiss marble-race card game) with a set of
"crazy" house rules layered on top — split sevens, a wild joker, blind steals, and more.
Built as a monorepo: a pure TypeScript rules engine, a React + Phaser client, and a Colyseus
server skeleton for future online play.

> Not affiliated with Stiftung Brändi. Game rules aren't copyrightable, so the mechanics are
> reimplemented from scratch here — but the name, art, and copy are original to this project,
> deliberately independent of theirs.

## Play it

Local hotseat only for now — 2, 4, or 6 players pass one device around.

```bash
npm install
npm run dev:client
```

Open `http://localhost:5173`, pick a player count and mode (free-for-all or 2v2 partners),
and start playing.

## The rules

Standard Brändi Dog — race four marbles around a shared track and into your home stretch,
using a deck of playing cards to move — plus these house rules:

| Card | Effect |
|---|---|
| **A / K** | Bring a marble out of your base, or move 1 / 11 (Ace) or 13 (King) spaces. |
| **2** | Move 2 spaces, **or** force an opponent to draw a card blind from your hand. |
| **4** | Move 4 spaces forward or backward. Landing exactly on your own base square while going backward earns entry into your home stretch on a later move, without needing a full extra lap. |
| **7** | Split 7 steps across up to 7 of your (or your partner's) marbles, moved one at a time — you can hop a blocked teammate out of the way and then finish another marble in the same play, but marbles already in the home stretch can't be jumped over. |
| **8** | Move 8 spaces, **or** replay whatever the previous card did. |
| **J** | Swap the positions of any two marbles on the track (not your own marble still guarding its base). |
| **Joker** | Play as any other rank, including starting a marble. |

A marble sitting on your own base square blocks that square for everyone, including your own
other marbles. Landing on an opponent sends their marble straight back to their base. A
player with no legal move for any card in hand discards their whole hand and sits out until
the next round's redeal.

## Stack

```
packages/shared   pure TypeScript rules engine — deck, board, legal-move generation, move
                   application. No rendering, no network. Framework-agnostic by design so
                   the same engine can run authoritatively on a future server.

packages/client    Vite + React + Phaser 3. React owns the lobby and the accessible DOM
                   overlay (hand of cards, tap targets for legal moves); Phaser renders the
                   board itself on a Canvas 2D renderer, hand-drawn pixel-art sprites
                   generated procedurally (see below), no external art assets.

packages/server     Colyseus skeleton for future online multiplayer. Boots, but isn't wired
                   to real games yet — see Status.
```

## Status

**Playable today:** full local hotseat games for 2/4/6 players, free-for-all or 2v2 partners,
with every house rule above implemented — deck/dealing, round-size cycling, capturing,
blockades, home-stretch entry, and win detection.

**Not implemented:**

- **Online multiplayer.** `packages/server` boots but isn't wired to real games — state isn't
  yet expressed as `@colyseus/schema`, and no moves are routed through it. The shared engine
  was written so this is additive, not a rewrite: a real game room would call the same
  `getLegalMoves` / `applyMove` the client already uses locally.
- **Card-passing sub-phase** (each player passes one card to their partner before a round
  starts, in Partners mode) — a real rule, not yet wired to any UI.

## Design

- Fully custom pixel-art UI: no component library, no external art. Cards, marbles, board
  tiles, and the background are all procedurally generated or hand-styled.
- Mobile-first — the whole board and hand panel are built to fit and stay tappable on a
  phone screen, not just scaled down from desktop.
- Every legal move is a real, accessible `<button>` positioned over the board (not a Phaser
  canvas element) — the game is playable with a keyboard or a screen reader, not just a mouse
  or a touchscreen.

### Sprite art

`packages/client/scripts/generate-sprites.py` procedurally draws every sprite (card faces,
card backs, board tiles, marbles) with Pillow — no AI image generation, and no hand-drawn
image files checked into the repo. Regenerate after a palette tweak:

```bash
cd packages/client/scripts
python3 generate-sprites.py   # requires: pip install pillow
```

Output goes to `packages/client/public/sprites/`, loaded once at boot by `TableScene`.

## Development

```bash
npm install
npm run dev:client     # client dev server, http://localhost:5173
npm run dev:server     # server skeleton, ws://localhost:2567 (boots, not yet playable)
npm run build           # builds shared, then client, then server
npm run typecheck       # typechecks the shared package
```

The client and server packages typecheck on their own via `npx tsc --noEmit` inside each
package directory (`packages/client`, `packages/server`).
