import { Room, Client } from 'colyseus';
import type { Delayed } from 'colyseus';
import { Schema, type, ArraySchema } from '@colyseus/schema';
import {
  createInitialState, startGame, getLegalMoves, applyMove, advanceTurn, passHand,
} from '@crazypixel/shared';
import type { GameConfig, GameMode, GameState, Move, PlayerId } from '@crazypixel/shared';

const TURN_MS = 20_000;
// The shared engine's board layout is generic to any player count (see boardLayout.ts's
// computeBoardGeometry - plain division/trig, no per-count branching), so an online lobby
// doesn't need to fix a target headcount up front the way local hotseat does: it just
// accepts joins up to this cap and starts with however many are actually seated.
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

function isValidHue(hue: unknown): hue is number {
  return typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue < 360;
}

/**
 * Networked room state kept deliberately thin - the actual GameState (marbles/hands/piles/
 * etc.) is synced as one JSON string, not mirrored field-by-field into Schema classes. See
 * docs/superpowers/specs/2026-08-22-online-multiplayer-lobbies-design.md for why: the shared
 * engine's GameState shape can keep evolving without this room needing a matching schema
 * change every time, at the cost of whole-state (not delta) sync per move.
 */
class RoomState extends Schema {
  @type('string') phase: 'waiting' | 'playing' = 'waiting';
  @type('string') mode: GameMode = 'ffa';
  @type(['number']) colors = new ArraySchema<number>();
  @type(['string']) seatSessionIds = new ArraySchema<string>();
  @type(['string']) playerNames = new ArraySchema<string>();
  /** The short code players actually share to join (see generateCode below) - room.id
   * itself is still colyseus's own long internal id, never shown to a player. */
  @type('string') code = '';
  @type('string') stateJson = '';
  /** Epoch ms when the current turn auto-plays if nobody acts - see scheduleTurnTimeout.
   * 0 before the game starts. Purely informational for clients (TurnTimerBar.tsx); the
   * server-side clock.setTimeout below is what actually enforces it. */
  @type('number') turnDeadline = 0;
}

interface CreateOptions {
  mode: GameMode;
  hue: number;
}

interface PlayMessage {
  move: Move;
}

interface SetColorMessage {
  hue: number;
}

interface JoinOptions {
  displayName: string;
  hue: number;
}

// In-process registry of codes currently in use, so two simultaneously-open rooms can't
// collide - reserved in onCreate, released in onDispose. Deliberately not a persistent/
// shared store (matches this project's existing "no separate matchmaking registry"
// simplicity - see the class doc below): fine for one server process, which is all this
// project runs.
const activeCodes = new Set<string>();

function generateCode(): string {
  let code: string;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (activeCodes.has(code));
  activeCodes.add(code);
  return code;
}

/**
 * Server-authoritative game room: re-derives legal moves via the shared engine before
 * accepting anything a client sends, so a stale/buggy/malicious client can't desync the
 * game or move out of turn. `state.code` (see generateCode above) is the short code players
 * share to join - matched server-side via filterBy(['code']), see index.ts - not
 * `room.id`, colyseus's own long internal id, which is never shown to a player.
 *
 * The game doesn't auto-start the instant every seat fills - seat 0 (the host) has to send
 * 'startGame' (see handleStartGame), same as the local hotseat lobby's own explicit Start
 * Game button. Gives every joining player a moment to actually look at and adjust their own
 * color before play begins, instead of it starting under them mid-pick.
 *
 * Every turn gets a 20s clock (TURN_MS) - see scheduleTurnTimeout/autoPlayTurn. This also
 * means a mid-game disconnect (see onLeave) doesn't stall the game forever: the frozen
 * seat's turn still times out and auto-plays like anyone else's.
 */
export class GameRoom extends Room<RoomState> {
  private gameState: GameState | null = null;
  private turnTimeout: Delayed | null = null;

