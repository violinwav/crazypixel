// Which sound a committed Move makes. Presentation, not rules - the engine decides what is
// legal, this only decides what it sounds like - but it lives next to audio.ts rather than in a
// component so both game-state hooks and the board agree on one mapping.
//
// Ordering matters below: a Joker played as a Jack is a swap that happens to be wild, and a
// player wants to hear WHICH move happened more than they want to hear which card paid for it.
// So the wrappers resolve to their inner move's sound, with the wild/copy flavour layered on
// top rather than replacing it.

import type { Move } from '@crazypixel/shared';
import type { SoundId } from './audio';

/** The sound for the move itself, unwrapping wildAs/copyLastCard down to what actually happened. */
export function soundForMove(move: Move): SoundId {
  switch (move.kind) {
    case 'startMarble':
      return 'boardEnter';
    case 'swapJack':
      return 'swap';
    case 'forceDraw':
      return 'steal';
    case 'wildAs':
    case 'copyLastCard':
      return soundForMove(move.innerMove);
    case 'moveMarble':
    case 'splitSeven':
      return 'cardPlay';
  }
}

/**
 * The flavour cue that plays alongside, for the two cards whose whole identity is that they
 * stand in for another - null for everything else. Played a beat after the move's own sound so
 * the two read as one gesture rather than a clash.
 */
export function accentForMove(move: Move): SoundId | null {
  if (move.kind === 'wildAs') return 'joker';
  if (move.kind === 'copyLastCard') return 'copy';
  return null;
}
