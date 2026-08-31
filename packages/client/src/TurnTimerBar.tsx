import { useEffect, useRef, useState } from 'react';

const TURN_MS = 20000;
// Ticked on a fixed interval, not requestAnimationFrame - rAF is throttled in backgrounded and
// unfocused tabs (see PhaserGame.ts), which is exactly when an opponent's turn plays out.
const TICK_MS = 200;
// Announced once each, not continuously: a running "19... 18... 17..." readout would drown out
// everything else on the page. The stakes are only real on the viewer's OWN turn, where running
// out auto-plays a move for them - GameBoard mounts this bar on every seat's turn, so on a
// six-player table most of these announcements are informational rather than actionable.
const ANNOUNCE_THRESHOLDS_S = [10, 5];

// The fill shifts toward red once half the turn is gone, reaching full red at the
// quarter-remaining mark - an increasingly urgent color cue, not just an emptying bar.
const URGENCY_START_FRACTION = 0.5;
const URGENCY_FULL_FRACTION = 0.25;
// A fourth copy of the palette, beyond the three CLAUDE.md lists (theme.css, game/theme.ts,
// generate-sprites.py) - needed as component channels because the fill is interpolated in JS,
// and CSS custom properties can't be read as numbers here.
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
  /** Server epoch ms when the current turn auto-plays. This bar is cosmetic - the server is
   * what enforces the timeout, so a client running slightly fast or slow just sees the bar
   * empty a beat early or late, never a wrong outcome. */
  deadline: number;
}

/**
 * A thin countdown strip pinned above the hand panel, shrinking from full to empty as the
 * deadline approaches - reversed from a normal loading bar. Online only; local hotseat has no
 * server to enforce a timeout and shows no timer at all.
 */
export function TurnTimerBar({ deadline }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');
  const announcedRef = useRef(new Set<number>());

  useEffect(() => {
    announcedRef.current = new Set();
    setAnnouncement('');
  }, [deadline]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
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
