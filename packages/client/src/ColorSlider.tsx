import { hueToCss } from './game/color';

interface Props {
  label: string;
  value: number;
  onChange: (hue: number) => void;
}

// Pastel stops around the full hue wheel, at the same fixed saturation/lightness hueToCss
// uses for the actual pick - the track has to show what you'll actually get, not a generic
// rainbow, or dragging to a spot wouldn't land on the color it visually promised.
const TRACK_STOPS = Array.from({ length: 13 }, (_, i) => hueToCss(i * 30));

/** A real <input type="range"> over the full 360-degree hue wheel, at a fixed pastel
 * saturation/lightness - any color on the wheel, not a pick from a preset list. The track
 * itself is painted as that same pastel spectrum so dragging reads as sliding through real
 * colors. No visible label or swatch of its own (`label` is the accessible name only) - the
 * marble preview that opens this slider (MarbleColorPicker.tsx) already shows the current
 * pick, so a second swatch here would just repeat it. */
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
