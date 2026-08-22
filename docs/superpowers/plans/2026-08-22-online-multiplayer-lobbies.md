# Online Multiplayer Lobbies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real networked multiplayer — a host creates a room, others join from separate browser windows with a short code, and the game plays out live across clients instead of hotseat-on-one-screen.

**Architecture:** `packages/server`'s `GameRoom` becomes server-authoritative, running the unmodified `@crazypixel/shared` engine and broadcasting `GameState` as one JSON string schema field. `packages/client` gains an online lobby flow (host/join by room code — the code *is* Colyseus's own `room.id`) alongside the existing local hotseat mode, sharing rendering via a new `GameBoard` component extracted from today's `GameView`.

**Tech Stack:** Colyseus (`colyseus` + `@colyseus/schema`, already present server-side), new `colyseus.js` client dependency, React, TypeScript.

**Verification convention (this repo has no test suite — see CLAUDE.md):** every task's step is `npx tsc --noEmit` in the touched package, not a unit test. Task 15 is a manual multi-window browser pass, per CLAUDE.md's own "run the dev server and check it in an actual browser" convention for UI/networking changes.

**Known simplifications vs. the design doc** (both harmless, noted for transparency):
1. Seat assignment doesn't use a separate `assignedSeat` message — the client computes `mySeat` reactively as `seatSessionIds.indexOf(room.sessionId)` off `room.onStateChange`, which is simpler and equally correct since Colyseus flushes `phase` and `stateJson` together in one patch.
2. `VITE_SERVER_URL` env var is dropped in favor of a hardcoded `ws://localhost:2567` constant in `game/network.ts` — no deployment target exists yet, and adding Vite env typing for one constant not otherwise needed is out of scope.

---

### Task 1: Add `colyseus.js` client dependency

**Files:**
- Modify: `packages/client/package.json`

- [ ] **Step 1: Add the dependency**

