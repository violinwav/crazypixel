// The 7's multi-marble step allocator. Every control lives in one rail docked to the board's
// right edge, bottom-anchored just above the hand panel and turn timer: a chip per eligible
// marble, then a vertical slider running up from that bottom edge which sets the selected
// marble's step count. The board shows the result too - the walked path so far, as squares
// along the route.
//
// The rail exists because picking a marble used to mean hunting for its 44px ring among the
// board art, with nothing selected at all until you found one. The chips list the same marbles
// in a fixed place, carry each one's running count, and are arrow-key navigable; the board
// rings stay as a second, spatial way to do the same thing. The first eligible marble is
// selected on open so the slider is live immediately.
//
// The rail overlaps whatever board art sits under the right edge, including marble rings near
// 3 o'clock - which is exactly why the chips have to be able to reach every eligible marble on
// their own, not just the ones left uncovered.
//
// Reaching 7 total does NOT auto-submit. A confirm button appears once the allocation exactly
// matches a real legal move (already enumerated by the engine, see generateSevenSplits), so a
// slider drag that happens to land on the target count doesn't commit the turn before the
// player meant it to. The slider's own max keeps every drag inside the legal set.

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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

/** The chip's visible text - the same identity as marbleLabel, cut to what fits a 60px rail.
 * Never the accessible name on its own: the chip spells the full sentence out in aria-label. */
function marbleShortLabel(marble: Marble): string {
  return marble.location.zone === 'home' ? `H${marble.location.index + 1}` : `${marble.location.index}`;
}

/** Track marbles in board order, then home ones - a fixed reading order for the chip list, so
 * a marble doesn't move under the player's finger when an allocation changes. */
function marbleOrder(state: GameState, id: string): number {
  const marble = state.marbles.find((m) => m.id === id);
  if (!marble) return Number.MAX_SAFE_INTEGER;
  return (marble.location.zone === 'home' ? 1000 : 0) + marble.location.index;
}

/** The running allocation, phrased ONCE for every control that reports it - the board ring, the
 * rail chip and the slider's aria-valuetext. Three wordings for one fact read as three
 * different facts to someone swiping between them. */
function allocationLabel(state: GameState, marble: Marble, steps: number): string {
  return `${steps}${allocationSuffix(state, marble, steps)}`;
}

/** allocationLabel with the count itself split off, for the chip - whose count is a visible
 * digit that has to stay part of its own accessible name, not a number repeated beside it. */
