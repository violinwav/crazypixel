// The board renderer. Holds no game logic: React pushes a GameState in via setGameState()
// (see PhaserGame.ts) and this draws it.
//
// A ring stands in for the real cross-shaped Brändi Dog track until that geometry pass
// happens (see README). All positions come from ../boardLayout so BoardOverlay's accessible
// hit targets stay pixel-aligned with what is drawn here, and so radii scale with the
// viewport instead of being fixed constants. Player count and start positions come from
// state.config; the board grows with more players rather than cramming them onto a fixed ring.
//
// Two things about the lifecycle are load-bearing:
//   - Layout fully recomputes on every Scale Manager 'resize', not once in create(). That
//     covers both the flex-container 0x0-at-boot race (see PhaserGame.ts) and real
//     orientation changes, which a one-shot create() layout can't survive.
//   - Marble sprites persist across renders, keyed by marble id, and tween to their new
//     position on a real state change. A resize-driven re-layout snaps instead (the
//     `animate` parameter): that's a viewport change, not a move.

import Phaser from 'phaser';
import {
  HOME_STRETCH_LENGTH, KENNEL_SIZE, activePlayerIds, isMarbleSettled, startIndexFor, trackLengthFor,
} from '@crazypixel/shared';
import type { GameState, Marble, PlayerId } from '@crazypixel/shared';
import {
  computeBoardGeometry, discardPileCenter, drawPileCenter, homeSlotPoint, kennelSlotPoint,
  pieceScaleFor, trackAngle, trackPoint,
} from '../boardLayout';
import type { BoardGeometry, Point } from '../boardLayout';
import { hueToHex } from '../color';
import { PALETTE } from '../theme';
import { CARD_WIDTH, CARD_HEIGHT, handCardWidthFor } from '../cardArt';
import { EMPTY_TURN_ANIMATION } from '../animationPlan';
import { play as playSound, playStep } from '../audio';
import type { CardDrawAnimation, MarbleAnimation, TurnAnimation } from '../animationPlan';

// --- Pieces and fields ----------------------------------------------------

// Every piece and field on the board is the same diamond - a square stood on its corner - so a
// marble reads as the same shape family as the fields it sits in. All of them are vector paths
// drawn at device resolution (see PhaserGame.ts's fitToParent), never a pixel sprite scaled up,
// because a diagonal edge is exactly what a nearest-neighbour upscale turns into stairs.
//
// Reference px, center to tip. Roughly the area of the 24px chamfered-square sprite this
// replaced, and small enough to nest inside a goal diamond (GOAL_TIP_REACH) with a visible gap.
const MARBLE_REACH = 15;
// The rim is what separates a marble from the light quarter tiles, where no pastel facet
// clears 3:1 on its own - and a thinner diagonal line antialiases away to well under that.
const MARBLE_RIM = 2;
const MARBLE_MIN_RIM = 1.5;
// The flat top of the cut, as a fraction of the reach inside the rim. The four bevels run from
// its edges out to the rim.
const MARBLE_TABLE_RATIO = 0.42;
// Bevel shading per facet, clockwise from the top-right one (the facet between the N and E
// tips), lit from the top left: positive mixes toward white, negative toward black. The bevel
// comes mostly from the lit side: the darkest facet of the darkest pastel (hue 240) has to keep
// 3:1 against the black board and the dark track tile, which caps the shadow side near -0.2 -
// at -0.38 it measured 2.6:1.
const MARBLE_FACET_SHADES = [0.2, -0.2, -0.08, 0.5];
// A small sparkle on the lit facet - what makes it read as a cut stone rather than a pyramid.
const MARBLE_GLINT_RATIO = 0.13;
const MARBLE_GLINT_ALPHA = 0.9;
// Kennel fields: a socket a little larger than a marble, which the piece visibly drops into.
// Same reach as a goal diamond, so the two kinds of field read as one size.
const KENNEL_FIELD_REACH = 19;
const KENNEL_FIELD_BORDER = 2;
// Matches generate-sprites.py's PALETTE['marble_border'] - the outline every marble carries,
// reused so a field's border reads as the same ink.
const MARBLE_BORDER_COLOR = 0x0a080a;
// Track tiles render at a fixed sprite size but their *count* scales with player count, so at
// native size they touch or overlap. TRACK_TILE_GAP shrinks every tile for a universal small
// gap; the REFERENCE_TRACK_LENGTH factor shrinks them further on a longer track, since
// radiusBoostFor (boardLayout.ts) only grows the ring so far before the viewport clamp takes
// over - the two adjustments meet in the middle rather than one doing all the work.
const TRACK_TILE_GAP = 0.68;
// Deliberately duplicated from boardLayout.ts, which keeps itself free of player-count
// details. Below the original 4-player length so 4P gets some shrink too, not just 6P.
const REFERENCE_TRACK_LENGTH = 48;

// --- Base-guard reticle ---------------------------------------------------
// Four corner brackets framing a marble that is still protected on the start square it
// entered on (marble.startProtected). Deliberately a frame and not a glow or a pulse: it
// marks a *rule*, not an event, it sits still for as long as the rule holds, and it has to
// stay legible with four marbles clustered on adjacent squares.
//
// Reference px, scaled by pieceScale like every other piece dimension here. The half-extent
// clears the marble's tips (MARBLE_REACH) along the axes; the brackets sit at the corners, well
// off the diamond's sloped edges.
const GUARD_HALF_EXTENT = 16;
const GUARD_ARM = 8;
const GUARD_WEIGHT = 3;
/**
 * Drawn as a dark edge around a white core, and the reason is the *neighbouring* marbles, not
 * the tile underneath: this frame reaches 16 reference px from its marble's center while
 * adjacent track squares sit ~22 (4P) to ~14 (6P) reference px apart, so on a busy ring it
 * paints straight over the marble next door - and guardLayer is above marbleLayer, so it is
 * always the bracket on top. No single flat ink survives that. White alone is 1.18:1 on the
 * lightest marble facet; the darkest marble tone rules out every grey bright enough to clear
 * 3:1 on the black board field. White core plus a MARBLE_BORDER_COLOR edge always leaves one
 * of the two tones at 4.5:1 or better against anything the board can put behind it.
 *
 * (It does NOT cross the white start tile - that tile's half-extent is ~5.6 reference px,
 * well inside where the brackets begin. Don't "fix" GUARD_HALF_EXTENT on that theory.)
 */
const GUARD_OUTLINE = 1;
// CSS-px floors. pieceScale bottoms out near 0.48 on a 360px-wide phone, which turns an
// 8/3/1 reference bracket into 3.8/1.4/0.5 px - four specks rather than a frame.
const GUARD_MIN_ARM = 5;
const GUARD_MIN_WEIGHT = 2;

// --- Goal-slot diamond ----------------------------------------------------
// Reference px. Reach is center-to-tip, sized so the diamond outlines a whole marble: 19 clears
// the marble's own tips (MARBLE_REACH) with room for the stroke, so a marble in its goal slot
// sits as a diamond nested in a diamond. boardLayout.ts's 45px slot step leaves 7px between
// neighbouring tips. Arm is each
// chevron leg's length along the ~27px edge, under a third of it, so the four tips read as
// separate marks around an open center.
const GOAL_TIP_REACH = 19;
const GOAL_TIP_ARM = 8;
const GOAL_WEIGHT = 2;
const GOAL_MIN_WEIGHT = 1.5;
// An open goal slot is a hint of where to go, not a finished thing, so it sits back at partial
// strength. Full color is saved for a settled marble's closed diamond (updateSettled), so
// "done, never moving again" is the loudest state a goal slot can be in.
const GOAL_OPEN_ALPHA = 0.4;

