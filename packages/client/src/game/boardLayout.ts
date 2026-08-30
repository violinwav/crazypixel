import {
  KENNEL_SIZE, HOME_STRETCH_LENGTH, trackLengthFor, startIndexFor, activePlayerIds,
} from '@crazypixel/shared';
import type { GameConfig, PlayerId } from '@crazypixel/shared';

// Shared between TableScene (Phaser canvas render) and BoardOverlay (accessible DOM hit
// targets drawn on top of it) so the two stay pixel-aligned by construction instead of by
// two hand-copied implementations quietly drifting apart.
//
// All radii scale off the viewport instead of being fixed pixel constants - a fixed
// 220px track radius clipped the kennels off both edges of a 375px-wide phone viewport.
// Ratios below are relative to a 220px "reference" track radius, preserving the desktop
// proportions this was originally tuned at.

export interface Point {
  x: number;
  y: number;
}

export interface BoardGeometry {
  center: Point;
  trackRadius: number;
  kennelRadius: number;
  /** Where OpponentHandCounts badges anchor - see HAND_COUNT_RATIO above. Deliberately its
   * own field, not derived from kennelRadius at the call site, so every consumer gets the
   * same "further out than the kennel" radius without re-deriving the ratio. */
  handCountRadius: number;
  homeRadiusOuter: number;
  homeRadiusStep: number;
  stackOffset: number;
  /** Draw/discard piles anchor here - always centered at the bottom of the board area,
   * independent of the ring's own center, rather than sitting inside the ring where a
   * bigger ring (see radiusBoostFor) could crowd or cover them. */
  stackCenter: Point;
  /** Radians added to every track-angle calculation so the viewer's own start square always
   * renders at the bottom of the ring (screen-down), regardless of that seat's absolute
   * track position - "my base always faces me." Baked into the geometry object (not a
   * separate parameter every point function takes) specifically so trackPoint/
   * kennelSlotPoint/homeSlotPoint's signatures stay unchanged - every caller that already
   * receives a `geo` (figureTargets.ts, moveTargets.ts, SevenSplitOverlay.tsx) gets correct
   * rotation for free, only computeBoardGeometry's own call sites need to pass a viewer. */
  rotation: number;
}

// Exported so any renderer (TableScene's Phaser pieces, a DOM card overlay) can derive the
// same scale factor off geo.trackRadius instead of each hand-tuning its own reference value.
export const REFERENCE_TRACK_RADIUS = 220;
// Deliberately below the original fixed-4-player track length (64) - first pass only
// boosted the ring for 6P and left 4P at its original, unboosted radius, which turned out
// to still read as cramped. Using a lower reference means every config from 4P up gets at
// least some extra room, not just the longest track. Not imported from constants.ts to
// avoid a dependency on player-count details this file otherwise doesn't need.
const REFERENCE_TRACK_LENGTH = 48;
// Every ratio below is tuned as one system, not independently - each one governs how far a
// layer sits from the layer just inside it, in reference-scale pixels, so the *gaps*
// between layers (not just their individual distances from center) are what's actually
// being chosen here:
//   ring (220) -> home markers (190, stepping in by 30 per slot) -> kennel (260) ->
//   hand-count indicator (310)
// Compact end-to-end (kennel pulled way in from its old 300, hand-count from its old 345)
// specifically because this whole ratio set also drives computeBoardGeometry's viewport-fit
// clamp (available / outermostRatio below) - a smaller outermost ratio means more of the
// viewport's actual size reaches the ring itself instead of being eaten by empty space
// between the ring and the furthest-out badge.
const KENNEL_RATIO = 260 / REFERENCE_TRACK_RADIUS;
// Slot 0 (outermost) sits inside the ring with a clear gap to the start tile, not right up
// against it, and each further slot steps 30px further in (see GOAL_TILE_SIZE=14 in
// TableScene.ts - a 30px step against a 14px tile leaves real daylight between markers, not
// just enough to avoid touching).
const HOME_OUTER_RATIO = 190 / REFERENCE_TRACK_RADIUS;
const HOME_STEP_RATIO = 30 / REFERENCE_TRACK_RADIUS;
// Opponent hand-count indicator (OpponentHandCounts.tsx - a small fanned stack of card
// icons, one per card in that opponent's hand) anchors here instead of at kennelRadius, so
// it clears the kennel cluster instead of sitting on top of it.
const HAND_COUNT_RATIO = 310 / REFERENCE_TRACK_RADIUS;
// Was 42 - at the card's current 80px width (TableScene.ts's CARD_WIDTH) that left barely
// any gap between the draw and discard piles, closer to touching than two distinct stacks.
const STACK_OFFSET_RATIO = 65 / REFERENCE_TRACK_RADIUS;
// The page title (<h1>) is screen-reader-only now, not rendered - this only needs to clear
// the safe-area/notch, not a visible heading anymore. Was 80px (sized for a visible title
// that no longer exists), which just ate board space for nothing.
const TITLE_MARGIN = 16;

// Without slack, kennels sizing to exactly fill the viewport meant the outermost kennel
// marble itself clipped the edge.
const EDGE_SAFETY_FACTOR = 0.82;

