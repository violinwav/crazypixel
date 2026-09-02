// The rules engine, and the single source of truth for every rule in the game.
//
// Two entry points matter to callers: `getLegalMoves(state, player, card)` enumerates every
// legal Move, `applyMove(state, player, move)` commits one. Everything else here either
// feeds those two or exists so the client can *preview* what they would do (planMovement,
// captureIndicesFor, moveCaptureIndices) instead of re-deriving a rule and drifting from it.
//
// GameState is mutated in place by design. Callers that need immutability clone first - see
// client useGameState.ts's cloneState (React StrictMode) and server GameRoom.commitTurn.

import type {
  Card, CardRank, GameConfig, GameState, Marble, MarbleLocation, Move, PlayerId,
} from './types';
import {
  CARD_DEFS, ROUND_DEAL_SIZES, KENNEL_SIZE, HOME_STRETCH_LENGTH,
  activePlayerIds, startIndexFor, partnerOf, opponentsOf, trackLengthFor,
} from './constants';
import { pathIndices } from './board';

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANKS: Exclude<CardRank, 'JOKER'>[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

// --- Setup and deck -------------------------------------------------------

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let n = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `c${n++}`, suit, rank });
    }
  }
  deck.push({ id: `c${n++}`, suit: null, rank: 'JOKER' });
  deck.push({ id: `c${n++}`, suit: null, rank: 'JOKER' });
  return deck;
}

function shuffle<T>(items: T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createInitialState(config: GameConfig): GameState {
  const marbles: Marble[] = [];
  for (const player of activePlayerIds(config)) {
    for (let slot = 0; slot < KENNEL_SIZE; slot++) {
      marbles.push({ id: `p${player}-m${slot}`, owner: player, location: { zone: 'kennel', index: slot }, hasLapped: false });
    }
  }
  return {
    config,
    marbles,
    hands: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] },
    drawPile: shuffle(createDeck()),
    discardPile: [],
    lastPlayedCard: null,
    lastPlayedBy: null,
    roundIndex: 0,
    dealerIndex: 0,
    // Placeholder only - startGame sets the real opening seat. Every config has at least 2
    // players, so index 1 is always valid to construct with.
    currentPlayer: 1,
    phase: 'dealing',
    winners: null,
  };
}

function drawCards(state: GameState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      // The deck empties across a real game - reshuffle the discard pile rather than crash.
      state.drawPile = shuffle(state.discardPile);
      state.discardPile = [];
    }
    const card = state.drawPile.pop();
    if (card) drawn.push(card);
  }
  return drawn;
}

export function dealRound(state: GameState): void {
  const dealSize = ROUND_DEAL_SIZES[state.roundIndex % ROUND_DEAL_SIZES.length];
  for (const player of activePlayerIds(state.config)) {
    state.hands[player] = drawCards(state, dealSize);
  }
  state.phase = 'cardPass';
}

/**
 * Each player passes one chosen card face-down to their partner before play starts. A real
 * rule, but no UI reaches it yet (startGame skips straight past the 'cardPass' phase), so
 * nothing in this repo calls it. Throws in 'ffa' mode, which has no partner to pass to.
 */
export function passCard(state: GameState, from: PlayerId, card: Card): void {
  const partner = partnerOf(state.config, from);
  if (partner === null) throw new Error('No partner to pass to in ffa mode');
  const hand = state.hands[from];
  const idx = hand.findIndex((c) => c.id === card.id);
  if (idx === -1) throw new Error('Card not in hand');
  hand.splice(idx, 1);
  state.hands[partner].push(card);
}

/**
 * Deals round 1 and drops straight into play, skipping the card-passing sub-phase rather
 * than faking it (see passCard).
 */
export function startGame(state: GameState): void {
  dealRound(state);
  state.phase = 'playing';
  const players = activePlayerIds(state.config);
  state.currentPlayer = players[0];
  // Every round opens on the seat after the dealer (see advanceTurn), and game one opens on
  // seat 0 - so round 1's dealer is the seat before it, i.e. the last one.
  state.dealerIndex = players[players.length - 1];
}

