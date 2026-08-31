import { activePlayerIds, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, handCountPoint } from './game/boardLayout';
import { playerLabel } from './game/playerName';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  /** Whose hand stays out of this list - the actual acting seat, NOT necessarily the seat the
   * board is rotated to face. The two diverge in local hotseat: mySeat tracks
   * state.currentPlayer every turn (correctly hiding whoever is playing from their own
   * "opponents" list), while viewerSeat below stays fixed. */
  mySeat: PlayerId;
  /** Which seat's base renders at the bottom of the ring - purely for badge placement, and
   * deliberately separate from mySeat (they are equal online, but not in hotseat). */
  viewerSeat: PlayerId;
  playerNames?: string[];
  /** Briefly set to the seat a stolen card has just landed on. The stack itself pops, which is
   * what says "that card is theirs now" - without it the flight ends on a stack that silently
   * grew by one while the eye was following the card, and the arrival reads as the card
   * vanishing near them. */
  poppingSeat?: PlayerId | null;
  /** A card some seat has committed but the engine hasn't removed yet - the 2 of a steal in
   * progress, face-up on the discard pile from the moment a target is picked, a whole reveal
   * animation before the move lands. Their stack has to shrink at that same moment or it keeps
   * showing a card everyone can already see on the pile. Self-correcting: once the move
   * commits, the card is genuinely gone, the id stops matching, and this stops subtracting -
   * there is no window where it double-counts. */
  spentCard?: { seat: PlayerId; cardId: string } | null;
}

// Horizontal spacing between fanned cards, tight enough that even the largest hand (6, the
// first round's deal size) reads as one compact stack rather than a sprawl.
const CARD_OFFSET = 7;

/**
 * A small fanned stack of card-back icons over each opponent's kennel - one icon per card in
 * their hand, so the count reads as a quantity at a glance instead of a number to parse. The
 * only thing about an opponent's hand this game shows; the cards themselves stay private.
 * Always visible rather than gated on whose turn it is, and positioned by the same
 * rotation-aware geometry as everything else on the board.
 *
 * The fan is a role="img" with the count in its label, so the quantity is available without
 * counting decorative spans.
 */
export function OpponentHandCounts({ state, containerSize, mySeat, viewerSeat, playerNames, poppingSeat, spentCard }: Props) {
  if (containerSize.width === 0) return null;
  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
  );
  const opponents = activePlayerIds(state.config).filter((p) => p !== mySeat);

  return (
    <div className="opponent-hand-counts" role="group" aria-label="Opponent card counts">
      {opponents.map((p) => {
        const { x, y } = handCountPoint(state.config, p, geo);
        // The fan runs perpendicular to this seat's radial line, i.e. tangential to the ring,
        // as though the row of cards were laid flat in front of their home row rather than
        // stacked along it. For the top seat that's screen-horizontal; it rotates with seat
        // position for everyone else the same way their home row does.
        const angle = Math.atan2(y - geo.center.y, x - geo.center.x) + Math.PI / 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const spent = spentCard?.seat === p && state.hands[p].some((c) => c.id === spentCard.cardId) ? 1 : 0;
        const count = state.hands[p].length - spent;
        const label = `${playerLabel(playerNames, p)} has ${count} card${count === 1 ? '' : 's'}`;
        return (
          <div key={p} role="img" aria-label={label}>
            {Array.from({ length: count }, (_, i) => {
              const offset = (i - (count - 1) / 2) * CARD_OFFSET;
              const isTop = i === count - 1;
              return (
                <span
                  key={i}
                  className={`opponent-hand-counts__card${p === poppingSeat ? ' opponent-hand-counts__card--pop' : ''}`}
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
