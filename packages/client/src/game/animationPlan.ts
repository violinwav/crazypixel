import { planMovement } from '@crazypixel/shared';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';

export interface CardDrawAnimation {
  targetPlayer: PlayerId;
}

/** Everything TableScene needs to animate a single move, computed once against the
 * pre-move state and threaded through the ref-based side-channel (see useGameState.ts)
 * into the Phaser bridge - marble walks and the custom-2's forced-draw card flight are
 * unrelated visually but both derive from the same Move, so they're planned together.
 * capturedMarbleIds is filled in separately by useGameState (it needs the *post*-move
 * state too, to see who ended up in kennel - see planCaptures below) so TableScene can
 * delay a captured marble's trip home until the capturing marble's own walk has actually
 * arrived, instead of both animating at once. */
export interface TurnAnimation {
  marbles: MarbleAnimation[];
  draws: CardDrawAnimation[];
  capturedMarbleIds: string[];
}

export const EMPTY_TURN_ANIMATION: TurnAnimation = { marbles: [], draws: [], capturedMarbleIds: [] };

export function planTurn(state: GameState, move: Move): TurnAnimation {
  return { marbles: planAnimation(state, move), draws: planCardDraws(state, move), capturedMarbleIds: [] };
}

/** Which marbles this move sent to kennel - a plain before/after diff rather than
 * re-deriving each move kind's own capture rule (landing capture, 7's pass-over capture,
 * an opponent caught on your own start square) a second time on the client. No move ever
 * kennels the marble it's actually acting on, so "was somewhere else, is in kennel now" is
 * captured, full stop. */
export function planCaptures(prevState: GameState, nextState: GameState): string[] {
  const prevZoneById = new Map(prevState.marbles.map((m) => [m.id, m.location.zone]));
  return nextState.marbles
    .filter((m) => m.location.zone === 'kennel' && prevZoneById.get(m.id) !== 'kennel')
    .map((m) => m.id);
}

/** Unwraps copyLastCard/wildAs the same way planAnimation does, so an 8 copying a 2's
 * force-draw (or a Joker played as 2) still gets the card-flight animation. */
export function planCardDraws(state: GameState, move: Move): CardDrawAnimation[] {
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

export interface MarbleAnimation {
  marbleId: string;
  /** 'walk': animate through trackIndices in sequence (then into home, if entersHomeSlot is
   * set). 'teleport': straight tween, no path (a swap doesn't correspond to a track walk). */
  kind: 'walk' | 'teleport';
  trackIndices: number[];
  /** The track square the marble departs from, or null if it wasn't on the track (a
   * home-stretch shuffle, a teleport). planMovement's trackPassed deliberately omits it -
   * it exists for blockade/pass-over checks, where the square you're already standing on
   * can't block you - but an animation has to know where the walk *starts*, and reading it
   * off the sprite's current screen position instead is wrong exactly when it matters: a
   * marble whose previous animation is still in flight isn't standing where it logically
   * is (that drew the trail's border arc from a stale mid-flight angle, sweeping back over
   * squares the marble never walked). */
  fromTrackIndex: number | null;
  /** Set when the walk's final leg carries the marble into its home stretch - TableScene
   * appends one more step to this slot's screen position after the track portion. */
  entersHomeSlot: number | null;
}

/**
 * What each affected marble should visually do for a move, computed against the PRE-move
 * state (so marble.location.index below is still the starting square). Any marble not
 * covered here (e.g. one captured mid-path) just falls back to a plain position tween in
 * TableScene - being sent home doesn't need to "walk", a snap-tween there reads fine.
 * Reuses the engine's own planMovement (see GameEngine.ts) so this can't drift out of sync
 * with the actual home-stretch-entry rule.
 */
export function planAnimation(state: GameState, move: Move): MarbleAnimation[] {
  switch (move.kind) {
    case 'moveMarble': {
      const marble = state.marbles.find((m) => m.id === move.marbleId);
      if (!marble) return [];
      const plan = planMovement(state, marble, move.steps);
      return [{
        marbleId: move.marbleId,
        kind: 'walk',
        trackIndices: plan.trackPassed,
        fromTrackIndex: marble.location.zone === 'track' ? marble.location.index : null,
        entersHomeSlot: plan.location.zone === 'home' ? plan.location.index : null,
      }];
    }
    case 'splitSeven':
      return move.steps.map((segment) => {
        const marble = state.marbles.find((m) => m.id === segment.marbleId);
        if (!marble) return { marbleId: segment.marbleId, kind: 'walk' as const, trackIndices: [], fromTrackIndex: null, entersHomeSlot: null };
        const plan = planMovement(state, marble, segment.steps);
        return {
          marbleId: segment.marbleId,
          kind: 'walk' as const,
          trackIndices: plan.trackPassed,
          fromTrackIndex: marble.location.zone === 'track' ? marble.location.index : null,
          entersHomeSlot: plan.location.zone === 'home' ? plan.location.index : null,
        };
      });
    case 'swapJack':
      return [
        { marbleId: move.marbleIdA, kind: 'teleport', trackIndices: [], fromTrackIndex: null, entersHomeSlot: null },
        { marbleId: move.marbleIdB, kind: 'teleport', trackIndices: [], fromTrackIndex: null, entersHomeSlot: null },
      ];
    case 'startMarble':
    case 'forceDraw':
      return []; // no track walk - startMarble pops in, forceDraw doesn't move a marble
    case 'copyLastCard':
    case 'wildAs':
      return planAnimation(state, move.innerMove);
    default:
      return [];
  }
}