  async onCreate(options: CreateOptions) {
    this.maxClients = MAX_PLAYERS;
    this.setState(new RoomState());
    this.state.mode = options.mode;
    this.state.code = generateCode();
    // A *top-level* field on the room listing, not this.setMetadata() (which nests under
    // listing.metadata) - filterBy(['code'])'s join-side matching (index.ts) compares
    // options.code against room.listing.code directly, the same top-level pattern
    // setPrivate() uses for `listing.private` elsewhere in colyseus's own Room class. Nested
    // metadata wouldn't be found by that match at all.
    this.listing.code = this.state.code;
    await this.listing.save();

    this.onMessage('play', (client, message: PlayMessage) => this.handlePlay(client, message));
    this.onMessage('passHand', (client) => this.handlePassHand(client));
    this.onMessage('setColor', (client, message: SetColorMessage) => this.handleSetColor(client, message));
    this.onMessage('startGame', (client) => this.handleStartGame(client));
  }

  /** Rejects a join once the game's started - not redundant with maxClients/lock() below.
   * The old fixed-playerCount design got this for free (maxClients always equalled the
   * exact seat target, so a full lobby was already unjoinable by the time Start could even
   * fire); this one's maxClients is a constant cap that's often still short of MAX_PLAYERS
   * when Start fires (Start only needs MIN_PLAYERS), leaving real open slots a late joiner
   * could otherwise land in after the engine's already been initialized for a smaller
   * config.playerCount than their seat index would need. */
  onAuth(): boolean {
    return this.state.phase === 'waiting';
  }

  onJoin(client: Client, options: JoinOptions) {
    const seatIndex = this.state.seatSessionIds.length;
    this.state.seatSessionIds.push(client.sessionId);
    this.state.playerNames.push(options.displayName?.trim() || `Player ${seatIndex + 1}`);
    // Every seat's color is just whatever that player's own profile picked (network.ts
    // sends `hue` from PlayerIdentity for both create and join) - a stale/buggy client
    // omitting or mangling it just falls back to 0 rather than crashing the room.
    this.state.colors.push(isValidHue(options.hue) ? options.hue : 0);
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
      // colors now grows one push per onJoin (seat count isn't fixed upfront anymore), so
      // it has to stay index-aligned with the two arrays above on the way out too - unlike
      // the old fixed-length-from-creation version, a stale/misaligned entry here would hand
      // the next joiner someone else's color.
      this.state.colors.splice(index, 1);
    }
  }

  onDispose() {
    activeCodes.delete(this.state.code);
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
   * palette. Fired by WaitingRoom.tsx's sync effect whenever the player's profile color
   * changes while they're seated here. */
  private handleSetColor(client: Client, { hue }: SetColorMessage) {
    if (this.state.phase !== 'waiting') return;
    if (!isValidHue(hue)) return;
    const seat = this.seatFor(client);
    if (seat === null) return;

    this.state.colors[seat] = hue;
  }

  /** Only seat 0 (the host) can start. No fixed target to wait for anymore - just a floor
   * (MIN_PLAYERS) and, for Partners, the same even-count-of-4-or-6 requirement the local
   * hotseat lobby enforces (PlayerSetupPicker.tsx's teamsAvailable) - re-derived
   * server-side rather than trusted from the client, same reasoning as every other message
   * here (handlePlay etc.): a stale/buggy client's Start Game button being enabled doesn't
   * mean the server has to believe it. */
  private handleStartGame(client: Client) {
    if (this.state.phase !== 'waiting') return;
    if (this.seatFor(client) !== 0) return;
    const count = this.state.seatSessionIds.length;
    if (count < MIN_PLAYERS) return;
    if (this.state.mode === 'teams' && (count < 4 || count % 2 !== 0)) return;

    const config: GameConfig = { playerCount: count as GameConfig['playerCount'], mode: this.state.mode };
    const state = createInitialState(config);
    startGame(state);
    this.gameState = state;
    this.state.phase = 'playing';
    this.state.stateJson = JSON.stringify(state);
    this.scheduleTurnTimeout();
    // Belt-and-suspenders alongside onAuth's phase check above - takes this room out of
    // matchmaking's room-listing results too, not just out of reach for a client that
    // already has the code.
    void this.lock();
  }
}