/** More players means more track squares on the same-shaped ring - a 6P board (96 squares)
 * packed into the same radius as a 4P one (64 squares) leaves each tile visibly less room.
 * Grows the ring a bit for longer tracks (capped, and still clamped to the viewport below)
 * rather than just letting tiles get more cramped as player count goes up. Never shrinks
 * below the original 1x tuning (2P's shorter 32-square track keeps the same radius it
 * already had - it wasn't the one that looked cramped). Cap lowered from 1.5 to 1.25 - at
 * 1.5 a 6P board (the case this boost grows the most for) rendered noticeably larger than
 * every other player count on any viewport wide enough that the boost, not the viewport
 * clamp, was what actually governed trackRadius - "the board gets very big at 4+ players." */
function radiusBoostFor(trackLength: number): number {
  return Math.max(1, Math.min(1.25, Math.sqrt(trackLength / REFERENCE_TRACK_LENGTH)));
}

// Bottom margin for the draw/discard stack anchor - big enough to clear a bigger card
// (see TableScene.ts's CARD_HEIGHT) plus breathing room above the hand panel below it.
const STACK_BOTTOM_MARGIN = 95;

/**
 * @param viewerSeat Whose base should render at the bottom of the ring - see
 * `BoardGeometry.rotation`. Pass the same seat consistently across a render (mySeat from
 * GameBoard.tsx) or Phaser and the DOM overlay will disagree about where things are.
 * @param playerCount Needed to convert `viewerSeat` into a rotation angle - not derivable
 * from `trackLength` alone without a `GameConfig` this function otherwise doesn't need.
 */
export function computeBoardGeometry(
  width: number,
  height: number,
  trackLength: number = REFERENCE_TRACK_LENGTH,
  viewerSeat: PlayerId = 0,
  playerCount: number = 4,
): BoardGeometry {
  const center: Point = { x: width / 2, y: height / 2 - 56 };
  // Kennels/goal markers/hand-count badges extend beyond the track itself (up to
  // outermostRatio further out, below), so size the track off what leaves room for that, not
  // the raw viewport half-size. Measured as actual clearance from `center` in every
  // direction, not `height / 2` - center is shifted *up* by 56px (room for the hand panel
  // below), so the old symmetric height/2 calculation overstated how much headroom the ring
  // actually had above it, letting the top-most badge size itself right off the top of the
  // viewport (confirmed by reading its rendered bounding rect - top: -9, genuinely off-
  // screen, not just visually tight against the title).
  const available = Math.min(
    width / 2,
    center.y - TITLE_MARGIN,
    Math.max(height - center.y, 0),
  ) * EDGE_SAFETY_FACTOR;
  const desiredRadius = REFERENCE_TRACK_RADIUS * radiusBoostFor(trackLength);
  // HAND_COUNT_RATIO is the furthest-out thing drawn off trackRadius now (further than
  // KENNEL_RATIO) - clamping against KENNEL_RATIO alone would let the hand-count badges
  // overflow the viewport on a tight screen.
  const outermostRatio = Math.max(KENNEL_RATIO, HAND_COUNT_RATIO);
  const trackRadius = Math.max(80, Math.min(desiredRadius, available / outermostRatio));
  const stackCenter: Point = { x: width / 2, y: Math.max(center.y + trackRadius * 0.3, height - STACK_BOTTOM_MARGIN) };
  // viewerSeat's own start index sits at trackLength * (viewerSeat / playerCount) before any
  // rotation - angleForTrackIndex already offsets by -PI/2 to put index 0 at the top, so
  // landing that seat at the bottom (+PI/2) needs a further +PI, then subtract its own
  // unrotated angle to cancel it out.
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

/** The ring angle a track square sits at, rotation included - exported so a renderer can
 * draw *along* the ring (TableScene's trail border arc) rather than only at the discrete
 * square positions trackPoint gives. Same single source of truth as every other point
 * helper here, so an arc and the squares it runs past can't drift apart. */
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

/** Where an opponent's hand-count badge (OpponentHandCounts.tsx) sits - same start-index
 * angle as their kennel, but at handCountRadius instead of kennelRadius, so the badge clears
 * the kennel cluster (and the now-closer-in home markers) instead of sitting on top of it. */
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

/** Same viewport-scale factor TableScene.ts's own pieceScale getter derives from geo - the
 * single conversion every piece/card size (Phaser or DOM) goes through, so a card scales
 * identically wherever it's drawn instead of two independently-tuned scale curves. */
export function pieceScaleFor(geo: BoardGeometry): number {
  return geo.trackRadius / REFERENCE_TRACK_RADIUS;
}

export function allHomeSlots(config: GameConfig, geo: BoardGeometry): { player: PlayerId; slot: number; point: Point }[] {
  const slots: { player: PlayerId; slot: number; point: Point }[] = [];
  for (const player of activePlayerIds(config)) {
    for (let slot = 0; slot < HOME_STRETCH_LENGTH; slot++) {
      slots.push({ player, slot, point: homeSlotPoint(config, player, slot, geo) });
    }
  }
  return slots;
}
