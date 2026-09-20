// Spoken/written descriptions of a Move. Used for the accessible name of every board target
// button and for the text fallback when a move has no board position to highlight.

import { planMovement } from '@crazypixel/shared';
import type { GameState, Marble, Move } from '@crazypixel/shared';
import { GUARD_MOVE_SUFFIX } from './describeGuard';

/** Does this move take a marble off the start square it is still guarding? */
function spendsGuard(state: GameState, marbleIds: string[]): boolean {
  return marbleIds.some((id) => state.marbles.find((m) => m.id === id)?.startProtected);
}

function marbleLabel(state: GameState, marbleId: string): string {
  const marble = state.marbles.find((m) => m.id === marbleId);
  if (!marble) return 'a marble';
  return marble.location.zone === 'kennel' ? 'your kenneled marble' : `marble on square ${marble.location.index}`;
}

function describeDestination(state: GameState, marble: Marble, steps: number): string {
  const plan = planMovement(state, marble, steps);
  if (!plan.legal) return '';
  return plan.location.zone === 'home' ? ' into your home stretch' : ` to square ${plan.location.index}`;
}

export function describeMove(move: Move, state: GameState): string {
  switch (move.kind) {
    case 'startMarble':
      return 'Bring a marble to your start';
    case 'moveMarble': {
      const marble = state.marbles.find((m) => m.id === move.marbleId);
      const destText = marble ? describeDestination(state, marble, move.steps) : '';
      const guardText = spendsGuard(state, [move.marbleId]) ? GUARD_MOVE_SUFFIX : '';
      return `Move ${marbleLabel(state, move.marbleId)} ${move.steps > 0 ? 'forward' : 'backward'} ${Math.abs(move.steps)}${destText}${guardText}`;
    }
    case 'splitSeven': {
      const guardText = spendsGuard(state, move.steps.map((s) => s.marbleId)) ? GUARD_MOVE_SUFFIX : '';
      return `Split 7: ${move.steps.map((s) => `${marbleLabel(state, s.marbleId)} +${s.steps}`).join(', ')}${guardText}`;
    }
    case 'swapJack': {
      const a = state.marbles.find((m) => m.id === move.marbleIdA);
      const b = state.marbles.find((m) => m.id === move.marbleIdB);
      return `Swap your marble (square ${a?.location.index}) with Player ${(b?.owner ?? 0) + 1}'s marble (square ${b?.location.index})`;
    }
    case 'forceDraw':
      return `Draw Player ${move.targetPlayer + 1}'s card, position ${move.targetCardIndex + 1}`;
    case 'copyLastCard':
      return `Copy last card: ${describeMove(move.innerMove, state)}`;
    case 'wildAs':
      return `Play as ${move.asRank}: ${describeMove(move.innerMove, state)}`;
    default:
      return 'Play card';
  }
}
