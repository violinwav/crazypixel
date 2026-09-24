import { describe, expect, it } from 'vitest';
import { applyMove, getLegalMoves, passHand } from '../src';
import { board, card, marble, ofKind, onTrack } from './helpers';

describe('the 8: move 8 or replay the last card', () => {
  it('offers the last card\'s moves as copyLastCard', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    state.lastPlayedCard = card('3');
    const copies = ofKind(getLegalMoves(state, 0, card('8')), 'copyLastCard');
    expect(copies.map((c) => c.innerMove)).toContainEqual(
      expect.objectContaining({ kind: 'moveMarble', marbleId: 'p0-m0', steps: 3 }),
    );
  });

  it('cannot copy another 8', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    state.lastPlayedCard = card('8');
    expect(ofKind(getLegalMoves(state, 0, card('8')), 'copyLastCard')).toHaveLength(0);
  });

  // Regression (129a0d4): 8-copies-Joker and Joker-as-8 expanded into each other forever and
  // blew the stack. Copying a Joker is allowed, but only one hop deep.
  it('can copy a Joker without recursing forever', () => {
    const state = board();
    state.lastPlayedCard = card('JOKER');
    const copies = ofKind(getLegalMoves(state, 0, card('8')), 'copyLastCard');
    expect(copies.map((c) => c.innerMove)).toContainEqual(
      expect.objectContaining({ kind: 'wildAs', asRank: 'K', innerMove: expect.objectContaining({ kind: 'startMarble' }) }),
    );
  });

  it('lets a Joker play as an 8 that copies a previous Joker', () => {
    const state = board();
    state.lastPlayedCard = card('JOKER');
    const asEight = ofKind(getLegalMoves(state, 0, card('JOKER')), 'wildAs').filter((m) => m.asRank === '8');
    expect(asEight.some((m) => m.innerMove.kind === 'copyLastCard')).toBe(true);
  });

  it('discards only the 8 itself when the copy is applied', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    const eight = card('8');
    state.hands[0] = [eight, card('Q')];
    state.lastPlayedCard = card('3');
    const move = ofKind(getLegalMoves(state, 0, eight), 'copyLastCard')[0];
    applyMove(state, 0, move);
    expect(marble(state, 'p0-m0').location).toEqual({ zone: 'track', index: 13 });
    expect(state.discardPile).toEqual([eight]);
    expect(state.hands[0].map((c) => c.rank)).toEqual(['Q']);
    expect(state.lastPlayedCard).toBe(eight);
  });

  // A pass isn't a played card, so the next 8 can't reach back through it.
  it('ignores a passHand when looking for the last card', () => {
    const state = board();
    const three = card('3');
    state.lastPlayedCard = three;
    state.lastPlayedBy = 0;
    state.hands[1] = [card('Q'), card('9')];
    passHand(state, 1);
    expect(state.hands[1]).toHaveLength(0);
    expect(state.lastPlayedCard).toBe(three);
    expect(state.lastPlayedBy).toBe(0);
  });
});

describe('the Joker', () => {
  it('can start a marble and act as every other rank', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    const moves = getLegalMoves(state, 0, card('JOKER'));
    expect(ofKind(moves, 'startMarble')).toHaveLength(1);
    const ranks = new Set(ofKind(moves, 'wildAs').map((m) => m.asRank));
    // No J: a lone marble has nothing to swap with.
    expect([...ranks].sort()).toEqual(['10', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'K', 'Q']);
  });
});

describe('the 2: blind steal', () => {
  it('targets every card position of each opponent, never the partner', () => {
    const state = board(4, 'teams');
    state.hands[1] = [card('3'), card('4')];
    state.hands[2] = [card('5')];
    state.hands[3] = [card('6')];
    const steals = ofKind(getLegalMoves(state, 0, card('2')), 'forceDraw');
    expect(steals.map((s) => [s.targetPlayer, s.targetCardIndex])).toEqual([[1, 0], [1, 1], [3, 0]]);
  });

  it('moves the chosen card from the target\'s hand into the player\'s', () => {
    const state = board();
    const two = card('2');
    const taken = card('K');
    state.hands[0] = [two];
    state.hands[1] = [card('3'), taken, card('4')];
    applyMove(state, 0, { kind: 'forceDraw', card: two, targetPlayer: 1, targetCardIndex: 1 });
    expect(state.hands[0]).toEqual([taken]);
    expect(state.hands[1].map((c) => c.rank)).toEqual(['3', '4']);
  });
});
