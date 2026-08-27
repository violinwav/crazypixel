import { useEffect, useId, useRef, useState } from 'react';
import { ColorSlider } from './ColorSlider';
import { PlayerMarble } from './PlayerMarble';

interface Props {
  /** Accessible name for both the toggle button and the slider it reveals - e.g. "Your
   * color" or "Player 2 color". Not rendered as visible text; the marble itself is the
   * visible affordance, matching how every other marble in this app already reads as "a
   * color, click/see for more" without a redundant label next to it. */
  label: string;
  hue: number;
  onChange: (hue: number) => void;
  size?: string;
  /** Which edge of the marble the popup panel hangs off of - 'start' (default) opens
   * rightward from the marble's left edge, for a marble that sits at the left of its row
   * (PlayerIdentity's profile strip). 'end' opens leftward from the marble's right edge
   * instead, for a marble sitting at the right of its row (PlayerSetupPicker's per-seat
   * rows, `justify-content: space-between`) - 'start' there let the panel run off the right
   * edge of a narrow phone viewport. Not computed from a runtime measurement since each
   * caller already knows which side of its own row the marble sits on. */
  align?: 'start' | 'end';
}

/** A marble that doubles as a disclosure toggle - click it to reveal the hue slider beneath,
 * click again (or Escape, or click outside) to collapse it. One shared control for every
 * place a player's own color gets set (PlayerIdentity's profile strip, each seat in
 * PlayerSetupPicker's singleplayer setup) - previously each of those had its own always-
 * visible slider-plus-swatch-plus-label row; the marble is already the preview, so this
 * collapses all three into the one thing that actually needs to stay on screen. */
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
