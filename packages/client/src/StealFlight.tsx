import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

// This whole chain BLOCKS every other player: the move isn't sent until it finishes (see
// StealCardOverlay's onDone), so unlike the victim's presentation - which plays out on their
// own screen while the game has already moved on - every millisecond here is a millisecond
// the rest of the table spends watching nothing. Budgeted at ~1.3s end to end, which is
// enough for each beat to register and little enough that it never reads as a wait.
//
// Longer than the old 380ms all the same: the card now crosses the whole board (it departs
// from the victim's own card stack, not from the picker row at the bottom of the screen -
// see StealCardOverlay's targetFanPoint), so the original duration would have read as a
// teleport.
const FLIGHT_MS = 420;
const FLIP_MS = 220;
// The beat that was missing entirely - the card used to commit the move the instant its flip
// finished, so what you'd actually taken was on screen for about a fifth of a second while it
// was still moving. It now arrives, stops dead, and flips in place. Nothing moves during the
// hold on purpose: an earlier version scaled the card up as it revealed, and that extra
// motion read as the card doing something else rather than simply showing its face where it
// had landed. Short, because the rank is already readable from partway through the flip -
// this is a pause to let it land, not the whole reveal.
const HOLD_MS = 420;
// The hand opens its gap while the card is still being held up (a 240ms width transition on
// .hand-panel__slot, owned by CSS rather than timed here), so the space is finished and
// waiting well before this leg measures it - see GameBoard's incomingSlotWidth.
const LAND_MS = 240;

export interface StealFlightPlan {
  card: Card;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number };
}

interface Props {
  plan: StealFlightPlan;
  /** Fired when the reveal starts holding - the cue for the hand to open a slot for this
   * card, so it has somewhere real to go once the hold is over. */
  onMakeRoom: () => void;
  /** Where that slot ended up, in screen coordinates. Resolved late (after the hold, not at
   * mount) because the slot doesn't exist until onMakeRoom above has been acted on and the
   * hand row has finished re-flowing around it. Returning null just skips the landing leg -
   * the card still commits, it simply vanishes where it was revealed rather than sliding
   * home. */
  resolveLanding: () => { x: number; y: number; width: number; height: number } | null;
  onDone: () => void;
}

/** A single card flying from the opponent's face-down hand position to the thief's own
 * hand, flipping to reveal its real face partway through - same flip technique as
 * DealAnimation, just for one card. The client already has the real Card object at
 * state.hands[targetPlayer][index] (this is a local hotseat game, nothing is genuinely
 * secret at the data layer) - the picker UI keeps it face-down only until the player
 * commits to a position, then revealing it here is flavor, not a data leak. The actual move
 * doesn't apply until this finishes (see StealCardOverlay.tsx), so the hand isn't already
 * holding the card while it's still visually mid-flight. */
export function StealFlight({ plan, onMakeRoom, resolveLanding, onDone }: Props) {
  const [animating, setAnimating] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Second leg: where the card goes once the hold is over - the slot the hand has opened for
  // it, as a delta from where the card is currently parked.
  const [landing, setLanding] = useState<{ dx: number; dy: number; scale: number } | null>(null);

  useEffect(() => {
    const holdAt = 20 + FLIGHT_MS + FLIP_MS;
    const startTimer = setTimeout(() => setAnimating(true), 20);
    const revealTimer = setTimeout(() => setRevealed(true), 20 + FLIGHT_MS);
    const roomTimer = setTimeout(onMakeRoom, holdAt);
    const landTimer = setTimeout(() => {
      const slot = resolveLanding();
      if (!slot) return;
      setLanding({
        // Deltas between CENTERS, not top-left corners - the scale below is applied about the
        // element's own centre (transform-origin's default), so aiming the corners would land
        // the card off by half the size difference.
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
    // One transition, on position only - the flip is the flipper's own rotateY (below) and
    // happens with the card already parked at its destination. The landing leg reuses the
    // same property with its own shorter duration and softer curve, so the card settles into
    // the hand rather than arriving at the speed it crossed the board.
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
