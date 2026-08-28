import { Room, Client } from 'colyseus';
import type { Delayed } from 'colyseus';
import { Schema, type, ArraySchema } from '@colyseus/schema';
import {
  createInitialState, startGame, getLegalMoves, applyMove, advanceTurn, passHand, emoteById,
} from '@crazypixel/shared';
import type { Card, GameConfig, GameMode, GameState, Move, PlayerId } from '@crazypixel/shared';

const TURN_MS = 20_000;
// The shared engine's board layout is generic to any player count (see boardLayout.ts's
// computeBoardGeometry - plain division/trig, no per-count branching), so an online lobby
// doesn't need to fix a target headcount up front the way local hotseat does: it just
// accepts joins up to this cap and starts with however many are actually seated.
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
// Minimum gap between two emotes from the same seat. Emotes are the one thing in this game a
// player can fire off out of turn and as often as they like, so this is what stops one seat
// from burying everyone else's feed (which only shows the last few, see EmoteFeed.tsx) under
// a held-down button. Over-quota sends are dropped silently rather than answered with an
// error - the sender's own client already greys the picker out for the same window (see
// EMOTE_COOLDOWN_MS there), so a rejection would only ever be reaching a client that's
// deliberately ignoring it.
const EMOTE_COOLDOWN_MS = 1200;

function isValidHue(hue: unknown): hue is number {
  return typeof hue === 'number' && Number.isInteger(hue) && hue >= 0 && hue < 360;
}

/** Pierces the wildAs/copyLastCard wrappers down to a forceDraw, mirroring the client's own
 * unwrapForceDraw (StealCardOverlay.tsx) - a steal can arrive as a bare 2, an 8 copying one,
 * or a Joker played as one, and autoPlayTurn below has to recognise all three. */
