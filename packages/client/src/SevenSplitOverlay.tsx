// The 7's multi-marble step allocator: tap a marble on the board to pick it, then a pixel
// slider sets that marble's step count. The board shows the result of a selection too - the
// walked path so far, as squares along the route.
//
// KNOWN GAP: the `--active` modifier below is applied but theme.css defines no rule for it, so
// these dots render identically to BoardOverlay's inert path dots. The intended "pulse while
// this marble is the one being adjusted" cue does not exist.
//
// Reaching 7 total does NOT auto-submit. A confirm button appears once the allocation exactly
// matches a real legal move (already enumerated by the engine, see generateSevenSplits), so a
// slider drag that happens to land on the target count doesn't commit the turn before the
// player meant it to. The slider's own max keeps every drag inside the legal set.

import { useEffect, useRef, useState } from 'react';
import { captureIndicesFor, planMovement, trackLengthFor } from '@crazypixel/shared';
import type { GameState, Marble, Move, PlayerId } from '@crazypixel/shared';
import { homeSlotPoint, trackPoint } from './game/boardLayout';
import type { BoardGeometry, Point } from './game/boardLayout';
import { PixelSlider } from './PixelSlider';

const PATH_DOT_SIZE = 8;
const TARGET_SIZE = 44;
const SEVEN_TOTAL = 7;

type SplitSevenMove = Extract<Move, { kind: 'splitSeven' }>;

interface Props {
  state: GameState;
  /** Top-level legal moves for the selected card, already filtered to ones that are (or wrap,
   * via wildAs for a Joker played as 7) a splitSeven. */
  moves: Move[];
  geo: BoardGeometry;
  onPlay: (player: PlayerId, move: Move) => void;
}

function marblePoint(state: GameState, marble: Marble, trackLength: number, geo: BoardGeometry): Point | null {
  if (marble.location.zone === 'track') return trackPoint(marble.location.index, trackLength, geo);
  if (marble.location.zone === 'home') return homeSlotPoint(state.config, marble.owner, marble.location.index, geo);
  return null;
}

function marbleLabel(marble: Marble): string {
  return marble.location.zone === 'home'
    ? `Marble in your home stretch, slot ${marble.location.index + 1}`
    : `Marble on square ${marble.location.index}`;
}

/** Spoken counterpart of the red path dots: the red highlight is the only visual sign that an
 * allocation burns marbles on the way through, so the marble's own label has to say the same
 * thing (WCAG 1.4.1). */
function captureLabelFor(state: GameState, marble: Marble, steps: number): string {
  if (steps <= 0) return '';
  const count = captureIndicesFor(state, marble, steps, 'passOver').length;
  if (count === 0) return '';
  return count === 1 ? ', sends a marble home' : `, sends ${count} marbles home`;
}

/** Unwraps wildAs/copyLastCard down to the underlying splitSeven, so the allocator works the
 * same whether the 7 was played directly or via a Joker. The OUTER move - possibly still
 * wrapped - is what actually gets applied. */
function unwrapSplitSeven(move: Move): SplitSevenMove | null {
  if (move.kind === 'splitSeven') return move;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return unwrapSplitSeven(move.innerMove);
  return null;
}

function matchesAllocation(alloc: Record<string, number>, steps: SplitSevenMove['steps']): boolean {
  const byMarble = new Map(steps.map((s) => [s.marbleId, s.steps]));
  return Object.entries(alloc).every(([marbleId, count]) => byMarble.get(marbleId) === count);
}

/**
 * Is `alloc` still a possible prefix of this candidate - has no marble been given more steps
 * than the candidate ultimately allots it?
 *
 * Deliberately looser than an exact match: with one eligible marble the only legal candidate
 * may be "this marble takes all 7", with no candidate at all for the intermediate counts 1-6,
 * so gating each step on an exact match rejected every one before the count could reach 7 and
 * softlocked the card. Prefix viability accepts "still consistent with reaching this candidate",
 * and the exact match is only required once the total hits 7 - so this can't produce a final
 * allocation that isn't a real legal move.
 */
function isViablePrefix(alloc: Record<string, number>, steps: SplitSevenMove['steps']): boolean {
  const byMarble = new Map(steps.map((s) => [s.marbleId, s.steps]));
  return Object.entries(alloc).every(([marbleId, count]) => (byMarble.get(marbleId) ?? 0) >= count);
}

