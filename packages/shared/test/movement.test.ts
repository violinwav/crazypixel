import { describe, expect, it } from 'vitest';
import { applyMove, getLegalMoves, planMovement } from '../src';
import { board, card, inHome, marble, ofKind, onTrack } from './helpers';

// 4 players: 64-square track, seat p starts at p * 16.

describe('planMovement', () => {
  it('walks forward and wraps past the end of the track', () => {
    const state = board();
    const m = onTrack(state, 'p1-m0', 60);
    const plan = planMovement(state, m, 5);
    expect(plan.location).toEqual({ zone: 'track', index: 1 });
    expect(plan.trackPassed).toEqual([61, 62, 63, 0, 1]);
  });

  it('turns into home once the path would carry it past its own start square', () => {
    const state = board();
    const m = onTrack(state, 'p0-m0', 62);
    const plan = planMovement(state, m, 4);
    expect(plan.location).toEqual({ zone: 'home', index: 1 });
    expect(plan.trackPassed).toEqual([63, 0]);
  });

  it('treats landing exactly on its own start square as an ordinary track square', () => {
    const state = board();
    const m = onTrack(state, 'p0-m0', 60);
    expect(planMovement(state, m, 4).location).toEqual({ zone: 'track', index: 0 });
  });

  // Regression (33d21f4): a card too big to fit the goal used to leave the marble stuck at its
  // entrance with no legal move, forcing a hand pass even though it could just keep walking.
  it('walks on past its entrance when the card overshoots the goal', () => {
    const state = board();
    const m = onTrack(state, 'p0-m0', 62);
    const plan = planMovement(state, m, 13);
    expect(plan.legal).toBe(true);
    expect(plan.location).toEqual({ zone: 'track', index: 11 });
    expect(ofKind(getLegalMoves(state, 0, card('K')), 'moveMarble')).toContainEqual(
      expect.objectContaining({ marbleId: 'p0-m0', steps: 13 }),
    );
  });

  it('never enters home going backward, even when the walk crosses its own start square', () => {
    const state = board();
    const m = onTrack(state, 'p0-m0', 2);
    const plan = planMovement(state, m, -4);
    expect(plan.location).toEqual({ zone: 'track', index: 62 });
    expect(plan.trackPassed).toEqual([1, 0, 63, 62]);
  });

  it('moves within the home stretch but never out past its end', () => {
    const state = board();
    const m = inHome(state, 'p0-m0', 1);
    expect(planMovement(state, m, 2)).toMatchObject({ location: { zone: 'home', index: 3 }, legal: true });
    expect(planMovement(state, m, 3).legal).toBe(false);
    expect(planMovement(state, m, -4).legal).toBe(false);
  });
});

describe('hasLapped: the right to turn in from your own start square', () => {
  // Regression (33d21f4): position alone can't tell "just placed here" from "came all the way
  // round", so a fresh marble must not be able to step straight into home.
  it('is not granted to a marble freshly started onto the square', () => {
    const state = board();
    const ace = card('A');
    state.hands[0] = [ace];
    applyMove(state, 0, { kind: 'startMarble', card: ace, marbleId: 'p0-m0' });
    const m = marble(state, 'p0-m0');
    expect(m.hasLapped).toBe(false);
    expect(planMovement(state, m, 1).location).toEqual({ zone: 'track', index: 1 });
  });

  it('is earned by completing a lap onto the square, and lets a small card turn in next move', () => {
    const state = board();
    const four = card('4');
    onTrack(state, 'p0-m0', 60);
    applyMove(state, 0, { kind: 'moveMarble', card: four, marbleId: 'p0-m0', steps: 4 });
    const m = marble(state, 'p0-m0');
    expect(m.location).toEqual({ zone: 'track', index: 0 });
    expect(m.hasLapped).toBe(true);
    expect(planMovement(state, m, 1).location).toEqual({ zone: 'home', index: 0 });
  });

  // House rule: backing onto your own start square with a 4 earns entry without a full lap.
  it('is earned by a backward 4 landing exactly on the square', () => {
    const state = board();
    onTrack(state, 'p0-m0', 4);
    expect(ofKind(getLegalMoves(state, 0, card('4')), 'moveMarble')).toContainEqual(
      expect.objectContaining({ marbleId: 'p0-m0', steps: -4 }),
    );
    applyMove(state, 0, { kind: 'moveMarble', card: card('4'), marbleId: 'p0-m0', steps: -4 });
    const m = marble(state, 'p0-m0');
    expect(m.location).toEqual({ zone: 'track', index: 0 });
    expect(m.hasLapped).toBe(true);
    expect(planMovement(state, m, 3).location).toEqual({ zone: 'home', index: 2 });
  });

  it('is lost when the marble is captured', () => {
    const state = board();
    onTrack(state, 'p0-m0', 0, { hasLapped: true });
    onTrack(state, 'p1-m0', 60);
    applyMove(state, 1, { kind: 'moveMarble', card: card('4'), marbleId: 'p1-m0', steps: 4 });
    const captured = marble(state, 'p0-m0');
    expect(captured.location.zone).toBe('kennel');
    expect(captured.hasLapped).toBe(false);
  });
});

describe('home stretch', () => {
  it('cannot be hopped over by a marble entering from the track', () => {
    const state = board();
    inHome(state, 'p0-m0', 1);
    onTrack(state, 'p0-m1', 62);
    const legalFor = (rank: '3' | '4' | '5') => ofKind(getLegalMoves(state, 0, card(rank)), 'moveMarble')
      .some((m) => m.marbleId === 'p0-m1' && m.steps > 0);
    expect(legalFor('3')).toBe(true); // lands in slot 0, behind the blocker
    expect(legalFor('4')).toBe(false); // slot 1 is taken
    expect(legalFor('5')).toBe(false); // slot 2 means jumping slot 1
  });

  it('cannot be hopped over by a marble already inside it', () => {
    const state = board();
    inHome(state, 'p0-m0', 0);
    inHome(state, 'p0-m1', 2);
    const moves = ofKind(getLegalMoves(state, 0, card('3')), 'moveMarble');
    expect(moves.some((m) => m.marbleId === 'p0-m0')).toBe(false);
  });
});

describe('landing capture (every card but the 7)', () => {
  it('sends home only the marble landed on, not ones walked past', () => {
    const state = board();
    onTrack(state, 'p0-m0', 20);
    onTrack(state, 'p1-m0', 22);
    onTrack(state, 'p2-m0', 25);
    applyMove(state, 0, { kind: 'moveMarble', card: card('5'), marbleId: 'p0-m0', steps: 5 });
    expect(marble(state, 'p1-m0').location).toEqual({ zone: 'track', index: 22 });
    expect(marble(state, 'p2-m0').location.zone).toBe('kennel');
  });

  it('never lets a marble land on another of its own', () => {
    const state = board();
    onTrack(state, 'p0-m0', 20);
    onTrack(state, 'p0-m1', 25);
    const moves = ofKind(getLegalMoves(state, 0, card('5')), 'moveMarble');
    expect(moves.some((m) => m.marbleId === 'p0-m0')).toBe(false);
  });
});
