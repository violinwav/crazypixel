import type { CardRank } from '@crazypixel/shared';

/** Card art is keyed purely by rank - suit never affected CARD_DEFS (GameEngine.ts) and
 * doesn't affect the art either now. See scripts/generate-sprites.py's make_card_face. */
export const CARD_FACE_SPRITE: Record<CardRank, string> = {
  A: '/sprites/card-face-A.png',
  '2': '/sprites/card-face-2.png',
  '3': '/sprites/card-face-3.png',
  '4': '/sprites/card-face-4.png',
  '5': '/sprites/card-face-5.png',
  '6': '/sprites/card-face-6.png',
  '7': '/sprites/card-face-7.png',
  '8': '/sprites/card-face-8.png',
  '9': '/sprites/card-face-9.png',
  '10': '/sprites/card-face-10.png',
  J: '/sprites/card-face-J.png',
  Q: '/sprites/card-face-Q.png',
  K: '/sprites/card-face-K.png',
  JOKER: '/sprites/card-face-JOKER.png',
};

export const CARD_BACK_SPRITE = '/sprites/card-back.png';

/** Matches theme.css's own .playing-card (width 80px, aspect-ratio 5/7) - the one card size
 * definition every renderer (Phaser's own card-back pile, DOM cards) scales off, so nothing
 * hand-tunes its own competing size. */
export const CARD_WIDTH = 80;
export const CARD_HEIGHT = 112;

// Mirrors .hand-panel's own 14px horizontal padding (theme.css) and .hand-panel__cards' 8px
// gap exactly - see handCardWidthFor below.
const HAND_PANEL_PADDING_X = 14 * 2;
const HAND_CARD_GAP = 8;

/** The real, current on-screen width of a hand card, given the board container's width (see
 * GameBoard.tsx's containerSize - the hand panel is a full-width sibling of the board, so it
 * shares the same width). Mirrors .playing-card.hand-panel__card's own responsive formula in
 * theme.css exactly (`calc((100% - 5*8px)/6)` capped at 80px) instead of an approximation, so
 * a card sized off this shrinks in lockstep with the real hand cards on a narrow phone
 * viewport rather than staying board-scale (trackRadius-relative) while the hand shrinks out
 * from under it - confirmed live as the actual bug this exists to fix: the draw/discard pile
 * and the hand cards visibly disagreeing on size below ~400px wide. Used by every renderer
 * that needs to look "the same physical card size as a hand card" - LaidCard.tsx (DOM) and
 * TableScene.ts's own drawDeckStack/drawDiscardStack (Phaser canvas) - instead of each
 * deriving its own scale. */
export function handCardWidthFor(containerWidth: number): number {
  const cardsWidth = Math.max(0, containerWidth - HAND_PANEL_PADDING_X);
  return Math.min(CARD_WIDTH, (cardsWidth - 5 * HAND_CARD_GAP) / 6);
}
