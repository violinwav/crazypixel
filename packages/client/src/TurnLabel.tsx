import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { hueToCss, hueToStrongTextCss, hueToTextCss } from './game/color';
import { playerLabel } from './game/playerName';

// Half of the crossfade: hold the old name out for this long, then swap and fade the new one
// in. Matches .turn-label's own opacity transition in theme.css.
const SWAP_MS = 220;

interface Props {
  player: number;
  playerNames?: string[];
  /** Seat hues, for coloring the name. */
  colors: number[];
  /** On the viewer's own turn, the hue to highlight the text in (.turn-label__text--highlight);
   * undefined otherwise. Highlighted, the text flips to dark and the name to its strong
   * variant against this hue. */
  highlightHue?: number;
}

/**
 * Whose turn it is, sitting just above the hand panel. Crossfades on a turn change instead of
 * snapping - fade the old player out, swap, fade the new one in - using the same "flip a flag
 * after a tick" technique as the card flights, since requestAnimationFrame is unreliable in a
 * backgrounded tab (see PhaserGame.ts).
 *
 * aria-hidden: GameBoard's aria-live region already announces the turn.
 */
export function TurnLabel({ player, playerNames, colors, highlightHue }: Props) {
  // The highlight is latched alongside the player, so it swaps while the label is faded out -
  // the label's own crossfade is what fades it in and out, and the outgoing name is never
  // repainted in a palette it didn't belong to.
  const [shown, setShown] = useState({ player, highlightHue });
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (player === shown.player && highlightHue === shown.highlightHue) return undefined;
    setVisible(false);
    const timer = setTimeout(() => {
      setShown({ player, highlightHue });
      setVisible(true);
    }, SWAP_MS);
    return () => clearTimeout(timer);
  }, [player, highlightHue, shown]);

  const highlighted = shown.highlightHue !== undefined;
  const style = shown.highlightHue !== undefined
    ? {
        '--turn-label-color': hueToStrongTextCss(colors[shown.player], shown.highlightHue),
        '--turn-label-highlight': hueToCss(shown.highlightHue),
      } as CSSProperties
    : { '--turn-label-color': hueToTextCss(colors[shown.player]) } as CSSProperties;

  return (
    <p className={`turn-label${visible ? ' turn-label--visible' : ''}`} aria-hidden="true">
      <span className={`turn-label__text${highlighted ? ' turn-label__text--highlight' : ''}`} style={style}>
        {/* Keyed to the shown player, not player, so the color swaps with the name mid-fade
            instead of repainting the outgoing name in the incoming player's color. */}
        <span className="turn-label__who">{playerLabel(playerNames, shown.player).toUpperCase()}</span>
        &apos;S TURN
      </span>
    </p>
  );
}
