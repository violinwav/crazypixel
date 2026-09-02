// The one and only room type. Server-authoritative: every client message is re-derived
// against the shared engine before it is accepted, so a stale, buggy or malicious client
// can't desync the game or move out of turn.
//
// Room state is deliberately thin - the real GameState is synced as one JSON string rather
// than mirrored field by field into Schema classes, so the engine's shape can keep evolving
// without a matching schema change here. See
// docs/superpowers/specs/2026-08-22-online-multiplayer-lobbies-design.md.
//
// Not implemented: reconnect (a dropped seat freezes and plays on the turn clock),
// spectators, and any persistence (rooms are in-memory and gone when empty).
//
// The @type decorators below need BOTH experimentalDecorators AND
// useDefineForClassFields: false in tsconfig.json. Missing the second one fails silently:
// decorators still apply and onStateChange still fires, but every field with a class-field
// default decodes as undefined on every client, forever, because native class-field init
// overwrites the property descriptor the decorator installed.

import { Room, Client } from 'colyseus';
import type { Delayed } from 'colyseus';
import { Schema, type, ArraySchema } from '@colyseus/schema';
import {
  createInitialState, startGame, getLegalMoves, applyMove, advanceTurn, passHand, emoteById,
} from '@crazypixel/shared';
import type { Card, GameConfig, GameMode, GameState, Move, PlayerId } from '@crazypixel/shared';

const TURN_MS = 20_000;
// The engine and the board layout are generic to any player count, so an online lobby needn't
// fix a headcount up front the way local hotseat does: it accepts joins up to this cap and
// starts with however many are seated.
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
// Minimum gap between two emotes from one seat. Emotes are the only thing a player can fire
// off out of turn and as often as they like, so this stops one seat burying everyone else's
// feed under a held-down button. Over-quota sends are dropped silently: the sender's client
// greys its own picker for the same window, so a rejection would only ever reach a client
// that is deliberately ignoring it.
const EMOTE_COOLDOWN_MS = 1200;

function isValidHue(hue: unknown): hue is number {
  return typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue < 360;
}

/**
 * Pierces the wildAs/copyLastCard wrappers down to a forceDraw, mirroring the client's own
 * unwrapForceDraw - a steal can arrive as a bare 2, an 8 copying one, or a Joker played as
 * one, and autoPlayTurn has to recognise all three.
 */
function forceDrawOf(move: Move): Extract<Move, { kind: 'forceDraw' }> | null {
  if (move.kind === 'forceDraw') return move;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return forceDrawOf(move.innerMove);
  return null;
}

// In-process registry of codes currently in use, so two simultaneously open rooms can't
// collide. Reserved in onCreate, released in onDispose. Deliberately not a shared store -
// fine for the single server process this project runs.
const activeCodes = new Set<string>();

function generateCode(): string {
  let code: string;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (activeCodes.has(code));
  activeCodes.add(code);
  return code;
}

class RoomState extends Schema {
  @type('string') phase: 'waiting' | 'playing' = 'waiting';
  @type('string') mode: GameMode = 'ffa';
  @type(['number']) colors = new ArraySchema<number>();
  @type(['string']) seatSessionIds = new ArraySchema<string>();
  @type(['string']) playerNames = new ArraySchema<string>();
  /** The short code players share to join. room.id is colyseus's own long internal id and is
   * never shown to a player. */
  @type('string') code = '';
  @type('string') stateJson = '';
  /**
   * The `Move` that produced the current stateJson, as JSON ('' for a pass, a fresh deal, or
   * before the first move). Purely for animation: clients only see before/after snapshots,
   * which place a marble but say nothing about how it got there, so without this every remote
   * move reads as a teleport. A Schema field rather than a broadcast precisely because it
   * changes in the same patch as stateJson, so a client can never decode a move against the
   * wrong snapshot - the ordering guarantee a broadcast racing a state patch can't give.
   * Leaks nothing hidden: the move's card is on the discard pile a frame later anyway.
   */
  @type('string') lastMoveJson = '';
  /**
   * Epoch ms when the current turn auto-plays, 0 before the game starts. Informational for
   * clients (TurnTimerBar.tsx); the server-side clock is what enforces it.
   */
  @type('number') turnDeadline = 0;
}

interface CreateOptions {
  mode: GameMode;
  hue: number;
}

interface JoinOptions {
  displayName: string;
  hue: number;
}

interface PlayMessage {
  move: Move;
}

interface SetColorMessage {
  hue: number;
}

interface StealIntentMessage {
  targetPlayer: PlayerId;
  /**
   * The card being spent on the steal. Broadcast so every client can lay it on the discard
   * pile immediately, and kept server-side so a timeout can finish the steal the player
   * already committed to.
   */
  card: Card;
}

