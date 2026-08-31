// Board geometry, shared by TableScene (the Phaser canvas render) and BoardOverlay (the
// accessible DOM hit targets drawn on top of it), so the two stay pixel-aligned by
// construction rather than by two hand-copied implementations drifting apart.
//
// Every radius scales off the viewport rather than being a fixed pixel constant - a fixed
// 220px track radius clipped the kennels off both edges of a 375px-wide phone. The ratios
// below are relative to a 220px reference track radius, preserving the desktop proportions
// this was originally tuned at.

import { KENNEL_SIZE, startIndexFor, trackLengthFor } from '@crazypixel/shared';
import type { GameConfig, PlayerId } from '@crazypixel/shared';

export interface Point {
  x: number;
  y: number;
}

export interface BoardGeometry {
  center: Point;
  trackRadius: number;
  kennelRadius: number;
  /** Where OpponentHandCounts badges anchor - further out than the kennel cluster. */
  handCountRadius: number;
  homeRadiusOuter: number;
  homeRadiusStep: number;
  stackOffset: number;
  /**
   * Draw/discard pile anchor. Always centered at the bottom of the board area, independent
   * of the ring's own center, so a bigger ring (see radiusBoostFor) can't crowd or cover it.
   */
  stackCenter: Point;
  /**
   * Radians added to every track angle so the viewer's own start square renders at the
   * bottom of the ring - "my base always faces me" - whatever that seat's absolute track
   * position is. Baked into the geometry object rather than passed to each point function,
   * so every existing `geo` consumer gets correct rotation without a signature change.
   */
  rotation: number;
}

/** Exported so any renderer derives the same scale factor off geo.trackRadius. */
export const REFERENCE_TRACK_RADIUS = 220;

// Below the original fixed-4-player track length (64) on purpose: boosting only 6P left 4P
// reading as cramped, so a lower reference gives every config from 4P up some extra room.
// Duplicated rather than imported from constants.ts to keep this file free of player-count
// details it otherwise doesn't need (TableScene.ts holds the same duplicate, deliberately).
const REFERENCE_TRACK_LENGTH = 48;

// The ratios below are one tuned system, not independent numbers: each governs how far a
// layer sits from the layer just inside it, so what is being chosen here is the *gaps*
// between layers, in reference-scale pixels:
//   ring (220) -> home markers (190, stepping in 30 per slot) -> kennel (260) ->
//   hand-count badge (310)
// Deliberately compact end to end, because the outermost ratio also drives the viewport-fit
// clamp in computeBoardGeometry: a smaller outermost ratio means more of the viewport
// reaches the ring itself instead of being spent on empty space beyond it.
const KENNEL_RATIO = 260 / REFERENCE_TRACK_RADIUS;
// Slot 0 (outermost) sits inside the ring with a clear gap to the start tile; each further
// slot steps 30px further in, which against TableScene's 14px goal tile leaves real daylight
// between markers rather than just avoiding a touch.
const HOME_OUTER_RATIO = 190 / REFERENCE_TRACK_RADIUS;
const HOME_STEP_RATIO = 30 / REFERENCE_TRACK_RADIUS;
// Opponent hand-count badges (OpponentHandCounts.tsx) sit here, not at kennelRadius, so they
// clear the kennel cluster instead of landing on top of it.
const HAND_COUNT_RATIO = 310 / REFERENCE_TRACK_RADIUS;
// Half the gap between the draw and discard piles. At the card's 80px width anything much
// smaller reads as one stack rather than two.
const STACK_OFFSET_RATIO = 65 / REFERENCE_TRACK_RADIUS;
// Top margin. The page <h1> is screen-reader-only, so this only has to clear the safe
// area/notch, not a visible heading.
const TITLE_MARGIN = 16;
// Without slack, kennels sized to exactly fill the viewport clipped their outermost marble.
const EDGE_SAFETY_FACTOR = 0.82;
// Bottom margin for the draw/discard anchor - clears a full-height card plus breathing room
// above the hand panel below it.
const STACK_BOTTOM_MARGIN = 95;

/**
 * More players means more track squares on the same-shaped ring, so grow the ring a little
 * for longer tracks rather than letting tiles get cramped. Never shrinks below the original
 * 1x tuning (2P's 32-square track wasn't the cramped one), and capped at 1.25 - at 1.5 a 6P
 * board rendered noticeably larger than every other count on any viewport wide enough for
 * the boost, rather than the viewport clamp, to govern trackRadius.
 */
function radiusBoostFor(trackLength: number): number {
  return Math.max(1, Math.min(1.25, Math.sqrt(trackLength / REFERENCE_TRACK_LENGTH)));
}

/**
 * @param viewerSeat Whose base renders at the bottom of the ring - see
 * `BoardGeometry.rotation`. Pass the same seat consistently across a render (GameBoard.tsx's
 * viewerSeat), or Phaser and the DOM overlay will disagree about where things are.
 * @param playerCount Needed to turn `viewerSeat` into a rotation angle; not derivable from
 * `trackLength` alone without a GameConfig this function otherwise doesn't need.
 */
