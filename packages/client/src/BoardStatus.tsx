import { getLegalMoves, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry } from './game/boardLayout';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  onPassHand: () => void;
  viewerSeat: PlayerId;
}

/** The "lay down cards" fallback anchors in the gap between the discard pile and the ring's
 * own bottom edge - not dead center on top of the board (the old anchor, geo.center), which
 * sat the button directly over track tiles/marbles and read as part of the board rather than
 * a real control. Both landmarks it sits between (trackRadius, stackCenter) are already part
 * of this same geometry system, so the button tracks them through every resize/player-count
 * change instead of drifting out of that gap on its own. */
export function BoardStatus({ state, containerSize, onPassHand, viewerSeat }: Props) {
  const player = state.currentPlayer;
  if (containerSize.width === 0) return null;
  const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount);
  const ringBottom = geo.center.y + geo.trackRadius;
  const x = geo.center.x;
  const y = (ringBottom + geo.stackCenter.y) / 2;
  const anyLegalMove = state.hands[player].some((c) => getLegalMoves(state, player, c).length > 0);

  if (anyLegalMove) return null;
  return (
    <button
      type="button"
      className="cp-button board-status__pass"
      style={{ left: x, top: y }}
      onClick={onPassHand}
    >
      Lay down cards
    </button>
  );
}
