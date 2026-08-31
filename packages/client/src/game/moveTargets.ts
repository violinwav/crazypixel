// Phase two of move selection: where a chosen piece can GO. figureTargets.ts is phase one
// (which piece acts). Reuses the engine's own planMovement rather than a simplified
// re-derivation, which used to not know about home-stretch entry and highlighted the wrong
// square for a move that crossed into home.

import { moveCaptureIndices, planMovement, startIndexFor, trackLengthFor } from '@crazypixel/shared';
import type { GameState, Marble, Move } from '@crazypixel/shared';
import { homeSlotPoint, trackPoint } from './boardLayout';
import type { BoardGeometry, Point } from './boardLayout';

export interface MoveTarget {
  move: Move;
  /**
   * The clickable point - a walked move's destination, so forward and backward (the 4 card)
   * land on separately-clickable squares instead of overlapping at the marble's position.
   */
  point: Point;
  /**
   * Every square walked, in order, for the "highlight the path" visual. Empty for moves that
   * aren't a track walk (start, swap, force-draw). Includes the home-stretch slot as the
   * final point when the move enters home.
   */
  path: Point[];
  /** Parallel to `path`: does this square hold a marble the move sends home? */
  captured: boolean[];
  /** Whether the landing square itself is a capture, i.e. should the tap target read red. */
  capturesTarget: boolean;
}

interface Resolved {
  point: Point;
  path: Point[];
  /**
   * The track index behind each `path` point, -1 for a home-stretch slot (never capturable).
   * Kept alongside the pixel points so capture squares, which the engine reports as track
   * indices, can be matched back to them.
   */
  pathIndices: number[];
}

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
 * Where one legal move should be visualized. Most move kinds map cleanly to a single board
 * position; the ones that don't come back null and surface as text buttons instead - see
 * resolveMoveTargets' `unresolved`.
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
    case 'splitSeven':
      // Only "one marble takes all 7" has a single highlightable point; a genuine
      // multi-marble split goes to SevenSplitOverlay's step allocator instead.
      if (move.steps.length === 1) {
        const marble = state.marbles.find((m) => m.id === move.steps[0].marbleId);
        return marble ? walkPath(state, marble, move.steps[0].steps, geo) : null;
      }
      return null;
    case 'copyLastCard':
    case 'wildAs':
      return resolveOne(state, move.innerMove, geo);
    // forceDraw never resolves to a board point - BoardOverlay routes it through
    // StealCardOverlay, since a blind hand-position pick has no board position and one legal
    // move per hand slot would otherwise render a pile of near-duplicate buttons.
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
