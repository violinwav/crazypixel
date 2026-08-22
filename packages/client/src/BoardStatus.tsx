import { getLegalMoves, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry } from './game/boardLayout';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  onPassHand: () => void;
  mySeat: PlayerId;
}

/** The "lay down hand" fallback anchors to the board's own true center - clear of both the
 * draw/discard stack (near the bottom edge, where a fixed +96px offset used to push this
 * right past the container's bottom, clipping/overlapping the turn label and hand panel
 * below it and making the button unreliable to tap) and the ring itself. The turn label
 * lives outside the board now, right above the hand panel (see TurnLabel.tsx), not stacked
 * on top of the ring here too. */
export function BoardStatus({ state, containerSize, onPassHand, mySeat }: Props) {
  const player = state.currentPlayer;
  if (containerSize.width === 0) return null;
  const geo = computeBoardGeometry(containerSize.width, containerSize.height, trackLengthFor(state.config), mySeat, state.config.playerCount);
  const { x, y } = geo.center;
  const anyLegalMove = state.hands[player].some((c) => getLegalMoves(state, player, c).length > 0);

  if (anyLegalMove) return null;
  return (
    <button
      type="button"
      className="cp-button board-status__pass"
      style={{ left: x, top: y }}
      onClick={onPassHand}
    >
      No legal moves - lay down hand
    </button>
  );
}
