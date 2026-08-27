import { moveCaptureIndices, planMovement, startIndexFor, trackLengthFor } from '@crazypixel/shared';
import type { GameState, Marble, Move } from '@crazypixel/shared';
import { trackPoint, kennelSlotPoint, homeSlotPoint } from './boardLayout';
import type { BoardGeometry, Point } from './boardLayout';

export interface MoveTarget {
  move: Move;
  /** The clickable point - the destination for a walked move, so forward/backward (e.g.
   * the 4 card) land on different, separately-clickable squares instead of overlapping at
   * the marble's current position. */
  point: Point;
  /** Full trail of squares walked, in order, for a "highlight the slots walked" visual -
   * empty for moves that aren't a track walk (start, swap, force-draw). Includes the
   * home-stretch slot as the final point when the move enters home. */
  path: Point[];
  /** Parallel to `path`: does this square hold a marble the move sends home? */
  captured: boolean[];
  /** Whether the landing square itself is a capture - i.e. whether the tap target (the ring
   * at the end of the path, not a path dot) should read as a kill. */
  capturesTarget: boolean;
}

interface Resolved {
  point: Point;
  path: Point[];
  /** Track index behind each `path` point, -1 for a home-stretch slot (never capturable -
   * a home stretch is private to its owner). Kept alongside the pixel points so capture
   * squares, which the engine reports as track indices, can be matched back to them. */
  pathIndices: number[];
}

/** Reuses the engine's own planMovement (see GameEngine.ts) rather than a second,
 * simplified path re-derivation - that duplicate used to not know about home-stretch
 * entry, so a move that actually crossed into home would highlight a stale/wrong square. */
function walkPath(state: GameState, marble: Marble, steps: number, geo: BoardGeometry): Resolved | null {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return null;
  const trackLength = trackLengthFor(state.config);
  const path = plan.trackPassed.map((i) => trackPoint(i, trackLength, geo));
  const pathIndices = [...plan.trackPassed];
  if (plan.location.zone === 'home') {
    path.push(homeSlotPoint(state.config, marble.owner, plan.location.index, geo));
    pathIndices.push(-1);
  }
  return { point: path[path.length - 1], path, pathIndices };
}

/**
 * Where a legal move should be visualized on the board, so selecting a card can highlight
 * real positions instead of listing moves as sentences. Most move kinds map cleanly to one
 * board position (a marble or a kennel cluster); splitSeven's genuinely multi-marble
 * combinations don't, so those come back with no target - see resolveMoveTargets below.
 */
function resolveOne(state: GameState, move: Move, geo: BoardGeometry): Resolved | null {
  switch (move.kind) {
    case 'startMarble': {
      const startIndex = startIndexFor(state.config, state.currentPlayer);
      const point = trackPoint(startIndex, trackLengthFor(state.config), geo);
      return { point, path: [point], pathIndices: [startIndex] };
    }
    case 'moveMarble': {
      const marble = state.marbles.find((m) => m.id === move.marbleId);
      return marble ? walkPath(state, marble, move.steps, geo) : null;
    }
    case 'swapJack': {
      const target = state.marbles.find((m) => m.id === move.marbleIdB);
      if (!target || target.location.zone !== 'track') return null;
      const point = trackPoint(target.location.index, trackLengthFor(state.config), geo);
      return { point, path: [], pathIndices: [] }; // a swap isn't a track walk
    }
    // forceDraw is never resolved to a single board point - see StealCardOverlay.tsx,
    // which BoardOverlay always routes it through instead (a blind hand-position pick has
    // no board position to highlight, and enumerating one legal move per hand slot means
    // the generic fallback list would otherwise show a pile of near-duplicate buttons).
    case 'splitSeven':
      // Only the common "one marble takes all 7" case gets a single highlightable point -
      // a genuine multi-marble split has no single board position that represents it (see
      // the dedicated step-allocator UI for that case instead).
      if (move.steps.length === 1) {
        const marble = state.marbles.find((m) => m.id === move.steps[0].marbleId);
        return marble ? walkPath(state, marble, move.steps[0].steps, geo) : null;
      }
      return null;
    case 'copyLastCard':
    case 'wildAs':
      return resolveOne(state, move.innerMove, geo);
    default:
      return null;
  }
}

export interface ResolvedMoves {
  targets: MoveTarget[];
  /** Moves with no single board position to highlight (multi-marble 7-splits) - rare. */
  unresolved: Move[];
}

export function resolveMoveTargets(state: GameState, moves: Move[], geo: BoardGeometry): ResolvedMoves {
  const targets: MoveTarget[] = [];
  const unresolved: Move[] = [];
  for (const move of moves) {
    const resolved = resolveOne(state, move, geo);
    if (!resolved) {
      unresolved.push(move);
      continue;
    }
    const captureIndices = new Set(moveCaptureIndices(state, move));
    const captured = resolved.pathIndices.map((i) => i >= 0 && captureIndices.has(i));
    targets.push({
      move,
      point: resolved.point,
      path: resolved.path,
      captured,
      capturesTarget: captured[captured.length - 1] ?? false,
    });
  }
  return { targets, unresolved };
}
