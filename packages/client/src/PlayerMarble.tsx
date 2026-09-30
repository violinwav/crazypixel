import type { CSSProperties } from 'react';
import { hueToCss } from './game/color';

interface Props {
  hue: number;
  /** CSS length. Defaults to the identity strip's size; seat lists pass something smaller so
   * the marble reads as a label bullet rather than the focus of the row. */
  size?: string;
  className?: string;
}

/**
 * A DOM copy of the board's marble (TableScene's paintMarble - a diamond cut stone: dark rim,
 * four bevels lit from the top left, a flat table and a glint). Reused everywhere a marble
 * color needs a preview off the board, so those swatches read as "the same marble" rather
 * than a generic colored dot.
 *
 * Purely decorative - the hue is always labelled in text beside it.
 */
export function PlayerMarble({ hue, size = '28px', className }: Props) {
  const color = hueToCss(hue);
  return (
    <span
      aria-hidden="true"
      className={`player-marble${className ? ` ${className}` : ''}`}
      style={{ '--marble-size': size, '--marble-color': color } as CSSProperties}
    >
      <span className="player-marble__table" />
    </span>
  );
}
