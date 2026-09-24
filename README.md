# CrazyPixel 🎲

A pixel-art web clone of **Brändi Dog** (the Swiss marble-race card game) with a set of
"crazy" house rules layered on top — split sevens, a wild joker, blind steals, and more.
Built as a monorepo: a pure TypeScript rules engine, a React + Phaser client, and a
server-authoritative Colyseus server for online play.

> Not affiliated with Stiftung Brändi. Game rules aren't copyrightable, so the mechanics are
> reimplemented from scratch here — but the name, art, and copy are original to this project,
> deliberately independent of theirs.

## Play it

```bash
npm install
npm run dev:client     # http://localhost:5173
npm run dev:server     # ws://localhost:2567 — only needed for online play
```

Three ways to play, all from the same menu:

- **Singleplayer** — pick a player count (2/3/4/6), fill any seat with an easy, medium, or
  hard bot, and play the rest yourself. Leaving every other seat human makes it a hotseat
  game on one device.
- **Host** — start an online room and share the four-digit code. The room adapts to however
  many people actually join; the host presses Start when everyone's seated.
- **Join** — type a friend's code.
- **Browse Rooms** — see every live room on the server (code, host, mode, headcount) and join
  an open one with a tap. Games already in progress are listed but can't be joined.

Your display name and marble color persist across visits, so they're already filled in next
time.

## The rules

Standard Brändi Dog — race four marbles around a shared track and into your home stretch,
using a deck of playing cards to move — plus these house rules:

| Card | Effect |
|---|---|
| **A / K** | Bring a marble out of your base, or move 1 / 11 (Ace) or 13 (King) spaces. |
| **2** | Move 2 spaces, **or** force an opponent to draw a card blind from your hand. |
| **4** | Move 4 spaces forward or backward. Landing exactly on your own base square while going backward earns entry into your home stretch on a later move, without needing a full extra lap. |
| **7** | Split 7 steps across up to 7 of your (or your partner's) marbles, moved one at a time — you can hop a blocked teammate out of the way and then finish another marble in the same play, but marbles already in the home stretch can't be jumped over. A 7 runs *over* whatever it passes, your own marbles included, so **Auto split** proposes the best way into the goal without costing you one — or, when nothing can finish, the furthest safe advance; press it again to cycle the alternatives, and confirm before anything is played. |
| **8** | Move 8 spaces, **or** replay whatever the previous card did. |
| **J** | Swap the positions of any two marbles on the track (not one still fresh out of the kennel and guarding its own base). |
| **Joker** | Play as any other rank, including starting a marble. |

A marble that has just come out of the kennel onto your base square guards it: nobody can
pass it, land on it or swap it away, including your own other marbles. That protection is
earned by the entry, not by the square - it ends the moment that marble moves off, and a
marble that later laps back round onto its own base is an ordinary target there. A guarded
marble is marked on the board with four corner brackets. Landing on an opponent sends their
marble straight back to their base. A player with no legal move for any card in hand discards
their whole hand and sits out until the next round's redeal.

An in-game **How to play** screen covers every card with an animated diagram on a miniature
board, backed by the same explanation as a written, scrubbable step list — so none of the
above has to be read from this file to start playing.

## Stack

```
packages/shared   pure TypeScript rules engine — deck, board, legal-move generation, move
                  application. No rendering, no network. The client and the server both run
                  this same engine, unmodified.

packages/client   Vite + React + Phaser 3. React owns the lobby and the accessible DOM
                  overlay (hand of cards, tap targets for legal moves); Phaser renders the
                  board itself on a Canvas 2D renderer, with pixel-art sprites generated
                  procedurally (see below), no external art assets.

packages/server   Colyseus. One room type, server-authoritative: a client's move is applied
                  only if the shared engine actually offers it to that seat on its turn.
```

Local and online games render through the same `GameBoard` component, fed either by a local
state hook or by whatever the server broadcasts — so a rule can't behave differently in the
two modes.

## Status

**Playable today:**

- Full games for 2/3/4/6 players, free-for-all or 2v2 partners (partners needs an even count
  of 4 or more), with every house rule above implemented — dealing, round-size cycling,
  capturing, blockades, home-stretch entry, and win detection.
- **Online multiplayer** — host/join by room code, hidden hands, a 20-second turn clock that
  auto-plays a stalled seat, emotes, a server browser of live rooms, and a rematch that
  re-deals to the same table.
- **Reconnect** — a dropped player (backgrounded phone tab, flaky network, page reload) gets
  their seat back automatically: the seat is held for 30 seconds in the lobby and 10 minutes
  mid-game. Past that window the seat freezes and the turn clock plays it. Rematch belongs to
  the lowest still-connected seat, so a host dropping doesn't strand the table.
- **Bots** — three difficulty levels, scoring only moves the engine already declared legal.
- **Sound** — every effect synthesized at play time from oscillators and noise, no audio files.
  A distinct cue per event, including separate ones for a capture, a J-swap, an 8 copying the
  last card, and a marble entering the board. On by default, with a toggle in the menu and on
  the board that persists across visits.
- **Singleplayer turn clock** is optional (nothing is waiting on you), on by default online.

**Not implemented:**

- **Spectators** and any **persistence** — rooms are in-memory and vanish when empty or when
  the process restarts.
- **Card-passing sub-phase** (each player passes one card to their partner before a round, in
  Partners mode). The engine implements it (`passCard`, the `cardPass` phase); no UI reaches
  it yet.
- **Automated tests.** Rules-engine changes are currently verified with throwaway `npx tsx`
  scripts rather than a checked-in suite.

## Design

- Fully custom pixel-art UI: no component library, no external art. Cards, marbles, board
  tiles, and the background are all procedurally generated or hand-styled. One typeface
  throughout — Departure Mono (`packages/client/public/fonts/`, SIL OFL).
- Mobile-first — the whole board and hand panel are built to fit and stay tappable on a
  phone screen, not just scaled down from desktop.
- Every legal move is a real, accessible `<button>` positioned over the board (not a Phaser
  canvas element) — the game is playable with a keyboard or a screen reader, not just a mouse
  or a touchscreen. Turn changes, captures, and emotes are announced through live regions,
  and `prefers-reduced-motion` stops every transition and the dithered background loop. Sound is
  never the only channel: captures and home arrivals are announced as text alongside their cue,
  the turn-clock tone only sounds on your own turn, and nothing plays before a real gesture.

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
npm run dev:server     # game server, ws://localhost:2567
npm run build          # builds shared, then client, then server
npm run typecheck      # shared package only — see below
```

The client finds the server by deriving it from wherever the page was loaded (so a LAN IP or
a forwarded-port tunnel works without configuration). Deployments that split the two across
unrelated domains set `VITE_SERVER_URL` at build time.

`npm run typecheck` covers `packages/shared` only. Typecheck the other two from inside their
own package directories:

```bash
cd packages/client && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
```
