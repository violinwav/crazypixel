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
  HOME_STRETCH_LENGTH, KENNEL_SIZE, activePlayerIds, startIndexFor, trackLengthFor,
} from '@crazypixel/shared';
import type { GameState, Marble, PlayerId } from '@crazypixel/shared';
import {
  computeBoardGeometry, discardPileCenter, drawPileCenter, homeSlotPoint, kennelSlotPoint,
  pieceScaleFor, trackAngle, trackPoint,
} from '../boardLayout';
import type { BoardGeometry, Point } from '../boardLayout';
import { hueToCss, hueToHex } from '../color';
import { PALETTE } from '../theme';
import { CARD_WIDTH, CARD_HEIGHT, handCardWidthFor } from '../cardArt';
import { EMPTY_TURN_ANIMATION } from '../animationPlan';
import type { CardDrawAnimation, MarbleAnimation, TurnAnimation } from '../animationPlan';

// --- Pieces and fields ----------------------------------------------------

const MARBLE_SIZE = 24;
// Kennel and goal fields are chamfered squares with the same cut-corner silhouette as
// generate-sprites.py's make_marble (7/22), not circles, so a field reads as the same shape
// family as the piece that sits in it. Kennel is larger than a marble (a socket the piece
// drops into); goal is smaller, a discreet waypoint marker.
const HOME_FIELD_DIAMETER = MARBLE_SIZE + 8;
const GOAL_FIELD_DIAMETER = MARBLE_SIZE + 2;
const FIELD_CHAMFER_RATIO = 7 / 22;
// Matches generate-sprites.py's PALETTE['marble_border'] - the outline every marble already
// carries, reused so a field's border reads as the same ink.
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
const TRAIL_SIZE_RATIO = 0.72;
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
  private decorLayer?: Phaser.GameObjects.Container;
  /**
   * Fading path markers. Its own container because, unlike the layers above, it is never
   * bulk-cleared on a render: each marker owns its lifetime via its own fade tween and
   * outlives the render that spawned it.
   */
  private trailLayer?: Phaser.GameObjects.Container;
  private marbleLayer?: Phaser.GameObjects.Container;

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
  /** hue -> generated texture key, filled lazily by tintedMarbleKey. */
  private marbleTextureCache = new Map<number, string>();
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
    this.load.image('marble-base', '/sprites/marble-base.png');
  }

  create() {
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
    this.decorLayer = this.add.container(0, 0);
    // Between board and marbles in draw order: a trail marker paints over the track tile it
    // marks, and the marble paints over its own trail.
    this.trailLayer = this.add.container(0, 0);
    this.marbleLayer = this.add.container(0, 0);

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

  /**
   * The draw/discard pile's card width, synced to the real DOM hand card rather than
   * pieceScale: on a narrow phone the hand shrinks well before the board's trackRadius-
   * relative scale does, and the pile has to shrink with it. this.scale.width is the same
   * CSS-pixel container width GameBoard.tsx measures - RESIZE scale mode keeps the canvas
   * synced 1:1 with that parent element.
   */
  private get pileCardWidth(): number {
    return handCardWidthFor(this.scale.width);
  }

  private layout() {
    // Trail markers live in screen space, so a resize (or a hotseat rotation snap) leaves
    // them pointing at squares that have moved out from under them. Drop them rather than
    // re-deriving positions for a decoration that's about to fade out anyway.
    this.clearTrail();
    this.renderPieces(false); // a re-layout is not a game move - snap, don't tween
  }

  private renderPieces(animate: boolean) {
    if (!this.state || !this.marbleLayer) return;
    const { width, height } = this.scale;
    if (width === 0 || height === 0) return; // nothing sensible to draw against yet
    // Geometry depends on state.config, which isn't known until the first real setGameState
    // call and never changes afterward for a given scene instance - so recomputing here
    // every render is cheap redundancy, not a bug.
    this.geo = computeBoardGeometry(width, height, trackLengthFor(this.state.config), this.viewerSeat, this.state.config.playerCount);
    this.syncTurnGlow();
    this.redrawBoard();
    this.updateMarbles(animate);
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
    const homeFieldSize = HOME_FIELD_DIAMETER * this.pieceScale;
    const goalFieldSize = GOAL_FIELD_DIAMETER * this.pieceScale;
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

    // Points span 0..size (top-left origin) - add.polygon re-centers them on x/y itself, so
    // x/y below is the field's center, same as every other shape call here.
    const homeFieldPoints = chamferedSquarePoints(homeFieldSize, FIELD_CHAMFER_RATIO);
    const goalFieldPoints = chamferedSquarePoints(goalFieldSize, FIELD_CHAMFER_RATIO);

    players.forEach((player) => {
      // Kennel: a black-bordered socket a little larger than a marble, so the piece visibly
      // sits inside it.
      for (let slot = 0; slot < KENNEL_SIZE; slot++) {
        const { x, y } = kennelSlotPoint(config, player, slot, this.geo);
        this.boardLayer!.add(
          this.add
            .polygon(x, y, homeFieldPoints, PALETTE.bgRaised, 1)
            .setStrokeStyle(2, MARBLE_BORDER_COLOR, 1),
        );
      }
      // Goal slots: the same chamfered shape, smaller, with a faint white fill so an
      // occupied slot doesn't hide the marble in it. The colored outline alone marks whose
      // goal it is, which is what makes "where do I need to get to" read at a glance.
      for (let slot = 0; slot < HOME_STRETCH_LENGTH; slot++) {
        const { x, y } = homeSlotPoint(config, player, slot, this.geo);
        const color = hueToHex(this.colorAssignment[player]);
        this.boardLayer!.add(
          this.add
            .polygon(x, y, goalFieldPoints, PALETTE.ink, 0.16)
            .setStrokeStyle(2, color, 0.85),
        );
      }
    });
  }

  // --- Marbles ------------------------------------------------------------

  /**
   * Recolors the neutral 'marble-base' texture to a hue and registers the result as its own
   * texture, cached per hue.
   *
   * Exists because Image.setTint is a no-op under this project's Phaser.CANVAS renderer
   * (confirmed by pixel sampling - marbles rendered plain grey with setTint applied). Don't
   * swap this for setTint without re-confirming tint actually paints under Canvas. The
   * 'multiply' then 'destination-in' pair is the standard canvas recolor recipe: multiply
   * blends the tint across the whole canvas (outside the silhouette too, since the fill is
   * opaque), then destination-in clips back to wherever the base image had pixels -
   * preserving the border and facet shading baked into marble-base.png instead of flattening
   * the marble to one solid tone.
   */
  private tintedMarbleKey(hue: number): string {
    const cached = this.marbleTextureCache.get(hue);
    if (cached) return cached;

    const key = `marble-tint-${hue}`;
    const base = this.textures.get('marble-base').getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hueToCss(hue);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base, 0, 0);

    this.textures.addCanvas(key, canvas);
    this.marbleTextureCache.set(hue, key);
    return key;
  }

  private updateMarbles(animate: boolean) {
    const marbleSize = MARBLE_SIZE * this.pieceScale;
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
      const { x, y } = this.marblePoint(marble);
      const existing = this.marbleSprites.get(marble.id);
      const alpha = passedOwners.has(marble.owner) ? 0.65 : 1;

      if (!existing) {
        const sprite = this.add.image(x, y, this.tintedMarbleKey(this.colorAssignment[marble.owner]))
          .setDisplaySize(marbleSize, marbleSize)
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

      existing.setDisplaySize(marbleSize, marbleSize);
      existing.setAlpha(alpha);
      const moved = Math.round(existing.x) !== Math.round(x) || Math.round(existing.y) !== Math.round(y);
      if (!moved) continue;

      if (!animate) {
        existing.setPosition(x, y);
        continue;
      }

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
      if (captured) this.spawnKillWave(existing.x, existing.y, delay);
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
   * One fading square of a marble's walked path, in that marble's own color. Same chamfered
   * silhouette as the kennel and goal fields, so it reads as part of the board's shape
   * vocabulary rather than a generic particle. No stroke: an outline at this size fights the
   * track tile underneath, and the fill alone carries the color.
   */
  private spawnTrailMark(x: number, y: number, hue: number) {
    if (!this.trailLayer) return;
    const size = MARBLE_SIZE * this.pieceScale * TRAIL_SIZE_RATIO;
    const mark = this.add.polygon(x, y, chamferedSquarePoints(size, FIELD_CHAMFER_RATIO), hueToHex(hue), TRAIL_ALPHA);
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
   * the visual "lap complete" moment. A fixed-size square that fades out, not a scale tween
   * on the marble itself.
   */
  private playHomeArrival(sprite: Phaser.GameObjects.Image) {
    const flash = this.add.rectangle(sprite.x, sprite.y, sprite.displayWidth * 1.4, sprite.displayHeight * 1.4, 0xffffff, 0.85);
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
    const { width, height } = this.scale;
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