// --- Turn flow ------------------------------------------------------------

/**
 * A player with no legal move for any card discards their whole hand at once and sits out
 * until the next round's redeal - a full pass, not a skipped turn. Deliberately leaves
 * lastPlayedCard/lastPlayedBy alone: a pass isn't a played card, and letting the next
 * player's custom-8 "copy last card" reach back through a pass would be exploitable.
 */
export function passHand(state: GameState, player: PlayerId): void {
  state.discardPile.push(...state.hands[player]);
  state.hands[player] = [];
}

/**
 * Advances to the next active player still holding cards, skipping anyone who has already
 * passHand'd this round. When every hand is empty, deals the next round first.
 *
 * A finished game is left completely alone. Every caller (local play/pass, server
 * commitTurn, the turn-clock auto-play) runs this straight after applyMove, and applyMove is
 * exactly what sets `gameEnd` - so without this guard a winning move that also emptied the
 * last hand fell into the redeal branch below, which dealt a new round and put `phase` back
 * to 'playing'. `winners` stayed set (checkWinner never fires twice) but WinScreen needs
 * both, so the game silently carried on with no win popup and no way to ever reach one.
 */
export function advanceTurn(state: GameState): void {
  if (state.phase === 'gameEnd') return;
  const players = activePlayerIds(state.config);
  if (players.every((p) => state.hands[p].length === 0)) {
    state.roundIndex += 1;
    dealRound(state);
    state.phase = 'playing';
    // Anchored to dealerIndex, not to whoever moved last: who that is depends on the order
    // players ran out of cards or passed, so chaining off currentPlayer would open a round
    // on an effectively arbitrary seat instead of the next one in line.
    state.dealerIndex = players[(players.indexOf(state.dealerIndex) + 1) % players.length];
    state.currentPlayer = players[(players.indexOf(state.dealerIndex) + 1) % players.length];
    return;
  }
  let idx = (players.indexOf(state.currentPlayer) + 1) % players.length;
  while (state.hands[players[idx]].length === 0) {
    idx = (idx + 1) % players.length;
  }
  state.currentPlayer = players[idx];
}

// --- Board queries --------------------------------------------------------

function findMarble(state: GameState, marbleId: string): Marble {
  const marble = state.marbles.find((m) => m.id === marbleId);
  if (!marble) throw new Error(`Unknown marble ${marbleId}`);
  return marble;
}

function marbleAtTrackIndex(state: GameState, index: number): Marble | undefined {
  return state.marbles.find((m) => m.location.zone === 'track' && m.location.index === index);
}

/**
 * A marbles-only shallow clone, for replaying hypothetical moves. hands/piles are shared by
 * reference: nothing in movement legality reads them, and structuredClone-ing the whole
 * GameState (all 54 cards, every call) is what made an 8-marble 7-split take ~17 seconds.
 */
function cloneMarbles(state: GameState): GameState {
  return { ...state, marbles: state.marbles.map((m) => ({ ...m, location: { ...m.location } })) };
}

function sendToKennel(state: GameState, marble: Marble): void {
  const occupied = new Set(
    state.marbles
      .filter((m) => m.owner === marble.owner && m.location.zone === 'kennel')
      .map((m) => m.location.index),
  );
  let slot = 0;
  while (occupied.has(slot)) slot++;
  marble.location = { zone: 'kennel', index: slot };
  // A captured marble starts over - any lap it banked is gone, and it has to earn the right
  // to enter home again from scratch.
  marble.hasLapped = false;
}

/**
 * Once a marble sits on its owner's start square, passage there is blocked for every marble
 * on the board, the owner's own included, until it moves away. The guard marble also can't
 * be sent home while it sits there.
 */
