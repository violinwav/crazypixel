import { useId } from 'react';

interface Props {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  /** Qualitative reading of the current value (e.g. "Medium") for a slider whose positions
   * mean more than the raw number - e.g. an Easy/Medium/Hard 0-2 control, unlike this
   * component's original 0-7 step-count use where the number already IS the value. Rendered as
   * visible text next to the label (a sibling, not nested inside it - nesting would fold the
   * changing value into the accessible NAME itself) and set as the input's aria-valuetext, so a
   * sighted glance and a screen reader both get the word instead of a bare position index. */
  valueLabel?: string;
}

/**
 * A real <input type="range"> - correct keyboard semantics and value announcements - with its
 * native track hidden and a row of blocky pixel notches drawn underneath in its place. The
 * input stays interactive (opacity 0, not display:none) so dragging, arrow keys and focus all
 * still work; the notches are decorative and stay in sync because both read the same `value`.
 */
export function PixelSlider({ label, min, max, value, onChange, valueLabel }: Props) {
  const id = useId();
  const notches = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className="pixel-slider">
      {valueLabel ? (
        // Only wrapped when there's a value to show beside it - keeps the existing
        // SevenSplitOverlay caller's markup (and its centered label) byte-for-byte unchanged.
        <div className="pixel-slider__label-row">
          <label htmlFor={id} className="pixel-slider__label">{label}</label>
          <span className="pixel-slider__value">{valueLabel}</span>
        </div>
      ) : (
        <label htmlFor={id} className="pixel-slider__label">{label}</label>
      )}
      <div className="pixel-slider__body">
        <input
          id={id}
          type="range"
          className="pixel-slider__input"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-valuetext={valueLabel}
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
