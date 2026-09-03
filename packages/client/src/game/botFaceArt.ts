// Bot difficulty face sprites. Mirrors cardArt.ts's CARD_FACE_SPRITE - a plain rank/level to
// sprite-URL map, consumed directly as an <img src>.

import type { BotDifficulty } from './botAI';

export const BOT_FACE_SPRITE: Record<BotDifficulty, string> = {
  easy: '/sprites/bot-face-easy.png',
  medium: '/sprites/bot-face-medium.png',
  hard: '/sprites/bot-face-hard.png',
};