function isBlockaded(state: GameState, index: number): boolean {
  const owner = activePlayerIds(state.config).find((p) => startIndexFor(state.config, p) === index);
  if (owner === undefined) return false;
  const guard = marbleAtTrackIndex(state, index);
  return !!guard && guard.owner === owner;
}

// --- Movement -------------------------------------------------------------

export interface MovementPlan {
  location: MarbleLocation;
  /**
   * Track-space indices passed through, for blockade checks and the 7's pass-over capture.
   * Excludes home-stretch slots: those aren't track squares, and nothing on the main track
   * can block or pass-over-capture there.
   */
  trackPassed: number[];
  legal: boolean;
}

/**
 * Where a marble ends up after `steps` (negative = backward, e.g. the 4's back-4 option).
 *
 * Forward, a marble enters home the moment its path would carry it *past* its own start
 * square. Landing exactly on that square isn't entering yet - it's an ordinary track square.
 *
 * Backward is a plain wraparound walk with no shortcut into home, however far it goes.
 * Landing exactly on your own start square by going backward earns the *right* to enter
 * home on a later forward move, which is what marble.hasLapped tracks (set by the two
 * moveWith*Capture functions below). Position alone can't distinguish "only just placed
 * here by startMarble" from "already earned this" - they're the same square.
 *
 * Exported so the client previews the authoritative path for highlighting and descriptions
 * rather than maintaining a second, simplified re-derivation of it.
 */
export function planMovement(state: GameState, marble: Marble, steps: number): MovementPlan {
  const config = state.config;
  const trackLength = trackLengthFor(config);

  if (marble.location.zone === 'home') {
    // Movement within home (rare, but the 4's backward option applies here too) - clamped,
    // since a marble can't back out onto the main track once home.
    const newIndex = marble.location.index + steps;
    const legal = newIndex >= 0 && newIndex < HOME_STRETCH_LENGTH;
    return { location: legal ? { zone: 'home', index: newIndex } : marble.location, trackPassed: [], legal };
  }

  const startIndex = startIndexFor(config, marble.owner);
  const lapPos = ((marble.location.index - startIndex) % trackLength + trackLength) % trackLength;
  // Parked on its own start square with a lap already banked: this marble is at its
  // entrance, ready to turn in on this very move. Treating that as a full lap (rather than
  // 0) is what lets a small card enter home from here instead of demanding another lap.
  const atEntrance = lapPos === 0 && marble.hasLapped;
  const effectiveLapPos = atEntrance ? trackLength : lapPos;
  const newLapPos = effectiveLapPos + steps;

  if (newLapPos > trackLength) {
    const homeSlot = newLapPos - trackLength - 1;
    if (homeSlot < HOME_STRETCH_LENGTH) {
      const stepsToStart = trackLength - effectiveLapPos;
      const trackPassed = pathIndices(marble.location.index, stepsToStart, trackLength);
      return { location: { zone: 'home', index: homeSlot }, trackPassed, legal: true };
    }
    // Card too big to land exactly inside the goal: the marble isn't blocked, it walks on
    // past its own entrance (the plain forward case below). Every later approach re-runs
    // this exact-fit check, so a smaller card on a future turn can still bring it home.
  }

  const trackPassed = pathIndices(marble.location.index, steps, trackLength);
  return { location: { zone: 'track', index: trackPassed[trackPassed.length - 1] }, trackPassed, legal: true };
}

/**
 * Would landing at `plan.location` stack this marble on another of its owner's? Never true
 * for an opponent's marble - that's a capture, not a conflict.
 */
function ownStackConflict(state: GameState, marble: Marble, plan: MovementPlan): boolean {
  if (plan.location.zone === 'track') {
    const occupant = marbleAtTrackIndex(state, plan.location.index);
    return !!occupant && occupant.owner === marble.owner && occupant.id !== marble.id;
  }
  if (plan.location.zone === 'home') {
    return state.marbles.some(
      (m) => m.owner === marble.owner && m.id !== marble.id
        && m.location.zone === 'home' && m.location.index === plan.location.index,
    );
  }
  return false;
}