export function computeBoardGeometry(
  width: number,
  height: number,
  trackLength: number = REFERENCE_TRACK_LENGTH,
  viewerSeat: PlayerId = 0,
  playerCount: number = 4,
): BoardGeometry {
  const center: Point = { x: width / 2, y: height / 2 - 56 };
  // Measured as real clearance from `center` in every direction, not height / 2: center is
  // shifted up by 56px to leave room for the hand panel, so a symmetric measure overstates
  // the headroom above it and lets the top-most badge size itself off-screen.
  const available = Math.min(
    width / 2,
    center.y - TITLE_MARGIN,
    Math.max(height - center.y, 0),
  ) * EDGE_SAFETY_FACTOR;
  const desiredRadius = REFERENCE_TRACK_RADIUS * radiusBoostFor(trackLength);
  // Clamp against whichever layer reaches furthest out, or that layer overflows the viewport
  // on a tight screen.
  const outermostRatio = Math.max(KENNEL_RATIO, HAND_COUNT_RATIO);
  const trackRadius = Math.max(80, Math.min(desiredRadius, available / outermostRatio));
  const stackCenter: Point = { x: width / 2, y: Math.max(center.y + trackRadius * 0.3, height - STACK_BOTTOM_MARGIN) };
  // angleForTrackIndex already offsets by -PI/2 to put index 0 at the top, so putting this
  // seat at the bottom means a further +PI, minus that seat's own unrotated angle.
  const rotation = Math.PI - (viewerSeat / playerCount) * Math.PI * 2;
  return {
    center,
    trackRadius,
    kennelRadius: trackRadius * KENNEL_RATIO,
    handCountRadius: trackRadius * HAND_COUNT_RATIO,
    homeRadiusOuter: trackRadius * HOME_OUTER_RATIO,
    homeRadiusStep: trackRadius * HOME_STEP_RATIO,
    stackOffset: trackRadius * STACK_OFFSET_RATIO,
    stackCenter,
    rotation,
  };
}

function angleForTrackIndex(index: number, trackLength: number, rotation: number): number {
  return (index / trackLength) * Math.PI * 2 - Math.PI / 2 + rotation;
}

/**
 * The ring angle a track square sits at, rotation included. Exported so a renderer can draw
 * *along* the ring (TableScene's trail arc) and not only at the discrete square positions
 * trackPoint gives, off the same source of truth.
 */
export function trackAngle(index: number, trackLength: number, geo: BoardGeometry): number {
  return angleForTrackIndex(index, trackLength, geo.rotation);
}

export function trackPoint(index: number, trackLength: number, geo: BoardGeometry): Point {
  const angle = angleForTrackIndex(index, trackLength, geo.rotation);
  return { x: geo.center.x + Math.cos(angle) * geo.trackRadius, y: geo.center.y + Math.sin(angle) * geo.trackRadius };
}

export function kennelSlotPoint(config: GameConfig, player: PlayerId, slot: number, geo: BoardGeometry): Point {
  const trackLength = trackLengthFor(config);
  const angle = angleForTrackIndex(startIndexFor(config, player), trackLength, geo.rotation) + (slot - (KENNEL_SIZE - 1) / 2) * 0.2;
  return { x: geo.center.x + Math.cos(angle) * geo.kennelRadius, y: geo.center.y + Math.sin(angle) * geo.kennelRadius };
}

/** Where a player's hand-count badge sits: their kennel's angle, at handCountRadius. */
export function handCountPoint(config: GameConfig, player: PlayerId, geo: BoardGeometry): Point {
  const trackLength = trackLengthFor(config);
  const angle = angleForTrackIndex(startIndexFor(config, player), trackLength, geo.rotation);
  return { x: geo.center.x + Math.cos(angle) * geo.handCountRadius, y: geo.center.y + Math.sin(angle) * geo.handCountRadius };
}

export function homeSlotPoint(config: GameConfig, player: PlayerId, slot: number, geo: BoardGeometry): Point {
  const trackLength = trackLengthFor(config);
  const angle = angleForTrackIndex(startIndexFor(config, player), trackLength, geo.rotation);
  const radius = geo.homeRadiusOuter - slot * geo.homeRadiusStep;
  return { x: geo.center.x + Math.cos(angle) * radius, y: geo.center.y + Math.sin(angle) * radius };
}

export function drawPileCenter(geo: BoardGeometry): Point {
  return { x: geo.stackCenter.x + geo.stackOffset, y: geo.stackCenter.y };
}

export function discardPileCenter(geo: BoardGeometry): Point {
  return { x: geo.stackCenter.x - geo.stackOffset, y: geo.stackCenter.y };
}

/**
 * The viewport scale factor every piece and card size goes through, Phaser or DOM, so a card
 * scales identically wherever it is drawn.
 */
export function pieceScaleFor(geo: BoardGeometry): number {
  return geo.trackRadius / REFERENCE_TRACK_RADIUS;
}
