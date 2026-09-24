import { describe, expect, it } from 'vitest';
import {
  ROUND_DEAL_SIZES, advanceTurn, applyMove, createDeck, createInitialState, dealRound, startGame,
} from '../src';
import { board, card, inHome, onTrack } from './helpers';

describe('deck and dealing', () => {
  it('builds 52 suited cards plus 2 Jokers, all with unique ids', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck.map((c) => c.id)).size).toBe(54);
    expect(deck.filter((c) => c.rank === 'JOKER')).toHaveLength(2);
    expect(deck.filter((c) => c.rank === '7')).toHaveLength(4);
  });

  it('deals the round\'s hand size to every active seat', () => {
    const state = createInitialState({ playerCount: 3, mode: 'ffa' });
    for (let round = 0; round < ROUND_DEAL_SIZES.length + 1; round++) {
      state.roundIndex = round;
      for (const p of [0, 1, 2] as const) state.discardPile.push(...state.hands[p]);
      dealRound(state);
      const expected = ROUND_DEAL_SIZES[round % ROUND_DEAL_SIZES.length];
      for (const p of [0, 1, 2] as const) expect(state.hands[p]).toHaveLength(expected);
      expect(state.hands[3]).toHaveLength(0);
    }
  });

  it('reshuffles the discard pile once the draw pile runs out', () => {
    const state = createInitialState({ playerCount: 2, mode: 'ffa' });
    state.discardPile = state.drawPile;
    state.drawPile = [];
    dealRound(state);
    expect(state.hands[0]).toHaveLength(6);
    expect(state.hands[1]).toHaveLength(6);
    expect(state.drawPile.length + state.discardPile.length).toBe(54 - 12);
  });
});

describe('turn order', () => {
  // Regression (129a0d4): createInitialState's placeholder seat 1 leaked through and every game
  // opened on Player 2.
  it('opens the game on seat 0, with the last seat as dealer', () => {
    const state = createInitialState({ playerCount: 4, mode: 'ffa' });
    startGame(state);
    expect(state.phase).toBe('playing');
    expect(state.currentPlayer).toBe(0);
    expect(state.dealerIndex).toBe(3);
    expect(state.hands[0]).toHaveLength(ROUND_DEAL_SIZES[0]);
  });

  it('skips seats that have already passed their hand', () => {
    const state = board();
    state.hands[0] = [card('3')];
    state.hands[1] = [];
    state.hands[2] = [];
    state.hands[3] = [card('5')];
    advanceTurn(state);
    expect(state.currentPlayer).toBe(3);
  });

  // Regression (129a0d4): the next round used to open on whoever moved last, which depends on
  // the order players ran out of cards rather than on the deal rotating round the table.
  it('rotates the dealer each round and opens on the seat after them', () => {
    const state = createInitialState({ playerCount: 4, mode: 'ffa' });
    startGame(state);
    for (const p of [0, 1, 2, 3] as const) state.hands[p] = [];
    state.currentPlayer = 2;
    advanceTurn(state);
    expect(state.roundIndex).toBe(1);
    expect(state.dealerIndex).toBe(0);
    expect(state.currentPlayer).toBe(1);
    expect(state.hands[0]).toHaveLength(ROUND_DEAL_SIZES[1]);

    for (const p of [0, 1, 2, 3] as const) state.hands[p] = [];
    state.currentPlayer = 0;
    advanceTurn(state);
    expect(state.dealerIndex).toBe(1);
    expect(state.currentPlayer).toBe(2);
  });
});

describe('winning', () => {
  // Regression (a249b8e): a winning move that also emptied the last hand fell into
  // advanceTurn's redeal branch, which put phase back to 'playing' and hid the win screen.
  it('ends the game and stays ended even when the winning move empties the last hand', () => {
    const state = board(2, 'ffa');
    inHome(state, 'p0-m1', 1);
    inHome(state, 'p0-m2', 2);
    inHome(state, 'p0-m3', 3);
    onTrack(state, 'p0-m0', 30);
    const three = card('3');
    state.hands[0] = [three];
    state.hands[1] = [];
    applyMove(state, 0, { kind: 'moveMarble', card: three, marbleId: 'p0-m0', steps: 3 });
    expect(state.winners).toEqual([0]);
    expect(state.phase).toBe('gameEnd');

    advanceTurn(state);
    expect(state.phase).toBe('gameEnd');
    expect(state.roundIndex).toBe(0);
    expect(state.hands[0]).toHaveLength(0);
  });

  it('needs both partners home in teams mode', () => {
    const state = board(4, 'teams');
    for (const p of [0, 2]) {
      for (let i = 1; i < 4; i++) inHome(state, `p${p}-m${i}`, i);
    }
    onTrack(state, 'p0-m0', 62);
    onTrack(state, 'p2-m0', 30); // 62 squares into p2's lap, which starts at 32
    applyMove(state, 0, { kind: 'moveMarble', card: card('3'), marbleId: 'p0-m0', steps: 3 });
    expect(state.winners).toBeNull();
    expect(state.phase).toBe('playing');

    applyMove(state, 2, { kind: 'moveMarble', card: card('3'), marbleId: 'p2-m0', steps: 3 });
    expect(state.winners).toEqual([0, 2]);
    expect(state.phase).toBe('gameEnd');
  });
});
