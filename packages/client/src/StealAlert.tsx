import type { CSSProperties } from 'react';

interface Props {
  /** Display text, already uppercased by the caller's own phrasing choice. */
  text: string;
  /** '#rrggbb' of the player doing the stealing - the same color the hand panel's dither is
   * burning behind this, so the two read as one signal rather than two coincidences. */
  color: string;
  /** Set once the card has actually been taken: a steadier, louder state than the pulsing
   * "they're deciding" warning that precedes it. */
  settled?: boolean;
}

/**
 * Takes the turn label's spot above the hand (the two never render together - they would sit
 * on the same line) for the two beats of a steal aimed at you: someone has singled your hand
 * out, then someone has actually taken a card.
 *
 * aria-hidden, because the spoken version goes through GameBoard's existing aria-live region
 * rather than a second live region here - a screen reader gets one narration of the turn, not
 * two competing ones.
 */
export function StealAlert({ text, color, settled }: Props) {
  return (
    <p
      className={`steal-alert${settled ? ' steal-alert--settled' : ''}`}
      style={{ '--steal-alert-color': color } as CSSProperties}
      aria-hidden="true"
    >
      {text}
    </p>
  );
}
