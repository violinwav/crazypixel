import type { Card, CardRank, GameState, Marble, Move, PlayerId } from './types';
import {
  CARD_DEFS, PARTNER_OF, TEAM_OF, PLAYER_IDS, ROUND_DEAL_SIZES,
  START_INDEX, KENNEL_SIZE,
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

export function createInitialState(): GameState {
  const marbles: Marble[] = [];
  for (const player of PLAYER_IDS) {
    for (let slot = 0; slot < KENNEL_SIZE; slot++) {
      marbles.push({ id: `p${player}-m${slot}`, owner: player, location: { zone: 'kennel', index: slot } });
    }
  }
  return {
    marbles,
    hands: { 0: [], 1: [], 2: [], 3: [] },
    drawPile: shuffle(createDeck()),
    discardPile: [],
    lastPlayedCard: null,
    lastPlayedBy: null,
    roundIndex: 0,
    dealerIndex: 0,
    currentPlayer: 1,
    phase: 'dealing',
    winningTeam: null,
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
  for (const player of PLAYER_IDS) {
    state.hands[player] = drawCards(state, dealSize);
  }
  state.phase = 'cardPass';
}

/** Each player passes one chosen card face-down to their partner before play starts. */
export function passCard(state: GameState, from: PlayerId, card: Card): void {
  const hand = state.hands[from];
  const idx = hand.findIndex((c) => c.id === card.id);
  if (idx === -1) throw new Error('Card not in hand');
  hand.splice(idx, 1);
  state.hands[PARTNER_OF[from]].push(card);
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
  const owner = PLAYER_IDS.find((p) => START_INDEX[p] === index);
  if (owner === undefined) return false;
  const guard = marbleAtTrackIndex(state, index);
  return !!guard && guard.owner === owner;
}

function isPathClear(state: GameState, fromIndex: number, steps: number): boolean {
  return pathIndices(fromIndex, steps).every((i) => !isBlockaded(state, i));
}

export function getLegalMoves(state: GameState, player: PlayerId, card: Card): Move[] {
  const def = CARD_DEFS[card.rank];
  const moves: Move[] = [];
  const ownMarbles = state.marbles.filter((m) => m.owner === player);

  if (def.canStart) {
    const inKennel = ownMarbles.find((m) => m.location.zone === 'kennel');
    const startOccupied = marbleAtTrackIndex(state, START_INDEX[player]);
    if (inKennel && !startOccupied) {
      moves.push({ kind: 'startMarble', card, marbleId: inKennel.id });
    }
  }

  if (def.isJack) {
    const onTrack = state.marbles.filter((m) => m.location.zone === 'track');
    for (const a of onTrack.filter((m) => m.owner === player)) {
      for (const b of onTrack.filter((m) => m.id !== a.id)) {
        moves.push({ kind: 'swapJack', card, marbleIdA: a.id, marbleIdB: b.id });
      }
    }
  }

  if (def.customTwo) {
    for (const opponent of PLAYER_IDS.filter((p) => TEAM_OF[p] !== TEAM_OF[player])) {
      moves.push({ kind: 'forceDraw', card, targetPlayer: opponent });
    }
  }

  // House rule: an 8 either moves 8, or replays whatever the previous card did. Copying
  // another 8 is disallowed to avoid open-ended recursion (not specified in source text).
  if (def.customEight && state.lastPlayedCard && state.lastPlayedCard.rank !== '8') {
    for (const inner of getLegalMoves(state, player, state.lastPlayedCard)) {
      moves.push({ kind: 'copyLastCard', card, innerMove: inner });
    }
  }

  for (const marble of ownMarbles.filter((m) => m.location.zone === 'track')) {
    for (const steps of def.moveOptions) {
      if (isPathClear(state, marble.location.index, steps)) {
        moves.push({ kind: 'moveMarble', card, marbleId: marble.id, steps });
      }
    }
  }

  if (def.isSevenSplit) {
    const eligible = ownMarbles
      .filter((m) => m.location.zone === 'track')
      .concat(state.marbles.filter((m) => m.owner === PARTNER_OF[player] && m.location.zone === 'track'));
    moves.push(...generateSevenSplits(state, eligible, 7, card));
  }

  return moves;
}

function generateSevenSplits(state: GameState, eligible: Marble[], total: number, card: Card): Move[] {
  const results: Move[] = [];
  const acc: { marbleId: string; steps: number }[] = [];

  function recurse(idx: number, left: number) {
    if (left === 0) {
      if (acc.length > 0) results.push({ kind: 'splitSeven', card, steps: acc.slice() });
      return;
    }
    if (idx >= eligible.length) return;
    for (let use = 0; use <= left; use++) {
      if (use > 0) {
        const marble = eligible[idx];
        if (!isPathClear(state, marble.location.index, use)) continue;
        acc.push({ marbleId: marble.id, steps: use });
      }
      recurse(idx + 1, left - use);
      if (use > 0) acc.pop();
    }
  }
  recurse(0, total);
  return results;
}

export function applyMove(state: GameState, player: PlayerId, move: Move): void {
  applyEffect(state, player, move);
  discardPlayedCard(state, player, move.card);
}

function applyEffect(state: GameState, player: PlayerId, move: Move): void {
  switch (move.kind) {
    case 'startMarble': {
      findMarble(state, move.marbleId).location = { zone: 'track', index: START_INDEX[player] };
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
      const [card] = drawCards(state, 1);
      if (card) state.hands[move.targetPlayer].push(card);
      break;
    }
    case 'copyLastCard': {
      // Effect only - discardPlayedCard (called once, by the outer applyMove) handles the
      // real card in hand. Replaying here too would double-discard the old card.
      applyEffect(state, player, move.innerMove);
      break;
    }
  }
}

function moveWithLandingCapture(state: GameState, marble: Marble, steps: number): void {
  const path = pathIndices(marble.location.index, steps);
  const destination = path[path.length - 1];
  const occupant = marbleAtTrackIndex(state, destination);
  if (occupant && occupant.id !== marble.id) sendToKennel(state, occupant);
  marble.location = { zone: 'track', index: destination };
}

/** The 7 additionally burns any marble it hops over along the way, not just the landing square. */
function moveWithPassOverCapture(state: GameState, marble: Marble, steps: number): void {
  const path = pathIndices(marble.location.index, steps);
  for (const index of path) {
    const occupant = marbleAtTrackIndex(state, index);
    if (occupant && occupant.id !== marble.id) sendToKennel(state, occupant);
  }
  marble.location = { zone: 'track', index: path[path.length - 1] };
}

function discardPlayedCard(state: GameState, player: PlayerId, card: Card): void {
  const hand = state.hands[player];
  const idx = hand.findIndex((c) => c.id === card.id);
  if (idx !== -1) hand.splice(idx, 1);
  state.discardPile.push(card);
  state.lastPlayedCard = card;
  state.lastPlayedBy = player;
}

// TODO(rules): home-stretch entry ("Zieleinlauf") and win detection aren't implemented yet.
// The source rulebook's line - "to reach the goal, your own start must be passed at least
// twice, forward and backward" - didn't translate into an unambiguous condition. Marbles
// currently just loop the 64-square track forever. Needs a rules clarification pass (see
// README "Assumptions") before this is playable end-to-end.