interface EmoteMessage {
  /** An id from the shared EMOTES catalogue - never the glyphs themselves. */
  emoteId: string;
}

/**
 * A game room.
 *
 * The game doesn't auto-start when seats fill: seat 0 (the host) has to send 'startGame',
 * which gives every joining player a moment to look at and adjust their color instead of
 * play beginning under them mid-pick. Every turn then gets a TURN_MS clock, which also means
 * a mid-game disconnect can't stall the game forever - the frozen seat's turn times out and
 * auto-plays like anyone else's.
 */
export class GameRoom extends Room<RoomState> {
  private gameState: GameState | null = null;
  private turnTimeout: Delayed | null = null;
  /**
   * Set once the current player commits to stealing from someone. Picking a target is final -
   * the client offers no way back - so this is what makes the turn clock honour that decision
   * instead of auto-playing something else. Cleared on every commitTurn, so it can never
   * outlive the turn that set it.
   */
  private pendingSteal: { seat: PlayerId; targetPlayer: PlayerId; cardId: string } | null = null;
  /**
   * Last emote time per seat, for EMOTE_COOLDOWN_MS. Indexed by seat rather than keyed by
   * sessionId: a seat outlives any one client object, and the cooldown follows the seat.
   */
  private lastEmoteAt: number[] = [];
  /**
   * Monotonic per-room counter giving every broadcast emote a unique id. Generated
   * server-side so every client keys the same message the same way and two identical emotes
   * back to back stay two distinct feed entries.
   */
  private emoteSeq = 0;

  // --- Lifecycle ----------------------------------------------------------

  async onCreate(options: CreateOptions) {
    this.maxClients = MAX_PLAYERS;
    this.setState(new RoomState());
    this.state.mode = options.mode;
    this.state.code = generateCode();
    // A *top-level* listing field, not setMetadata() (which nests under listing.metadata):
    // filterBy(['code'])'s join-side matching compares options.code against listing.code
    // directly, the same top-level pattern setPrivate() uses for listing.private. Nested
    // metadata wouldn't be found by that match at all.
    this.listing.code = this.state.code;
    await this.listing.save();

    this.onMessage('play', (client, message: PlayMessage) => this.handlePlay(client, message));
    this.onMessage('passHand', (client) => this.handlePassHand(client));
    this.onMessage('setColor', (client, message: SetColorMessage) => this.handleSetColor(client, message));
    this.onMessage('startGame', (client) => this.handleStartGame(client));
    this.onMessage('rematch', (client) => this.handleRematch(client));
    this.onMessage('stealIntent', (client, message: StealIntentMessage) => this.handleStealIntent(client, message));
    this.onMessage('emote', (client, message: EmoteMessage) => this.handleEmote(client, message));
  }

  /**
   * Rejects a join once the game has started. Not redundant with maxClients/lock(): maxClients
   * is a constant cap that is often still short of MAX_PLAYERS when Start fires (Start only
   * needs MIN_PLAYERS), leaving real open slots a late joiner could otherwise land in after
   * the engine was initialized for a smaller config.playerCount than their seat index needs.
   */
  onAuth(): boolean {
    return this.state.phase === 'waiting';
  }

  onJoin(client: Client, options: JoinOptions) {
    const seatIndex = this.state.seatSessionIds.length;
    this.state.seatSessionIds.push(client.sessionId);
    this.state.playerNames.push(options.displayName?.trim() || `Player ${seatIndex + 1}`);
    // Color comes straight from the player's own profile. A stale or buggy client omitting
    // or mangling it falls back to 0 rather than crashing the room.
    this.state.colors.push(isValidHue(options.hue) ? options.hue : 0);
  }

  onLeave(client: Client) {
    // A mid-game disconnect intentionally freezes the seat rather than reopening it. Only a
    // seat that never made it into a started game is removed, so a later joiner can take it.
    if (this.state.phase !== 'waiting') return;
    const index = this.state.seatSessionIds.indexOf(client.sessionId);
    if (index !== -1) {
      this.state.seatSessionIds.splice(index, 1);
      this.state.playerNames.splice(index, 1);
      // colors grows one push per onJoin, so it has to stay index-aligned with the two arrays
      // above on the way out too, or the next joiner gets someone else's color.
      this.state.colors.splice(index, 1);
    }
  }

  onDispose() {
    activeCodes.delete(this.state.code);
  }

  // --- Turn commit and clock ----------------------------------------------

  private seatFor(client: Client): PlayerId | null {
    const index = this.state.seatSessionIds.indexOf(client.sessionId);
    return index === -1 ? null : (index as PlayerId);
  }

