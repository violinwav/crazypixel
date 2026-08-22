import type { CSSProperties } from 'react';

interface Props {
  /** Whether the viewer is the player whose turn it is - always true for local hotseat
   * (mySeat is always state.currentPlayer there), only sometimes true online. */
  active: boolean;
  /** "#rrggbb" for the current player, see game/theme.ts's hexToCss. */
  colorHex: string;
}

/** Sits behind the hand cards (see .hand-panel-slot's position:relative) - a chunky, marching
 * pixel-checkerboard in the current player's color while it's actually their turn to act,
 * plain black otherwise. Pure CSS (two offset repeating-gradient checkerboards, animated via
 * background-position - see theme.css's .hand-panel__background--active), not a canvas: the
 * page-wide PixelDither's soft per-pixel noise read as muddy/illegible tinted per-player
 * (confirmed live) - hard-edged blocks in one solid color read as "this is MY color"
 * unambiguously, closer to a classic console "your turn" cursor flash than an ambient
 * texture. */
export function HandBackground({ active, colorHex }: Props) {
  return (
    <div
      className={`hand-panel__background${active ? ' hand-panel__background--active' : ''}`}
      style={active ? ({ '--player-hex': colorHex } as CSSProperties) : undefined}
      aria-hidden="true"
    />
  );
}
