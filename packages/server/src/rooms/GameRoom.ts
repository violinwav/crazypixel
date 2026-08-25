import { Room, Client } from 'colyseus';
import type { Delayed } from 'colyseus';
import { Schema, type, ArraySchema } from '@colyseus/schema';
import {
  createInitialState, startGame, getLegalMoves, applyMove, advanceTurn, passHand,
} from '@crazypixel/shared';
import type { GameConfig, GameMode, GameState, Move, PlayerId } from '@crazypixel/shared';

const TURN_MS = 20_000;

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
  @type(['string']) playerNames = new ArraySchema<string>();
  @type('string') stateJson = '';
  /** Epoch ms when the current turn auto-plays if nobody acts - see scheduleTurnTimeout.
   * 0 before the game starts. Purely informational for clients (TurnTimerBar.tsx); the
   * server-side clock.setTimeout below is what actually enforces it. */
  @type('number') turnDeadline = 0;
}

interface CreateOptions {
  playerCount: GameConfig['playerCount'];
  mode: GameMode;
  hostHue: number;
}

interface PlayMessage {
  move: Move;
}

interface SetColorMessage {
  hue: number;
}

interface JoinOptions {
  displayName: string;
}

/** Seat 0 (the host) is the only seat that exists at room creation, so it's the only one
 * that can arrive with a chosen hue - every other seat defaults to an evenly-spread hue
 * (same spread as the client's defaultColors, PlayerSetupPicker.tsx) and picks its real
 * color after joining, via handleSetColor. Color is a continuous hue now, not a pick from a
 * fixed palette, so unlike the old version there's no need to keep hues distinct/unique. */
function seedColors(playerCount: number, hostHue: number): number[] {
  const colors = Array.from({ length: playerCount }, (_, i) => Math.round((360 / playerCount) * i));
  colors[0] = hostHue;
  return colors;
}

/**
 * Server-authoritative game room: re-derives legal moves via the shared engine before
 * accepting anything a client sends, so a stale/buggy/malicious client can't desync the
 * game or move out of turn. `room.id` (Colyseus's own short random ID) doubles as the
 * "room code" players share to join - no separate code registry.
 *
 * Every turn gets a 20s clock (TURN_MS) - see scheduleTurnTimeout/autoPlayTurn. This also
 * means a mid-game disconnect (see onLeave) doesn't stall the game forever: the frozen
 * seat's turn still times out and auto-plays like anyone else's.
 */
export class GameRoom extends Room<RoomState> {
  private gameState: GameState | null = null;
  private turnTimeout: Delayed | null = null;

  onCreate(options: CreateOptions) {
    this.maxClients = options.playerCount;
    this.setState(new RoomState());
    this.state.playerCount = options.playerCount;
    this.state.mode = options.mode;
    seedColors(options.playerCount, options.hostHue).forEach((c) => this.state.colors.push(c));

    this.onMessage('play', (client, message: PlayMessage) => this.handlePlay(client, message));
    this.onMessage('passHand', (client) => this.handlePassHand(client));
    this.onMessage('setColor', (client, message: SetColorMessage) => this.handleSetColor(client, message));
  }

  onJoin(client: Client, options: JoinOptions) {
    const seatIndex = this.state.seatSessionIds.length;
    this.state.seatSessionIds.push(client.sessionId);
    this.state.playerNames.push(options.displayName?.trim() || `Player ${seatIndex + 1}`);

    if (this.state.seatSessionIds.length === this.state.playerCount) {
      const config: GameConfig = { playerCount: this.state.playerCount as GameConfig['playerCount'], mode: this.state.mode };
      const state = createInitialState(config);
      startGame(state);
      this.gameState = state;
      this.state.phase = 'playing';
      this.state.stateJson = JSON.stringify(state);
      this.scheduleTurnTimeout();
    }
  }

  onLeave(client: Client) {
    // Mid-game disconnects intentionally freeze the seat rather than reopening it or
    // supporting reconnect - out of scope for this pass (see design doc). Only a seat that
    // never made it into a started game gets removed, so a later joiner can take it.
    if (this.state.phase !== 'waiting') return;
    const index = this.state.seatSessionIds.indexOf(client.sessionId);
    if (index !== -1) {
      this.state.seatSessionIds.splice(index, 1);
      this.state.playerNames.splice(index, 1);
    }
  }

  private seatFor(client: Client): PlayerId | null {
    const index = this.state.seatSessionIds.indexOf(client.sessionId);
    return index === -1 ? null : (index as PlayerId);
  }

  /** Clones the current state, lets `mutate` apply one turn's effect, advances to the next
   * player, commits it as the new authoritative state, and re-arms the turn clock -
   * shared by a real player's move/pass and the auto-play fallback so all three stay in
   * sync about what "committing a turn" means. */
  private commitTurn(mutate: (next: GameState) => void) {
    const state = this.gameState;
    if (!state) return;
    const next = structuredClone(state);
    mutate(next);
    advanceTurn(next);
    this.gameState = next;
    this.state.stateJson = JSON.stringify(next);
    this.scheduleTurnTimeout();
  }

  private scheduleTurnTimeout() {
    this.turnTimeout?.clear();
    this.state.turnDeadline = Date.now() + TURN_MS;
    this.turnTimeout = this.clock.setTimeout(() => this.autoPlayTurn(), TURN_MS);
  }

  /** 20s elapsed with no move from the current player - play the first card in their hand
   * that has any legal move (hand order, not sorted), picking randomly among that card's
   * own legal moves ("random marble"), or pass if nothing in hand is playable. Also what
   * quietly keeps a game moving when the current seat belongs to a disconnected client. */
  private autoPlayTurn() {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = state.currentPlayer;

    let chosen: Move | null = null;
    for (const card of state.hands[seat]) {
      const legal = getLegalMoves(state, seat, card);
      if (legal.length > 0) {
        chosen = legal[Math.floor(Math.random() * legal.length)];
        break;
      }
    }

    this.commitTurn((next) => {
      if (chosen) applyMove(next, seat, chosen);
      else passHand(next, seat);
    });
  }

  private handlePlay(client: Client, { move }: PlayMessage) {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;

    const candidates = getLegalMoves(state, seat, move.card);
    const isLegal = candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(move));
    if (!isLegal) return;

    this.commitTurn((next) => applyMove(next, seat, move));
  }

  private handlePassHand(client: Client) {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;

    const hasLegalMove = state.hands[seat].some((card) => getLegalMoves(state, seat, card).length > 0);
    if (hasLegalMove) return;

    this.commitTurn((next) => passHand(next, seat));
  }

  /** Only legal pre-game (colors are fixed once play starts, matching how config/mode also
   * can't change mid-game). No uniqueness check - two seats landing on the same or a nearby
   * hue is the players' own choice now that color is continuous, not a fixed 6-entry
   * palette (see seedColors above). */
  private handleSetColor(client: Client, { hue }: SetColorMessage) {
    if (this.state.phase !== 'waiting') return;
    if (!Number.isInteger(hue) || hue < 0 || hue >= 360) return;
    const seat = this.seatFor(client);
    if (seat === null) return;

    this.state.colors[seat] = hue;
  }
}
