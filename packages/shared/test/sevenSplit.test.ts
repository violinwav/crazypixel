import { describe, expect, it } from 'vitest';
import {
  applyMove, captureIndicesFor, getLegalMoves, moveCaptureIndices, outcomeOfSevenSplit,
  rankSevenSplitsForAutofill, sevenSplitSegmentCaptures, type GameState, type Move,
} from '../src';
import { board, card, inHome, marble, onTrack, sameSplit, splitsOf, type Segments } from './helpers';

function splits(state: GameState): Segments[] {
  return splitsOf(getLegalMoves(state, 0, card('7')));
}

describe('7 split legality is sequential', () => {
  // The case generateSevenSplits' order search exists for: a fresh marble guards the start
  // square, so the marble behind can only get home once the guard has stepped off.
  it('allows moving a guard out of the way first, then finishing another marble past it', () => {
    const state = board();
    onTrack(state, 'p0-m0', 0, { startProtected: true });
    onTrack(state, 'p0-m1', 59);
    const all = splits(state);
    const guardFirst: Segments = [{ marbleId: 'p0-m0', steps: 1 }, { marbleId: 'p0-m1', steps: 6 }];
    expect(all.some((s) => sameSplit(s, guardFirst))).toBe(true);
    expect(all.some((s) => s[0].marbleId === 'p0-m1' && s[0].steps === 6)).toBe(false);

    applyMove(state, 0, { kind: 'splitSeven', card: card('7'), steps: guardFirst });
    expect(marble(state, 'p0-m0').location).toEqual({ zone: 'track', index: 1 });
    expect(marble(state, 'p0-m1').location).toEqual({ zone: 'home', index: 0 });
  });

  // Regression (ba61066): an earlier segment ran over a friendly marble and kennelled it, then
  // a later segment read the kennel slot as a track index and walked it back onto the board.
  it('never moves a marble an earlier segment already sent to the kennel', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p0-m1', 12);
    for (const split of splits(state)) {
      const runOver = split.findIndex((s) => s.marbleId === 'p0-m0' && s.steps >= 2);
      const later = split.findIndex((s) => s.marbleId === 'p0-m1');
      if (runOver !== -1 && later !== -1) expect(later).toBeLessThan(runOver);
    }
  });

  it('records the legal order for an allocation that has an illegal order too', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p0-m1', 12);
    const found = splits(state).find((s) => s.length === 2
      && s.some((x) => x.marbleId === 'p0-m0' && x.steps === 3)
      && s.some((x) => x.marbleId === 'p0-m1' && x.steps === 4));
    expect(found).toEqual([{ marbleId: 'p0-m1', steps: 4 }, { marbleId: 'p0-m0', steps: 3 }]);

    applyMove(state, 0, { kind: 'splitSeven', card: card('7'), steps: found! });
    expect(marble(state, 'p0-m0').location).toEqual({ zone: 'track', index: 13 });
    expect(marble(state, 'p0-m1').location).toEqual({ zone: 'track', index: 16 });
  });

  it('cannot hop over a marble already in the home stretch', () => {
    const state = board();
    inHome(state, 'p0-m1', 1);
    onTrack(state, 'p0-m0', 62);
    onTrack(state, 'p0-m2', 20);
    // p0-m0 needs 5 to reach home slot 2, past p0-m1 in slot 1 - only possible once p0-m1
    // has stepped up to slot 3 earlier in the same split. (6 would be slot 3; 7 overshoots.)
    const deep = splits(state).filter((s) => s.some((x) => x.marbleId === 'p0-m0' && (x.steps === 5 || x.steps === 6)));
    expect(deep).toEqual([[{ marbleId: 'p0-m1', steps: 2 }, { marbleId: 'p0-m0', steps: 5 }]]);
  });

  it('offers the partner\'s marbles in teams mode, not in ffa', () => {
    const teams = board(4, 'teams');
    onTrack(teams, 'p2-m0', 40);
    expect(splits(teams).some((s) => s.some((x) => x.marbleId === 'p2-m0'))).toBe(true);

    const ffa = board(4, 'ffa');
    onTrack(ffa, 'p2-m0', 40);
    expect(splits(ffa)).toHaveLength(0);
  });

  it('burns every marble it passes over, friend or foe', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p0-m1', 12);
    onTrack(state, 'p1-m0', 14);
    applyMove(state, 0, { kind: 'splitSeven', card: card('7'), steps: [{ marbleId: 'p0-m0', steps: 7 }] });
    expect(marble(state, 'p0-m0').location).toEqual({ zone: 'track', index: 17 });
    expect(marble(state, 'p0-m1').location.zone).toBe('kennel');
    expect(marble(state, 'p1-m0').location.zone).toBe('kennel');
  });

  // Worst case: 8 friendly marbles, none blocking another, ~3200 splits - about 0.5s on a
  // laptop today. Only catches order-of-magnitude slowdowns like swapping cloneMarbles back to
  // structuredClone (~4.4s here); un-hoisting the scratch clone is just ~2x on this board, too
  // close to separate from a slow CI runner.
  it('enumerates an 8-marble teams split in bounded time', () => {
    const state = board(4, 'teams');
    [2, 6, 10, 20].forEach((index, i) => onTrack(state, `p0-m${i}`, index));
    [34, 38, 42, 52].forEach((index, i) => onTrack(state, `p2-m${i}`, index));
    const start = performance.now();
    const result = splits(state);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('7 split capture previews', () => {
  it('walks segments in order, so a square vacated earlier captures nothing', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p0-m1', 12);
    const move: Move = { kind: 'splitSeven', card: card('7'), steps: [
      { marbleId: 'p0-m1', steps: 4 },
      { marbleId: 'p0-m0', steps: 3 },
    ] };
    // Measured against the starting board, p0-m0's segment would burn p0-m1 at 12.
    expect(captureIndicesFor(state, marble(state, 'p0-m0'), 3, 'passOver')).toEqual([12]);
    expect(sevenSplitSegmentCaptures(state, move)).toEqual([
      { marbleId: 'p0-m1', indices: [] },
      { marbleId: 'p0-m0', indices: [] },
    ]);
    expect(moveCaptureIndices(state, move)).toEqual([]);
  });

  it('sees through a Joker played as a 7', () => {
    const state = board();
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p1-m0', 12);
    const inner: Move = { kind: 'splitSeven', card: card('7'), steps: [{ marbleId: 'p0-m0', steps: 7 }] };
    const wild: Move = { kind: 'wildAs', card: card('JOKER'), asRank: '7', innerMove: inner };
    expect(sevenSplitSegmentCaptures(state, wild)).toEqual([{ marbleId: 'p0-m0', indices: [12] }]);
    expect(moveCaptureIndices(state, wild)).toEqual([12]);
  });
});

describe('7 split autofill', () => {
  // p0-m0 can only reach home by running over p0-m1 unless p0-m1 steps aside first - and
  // stepping aside costs too much to get both home. Autofill must never propose the run-over.
  function crowdedEntrance() {
    const state = board();
    onTrack(state, 'p0-m0', 60);
    onTrack(state, 'p0-m1', 62);
    return state;
  }

  it('reports a self-capture in the outcome', () => {
    const state = crowdedEntrance();
    expect(outcomeOfSevenSplit(state, 0, [{ marbleId: 'p0-m0', steps: 7 }])).toMatchObject({
      marblesHomed: 1,
      friendlyKenneled: 1,
    });
  });

  it('drops every split that kennels a friendly marble and ranks homing first', () => {
    const state = crowdedEntrance();
    const candidates = splits(state);
    const selfCapture = candidates.findIndex((s) => sameSplit(s, [{ marbleId: 'p0-m0', steps: 7 }]));
    expect(selfCapture).not.toBe(-1);

    const ranked = rankSevenSplitsForAutofill(state, 0, candidates);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.map((r) => r.index)).not.toContain(selfCapture);
    for (const { index, outcome } of ranked) {
      expect(outcome.friendlyKenneled).toBe(0);
      expect(outcomeOfSevenSplit(state, 0, candidates[index])).toEqual(outcome);
    }
    expect(ranked[0].outcome.marblesHomed).toBe(1);
  });

  it('still proposes the best safe advance when nothing can finish', () => {
    const state = board();
    onTrack(state, 'p0-m0', 20);
    const ranked = rankSevenSplitsForAutofill(state, 0, splits(state));
    expect(ranked).toHaveLength(1);
    expect(ranked[0].outcome).toEqual({ marblesHomed: 0, friendlyKenneled: 0, progress: 7, opponentsKenneled: 0 });
  });

  it('counts a teammate kennelled by the split as friendly', () => {
    const state = board(4, 'teams');
    onTrack(state, 'p0-m0', 10);
    onTrack(state, 'p2-m0', 12);
    expect(outcomeOfSevenSplit(state, 0, [{ marbleId: 'p0-m0', steps: 7 }]).friendlyKenneled).toBe(1);
  });
});
