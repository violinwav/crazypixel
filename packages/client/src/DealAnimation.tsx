import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

const FLIGHT_MS = 320;
const FLIP_MS = 260;
const STAGGER_MS = 100;

// .hand-panel's own horizontal padding (see theme.css) - subtracted before dividing into 6
// card-plus-gap slots, so this lands on the exact same width .hand-panel__card computes via
// calc((100% - 5*8px)/6), not an approximation of it. Getting this wrong is exactly what
// caused a visible resize snap the instant the deal animation handed off to the real hand.
const HAND_PANEL_PADDING_X = 14 * 2;
const CARD_GAP = 8;

/** Mirrors .playing-card.hand-panel__card's own responsive width formula in theme.css
 * exactly, using the real measured hand-panel width (plan.to.width, from GameView's
 * getBoundingClientRect - the deck has no actual hand-card DOM element to measure yet, this
 * one doesn't exist until the deal completes) rather than approximating it from the
 * viewport. */
function computeCardSize(containerWidth: number) {
  const cardsWidth = Math.max(0, containerWidth - HAND_PANEL_PADDING_X);
  const width = Math.min(80, (cardsWidth - 5 * CARD_GAP) / 6);
  return { width, height: width * 1.4 };
}

export interface DealPlan {
  /** The actual dealt hand, in order - each flying card reveals its own real face partway
   * through its flight (see FLIP_MS below), not just a back that vanishes into a hand that
   * was always there. */
  cards: Card[];
  from: { x: number; y: number };
  /** Hand panel's bounding box - cards fan out across its width so they land roughly where
   * the real hand is about to appear, not just in one pile. */
  to: { x: number; y: number; width: number };
}

interface Props {
  plan: DealPlan;
  onDone: () => void;
}

type CardStage = 'atDeck' | 'flying' | 'revealed';

// Card backs fly from the draw pile to roughly where each hand slot will sit, one at a time,
// flipping to their real face partway through the flight - the "real" deal that already
// happened in state is instant, this is purely the table catching up visually to a moment
// that actually matters (a fresh round), not replayed every time a turn merely switches to a
// player who was already dealt to earlier this round (see GameView.tsx's round-index guard).
// Same "mount at rest, flip a flag after a tick, let CSS transition the rest" technique as
// FlyingCard.tsx - requestAnimationFrame is unreliable in this environment, setTimeout isn't
// - just staggered per card instead of firing once.
export function DealAnimation({ plan, onDone }: Props) {
  const [stages, setStages] = useState<CardStage[]>(() => Array(plan.cards.length).fill('atDeck'));

  useEffect(() => {
    const setStage = (i: number, stage: CardStage) =>
      setStages((prev) => prev.map((v, j) => (j === i ? stage : v)));
    const timers = plan.cards.flatMap((_, i) => {
      const flyAt = i * STAGGER_MS + 20;
      const revealAt = flyAt + FLIGHT_MS;
      return [
        setTimeout(() => setStage(i, 'flying'), flyAt),
        setTimeout(() => setStage(i, 'revealed'), revealAt),
      ];
    });
    const doneTimer = setTimeout(
      onDone,
      Math.max(0, plan.cards.length - 1) * STAGGER_MS + FLIGHT_MS + FLIP_MS + 80,
    );
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(doneTimer);
    };
    // Runs once for this plan's lifetime - a fresh DealAnimation instance is mounted per
    // deal (see GameView.tsx), not reused, so re-running on prop change would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (plan.cards.length === 0) return null;
  const { width: cardW, height: cardH } = computeCardSize(plan.to.width);
  // Matches .hand-panel__cards' own layout exactly (fixed-width slots, justify-content:
  // center) instead of dividing the full panel width evenly by however many cards are in
  // this hand - that spread short hands (e.g. 2 cards) out near the panel's edges, then
  // snapped them inward the instant the real (centered, tightly-packed) hand took over,
  // a visible jump right as the deal animation handed off (confirmed live).
  const rowWidth = plan.cards.length * cardW + Math.max(0, plan.cards.length - 1) * CARD_GAP;
  const rowLeft = plan.to.x + (plan.to.width - HAND_PANEL_PADDING_X - rowWidth) / 2 + HAND_PANEL_PADDING_X / 2;

  return (
    <>
      {stages.map((stage, i) => {
        const card = plan.cards[i];
        const destX = rowLeft + i * (cardW + CARD_GAP);
        const destY = plan.to.y - cardH / 2;
        const originX = plan.from.x - cardW / 2;
        const originY = plan.from.y - cardH / 2;
        const style: CSSProperties = {
          position: 'fixed',
          left: originX,
          top: originY,
          width: cardW,
          height: cardH,
          zIndex: 900,
          pointerEvents: 'none',
          perspective: 500,
          transition: `transform ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          transform: stage === 'atDeck' ? 'translate(0, 0)' : `translate(${destX - originX}px, ${destY - originY}px)`,
        };
        return (
          <div key={card.id} className="deal-animation__card" style={style} aria-hidden="true">
            <div className={`deal-animation__flipper${stage === 'revealed' ? ' deal-animation__flipper--revealed' : ''}`}>
              <div
                className="deal-animation__face deal-animation__face--back"
                style={{ backgroundImage: `url(${CARD_BACK_SPRITE})` }}
              />
              <div
                className="deal-animation__face deal-animation__face--front"
                style={{ backgroundImage: `url(${CARD_FACE_SPRITE[card.rank]})` }}
              >
                <CardRankIndices rank={card.rank} />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
