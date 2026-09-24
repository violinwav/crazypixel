import { describe, expect, it } from 'vitest';
import { applyMove, getLegalMoves, moveCaptureIndices, type Move } from '../src';
import { board, card, marble, ofKind, onTrack } from './helpers';

// A marble fresh out of the kennel guards its start square until its own next move. The guard
// is a property of that marble (startProtected), not of the square - regression 0764fb4, where
// any owner's marble parked on its base made it a permanent sanctuary.

describe('start-square guard', () => {
  it('is set by startMarble and cleared by that marble moving off', () => {
    const state = board();
    applyMove(state, 0, { kind: 'startMarble', card: card('K'), marbleId: 'p0-m0' });
    expect(marble(state, 'p0-m0').startProtected).toBe(true);
    applyMove(state, 0, { kind: 'moveMarble', card: card('3'), marbleId: 'p0-m0', steps: 3 });
    expect(marble(state, 'p0-m0').startProtected).toBe(false);
  });

  it('blocks opponents from passing or landing on it', () => {
    const state = board();
    onTrack(state, 'p0-m0', 0, { startProtected: true });
    onTrack(state, 'p3-m0', 62);
    for (const rank of ['2', '5'] as const) {
      const moves = ofKind(getLegalMoves(state, 3, card(rank)), 'moveMarble');
      expect(moves.some((m) => m.marbleId === 'p3-m0')).toBe(false);
    }
  });

  it("blocks the owner's own marbles too, including their way into home", () => {
    const state = board();
    onTrack(state, 'p0-m0', 0, { startProtected: true });
    onTrack(state, 'p0-m1', 62);
    const moves = ofKind(getLegalMoves(state, 0, card('5')), 'moveMarble');
    expect(moves.some((m) => m.marbleId === 'p0-m1')).toBe(false);
  });

  it('does not protect a marble that lapped back onto its own start square', () => {
    const state = board();
    onTrack(state, 'p0-m0', 0, { hasLapped: true });
    onTrack(state, 'p3-m0', 62);
    const passes = ofKind(getLegalMoves(state, 3, card('5')), 'moveMarble');
    expect(passes.some((m) => m.marbleId === 'p3-m0')).toBe(true);

    applyMove(state, 3, { kind: 'moveMarble', card: card('2'), marbleId: 'p3-m0', steps: 2 });
    expect(marble(state, 'p0-m0').location.zone).toBe('kennel');
  });
});

describe('startMarble', () => {
  it('is blocked by any of your own marbles on your start square, guard or not', () => {
    const state = board();
    onTrack(state, 'p0-m0', 0, { hasLapped: true });
    expect(ofKind(getLegalMoves(state, 0, card('A')), 'startMarble')).toHaveLength(0);
  });

  it("sends an opponent's marble on your start square home", () => {
    const state = board();
    onTrack(state, 'p1-m0', 0);
    const move: Move = { kind: 'startMarble', card: card('A'), marbleId: 'p0-m0' };
    expect(getLegalMoves(state, 0, move.card)).toContainEqual(expect.objectContaining({ kind: 'startMarble' }));
    expect(moveCaptureIndices(state, move)).toEqual([0]);
    applyMove(state, 0, move);
    expect(marble(state, 'p1-m0').location.zone).toBe('kennel');
    expect(marble(state, 'p0-m0').location).toEqual({ zone: 'track', index: 0 });
  });
});

describe('jack swap', () => {
  it('excludes guarding marbles from both sides but allows a lapped one on its start', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p1-m0', 16, { startProtected: true });
    onTrack(state, 'p2-m0', 32, { hasLapped: true });
    const swaps = ofKind(getLegalMoves(state, 0, card('J')), 'swapJack');
    const pairs = swaps.map((s) => [s.marbleIdA, s.marbleIdB]);
    expect(pairs).toContainEqual(['p0-m0', 'p2-m0']);
    expect(pairs).not.toContainEqual(['p0-m0', 'p1-m0']);
  });

  it('only swaps with one of your own marbles on side A', () => {
    const state = board();
    onTrack(state, 'p1-m0', 10);
    onTrack(state, 'p2-m0', 20);
    expect(ofKind(getLegalMoves(state, 0, card('J')), 'swapJack')).toHaveLength(0);
  });
});
