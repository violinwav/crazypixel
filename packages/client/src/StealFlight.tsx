import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

const FLIGHT_MS = 380;
const FLIP_MS = 260;

export interface StealFlightPlan {
  card: Card;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number };
}

interface Props {
  plan: StealFlightPlan;
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
export function StealFlight({ plan, onDone }: Props) {
  const [animating, setAnimating] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const startTimer = setTimeout(() => setAnimating(true), 20);
    const revealTimer = setTimeout(() => setRevealed(true), 20 + FLIGHT_MS);
    const doneTimer = setTimeout(onDone, 20 + FLIGHT_MS + FLIP_MS + 60);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(revealTimer);
      clearTimeout(doneTimer);
    };
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
    transition: `transform ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
    transform: animating ? `translate(${dx}px, ${dy}px)` : 'translate(0, 0)',
  };

  return (
    <div className="deal-animation__card" style={style} aria-hidden="true">
      <div className={`deal-animation__flipper${revealed ? ' deal-animation__flipper--revealed' : ''}`}>
        <div className="deal-animation__face deal-animation__face--back" style={{ backgroundImage: `url(${CARD_BACK_SPRITE})` }} />
        <div className="deal-animation__face deal-animation__face--front" style={{ backgroundImage: `url(${CARD_FACE_SPRITE[plan.card.rank]})` }}>
          <CardRankIndices rank={plan.card.rank} />
        </div>
      </div>
    </div>
  );
}
