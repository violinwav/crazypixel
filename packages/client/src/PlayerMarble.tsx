import { hueToCss } from './game/color';

interface Props {
  hue: number;
  /** CSS length - defaults to the size the identity strip uses. Seat lists pass a smaller
   * value so the marble reads as a label bullet, not the visual focus of the row. */
  size?: string;
  className?: string;
}

/** A DOM approximation of the Phaser marble sprite (scripts/generate-sprites.py's
 * make_marble - chamfered square, dark border, lighter inset facet catching the light from
 * the top-left) - reused everywhere a marble color needs a preview outside the actual board
 * (identity strip, waiting-room seat list) so those swatches read as "the same marble," not
 * a generic colored dot. Purely decorative (the hue is always labeled in text beside it). */
export function PlayerMarble({ hue, size = '28px', className }: Props) {
  const color = hueToCss(hue);
  return (
    <span
      aria-hidden="true"
      className={`player-marble${className ? ` ${className}` : ''}`}
      style={{ '--marble-size': size, '--marble-color': color } as React.CSSProperties}
    >
      <span className="player-marble__facet" />
    </span>
  );
}
