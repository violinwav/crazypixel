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
  homeRadiusOuter: number;
  homeRadiusStep: number;
  stackOffset: number;
  /** Draw/discard piles anchor here - always centered at the bottom of the board area,
   * independent of the ring's own center, rather than sitting inside the ring where a
   * bigger ring (see radiusBoostFor) could crowd or cover them. */
  stackCenter: Point;
}

const REFERENCE_TRACK_RADIUS = 220;
// Deliberately below the original fixed-4-player track length (64) - first pass only
// boosted the ring for 6P and left 4P at its original, unboosted radius, which turned out
// to still read as cramped. Using a lower reference means every config from 4P up gets at
// least some extra room, not just the longest track. Not imported from constants.ts to
// avoid a dependency on player-count details this file otherwise doesn't need.
const REFERENCE_TRACK_LENGTH = 48;
const KENNEL_RATIO = 300 / REFERENCE_TRACK_RADIUS;
const HOME_OUTER_RATIO = 195 / REFERENCE_TRACK_RADIUS;
const HOME_STEP_RATIO = 26 / REFERENCE_TRACK_RADIUS;
// Was 42 - at the card's current 80px width (TableScene.ts's CARD_WIDTH) that left barely
// any gap between the draw and discard piles, closer to touching than two distinct stacks.
const STACK_OFFSET_RATIO = 65 / REFERENCE_TRACK_RADIUS;
// The page title (<h1>) is screen-reader-only now, not rendered - this only needs to clear
// the safe-area/notch, not a visible heading anymore. Was 80px (sized for a visible title
// that no longer exists), which just ate board space for nothing.
const TITLE_MARGIN = 16;

// The current-player glow (see TableScene) is centered on the kennel cluster and extends
// further out than the kennel tiles themselves - without slack, kennels sizing to exactly
// fill the viewport meant the glow (and the outermost kennel marble) clipped the edge.
const EDGE_SAFETY_FACTOR = 0.82;

/** More players means more track squares on the same-shaped ring - a 6P board (96 squares)
 * packed into the same radius as a 4P one (64 squares) leaves each tile visibly less room.
 * Grows the ring a bit for longer tracks (capped, and still clamped to the viewport below)
 * rather than just letting tiles get more cramped as player count goes up. Never shrinks
 * below the original 1x tuning (2P's shorter 32-square track keeps the same radius it
 * already had - it wasn't the one that looked cramped). */
function radiusBoostFor(trackLength: number): number {
  return Math.max(1, Math.min(1.5, Math.sqrt(trackLength / REFERENCE_TRACK_LENGTH)));
}

// Bottom margin for the draw/discard stack anchor - big enough to clear a bigger card
// (see TableScene.ts's CARD_HEIGHT) plus breathing room above the hand panel below it.
const STACK_BOTTOM_MARGIN = 95;

export function computeBoardGeometry(width: number, height: number, trackLength: number = REFERENCE_TRACK_LENGTH): BoardGeometry {
  const center: Point = { x: width / 2, y: height / 2 - 56 };
  // Kennels/goal markers extend beyond the track itself (up to KENNEL_RATIO further out),
  // so size the track off what leaves room for that, not the raw viewport half-size.
  const available = (Math.min(width, Math.max(height - TITLE_MARGIN, 0)) / 2) * EDGE_SAFETY_FACTOR;
  const desiredRadius = REFERENCE_TRACK_RADIUS * radiusBoostFor(trackLength);
  const trackRadius = Math.max(80, Math.min(desiredRadius, available / KENNEL_RATIO));
  const stackCenter: Point = { x: width / 2, y: Math.max(center.y + trackRadius * 0.3, height - STACK_BOTTOM_MARGIN) };
  return {
    center,
    trackRadius,
    kennelRadius: trackRadius * KENNEL_RATIO,
    homeRadiusOuter: trackRadius * HOME_OUTER_RATIO,
    homeRadiusStep: trackRadius * HOME_STEP_RATIO,
    stackOffset: trackRadius * STACK_OFFSET_RATIO,
    stackCenter,
  };
}

function angleForTrackIndex(index: number, trackLength: number): number {
  return (index / trackLength) * Math.PI * 2 - Math.PI / 2;
}

export function trackPoint(index: number, trackLength: number, geo: BoardGeometry): Point {
  const angle = angleForTrackIndex(index, trackLength);
  return { x: geo.center.x + Math.cos(angle) * geo.trackRadius, y: geo.center.y + Math.sin(angle) * geo.trackRadius };
}

export function kennelSlotPoint(config: GameConfig, player: PlayerId, slot: number, geo: BoardGeometry): Point {
  const trackLength = trackLengthFor(config);
  const angle = angleForTrackIndex(startIndexFor(config, player), trackLength) + (slot - (KENNEL_SIZE - 1) / 2) * 0.2;
  return { x: geo.center.x + Math.cos(angle) * geo.kennelRadius, y: geo.center.y + Math.sin(angle) * geo.kennelRadius };
}

export function homeSlotPoint(config: GameConfig, player: PlayerId, slot: number, geo: BoardGeometry): Point {
  const trackLength = trackLengthFor(config);
  const angle = angleForTrackIndex(startIndexFor(config, player), trackLength);
  const radius = geo.homeRadiusOuter - slot * geo.homeRadiusStep;
  return { x: geo.center.x + Math.cos(angle) * radius, y: geo.center.y + Math.sin(angle) * radius };
}

export function drawPileCenter(geo: BoardGeometry): Point {
  return { x: geo.stackCenter.x + geo.stackOffset, y: geo.stackCenter.y };
}

export function discardPileCenter(geo: BoardGeometry): Point {
  return { x: geo.stackCenter.x - geo.stackOffset, y: geo.stackCenter.y };
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
