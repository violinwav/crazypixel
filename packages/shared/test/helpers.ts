// Hand-built boards for engine tests. Every test starts from an all-kennel board and places
// only the marbles it cares about, so a failing case reads as the exact position that broke.

import {
  createInitialState, type Card, type CardRank, type GameMode, type GameState, type Marble, type Move,
} from '../src';

export function board(playerCount: 2 | 3 | 4 | 5 | 6 = 4, mode: GameMode = 'ffa'): GameState {
  const state = createInitialState({ playerCount, mode });
  state.phase = 'playing';
  state.currentPlayer = 0;
  return state;
}

export function marble(state: GameState, id: string): Marble {
  const found = state.marbles.find((m) => m.id === id);
  if (!found) throw new Error(`No marble ${id}`);
  return found;
}

export function onTrack(
  state: GameState,
  id: string,
  index: number,
  flags: { hasLapped?: boolean; startProtected?: boolean } = {},
): Marble {
  const m = marble(state, id);
  m.location = { zone: 'track', index };
  m.hasLapped = flags.hasLapped ?? false;
  m.startProtected = flags.startProtected ?? false;
  return m;
}

export function inHome(state: GameState, id: string, slot: number): Marble {
  const m = marble(state, id);
  m.location = { zone: 'home', index: slot };
  return m;
}

let cardSeq = 0;

/** Card ids only need to be unique within a test - discardPlayedCard matches on id. */
export function card(rank: CardRank): Card {
  return { id: `t${cardSeq++}`, suit: rank === 'JOKER' ? null : 'hearts', rank };
}

export function ofKind<K extends Move['kind']>(moves: Move[], kind: K): Extract<Move, { kind: K }>[] {
  return moves.filter((m): m is Extract<Move, { kind: K }> => m.kind === kind);
}

export type Segments = { marbleId: string; steps: number }[];

export function splitsOf(moves: Move[]): Segments[] {
  return ofKind(moves, 'splitSeven').map((m) => m.steps);
}

export function sameSplit(a: Segments, b: Segments): boolean {
  return a.length === b.length && a.every((s, i) => s.marbleId === b[i].marbleId && s.steps === b[i].steps);
}