// --- Motion ---------------------------------------------------------------

const MOVE_TWEEN_MS = 220;
const POP_IN_MS = 250;
const WALK_STEP_MS = 55;

// --- Marble trail ---------------------------------------------------------
// Every square a walking marble passes through drops a marker in that marble's own color,
// and a matching segment of border line just outside the ring. Held at full strength first
// and only then faded, so the *whole* path stays readable for a beat after the marble has
// arrived - online especially, where another player's move is the only thing that happens on
// your screen. HOLD alone exceeds a 13-square walk (13 * WALK_STEP_MS = 715ms), so even the
// longest move is fully on screen before anything starts disappearing.
const TRAIL_HOLD_MS = 750;
const TRAIL_FADE_MS = 900;
// Deliberately faint: at full opacity a trail square in the marble's own color reads as a
// second marble parked on that tile, which is exactly the misread this is meant to avoid. It
// has to say "something passed through here", never "someone is here".
const TRAIL_ALPHA = 0.6;
// Smaller than a marble, so a marker reads as a footprint and the tile still shows around it.
// Fraction of the marble's tip-to-tip width.
const TRAIL_SIZE_RATIO = 0.72;
// A chamfered square, deliberately NOT the marble's diamond: a faint diamond in the marble's
// own color is one outline away from the "second marble" misread TRAIL_ALPHA guards against.
const TRAIL_CHAMFER_RATIO = 7 / 22;
// The border line sits in the empty band between the track ring (1.0) and the kennels
// (KENNEL_RATIO, ~1.18), so it crowds neither.
const TRAIL_ARC_RATIO = 1.09;
// Reference px (scaled by pieceScale) for both the line's thickness and the spacing of the
// squares it's built from - a chain of small squares, not a stroked arc, so the border shares
// the pixel vocabulary of the tiles it runs alongside.
const TRAIL_ARC_PIXEL = 5;
// Its own alpha: a thin line reads fainter than a filled square at the same opacity, and
// unlike the square markers it can't be mistaken for a marble.
const TRAIL_ARC_ALPHA = 0.55;

// --- Dither effects -------------------------------------------------------
// Two effects share one grid, one clock and one canvas texture: the turn-change reveal and
// the capture flash. Cell size, Bayer matrix, noise function and alpha banding are
// numerically identical to PixelDither.tsx's `vivid` mode - duplicated rather than imported
// (that file is a React component, and this project duplicates small per-file-tuned
// constants on purpose), so this genuinely reads as the same dither, just windowed, colored
// and local.
const TURN_GLOW_CELL = 8;
// Of geo.trackRadius, not fixed px - the reveal tracks the kennel cluster's scale even though
// the grid it samples stays fixed. Deliberately generous: the hard ring cutoff in
// drawGlowLayer trims whatever would dip past the ring inward, while the outward and lateral
// sides stay a full soft circle.
const TURN_GLOW_RADIUS_RATIO = 0.42;
// Inside this fraction of the radius the dither stays full strength; beyond it alpha ramps to
// 0 at the rim - "a circle with faded borders", not a gradient from the center out.
const TURN_GLOW_CORE_RATIO = 0.55;
// Crossfade when the reveal moves to a new player: fade one out, fade the next in.
const TURN_GLOW_FADE_MS = 500;
const TURN_GLOW_BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const TURN_GLOW_LEVELS = [0.08, 0.2, 0.32, 0.46, 0.6];
// The capture flash: a ring that travels outward and fades as it grows, rather than a static
// reveal. Bigger, slower and brighter than the turn glow on purpose, so it doesn't share
// those constants.
const KILL_WAVE_DURATION_MS = 950;
const KILL_WAVE_RADIUS_RATIO = 0.75;
const KILL_WAVE_THICKNESS = TURN_GLOW_CELL * 5;
const KILL_WAVE_LEVELS = [0.15, 0.35, 0.55, 0.8, 1];

function turnGlowNoise(cx: number, cy: number, t: number): number {
  const a = Math.sin(cx * 0.12 + t) * Math.sin(cy * 0.1 - t * 0.7);
  const b = Math.sin((cx + cy) * 0.05 - t * 0.4);
  return (a * 0.6 + b * 0.4 + 1) * 0.5;
}

/**
 * Quantizes noise into one of `levels`' discrete alpha bands, Bayer-dithering the boundary
 * between two bands so it doesn't land on a hard edge. The kill wave passes its own brighter
 * levels rather than a flat multiplier on top, which would need its own clamp back down.
 */
function turnGlowBand(v: number, cx: number, cy: number, levels: number[] = TURN_GLOW_LEVELS): number {
  const scaled = v * levels.length;
  const base = Math.floor(scaled);
  const frac = scaled - base;
  const bayerThreshold = TURN_GLOW_BAYER[cy % 4][cx % 4] / 16;
  const level = frac > bayerThreshold ? base + 1 : base;
  return levels[Math.max(0, Math.min(levels.length - 1, level))];
}

/**
 * Four corner brackets framing a square of half-extent `halfRef` (reference px) centered on
 * (cx, cy): a `core`-colored L per corner with a MARBLE_BORDER_COLOR edge. Shared by the
 * base-guard reticle and the goal slots so both read as the same mark.
 *
 * Every dimension is rounded to whole pixels, and so is the center. Phaser's `pixelArt: true`
 * only turns off smoothing for drawImage - a Graphics fillRect is a real Canvas2D path and
 * antialiases on fractional coordinates regardless. That matters most for the guard reticle:
 * a 1px dark edge split across two rows renders at roughly half alpha, and over a light
 * marble the blend lands around 2.5:1 - failing exactly when the frame overlaps a neighbour,
 * which is the case the dark edge exists for.
 */
function drawCornerBrackets(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  halfRef: number,
  scale: number,
  core: number,
) {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const half = Math.round(halfRef * scale);
  const arm = Math.round(Math.max(GUARD_MIN_ARM, GUARD_ARM * scale));
  const weight = Math.round(Math.max(GUARD_MIN_WEIGHT, GUARD_WEIGHT * scale));
  const outline = Math.round(Math.max(1, GUARD_OUTLINE * scale));

  // Each corner is one horizontal and one vertical arm sharing an outer corner pixel.
  const arms: [number, number, number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const [w, h] of [[arm, weight], [weight, arm]] as const) {
        arms.push([x0 + (sx > 0 ? half - w : -half), y0 + (sy > 0 ? half - h : -half), w, h]);
      }
    }
  }

  // Every outline first, then every core - not outline-then-core per arm. Drawn per arm, the
  // second arm's outline paints a dark seam straight through the corner the two share, and
  // the bracket reads as two detached ticks instead of one L.
  g.fillStyle(MARBLE_BORDER_COLOR, 1);
  for (const [x, y, w, h] of arms) g.fillRect(x - outline, y - outline, w + outline * 2, h + outline * 2);
  g.fillStyle(core, 1);
  for (const [x, y, w, h] of arms) g.fillRect(x, y, w, h);
}

/**
 * A goal slot: four chevron tips of a diamond, one per compass point, with open gaps between
 * them - or, `closed`, the full diamond outline with the gaps joined up. Stroked lines rather
 * than the guard's filled rects - a filled rect only stays crisp axis-aligned, and rotated it
 * breaks into a muddy staircase. No dark edge either: it sits under the marbles, so nothing
 * ever overlaps it the way the guard reticle can.
 */
