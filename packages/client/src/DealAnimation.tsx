import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Card } from '@crazypixel/shared';
import { CARD_BACK_SPRITE, CARD_FACE_SPRITE, CARD_HEIGHT, CARD_WIDTH, handCardWidthFor } from './game/cardArt';
import { CardRankIndices } from './CardRankIndices';

const FLIGHT_MS = 320;
const FLIP_MS = 260;
const STAGGER_MS = 100;
// One tick to let the browser paint each card at rest before its transform flips - same
// sequencing, and the same setTimeout-over-rAF reason, as FlyingCard.
const START_DELAY_MS = 20;
// A little slack after the last flip before the real hand takes over.
const HANDOFF_MS = 80;
// .hand-panel's own horizontal padding and .hand-panel__cards' gap (theme.css).
// handCardWidthFor already factors the padding into the card width, but the row-centering
// math below also needs it directly to know where the padded content box starts.
const HAND_PANEL_PADDING_X = 14 * 2;
const CARD_GAP = 8;

/**
 * The card size the real hand is about to render at, from the measured hand-panel width. The
 * deck has no hand-card DOM element to read yet - one doesn't exist until the deal completes -
 * so this goes through the shared handCardWidthFor rather than approximating off the viewport.
 */
function computeCardSize(containerWidth: number) {
  const width = handCardWidthFor(containerWidth);
  return { width, height: width * (CARD_HEIGHT / CARD_WIDTH) };
}

export interface DealPlan {
  /** The actual dealt hand, in order - each flying card reveals its own real face partway
   * through its flight, rather than a back vanishing into a hand that was always there. */
  cards: Card[];
  from: { x: number; y: number };
  /** The hand panel's bounding box. Cards fan across its width so they land roughly where the
   * real hand is about to appear, not in one pile. */
  to: { x: number; y: number; width: number };
}

interface Props {
  plan: DealPlan;
  onDone: () => void;
}

type CardStage = 'atDeck' | 'flying' | 'revealed';

/**
 * Card backs flying from the draw pile to roughly where each hand slot will sit, flipping to
 * their real face partway through. The "real" deal already happened in state; this is the table
 * catching up visually to a moment that matters (a fresh round), and it is not replayed when a
 * turn merely switches to a player already dealt to this round - see GameBoard's round guard.
 *
 * aria-hidden throughout: the hand itself is the accessible surface, and this is a transient
 * decoration over it.
 */
export function DealAnimation({ plan, onDone }: Props) {
  const [stages, setStages] = useState<CardStage[]>(() => Array(plan.cards.length).fill('atDeck'));

  useEffect(() => {
    const setStage = (i: number, stage: CardStage) =>
      setStages((prev) => prev.map((v, j) => (j === i ? stage : v)));
    const timers = plan.cards.flatMap((_, i) => {
      const flyAt = i * STAGGER_MS + START_DELAY_MS;
      const revealAt = flyAt + FLIGHT_MS;
      return [
        setTimeout(() => setStage(i, 'flying'), flyAt),
        setTimeout(() => setStage(i, 'revealed'), revealAt),
      ];
    });
    const doneTimer = setTimeout(
      onDone,
      Math.max(0, plan.cards.length - 1) * STAGGER_MS + FLIGHT_MS + FLIP_MS + HANDOFF_MS,
    );
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(doneTimer);
    };
    // Runs once for this plan's lifetime - a fresh instance is mounted per deal, never reused,
    // so re-running on a prop change would double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (plan.cards.length === 0) return null;
  const { width: cardW, height: cardH } = computeCardSize(plan.to.width);
  // Matches .hand-panel__cards' own layout exactly - fixed-width slots, centered - rather than
  // dividing the panel width evenly by however many cards are in this hand. The latter spread a
  // short hand out toward the panel's edges, then snapped it inward the instant the real,
  // tightly-packed hand took over: a visible jump right at the handoff.
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
