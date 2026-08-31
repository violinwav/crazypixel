import { getLegalMoves, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry } from './game/boardLayout';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  onPassHand: () => void;
  viewerSeat: PlayerId;
}

/**
 * The "lay down cards" fallback, shown only when the current player has no legal move for any
 * card in hand. Anchored in the gap between the discard pile and the ring's bottom edge rather
 * than dead-center over the board, where it sat on top of track tiles and marbles and read as
 * part of the board instead of a control. Both landmarks it sits between come from the same
 * geometry system, so it tracks them through every resize and player count.
 */
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