  /**
   * Clones the state, lets `mutate` apply one turn's effect, advances the turn, commits the
   * result as authoritative and re-arms the clock. Shared by a real move, a pass and the
   * auto-play fallback, so all three agree on what committing a turn means.
   */
  private commitTurn(mutate: (next: GameState) => void, move: Move | null = null) {
    const state = this.gameState;
    if (!state) return;
    const next = structuredClone(state);
    mutate(next);
    advanceTurn(next);
    this.pendingSteal = null;
    this.gameState = next;
    this.state.stateJson = JSON.stringify(next);
    // Same patch as stateJson, so clients decode the move against the snapshot it applied to.
    this.state.lastMoveJson = move ? JSON.stringify(move) : '';
    // A finished game gets no new clock. Without this the timer stayed armed after the
    // winning move and autoPlayTurn kept committing real moves every 20s forever - winners
    // and phase stick, but marbles kept walking and rounds kept re-dealing behind the win
    // screen. turnDeadline goes back to 0 so TurnTimerBar stops counting down a turn that can
    // no longer time out.
    if (next.phase === 'gameEnd') {
      this.turnTimeout?.clear();
      this.turnTimeout = null;
      this.state.turnDeadline = 0;
      return;
    }
    this.scheduleTurnTimeout();
  }

  private scheduleTurnTimeout() {
    this.turnTimeout?.clear();
    this.state.turnDeadline = Date.now() + TURN_MS;
    this.turnTimeout = this.clock.setTimeout(() => this.autoPlayTurn(), TURN_MS);
  }

  /**
   * The turn clock expired. Plays the first card in hand order that has any legal move,
   * picking randomly among that card's own moves, or passes if nothing is playable. Also what
   * keeps a game moving when the current seat belongs to a disconnected client.
   *
   * A committed steal overrides all of that: the player already chose the card AND whose hand
   * it reaches into, and only the blind position was left open, so the clock finishes exactly
   * that steal at a random position rather than throwing the decision away. Falls through to
   * the ordinary path if that steal isn't legal any more, so a stale intent can't wedge a turn.
   */
  private autoPlayTurn() {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = state.currentPlayer;

    let chosen: Move | null = null;
    const pending = this.pendingSteal;
    if (pending && pending.seat === seat) {
      const card = state.hands[seat].find((c) => c.id === pending.cardId);
      const steals = card
        ? getLegalMoves(state, seat, card).filter((m) => forceDrawOf(m)?.targetPlayer === pending.targetPlayer)
        : [];
      if (steals.length > 0) chosen = steals[Math.floor(Math.random() * steals.length)];
    }

    for (const card of state.hands[seat]) {
      if (chosen) break;
      const legal = getLegalMoves(state, seat, card);
      if (legal.length > 0) {
        chosen = legal[Math.floor(Math.random() * legal.length)];
        break;
      }
    }

    this.commitTurn((next) => {
      if (chosen) applyMove(next, seat, chosen);
      else passHand(next, seat);
    }, chosen);
  }

  // --- Message handlers ---------------------------------------------------

  /**
   * Both phases have to hold: the room must be past the lobby, and the game itself must not be
   * over. Room phase alone never leaves 'playing' once Start fires, so it says nothing about a
   * finished game - and the engine happily enumerates legal moves for a seat whose game already
   * ended, so a client still holding a live board (a stale tab, or one that missed the final
   * state patch) could otherwise keep committing real turns behind the win screen.
   */
  private acceptsTurns(state: GameState): boolean {
    return this.state.phase === 'playing' && state.phase !== 'gameEnd';
  }

  private handlePlay(client: Client, { move }: PlayMessage) {
    const state = this.gameState;
    if (!state || !this.acceptsTurns(state)) return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;

    const candidates = getLegalMoves(state, seat, move.card);
    const isLegal = candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(move));
    if (!isLegal) return;

