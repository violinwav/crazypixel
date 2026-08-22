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
