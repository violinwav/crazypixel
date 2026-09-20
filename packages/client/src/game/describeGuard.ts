// One wording for the base-guard rule, shared by the three places that have to say it: the
// figure button that would spend the guard, the always-present board-state list, and the
// live-region line announcing a guard arriving or ending.
//
// All three denials are named on purpose. isBlockaded stops passage for *everyone*, the owner
// included; the guard itself can't be captured; and getLegalMoves excludes it from swapJack.
// A partial statement of the rule is worse than none - it invites exactly the "why is that
// move missing" confusion the marker exists to prevent.

import type { Marble, PlayerId } from '@crazypixel/shared';
import { playerLabel } from './playerName';

/** Appended to the acting-marble button's accessible name - moving it is what ends the guard. */
export const GUARD_FIGURE_SUFFIX = ', guarding your start square - moving it ends that';

/**
 * Appended to the *committing* button's name. The figure suffix above is not enough on its
 * own: BoardOverlay auto-selects a lone eligible figure and skips straight to its targets, so
 * for the common case - one base marble, one card, one move - the figure button never renders
 * and the destination button is the only thing the player ever presses.
 */
export const GUARD_MOVE_SUFFIX = ', ending your start-square guard';

export function guardSentence(marble: Marble, mySeat: PlayerId, playerNames?: string[]): string {
  const square = marble.location.index;
  if (marble.owner === mySeat) {
    return `Your marble on square ${square} is guarding your start square. Nothing can pass, capture or swap it until you move it.`;
  }
  return `${playerLabel(playerNames, marble.owner)}'s marble on square ${square} is guarding their start square. Nothing can pass, capture or swap it until they move it.`;
}
