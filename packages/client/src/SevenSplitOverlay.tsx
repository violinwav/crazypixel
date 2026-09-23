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

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  captureIndicesFor, moveCaptureIndices, planMovement, rankSevenSplitsForAutofill,
  sevenSplitSegmentCaptures, trackLengthFor,
} from '@crazypixel/shared';
import type { GameState, Marble, Move, PlayerId } from '@crazypixel/shared';
import { homeSlotPoint, trackPoint } from './game/boardLayout';
import type { BoardGeometry, Point } from './game/boardLayout';
import { GUARD_MOVE_SUFFIX } from './game/describeGuard';
import { PixelSlider } from './PixelSlider';

const PATH_DOT_SIZE = 8;
const TARGET_SIZE = 44;
const SEVEN_TOTAL = 7;
/** Proposals Auto split will cycle through. Four is the point past which "press again" stops
 * being faster than dragging the slider yourself. */
const MAX_PROPOSALS = 4;

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
function allocationLabel(steps: number, captures: number): string {
  return `${steps}${allocationSuffix(steps, captures)}`;
}

/** allocationLabel with the count itself split off, for the chip - whose count is a visible
 * digit that has to stay part of its own accessible name, not a number repeated beside it. */
function allocationSuffix(steps: number, captures: number): string {
  return ` of ${SEVEN_TOTAL} steps${captureCountLabel(steps > 0 ? captures : 0)}`;
}

/** Spoken counterpart of the red path dots: the red highlight is the only visual sign that an
 * allocation burns marbles on the way through, so the marble's own label has to say the same
 * thing (WCAG 1.4.1). One wording, shared by the per-marble labels and the Auto split
 * announcement - the marbles it counts are the same marbles either way. */
