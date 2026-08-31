import { hueToCss } from './game/color';

interface Props {
  /** Accessible name only - there is no visible label; see the note on the component. */
  label: string;
  value: number;
  onChange: (hue: number) => void;
}

// Stops around the full hue wheel at the same fixed saturation/lightness hueToCss uses for the
// actual pick, so the track shows what you will really get rather than a generic rainbow.
const TRACK_STOPS = Array.from({ length: 13 }, (_, i) => hueToCss(i * 30));

/**
 * A real <input type="range"> over the full 360-degree hue wheel - any color, not a pick from
 * a preset list. No visible label or swatch of its own: the marble that opens this slider
 * (MarbleColorPicker.tsx) already shows the current pick, so a second swatch would repeat it.
 */
export function ColorSlider({ label, value, onChange }: Props) {
  const gradient = `linear-gradient(to right, ${TRACK_STOPS.join(', ')})`;

  return (
    <input
      type="range"
      aria-label={label}
      className="color-slider__input"
      style={{ background: gradient }}
      min={0}
      max={359}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