/**
 * Marbles in the home stretch can't hop over each other. Nothing is captured there, so a
 * blocked path is simply illegal. Covers both a home-to-home move and a fresh track-to-home
 * entry, where every slot from 0 up to the landing slot counts as passed through. Checked
 * separately from the track blockade because planMovement's trackPassed is empty for
 * home-stretch space either way.
 */
function homeStretchOvertake(state: GameState, marble: Marble, plan: MovementPlan): boolean {
  if (plan.location.zone !== 'home') return false;
  const fromIndex = marble.location.zone === 'home' ? marble.location.index : -1;
  const direction = plan.location.index > fromIndex ? 1 : -1;
  for (let index = fromIndex + direction; index !== plan.location.index; index += direction) {
    const occupant = state.marbles.find(
      (m) => m.owner === marble.owner && m.id !== marble.id && m.location.zone === 'home' && m.location.index === index,
    );
    if (occupant) return true;
  }
  return false;
}

function isMoveClear(state: GameState, marble: Marble, steps: number): boolean {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal || !plan.trackPassed.every((i) => !isBlockaded(state, i))) return false;
  if (ownStackConflict(state, marble, plan)) return false;
  return !homeStretchOvertake(state, marble, plan);
}

// --- Legal move enumeration -----------------------------------------------

export function getLegalMoves(
  state: GameState,
  player: PlayerId,
  card: Card,
  /**
   * False while enumerating the moves an 8 could copy. The 8's copy branch and the Joker's
   * wildAs branch each expand into the other's moves, so a Joker under an 8 (whose wildAs
   * synthesizes an 8, whose copy branch sees the same Joker again) recursed forever. This
   * flag cuts the second copy hop instead of banning the pairing outright.
   */
  allowCopy = true,
): Move[] {
  const def = CARD_DEFS[card.rank];
  const moves: Move[] = [];
  const config = state.config;
  const ownMarbles = state.marbles.filter((m) => m.owner === player);

  if (def.canStart) {
    const inKennel = ownMarbles.find((m) => m.location.zone === 'kennel');
    const occupant = marbleAtTrackIndex(state, startIndexFor(config, player));
    // Your own marble on your start square blocks entry (the guard-square rule, see
    // isBlockaded). An opponent's doesn't - it gets sent home, like any landing capture.
    const blockedByOwnMarble = !!occupant && occupant.owner === player;
    if (inKennel && !blockedByOwnMarble) {
      moves.push({ kind: 'startMarble', card, marbleId: inKennel.id });
    }
  }

  if (def.isJack) {
    // A marble still on its own start square hasn't entered play yet (it's also the blockade
    // guard there), so it can't be swapped away or swapped onto until it has moved off once.
    const isAtOwnStart = (m: Marble) => m.location.zone === 'track' && m.location.index === startIndexFor(config, m.owner);
    const onTrack = state.marbles.filter((m) => m.location.zone === 'track' && !isAtOwnStart(m));
    for (const a of onTrack.filter((m) => m.owner === player)) {
      for (const b of onTrack.filter((m) => m.id !== a.id)) {
        moves.push({ kind: 'swapJack', card, marbleIdA: a.id, marbleIdB: b.id });
      }
    }
  }

  // House rule, the 2: a blind steal, not a forced draw from the shared pile. The acting
  // player picks a position in the target's hand (face-down client-side, see
  // StealCardOverlay.tsx) without seeing what's there. Every position is equally takeable,
  // so this enumerates one move per (opponent, position) pair and lets the UI narrow it -
  // same pattern as the 7-split and the Joker rank picker.
  if (def.customTwo) {
    for (const opponent of opponentsOf(config, player)) {
      for (let i = 0; i < state.hands[opponent].length; i++) {
        moves.push({ kind: 'forceDraw', card, targetPlayer: opponent, targetCardIndex: i });
      }
    }
  }

  // House rule, the 8: move 8, or replay whatever the previous card did. Copying another 8
  // is disallowed to avoid open-ended recursion (not specified in the source rules).
  // Copying a JOKER is allowed but only one hop deep - see allowCopy above.
  if (
    def.customEight
    && allowCopy
    && state.lastPlayedCard
    && state.lastPlayedCard.rank !== '8'
  ) {
    for (const inner of getLegalMoves(state, player, state.lastPlayedCard, false)) {
      moves.push({ kind: 'copyLastCard', card, innerMove: inner });
    }
  }

  // House rule, the Joker: start, or act as any card. Unions every other rank's legal moves
  // under one play; the UI picks a rank first, then a target, rather than flooding the board
  // with every rank at once. Playing it *as* an Ace or King includes their startMarble too,
  // even though the Joker's own canStart above already reaches that move a different way -
  // a Joker-as-King should do everything a King does, not a subset.
  if (def.isWild) {
    for (const asRank of RANKS) {
      const asCard: Card = { id: card.id, suit: card.suit, rank: asRank };
      for (const inner of getLegalMoves(state, player, asCard, allowCopy)) {
        moves.push({ kind: 'wildAs', card, asRank, innerMove: inner });
      }
    }
  }

  for (const marble of ownMarbles.filter((m) => m.location.zone === 'track' || m.location.zone === 'home')) {
    for (const steps of def.moveOptions) {
      if (isMoveClear(state, marble, steps)) {
        moves.push({ kind: 'moveMarble', card, marbleId: marble.id, steps });
      }
    }
  }

  if (def.isSevenSplit) {
    const partner = partnerOf(config, player);
    // Home-stretch marbles are eligible too, moved segment by segment like any other -
    // homeStretchOvertake is what stops them hopping over each other, not exclusion here.
    const onTrackOrHome = (m: Marble) => m.location.zone === 'track' || m.location.zone === 'home';
    const eligible = ownMarbles
      .filter(onTrackOrHome)
      .concat(partner !== null ? state.marbles.filter((m) => m.owner === partner && onTrackOrHome(m)) : []);
    moves.push(...generateSevenSplits(state, eligible, 7, card));
  }

  return moves;
}