    this.commitTurn((next) => applyMove(next, seat, move), move);
  }

  private handlePassHand(client: Client) {
    const state = this.gameState;
    if (!state || !this.acceptsTurns(state)) return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;

    const hasLegalMove = state.hands[seat].some((card) => getLegalMoves(state, seat, card).length > 0);
    if (hasLegalMove) return;

    this.commitTurn((next) => passHand(next, seat));
  }

  /**
   * "The player whose turn it is has picked whose hand to reach into, but hasn't committed to
   * a card yet." Purely cosmetic, and broadcast so the *target* can be warned - the pick is
   * local UI state on the thief's client, so without this nobody else would hear about it.
   *
   * Deliberately NOT part of stateJson: that is committed game state, and a transient
   * "I'm hovering over you" flag there would show up in every client's before/after diff as a
   * change with no move behind it. There is no matching "clear" broadcast either - clients
   * drop the intent when any new stateJson arrives, which is race-free in a way a second
   * broadcast racing the state patch is not.
   *
   * Validated only as far as "it's your turn, that's a real other seat, and you hold that
   * card". Deliberately not re-deriving whether a forceDraw against that target is legal,
   * which would mean a full getLegalMoves sweep of the sender's hand (7-splits included) on
   * every tap. The card check is what matters for the two real effects: every client lays
   * that card on the pile on the strength of this, and autoPlayTurn will try to finish the
   * steal with it. handlePlay still re-derives full legality when the move lands.
   *
   * There is no retract. The decision is final by design, and accepting a "never mind" would
   * hand a client a way to dodge the timeout steal autoPlayTurn is holding it to.
   */
  private handleStealIntent(client: Client, { targetPlayer, card }: StealIntentMessage) {
    const state = this.gameState;
    if (!state || !this.acceptsTurns(state)) return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;
    const isRealOpponent = Number.isInteger(targetPlayer)
      && targetPlayer >= 0 && targetPlayer < state.config.playerCount && targetPlayer !== seat;
    if (!isRealOpponent) return;
    if (!card || !state.hands[seat].some((c) => c.id === card.id)) return;

    this.pendingSteal = { seat, targetPlayer, cardId: card.id };
    this.broadcast('stealIntent', { by: seat, target: targetPlayer, card });
  }

  /**
   * Emotes are chat, not game state: any seated player can send one at any time, including on
   * someone else's turn - being unable to react to the move that just beat you would miss the
   * point. Broadcast-only for the same reason the steal intent is: no persistence means no
   * business in stateJson.
   *
   * The wire carries a catalogue id, never glyphs, and a made-up id is dropped here - which is
   * what keeps this from being an arbitrary-text channel onto five other people's screens.
   */
  private handleEmote(client: Client, { emoteId }: EmoteMessage) {
    if (this.state.phase !== 'playing') return;
    const seat = this.seatFor(client);
    if (seat === null) return;
    if (typeof emoteId !== 'string' || !emoteById(emoteId)) return;

    const now = Date.now();
    if (now - (this.lastEmoteAt[seat] ?? 0) < EMOTE_COOLDOWN_MS) return;
    this.lastEmoteAt[seat] = now;

    this.emoteSeq += 1;
    this.broadcast('emote', { id: this.emoteSeq, by: seat, emoteId });
  }

  /**
   * Only legal pre-game - colors are fixed once play starts, matching config and mode. No
   * uniqueness check: two seats landing on the same or a nearby hue is the players' own
   * choice now that color is continuous rather than a fixed palette.
   */
  private handleSetColor(client: Client, { hue }: SetColorMessage) {
    if (this.state.phase !== 'waiting') return;
    if (!isValidHue(hue)) return;
    const seat = this.seatFor(client);
    if (seat === null) return;

    this.state.colors[seat] = hue;
  }

  /**
   * Host-only (seat 0). No fixed target headcount, just a floor and - for Partners - the same
   * even-count-of-4-or-6 rule the local lobby enforces, re-derived here rather than trusted
   * from the client: a stale client's Start button being enabled doesn't oblige the server.
   */
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
    this.state.lastMoveJson = '';
    this.scheduleTurnTimeout();
    // Belt and braces alongside onAuth's phase check: also takes this room out of
    // matchmaking's listing results, not just out of reach for a client holding the code.
    void this.lock();
  }

  /**
   * Deals a brand-new game to the same seats after one finishes. Host-only, matching
   * handleStartGame - one player decides for the table rather than a first-click-wins race
   * between six win screens.
   *
   * Reuses the finished game's own config rather than rebuilding one from the seat count.
   * The two agree today (seats can't change once a game is playing), and reading it off the
   * state that just ended is what keeps them agreeing if that stops being true - a config
   * with a different playerCount than the seats clients are rendering would desync every
   * board at once.
   *
   * Seats, colors and names carry over untouched: the room's identity is "these people at
   * these seats", and a rematch is another game between them, not a new lobby. That includes
   * a seat whose client dropped mid-game - it plays the rematch on the turn clock as before.
   */
  private handleRematch(client: Client) {
    if (this.state.phase !== 'playing') return;
    // Finished-ness is the real gate, not room phase: room phase stays 'playing' for a room's
    // whole life once started, so without this any seat-0 client could reroll a game that is
    // still in progress out from under everyone.
    if (this.gameState?.phase !== 'gameEnd') return;
    if (this.seatFor(client) !== 0) return;

    const state = createInitialState(this.gameState.config);
    startGame(state);
    this.gameState = state;
    this.state.stateJson = JSON.stringify(state);
    this.state.lastMoveJson = '';
    this.scheduleTurnTimeout();
  }
}
