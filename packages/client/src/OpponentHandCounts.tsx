import { activePlayerIds, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, handCountPoint } from './game/boardLayout';
import { playerLabel } from './game/playerName';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  /** Whose hand stays hidden from this list - the actual acting seat (mySeat from
   * GameBoard.tsx), NOT necessarily who the board is rotated to face. In local hotseat these
   * two diverge: mySeat tracks state.currentPlayer every turn (correctly hiding whoever's
   * currently playing from their own "opponents" list), while viewerSeat below stays fixed
   * (see GameBoard.tsx's own viewerSeat doc). */
  mySeat: PlayerId;
  /** Which seat's base renders at the bottom of the ring - see boardLayout.ts's
   * BoardGeometry.rotation. Purely for badge placement; deliberately separate from mySeat
   * above (they're the same value online, but not in local hotseat). */
  viewerSeat: PlayerId;
  playerNames?: string[];
}

// Horizontal spacing between each fanned card's left edge - tight enough that even the
// largest hand (6, the first round's deal size - see ROUND_DEAL_SIZES) reads as one compact
// stack, not a sprawl.
const CARD_OFFSET = 7;

/** A small fanned stack of card-back icons over each opponent's kennel cluster - one icon
 * per card in their hand, so the count reads as an actual quantity of cards at a glance
 * instead of a number that has to be parsed. The only thing about an opponent's hand this
 * game shows, since the actual cards stay private (see StealCardOverlay). Always visible,
 * not gated by whose turn it is - useful context regardless. Positioned via the same
 * rotation-aware geometry as everything else on the board (see boardLayout.ts's
 * BoardGeometry.rotation), so a stack tracks its player's kennel correctly no matter which
 * seat is the viewer. */
export function OpponentHandCounts({ state, containerSize, mySeat, viewerSeat, playerNames }: Props) {
  if (containerSize.width === 0) return null;
  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
  );
  const opponents = activePlayerIds(state.config).filter((p) => p !== mySeat);

  return (
    <div className="opponent-hand-counts" role="group" aria-label="Opponent card counts">
      {opponents.map((p) => {
        const { x, y } = handCountPoint(state.config, p, geo);
        // Fan direction runs perpendicular to this seat's radial line (center -> their
        // home-field row) - tangential to the ring, like the row of cards is laid flat in
        // front of their home row rather than stacked along it. For the top seat that's
        // screen-horizontal (radial there is vertical); rotates with seat position for
        // everyone else the same way their home row does.
        const angle = Math.atan2(y - geo.center.y, x - geo.center.x) + Math.PI / 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const count = state.hands[p].length;
        const label = `${playerLabel(playerNames, p)} has ${count} card${count === 1 ? '' : 's'}`;
        return (
          <div key={p} role="img" aria-label={label}>
            {Array.from({ length: count }, (_, i) => {
              const offset = (i - (count - 1) / 2) * CARD_OFFSET;
              const isTop = i === count - 1;
              return (
                <span
                  key={i}
                  className="opponent-hand-counts__card"
                  style={{ left: x + offset * dx, top: y + offset * dy }}
                >
                  {isTop && (
                    <span className="opponent-hand-counts__count" aria-hidden="true">{count}</span>
                  )}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
