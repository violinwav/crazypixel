import { useEffect, useId, useRef, useState } from 'react';
import { ColorSlider } from './ColorSlider';
import { PlayerMarble } from './PlayerMarble';

interface Props {
  /** Accessible name for both the toggle and the slider it reveals, e.g. "Your color" or
   * "Player 2 color". Not rendered as visible text: the marble itself is the affordance,
   * matching how every other marble in this app reads without a label beside it. */
  label: string;
  hue: number;
  onChange: (hue: number) => void;
  size?: string;
  /** Which edge the popup hangs off. 'start' (default) opens rightward from the marble's left
   * edge, for a marble at the left of its row (the identity strip). 'end' opens leftward, for
   * one at the right of its row (PlayerSetupPicker's space-between seats), where 'start' let
   * the panel run off the right edge of a narrow viewport. Not computed from a measurement,
   * since each caller already knows which side of its row the marble sits on. */
  align?: 'start' | 'end';
}

/**
 * A marble that doubles as a disclosure toggle: click it to reveal the hue slider beneath,
 * click again (or press Escape, or click outside) to collapse it. One shared control for every
 * place a player's color gets set - previously each had its own always-visible slider, swatch
 * and label row, and the marble is already the preview.
 */
export function MarbleColorPicker({ label, hue, onChange, size, align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={`marble-picker marble-picker--${align}`} ref={rootRef}>
      <button
        type="button"
        className="marble-picker__toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label} - change color`}
        onClick={() => setOpen((o) => !o)}
      >
        <PlayerMarble hue={hue} size={size} />
      </button>
      {open && (
        <div id={panelId} className="marble-picker__panel">
          <ColorSlider label={label} value={hue} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
