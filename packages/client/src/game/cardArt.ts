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
