import { getLegalMoves } from '@crazypixel/shared';
import type { GameState } from '@crazypixel/shared';

interface Props {
  state: GameState;
  onPassHand: () => void;
}

/** The "lay down hand" fallback anchors to the board's own true center via pure CSS
 * (see .board-status__pass), not a JS-computed position from computeBoardGeometry/
 * containerSize. It used to - and containerSize is asynchronously measured (see
 * PhaserGame.ts's own comments on the container starting at 0x0 and settling over several
 * ticks), so the button's on-screen position could legitimately shift between the render a
 * tap targeted and the render that actually handled it, needing a second tap to land
 * (confirmed as the actual mechanism, not just a guess - not something a JS-computed
 * position can ever fully rule out, only pure CSS layout can). */
export function BoardStatus({ state, onPassHand }: Props) {
  const player = state.currentPlayer;
  const anyLegalMove = state.hands[player].some((c) => getLegalMoves(state, player, c).length > 0);

  if (anyLegalMove) return null;
  return (
    <button type="button" className="cp-button board-status__pass" onClick={onPassHand}>
      No legal moves - lay down hand
    </button>
  );
}