/**
 * Replays `segments` in order onto a scratch clone, using the same pass-over-capture
 * movement each segment will really use - so a candidate's later segments are checked
 * against the board as it would look partway through the split, not the starting position.
 * That's what makes "move the marble that just entered one step out of the way, then take
 * the other 6 into home with the marble behind it" legal at all.
 */
function stateAfterSegments(state: GameState, segments: { marbleId: string; steps: number }[]): GameState {
  const scratch = cloneMarbles(state);
  for (const segment of segments) {
    const marble = scratch.marbles.find((m) => m.id === segment.marbleId);
    if (marble) moveWithPassOverCapture(scratch, marble, segment.steps);
  }
  return scratch;
}

/**
 * Every legal way to spread `total` steps across `eligible`, as splitSeven moves.
 *
 * Searches execution *order*, not just the (marble -> steps) assignment: an assignment can
 * have several orders and only some may be legal, so the next marble is picked from
 * whatever is still `remaining` rather than from a fixed array index.
 */
function generateSevenSplits(state: GameState, eligible: Marble[], total: number, card: Card): Move[] {
  const results: Move[] = [];
  const seen = new Set<string>();
  const acc: { marbleId: string; steps: number }[] = [];

  function recurse(remaining: Marble[], left: number) {
    if (left === 0) {
      if (acc.length > 0) {
        const key = acc.map((s) => `${s.marbleId}:${s.steps}`).sort().join(',');
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ kind: 'splitSeven', card, steps: acc.slice() });
        }
      }
      return;
    }
    // Computed once per recurse() call, not once per (marble, use) pair: `acc` can't change
    // inside the loop below, and hoisting it cut a ~56x redundant-clone factor
    // (remaining.length * left) off the search - an 8-marble case went from ~940ms to <100ms.
    const scratch = stateAfterSegments(state, acc);
    for (let i = 0; i < remaining.length; i++) {
      const marble = remaining[i];
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      const scratchMarble = scratch.marbles.find((m) => m.id === marble.id);
      if (!scratchMarble) continue;
      for (let use = 1; use <= left; use++) {
        if (!isMoveClear(scratch, scratchMarble, use)) continue;
        acc.push({ marbleId: marble.id, steps: use });
        recurse(rest, left - use);
        acc.pop();
      }
    }
  }
  recurse(eligible, total);
  return results;
}

