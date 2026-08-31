import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

const FLIGHT_MS = 420;
// One tick to let the browser paint the resting position before the transform flips. See the
// effect below for why this is a timeout rather than requestAnimationFrame.
const START_DELAY_MS = 20;

export interface FlightPlan {
  card: Card;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number };
}

interface Props {
  plan: FlightPlan;
  onDone: () => void;
}

/**
 * A DOM clone of the played card, crossing from its hand position to the discard pile and
 * fading as it goes. The real card button disappears the instant React re-renders the hand
 * from the new state, so this clone is what carries the "leaving your hand" motion: two
 * separate elements making one continuous-looking movement, rather than a single element
 * crossing a DOM/canvas boundary that doesn't exist as one coordinate space.
 */
export function FlyingCard({ plan, onDone }: Props) {
  const [animating, setAnimating] = useState(false);
  const { card, from, to } = plan;

  useEffect(() => {
    // The browser has to paint the initial, non-animating position before the transform flips,
    // or the transition has nothing to transition from. requestAnimationFrame is the textbook
    // way to sequence that, but it's throttled in backgrounded and unfocused tabs (see
    // PhaserGame.ts); setTimeout has no such dependency.
    const startTimer = setTimeout(() => setAnimating(true), START_DELAY_MS);
    const doneTimer = setTimeout(onDone, FLIGHT_MS + START_DELAY_MS);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone]);

  const dx = to.x - (from.x + from.width / 2);
  const dy = to.y - (from.y + from.height / 2);

  const style: CSSProperties = {
    position: 'fixed',
    left: from.x,
    top: from.y,
    width: from.width,
    height: from.height,
    margin: 0,
    zIndex: 1000,
    pointerEvents: 'none',
    transition: `transform ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FLIGHT_MS}ms ease`,
    transform: animating ? `translate(${dx}px, ${dy}px) scale(0.5)` : 'translate(0, 0) scale(1)',
    opacity: animating ? 0 : 1,
    '--card-face': `url(${CARD_FACE_SPRITE[card.rank]})`,
  } as CSSProperties;

  return (
    <div className="playing-card flying-card" style={style} aria-hidden="true">
      <CardRankIndices rank={card.rank} />
    </div>
  );
}
