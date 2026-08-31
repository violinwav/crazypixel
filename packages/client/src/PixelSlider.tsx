import { useId } from 'react';

interface Props {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}

/**
 * A real <input type="range"> - correct keyboard semantics and value announcements - with its
 * native track hidden and a row of blocky pixel notches drawn underneath in its place. The
 * input stays interactive (opacity 0, not display:none) so dragging, arrow keys and focus all
 * still work; the notches are decorative and stay in sync because both read the same `value`.
 */
export function PixelSlider({ label, min, max, value, onChange }: Props) {
  const id = useId();
  const notches = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className="pixel-slider">
      <label htmlFor={id} className="pixel-slider__label">{label}</label>
      <div className="pixel-slider__body">
        <input
          id={id}
          type="range"
          className="pixel-slider__input"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <div className="pixel-slider__track" aria-hidden="true">
          {notches.map((n) => (
            <span key={n} className={`pixel-slider__notch${n <= value ? ' pixel-slider__notch--filled' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