// --- Applying a move ------------------------------------------------------

export function applyMove(state: GameState, player: PlayerId, move: Move): void {
  applyEffect(state, player, move);
  discardPlayedCard(state, player, move.card);
  checkWinner(state);
}

function applyEffect(state: GameState, player: PlayerId, move: Move): void {
  switch (move.kind) {
    case 'startMarble': {
      const startIdx = startIndexFor(state.config, player);
      // getLegalMoves guarantees no marble of the player's own is guarding the square; an
      // opponent's caught there is sent home, the same landing capture as any other move.
      const occupant = marbleAtTrackIndex(state, startIdx);
      if (occupant) sendToKennel(state, occupant);
      findMarble(state, move.marbleId).location = { zone: 'track', index: startIdx };
      break;
    }
    case 'moveMarble': {
      moveWithLandingCapture(state, findMarble(state, move.marbleId), move.steps);
      break;
    }
    case 'splitSeven': {
      for (const segment of move.steps) {
        moveWithPassOverCapture(state, findMarble(state, segment.marbleId), segment.steps);
      }
      break;
    }
    case 'swapJack': {
      const a = findMarble(state, move.marbleIdA);
      const b = findMarble(state, move.marbleIdB);
      const tmp = a.location;
      a.location = b.location;
      b.location = tmp;
      break;
    }
    case 'forceDraw': {
      const [stolen] = state.hands[move.targetPlayer].splice(move.targetCardIndex, 1);
      if (stolen) state.hands[player].push(stolen);
      break;
    }
    case 'copyLastCard':
    case 'wildAs': {
      // Effect only. The outer applyMove calls discardPlayedCard once for the real card;
      // recursing into it here would double-discard.
      applyEffect(state, player, move.innerMove);
      break;
    }
  }
}

/**
 * Landing exactly on your own start square - forward (lap complete) or backward (the 4's
 * house rule) - earns marble.hasLapped, which is what lets planMovement's atEntrance check
 * treat a later move from that square as "ready to turn in". Called by the two real movement
 * functions rather than by planMovement, which must stay side-effect free for previews.
 */
function markLappedIfAtOwnStart(state: GameState, marble: Marble): void {
  if (marble.location.zone === 'track' && marble.location.index === startIndexFor(state.config, marble.owner)) {
    marble.hasLapped = true;
  }
}

/** Every card but the 7: only the square the marble stops on is captured. */
function moveWithLandingCapture(state: GameState, marble: Marble, steps: number): void {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return; // unreachable if getLegalMoves gated this correctly
  if (plan.location.zone === 'track') {
    const occupant = marbleAtTrackIndex(state, plan.location.index);
    if (occupant && occupant.id !== marble.id) sendToKennel(state, occupant);
  }
  // Entering home is never a capture - a home stretch is private to its owner, so nothing
  // else can be sitting there to bump.
  marble.location = plan.location;
  markLappedIfAtOwnStart(state, marble);
}

/** The 7: burns every marble hopped over as well as the landing square. */
function moveWithPassOverCapture(state: GameState, marble: Marble, steps: number): void {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return;
  for (const index of plan.trackPassed) {
    const occupant = marbleAtTrackIndex(state, index);
    if (occupant && occupant.id !== marble.id) sendToKennel(state, occupant);
  }
  marble.location = plan.location;
  markLappedIfAtOwnStart(state, marble);
}