Add `"colyseus.js": "^0.15.0"` to `dependencies` in `packages/client/package.json`, alongside `phaser`/`react`/`react-dom` (matches the server's `colyseus ^0.15.39` protocol version).

- [ ] **Step 2: Install**

Run: `npm install --workspace packages/client`
Expected: installs `colyseus.js` into `packages/client/node_modules` (hoisted to root `node_modules` in this npm workspaces setup), no errors.

- [ ] **Step 3: Commit**

```bash
git add package-lock.json packages/client/package.json
git commit -m "client: add colyseus.js dependency for online play"
```

---

### Task 2: Server-authoritative `GameRoom`

**Files:**
- Modify: `packages/server/src/rooms/GameRoom.ts`

- [ ] **Step 1: Replace the file contents**

```ts
import { Room, Client } from 'colyseus';
import { Schema, type, ArraySchema } from '@colyseus/schema';
import {
  createInitialState, startGame, getLegalMoves, applyMove, advanceTurn, passHand,
} from '@crazypixel/shared';
import type { GameConfig, GameMode, GameState, Move, PlayerId } from '@crazypixel/shared';

/**
 * Networked room state kept deliberately thin - the actual GameState (marbles/hands/piles/
 * etc.) is synced as one JSON string, not mirrored field-by-field into Schema classes. See
 * docs/superpowers/specs/2026-08-22-online-multiplayer-lobbies-design.md for why: the shared
 * engine's GameState shape can keep evolving without this room needing a matching schema
 * change every time, at the cost of whole-state (not delta) sync per move.
 */
class RoomState extends Schema {
  @type('string') phase: 'waiting' | 'playing' = 'waiting';
  @type('number') playerCount = 4;
  @type('string') mode: GameMode = 'ffa';
  @type(['number']) colors = new ArraySchema<number>();
  @type(['string']) seatSessionIds = new ArraySchema<string>();
  @type('string') stateJson = '';
}

interface CreateOptions {
  playerCount: GameConfig['playerCount'];
  mode: GameMode;
  colors: number[];
}

interface PlayMessage {
  move: Move;
}

/**
 * Server-authoritative game room: re-derives legal moves via the shared engine before
 * accepting anything a client sends, so a stale/buggy/malicious client can't desync the
 * game or move out of turn. `room.id` (Colyseus's own short random ID) doubles as the
 * "room code" players share to join - no separate code registry.
 */
export class GameRoom extends Room<RoomState> {
  private gameState: GameState | null = null;

  onCreate(options: CreateOptions) {
    this.maxClients = options.playerCount;
    this.setState(new RoomState());
    this.state.playerCount = options.playerCount;
    this.state.mode = options.mode;
    options.colors.forEach((c) => this.state.colors.push(c));

    this.onMessage('play', (client, message: PlayMessage) => this.handlePlay(client, message));
    this.onMessage('passHand', (client) => this.handlePassHand(client));
  }

  onJoin(client: Client) {
    this.state.seatSessionIds.push(client.sessionId);

    if (this.state.seatSessionIds.length === this.state.playerCount) {
      const config: GameConfig = { playerCount: this.state.playerCount as GameConfig['playerCount'], mode: this.state.mode };
      const state = createInitialState(config);
      startGame(state);
      this.gameState = state;
      this.state.phase = 'playing';
      this.state.stateJson = JSON.stringify(state);
    }
  }

  onLeave(client: Client) {
    // Mid-game disconnects intentionally freeze the seat rather than reopening it or
    // supporting reconnect - out of scope for this pass (see design doc). Only a seat that
    // never made it into a started game gets removed, so a later joiner can take it.
    if (this.state.phase !== 'waiting') return;
    const index = this.state.seatSessionIds.indexOf(client.sessionId);
    if (index !== -1) this.state.seatSessionIds.splice(index, 1);
  }

  private seatFor(client: Client): PlayerId | null {
    const index = this.state.seatSessionIds.indexOf(client.sessionId);
    return index === -1 ? null : (index as PlayerId);
  }

  private handlePlay(client: Client, { move }: PlayMessage) {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;

    const candidates = getLegalMoves(state, seat, move.card);
    const isLegal = candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(move));
    if (!isLegal) return;

    const next = structuredClone(state);
    applyMove(next, seat, move);
    advanceTurn(next);
    this.gameState = next;
    this.state.stateJson = JSON.stringify(next);
  }

  private handlePassHand(client: Client) {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;

    const hasLegalMove = state.hands[seat].some((card) => getLegalMoves(state, seat, card).length > 0);
    if (hasLegalMove) return;

    const next = structuredClone(state);
    passHand(next, seat);
    advanceTurn(next);
    this.gameState = next;
    this.state.stateJson = JSON.stringify(next);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/rooms/GameRoom.ts
git commit -m "server: make GameRoom server-authoritative and networked"
```

---

### Task 3: Extract `PlayerSetupPicker` from `Lobby.tsx`

**Files:**
- Create: `packages/client/src/PlayerSetupPicker.tsx`

This pulls the player-count/mode/color picking UI (and its color-swap-on-conflict logic) out of `Lobby.tsx` into a controlled component, so both the local lobby and the new online host flow can use it without duplicating that logic.

- [ ] **Step 1: Create the file**

```tsx
import { partnerOf } from '@crazypixel/shared';
import type { GameConfig, GameMode, PlayerId } from '@crazypixel/shared';
import { PALETTE } from './game/theme';

export interface PlayerSetup {
  config: GameConfig;
  colors: number[];
}

interface Props {
  value: PlayerSetup;
  onChange: (setup: PlayerSetup) => void;
}

const PLAYER_COUNTS: GameConfig['playerCount'][] = [2, 4, 6];
const COLOR_HEX = PALETTE.players.map((c) => `#${c.toString(16).padStart(6, '0')}`);
const COLOR_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'];

export function defaultColors(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function PlayerSetupPicker({ value, onChange }: Props) {
  const { config, colors } = value;
  const { playerCount, mode } = config;

  const handlePlayerCount = (count: GameConfig['playerCount']) => {
    // Partner offset is playerCount/2 - with only 2 seats that's each player's *only*
    // opponent, a degenerate "partner", so teams isn't a real option at 2.
    onChange({ config: { playerCount: count, mode: count === 2 ? 'ffa' : mode }, colors: defaultColors(count) });
  };

  const handleMode = (nextMode: GameMode) => {
    onChange({ config: { ...config, mode: nextMode }, colors });
  };

  const handleColorPick = (seat: number, colorIndex: number) => {
    const next = [...colors];
    const conflictSeat = next.findIndex((c) => c === colorIndex);
    if (conflictSeat !== -1 && conflictSeat !== seat) {
      next[conflictSeat] = next[seat]; // swap, so two seats never share a color
    }
    next[seat] = colorIndex;
    onChange({ config, colors: next });
  };

  const seats = Array.from({ length: playerCount }, (_, i) => i);

  return (
    <>
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Players</h2>
        <div role="group" aria-label="Player count" className="lobby__choices">
          {PLAYER_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              className="cp-button"
              aria-pressed={playerCount === count}
              onClick={() => handlePlayerCount(count)}
            >
              {count}
            </button>
          ))}
        </div>
      </section>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Mode</h2>
        <div role="group" aria-label="Game mode" className="lobby__choices">
          <button
            type="button"
            className="cp-button"
            aria-pressed={mode === 'ffa'}
            onClick={() => handleMode('ffa')}
          >
            Free for all
          </button>
          <button
            type="button"
            className="cp-button"
            aria-pressed={mode === 'teams'}
            disabled={playerCount === 2}
            onClick={() => handleMode('teams')}
          >
            Partners
          </button>
        </div>
        <p className="lobby__hint">
          {playerCount === 2
            ? 'Teams need 4 or 6 players.'
            : mode === 'teams'
              ? 'Seats across the table team up - every marble home for both partners wins it.'
              : 'Every player for themselves.'}
        </p>
      </section>

      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Colors</h2>
        <div className="lobby__seats">
          {seats.map((seat) => {
            const partner = mode === 'teams' ? partnerOf(config, seat as PlayerId) : null;
            return (
              <div key={seat} role="group" aria-label={`Player ${seat + 1} color`} className="lobby__seat">
                <span className="lobby__seat-label">
                  Player {seat + 1}
                  {partner !== null && <span className="lobby__seat-partner"> · partners P{partner + 1}</span>}
                </span>
                <div className="lobby__swatches">
                  {COLOR_HEX.map((hex, colorIndex) => (
                    <button
                      key={colorIndex}
                      type="button"
                      className="lobby__swatch"
                      style={{ backgroundColor: hex }}
                      aria-pressed={colors[seat] === colorIndex}
                      aria-label={COLOR_NAMES[colorIndex]}
                      onClick={() => handleColorPick(seat, colorIndex)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: errors only in `Lobby.tsx` (still on the old inline picker, fixed in Task 6) - none in the new file itself.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/PlayerSetupPicker.tsx
git commit -m "client: extract PlayerSetupPicker from Lobby for reuse"
```

---

### Task 4: Networking wrapper

**Files:**
- Create: `packages/client/src/game/network.ts`

- [ ] **Step 1: Create the file**

```ts
import { Client, Room } from 'colyseus.js';
import type { GameMode } from '@crazypixel/shared';
import type { PlayerSetup } from '../PlayerSetupPicker';

const SERVER_URL = 'ws://localhost:2567';

export interface RoomState {
  phase: 'waiting' | 'playing';
  playerCount: number;
  mode: GameMode;
  colors: number[];
  seatSessionIds: string[];
  stateJson: string;
}

export function createRoom({ config, colors }: PlayerSetup): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.create<RoomState>('game', {
    playerCount: config.playerCount,
    mode: config.mode,
    colors,
  });
}

export function joinRoom(code: string): Promise<Room<RoomState>> {
  const client = new Client(SERVER_URL);
  return client.joinById<RoomState>(code.trim());
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/game/network.ts
git commit -m "client: add colyseus room create/join wrapper"
```

---

### Task 5: `OnlineLobby` (host/join UI + waiting room)

**Files:**
- Create: `packages/client/src/OnlineLobby.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PlayerId } from '@crazypixel/shared';
import { createRoom, joinRoom } from './game/network';
import type { RoomState } from './game/network';
import { PlayerSetupPicker, defaultColors } from './PlayerSetupPicker';
import type { PlayerSetup } from './PlayerSetupPicker';

export interface OnlineSession {
  room: Room<RoomState>;
  mySeat: PlayerId;
  colors: number[];
}

interface Props {
  onReady: (session: OnlineSession) => void;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'hostConfig'; setup: PlayerSetup }
  | { kind: 'joinCode'; code: string; error: string | null }
  | { kind: 'connecting' }
  | { kind: 'waiting'; room: Room<RoomState>; isHost: boolean };

export function OnlineLobby({ onReady }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'choose' });

  if (step.kind === 'choose') {
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Online</h2>
        <div className="lobby__choices">
          <button
            type="button"
            className="cp-button"
            onClick={() => setStep({
              kind: 'hostConfig',
              setup: { config: { playerCount: 4, mode: 'ffa' }, colors: defaultColors(4) },
            })}
          >
            Host a Game
          </button>
          <button type="button" className="cp-button" onClick={() => setStep({ kind: 'joinCode', code: '', error: null })}>
            Join a Game
          </button>
        </div>
      </section>
    );
  }

  if (step.kind === 'hostConfig') {
    const { setup } = step;
    return (
      <>
        <PlayerSetupPicker value={setup} onChange={(next) => setStep({ kind: 'hostConfig', setup: next })} />
        <button
          type="button"
          className="cp-button lobby__start"
          onClick={() => {
            setStep({ kind: 'connecting' });
            createRoom(setup)
              .then((room) => setStep({ kind: 'waiting', room, isHost: true }))
              .catch(() => setStep({ kind: 'hostConfig', setup }));
          }}
        >
          Create Room
        </button>
      </>
    );
  }

  if (step.kind === 'joinCode') {
    return (
      <section className="cp-panel lobby__section">
        <h2 className="lobby__heading">Join a Game</h2>
        <input
          type="text"
          className="lobby__code-input"
          value={step.code}
          placeholder="Room code"
          aria-label="Room code"
          onChange={(e) => setStep({ kind: 'joinCode', code: e.target.value, error: null })}
        />
        {step.error && <p className="lobby__error">{step.error}</p>}
        <button
          type="button"
          className="cp-button"
          disabled={step.code.trim().length === 0}
          onClick={() => {
            const { code } = step;
            setStep({ kind: 'connecting' });
            joinRoom(code)
              .then((room) => setStep({ kind: 'waiting', room, isHost: false }))
              .catch(() => setStep({ kind: 'joinCode', code, error: 'Room not found or full.' }));
          }}
        >
          Join
        </button>
      </section>
    );
  }

  if (step.kind === 'connecting') {
    return <p className="lobby__hint">Connecting…</p>;
  }

  return <WaitingRoom room={step.room} isHost={step.isHost} onReady={onReady} />;
}

function WaitingRoom({ room, isHost, onReady }: { room: Room<RoomState>; isHost: boolean; onReady: Props['onReady'] }) {
  const [, forceRender] = useState(0);
  // Guards onReady (a real side effect - hands the finished session up to App, which
  // unmounts this whole lobby tree) against firing twice, same pattern as
  // BoardOverlay.tsx's autoPlayedKeyRef - see CLAUDE.md's StrictMode double-invoke note.
  const readyFiredRef = useRef(false);

  useEffect(() => {
    const handleChange = () => forceRender((n) => n + 1);
    room.onStateChange(handleChange);
    // No unsubscribe - this room lives for the whole online session once joined, same
    // lifecycle convention as GameView's Phaser instance.
  }, [room]);

  useEffect(() => {
    if (readyFiredRef.current) return;
    if (room.state.phase !== 'playing') return;
    const seatIndex = Array.from(room.state.seatSessionIds).indexOf(room.sessionId);
    if (seatIndex === -1) return;
    readyFiredRef.current = true;
    onReady({ room, mySeat: seatIndex as PlayerId, colors: Array.from(room.state.colors) });
  });

  const filledSeats = room.state.seatSessionIds.length;
  const totalSeats = room.state.playerCount;

  return (
    <section className="cp-panel lobby__section">
      <h2 className="lobby__heading">Waiting for players</h2>
      {isHost && (
        <>
          <p className="lobby__hint">Share this code:</p>
          <p className="lobby__code">{room.id}</p>
        </>
      )}
      <div className="lobby__seats">
        {Array.from({ length: totalSeats }, (_, i) => (
          <div key={i} className="lobby__seat">
            <span className={`lobby__seat-label${i < filledSeats ? '' : ' lobby__seat-label--empty'}`}>
              Player {i + 1} {i < filledSeats ? '- connected' : '- waiting...'}
            </span>
          </div>
        ))}
      </div>
      <p className="lobby__hint">{filledSeats} / {totalSeats} players connected.</p>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/OnlineLobby.tsx
git commit -m "client: add OnlineLobby host/join/waiting-room flow"
```

---

### Task 6: Wire the Local/Online toggle into `Lobby.tsx`

**Files:**
- Modify: `packages/client/src/Lobby.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useState } from 'react';
import { PlayerSetupPicker, defaultColors } from './PlayerSetupPicker';
import type { PlayerSetup } from './PlayerSetupPicker';
import { OnlineLobby } from './OnlineLobby';
import type { OnlineSession } from './OnlineLobby';

export type { PlayerSetup as GameSetup } from './PlayerSetupPicker';

interface Props {
  onStart: (setup: PlayerSetup) => void;
  onOnlineReady: (session: OnlineSession) => void;
}

export function Lobby({ onStart, onOnlineReady }: Props) {
  const [mode, setMode] = useState<'local' | 'online'>('local');
  const [setup, setSetup] = useState<PlayerSetup>({
    config: { playerCount: 4, mode: 'ffa' },
    colors: defaultColors(4),
  });

  return (
    <main className="lobby">
      <h1 className="cp-title lobby__title">CRAZYPIXEL</h1>
      <p className="lobby__subtitle">
        {mode === 'local'
          ? 'Singleplayer demo - one screen, hotseat local play.'
          : 'Host a room or join one with a code to play online.'}
      </p>

      <div role="group" aria-label="Play mode" className="lobby__choices lobby__mode-toggle">
        <button type="button" className="cp-button" aria-pressed={mode === 'local'} onClick={() => setMode('local')}>
          Local
        </button>
        <button type="button" className="cp-button" aria-pressed={mode === 'online'} onClick={() => setMode('online')}>
          Online
        </button>
      </div>

      {mode === 'local' ? (
        <>
          <PlayerSetupPicker value={setup} onChange={setSetup} />
          <button type="button" className="cp-button lobby__start" onClick={() => onStart(setup)}>
            Start Game
          </button>
        </>
      ) : (
        <OnlineLobby onReady={onOnlineReady} />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: errors remaining only in `App.tsx` (still calling `<Lobby onStart={setSetup} />` without `onOnlineReady`, fixed in Task 12) - none in `Lobby.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/Lobby.tsx
git commit -m "client: add Local/Online toggle to Lobby"
```

---

### Task 7: Make `WinScreen`'s "Play Again" optional

**Files:**
- Modify: `packages/client/src/WinScreen.tsx`

Online play has no rematch in this pass (see design doc's out-of-scope list) - the button just doesn't render when no callback is supplied.

- [ ] **Step 1: Edit the props type and render**

Change:
```ts
interface Props {
  state: GameState;
  colors: number[];
  onPlayAgain: () => void;
}
```
to:
```ts
interface Props {
  state: GameState;
  colors: number[];
  onPlayAgain?: () => void;
}
```

Change:
```tsx
        <div className="win-screen__actions">
          <button type="button" className="cp-button" onClick={onPlayAgain}>
            Play Again
          </button>
          <button type="button" className="cp-button" onClick={backToLobby}>
            Change Settings
          </button>
        </div>
```
to:
```tsx
        <div className="win-screen__actions">
          {onPlayAgain && (
            <button type="button" className="cp-button" onClick={onPlayAgain}>
              Play Again
            </button>
          )}
          <button type="button" className="cp-button" onClick={backToLobby}>
            Change Settings
          </button>
        </div>
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/WinScreen.tsx
git commit -m "client: make WinScreen's Play Again optional for online play"
```

---

### Task 8: Extract `GameBoard` from `GameView`

**Files:**
- Create: `packages/client/src/GameBoard.tsx`

Pure rendering component - no `useGameState`/`useOnlineGameState` call inside it, just props. Adds one behavioral change over today's `GameView` body: the hand panel, board overlay, and pass-hand control only render when `mySeat === state.currentPlayer` (see design doc's "gating instead of reworking HandPanel/BoardOverlay" rationale). For local hotseat play, `mySeat` is always `state.currentPlayer` (set that way in Task 9), so this is a no-op there - behavior is unchanged.

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { trackLengthFor } from '@crazypixel/shared';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';
import { createPhaserGame } from './game/PhaserGame';
import type { PhaserBridge } from './game/PhaserGame';
import type { TurnAnimation } from './game/animationPlan';
import { computeBoardGeometry, discardPileCenter, drawPileCenter } from './game/boardLayout';
import { HandPanel } from './HandPanel';
import { BoardOverlay } from './BoardOverlay';
import { BoardStatus } from './BoardStatus';
import { TurnLabel } from './TurnLabel';
import { FlyingCard } from './FlyingCard';
import type { FlightPlan } from './FlyingCard';
import { DealAnimation } from './DealAnimation';
import type { DealPlan } from './DealAnimation';
import { WinScreen } from './WinScreen';

interface Props {
  state: GameState;
  play: (player: PlayerId, move: Move) => void;
  passCurrentHand: () => void;
  restart?: () => void;
  lastPlanRef: RefObject<TurnAnimation>;
  mySeat: PlayerId;
  colors: number[];
}

export function GameBoard({ state, play, passCurrentHand, restart, lastPlanRef, mySeat, colors }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handPanelRef = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [flight, setFlight] = useState<FlightPlan | null>(null);
  const [dealPlan, setDealPlan] = useState<DealPlan | null>(null);
  const dealtRoundRef = useRef<number | null>(null);

  const isMyTurn = mySeat === state.currentPlayer;

  useEffect(() => {
    if (!containerRef.current || bridgeRef.current) return;
    bridgeRef.current = createPhaserGame(containerRef.current);
    bridgeRef.current.setColorAssignment(colors);
    // No cleanup/destroy on purpose - see GameView's original comment (StrictMode's
    // dev-only double-invoke tearing down a Phaser.Game mid-boot leaves an orphaned
    // canvas). GameBoard is mounted once per game session and never unmounts during
    // normal use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bridgeRef.current?.setGameState(state, lastPlanRef.current);
  }, [state, lastPlanRef]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setSelectedCardId(null), [state.currentPlayer]);

  useEffect(() => {
    if (dealtRoundRef.current === state.roundIndex) return;
    if (!containerRef.current || !handPanelRef.current || containerSize.width === 0) return;
    dealtRoundRef.current = state.roundIndex;
    const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config));
    const containerRect = containerRef.current.getBoundingClientRect();
    const deckPoint = drawPileCenter(geo);
    const handRect = handPanelRef.current.getBoundingClientRect();
    setDealPlan({
      cards: state.hands[state.currentPlayer],
      from: { x: containerRect.left + deckPoint.x, y: containerRect.top + deckPoint.y },
      to: { x: handRect.left, y: handRect.top + handRect.height / 2, width: handRect.width },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.roundIndex, containerSize]);

  const lastMoveAnnouncement =
    state.lastPlayedCard && state.lastPlayedBy !== null
      ? `Player ${state.lastPlayedBy + 1} played ${state.lastPlayedCard.rank}${state.lastPlayedCard.suit ? ` of ${state.lastPlayedCard.suit}` : ''}.`
      : '';

  const selectedCard = state.hands[state.currentPlayer].find((c) => c.id === selectedCardId) ?? null;

  const handlePlay = (player: PlayerId, move: Move) => {
    const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${move.card.id}"]`);
    const containerEl = containerRef.current;
    if (cardEl && containerEl && containerSize.width > 0) {
      const fromRect = cardEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config));
      const dest = discardPileCenter(geo);
      setFlight({
        card: move.card,
        from: { x: fromRect.left, y: fromRect.top, width: fromRect.width, height: fromRect.height },
        to: { x: containerRect.left + dest.x, y: containerRect.top + dest.y },
      });
    }
    play(player, move);
  };

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <h1 className="visually-hidden">CrazyPixel</h1>
      <div
        ref={containerRef}
        role="img"
        aria-label={`Game board. Player ${state.currentPlayer + 1}'s turn.`}
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        {isMyTurn && (
          <BoardOverlay state={state} selectedCard={selectedCard} containerSize={containerSize} onPlay={handlePlay} />
        )}
        {isMyTurn && <BoardStatus state={state} containerSize={containerSize} onPassHand={passCurrentHand} />}
      </div>
      {/* Board state changes are driven from here, not narrated by the canvas itself - the
          canvas has no way to expose that to assistive tech, this text does. */}
      <p aria-live="polite" className="visually-hidden">
        {lastMoveAnnouncement}
      </p>
      <TurnLabel player={state.currentPlayer} />
      <div ref={handPanelRef} className="hand-panel-slot" style={{ opacity: dealPlan ? 0 : 1 }}>
        {isMyTurn ? (
          <HandPanel state={state} selectedCardId={selectedCardId} onSelectCard={setSelectedCardId} />
        ) : (
          <p className="lobby__hint online-wait-message">Waiting for Player {state.currentPlayer + 1}...</p>
        )}
      </div>
      {flight && <FlyingCard plan={flight} onDone={() => setFlight(null)} />}
      {dealPlan && <DealAnimation plan={dealPlan} onDone={() => setDealPlan(null)} />}
      <WinScreen state={state} colors={colors} onPlayAgain={restart} />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: no errors from this file (errors persist in `GameView.tsx` until Task 9).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/GameBoard.tsx
git commit -m "client: extract GameBoard, gated by mySeat, from GameView"
```

---

### Task 9: Shrink `GameView` to a thin `useGameState` + `GameBoard` wrapper

**Files:**
- Modify: `packages/client/src/GameView.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useGameState } from './game/useGameState';
import { GameBoard } from './GameBoard';
import type { GameSetup } from './Lobby';

interface Props {
  setup: GameSetup;
}

export function GameView({ setup }: Props) {
  const { state, play, passCurrentHand, restart, lastPlanRef } = useGameState(setup.config);
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      restart={restart}
      lastPlanRef={lastPlanRef}
      mySeat={state.currentPlayer}
      colors={setup.colors}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: errors remaining only in `App.tsx` (Task 12) - none in `GameView.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/GameView.tsx
git commit -m "client: shrink GameView to a GameBoard wrapper"
```

---

### Task 10: `useOnlineGameState` hook

**Files:**
- Create: `packages/client/src/game/useOnlineGameState.ts`

- [ ] **Step 1: Create the file**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';
import type { Room } from 'colyseus.js';
import type { RoomState } from './network';
import { EMPTY_TURN_ANIMATION } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

// Server is authoritative here - play/passCurrentHand only ever send the intent over the
// network; the resulting GameState comes back through room.onStateChange, never mutated
// locally. lastPlanRef stays EMPTY_TURN_ANIMATION always: unlike the local engine, this
// hook only sees before/after GameState snapshots for OTHER players' moves, not the Move
// itself, so it has nothing to build a real movement-path animation plan from (see design
// doc's out-of-scope note on server-driven animations).
export function useOnlineGameState(room: Room<RoomState>) {
  const [state, setState] = useState<GameState>(() => JSON.parse(room.state.stateJson) as GameState);
  const lastPlanRef = useRef<TurnAnimation>(EMPTY_TURN_ANIMATION);

  useEffect(() => {
    const applyStateJson = () => {
      if (!room.state.stateJson) return;
      setState(JSON.parse(room.state.stateJson) as GameState);
    };
    room.onStateChange(applyStateJson);
    // No unsubscribe - this hook lives for the whole online game session, same lifecycle
    // convention as GameView's Phaser instance and OnlineLobby's WaitingRoom listener.
  }, [room]);

  const play = useCallback((player: PlayerId, move: Move) => {
    room.send('play', { move });
  }, [room]);

  const passCurrentHand = useCallback(() => {
    room.send('passHand');
  }, [room]);

  return { state, play, passCurrentHand, lastPlanRef };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/game/useOnlineGameState.ts
git commit -m "client: add useOnlineGameState hook sourced from Colyseus room"
```

---

### Task 11: `OnlineGameView`

**Files:**
- Create: `packages/client/src/OnlineGameView.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useOnlineGameState } from './game/useOnlineGameState';
import { GameBoard } from './GameBoard';
import type { OnlineSession } from './OnlineLobby';

interface Props {
  session: OnlineSession;
}

export function OnlineGameView({ session }: Props) {
  const { state, play, passCurrentHand, lastPlanRef } = useOnlineGameState(session.room);
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      lastPlanRef={lastPlanRef}
      mySeat={session.mySeat}
      colors={session.colors}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/client && npx tsc --noEmit`
Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/OnlineGameView.tsx
git commit -m "client: add OnlineGameView"
```

---

### Task 12: Wire it all up in `App.tsx`

**Files:**
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { useState } from 'react';
import { Lobby } from './Lobby';
import type { GameSetup } from './Lobby';
import type { OnlineSession } from './OnlineLobby';
import { GameView } from './GameView';
import { OnlineGameView } from './OnlineGameView';
import { PixelDither } from './PixelDither';

export default function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);

  let content;
  if (onlineSession) {
    content = <OnlineGameView session={onlineSession} />;
  } else if (setup) {
    content = <GameView setup={setup} />;
  } else {
    content = <Lobby onStart={setSetup} onOnlineReady={setOnlineSession} />;
  }

  return (
    <>
      <PixelDither className="app-background" />
      <div className="app-content">{content}</div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck all three packages**

Run: `cd packages/shared && npx tsc --noEmit`
Run: `cd packages/client && npx tsc --noEmit`
Run: `cd packages/server && npx tsc --noEmit`
Expected: no errors anywhere - this is the point where the whole feature compiles end to end.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/App.tsx
git commit -m "client: wire online session flow into App"
```

---

### Task 13: CSS for the new lobby UI

**Files:**
- Modify: `packages/client/src/styles/theme.css`

- [ ] **Step 1: Add new rules**

Insert after the existing `.lobby__start` rule (before `.win-screen`):

```css
.lobby__mode-toggle {
  margin-bottom: 4px;
}

.lobby__code-input {
  font-family: var(--cp-font-body);
  font-size: 1rem;
  min-height: var(--target-min-touch);
  padding: 0.5em 0.8em;
  background: var(--bg-raised);
  color: var(--ink);
  border: 3px solid var(--ink-dim);
  width: 100%;
  max-width: 240px;
}

.lobby__code-input:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.lobby__error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--player-red);
}

.lobby__code {
  font-family: var(--cp-font-display);
  font-size: 1.4rem;
  letter-spacing: 2px;
  text-align: center;
  padding: 10px;
  background: var(--bg-raised);
  border: 3px solid var(--ink-dim);
}

.lobby__seat-label--empty {
  color: var(--ink-dim);
}

.online-wait-message {
  text-align: center;
  padding: 12px;
}
```

- [ ] **Step 2: Visual check**

Run: `npm run dev:client` (from repo root) and `npm run dev:server` in a second terminal, open `http://localhost:5173`, click "Online," confirm the toggle/host/join/waiting screens render legibly (monochrome panel styling, no unstyled `<input>`).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/styles/theme.css
git commit -m "client: style the online lobby UI"
```

---

### Task 14: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

Makes it unambiguous what's actually implemented vs. still stubbed, per your request.

- [ ] **Step 1: Replace the `packages/server` bullet in the Architecture section**

Find:
```markdown
- **`packages/server`** boots (Express + Colyseus) but doesn't route real games yet. Treat it
  as a stub unless the user explicitly asks to wire up online play.
```

Replace with:
```markdown
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
```

- [ ] **Step 2: Add a client architecture note about the online lobby**

Find the `packages/client` bullet's opening line:
```markdown
- **`packages/client`** splits rendering across two layers that share one coordinate system
```

After that bullet's existing content (before the `packages/server` bullet), add a new bullet:
```markdown
- **Local vs. online play in the client** share one rendering component,
  `GameBoard.tsx`, fed either by `useGameState` (local hotseat, mutates a local
  `GameState` clone per turn) or `useOnlineGameState` (online, sends `play`/`passHand`
  messages to the server and re-renders off whatever `GameState` comes back - never
  mutates locally). `GameBoard` takes a `mySeat` prop and only renders the hand panel and
  board overlay when `mySeat === state.currentPlayer` - correct by construction for local
  hotseat (`mySeat` is always set to `state.currentPlayer` there) and how online play hides
  other players' hands (you see your own hand only on your turn; a "Waiting for Player N"
  message shows the rest of the time - see the design doc for the trade-off). Move/deal fly-
  in animations exist online too since they're driven by local click position / `roundIndex`
  changes, not server-synced - but the marble-path walk animation (`lastPlanRef`) is always
  empty online, since the client only sees before/after state snapshots for other players'
  moves, not the `Move` itself.
```

- [ ] **Step 3: Update the "Verifying changes" section's UI note if needed**

Read the current "Verifying changes" section - no change needed if it already says to run the dev server and check in a browser (it does); this task is just the two Architecture edits above.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe implemented online multiplayer in CLAUDE.md"
```

---

### Task 15: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start both dev servers**

Run (terminal 1): `npm run dev:server`
Expected: `crazypixel server listening on ws://localhost:2567`

Run (terminal 2): `npm run dev:client`
Expected: Vite dev server on `http://localhost:5173`

- [ ] **Step 2: Host a 2-player room**

Open `http://localhost:5173` in browser window A. Click "Online" → "Host a Game" → pick 2 players → "Create Room". Confirm a room code renders and the waiting screen shows "1 / 2 players connected."

- [ ] **Step 3: Join from a second window**

Open a second browser window (or an incognito window) B at the same URL. Click "Online" → "Join a Game", enter the code from A, click "Join". Confirm both windows transition to the game board once the second seat fills, and each window shows a different "whose turn" state (one interactive, one showing "Waiting for Player N...").

- [ ] **Step 4: Play a few turns across windows**

Play a card in whichever window currently shows the interactive hand/board. Confirm the *other* window's board updates to match (marble positions, discard pile, whose turn it now is) without a page reload. Confirm the previously-active window now shows "Waiting for Player N..." and can't interact.

- [ ] **Step 5: Confirm turn gating holds**

In the non-active window, confirm there's no way to select a card or click a board target (hand panel isn't rendered there at all).

- [ ] **Step 6: Confirm local hotseat mode still works unmodified**

From the lobby, choose "Local" instead of "Online," start a game, confirm hotseat play behaves exactly as before (every turn's hand panel and board overlay are interactive, since `mySeat` always equals `state.currentPlayer` there).

No commit for this task - it's a verification pass. If any step fails, fix the underlying issue and re-run from Task 15 Step 1 rather than patching around it.
