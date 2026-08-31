import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

// This whole chain BLOCKS every other player: the move isn't sent until it finishes (see
// StealCardOverlay's onDone), so unlike the victim's presentation - which plays out on their
// own screen while the game has already moved on - every millisecond here is one the rest of
// the table spends watching nothing. Budgeted at ~1.3s end to end: enough for each beat to
// register, little enough that it never reads as a wait.
const FLIGHT_MS = 420;
const FLIP_MS = 220;
// The card arrives, stops dead, and flips in place. Nothing moves during the hold on purpose -
// an earlier version scaled the card up as it revealed, and that extra motion read as the card
// doing something else rather than simply showing its face where it had landed. Short, since
// the rank is readable from partway through the flip; this is a pause to let it land, not the
// whole reveal.
const HOLD_MS = 420;
// The hand opens its gap while the card is still held up (a 240ms width transition owned by
// CSS), so the space is finished and waiting well before this leg measures it.
const LAND_MS = 240;
// One tick to let the browser paint the resting position before the transform flips - same
// sequencing, and the same setTimeout-over-rAF reason, as FlyingCard.
const START_DELAY_MS = 20;

export interface StealFlightPlan {
  card: Card;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number };
}

interface Props {
  plan: StealFlightPlan;
  /** Fired when the reveal starts holding - the cue for the hand to open a slot for this card,
   * so it has somewhere real to go once the hold is over. */
  onMakeRoom: () => void;
  /** Where that slot ended up, in screen coordinates. Resolved late (after the hold, not at
   * mount) because the slot doesn't exist until onMakeRoom has been acted on and the hand has
   * finished re-flowing around it. Returning null just skips the landing leg - the card still
   * commits, it simply vanishes where it was revealed rather than sliding home. */
  resolveLanding: () => { x: number; y: number; width: number; height: number } | null;
  onDone: () => void;
}

/**
 * The thief's own reveal: a single card flying from the opponent's face-down hand position to
 * this player's hand, flipping to its real face partway through, then landing in the slot the
 * hand opened for it.
 *
 * The client already has the real Card at state.hands[target][index] - nothing is secret at the
 * data layer - so the picker keeps it face-down only until a position is committed to, and
 * revealing it here is flavor rather than a leak. The move itself doesn't apply until this
 * finishes, so the hand isn't already holding the card while it is visually mid-flight.
 */
export function StealFlight({ plan, onMakeRoom, resolveLanding, onDone }: Props) {
  const [animating, setAnimating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Second leg: where the card goes once the hold is over - the slot the hand opened for it, as
  // a delta from where the card is currently parked.
  const [landing, setLanding] = useState<{ dx: number; dy: number; scale: number } | null>(null);

  useEffect(() => {
    const holdAt = START_DELAY_MS + FLIGHT_MS + FLIP_MS;
    const startTimer = setTimeout(() => setAnimating(true), START_DELAY_MS);
    const revealTimer = setTimeout(() => setRevealed(true), START_DELAY_MS + FLIGHT_MS);
    const roomTimer = setTimeout(onMakeRoom, holdAt);
    const landTimer = setTimeout(() => {
      const slot = resolveLanding();
      if (!slot) return;
      setLanding({
        // Deltas between CENTERS, not top-left corners: the scale below is applied about the
        // element's own center, so aiming the corners would land the card off by half the size
        // difference.
        dx: slot.x + slot.width / 2 - (plan.from.x + plan.from.width / 2),
        dy: slot.y + slot.height / 2 - (plan.from.y + plan.from.height / 2),
        scale: slot.width / plan.from.width,
      });
    }, holdAt + HOLD_MS);
    const doneTimer = setTimeout(onDone, holdAt + HOLD_MS + LAND_MS);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(revealTimer);
      clearTimeout(roomTimer);
      clearTimeout(landTimer);
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDone]);

  const dx = plan.to.x - (plan.from.x + plan.from.width / 2);
  const dy = plan.to.y - (plan.from.y + plan.from.height / 2);

  const style: CSSProperties = {
    position: 'fixed',
    left: plan.from.x,
    top: plan.from.y,
    width: plan.from.width,
    height: plan.from.height,
    zIndex: 1000,
    pointerEvents: 'none',
    perspective: 500,
    // One transition, on position only - the flip is the flipper's own rotateY and happens with
    // the card already parked at its destination. The landing leg reuses the same property with
    // its own shorter duration and softer curve, so the card settles into the hand rather than
    // arriving at the speed it crossed the board.
    transition: landing
      ? `transform ${LAND_MS}ms var(--ease-out-quart)`
      : `transform ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
    transform: landing
      ? `translate(${landing.dx}px, ${landing.dy}px) scale(${landing.scale})`
      : animating ? `translate(${dx}px, ${dy}px)` : 'translate(0, 0)',
  } as CSSProperties;

  return (
    <div className="deal-animation__card steal-flight" style={style} aria-hidden="true">
      <div className={`deal-animation__flipper${revealed ? ' deal-animation__flipper--revealed' : ''}`}>
        <div className="deal-animation__face deal-animation__face--back" style={{ backgroundImage: `url(${CARD_BACK_SPRITE})` }} />
        <div className="deal-animation__face deal-animation__face--front" style={{ backgroundImage: `url(${CARD_FACE_SPRITE[plan.card.rank]})` }}>
          <CardRankIndices rank={plan.card.rank} />
        </div>
      </div>
    </div>
  );
}
