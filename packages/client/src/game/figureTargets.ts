import { KENNEL_SIZE, trackLengthFor } from '@crazypixel/shared';
import type { GameState, Move } from '@crazypixel/shared';
import { trackPoint, kennelSlotPoint, handCountPoint, homeSlotPoint } from './boardLayout';
import type { BoardGeometry, Point } from './boardLayout';

export interface Figure {
  key: string;
  point: Point;
  label: string;
  moves: Move[];
}

function innermost(move: Move): Move {
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return innermost(move.innerMove);
  return move;
}

interface FigureInfo {
  key: string;
  point: Point;
  label: string;
}

/** Where a move's *acting piece* sits, distinct from moveTargets.ts's "where does it end
 * up" - this is the figure-select phase (pick who moves), that module is the
 * move-select phase (pick where). A forceDraw's "figure" is the opponent whose hand it
 * reaches into, not a marble - lets the 2's "move OR steal" choice surface as one more
 * option in the same figure list instead of a separate hidden branch. */
function figureFor(state: GameState, move: Move, geo: BoardGeometry): FigureInfo | null {
  const inner = innermost(move);
  const config = state.config;
  switch (inner.kind) {
    case 'startMarble': {
      // Sits on the actual marble that would start (its real kennel slot), not a centroid
      // point floating in the gap between all 4 - taps the marble itself, not empty base
      // space next to it.
      const marble = state.marbles.find((m) => m.id === inner.marbleId);
      const slot = marble?.location.zone === 'kennel' ? marble.location.index : (KENNEL_SIZE - 1) / 2;
      const point = kennelSlotPoint(config, state.currentPlayer, slot, geo);
      return { key: 'start', point, label: 'Bring a marble from your base' };
    }
    case 'moveMarble': {
      const marble = state.marbles.find((m) => m.id === inner.marbleId);
      if (!marble || marble.location.zone === 'kennel') return null;
      const point = marble.location.zone === 'track'
        ? trackPoint(marble.location.index, trackLengthFor(config), geo)
        : homeSlotPoint(config, marble.owner, marble.location.index, geo);
      const label = marble.location.zone === 'track'
        ? `Marble on square ${marble.location.index}`
        : `Marble in your home stretch, slot ${marble.location.index + 1}`;
      return { key: `marble:${marble.id}`, point, label };
    }
    case 'swapJack': {
      const marble = state.marbles.find((m) => m.id === inner.marbleIdA);
      if (!marble || marble.location.zone !== 'track') return null;
      const point = trackPoint(marble.location.index, trackLengthFor(config), geo);
      return { key: `marble:${marble.id}`, point, label: `Marble on square ${marble.location.index}` };
    }
    case 'splitSeven': {
      if (inner.steps.length !== 1) return null;
      const marble = state.marbles.find((m) => m.id === inner.steps[0].marbleId);
      if (!marble || marble.location.zone === 'kennel') return null;
      const point = marble.location.zone === 'track'
        ? trackPoint(marble.location.index, trackLengthFor(config), geo)
        : homeSlotPoint(config, marble.owner, marble.location.index, geo);
      const label = marble.location.zone === 'track'
        ? `Marble on square ${marble.location.index}`
        : `Marble in your home stretch, slot ${marble.location.index + 1}`;
      return { key: `marble:${marble.id}`, point, label };
    }
    case 'forceDraw': {
      // The steal reaches into their *hand*, so the ring belongs on the fanned card icons
      // that represent it (OpponentHandCounts.tsx, anchored at handCountPoint) - it used to
      // sit on their kennel cluster, pointing at marbles the move never touches. Same geo
      // (viewer-rotated) both places, so the ring lands exactly on the cards.
      const point = handCountPoint(config, inner.targetPlayer, geo);
      return { key: `opponent:${inner.targetPlayer}`, point, label: `Player ${inner.targetPlayer + 1}'s hand - draw a card` };
    }
    default:
      return null;
  }
}

export interface GroupedFigures {
  figures: Figure[];
  /** Moves with no single figure to highlight - none currently exist, kept as a safety net
   * so a future move kind that can't be grouped still surfaces rather than vanishing. */
  unresolved: Move[];
}

export function groupMovesByFigure(state: GameState, moves: Move[], geo: BoardGeometry): GroupedFigures {
  const map = new Map<string, Figure>();
  const unresolved: Move[] = [];
  for (const move of moves) {
    const info = figureFor(state, move, geo);
    if (!info) {
      unresolved.push(move);
      continue;
    }
    let figure = map.get(info.key);
    if (!figure) {
      figure = { key: info.key, point: info.point, label: info.label, moves: [] };
      map.set(info.key, figure);
    }
    figure.moves.push(move);
  }
  return { figures: [...map.values()], unresolved };
}