function drawGoalDiamond(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  scale: number,
  color: number,
  { alpha = 1, closed = false } = {},
) {
  const tips = diamondTips(Math.round(cx), Math.round(cy), GOAL_TIP_REACH * scale);
  g.lineStyle(Math.max(GOAL_MIN_WEIGHT, GOAL_WEIGHT * scale), color, alpha);
  if (closed) {
    g.beginPath();
    g.moveTo(tips[0].x, tips[0].y);
    for (const tip of tips.slice(1)) g.lineTo(tip.x, tip.y);
    g.closePath();
    g.strokePath();
    return;
  }
  // Fraction of the way from a tip toward each neighbouring tip - the rest is the gap.
  const t = GOAL_TIP_ARM / (GOAL_TIP_REACH * Math.SQRT2);
  tips.forEach((tip, i) => {
    const prev = tips[(i + 3) % 4];
    const next = tips[(i + 1) % 4];
    g.beginPath();
    g.moveTo(tip.x + (prev.x - tip.x) * t, tip.y + (prev.y - tip.y) * t);
    g.lineTo(tip.x, tip.y);
    g.lineTo(tip.x + (next.x - tip.x) * t, tip.y + (next.y - tip.y) * t);
    g.strokePath();
  });
}

/**
 * Points for a chamfered square of side `size`, in the same top-left-origin 0..size space
 * Phaser's built-in Rectangle/Circle shapes use - `add.polygon(x, y, points)` then centers
 * them on (x, y) via its display origin. Points centered on the origin instead look right in
 * isolation but draw offset by half the shape's size once Phaser's origin math subtracts
 * displayOrigin a second time.
 */
function chamferedSquarePoints(size: number, cutRatio: number): { x: number; y: number }[] {
  const cut = size * cutRatio;
  return [
    { x: cut, y: 0 },
    { x: size - cut, y: 0 },
    { x: size, y: cut },
    { x: size, y: size - cut },
    { x: size - cut, y: size },
    { x: cut, y: size },
    { x: 0, y: size - cut },
    { x: 0, y: cut },
  ];
}

/** A diamond's four tips around (cx, cy), clockwise from the top: N, E, S, W. */
function diamondTips(cx: number, cy: number, reach: number): Point[] {
  return [
    { x: cx, y: cy - reach },
    { x: cx + reach, y: cy },
    { x: cx, y: cy + reach },
    { x: cx - reach, y: cy },
  ];
}