function forceDrawOf(move: Move): Extract<Move, { kind: 'forceDraw' }> | null {
  if (move.kind === 'forceDraw') return move;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return forceDrawOf(move.innerMove);
  return null;
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

interface StealIntentMessage {
  targetPlayer: PlayerId;
  /** The card being spent on the steal - broadcast so every client can lay it on the discard
   * pile immediately (see GameBoard's pendingLaidCard), and kept server-side so a timeout
   * finishes the steal the player already committed to. */
  card: Card;
}

interface EmoteMessage {
  /** An id from the shared EMOTES catalogue - never the glyphs themselves. */
  emoteId: string;
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
  /** Set once the current player commits to stealing from someone (see handleStealIntent).
   * Picking a target is final - the client offers no way back - so this is what makes the
   * turn clock honour that decision instead of auto-playing something else entirely. Cleared
   * on every commitTurn, so it can never outlive the turn that set it. */
  private pendingSteal: { seat: PlayerId; targetPlayer: PlayerId; cardId: string } | null = null;
  /** Last emote send time per seat, for EMOTE_COOLDOWN_MS above. Plain array indexed by seat
   * rather than a Map keyed by sessionId - a seat outlives any one client object, and the
   * cooldown should follow the seat. */
  private lastEmoteAt: number[] = [];
  /** Monotonic per-room counter that gives every broadcast emote a unique id. Generated
   * server-side, not per-client, so every client keys the same message the same way and two
   * identical emotes sent back to back are still two distinct entries in the feed rather
   * than one React element that never re-animates. */
  private emoteSeq = 0;

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
    this.onMessage('rematch', (client) => this.handleRematch(client));
    this.onMessage('stealIntent', (client, message: StealIntentMessage) => this.handleStealIntent(client, message));
    this.onMessage('emote', (client, message: EmoteMessage) => this.handleEmote(client, message));
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
    this.pendingSteal = null;
    this.gameState = next;
    this.state.stateJson = JSON.stringify(next);
    // A finished game gets no new clock. Without this the 20s timer stayed armed after the
    // winning move and autoPlayTurn kept committing real moves on an ended game every 20s
    // forever (confirmed by driving the engine directly: winners/phase stick, since
    // checkWinner early-returns once winners is set, but marbles kept walking, hands kept
    // draining and rounds kept re-dealing behind the win screen). turnDeadline back to 0 so
    // TurnTimerBar stops rendering a countdown for a turn that can no longer time out.
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

  /** 20s elapsed with no move from the current player - play the first card in their hand
   * that has any legal move (hand order, not sorted), picking randomly among that card's
   * own legal moves ("random marble"), or pass if nothing in hand is playable. Also what
   * quietly keeps a game moving when the current seat belongs to a disconnected client.
   *
   * A committed steal (pendingSteal) overrides all of that: the player already chose the
   * card AND whose hand it reaches into, and only the blind position was left open, so the
   * clock finishes exactly that steal at a random position rather than throwing the decision
   * away and playing some unrelated card. Falls through to the ordinary path if that steal
   * somehow isn't legal any more, so a stale intent can never wedge a turn. */
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
    });
  }

  /** Purely cosmetic side-channel: "the player whose turn it is has picked whose hand to
   * reach into, but hasn't committed to a card yet." Broadcast so the *target* can be warned
   * before it happens (see GameBoard.tsx's steal alert) - the pick itself is local UI state
   * on the thief's client (BoardOverlay's figure-select step), so without this nobody else
   * would ever hear about it.
   *
   * Deliberately NOT part of RoomState/stateJson: that's committed game state, and a
   * transient "I'm hovering over you" flag living there would show up in every client's
   * before/after diff (the exact input planCaptures and GameBoard's steal detection run on)
   * as a state change with no move behind it. Broadcast messages are the right shape for
   * something with no persistence at all. There's no matching "clear" broadcast either -
   * clients drop the intent on their own the moment any new stateJson arrives (the turn
   * moved on), which is race-free in a way a second broadcast racing the state patch isn't.
   *
   * Validated as far as "it's your turn, that's a real other seat, and you actually hold
   * that card" - deliberately not re-deriving whether a forceDraw against that target is
   * legal, which would mean a full getLegalMoves sweep of the sender's whole hand (7-splits
   * included) on every tap. The card check is what matters for the two real effects here:
   * every client lays that card on the discard pile on the strength of this message, and
   * autoPlayTurn will try to finish the steal with it. handlePlay still re-derives full
   * legality when the move itself lands, so nothing here can produce an illegal play.
   *
   * There's no retract - once a target is picked the decision is final by design, and
   * accepting a "never mind" would also hand a client a way to dodge the timeout steal
   * autoPlayTurn is holding it to. pendingSteal is only ever cleared by commitTurn. */
  private handleStealIntent(client: Client, { targetPlayer, card }: StealIntentMessage) {
    const state = this.gameState;
    if (!state || this.state.phase !== 'playing') return;
    const seat = this.seatFor(client);
    if (seat === null || seat !== state.currentPlayer) return;
    const isRealOpponent = Number.isInteger(targetPlayer)
      && targetPlayer >= 0 && targetPlayer < state.config.playerCount && targetPlayer !== seat;
    if (!isRealOpponent) return;
    if (!card || !state.hands[seat].some((c) => c.id === card.id)) return;

    this.pendingSteal = { seat, targetPlayer, cardId: card.id };
    this.broadcast('stealIntent', { by: seat, target: targetPlayer, card });
  }

  /** Emotes are chat, not game state: any seated player can send one at any time, including
   * on someone else's turn and after the game has ended - being unable to react to the move
   * that just beat you would miss the entire point. Broadcast-only for the same reason the
   * steal intent is (see handleStealIntent): they have no persistence, so they have no
   * business in stateJson, where they'd show up in every client's before/after diff as a
   * state change with no move behind it.
   *
   * The wire carries an id from the shared EMOTES catalogue, never the glyphs - a client
   * that makes up an id is dropped here, which is what keeps this from being an
   * arbitrary-text channel onto five other people's screens. */
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

  /** Deals a brand-new game to the same seats after one finishes. Host-only, matching
   * handleStartGame - one player decides for the table rather than a majority vote or a
   * first-click-wins race between six win screens.
   *
   * Reuses the finished game's own `config` rather than rebuilding one from the current
   * seat count: seats can't change once a game is playing (onAuth rejects late joins,
   * onLeave leaves a started game's seats alone), so the two agree today, but reading it
   * off the state that just ended is what keeps them agreeing if that ever stops being
   * true - a config with a different playerCount than the seats clients are already
   * rendering would desync every board at once.
   *
   * Seats, colors and names all deliberately carry over untouched - the room's whole
   * identity is "these people at these seats," and a rematch is another game between them,
   * not a new lobby. That includes any seat whose client dropped mid-game (still frozen,
   * see onLeave); it plays the rematch on the turn clock's auto-play like it did before. */
  private handleRematch(client: Client) {
    if (this.state.phase !== 'playing') return;
    // The finished-ness is the real gate, not the room phase - room phase stays 'playing'
    // for a room's whole life once started, so without this any seat-0 client could reroll
    // a game that's still in progress out from under everyone.
    if (this.gameState?.phase !== 'gameEnd') return;
    if (this.seatFor(client) !== 0) return;

    const state = createInitialState(this.gameState.config);
    startGame(state);
    this.gameState = state;
    this.state.stateJson = JSON.stringify(state);
    this.scheduleTurnTimeout();
  }
}
