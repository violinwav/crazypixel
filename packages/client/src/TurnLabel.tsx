import { useEffect, useState } from 'react';

interface Props {
  player: number;
}

/** Small label sitting right above the hand panel, not anchored to the board/stack anymore
 * (that crowded the ring's own kennel markers). Crossfades on every turn change instead of
 * snapping - fade out the old player, swap, fade in the new one - same "flip a flag after a
 * tick" timing technique as FlyingCard/DealAnimation (requestAnimationFrame is unreliable in
 * this environment). */
export function TurnLabel({ player }: Props) {
  const [displayPlayer, setDisplayPlayer] = useState(player);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (player === displayPlayer) return undefined;
    setVisible(false);
    const timer = setTimeout(() => {
      setDisplayPlayer(player);
      setVisible(true);
    }, 220);
    return () => clearTimeout(timer);
  }, [player, displayPlayer]);

  return (
    <p className={`turn-label${visible ? ' turn-label--visible' : ''}`} aria-hidden="true">
      PLAYER {displayPlayer + 1}&apos;S TURN
    </p>
  );
}
