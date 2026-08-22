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
      marbles.push({ id: `p${player}-m${slot}`, owner: player, location: { zone: 'kennel', index: slot } });
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
    currentPlayer: 1, // every config has at least 2 players, so index 1 always exists
    phase: 'dealing',
    winners: null,
  };
}

function drawCards(state: GameState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.drawPile.length === 0) {
      // Deck empties across a real game - reshuffle the discard pile rather than crash.
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

/** Each player passes one chosen card face-down to their partner before play starts.
 * 'ffa' mode has no partner to pass to - not called in that mode. */
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
 * Deals round 1 and drops straight into play. The card-passing sub-phase (each player
 * passes one card to their partner before play starts) is a real rule but isn't wired to
 * any UI yet, so this skips it rather than fake it - phase goes straight to 'playing'.
 */
export function startGame(state: GameState): void {
  dealRound(state);
  state.phase = 'playing';
  // createInitialState's currentPlayer: 1 is just a type-safe placeholder (every config has
  // at least 2 players, so index 1 is always valid to construct with) - it was never meant
  // to be the real starting player. Without this, every game silently opened on Player 2,
  // skipping Player 1's entire first turn.
  state.currentPlayer = activePlayerIds(state.config)[0];
}

/**
 * A player with no legal move for any card in hand discards their whole hand at once and
 * sits out (empty hand) until the next round's redeal - a full pass, not just a skipped
 * turn. Doesn't touch lastPlayedCard/lastPlayedBy: a pass isn't a played card, and letting
 * the next player's custom-8 "copy last card" reach back through a pass would be exploitable.
 */
export function passHand(state: GameState, player: PlayerId): void {
  state.discardPile.push(...state.hands[player]);
  state.hands[player] = [];
}

/**
 * Advances to the next active player with cards left in hand (skipping anyone who has
 * already passHand'd this round). When every hand is empty, deals the next round first
 * (dealer rotation isn't implemented - the same seat order continues across round
 * boundaries rather than starting from whoever the new "dealer" would be).
 */
export function advanceTurn(state: GameState): void {
  const players = activePlayerIds(state.config);
  if (players.every((p) => state.hands[p].length === 0)) {
    state.roundIndex += 1;
    dealRound(state);
    state.phase = 'playing';
    state.currentPlayer = players[(players.indexOf(state.currentPlayer) + 1) % players.length];
    return;
  }
  let idx = (players.indexOf(state.currentPlayer) + 1) % players.length;
  while (state.hands[players[idx]].length === 0) {
    idx = (idx + 1) % players.length;
  }
  state.currentPlayer = players[idx];
}

function findMarble(state: GameState, marbleId: string): Marble {
  const marble = state.marbles.find((m) => m.id === marbleId);
  if (!marble) throw new Error(`Unknown marble ${marbleId}`);
  return marble;
}

function marbleAtTrackIndex(state: GameState, index: number): Marble | undefined {
  return state.marbles.find((m) => m.location.zone === 'track' && m.location.index === index);
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
}

/**
 * Rule text: once a marble sits on its owner's start square, passage there is blocked for
 * every marble on the board - including the owner's own others - until it moves away. The
 * guard marble also can't be sent home while it sits there.
 */
function isBlockaded(state: GameState, index: number): boolean {
  const owner = activePlayerIds(state.config).find((p) => startIndexFor(state.config, p) === index);
  if (owner === undefined) return false;
  const guard = marbleAtTrackIndex(state, index);
  return !!guard && guard.owner === owner;
}

export interface MovementPlan {
  location: MarbleLocation;
  /** Track-space indices passed through, for blockade checks and the 7's pass-over
   * capture. Doesn't include home-stretch slots - those aren't track squares, and nothing
   * on the main track can block or be passed-over-captured there. */
  trackPassed: number[];
  legal: boolean;
}

/**
 * Where a marble ends up after `steps` (positive = forward, negative = backward, e.g. the
 * 4's back-4 option).
 *
 * Forward: a marble enters home the moment its path would carry it *past* its own start
 * square (completing a lap). Landing *exactly* on the start square (not past it) doesn't
 * count as entering yet - it's still an ordinary track square at that point.
 *
 * Backward: there is no shortcut that drops a marble into home directly. Going backward is
 * a perfectly ordinary walk around the track (wrapping past index 0 the same way forward
 * movement wraps past trackLength-1) - it never enters home by itself, no matter how far
 * back it goes or whether it passes the marble's own start square along the way. House rule
 * text: landing exactly on your own start square by going backward earns the *right* to
 * enter home without doing the full lap - but that's a later, separate forward move
 * crossing the start square, handled by the ordinary forward-entry branch above. This
 * function doesn't need to track that eligibility itself; it falls out for free; once a
 * backward walk lands a marble anywhere, a later forward move behaves exactly as it always
 * has, and "how far around the lap" that marble already was makes no difference to it.
 *
 * Exported (not just an internal legality-check helper) so the client can preview the same
 * authoritative path for move highlighting and descriptions, instead of a second,
 * simplified re-derivation that doesn't know about home-stretch entry drifting out of sync
 * with this one.
 */
export function planMovement(state: GameState, marble: Marble, steps: number): MovementPlan {
  const config = state.config;
  const trackLength = trackLengthFor(config);

  if (marble.location.zone === 'home') {
    // Further movement within home (rare, but the 4's backward option could apply here
    // too) - clamped, can't back out onto the main track once home.
    const newIndex = marble.location.index + steps;
    const legal = newIndex >= 0 && newIndex < HOME_STRETCH_LENGTH;
    return { location: legal ? { zone: 'home', index: newIndex } : marble.location, trackPassed: [], legal };
  }

  const startIndex = startIndexFor(config, marble.owner);
  const lapPos = ((marble.location.index - startIndex) % trackLength + trackLength) % trackLength;
  const newLapPos = lapPos + steps;

  if (newLapPos > trackLength) {
    const homeSlot = newLapPos - trackLength - 1;
    if (homeSlot < HOME_STRETCH_LENGTH) {
      const stepsToStart = trackLength - lapPos;
      const trackPassed = pathIndices(marble.location.index, stepsToStart, trackLength);
      return { location: { zone: 'home', index: homeSlot }, trackPassed, legal: true };
    }
    // Overshoots the home stretch (e.g. 3 marbles already home, only the 4th home slot
    // open, but this card's value would carry past it) - house rule: this is NOT illegal,
    // the marble just keeps walking the main track past its own start square instead of
    // being forced to wait for a card that lines up exactly. Plain wraparound, same math as
    // the "far from home" branch below, just reached via the overshoot path instead.
  }

  const trackPassed = pathIndices(marble.location.index, steps, trackLength);
  return { location: { zone: 'track', index: trackPassed[trackPassed.length - 1] }, trackPassed, legal: true };
}

/** Would `marble` landing at `plan.location` sit on top of another of its own owner's
 * marbles - track square or home slot. Never true for an opponent's marble (that's a
 * capture, not a stacking conflict) - your own marbles simply can't share a square, on the
 * field or in the goal. */
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

/** Marbles inside the home stretch can't hop over each other on the way to a further slot -
 * no capturing happens there, so a blocked path is just illegal, the same as a start-square
 * guard blocks the main track. Covers both a home-to-home move (marble already in the goal,
 * moving to another slot) AND a track-to-home entry (marble crossing in fresh - every slot
 * from 0 up to the landing slot counts as "passed through" and must be clear too, not just
 * the landing slot itself). planMovement's trackPassed is empty for home-stretch space either
 * way, so this checks the home slots in between separately rather than folding it into the
 * track blockade check above. */
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

export function getLegalMoves(state: GameState, player: PlayerId, card: Card): Move[] {
  const def = CARD_DEFS[card.rank];
  const moves: Move[] = [];
  const config = state.config;
  const ownMarbles = state.marbles.filter((m) => m.owner === player);

  if (def.canStart) {
    const inKennel = ownMarbles.find((m) => m.location.zone === 'kennel');
    const occupant = marbleAtTrackIndex(state, startIndexFor(config, player));
    // Your own marble on your start square blocks entry (same guard-square rule as
    // isBlockaded) - an opponent's marble does not, it gets sent home instead (see
    // applyEffect's startMarble case), same as any other landing capture.
    const blockedByOwnMarble = !!occupant && occupant.owner === player;
    if (inKennel && !blockedByOwnMarble) {
      moves.push({ kind: 'startMarble', card, marbleId: inKennel.id });
    }
  }

  if (def.isJack) {
    // A marble still sitting on its own start square hasn't really "entered play" yet (it's
    // also the blockade guard there - see isBlockaded) - swapping it away, or swapping
    // another marble onto it, isn't allowed until it's moved off that square at least once.
    const isAtOwnStart = (m: Marble) => m.location.zone === 'track' && m.location.index === startIndexFor(config, m.owner);
    const onTrack = state.marbles.filter((m) => m.location.zone === 'track' && !isAtOwnStart(m));
    for (const a of onTrack.filter((m) => m.owner === player)) {
      for (const b of onTrack.filter((m) => m.id !== a.id)) {
        moves.push({ kind: 'swapJack', card, marbleIdA: a.id, marbleIdB: b.id });
      }
    }
  }

  // "Draw opponent's card" - a blind steal, not a forced draw from the shared pile: the
  // acting player picks a position in the target's hand (shown face-down client-side, see
  // StealCardOverlay.tsx) without seeing what's there. Every hand position is equally
  // takeable, so this enumerates one legal move per (opponent, position) pair rather than
  // one per opponent - same "let the UI narrow a pre-enumerated set" pattern as the 7-split
  // and Joker rank picker.
  if (def.customTwo) {
    for (const opponent of opponentsOf(config, player)) {
      for (let i = 0; i < state.hands[opponent].length; i++) {
        moves.push({ kind: 'forceDraw', card, targetPlayer: opponent, targetCardIndex: i });
      }
    }
  }

  // House rule: an 8 either moves 8, or replays whatever the previous card did. Copying
  // another 8 is disallowed to avoid open-ended recursion (not specified in source text).
  // Copying a JOKER is disallowed for the same reason, and it's not just symmetry: the
  // Joker's own "act as any card" below synthesizes an 8 variant when computing its
  // options, which would hit this exact branch and try to copy the Joker again - infinite
  // mutual recursion between the two house rules (confirmed via a real stack overflow
  // before this guard existed).
  if (
    def.customEight
    && state.lastPlayedCard
    && state.lastPlayedCard.rank !== '8'
    && state.lastPlayedCard.rank !== 'JOKER'
  ) {
    for (const inner of getLegalMoves(state, player, state.lastPlayedCard)) {
      moves.push({ kind: 'copyLastCard', card, innerMove: inner });
    }
  }

  // "Start or use as any card desired" - union every other rank's legal moves under this
  // one Joker play. The UI picks a rank first, then a target, rather than flooding the
  // board with every possible move for every rank at once (see BoardOverlay/HandPanel).
  // Picking "A" or "K" here includes their own startMarble option too, even though the
  // Joker's own bare canStart (above) already reaches the same move a different way -
  // playing the Joker *as* a King should do everything a real King can, starting included,
  // not a strict subset that pushes the player back to a separate generic "Start" option.
  if (def.isWild) {
    for (const asRank of RANKS) {
      const asCard: Card = { id: card.id, suit: card.suit, rank: asRank };
      for (const inner of getLegalMoves(state, player, asCard)) {
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
    // Home-stretch marbles are eligible too, moved individually same as any other segment -
    // isMoveClear's homeStretchOvertake check is what actually stops them hopping over each
    // other, not blanket exclusion from the split in the first place.
    const onTrackOrHome = (m: Marble) => m.location.zone === 'track' || m.location.zone === 'home';
    const eligible = ownMarbles
      .filter(onTrackOrHome)
      .concat(partner !== null ? state.marbles.filter((m) => m.owner === partner && onTrackOrHome(m)) : []);
    moves.push(...generateSevenSplits(state, eligible, 7, card));
  }

  return moves;
}

/** Replays `segments` (in order) onto a fresh clone of `state`, via the same pass-over-
 * capture movement each segment will really use - so a candidate combination's later
 * segments get checked for legality against the board as it would actually look partway
 * through the split, not the untouched starting position. This is what lets "move the
 * marble that just entered off the gateway 1 step, then the blocked marble behind it can
 * now take the other 6 into home" exist as a legal combination at all - checking every
 * segment against the pristine original state (the previous approach) meant the second
 * marble's blockade never appeared to clear, since the first marble's hypothetical move
 * never actually happened anywhere the check could see it. */
function stateAfterSegments(state: GameState, segments: { marbleId: string; steps: number }[]): GameState {
  // Only `marbles` ever gets read or mutated by moveWithPassOverCapture/isMoveClear below -
  // hands/drawPile/discardPile are irrelevant to movement legality, so they're reused by
  // reference (never touched here) instead of deep-cloned. This is called a LOT during
  // generateSevenSplits's search (every candidate order, every prefix) - structuredClone-ing
  // the entire GameState (including all 54 cards across every hand/pile) on each call was
  // the real cost there, not the marbles array itself (confirmed live: an 8-marble 7-split
  // scenario took ~17 seconds with a full structuredClone per call).
  const scratch: GameState = { ...state, marbles: state.marbles.map((m) => ({ ...m, location: { ...m.location } })) };
  for (const segment of segments) {
    const marble = scratch.marbles.find((m) => m.id === segment.marbleId);
    if (marble) moveWithPassOverCapture(scratch, marble, segment.steps);
  }
  return scratch;
}

function generateSevenSplits(state: GameState, eligible: Marble[], total: number, card: Card): Move[] {
  const results: Move[] = [];
  const seen = new Set<string>();
  const acc: { marbleId: string; steps: number }[] = [];

  // A given (marbleId -> steps) assignment can have more than one execution order, and only
  // some of those orders may actually be legal - "the marble that just entered moves 1 step
  // out of the way, THEN the blocked marble takes 6 into home" is legal, but the reverse
  // order isn't (checked segment-by-segment via stateAfterSegments). The old version always
  // tried marbles in one fixed array order (`eligible`'s own order), so if the marble that
  // needed to move *first* happened to sit *later* in that array, this combination was never
  // generated at all - confirmed live, a real repro matching this exact scenario. Picking
  // the next marble to move from whatever's still `remaining` (not a fixed index) explores
  // every execution order, so a legal one gets found whenever it exists, regardless of which
  // array slot either marble started in.
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
    // `acc` (and therefore the state it replays to) doesn't change across this whole
    // double loop - only a push below changes it, and that always happens after every
    // (marble, use) pair in the current loop has been checked against the SAME scratch.
    // Computing it once per recurse() call instead of once per (marble, use) pair cut a
    // real ~56x redundant-clone factor (remaining.length * left) off the search - confirmed
    // live, an 8-marble scenario went from ~940ms to well under 100ms.
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

export function applyMove(state: GameState, player: PlayerId, move: Move): void {
  applyEffect(state, player, move);
  discardPlayedCard(state, player, move.card);
  checkWinner(state);
}

function applyEffect(state: GameState, player: PlayerId, move: Move): void {
  switch (move.kind) {
    case 'startMarble': {
      const startIdx = startIndexFor(state.config, player);
      // Legal only when nobody's own marble is guarding the square (see getLegalMoves) - an
      // opponent's marble caught there gets sent home, same landing-capture as any other move.
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
      // Effect only - discardPlayedCard (called once, by the outer applyMove) handles the
      // real card in hand. Replaying here too would double-discard the old card.
      applyEffect(state, player, move.innerMove);
      break;
    }
  }
}

function moveWithLandingCapture(state: GameState, marble: Marble, steps: number): void {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return; // shouldn't happen if getLegalMoves gated this correctly
  if (plan.location.zone === 'track') {
    const occupant = marbleAtTrackIndex(state, plan.location.index);
    if (occupant && occupant.id !== marble.id) sendToKennel(state, occupant);
  }
  // Entering home is never a capture - each player's home stretch is private to them,
  // nothing else can ever be sitting there to bump.
  marble.location = plan.location;
}

/** The 7 additionally burns any marble it hops over along the way, not just the landing
 * square - including, now, marbles passed on the way into a home-stretch entry. */
function moveWithPassOverCapture(state: GameState, marble: Marble, steps: number): void {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return;
  for (const index of plan.trackPassed) {
    const occupant = marbleAtTrackIndex(state, index);
    if (occupant && occupant.id !== marble.id) sendToKennel(state, occupant);
  }
  marble.location = plan.location;
}

/** A player (ffa) or both members of a team (teams) win the instant every one of their
 * marbles is home. Checked after every move; first to qualify wins, ties aren't possible
 * since this runs synchronously after each single move. */
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