/** `color` mixed toward white (amount > 0) or black (amount < 0), as a CSS color. */
function shadeCss(color: number, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  const channel = (shift: number) => Math.round(((color >> shift) & 0xff) * (1 - t) + target * t);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/**
 * Paints a cut-stone marble centered on (c, c) of a raw 2D context, in the context's own
 * units: a dark rim, four bevels shaded by MARBLE_FACET_SHADES, a flat table and a glint.
 *
 * The body is filled in the base color before the bevels go on top. Each bevel's edge is
 * antialiased on its own, so two bevels meeting leave a faint seam of whatever sits beneath
 * them - over the base coat that seam is the marble's own color, where over the rim it would be
 * a dark hairline down every join.
 */
function paintMarble(ctx: CanvasRenderingContext2D, c: number, reach: number, rim: number, color: number) {
  const fill = (points: Point[], style: string) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    points.forEach(({ x, y }, i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fill();
  };
  // A rim of perpendicular width `rim` takes rim * sqrt(2) off a diamond's reach.
  const bodyReach = reach - rim * Math.SQRT2;
  const body = diamondTips(c, c, bodyReach);
  const table = diamondTips(c, c, bodyReach * MARBLE_TABLE_RATIO);

  fill(diamondTips(c, c, reach), shadeCss(MARBLE_BORDER_COLOR, 0));
  fill(body, shadeCss(color, 0));
  MARBLE_FACET_SHADES.forEach((shade, i) => {
    const j = (i + 1) % 4;
    fill([body[i], body[j], table[j], table[i]], shadeCss(color, shade));
  });
  fill(table, shadeCss(color, 0));
  // Centered on the lit (NW) bevel, halfway between the table's edge and the rim.
  const glintOffset = (bodyReach * (1 + MARBLE_TABLE_RATIO)) / 4;
  ctx.globalAlpha = MARBLE_GLINT_ALPHA;
  fill(diamondTips(c - glintOffset, c - glintOffset, bodyReach * MARBLE_GLINT_RATIO), '#ffffff');
  ctx.globalAlpha = 1;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class TableScene extends Phaser.Scene {
  private state: GameState | null = null;

  private glowLayer?: Phaser.GameObjects.Container;
  /**
   * The offscreen canvas drawGlowLayer paints into every frame - a live-updating
   * CanvasTexture with refresh(), not a new canvas per frame. Sized to the whole board, so
   * every reveal and kill wave samples one shared surface rather than its own.
   */
  private glowTexture?: Phaser.Textures.CanvasTexture;
  private glowImage?: Phaser.GameObjects.Image;
  private glowTime = 0;
  /** Usually one entry (the current player), briefly two during a crossfade. */
  private glowReveals: { player: PlayerId; alpha: number }[] = [];
  /**
   * Lets syncTurnGlow tell "still this player's turn, just re-rendering" apart from a real
   * turn change - setGameState fires on every move, and a 7-split plays several moves in one
   * turn, so re-triggering the crossfade on every render would restart it constantly.
   */
  private lastGlowPlayer: PlayerId | null = null;
  /**
   * One expanding ring per captured marble. x/y is where that marble was at the moment of
   * capture, so the ring stays put while the marble itself walks home.
   */
  private killWaves: { x: number; y: number; progress: number }[] = [];

  private boardLayer?: Phaser.GameObjects.Container;
  /**
   * Closed goal diamonds for settled marbles. Just above boardLayer so a closed outline paints
   * over the open chevrons it completes, and below the marbles like every other field mark.
   */
  private settledLayer?: Phaser.GameObjects.Container;
  private decorLayer?: Phaser.GameObjects.Container;
  /**
   * Fading path markers. Its own container because, unlike the layers above, it is never
   * bulk-cleared on a render: each marker owns its lifetime via its own fade tween and
   * outlives the render that spawned it.
   */
  private trailLayer?: Phaser.GameObjects.Container;
  private marbleLayer?: Phaser.GameObjects.Container;
  /**
   * Base-guard reticles. Above the marbles rather than below: the brackets sit outside a
   * marble's silhouette, so nothing is hidden either way, and drawing on top guarantees the
   * frame is never clipped by a neighbouring piece.
   */
  private guardLayer?: Phaser.GameObjects.Container;

  private geo: BoardGeometry = {
    center: { x: 0, y: 0 },
    trackRadius: 0,
    kennelRadius: 0,
    handCountRadius: 0,
    homeRadiusOuter: 0,
    homeRadiusStep: 0,
    stackOffset: 0,
    stackCenter: { x: 0, y: 0 },
    rotation: 0,
  };
  private marbleSprites = new Map<string, Phaser.GameObjects.Image>();
  /** marble id -> its reticle, for the marbles currently carrying start protection. */
  private guardMarks = new Map<string, Phaser.GameObjects.Graphics>();
  /** marble id -> the closed goal diamond under it, for every settled marble (isMarbleSettled). */
  private settledMarks = new Map<string, Phaser.GameObjects.Graphics>();
  /** Every texture marbleTextureKey has generated and not yet released. */
  private marbleTextureKeys = new Set<string>();
  private pendingPlan: MarbleAnimation[] = [];
  private pendingCaptures: string[] = [];
  /**
   * Seat -> hue (0-359) from the color picker, spread evenly around the wheel until set.
   * Converted through hueToHex, never a lookup into a fixed palette - color is continuous.
   */
  private colorAssignment: number[] = [0, 60, 120, 180, 240, 300];
  /**
   * Whose base renders at the bottom of the ring (see BoardGeometry.rotation). Updated every
   * render, unlike colorAssignment, since local hotseat re-rotates to face whoever is acting.
   */
  private viewerSeat: PlayerId = 0;

  constructor() {
    super('TableScene');
  }

  preload() {
    this.load.image('tile-track', '/sprites/tile-track.png');
    this.load.image('tile-start', '/sprites/tile-start.png');
    this.load.image('tile-quarter', '/sprites/tile-quarter.png');
    // Only the card back: the discard pile's face-up card is a real DOM .playing-card now
    // (see LaidCard.tsx), so no card-face textures are needed here.
    this.load.image('card-back', '/sprites/card-back.png');
  }

  create() {
    // Zoomed from the top-left corner (layout sets the zoom), so scene coordinates stay the
    // CSS pixels boardLayout and BoardOverlay work in while the canvas itself is device pixels.
    this.cameras.main.setOrigin(0, 0);
    // Added before boardLayer: Phaser draws containers in add-order, so the glow paints
    // first and the board's tiles paint over it, showing only past a tile's edges. A DOM
    // layer behind the canvas can't do this - the Game config sets a backgroundColor with no
    // `transparent: true`, so this canvas paints fully opaque every frame and nothing behind
    // it in the DOM ever shows through, at any z-index.
    this.glowLayer = this.add.container(0, 0);
    // 1x1 placeholder: the real size isn't known until the first drawGlowLayer call, since
    // this.scale is frequently still 0x0 at this instant (the same boot race PhaserGame.ts
    // polls around).
    this.glowTexture = this.textures.createCanvas('turn-glow', 1, 1) ?? undefined;
    this.glowImage = this.add.image(0, 0, 'turn-glow').setOrigin(0, 0);
    this.glowLayer.add(this.glowImage);
    this.boardLayer = this.add.container(0, 0);
    this.settledLayer = this.add.container(0, 0);
    this.decorLayer = this.add.container(0, 0);
    // Between board and marbles in draw order: a trail marker paints over the track tile it
    // marks, and the marble paints over its own trail.
    this.trailLayer = this.add.container(0, 0);
    this.marbleLayer = this.add.container(0, 0);
    this.guardLayer = this.add.container(0, 0);

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  // --- Inputs from React --------------------------------------------------

  setGameState(state: GameState, plan: TurnAnimation = EMPTY_TURN_ANIMATION) {
    this.state = state;
    this.pendingPlan = plan.marbles;
    this.pendingCaptures = plan.capturedMarbleIds;
    if (this.marbleLayer) this.renderPieces(true);
    // Not routed through renderPieces like marble walks: this is a one-shot transient with
    // no persistent sprite to reconcile, so it fires once per real move and is never replayed
    // by a resize-driven re-layout.
    if (this.geo.trackRadius > 0) this.playCardDraws(plan.draws);
  }

  /** One-time call from the color picker - colors can't change mid-game. */
  setColorAssignment(colors: number[]) {
    this.colorAssignment = colors;
  }

  /**
   * Called every render, unlike colors: the viewer seat can legitimately change turn to turn
   * (local hotseat rotates to face whoever is acting). Doesn't itself trigger a re-layout;
   * relies on setGameState/layout running afterward in the same tick.
   */
  setViewerSeat(seat: PlayerId) {
    this.viewerSeat = seat;
  }

  // --- Layout -------------------------------------------------------------

  private get pieceScale(): number {
    return pieceScaleFor(this.geo);
  }

  /** Device pixels per CSS pixel - PhaserGame.ts's fitToParent zooms the canvas by its inverse. */
  private get pixelRatio(): number {
    return 1 / this.scale.zoom;
  }

  /**
   * The canvas's CSS size, which is what every position here is in. this.scale.width/height
   * are the device-pixel backing store (see fitToParent) and never the right thing to lay out
   * against.
   */
  private get viewWidth(): number {
    return this.scale.width * this.scale.zoom;
  }

  private get viewHeight(): number {
    return this.scale.height * this.scale.zoom;
  }

  /**
   * The draw/discard pile's card width, synced to the real DOM hand card rather than
   * pieceScale: on a narrow phone the hand shrinks well before the board's trackRadius-
   * relative scale does, and the pile has to shrink with it. viewWidth is the same CSS-pixel
   * container width GameBoard.tsx measures - fitToParent keeps the canvas synced to that
   * parent element.
   */
  private get pileCardWidth(): number {
    return handCardWidthFor(this.viewWidth);
  }

  private layout() {
    this.cameras.main.setZoom(this.pixelRatio);
    // Trail markers live in screen space, so a resize (or a hotseat rotation snap) leaves
    // them pointing at squares that have moved out from under them. Drop them rather than
    // re-deriving positions for a decoration that's about to fade out anyway.
    this.clearTrail();
    this.renderPieces(false); // a re-layout is not a game move - snap, don't tween
  }

  private renderPieces(animate: boolean) {
    if (!this.state || !this.marbleLayer) return;
    const width = this.viewWidth;
    const height = this.viewHeight;
    if (width === 0 || height === 0) return; // nothing sensible to draw against yet
    // Geometry depends on state.config, which isn't known until the first real setGameState
    // call and never changes afterward for a given scene instance - so recomputing here
    // every render is cheap redundancy, not a bug.
    this.geo = computeBoardGeometry(width, height, trackLengthFor(this.state.config), this.viewerSeat, this.state.config.playerCount);
    this.syncTurnGlow();
    this.redrawBoard();
    this.updateMarbles(animate);
    this.updateSettled(animate);
    this.updateGuards(animate);
    this.updateDecor();
  }

  private marblePoint(marble: Marble) {
    const config = this.state!.config;
    if (marble.location.zone === 'track') {
      return trackPoint(marble.location.index, trackLengthFor(config), this.geo);
    }
    if (marble.location.zone === 'kennel') {
      return kennelSlotPoint(config, marble.owner, marble.location.index, this.geo);
    }
    return homeSlotPoint(config, marble.owner, marble.location.index, this.geo);
  }

  /** Redrawn wholesale each render - cheap for a turn-based game, and simpler than tracking
   * whether config or colors actually changed. */
  private redrawBoard() {
    if (!this.boardLayer || !this.state) return;
    const config = this.state.config;
    const trackLength = trackLengthFor(config);
    const players = activePlayerIds(config);
    this.boardLayer.removeAll(true);
    const trackTileScale = this.pieceScale * TRACK_TILE_GAP * Math.min(1, REFERENCE_TRACK_LENGTH / trackLength);

    for (let i = 0; i < trackLength; i++) {
      const { x, y } = trackPoint(i, trackLength, this.geo);
      const isStart = players.some((p) => startIndexFor(config, p) === i);
      // Every 4th square gets a distinct tile, so the ring reads as countable segments
      // rather than one undifferentiated loop of dots.
      const isQuarter = !isStart && i % 4 === 0;
      const key = isStart ? 'tile-start' : isQuarter ? 'tile-quarter' : 'tile-track';
      this.boardLayer.add(this.add.image(x, y, key).setScale(trackTileScale));
    }

    const kennelFields = this.add.graphics();
    kennelFields.fillStyle(PALETTE.bgRaised, 1);
    kennelFields.lineStyle(KENNEL_FIELD_BORDER, MARBLE_BORDER_COLOR, 1);
    this.boardLayer.add(kennelFields);

    players.forEach((player) => {
      // Kennel: a black-bordered diamond socket a little larger than a marble, so the piece
      // visibly sits inside it.
      for (let slot = 0; slot < KENNEL_SIZE; slot++) {
        const { x, y } = kennelSlotPoint(config, player, slot, this.geo);
        const tips = diamondTips(Math.round(x), Math.round(y), KENNEL_FIELD_REACH * this.pieceScale);
        kennelFields.fillPoints(tips, true);
        // closePath as well as closeShape: without it the top tip is two butt-capped line ends
        // meeting, not a mitred corner, and shows a notch.
        kennelFields.strokePoints(tips, true, true);
      }
      // Goal slots: the base-guard's corner brackets turned 45deg into a diamond, in the
      // owner's color at partial strength. Brackets rather than a filled field so an occupied
      // slot never hides the marble in it, and the color alone marks whose goal it is - "where
      // do I need to get to" at a glance. One Graphics per player: these never move or animate
      // individually. A settled marble's slot is closed over this by updateSettled.
      const goalMarks = this.add.graphics();
      const color = hueToHex(this.colorAssignment[player]);
      for (let slot = 0; slot < HOME_STRETCH_LENGTH; slot++) {
        const { x, y } = homeSlotPoint(config, player, slot, this.geo);
        drawGoalDiamond(goalMarks, x, y, this.pieceScale, color, { alpha: GOAL_OPEN_ALPHA });
      }
      this.boardLayer!.add(goalMarks);
    });
  }

  // --- Marbles ------------------------------------------------------------

  /**
   * A marble texture for `hue` at the current on-screen size: paintMarble's vector cut stone,
   * painted straight onto a canvas at device resolution and registered as its own texture.
   *
   * Painted per size rather than once and scaled, because scaling is what stepped the old
   * pixel sprite's edges. This one is drawn texel-for-pixel - updateMarbles snaps every marble
   * center onto the device pixel grid to match - so its antialiased edges reach the screen
   * untouched. LINEAR covers the moments it isn't 1:1 (a pop-in scale tween), where the
   * pixelArt default of NEAREST would step the edges all over again.
   *
   * Color is painted in rather than tinted on: Image.setTint is a no-op under this project's
   * Phaser.CANVAS renderer (confirmed by pixel sampling - marbles rendered plain grey with
   * setTint applied).
   */
  private marbleTexture(hue: number): { key: string; displaySize: number } {
    const ratio = this.pixelRatio;
    const reach = MARBLE_REACH * this.pieceScale;
    // Even, so the texture's center falls on a pixel corner, where a snapped marble center
    // does. The extra pixel per side is room for the rim's antialiasing.
    const size = 2 * Math.ceil(reach * ratio + 1);
    const key = `marble-${hue}-${size}`;
    if (!this.textures.exists(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(ratio, ratio);
      const rim = Math.max(MARBLE_MIN_RIM, MARBLE_RIM * this.pieceScale);
      paintMarble(ctx, size / 2 / ratio, reach, rim, hueToHex(hue));
      this.textures.addCanvas(key, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.marbleTextureKeys.add(key);
    }
    return { key, displaySize: size / ratio };
  }

  /** Rounds a CSS-pixel coordinate onto the device pixel grid - see marbleTexture. */
  private snapToPixel(v: number): number {
    return Math.round(v * this.pixelRatio) / this.pixelRatio;
  }

  private updateMarbles(animate: boolean) {
    const usedTextures = new Set<string>();
    const planByMarble = new Map(this.pendingPlan.map((p) => [p.marbleId, p]));
    const capturedIds = new Set(this.pendingCaptures);
    // A captured marble doesn't start its trip to kennel until whatever captured it has
    // arrived - firing both at once read as two simultaneous moves rather than one causing
    // the other. A startMarble capture has no MarbleAnimation entry at all (the starting
    // marble pops over via the plain-tween fallback below), so this can't default to 0
    // whenever there's a capture with nothing else planned.
    let captureDelay = this.pendingCaptures.length > 0 ? MOVE_TWEEN_MS : 0;
    for (const planned of this.pendingPlan) {
      const duration = planned.kind === 'walk'
        ? (planned.trackIndices.length + (planned.entersHomeSlot !== null ? 1 : 0)) * WALK_STEP_MS
        : MOVE_TWEEN_MS;
      captureDelay = Math.max(captureDelay, duration);
    }
    // A player with an empty hand has laid down for the rest of the round (passHand), so all
    // of their marbles dim wherever they sit - kennel, track or home. Scoping this to kennel
    // marbles alone missed the common case: a player with pieces already out when their hand
    // empties.
    const passedOwners = new Set(activePlayerIds(this.state!.config).filter((p) => this.state!.hands[p].length === 0));
    const seen = new Set<string>();

    for (const marble of this.state!.marbles) {
      seen.add(marble.id);
      const point = this.marblePoint(marble);
      const x = this.snapToPixel(point.x);
      const y = this.snapToPixel(point.y);
      const existing = this.marbleSprites.get(marble.id);
      const alpha = passedOwners.has(marble.owner) ? 0.65 : 1;
      const { key, displaySize } = this.marbleTexture(this.colorAssignment[marble.owner]);
      usedTextures.add(key);

      if (!existing) {
        const sprite = this.add.image(x, y, key)
          .setDisplaySize(displaySize, displaySize)
          .setAlpha(alpha);
        this.marbleLayer!.add(sprite);
        this.marbleSprites.set(marble.id, sprite);
        if (animate) {
          const targetScale = sprite.scaleX;
          sprite.setScale(0);
          this.tweens.add({ targets: sprite, scaleX: targetScale, scaleY: targetScale, duration: POP_IN_MS, ease: 'Back.easeOut' });
        }
        continue;
      }

      existing.setTexture(key).setDisplaySize(displaySize, displaySize);
      existing.setAlpha(alpha);
      // Unconditional on a re-layout, not only when the marble moved: a pixel-ratio change can
      // leave a marble on the same CSS pixel but off the new device grid.
      if (!animate) {
        existing.setPosition(x, y);
        continue;
      }
      const moved = Math.round(existing.x) !== Math.round(x) || Math.round(existing.y) !== Math.round(y);
      if (!moved) continue;

      const planned = planByMarble.get(marble.id);
      if (planned?.kind === 'walk' && (planned.trackIndices.length > 0 || planned.entersHomeSlot !== null)) {
        this.walkMarble(existing, marble.owner, planned);
        continue;
      }

      // No plan entry (a marble captured mid-path) or an explicit teleport (a Jack swap) -
      // a plain tween either way. existing.x/y here is still the pre-move position, i.e.
      // exactly where a captured marble was sent home from, and the shared delay keeps the
      // flash in sync with the moment it actually departs.
      const captured = capturedIds.has(marble.id);
      const delay = captured ? captureDelay : 0;
      if (captured) {
        this.spawnKillWave(existing.x, existing.y, delay);
        // Fired on the same delay as the wave and the trip home, NOT when the move committed.
        // captureDelay is up to a full 13-square walk (~715ms), so a sound played at commit
        // time landed most of a second before the marble visibly died - which reads as a random
        // noise, not as a capture. The sound has to be where the picture is.
        this.time.delayedCall(delay, () => playSound('kill'));
      }
      this.tweens.add({ targets: existing, x, y, duration: MOVE_TWEEN_MS, ease: 'Cubic.easeInOut', delay });
    }

    // Marbles never leave state.marbles (a fixed set per game, they only change zone) - this
    // prune is defensive, in case that ever changes.
    for (const [id, sprite] of this.marbleSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.marbleSprites.delete(id);
      }
    }

    // Every marble was just switched to a texture at the current size, so any other size's
    // textures (left over from before a resize) are no longer drawn by anything.
    for (const key of this.marbleTextureKeys) {
      if (usedTextures.has(key)) continue;
      this.textures.remove(key);
      this.marbleTextureKeys.delete(key);
    }
  }

  // --- Settled goal slots ------------------------------------------------

  /**
   * Closes the goal diamond under every settled marble - one that has reached the deepest
   * home slot still open to it (isMarbleSettled) and so will never move again - at full
   * color, over the partial-strength open chevrons redrawBoard leaves on every goal slot.
   *
   * Like the guard reticle, a settled marble is stationary for good, so a mark never has to
   * follow a tween; it only has to wait for its marble to arrive. Redrawn every render, since
   * pieceScale changes on a resize and a Graphics object bakes its path in at draw time.
   */
  private updateSettled(animate: boolean) {
    if (!this.settledLayer || !this.state) return;
    const settled = this.state.marbles.filter((m) => isMarbleSettled(this.state!, m));
    const settledIds = new Set(settled.map((m) => m.id));

    // Only a new game (rematch) ever unsettles a marble, but that has to clear these too.
    for (const [id, mark] of this.settledMarks) {
      if (settledIds.has(id)) continue;
      this.tweens.killTweensOf(mark);
      mark.destroy();
      this.settledMarks.delete(id);
    }

    const planByMarble = new Map(this.pendingPlan.map((p) => [p.marbleId, p]));
    for (const marble of settled) {
      const { x, y } = this.marblePoint(marble);
      const existing = this.settledMarks.get(marble.id);
      const mark = existing ?? this.add.graphics();
      mark.clear();
      drawGoalDiamond(mark, 0, 0, this.pieceScale, hueToHex(this.colorAssignment[marble.owner]), { closed: true });
      mark.setPosition(Math.round(x), Math.round(y));
      if (existing) continue;
      this.settledLayer.add(mark);
      this.settledMarks.set(marble.id, mark);
      if (!animate) continue;
      // Closes the moment the marble lands, not when the move commits - the same arrival
      // timing updateMarbles uses. Online plays arrive with no plan (see GameBoard's
      // lastPlanRef), so those fall back to the plain tween's duration.
      const planned = planByMarble.get(marble.id);
      const arrival = planned?.kind === 'walk'
        ? (planned.trackIndices.length + (planned.entersHomeSlot !== null ? 1 : 0)) * WALK_STEP_MS
        : MOVE_TWEEN_MS;
      mark.setAlpha(0);
      // theme.css's blanket prefers-reduced-motion rule only reaches CSS - a Phaser tween has
      // to ask for itself.
      if (prefersReducedMotion()) {
        this.time.delayedCall(arrival, () => mark.setAlpha(1));
      } else {
        this.tweens.add({ targets: mark, alpha: 1, duration: MOVE_TWEEN_MS, delay: arrival });
      }
    }
  }

  // --- Base-guard reticle -------------------------------------------------

  /**
   * Frames every marble still protected on the square it entered on, and unframes the rest.
   *
   * A protected marble is stationary by definition - the rule ends the moment that marble
   * moves - so a reticle never has to follow a tween. It only has to appear after the marble
   * it frames has arrived, which is what the delay on the fade-in below is for.
   *
   * Geometry is re-drawn rather than just re-positioned, because pieceScale changes on a
   * resize and a Graphics object bakes its path in at draw time.
   */
  private updateGuards(animate: boolean) {
    if (!this.guardLayer || !this.state) return;
    const guarded = new Set(this.state.marbles.filter((m) => m.startProtected).map((m) => m.id));

    for (const [id, mark] of this.guardMarks) {
      if (guarded.has(id)) continue;
      this.tweens.killTweensOf(mark);
      mark.destroy();
      this.guardMarks.delete(id);
    }

    for (const marble of this.state.marbles) {
      if (!marble.startProtected) continue;
      const { x, y } = this.marblePoint(marble);
      const existing = this.guardMarks.get(marble.id);
      const mark = existing ?? this.add.graphics();
      this.drawGuardBrackets(mark);
      mark.setPosition(Math.round(x), Math.round(y));
      if (existing) continue;
      this.guardLayer.add(mark);
      this.guardMarks.set(marble.id, mark);
      // theme.css's blanket prefers-reduced-motion rule only reaches CSS - a Phaser tween has
      // to ask for itself. The frame still has to wait for the marble either way, so reduced
      // motion gets the same delay with no fade.
      if (animate && prefersReducedMotion()) {
        mark.setAlpha(0);
        this.time.delayedCall(MOVE_TWEEN_MS, () => mark.setAlpha(1));
      } else if (animate) {
        // The marble is still tweening out of its kennel when this is first drawn, and the
        // frame belongs to where it lands, not to the empty square it is heading for.
        mark.setAlpha(0);
        this.tweens.add({ targets: mark, alpha: 1, duration: MOVE_TWEEN_MS, delay: MOVE_TWEEN_MS });
      }
    }
  }

  /**
   * Redraws `mark` as four corner brackets centered on its own origin, at current scale. The
   * position it's drawn at is rounded too (see updateGuards) - the reticle never moves, so
   * whole-pixel placement costs nothing. See drawCornerBrackets for why that matters.
   */
  private drawGuardBrackets(mark: Phaser.GameObjects.Graphics) {
    mark.clear();
    drawCornerBrackets(mark, 0, 0, GUARD_HALF_EXTENT, this.pieceScale, PALETTE.ink);
  }


  /**
   * Walks a marble through each track index in sequence, then into its home slot if the move
   * ends there, rather than tweening straight to the destination. A chain of short tweens
   * (not tweens.chain(), to avoid depending on its exact config shape across versions), so
   * distance and duration scale together instead of a 13-square move taking as long as a
   * 1-square one.
   */
  private walkMarble(sprite: Phaser.GameObjects.Image, owner: PlayerId, planned: MarbleAnimation) {
    const config = this.state!.config;
    const trackLength = trackLengthFor(config);
    const hue = this.colorAssignment[owner];
    const points = planned.trackIndices.map((i) => trackPoint(i, trackLength, this.geo));
    if (planned.entersHomeSlot !== null) {
      points.push(homeSlotPoint(config, owner, planned.entersHomeSlot, this.geo));
    }
    // Onto the device grid like every resting marble (updateMarbles), so a walk ends exactly
    // where the marble's texture lines up with the screen's pixels.
    for (const point of points) {
      point.x = this.snapToPixel(point.x);
      point.y = this.snapToPixel(point.y);
    }
    // The departure square comes from the plan, not from where the sprite happens to be: a
    // marble whose previous move is still animating sits between two squares right now, and
    // starting the trail there marks ground it never covered.
    let prevAngle: number | null = null;
    if (planned.fromTrackIndex !== null) {
      const from = trackPoint(planned.fromTrackIndex, trackLength, this.geo);
      this.spawnTrailMark(from.x, from.y, hue);
      prevAngle = trackAngle(planned.fromTrackIndex, trackLength, this.geo);
    }

    const step = (i: number) => {
      if (i >= points.length) return;
      const { x, y } = points[i];
      const arrivingHome = i === points.length - 1 && planned.entersHomeSlot !== null;
      this.tweens.add({
        targets: sprite, x, y, duration: WALK_STEP_MS, ease: 'Linear',
        onComplete: () => {
          // Arrival, matching the trail mark below - a tick on departure would fire before the
          // marble had visibly gone anywhere. audio.ts rate-gates this globally, which is what
          // stops a 55ms-per-square walk (and four concurrent ones during a split 7) from
          // becoming a rattle.
          playStep(i);
          // On arrival, not departure, so the trail forms behind the marble rather than
          // lighting up the square it is about to step onto.
          this.spawnTrailMark(x, y, hue);
          // Only track legs get a border segment: the last leg of a home entry leaves the
          // ring entirely, and an arc along the ring for it would point at a square the
          // marble never stood on.
          if (i < planned.trackIndices.length) {
            const angle = trackAngle(planned.trackIndices[i], trackLength, this.geo);
            // Null only for a walk that didn't start on the ring (a home-stretch shuffle) -
            // the line simply starts at the first square actually walked.
            if (prevAngle !== null) this.spawnTrailArc(prevAngle, angle, hue);
            prevAngle = angle;
          }
          if (arrivingHome) this.playHomeArrival(sprite);
          step(i + 1);
        },
      });
    };
    step(0);
  }

  /**
   * One segment of the border line, spanning the ring angle between two consecutive squares.
   *
   * The span is taken the *shortest* way round, which is what makes the wraparound leg (last
   * square -> square 0) draw the one-square hop it really is instead of a line almost all the
   * way back around the board, and what lets a backward move draw its segments in the
   * direction it actually walks.
   *
   * Squares are laid from just past `fromAngle` through `toAngle` inclusive, so consecutive
   * segments meet without overlapping: two semi-transparent squares stacked on one pixel
   * blend brighter at every joint, turning a continuous line into a dotted one.
   */
  private spawnTrailArc(fromAngle: number, toAngle: number, hue: number) {
    if (!this.trailLayer) return;
    const radius = this.geo.trackRadius * TRAIL_ARC_RATIO;
    let delta = toAngle - fromAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    const size = Math.max(2, TRAIL_ARC_PIXEL * this.pieceScale);
    const count = Math.max(1, Math.ceil((Math.abs(delta) * radius) / size));
    const arc = this.add.graphics();
    arc.fillStyle(hueToHex(hue), 1);
    for (let i = 1; i <= count; i++) {
      const angle = fromAngle + (delta * i) / count;
      arc.fillRect(
        this.geo.center.x + Math.cos(angle) * radius - size / 2,
        this.geo.center.y + Math.sin(angle) * radius - size / 2,
        size,
        size,
      );
    }
    arc.setAlpha(TRAIL_ARC_ALPHA);
    this.trailLayer.add(arc);
    this.fadeOutTrail(arc);
  }

  /**
   * One fading square of a marble's walked path, in that marble's own color. A chamfered
   * square rather than the diamond every piece and field uses - see TRAIL_CHAMFER_RATIO. No
   * stroke: an outline at this size fights the track tile underneath, and the fill alone
   * carries the color.
   */
  private spawnTrailMark(x: number, y: number, hue: number) {
    if (!this.trailLayer) return;
    const size = MARBLE_REACH * 2 * this.pieceScale * TRAIL_SIZE_RATIO;
    const mark = this.add.polygon(x, y, chamferedSquarePoints(size, TRAIL_CHAMFER_RATIO), hueToHex(hue), TRAIL_ALPHA);
    this.trailLayer.add(mark);
    this.fadeOutTrail(mark);
  }

  /**
   * Hold, then fade, then self-destruct. Each trail piece owns its own lifetime this way, so
   * nothing has to track or sweep them and the layer is empty again a second or two after any
   * move. Measured per piece from when it was dropped, so a long walk fades in walking order,
   * oldest square first, like a wake closing behind the marble.
   */
  private fadeOutTrail(piece: Phaser.GameObjects.GameObject) {
    this.tweens.add({
      targets: piece,
      alpha: 0,
      delay: TRAIL_HOLD_MS,
      duration: TRAIL_FADE_MS,
      ease: 'Quad.easeIn',
      onComplete: () => piece.destroy(),
    });
  }

  /**
   * Kills the fade tweens before destroying their targets - a tween left running against a
   * destroyed game object is the standard way to get a null-property crash out of Phaser's
   * tween update a frame later.
   */
  private clearTrail() {
    if (!this.trailLayer) return;
    for (const mark of this.trailLayer.getAll()) this.tweens.killTweensOf(mark);
    this.trailLayer.removeAll(true);
  }

  /**
   * A brief flash when a marble's walk ends by entering home. Home slots sit small and
   * crowded near the center, right next to goal outlines that are there regardless of
   * occupancy, so without a distinct arrival beat this is easy to miss entirely - especially
   * for the custom-4's backward shortcut, where a marble can reach home from far away from
   * the visual "lap complete" moment. A fixed-size diamond that fades out, not a scale tween
   * on the marble itself - just outside the goal diamond the marble lands in, so it reads as
   * that slot lighting up.
   */
  private playHomeArrival(sprite: Phaser.GameObjects.Image) {
    // Same reasoning as the capture sound: this fires at the end of the walk, which is where
    // the marble actually arrives, rather than when the state snapshot said it had.
    playSound('homeEnter');
    const flash = this.add.graphics({ x: sprite.x, y: sprite.y });
    flash.fillStyle(0xffffff, 0.85);
    flash.fillPoints(diamondTips(0, 0, MARBLE_REACH * 1.4 * this.pieceScale), true);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 380, ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  /**
   * The custom-2's forced draw, as a card-back flying from the draw pile to that player's
   * kennel - the only board-space landmark for "your stuff", since opponents' hands aren't
   * rendered as card fans. Face-down on purpose: a forced draw is hidden information, and the
   * animation shouldn't leak what was drawn any more than watching a real deck would.
   */
  private playCardDraws(draws: CardDrawAnimation[]) {
    if (!this.state) return;
    const config = this.state.config;
    const from = drawPileCenter(this.geo);
    for (const draw of draws) {
      const to = kennelSlotPoint(config, draw.targetPlayer, (KENNEL_SIZE - 1) / 2, this.geo);
      const card = this.add.image(from.x, from.y, 'card-back').setDisplaySize(CARD_WIDTH * this.pieceScale, CARD_HEIGHT * this.pieceScale);
      this.tweens.add({
        targets: card, x: to.x, y: to.y, duration: MOVE_TWEEN_MS, ease: 'Cubic.easeInOut',
        onComplete: () => card.destroy(),
      });
    }
  }

  // --- Card stacks --------------------------------------------------------

  private updateDecor() {
    if (!this.decorLayer) return;
    this.decorLayer.removeAll(true);
    this.drawCardStack(drawPileCenter(this.geo), 0);
    // The discard pile's own top card is NOT drawn here - it's a real DOM .playing-card (see
    // LaidCard.tsx), so its font and sizing come from the same CSS every other card on screen
    // uses instead of a separately hand-tuned Phaser canvas font that only approximated it.
    this.drawCardStack(discardPileCenter(this.geo), 1);
  }

  /**
   * Fanned card backs at a pile's anchor, stepping 2px per card. `frontOffset` is the offset
   * step of the frontmost back drawn: 0 for the draw pile, whose top card really is a back,
   * 1 for the discard pile, where LaidCard draws the top card instead. Depth is fixed rather
   * than true pile size - tracking that isn't worth it for a visual-only stack.
   */
  private drawCardStack({ x, y }: Point, frontOffset: number) {
    const cardW = this.pileCardWidth;
    const cardH = cardW * (CARD_HEIGHT / CARD_WIDTH);
    for (let i = 2; i >= frontOffset; i--) {
      this.decorLayer!.add(this.add.image(x - i * 2, y - i * 2, 'card-back').setDisplaySize(cardW, cardH));
    }
  }

  // --- Dither layer -------------------------------------------------------

  /**
   * Starts a crossfade to whoever's turn it now is. Called from every render, and a no-op
   * unless the current player actually changed - setGameState fires on every move, not only
   * ones that hand the turn on.
   */
  private syncTurnGlow() {
    if (!this.state) return;
    const player = this.state.currentPlayer;
    if (this.lastGlowPlayer === player) return;
    this.lastGlowPlayer = player;

    this.glowReveals.forEach((reveal) => {
      this.tweens.killTweensOf(reveal);
      this.tweens.add({
        targets: reveal,
        alpha: 0,
        duration: TURN_GLOW_FADE_MS,
        ease: 'Sine.easeOut',
        onComplete: () => {
          this.glowReveals = this.glowReveals.filter((r) => r !== reveal);
        },
      });
    });

    const incoming = { player, alpha: 0 };
    this.glowReveals.push(incoming);
    this.tweens.add({ targets: incoming, alpha: 1, duration: TURN_GLOW_FADE_MS, ease: 'Sine.easeIn' });
  }

  /**
   * Fires once per captured marble, from updateMarbles, right where that marble's
   * return-to-kennel tween starts. `delay` matches that tween's own, so the flash fires when
   * the marble visually departs rather than the instant state updates.
   */
  private spawnKillWave(x: number, y: number, delay: number) {
    const wave = { x, y, progress: 0 };
    this.killWaves.push(wave);
    this.tweens.add({
      targets: wave,
      progress: 1,
      duration: KILL_WAVE_DURATION_MS,
      delay,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.killWaves = this.killWaves.filter((w) => w !== wave);
      },
    });
  }

  /**
   * Phaser calls this every frame automatically (a reserved Scene method name) - the one
   * exception to this file's "pure renderer driven by setGameState" shape, needed because a
   * live dither is continuous motion, not a transition the tween system can animate between
   * two values.
   */
  update(_time: number, delta: number) {
    this.glowTime += delta / 1000;
    this.drawGlowLayer();
  }

  /**
   * Repaints the shared glow texture. Two independent things draw into it:
   *
   * - Turn reveals window into the grid at their own kennel position, tinted to that
   *   player's color, with a soft-edged circular falloff. The `distFromBoardCenter <=
   *   trackRadius` skip is a hard cutoff independent of the reveal's own radius: kennels sit
   *   outside the ring and every goal tile sits inside it, so excluding everything at or
   *   inside the ring guarantees the glow never bleeds under the track or the goal tiles,
   *   however generous TURN_GLOW_RADIUS_RATIO is.
   *
   * - Capture flashes are a travelling ring, so only cells within KILL_WAVE_THICKNESS of the
   *   ring's current radius light up. No trackRadius cutoff here: unlike a kennel, a captured
   *   marble is usually sitting ON the ring, and the wave should cross it in both directions
   *   rather than be clipped in half by it.
   *
   * Only the bounding box around each active reveal and wave is cleared and redrawn, not the
   * whole texture. Reveals are static for as long as it stays that player's turn and waves
   * live well under a second, so nothing stale is left behind.
   */
  private drawGlowLayer() {
    if (!this.state || !this.glowTexture || !this.glowImage) return;
    const width = this.viewWidth;
    const height = this.viewHeight;
    if (width === 0 || height === 0) return;

    if (this.glowTexture.width !== width || this.glowTexture.height !== height) {
      this.glowTexture.setSize(width, height);
      this.glowImage.setDisplaySize(width, height);
    }

    const config = this.state.config;
    const ctx = this.glowTexture.context;
    const radius = this.geo.trackRadius * TURN_GLOW_RADIUS_RATIO;
    const coreRadius = radius * TURN_GLOW_CORE_RATIO;
    const pad = radius + TURN_GLOW_CELL;
    // The wave's own, bigger radius, so its clear box covers the full ring at every point in
    // its growth rather than only the turn glow's smaller one.
    const killRadius = this.geo.trackRadius * KILL_WAVE_RADIUS_RATIO;
    const killPad = killRadius + TURN_GLOW_CELL;

    for (const reveal of this.glowReveals) {
      const center = kennelSlotPoint(config, reveal.player, (KENNEL_SIZE - 1) / 2, this.geo);
      ctx.clearRect(center.x - pad, center.y - pad, pad * 2, pad * 2);
    }
    for (const wave of this.killWaves) {
      ctx.clearRect(wave.x - killPad, wave.y - killPad, killPad * 2, killPad * 2);
    }

    for (const reveal of this.glowReveals) {
      if (reveal.alpha <= 0.01) continue;
      const center = kennelSlotPoint(config, reveal.player, (KENNEL_SIZE - 1) / 2, this.geo);
      const hex = hueToHex(this.colorAssignment[reveal.player]);
      const r = (hex >> 16) & 0xff;
      const g = (hex >> 8) & 0xff;
      const b = hex & 0xff;

      const minCx = Math.max(0, Math.floor((center.x - radius) / TURN_GLOW_CELL));
      const maxCx = Math.min(Math.ceil(width / TURN_GLOW_CELL), Math.ceil((center.x + radius) / TURN_GLOW_CELL));
      const minCy = Math.max(0, Math.floor((center.y - radius) / TURN_GLOW_CELL));
      const maxCy = Math.min(Math.ceil(height / TURN_GLOW_CELL), Math.ceil((center.y + radius) / TURN_GLOW_CELL));

      for (let cy = minCy; cy < maxCy; cy++) {
        for (let cx = minCx; cx < maxCx; cx++) {
          const px = (cx + 0.5) * TURN_GLOW_CELL;
          const py = (cy + 0.5) * TURN_GLOW_CELL;
          const distFromBoardCenter = Math.hypot(px - this.geo.center.x, py - this.geo.center.y);
          if (distFromBoardCenter <= this.geo.trackRadius) continue;

          const dist = Math.hypot(px - center.x, py - center.y);
          if (dist > radius) continue;
          const fade = dist <= coreRadius ? 1 : 1 - (dist - coreRadius) / (radius - coreRadius);

          const v = turnGlowNoise(cx, cy, this.glowTime);
          const alpha = turnGlowBand(v, cx, cy) * fade * reveal.alpha;
          if (alpha <= 0.01) continue;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fillRect(cx * TURN_GLOW_CELL, cy * TURN_GLOW_CELL, TURN_GLOW_CELL - 1, TURN_GLOW_CELL - 1);
        }
      }
    }

    const waveR = (PALETTE.cardRed >> 16) & 0xff;
    const waveG = (PALETTE.cardRed >> 8) & 0xff;
    const waveB = PALETTE.cardRed & 0xff;
    for (const wave of this.killWaves) {
      const currentRadius = wave.progress * killRadius;
      const fadeOut = 1 - wave.progress;

      const minCx = Math.max(0, Math.floor((wave.x - killRadius) / TURN_GLOW_CELL));
      const maxCx = Math.min(Math.ceil(width / TURN_GLOW_CELL), Math.ceil((wave.x + killRadius) / TURN_GLOW_CELL));
      const minCy = Math.max(0, Math.floor((wave.y - killRadius) / TURN_GLOW_CELL));
      const maxCy = Math.min(Math.ceil(height / TURN_GLOW_CELL), Math.ceil((wave.y + killRadius) / TURN_GLOW_CELL));

      for (let cy = minCy; cy < maxCy; cy++) {
        for (let cx = minCx; cx < maxCx; cx++) {
          const px = (cx + 0.5) * TURN_GLOW_CELL;
          const py = (cy + 0.5) * TURN_GLOW_CELL;
          const ringDist = Math.abs(Math.hypot(px - wave.x, py - wave.y) - currentRadius);
          if (ringDist > KILL_WAVE_THICKNESS) continue;
          const ringFade = 1 - ringDist / KILL_WAVE_THICKNESS;

          const v = turnGlowNoise(cx, cy, this.glowTime);
          const alpha = turnGlowBand(v, cx, cy, KILL_WAVE_LEVELS) * ringFade * fadeOut;
          if (alpha <= 0.01) continue;
          ctx.fillStyle = `rgba(${waveR}, ${waveG}, ${waveB}, ${alpha})`;
          ctx.fillRect(cx * TURN_GLOW_CELL, cy * TURN_GLOW_CELL, TURN_GLOW_CELL - 1, TURN_GLOW_CELL - 1);
        }
      }
    }
    this.glowTexture.refresh();
  }
}