// --- Capture previews (read-only, for client highlighting) ----------------

/**
 * Track indices where `marble` walking `steps` would send another marble home - the
 * read-only counterpart of the two moveWith*Capture functions, so the client can highlight
 * kills without re-deriving the rule. `mode` picks which one it mirrors.
 */
export function captureIndicesFor(
  state: GameState,
  marble: Marble,
  steps: number,
  mode: 'landing' | 'passOver',
): number[] {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return [];
  // Entering home is never a capture, so a landing move ending in the home stretch flags
  // nothing - trackPassed there is only the run-up, which a non-7 walks straight over.
  const candidates = mode === 'passOver'
    ? plan.trackPassed
    : plan.location.zone === 'track' ? [plan.location.index] : [];
  return candidates.filter((index) => {
    const occupant = marbleAtTrackIndex(state, index);
    return !!occupant && occupant.id !== marble.id;
  });
}

/**
 * Every track index `move` would send a marble home from. A 7-split is walked sequentially,
 * the same way applyEffect runs its segments, since an earlier segment can move the very
 * marble a later one would otherwise have burned.
 */
export function moveCaptureIndices(state: GameState, move: Move): number[] {
  switch (move.kind) {
    case 'startMarble': {
      const startIdx = startIndexFor(state.config, state.currentPlayer);
      const occupant = marbleAtTrackIndex(state, startIdx);
      // Only an opponent can be there - your own marble makes the move illegal to begin
      // with (see getLegalMoves' blockedByOwnMarble).
      return occupant && occupant.id !== move.marbleId ? [startIdx] : [];
    }
    case 'moveMarble': {
      const marble = state.marbles.find((m) => m.id === move.marbleId);
      return marble ? captureIndicesFor(state, marble, move.steps, 'landing') : [];
    }
    case 'splitSeven': {
      const indices: number[] = [];
      const scratch = cloneMarbles(state);
      for (const segment of move.steps) {
        const marble = scratch.marbles.find((m) => m.id === segment.marbleId);
        if (!marble) continue;
        indices.push(...captureIndicesFor(scratch, marble, segment.steps, 'passOver'));
        moveWithPassOverCapture(scratch, marble, segment.steps);
      }
      return [...new Set(indices)];
    }
    case 'copyLastCard':
    case 'wildAs':
      return moveCaptureIndices(state, move.innerMove);
    // A swap displaces nobody and forceDraw never touches the track.
    default:
      return [];
  }
}

// --- Win condition --------------------------------------------------------

/**
 * A player (ffa) or both partners (teams) win the instant every one of their marbles is
 * home. Runs synchronously after each move, so ties aren't possible.
 */
function checkWinner(state: GameState): void {
  if (state.winners) return;
  const config = state.config;
  for (const player of activePlayerIds(config)) {
    const ownMarbles = state.marbles.filter((m) => m.owner === player);
    if (!ownMarbles.every((m) => m.location.zone === 'home')) continue;

    const partner = partnerOf(config, player);
    if (partner === null) {
      state.winners = [player];
      state.phase = 'gameEnd';
      return;
    }
    const partnerMarbles = state.marbles.filter((m) => m.owner === partner);
    if (partnerMarbles.every((m) => m.location.zone === 'home')) {
      state.winners = [player, partner];
      state.phase = 'gameEnd';
      return;
    }
  }
}

function discardPlayedCard(state: GameState, player: PlayerId, card: Card): void {
  const hand = state.hands[player];
  const idx = hand.findIndex((c) => c.id === card.id);
  if (idx !== -1) hand.splice(idx, 1);
  state.discardPile.push(card);
  state.lastPlayedCard = card;
  state.lastPlayedBy = player;
}