export function SevenSplitOverlay({ state, moves, geo, onPlay }: Props) {
  const [allocation, setAllocation] = useState<Record<string, number>>({});
  const [activeMarbleId, setActiveMarbleId] = useState<string | null>(null);
  const player = state.currentPlayer;
  const total = Object.values(allocation).reduce((sum, n) => sum + n, 0);
  const trackLength = trackLengthFor(state.config);

  const candidates = moves
    .map((top) => ({ top, inner: unwrapSplitSeven(top) }))
    .filter((c): c is { top: Move; inner: SplitSevenMove } => c.inner !== null);

  const eligibleIds = [...new Set(candidates.flatMap((c) => c.inner.steps.map((s) => s.marbleId)))];

  /** The highest step count `marbleId` can take without making every remaining candidate
   * unreachable - the slider's max, so dragging can never propose an illegal allocation. */
  const maxViableFor = (marbleId: string): number => {
    const others = { ...allocation };
    delete others[marbleId];
    const othersTotal = Object.values(others).reduce((sum, n) => sum + n, 0);
    const remaining = SEVEN_TOTAL - othersTotal;
    for (let v = remaining; v >= 0; v--) {
      if (candidates.some((c) => isViablePrefix({ ...others, [marbleId]: v }, c.inner.steps))) return v;
    }
    return 0;
  };

  const handleSlide = (marbleId: string, v: number) => {
    const others = { ...allocation };
    delete others[marbleId];
    const next = { ...others, [marbleId]: v };
    if (!candidates.some((c) => isViablePrefix(next, c.inner.steps))) return;
    setAllocation(v === 0 ? others : next);
  };

  // Only set once the allocation exactly matches a real legal move, which is what lets the
  // confirm button gate on it rather than submitting the instant a drag hits 7.
  const readyMatch = total === SEVEN_TOTAL ? candidates.find((c) => matchesAllocation(allocation, c.inner.steps)) : undefined;

  // A single eligible marble is no split to choose - there is exactly one legal combination
  // (it takes all 7), so the allocator UI has nothing left for the player to decide. Same
  // auto-play-the-only-option pattern as BoardOverlay's start case, and it needs the same
  // StrictMode guard: React 18 dev-mode double-invokes an effect with no cleanup, and onPlay is
  // a real side effect, so without the ref that double-invoke would play two turns' moves.
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (eligibleIds.length === 1 && candidates.length === 1 && !autoPlayedRef.current) {
      autoPlayedRef.current = true;
      onPlay(player, candidates[0].top);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleIds.length, candidates.length]);

  if (eligibleIds.length === 1 && candidates.length === 1) return null;

  return (
    <>
      {eligibleIds.flatMap((marbleId) => {
        const marble = state.marbles.find((m) => m.id === marbleId);
        if (!marble) return [];
        const steps = allocation[marbleId] ?? 0;
        if (steps === 0) return [];

        const plan = planMovement(state, marble, steps);
        const pathDots: Point[] = plan.trackPassed.map((i) => trackPoint(i, trackLength, geo));
        // Which of those squares the 7 would burn. Computed against the real state per marble,
        // not against the board as the other segments would leave it - the same simplification
        // the path preview already makes, so the dots and their red highlight always describe
        // the same hypothetical move.
        const captured = new Set(captureIndicesFor(state, marble, steps, 'passOver'));
        const dotCaptures = plan.trackPassed.map((i) => captured.has(i));
        if (plan.location.zone === 'home') {
          pathDots.push(homeSlotPoint(state.config, marble.owner, plan.location.index, geo));
          dotCaptures.push(false);
        }

        return pathDots.map((p, i) => (
          <div
            key={`${marbleId}-${i}`}
            className={`board-overlay__path-dot board-overlay__path-dot--active${dotCaptures[i] ? ' board-overlay__path-dot--capture' : ''}`}
            style={{ left: p.x - PATH_DOT_SIZE / 2, top: p.y - PATH_DOT_SIZE / 2, width: PATH_DOT_SIZE, height: PATH_DOT_SIZE }}
          />
        ));
      })}
      {eligibleIds.map((marbleId) => {
        const marble = state.marbles.find((m) => m.id === marbleId);
        const point = marble && marblePoint(state, marble, trackLength, geo);
        if (!marble || !point) return null;
        const steps = allocation[marbleId] ?? 0;
        const isActive = activeMarbleId === marbleId;
        return (
          <button
            key={marbleId}
            type="button"
            className={`board-overlay__target board-overlay__figure${isActive ? ' board-overlay__figure--active' : ''}`}
            style={{ left: point.x - TARGET_SIZE / 2, top: point.y - TARGET_SIZE / 2, width: TARGET_SIZE, height: TARGET_SIZE }}
            aria-pressed={isActive}
            aria-label={`${marbleLabel(marble)}${steps > 0 ? `, ${steps} of 7 allocated so far` : ''}${captureLabelFor(state, marble, steps)}`}
            onClick={() => setActiveMarbleId(marbleId)}
          />
        );
      })}
      {activeMarbleId && (() => {
        const activeMarble = state.marbles.find((m) => m.id === activeMarbleId);
        return activeMarble ? (
          <div className="seven-slider">
            <PixelSlider
              label={`Steps for ${marbleLabel(activeMarble)}`}
              min={0}
              max={maxViableFor(activeMarbleId)}
              value={allocation[activeMarbleId] ?? 0}
              onChange={(v) => handleSlide(activeMarbleId, v)}
            />
          </div>
        ) : null;
      })()}
      <p className="board-overlay__seven-status" role="status" aria-live="polite">
        {total} of 7 steps allocated
      </p>
      <div className="board-overlay__seven-actions">
        {readyMatch && (
          <button type="button" className="cp-button board-overlay__seven-confirm" onClick={() => onPlay(player, readyMatch.top)}>
            Confirm split
          </button>
        )}
        {total > 0 && (
          <button type="button" className="cp-button board-overlay__seven-reset" onClick={() => setAllocation({})}>
            Reset split
          </button>
        )}
      </div>
    </>
  );
}
