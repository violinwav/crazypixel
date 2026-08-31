import { useEffect, useState } from 'react';
import { playerLabel } from './game/playerName';

// Half of the crossfade: hold the old name out for this long, then swap and fade the new one
// in. Matches .turn-label's own opacity transition in theme.css.
const SWAP_MS = 220;

interface Props {
  player: number;
  playerNames?: string[];
}

/**
 * Whose turn it is, sitting just above the hand panel. Crossfades on a turn change instead of
 * snapping - fade the old player out, swap, fade the new one in - using the same "flip a flag
 * after a tick" technique as the card flights, since requestAnimationFrame is unreliable in a
 * backgrounded tab (see PhaserGame.ts).
 *
 * aria-hidden: GameBoard's aria-live region already announces the turn.
 */
export function TurnLabel({ player, playerNames }: Props) {
  const [displayPlayer, setDisplayPlayer] = useState(player);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (player === displayPlayer) return undefined;
    setVisible(false);
    const timer = setTimeout(() => {
      setDisplayPlayer(player);
      setVisible(true);
    }, SWAP_MS);
    return () => clearTimeout(timer);
  }, [player, displayPlayer]);

  return (
    <p className={`turn-label${visible ? ' turn-label--visible' : ''}`} aria-hidden="true">
      {playerLabel(playerNames, displayPlayer).toUpperCase()}&apos;S TURN
    </p>
  );
}
