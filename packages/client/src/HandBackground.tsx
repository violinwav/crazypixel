import { PixelDither } from './PixelDither';

interface Props {
  /** Whether the viewer is the player whose turn it is - always true for local hotseat
   * (mySeat is always state.currentPlayer there), only sometimes true online. */
  active: boolean;
  /** "r, g, b" for the current player, see game/theme.ts's hexToRgbString. */
  color: string;
}

/** Sits behind the hand cards (see .hand-panel-slot's position:relative) - the current
 * player's own pixel-dither, tinted in their color, while it's actually their turn to act;
 * plain black otherwise. Replaces the page's global white dither (which otherwise shows
 * straight through - .hand-panel itself has no fill) specifically for this area, so whose
 * turn it is reads at a glance even before looking at the board. */
export function HandBackground({ active, color }: Props) {
  if (!active) return <div className="hand-panel__background hand-panel__background--black" aria-hidden="true" />;
  return <PixelDither className="hand-panel__background" color={color} />;
}
