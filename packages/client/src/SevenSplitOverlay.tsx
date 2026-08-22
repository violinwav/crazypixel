import { useEffect, useRef, useState } from 'react';
import { planMovement, trackLengthFor } from '@crazypixel/shared';
import type { GameState, Marble, Move, PlayerId } from '@crazypixel/shared';
import { trackPoint, homeSlotPoint } from './game/boardLayout';
import type { BoardGeometry, Point } from './game/boardLayout';
import { capturedPointsFor } from './game/moveTargets';
import { PixelSlider } from './PixelSlider';

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

const PATH_DOT_SIZE = 8;
const TARGET_SIZE = 44;
const SEVEN_TOTAL = 7;

type SplitSevenMove = Extract<Move, { kind: 'splitSeven' }>;

interface Props {
  state: GameState;
  /** Top-level legal moves for the selected card, already filtered to ones that are (or
   * wrap, via wildAs for a Joker played as 7) a splitSeven - see unwrapSplitSeven. */
  moves: Move[];
  geo: BoardGeometry;
  onPlay: (player: PlayerId, move: Move) => void;
}

/** Unwraps wildAs (Joker-as-7) down to the underlying splitSeven, so the allocator logic
 * below works the same regardless of whether the 7 was played directly or via a Joker. The
 * *outer* move (possibly still wildAs-wrapped) is what actually gets applied - see caller. */
function unwrapSplitSeven(move: Move): SplitSevenMove | null {
  if (move.kind === 'splitSeven') return move;
  if (move.kind === 'wildAs' || move.kind === 'copyLastCard') return unwrapSplitSeven(move.innerMove);
  return null;
}

function matchesAllocation(alloc: Record<string, number>, steps: SplitSevenMove['steps']): boolean {
  const byMarble = new Map(steps.map((s) => [s.marbleId, s.steps]));
  return Object.entries(alloc).every(([marbleId, count]) => byMarble.get(marbleId) === count);
}

/** Is `alloc` still a possible prefix of this candidate - i.e. has no marble been tapped
 * more times than this candidate ultimately gives it? Deliberately looser than an exact
 * match: with only one eligible marble, the only legal candidate might be "this marble
 * takes all 7" - no candidate exists for the intermediate counts 1..6, so gating each tap
 * on an *exact* match (as this used to) rejected every tap before the count could ever
 * reach 7, softlocking the card. Prefix-viability accepts "still consistent with reaching
 * this candidate eventually," and the exact match is only required once total hits 7 (see
 * handleTap) - so it can't produce a final allocation that isn't a real legal move. */
function isViablePrefix(alloc: Record<string, number>, steps: SplitSevenMove['steps']): boolean {
  const byMarble = new Map(steps.map((s) => [s.marbleId, s.steps]));
  return Object.entries(alloc).every(([marbleId, count]) => (byMarble.get(marbleId) ?? 0) >= count);
}

// Tap the actual marble on the board to pick it (real position, real figure-select target -
// same language as every other card's figure-select step), then a pixel slider sets that
// one marble's step count directly. The board shows the *result* of a selection too: the
// walked path so far, as colored squares that pulse while active (see
// .board-overlay__path-dot--active) rather than a shape that grows or shrinks. Reaching 7
// total doesn't auto-submit - a confirm button appears once the allocation exactly matches a
// real legal move (already enumerated by the engine - see GameEngine.ts
// generateSevenSplits), so a slider drag that happens to land on the target count doesn't
// commit the turn before the player meant it to. The slider's own max (maxViableFor) keeps
// every drag within what the real legal-move set allows.
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

  /** Highest step count `marbleId` could take on right now without making every remaining
   * candidate impossible to reach - the slider's max, so dragging it can never propose an
   * allocation the engine wouldn't actually allow. */
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

  // Only set once `allocation` exactly matches a real legal move - lets the confirm button
  // gate on it rather than submitting the instant a drag happens to hit 7.
  const readyMatch = total === SEVEN_TOTAL ? candidates.find((c) => matchesAllocation(allocation, c.inner.steps)) : undefined;

  // A single eligible marble is no real split to choose - with exactly one marble able to
  // move at all, there's only ever one legal combination (it takes all 7), so the allocator
  // UI (marble picker, slider, confirm button) has nothing left for the player to decide.
  // Same auto-play-the-only-option pattern as BoardOverlay.tsx's start-marble case, and the
  // same StrictMode guard it needs: React 18 dev-mode double-invokes an effect with no
  // cleanup, and onPlay is a real side effect (plays the turn), not a pure render - without
  // the ref, that double-invoke would silently play two turns' worth of moves back to back.
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
        if (plan.location.zone === 'home') {
          pathDots.push(homeSlotPoint(state.config, marble.owner, plan.location.index, geo));
        }

        return pathDots.map((p, i) => (
          <div
            key={`${marbleId}-${i}`}
            className="board-overlay__path-dot board-overlay__path-dot--active"
            style={{ left: p.x - PATH_DOT_SIZE / 2, top: p.y - PATH_DOT_SIZE / 2, width: PATH_DOT_SIZE, height: PATH_DOT_SIZE }}
          />
        ));
      })}
      {/* Foreseen-capture preview, only once the allocation is a real confirmable move - a
          partial/in-progress allocation isn't a move the engine can simulate yet. Covers the
          7's own pass-over capture (a marble doesn't have to be the *final* landing square
          to go home - see GameEngine.ts's isMoveClear/applyMove), not just a landing one. */}
      {readyMatch && capturedPointsFor(state, readyMatch.top, geo).map((p, i) => (
        <div
          key={`danger-${i}`}
          className="board-overlay__danger"
          style={{ left: p.x - TARGET_SIZE / 2, top: p.y - TARGET_SIZE / 2, width: TARGET_SIZE, height: TARGET_SIZE }}
        />
      ))}
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
            aria-label={`${marbleLabel(marble)}${steps > 0 ? `, ${steps} of 7 allocated so far` : ''}`}
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