function allocationSuffix(state: GameState, marble: Marble, steps: number): string {
  return ` of ${SEVEN_TOTAL} steps${captureLabelFor(state, marble, steps)}`;
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
  const [pickedMarbleId, setPickedMarbleId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const player = state.currentPlayer;
  const total = Object.values(allocation).reduce((sum, n) => sum + n, 0);
  const trackLength = trackLengthFor(state.config);

  const candidates = moves
    .map((top) => ({ top, inner: unwrapSplitSeven(top) }))
    .filter((c): c is { top: Move; inner: SplitSevenMove } => c.inner !== null);

  const eligibleIds = [...new Set(candidates.flatMap((c) => c.inner.steps.map((s) => s.marbleId)))]
    .sort((a, b) => marbleOrder(state, a) - marbleOrder(state, b));

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
  // Nothing was selected until the player found a marble on the board, so the slider - the
  // whole point of this overlay - rendered as dead space on open. Falling back to the first
  // eligible marble makes it live immediately, and covers the pick going stale (its move got
  // applied, or the card changed) without an effect: derived during render, so there is never
  // a first paint where the selection is null and every chip is un-tabbable.
  const activeMarbleId = pickedMarbleId && eligibleIds.includes(pickedMarbleId) ? pickedMarbleId : eligibleIds[0] ?? null;

  // Roving tabindex over a radiogroup: the chip list is one tab stop and arrows move within
  // it. The container role matters - `group` is a structure role, not a composite one, so
  // screen readers would stay in browse mode, never forward the arrows, and leave every
  // non-selected chip unreachable (WCAG 2.1.1). radiogroup is also the honest description of
  // the control: exactly one marble is the slider's subject, and clicking a chip selects
  // rather than toggles, which is why these are radios and not aria-pressed buttons.
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusChip = (marbleId: string) => {
    setPickedMarbleId(marbleId);
    chipRefs.current.get(marbleId)?.focus();
  };
  const handleChipKey = (event: ReactKeyboardEvent, index: number) => {
    const last = eligibleIds.length - 1;
    const next = {
      ArrowDown: Math.min(index + 1, last),
      ArrowRight: Math.min(index + 1, last),
      ArrowUp: Math.max(index - 1, 0),
      ArrowLeft: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusChip(eligibleIds[next]);
  };

  // The allocator mounts because a hand card was activated, so focus sits on that card - which
  // is AFTER this whole overlay in DOM order (the board container precedes .hand-panel-slot in
  // GameBoard). Tab from there moves away from the rail, not into it, so nothing reaches the
  // controls without a shift-Tab the player has no reason to guess at (WCAG 2.4.3). Moved once
  // per mount: the ref guard is what stops StrictMode's double-invoke, and what stops a later
  // re-render from yanking focus back off the slider mid-drag.
  const focusedOnOpenRef = useRef(false);
  useEffect(() => {
    if (focusedOnOpenRef.current || !activeMarbleId) return;
    focusedOnOpenRef.current = true;
    chipRefs.current.get(activeMarbleId)?.focus();
  }, [activeMarbleId]);

  // Confirm appearing is the only moment in this overlay that matters, and it happens with no
  // announcement of its own under a 20s turn clock. Edge-triggered on purpose: the slider's
  // aria-valuetext already carries the running total on every keypress, so re-announcing it
  // here would double every arrow press and push TurnTimerBar's own polite region - the one
  // that IS time-critical - further back in the queue (WCAG 4.1.3).
  const wasReadyRef = useRef(false);
  const isReady = readyMatch !== undefined;
  useEffect(() => {
    if (isReady === wasReadyRef.current) return;
    wasReadyRef.current = isReady;
    setAnnouncement(isReady ? 'All 7 steps allocated. Confirm split is now available.' : 'Split is no longer complete.');
  }, [isReady]);

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

        // --active marks only the marble the slider is currently driving. With several marbles
        // allocated at once their paths otherwise read as one undifferentiated smear of dots,
        // and the rail gives no other on-board sign of which one an arrow key will move.
        const dotActive = marbleId === activeMarbleId;
        return pathDots.map((p, i) => (
          <div
            key={`${marbleId}-${i}`}
            className={`board-overlay__path-dot${dotActive ? ' board-overlay__path-dot--active' : ''}${dotCaptures[i] ? ' board-overlay__path-dot--capture' : ''}`}
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
            aria-label={`${marbleLabel(marble)}, ${allocationLabel(state, marble, steps)}`}
            onClick={() => setPickedMarbleId(marbleId)}
          />
        );
      })}
      <div className="seven-rail">
        <div className="seven-rail__marbles" role="radiogroup" aria-label="Marble to move">
          {eligibleIds.map((marbleId, index) => {
            const marble = state.marbles.find((m) => m.id === marbleId);
            if (!marble) return null;
            const steps = allocation[marbleId] ?? 0;
            const isActive = activeMarbleId === marbleId;
            return (
              <button
                key={marbleId}
                type="button"
                ref={(el) => {
                  if (el) chipRefs.current.set(marbleId, el);
                  else chipRefs.current.delete(marbleId);
                }}
                className={`seven-rail__chip${isActive ? ' seven-rail__chip--active' : ''}`}
                role="radio"
                aria-checked={isActive}
                // One tab stop for the whole list; arrows move between chips.
                tabIndex={isActive ? 0 : -1}
                onKeyDown={(e) => handleChipKey(e, index)}
                onClick={() => setPickedMarbleId(marbleId)}
              >
                {/* Named by its own content rather than an aria-label, so the name CONTAINS the
                    visible string (WCAG 2.5.3) - a home chip reads "H1" and must be callable as
                    "H1" by voice, which an aria-label of "Marble in your home stretch, slot 1"
                    silently broke. It also keeps the changing step count out of the accessible
                    NAME, the same trap PixelSlider's valueLabel comment already documents. */}
                <span className="seven-rail__chip-where">{marbleShortLabel(marble)}</span>
                {/* Between the two digits, not after them: adjacent text nodes concatenate into
                    the accessible name, so "4" and "0" ran together as "40" - the id of a
                    different marble on this very board. */}
                <span className="visually-hidden">{`, ${marbleLabel(marble)}, `}</span>
                <span className="seven-rail__chip-steps">{steps}</span>
                <span className="visually-hidden">{allocationSuffix(state, marble, steps)}</span>
              </button>
            );
          })}
        </div>
        {/* Visual counterpart of the role=status line below, which is kept off-screen so the
            count isn't rendered twice in the same corner. */}
        <p className="seven-rail__total" aria-hidden="true">{total}/{SEVEN_TOTAL}</p>
        {activeMarbleId && (() => {
          const activeMarble = state.marbles.find((m) => m.id === activeMarbleId);
          if (!activeMarble) return null;
          const max = maxViableFor(activeMarbleId);
          // A 0-max range is a dead control that still paints its zero notch filled - which on
          // a vertical track is one solid block reading as a FULL allocation, the opposite of
          // what it means. An empty outlined slot says "nothing to give this marble" instead.
          if (max === 0) {
            return (
              <p className="seven-rail__spent">
                <span aria-hidden="true">0</span>
                <span className="visually-hidden">No steps left for this marble - the others have taken all 7.</span>
              </p>
            );
          }
          return (
            <div className="seven-rail__slider">
              <PixelSlider
                label={`Steps for ${marbleLabel(activeMarble)}`}
                orientation="vertical"
                min={0}
                max={max}
                value={allocation[activeMarbleId] ?? 0}
                // Leads with the raw step count because valuetext REPLACES the spoken value.
                // The rest is context nothing else says while the slider has focus: the running
                // total (the rail's "3/7" is aria-hidden) and the capture warning, which is
                // otherwise carried only by the red path dots - color alone (WCAG 1.4.1).
                valueText={`${allocation[activeMarbleId] ?? 0}, ${total} of ${SEVEN_TOTAL} total${captureLabelFor(state, activeMarble, allocation[activeMarbleId] ?? 0)}`}
                onChange={(v) => handleSlide(activeMarbleId, v)}
              />
            </div>
          );
        })()}
      </div>
      {/* Mounts empty on purpose: a live region only announces mutations observed after it is
          inserted, so one that arrives already reading "0 of 7 steps allocated" announces
          nothing at all. */}
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className="board-overlay__seven-actions">
        {/* Always rendered, disabled via aria rather than the `disabled` attribute: a button
            that pops into existence at 7/7 is invisible to anyone not re-scanning the DOM, and
            a natively disabled one drops out of the tab order just as silently. This one can be
            found and focused before it is usable, and says why. */}
        <button
          type="button"
          className="cp-button board-overlay__seven-confirm"
          aria-disabled={!readyMatch}
          onClick={() => readyMatch && onPlay(player, readyMatch.top)}
        >
          Confirm split
        </button>
        {total > 0 && (
          <button type="button" className="cp-button board-overlay__seven-reset" onClick={() => setAllocation({})}>
            Reset split
          </button>
        )}
      </div>
    </>
  );
}
