import { useEffect, useId, useRef, useState } from 'react';
import { EMOTES, trackLengthFor } from '@crazypixel/shared';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { computeBoardGeometry, drawPileCenter } from './game/boardLayout';
import { handCardWidthFor } from './game/cardArt';

interface Props {
  state: GameState;
  containerSize: { width: number; height: number };
  viewerSeat: PlayerId;
  onEmote: (emoteId: string) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}

// Mirrors GameRoom's EMOTE_COOLDOWN_MS. Duplicated rather than shared because the two enforce
// different things: the server's is the real limit, this one only greys the buttons so the
// limit is visible before you hit it. A client running a stale copy just means its own UI is
// optimistic - the server still drops the send.
const COOLDOWN_MS = 1200;
// Gap between the draw pile's right edge and the toggle.
const PILE_GAP = 12;
// The panel's own width, and how close it may come to the container's right edge once clamped.
const PANEL_WIDTH = 300;
const EDGE_MARGIN = 8;
// Must match .emote-picker__toggle's width/height in theme.css. The button is centred on the
// left/top it is given, so half of it has to be added to any edge-to-edge gap, or the gap is
// measured to its middle and the other half laps back over whatever it was meant to clear.
const TOGGLE_SIZE = 44;

/**
 * One toggle pinned beside the card stacks, and a panel of the fixed emote catalogue that
 * opens upward from it.
 *
 * Deliberately NOT gated on whose turn it is - reacting to the move that just wrecked you is
 * the entire point, and it is the one control here that stays live while you wait. That is also
 * why it is a sibling of BoardOverlay rather than living inside it: the overlay unmounts
 * wholesale on other players' turns.
 *
 * Non-modal by design: it never takes focus on open (the panel follows the toggle in DOM order,
 * so Tab lands on the first emote). Sending closes it and moves focus back to the toggle in the
 * same breath. It used to stay open so focus couldn't fall to <body>, but a panel left open
 * covers a 300x250 block of the board - including where the rank picker, the steal overlay and
 * the "lay down cards" button appear - so the turn right after a message read as unplayable.
 * Explicitly restoring focus solves the keyboard half without leaving the board covered.
 */
export function EmotePicker({ state, containerSize, viewerSeat, onEmote, muted, onMutedChange }: Props) {
  const [open, setOpen] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!coolingDown) return undefined;
    const timer = setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Only pull focus back if it was actually inside the picker. Escape is a global listener,
      // so a player pressing it while focused on a board move button would otherwise have focus
      // yanked across the screen to a control they never touched.
      if (rootRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (containerSize.width === 0) return null;

  const geo = computeBoardGeometry(
    containerSize.width, containerSize.height, trackLengthFor(state.config), viewerSeat, state.config.playerCount,
  );
  const pile = drawPileCenter(geo);
  const cardWidth = handCardWidthFor(containerSize.width);
  // Anchored to the RIGHT of the stacks, mirroring the feed on the left. The gap between the two
  // piles closes to about 13px on a 375px phone (they sit a trackRadius-relative stackOffset
  // apart and both shrink together), so there is no version of "between the piles" that fits a
  // 44px touch target.
  const toggleLeft = pile.x + cardWidth / 2 + PILE_GAP + TOGGLE_SIZE / 2;
  // Clamped so the panel can't overflow the right edge on a phone, where the toggle sits well
  // inside the viewport but a panel centred on it would not.
  const panelLeft = Math.max(
    EDGE_MARGIN,
    Math.min(toggleLeft - PANEL_WIDTH / 2, containerSize.width - PANEL_WIDTH - EDGE_MARGIN),
  );

  const send = (emoteId: string) => {
    // aria-disabled doesn't block activation the way the native attribute does, so the cooldown
    // has to be enforced here too, not just painted on the buttons.
    if (coolingDown) return;
    setCoolingDown(true);
    onEmote(emoteId);
    setOpen(false);
    // Before the panel unmounts, or focus lands on a removed node and falls to <body>.
    toggleRef.current?.focus();
  };

  return (
    <div className="emote-picker" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="cp-button emote-picker__toggle"
        style={{ left: toggleLeft, top: pile.y }}
        // A static label. Flipping it to "Close emotes" while open would double up with
        // aria-expanded and announce as "Close emotes, expanded, button".
        aria-label="Emotes"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="emote-glyph" aria-hidden="true">•‿•</span>
      </button>

      {/* Removed from the DOM when closed rather than hidden with opacity - ten permanently
          invisible tab stops parked in the middle of the board is worse than no picker. */}
      {open && (
        <div
          id={panelId}
          className="cp-panel emote-picker__panel"
          style={{ left: panelLeft, width: PANEL_WIDTH, bottom: containerSize.height - pile.y + cardWidth / 2 + PILE_GAP }}
        >
          <ul className="emote-picker__grid" aria-label="Emotes" aria-describedby={hintId}>
            {EMOTES.map((emote) => (
              <li key={emote.id}>
                <button
                  type="button"
                  className="cp-button emote-picker__option"
                  // The name carries the label and the glyph is hidden from the tree entirely.
                  // Without that second half, browse-mode character navigation still walks the
                  // raw kaomoji, and the CJK inside two of them flips a screen reader into
                  // Japanese mid-word.
                  aria-label={emote.label}
                  aria-disabled={coolingDown || undefined}
                  onClick={() => send(emote.id)}
                >
                  <span className="emote-glyph" aria-hidden="true">{emote.text}</span>
                </button>
              </li>
            ))}
          </ul>
          {/* The cooldown is described once, on the list, rather than narrated on every button
              every time it flips - it toggles roughly every second, which would bury the turn
              narration. Note aria-describedby does NOT inherit to descendants, so this is
              announced when the LIST is reached, not when an individual emote button is
              focused; browse mode reads it, focus mode may not. */}
          <span id={hintId} className="visually-hidden">One emote every 1.2 seconds.</span>
          <button
            type="button"
            className="cp-button cp-button--ghost emote-picker__mute"
            aria-pressed={muted}
            onClick={() => onMutedChange(!muted)}
          >
            {muted ? 'Emotes hidden' : 'Hide emotes'}
          </button>
        </div>
      )}
    </div>
  );
}