function captureCountLabel(count: number): string {
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

/** How many marbles a whole split sends home, counted ONCE across the whole sequence.
 *
 * Not a sum of the per-marble counts: those measure each segment against
 * the board as it stands now (see the path-dot comment below), so two segments crossing the
 * same occupied square would both claim it and the count would come out too high. On a button
 * that commits the turn, an inflated capture warning is worse than none. moveCaptureIndices
 * walks the segments in order on a scratch board and dedupes, which is the real answer.
 *
 * Phrased through captureCountLabel like every other capture warning here: two wordings for
 * one fact read as two facts to someone moving between the chips and this line. */
function splitCaptureLabel(state: GameState, move: Move): string {
  return captureCountLabel(moveCaptureIndices(state, move).length);
}

/** Does this split move a marble off the start square it is still guarding? Autofill can spend
 * a guard the player never chose to spend - a board-wide consequence for every seat - and
 * nothing else in this overlay says so, since the chips describe marbles and not the play. */
function splitSpendsGuard(state: GameState, split: SplitSevenMove): boolean {
  return split.steps.some((s) => state.marbles.find((m) => m.id === s.marbleId)?.startProtected);
}

/**
 * What one press of Auto split just did, as one sentence.
 *
 * Order is deliberate: what it allocated, then what it costs, then whether confirm is live,
 * and the cycle position LAST - a player who talks over the tail has already heard the part
 * that changes their decision. The position is here rather than in the button's accessible
 * name because screen readers re-announce the name of the *focused* element when it changes,
 * and focus stays on this button by design - so a name carrying the ordinal would either
 * double every press or not be read at all (WaitingRoom's Copy button made the same call).
 */
function autofillAnnouncement(
  state: GameState,
  split: SplitSevenMove,
  outer: Move,
  marblesHomed: number,
  index: number,
  count: number,
  replaced: boolean,
  confirmBecameAvailable: boolean,
): string {
  const segments = split.steps
    .map((s) => {
      const marble = state.marbles.find((m) => m.id === s.marbleId);
      return marble ? `${marbleLabel(marble).toLowerCase()} takes ${s.steps}` : '';
    })
    .filter(Boolean)
    .join(', ');
  const guard = splitSpendsGuard(state, split) ? GUARD_MOVE_SUFFIX : '';
  // Said out loud because the button means two different things depending on the board, and
  // nothing else distinguishes them: normally it brings marbles home, but where none can
  // reach the goal this turn it falls back to the furthest safe advance. A player pressing it
  // expecting a finisher needs to hear that it isn't one.
  const reach = marblesHomed === 0 ? ' No marble reaches the goal this turn - this is the furthest they get.' : '';
  const confirm = confirmBecameAvailable ? ' The Confirm button is now available.' : '';
  const position = count === 1 ? ' Only option.' : ` Option ${index + 1} of ${count}.`;
  return `Auto split${replaced ? ' replaced your split' : ''}: ${segments}${splitCaptureLabel(state, outer)}${guard}.${reach}${confirm}${position}`;
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
  // Text plus a nonce, because a live region announces MUTATIONS, not values: pressing Auto
  // split twice on a two-proposal board writes the same sentence again, which is no mutation
  // and so announces nothing at all. The <p> holding role=status is never replaced - only the
  // child inside it churns - since a remounted region is a region that says nothing (see the
  // comment on it below). The updater form keeps this pure: StrictMode double-invokes
  // updaters, so incrementing a ref in here would silently advance the nonce twice.
  const [announcement, setAnnouncement] = useState({ text: '', nonce: 0 });
  const announce = (text: string) => setAnnouncement((prev) => ({ text, nonce: prev.nonce + 1 }));
  const [proposalIndex, setProposalIndex] = useState(-1);
  const player = state.currentPlayer;
  const total = Object.values(allocation).reduce((sum, n) => sum + n, 0);
  const trackLength = trackLengthFor(state.config);

  const candidates = moves
    .map((top) => ({ top, inner: unwrapSplitSeven(top) }))
    .filter((c): c is { top: Move; inner: SplitSevenMove } => c.inner !== null);

  const eligibleIds = [...new Set(candidates.flatMap((c) => c.inner.steps.map((s) => s.marbleId)))]
    .sort((a, b) => marbleOrder(state, a) - marbleOrder(state, b));

  // The splits Auto split will offer, best first. Tier-filtered to the best home count and
  // then capped, because cycling is an escape hatch from a proposal the player doesn't like,
  // not a browser for the engine's whole legal set: a crowded board ranks a dozen splits that
  // differ by a single step, and pressing through them all costs more time than the manual
  // allocator this button exists to replace. Memoised on the inputs the ranking actually reads
  // - it replays every candidate on a scratch board, which is too much to redo per keystroke
  // while the slider is being dragged.
  const proposals = useMemo(() => {
    const ranked = rankSevenSplitsForAutofill(state, player, candidates.map((c) => c.inner.steps));
    if (ranked.length === 0) return [];
    // Equal on BOTH counts, not just marbles home: on a board where nothing can finish every
    // proposal homes zero, and tiering on that alone would offer four splits that are plainly
    // worse than the first. Two proposals that tie here really are alternatives.
    const best = ranked[0].outcome;
    return ranked
      .filter((r) => r.outcome.marblesHomed === best.marblesHomed && r.outcome.progress === best.progress)
      .slice(0, MAX_PROPOSALS)
      .map((r) => ({ ...candidates[r.index], outcome: r.outcome }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, moves]);

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

  // A press that would change nothing is inert rather than absent: a button that vanishes
  // under focus drops the player at <body>, and on a single-proposal board a second press
  // would rewrite the status region with the string it already holds - no DOM mutation, so
  // nothing spoken, which reads as a broken control.
  //
  // The total check is load-bearing, not belt-and-braces. matchesAllocation only asks whether
  // every entry the allocation HAS agrees with the candidate, so an empty allocation matches
  // everything vacuously - which made the button inert from the moment the overlay opened on
  // every board with exactly one proposal, i.e. most real ones.
  const autofillInert = proposals.length === 0
    || (proposals.length === 1
      && total === SEVEN_TOTAL
      && matchesAllocation(allocation, proposals[0].inner.steps));

  const handleAutofill = () => {
    // aria-disabled doesn't block activation the way the native attribute does - the guard is
    // what actually makes this button inert.
    if (autofillInert) return;
    const next = (proposalIndex + 1) % proposals.length;
    const proposal = proposals[next];
    const alloc = Object.fromEntries(proposal.inner.steps.map((seg) => [seg.marbleId, seg.steps]));
    const replaced = total > 0;

    setProposalIndex(next);
    setAllocation(alloc);
    // The proposal drives the slider, not whatever chip was picked before it. Once the total
    // is 7, maxViableFor returns 0 for any marble holding no steps and the PixelSlider is
    // replaced outright by the "no steps left" paragraph - so leaving the selection on an
    // unfunded marble makes the rail's one live control disappear as a side effect of a button
    // three elements away. Not a focus move: focus stays here so the next press cycles, which
    // is also what makes reassigning the roving tabIndex safe.
    const funded = eligibleIds.find((id) => (alloc[id] ?? 0) > 0);
    if (funded) setPickedMarbleId(funded);

    // Claims the confirm-availability edge for this press. A proposal always totals 7, so the
    // effect below would otherwise fire after paint and overwrite this sentence with its own
    // generic one - two writes to one atomic region in a tick, and the utterance that loses is
    // the one naming the marbles. Derived rather than hardcoded true so a proposal that isn't
    // an exact match can't leave the effect contradicting this a frame later, and consumed
    // rather than silenced so a later drag back off 7 still announces the loss.
    const nowReady = candidates.some((c) => matchesAllocation(alloc, c.inner.steps));
    const confirmBecameAvailable = nowReady && !wasReadyRef.current;
    wasReadyRef.current = nowReady;

    announce(autofillAnnouncement(
      state, proposal.inner, proposal.top, proposal.outcome.marblesHomed,
      next, proposals.length, replaced, confirmBecameAvailable,
    ));
  };

  // Only set once the allocation exactly matches a real legal move, which is what lets the
  // confirm button gate on it rather than submitting the instant a drag hits 7.
  const readyMatch = total === SEVEN_TOTAL ? candidates.find((c) => matchesAllocation(allocation, c.inner.steps)) : undefined;

  // Which squares each marble's segment burns. Two sources, and the switch between them is the
  // point: a half-built allocation has no execution order yet, so each segment can only be
  // measured against the board as it stands now - but the moment the allocation IS a complete
  // legal move the order is known, and measuring against it removes the phantom captures that
  // reading looks up. Auto split lands on a complete move every press, so without this the
  // button that promises not to cost you a marble warned that it would.
  const captureSquares = new Map<string, Set<number>>(
    readyMatch
      ? sevenSplitSegmentCaptures(state, readyMatch.top).map((seg) => [seg.marbleId, new Set(seg.indices)])
      : eligibleIds.map((id) => {
        const marble = state.marbles.find((m) => m.id === id);
        const steps = allocation[id] ?? 0;
        return [id, new Set(marble && steps > 0 ? captureIndicesFor(state, marble, steps, 'passOver') : [])];
      }),
  );
  const capturesFor = (marbleId: string) => captureSquares.get(marbleId)?.size ?? 0;

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
  const autofillHintId = useId();
  const confirmHintId = useId();
  const resetHintId = useId();
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
    announce(isReady ? 'All 7 steps allocated. The Confirm button is now available.' : 'Split is no longer complete.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // proposals is derived from the selected card's legal moves, so a different card is a
  // different set and an index into the old one points at nothing. Cleared rather than
  // clamped: the cycle should restart at the best proposal, not resume mid-list.
  useEffect(() => { setProposalIndex(-1); }, [proposals]);

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
        const captured = captureSquares.get(marbleId) ?? new Set<number>();
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
            aria-label={`${marbleLabel(marble)}, ${allocationLabel(steps, capturesFor(marbleId))}`}
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
                <span className="visually-hidden">{allocationSuffix(steps, capturesFor(marbleId))}</span>
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
                valueText={`${allocation[activeMarbleId] ?? 0}, ${total} of ${SEVEN_TOTAL} total${captureCountLabel(capturesFor(activeMarbleId))}`}
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
        {/* Keyed on the nonce, not on the text: pressing Auto split again can produce the
            same sentence, and a region re-rendered with an identical string has mutated
            nothing and says nothing. Keying the <p> itself would remount the region instead,
            which is the failure the comment above describes. */}
        <span key={announcement.nonce}>{announcement.text}</span>
      </p>
      {/* One panel rather than three buttons loose over the board art, borrowing .seven-rail's
          own chrome so the two halves of this card's UI read as the same control surface. The
          buttons sit on painted board squares and laid cards, which is exactly the background a
          plain button edge disappears into. */}
      <div className="board-overlay__seven-actions" role="group" aria-label="Split actions">
        {/* First in the row, and never auto-submitting: this reaches 7/7 on every press, but
            the 7 is the card that most often ends a game, so the split still has to be read
            and confirmed. Same rule the slider has followed since this overlay existed. */}
        <button
          type="button"
          className="cp-button board-overlay__seven-autofill"
          aria-disabled={autofillInert}
          // Named by its own text, never an aria-label - and the cycle position deliberately
          // stays OUT of the name (see autofillAnnouncement), so the name is constant across
          // presses and the ordinal is carried by the live region and the hint below.
          aria-describedby={autofillHintId}
          // Enter activates a button on keydown and browsers repeat keydown while held, so a
          // held Enter would rip through every proposal at the OS repeat rate and bury the
          // turn timer's own live region. Space activates on keyup and can't repeat.
          onKeyDown={(e) => { if (e.repeat && e.key === 'Enter') e.preventDefault(); }}
          onClick={handleAutofill}
        >
          Auto split
        </button>
        {/* Proposing and committing are different jobs; the rule says so without spending a
            word on it. Decorative only - the group already has a name, and a <span> announced
            as "separator" between two buttons would be noise. */}
        <span className="board-overlay__seven-divider" aria-hidden="true" />
        {/* Always rendered, disabled via aria rather than the `disabled` attribute: a button
            that pops into existence at 7/7 is invisible to anyone not re-scanning the DOM, and
            a natively disabled one drops out of the tab order just as silently. This one can be
            found and focused before it is usable, and says why. */}
        <button
          type="button"
          className="cp-button board-overlay__seven-confirm"
          aria-disabled={!readyMatch}
          aria-describedby={confirmHintId}
          onClick={() => readyMatch && onPlay(player, readyMatch.top)}
        >
          Confirm
        </button>
        {/* Was conditional on total > 0, which meant its own click unmounted the element that
            had focus and dropped the player at <body> - a Tab away from anything, with the
            turn clock running. Auto split turns this from a rare escape hatch into the normal
            way to undo a proposal, so it gets the same aria-disabled treatment as confirm. */}
        <button
          type="button"
          className="cp-button board-overlay__seven-reset"
          aria-disabled={total === 0}
          aria-describedby={resetHintId}
          onClick={() => {
            if (total === 0) return;
            setAllocation({});
            setProposalIndex(-1);
          }}
        >
          Reset
        </button>
      </div>
      {/* All three outside their buttons, never as aria-label: the accessible name has to stay
          exactly the visible verb so voice control can call it (WCAG 2.5.3), and folding these
          changing digits inside would make them part of the name - the same trap the chip markup
          documents above. Read on focus, which is also the only view that survives NVDA's
          elements list and the VoiceOver rotor: those show a flat button list where "Reset" on
          its own says nothing, and the row's group name isn't rendered there.

          Confirm's is the one that earns its keep. aria-disabled announces THAT it is
          unavailable and never why; the dimmed fill tells a sighted player "not yet" and tells
          everyone else nothing, under a 20s turn clock. Static per state rather than carrying
          the running total - a description that churns on every slider keystroke is noise, and
          the slider's own valueText already says the count. */}
      <p id={autofillHintId} className="visually-hidden">
        {/* proposalIndex is -1 until the first press, so an unguarded `+ 1` reads "Option 0 of 2"
            to anyone who focuses the button before using it - a position in a cycle that has not
            started. Before the first press there is no position to report, only what pressing
            will do. */}
        {proposals.length < 2
          ? 'Fills in the best split that costs you no marble of your own.'
          : proposalIndex < 0
            ? `${proposals.length} splits to choose from. Press to fill in the best one.`
            : `Option ${proposalIndex + 1} of ${proposals.length}. Press again for the next split.`}
      </p>
      <p id={confirmHintId} className="visually-hidden">
        {readyMatch ? 'Plays this split and ends your turn.' : 'Allocate all 7 steps first.'}
      </p>
      <p id={resetHintId} className="visually-hidden">Clears the allocation and starts the split over.</p>
    </>
  );
}
