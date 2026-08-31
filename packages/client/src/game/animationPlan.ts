// Turns a committed Move into the visual instructions TableScene needs to animate it.
// Reuses the engine's own planMovement so this can't drift from the real home-stretch entry
// rule. Everything here is computed against the PRE-move state, where marble locations are
// still the starting squares - except planCaptures, which needs both snapshots.

import { planMovement } from '@crazypixel/shared';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';

export interface CardDrawAnimation {
  targetPlayer: PlayerId;
}

export interface MarbleAnimation {
  marbleId: string;
  /**
   * 'walk': animate through trackIndices in sequence, then into home if entersHomeSlot is
   * set. 'teleport': straight tween, no path (a Jack swap isn't a track walk).
   */
  kind: 'walk' | 'teleport';
  trackIndices: number[];
  /**
   * The track square the marble departs from, or null if it wasn't on the track (a
   * home-stretch shuffle, a teleport). planMovement's trackPassed deliberately omits it -
   * the square you already stand on can't block you - but an animation has to know where the
   * walk starts, and reading it off the sprite's current position is wrong exactly when it
   * matters: a marble whose previous animation is still in flight isn't standing where it
   * logically is, which drew the trail's arc from a stale angle over squares it never walked.
   */
  fromTrackIndex: number | null;
  /** Set when the walk's final leg carries the marble into its home stretch. */
  entersHomeSlot: number | null;
}

/**
 * Everything TableScene needs for one move. Marble walks and the custom-2's forced-draw card
 * flight are unrelated visually but both derive from the same Move, so they're planned
 * together. capturedMarbleIds is filled in separately by the caller (it needs the post-move
 * state too - see planCaptures) so TableScene can hold a captured marble's trip home until
 * the capturing marble has actually arrived.
 */
export interface TurnAnimation {
  marbles: MarbleAnimation[];
  draws: CardDrawAnimation[];
  capturedMarbleIds: string[];
}

export const EMPTY_TURN_ANIMATION: TurnAnimation = { marbles: [], draws: [], capturedMarbleIds: [] };

/** The whole plan for one move, bar captures. Both game-state hooks route through this. */
export function planTurn(state: GameState, move: Move): TurnAnimation {
  return { marbles: planMarbles(state, move), draws: planCardDraws(state, move), capturedMarbleIds: [] };
}

/**
 * Which marbles this move sent to kennel, as a plain before/after diff rather than a second
 * client-side re-derivation of each capture rule (landing, the 7's pass-over, an opponent
 * caught on your start square). No move ever kennels the marble it acts on, so "was
 * elsewhere, is in kennel now" is a capture, full stop.
 */
export function planCaptures(prevState: GameState, nextState: GameState): string[] {
  const prevZoneById = new Map(prevState.marbles.map((m) => [m.id, m.location.zone]));
  return nextState.marbles
    .filter((m) => m.location.zone === 'kennel' && prevZoneById.get(m.id) !== 'kennel')
    .map((m) => m.id);
}

/** Unwraps copyLastCard/wildAs, so an 8 copying a 2 (or a Joker played as 2) still flies. */
function planCardDraws(state: GameState, move: Move): CardDrawAnimation[] {
  switch (move.kind) {
    case 'forceDraw':
      return [{ targetPlayer: move.targetPlayer }];
    case 'copyLastCard':
    case 'wildAs':
      return planCardDraws(state, move.innerMove);
    default:
      return [];
  }
}

function walkFor(state: GameState, marbleId: string, steps: number): MarbleAnimation {
  const marble = state.marbles.find((m) => m.id === marbleId);
  if (!marble) return { marbleId, kind: 'walk', trackIndices: [], fromTrackIndex: null, entersHomeSlot: null };
  const plan = planMovement(state, marble, steps);
  return {
    marbleId,
    kind: 'walk',
    trackIndices: plan.trackPassed,
    fromTrackIndex: marble.location.zone === 'track' ? marble.location.index : null,
    entersHomeSlot: plan.location.zone === 'home' ? plan.location.index : null,
  };
}

/**
 * What each affected marble should visually do. Any marble not covered here (one captured
 * mid-path, say) falls back to a plain position tween in TableScene - being sent home
 * doesn't need to "walk".
 */
function planMarbles(state: GameState, move: Move): MarbleAnimation[] {
  switch (move.kind) {
    case 'moveMarble':
      return state.marbles.some((m) => m.id === move.marbleId)
        ? [walkFor(state, move.marbleId, move.steps)]
        : [];
    case 'splitSeven':
      return move.steps.map((segment) => walkFor(state, segment.marbleId, segment.steps));
    case 'swapJack':
      return [
        { marbleId: move.marbleIdA, kind: 'teleport', trackIndices: [], fromTrackIndex: null, entersHomeSlot: null },
        { marbleId: move.marbleIdB, kind: 'teleport', trackIndices: [], fromTrackIndex: null, entersHomeSlot: null },
      ];
    // No track walk: startMarble pops in, forceDraw doesn't move a marble.
    case 'startMarble':
    case 'forceDraw':
      return [];
    case 'copyLastCard':
    case 'wildAs':
      return planMarbles(state, move.innerMove);
    default:
      return [];
  }
}
