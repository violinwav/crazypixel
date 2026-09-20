// The screen-reader counterpart of TableScene's corner-bracket reticle. A marble guarding the
// start square it entered on constrains every seat's legal moves, and the canvas has no way to
// say so - this does.
//
// Deliberately NOT in BoardOverlay. That component is gated twice (isMyTurn in GameBoard, and
// its own `!selectedCard` early return), so anything inside it would blink out of the
// accessibility tree on every card deselect and be absent entirely on the turns where an
// opponent's guard is the thing shaping the board. It also mounts two MoveRouters at once for
// a Joker, which would announce a child of it twice.
//
// Not a live region either: this is ambient state a player reads on demand, and the arriving/
// ending event is announced through GameBoard's existing polite region instead. Returning null
// when empty is only safe *because* of that - a live region mounted on its first message never
// announces it.

import type { GameState, PlayerId } from '@crazypixel/shared';
import { guardSentence } from './game/describeGuard';

interface Props {
  state: GameState;
  mySeat: PlayerId;
  playerNames?: string[];
}

export function BoardGuards({ state, mySeat, playerNames }: Props) {
  // A guard is always on a track square by definition (startMarble is the only thing that sets
  // the flag), but filtering on it keeps guardSentence's `location.index` honest.
  const guards = state.marbles
    .filter((m) => m.startProtected && m.location.zone === 'track')
    .sort((a, b) => a.location.index - b.location.index);
  if (guards.length === 0) return null;

  // No explicit role="list": .visually-hidden doesn't set list-style, so WebKit keeps the list
  // role here (unlike the styled lists elsewhere that do need it spelled out). Text content
  // rather than aria-label on the items, and no tabIndex - ambient state must not be a tab stop.
  return (
    <ul className="visually-hidden" aria-label="Guarded start squares">
      {guards.map((m) => (
        <li key={m.id}>{guardSentence(m, mySeat, playerNames)}</li>
      ))}
    </ul>
  );
}
