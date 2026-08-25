import { useId } from 'react';
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
 * colors; the swatch is the only readout of the current pick (no color name - at continuous
 * precision "Red" vs "Blue" stops being a meaningful label long before you're between them). */
export function ColorSlider({ label, value, onChange }: Props) {
  const id = useId();
  const gradient = `linear-gradient(to right, ${TRACK_STOPS.join(', ')})`;

  return (
    <div className="color-slider">
      <div className="color-slider__row">
        <label htmlFor={id} className="color-slider__label">{label}</label>
        <span className="color-slider__swatch" style={{ backgroundColor: hueToCss(value) }} aria-hidden="true" />
      </div>
      <input
        id={id}
        type="range"
        className="color-slider__input"
        style={{ background: gradient }}
        min={0}
        max={359}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
