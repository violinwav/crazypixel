// Bot move selection for singleplayer. Pure policy layer on top of the shared rules engine -
// no React/DOM, and no re-derived rules: every candidate comes straight out of getLegalMoves,
// scored using the engine's own capture-preview helper. Difficulty only tunes how the score is
// weighted, never what's legal.

import { getLegalMoves, moveCaptureIndices, partnerOf } from '@crazypixel/shared';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';

export type BotDifficulty = 'easy' | 'medium' | 'hard';
export const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

/**
 * Pierces the wildAs/copyLastCard wrappers down to a forceDraw - a steal can arrive as a bare
 * 2, an 8 copying one, or a Joker played as one. Mirrors GameRoom.ts's private forceDrawOf and
 * StealCardOverlay.tsx's private unwrapForceDraw; kept as a third client-local copy rather than
 * hoisted into packages/shared, matching how this project already tolerates the same handful of
 * lines twice elsewhere instead of forcing a shared abstraction across package boundaries.
 */
export function unwrapForceDraw(move: Move): Extract<Move, { kind: 'forceDraw' }> | null {
  if (move.kind === 'forceDraw') return move;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return unwrapForceDraw(move.innerMove);
  return null;
}

/**
 * How many OPPONENT marbles this move would send home. moveCaptureIndices itself counts a hit
 * on your own partner's marble identically to an opponent's (the engine never blocks landing on
 * or 7-splitting through a partner - only the 2's steal-target enumeration excludes them), so an
 * aggression score built on the raw count would reward a "hard" bot for blasting its own partner
 * home in teams mode. Filtered here rather than in moveCaptureIndices, which stays a neutral
 * preview also used for the client's own capture highlighting (where flagging a would-be partner
 * hit red is the correct, desired warning).
 */
function opponentCaptureCount(state: GameState, seat: PlayerId, move: Move): number {
  const partner = partnerOf(state.config, seat);
  return moveCaptureIndices(state, move).filter((index) => {
    const occupant = state.marbles.find((m) => m.location.zone === 'track' && m.location.index === index);
    return !!occupant && occupant.owner !== seat && occupant.owner !== partner;
  }).length;
}

interface Tuning {
  /** Ceiling of the random score every candidate gets regardless of merit - what makes an easy
   * bot's play look weak/erratic instead of just "a slower hard bot". */
  noise: number;
  captureWeight: number;
  stealWeight: number;
}

const TUNING: Record<BotDifficulty, Tuning> = {
  easy: { noise: 100, captureWeight: 5, stealWeight: 5 },
  medium: { noise: 30, captureWeight: 15, stealWeight: 12 },
  hard: { noise: 5, captureWeight: 30, stealWeight: 25 },
};

function scoreMove(state: GameState, seat: PlayerId, move: Move, tuning: Tuning): number {
  let score = Math.random() * tuning.noise;
  score += opponentCaptureCount(state, seat, move) * tuning.captureWeight;
  if (unwrapForceDraw(move)) score += tuning.stealWeight;
  return score;
}

/**
 * Picks one move for `seat` to play this turn, across every card in hand - every legal move for
 * every held card is one flat candidate pool, exactly like a human choosing "this move, from
 * whichever card offers it" rather than committing to a card first. Returns null when nothing in
 * hand has any legal move at all, which the caller reads as "pass".
 */
export function chooseBotMove(state: GameState, seat: PlayerId, difficulty: BotDifficulty): Move | null {
  const candidates = state.hands[seat].flatMap((card) => getLegalMoves(state, seat, card));
  if (candidates.length === 0) return null;

  const tuning = TUNING[difficulty];
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const move of candidates) {
    const score = scoreMove(state, seat, move, tuning);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
