import { activePlayerIds, KENNEL_SIZE, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, kennelSlotPoint } from './game/boardLayout';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  mySeat: PlayerId;
}

/** A small badge over each opponent's kennel cluster showing how many cards they're
 * holding - the only thing about an opponent's hand this game shows, since the actual
 * cards stay private (see StealCardOverlay). Always visible, not gated by whose turn it
 * is - useful context regardless. Positioned via the same rotation-aware geometry as
 * everything else on the board (see boardLayout.ts's BoardGeometry.rotation), so a badge
 * tracks its player's kennel correctly no matter which seat is the viewer. */
export function OpponentHandCounts({ state, containerSize, mySeat }: Props) {
  if (containerSize.width === 0) return null;
  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), mySeat, state.config.playerCount,
  );
  const opponents = activePlayerIds(state.config).filter((p) => p !== mySeat);

  return (
    <div className="opponent-hand-counts" role="group" aria-label="Opponent card counts">
      {opponents.map((p) => {
        const { x, y } = kennelSlotPoint(state.config, p, (KENNEL_SIZE - 1) / 2, geo);
        const count = state.hands[p].length;
        return (
          <span
            key={p}
            className="opponent-hand-counts__badge"
            style={{ left: x, top: y }}
            aria-label={`Player ${p + 1} has ${count} card${count === 1 ? '' : 's'}`}
          >
            {count}
          </span>
        );
      })}
    </div>
  );
}
