// Card sprites and the one card-size definition every renderer scales off.

import type { CardRank } from '@crazypixel/shared';

/**
 * Card art is keyed purely by rank - suit affects neither the rules (CARD_DEFS) nor the art.
 * See scripts/generate-sprites.py's make_card_face.
 */
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

/** Matches theme.css's .playing-card (width 80px, aspect-ratio 5/7). */
export const CARD_WIDTH = 80;
export const CARD_HEIGHT = 112;

// Mirrors .hand-panel's 14px horizontal padding and .hand-panel__cards' 8px gap in
// theme.css - see handCardWidthFor.
const HAND_PANEL_PADDING_X = 14 * 2;
const HAND_CARD_GAP = 8;

/**
 * The current on-screen width of a hand card, given the board container's width (the hand
 * panel is a full-width sibling of the board, so they share it).
 *
 * Mirrors .playing-card.hand-panel__card's responsive formula in theme.css exactly
 * (`calc((100% - 5*8px)/6)` capped at 80px) rather than approximating it, so anything sized
 * off this shrinks in lockstep with the real hand cards on a narrow phone instead of staying
 * board-scale. Used by every renderer that has to match a hand card's size: LaidCard.tsx,
 * DealAnimation.tsx, the rank picker, and TableScene's own Phaser draw/discard stacks.
 */
export function handCardWidthFor(containerWidth: number): number {
  const cardsWidth = Math.max(0, containerWidth - HAND_PANEL_PADDING_X);
  return Math.min(CARD_WIDTH, (cardsWidth - 5 * HAND_CARD_GAP) / 6);
}
