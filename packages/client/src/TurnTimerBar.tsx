import { useEffect, useRef, useState } from 'react';

const TURN_MS = 20000;
// Announced once each, not continuously - a screen reader user needs to know time is
// running out (this can cost you your intended move to auto-play), but a running "19...
// 18... 17..." readout would drown out everything else on the page.
const ANNOUNCE_THRESHOLDS_S = [10, 5];

// Fill starts shifting toward red once half the turn's time is gone, reaching full red
// (--player-red) at the quarter-remaining mark - not just an empty-bar cue, an increasingly
// urgent color one too.
const URGENCY_START_FRACTION = 0.5;
const URGENCY_FULL_FRACTION = 0.25;
const CALM_COLOR: [number, number, number] = [255, 255, 255]; // --ink
const URGENT_COLOR: [number, number, number] = [255, 84, 112]; // --player-red

function fillColorFor(fraction: number): string {
  const urgency = Math.min(1, Math.max(0,
    (URGENCY_START_FRACTION - fraction) / (URGENCY_START_FRACTION - URGENCY_FULL_FRACTION),
  ));
  const [r, g, b] = CALM_COLOR.map((c, i) => Math.round(c + (URGENT_COLOR[i] - c) * urgency));
  return `rgb(${r}, ${g}, ${b})`;
}

interface Props {
  /** Server epoch ms when the current turn auto-plays - see GameRoom.ts's turnDeadline. This
   * bar is cosmetic only; the server is what actually enforces the timeout, so a client
   * running slightly behind/ahead just sees the bar empty a beat early/late, never a wrong
   * outcome. */
  deadline: number;
}

/** Thin countdown strip pinned to the top of the hand panel (see theme.css's .turn-timer) -
 * shrinks from full to empty as the deadline approaches, "reversed" from a normal loading
 * bar that fills up. Ticks on a fixed interval, not requestAnimationFrame - see
 * PhaserGame.ts's own comment on rAF being throttled in backgrounded/unfocused tabs, same
 * concern applies here. */
export function TurnTimerBar({ deadline }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');
  const announcedRef = useRef(new Set<number>());

  useEffect(() => {
    announcedRef.current = new Set();
    setAnnouncement('');
  }, [deadline]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, [deadline]);

  const remainingMs = Math.max(0, deadline - now);
  const fraction = Math.min(1, remainingMs / TURN_MS);
  const seconds = Math.ceil(remainingMs / 1000);

  for (const threshold of ANNOUNCE_THRESHOLDS_S) {
    if (seconds <= threshold && !announcedRef.current.has(threshold)) {
      announcedRef.current.add(threshold);
      // Deferred to avoid calling setState synchronously during render.
      queueMicrotask(() => setAnnouncement(`${threshold} seconds left this turn.`));
    }
  }

  return (
    <div className="turn-timer">
      <span className="turn-timer__seconds" aria-hidden="true">{seconds}s</span>
      <div className="turn-timer__track" aria-hidden="true">
        <div className="turn-timer__fill" style={{ width: `${fraction * 100}%`, background: fillColorFor(fraction) }} />
      </div>
      <p aria-live="polite" className="visually-hidden">{announcement}</p>
    </div>
  );
}
