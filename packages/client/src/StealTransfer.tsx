import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

// How much of the flight is spent fully opaque: the card only starts dissolving once it has
// basically arrived, so it reads as landing ON the destination stack rather than fading out
// over the board. FlyingCard deliberately does the opposite - that one IS a disappearance.
const FADE_TAIL_MS = 180;
// One tick to let the browser paint the resting position before the transform flips - same
// sequencing, and the same setTimeout-over-rAF reason, as FlyingCard.
const START_DELAY_MS = 20;

export interface StealTransferPlan {
  /** null flies a face-down back instead of a real face - what everyone who is neither the
   * card's owner nor the thief sees. The rank stays genuinely secret there, unlike
   * StealFlight's mid-air reveal, which only ever runs on the client that took the card. */
  card: Card | null;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number };
  /** '#rrggbb' of the player the card is flying TO, carried as a ring on the card itself, so
   * "where is it going" is answered during the flight and not only on arrival. */
  color: string;
  durationMs: number;
  /** Scale the card shrinks to on arrival, picked per caller so it lands at roughly the size of
   * the fanned backs in the destination stack - a full-size hand card and a 44px onlooker's
   * card need different ratios to end up there. */
  endScale: number;
}

interface Props {
  plan: StealTransferPlan;
  onDone: () => void;
}

/**
 * One card crossing the board from the hand it was taken from to the thief's own stack,
 * shrinking as it goes so it arrives at roughly the size of the cards in that stack. Separate
 * from FlyingCard (hand to discard) and StealFlight (the thief's own reveal) because the three
 * answer different questions and want different endings - this one says "your card is now
 * THEIRS", so it has to end somewhere real rather than dissolving mid-air.
 */
export function StealTransfer({ plan, onDone }: Props) {
  const [animating, setAnimating] = useState(false);
  const { card, from, to, color, durationMs, endScale } = plan;

  useEffect(() => {
    const startTimer = setTimeout(() => setAnimating(true), START_DELAY_MS);
    const doneTimer = setTimeout(onDone, durationMs + START_DELAY_MS * 2);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(doneTimer);
    };
  }, [onDone, durationMs]);

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
    transition: `transform ${durationMs}ms var(--ease-out-quart), opacity ${FADE_TAIL_MS}ms ease ${durationMs - FADE_TAIL_MS}ms`,
    transform: animating ? `translate(${dx}px, ${dy}px) scale(${endScale})` : 'translate(0, 0) scale(1)',
    opacity: animating ? 0 : 1,
    '--card-face': `url(${card ? CARD_FACE_SPRITE[card.rank] : CARD_BACK_SPRITE})`,
    '--steal-transfer-ring': color,
  } as CSSProperties;

  return (
    <div className="playing-card steal-transfer" style={style} aria-hidden="true">
      {card && <CardRankIndices rank={card.rank} />}
    </div>
  );
}
