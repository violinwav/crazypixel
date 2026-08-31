// Phase one of move selection: which PIECE acts. moveTargets.ts is phase two (where it
// goes). A forceDraw's "figure" is the opponent whose hand it reaches into rather than a
// marble, which lets the 2's "move or steal" choice surface as one more option in the same
// list instead of a separate hidden branch.

import { KENNEL_SIZE, trackLengthFor } from '@crazypixel/shared';
import type { GameState, Move } from '@crazypixel/shared';
import { handCountPoint, homeSlotPoint, kennelSlotPoint, trackPoint } from './boardLayout';
import type { BoardGeometry, Point } from './boardLayout';

export interface Figure {
  key: string;
  point: Point;
  label: string;
  moves: Move[];
}

interface FigureInfo {
  key: string;
  point: Point;
  label: string;
}

export interface GroupedFigures {
  figures: Figure[];
  /**
   * Moves with no single figure to highlight. None currently exist; kept as a safety net so
   * a future move kind that can't be grouped surfaces as text rather than vanishing.
   */
  unresolved: Move[];
}

function innermost(move: Move): Move {
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return innermost(move.innerMove);
  return move;
}

function marbleFigure(state: GameState, marbleId: string, geo: BoardGeometry): FigureInfo | null {
  const marble = state.marbles.find((m) => m.id === marbleId);
  if (!marble || marble.location.zone === 'kennel') return null;
  const point = marble.location.zone === 'track'
    ? trackPoint(marble.location.index, trackLengthFor(state.config), geo)
    : homeSlotPoint(state.config, marble.owner, marble.location.index, geo);
  const label = marble.location.zone === 'track'
    ? `Marble on square ${marble.location.index}`
    : `Marble in your home stretch, slot ${marble.location.index + 1}`;
  return { key: `marble:${marble.id}`, point, label };
}

function figureFor(state: GameState, move: Move, geo: BoardGeometry): FigureInfo | null {
  const inner = innermost(move);
  const config = state.config;
  switch (inner.kind) {
    case 'startMarble': {
      // Anchored on the actual marble that would start, not a centroid floating in the gap
      // between all four - the tap lands on the marble, not on empty base space.
      const marble = state.marbles.find((m) => m.id === inner.marbleId);
      const slot = marble?.location.zone === 'kennel' ? marble.location.index : (KENNEL_SIZE - 1) / 2;
      const point = kennelSlotPoint(config, state.currentPlayer, slot, geo);
      return { key: 'start', point, label: 'Bring a marble from your base' };
    }
    case 'moveMarble':
      return marbleFigure(state, inner.marbleId, geo);
    case 'swapJack': {
      const marble = state.marbles.find((m) => m.id === inner.marbleIdA);
      if (!marble || marble.location.zone !== 'track') return null;
      const point = trackPoint(marble.location.index, trackLengthFor(config), geo);
      return { key: `marble:${marble.id}`, point, label: `Marble on square ${marble.location.index}` };
    }
    case 'splitSeven':
      // Multi-marble splits have no single acting piece - SevenSplitOverlay handles those.
      return inner.steps.length === 1 ? marbleFigure(state, inner.steps[0].marbleId, geo) : null;
    case 'forceDraw': {
      // The steal reaches into their *hand*, so the ring belongs on the fanned card icons
      // that represent it (OpponentHandCounts, anchored at handCountPoint), not on their
      // kennel cluster, whose marbles the move never touches.
      const point = handCountPoint(config, inner.targetPlayer, geo);
      return { key: `opponent:${inner.targetPlayer}`, point, label: `Player ${inner.targetPlayer + 1}'s hand - draw a card` };
    }
    default:
      return null;
  }
}

/** Buckets legal moves by the piece that would act, one entry per distinct board figure. */
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
