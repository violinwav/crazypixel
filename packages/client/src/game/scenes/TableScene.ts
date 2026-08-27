import Phaser from 'phaser';
import {
  HOME_STRETCH_LENGTH, KENNEL_SIZE, activePlayerIds, startIndexFor, trackLengthFor,
} from '@crazypixel/shared';
import type { GameState, Marble, PlayerId } from '@crazypixel/shared';
import {
  trackPoint, kennelSlotPoint, homeSlotPoint, drawPileCenter, discardPileCenter, computeBoardGeometry,
} from '../boardLayout';
import type { BoardGeometry } from '../boardLayout';
import { hueToCss, hueToHex } from '../color';
import { CARD_FACE_SPRITE } from '../cardArt';
import { EMPTY_TURN_ANIMATION } from '../animationPlan';
import type { CardDrawAnimation, MarbleAnimation, TurnAnimation } from '../animationPlan';

// Reference sizes at the desktop-tuned 220px track radius - scaled by REFERENCE below so
// pieces/cards shrink proportionally on a narrow phone viewport instead of overlapping.
const REFERENCE_TRACK_RADIUS = 220;
// Phaser draws its own canvas text independent of CSS - theme.css's --cp-font-display var
// swap doesn't reach here, so this has to be kept in sync by hand.
const FONT_FAMILY = '"Departure Mono"';
const MARBLE_SIZE = 24;
// Matches the DOM hand card's aspect ratio (150x210, see theme.css's .playing-card) - one
// consistent card shape everywhere it appears, not a separately-tuned board version.
const CARD_WIDTH = 80;
const CARD_HEIGHT = 112;
const GOAL_TILE_SIZE = 14;
// Fixed screen px, matching PixelDither.tsx's own `vivid` (hand-panel background) CELL - one
// shared grid/clock/algorithm, not a second differently-scaled animation. The texture this
// draws into spans the whole board (see drawTurnGlow), and every player's reveal samples the
// *same* grid at their own kennel position, rather than each getting its own resized canvas.
const TURN_GLOW_CELL = 8;
// Of geo.trackRadius, not a fixed px - the reveal's radius should track the kennel cluster's
// own scale same as everything else board-relative, even though the grid it samples (above)
// stays fixed. Deliberately generous (bigger than the gap between kennelRadius and
// trackRadius) - the hard ring cutoff below trims whatever part of the circle would dip past
// the ring on the inward side, which is the point (see feedback: don't bleed under the track
// or goal tiles), while the outward/lateral sides stay a full, soft circle.
const TURN_GLOW_RADIUS_RATIO = 0.42;
// Inside this fraction of the radius the dither stays at full strength; beyond it, alpha
// ramps down to 0 at the rim - "a circle with faded borders", not a radial gradient from the
// center outward.
const TURN_GLOW_CORE_RATIO = 0.55;
// Crossfade duration for the reveal moving to a new player - "fade out for one player, fade
// in for the next", not the instant reposition/recolor this used to do.
const TURN_GLOW_FADE_MS = 500;
// Same 4x4 Bayer matrix, noise function, and vivid-mode alpha banding as PixelDither.tsx -
// duplicated rather than imported (that file is a React component, not a shared util, and
// this project already duplicates small per-file-tuned constants like this on purpose - see
// boardLayout.ts's REFERENCE_TRACK_LENGTH), but kept numerically identical on purpose so this
// genuinely reads as "the same dither animation", just windowed, colored, and local.
const TURN_GLOW_BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const TURN_GLOW_LEVELS = [0.08, 0.2, 0.32, 0.46, 0.6];
function turnGlowNoise(cx: number, cy: number, t: number): number {
  const a = Math.sin(cx * 0.12 + t) * Math.sin(cy * 0.1 - t * 0.7);
  const b = Math.sin((cx + cy) * 0.05 - t * 0.4);
  return (a * 0.6 + b * 0.4 + 1) * 0.5;
}
function turnGlowBand(v: number, cx: number, cy: number): number {
  const scaled = v * TURN_GLOW_LEVELS.length;
  const base = Math.floor(scaled);
  const frac = scaled - base;
  const bayerThreshold = TURN_GLOW_BAYER[cy % 4][cx % 4] / 16;
  const level = frac > bayerThreshold ? base + 1 : base;
  return TURN_GLOW_LEVELS[Math.max(0, Math.min(TURN_GLOW_LEVELS.length - 1, level))];
}
// Was 350/90 - a multi-square move (WALK_STEP_MS per square) stacked up fast, and even a
// single direct tween (MOVE_TWEEN_MS - kennel->start, captures, card flights) read as
// sluggish next to everything else in the app's now-snappier terminal motion vocabulary.
const MOVE_TWEEN_MS = 220;
const POP_IN_MS = 250;
const WALK_STEP_MS = 55;
// Track tile sprite pixel size is fixed regardless of player count, but tile *count* scales
// with it (more players = more, smaller-arc slots around the same-ish ring) - rendering
// tiles at their full native size left them touching/overlapping, worse the more players
// there are. TRACK_TILE_GAP shrinks every tile a bit for a universal small gap; the extra
// REFERENCE_TRACK_LENGTH factor shrinks them further for a track longer than the original
// 4-player one, since radiusBoostFor (boardLayout.ts) only grows the ring so far before the
// viewport clamp takes over - the two adjustments meet in the middle instead of one lever
// doing all the work.
const TRACK_TILE_GAP = 0.68;
// Matches boardLayout.ts's own REFERENCE_TRACK_LENGTH (not imported - that file avoids a
// player-count-details dependency, this constant is duplicated on purpose, not by accident).
// Below the original fixed-4-player length so 4P also gets some extra shrink now, not just
// 6P - a flat gap factor alone still read as cramped at 4P.
const REFERENCE_TRACK_LENGTH = 48;

// Ring layout stands in for the real cross-shaped Brändi Dog track until that geometry
// pass happens (see README). Pieces are the hand-authored pixel sprites from
// scripts/generate-sprites.py. The scene itself holds no game logic - it's a pure renderer
// driven by setGameState(), called from React whenever @crazypixel/shared's GameState
// changes (see PhaserGame.ts and useGameState.ts). Geometry (trackPoint etc.) lives in
// ../boardLayout so BoardOverlay.tsx's accessible hit targets stay pixel-aligned with what
// gets drawn here, instead of two hand-copied implementations quietly drifting apart, and
// so radii scale with viewport size instead of being fixed pixel constants. Player count
// and start positions come from state.config (2/4/6 players, ffa/teams) rather than a
// fixed 4-quadrant assumption - the board grows (more track squares) with more players
// rather than cramming them onto a fixed-size ring.
//
// Layout fully recomputes on every Scale Manager 'resize' event, not just once in create().
// That's not just for the flex-container 0x0-at-boot race (see PhaserGame.ts) - a "phone
// game" needs to survive real orientation changes too, and a one-shot create() layout can't.
//
// Marble sprites persist across renders (keyed by marble id) and tween to their new
// position on a real game-state change, rather than the earlier approach of destroying and
// recreating every sprite on every render, which just teleported pieces with no sense of
// motion. A resize-driven re-layout still snaps instantly (see the `animate` param below) -
// that's a viewport change, not a game move, and shouldn't play a movement animation.
export class TableScene extends Phaser.Scene {
  private state: GameState | null = null;
  private glowLayer?: Phaser.GameObjects.Container;
  /** Offscreen canvas drawTurnGlow paints into every frame (see update()) - a live-updating
   * texture (CanvasTexture + refresh()), not a new addCanvas call per frame, which is the
   * idiomatic Phaser way to redraw the same raw pixels repeatedly. Sized to the whole board
   * (kept in sync with this.scale in drawTurnGlow) - one shared surface every reveal samples
   * from, not a separate canvas per player. Displayed via glowImage. */
  private glowTexture?: Phaser.Textures.CanvasTexture;
  private glowImage?: Phaser.GameObjects.Image;
  private glowTime = 0;
  /** Usually one entry (the current player); briefly two during a turn-change crossfade -
   * see syncTurnGlow. Each tween's own `alpha` (0..1) is read directly by drawTurnGlow, not
   * re-derived from anything else. */
  private glowReveals: { player: PlayerId; alpha: number }[] = [];
  /** Lets syncTurnGlow tell "still this player's turn, just re-rendering" apart from "turn
   * actually changed", since setGameState fires on every move, not just ones that hand the
   * turn to someone else (e.g. a 7-split plays several moves in one turn) - re-triggering the
   * crossfade on every render would restart it constantly instead of firing once per real
   * turn change. */
  private lastGlowPlayer: PlayerId | null = null;
  private boardLayer?: Phaser.GameObjects.Container;
  private decorLayer?: Phaser.GameObjects.Container;
  private marbleLayer?: Phaser.GameObjects.Container;
  private titleText?: Phaser.GameObjects.Text;
  private geo: BoardGeometry = {
    center: { x: 0, y: 0 }, trackRadius: 0, kennelRadius: 0, handCountRadius: 0, homeRadiusOuter: 0, homeRadiusStep: 0, stackOffset: 0, stackCenter: { x: 0, y: 0 }, rotation: 0,
  };
  private marbleSprites = new Map<string, Phaser.GameObjects.Image>();
  /** hue -> generated texture key, filled lazily by tintedMarbleKey - one small offscreen-
   * canvas recolor per hue actually used in a game (never more than the player count), not
   * per marble, so re-tinting the same seat's later marbles is free. */
  private marbleTextureCache = new Map<number, string>();
  private lastDiscardCardId: string | null = null;
  private pendingPlan: MarbleAnimation[] = [];
  private pendingCaptures: string[] = [];
  /** Seat (PlayerId) -> hue (0-359), from the lobby's color picker - default spread evenly
   * around the color wheel if never set. Converted to a tint via hueToHex - never a lookup
   * into a fixed palette, color is continuous now (see tintedMarbleKey below). */
  private colorAssignment: number[] = [0, 60, 120, 180, 240, 300];
  /** Whose base renders at the bottom of the ring - see boardLayout.ts's BoardGeometry.rotation.
   * Updated every render (not one-time like colorAssignment) since local hotseat re-rotates
   * to face whoever's turn it currently is - see GameBoard.tsx's mySeat prop. */
  private viewerSeat: PlayerId = 0;

  constructor() {
    super('TableScene');
  }

  preload() {
    this.load.image('tile-track', '/sprites/tile-track.png');
    this.load.image('tile-start', '/sprites/tile-start.png');
    this.load.image('tile-quarter', '/sprites/tile-quarter.png');
    this.load.image('tile-kennel', '/sprites/tile-kennel.png');
    this.load.image('card-back', '/sprites/card-back.png');
    for (const [rank, src] of Object.entries(CARD_FACE_SPRITE)) {
      this.load.image(`card-face-${rank}`, src);
    }
    this.load.image('marble-base', '/sprites/marble-base.png');
  }

  create() {
    this.titleText = this.add
      .text(0, 36, 'CRAZYPIXEL', { fontFamily: FONT_FAMILY, fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5);
    // Added before boardLayer - Phaser draws containers in add-order, so the glow paints
    // first and the board's own tiles paint over it, only showing past a tile's own edges.
    // A separate DOM layer behind the canvas can't achieve this: PhaserGame.ts's Game config
    // sets a `backgroundColor` with no `transparent: true`, so this canvas paints fully
    // opaque every frame (confirmed live - nothing placed behind it in the DOM ever showed
    // through, at any z-index), which only leaves "inside this same canvas, earlier in the
    // draw order" as an actual option.
    this.glowLayer = this.add.container(0, 0);
    // 1x1 placeholder - real size isn't known until the first drawTurnGlow call (this.scale
    // is frequently still 0x0 at this exact boot instant, same 0x0-at-boot race PhaserGame.ts
    // already has to poll around), which resizes it to match this.scale the moment it is.
    this.glowTexture = this.textures.createCanvas('turn-glow', 1, 1) ?? undefined;
    this.glowImage = this.add.image(0, 0, 'turn-glow').setOrigin(0, 0);
    this.glowLayer.add(this.glowImage);
    this.boardLayer = this.add.container(0, 0);
    this.decorLayer = this.add.container(0, 0);
    this.marbleLayer = this.add.container(0, 0);

    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
  }

  setGameState(state: GameState, plan: TurnAnimation = EMPTY_TURN_ANIMATION) {
    this.state = state;
    this.pendingPlan = plan.marbles;
    this.pendingCaptures = plan.capturedMarbleIds;
    if (this.marbleLayer) this.renderPieces(true);
    // Not routed through renderPieces/updateMarbles like marble walks - this is a one-shot
    // transient effect with no persistent sprite to reconcile, so it only needs to fire
    // once per actual move, never replayed by a resize-driven re-layout (see layout()).
    if (this.geo.trackRadius > 0) this.playCardDraws(plan.draws);
  }

  /** One-time call from the lobby's color picker (see PhaserGame.ts) - colors don't change
   * mid-game, so this isn't threaded through every setGameState call. */
  setColorAssignment(colors: number[]) {
    this.colorAssignment = colors;
  }

  /** Called every render (see PhaserGame.ts) - unlike colors, the viewer seat can legitimately
   * change turn to turn (local hotseat rotates to face whoever's acting). Doesn't itself
   * trigger a re-layout; relies on setGameState/layout running afterward in the same tick. */
  setViewerSeat(seat: PlayerId) {
    this.viewerSeat = seat;
  }

  private get pieceScale(): number {
    return this.geo.trackRadius / REFERENCE_TRACK_RADIUS;
  }

  private layout() {
    this.renderPieces(false); // a resize/re-layout is not a game move - snap, don't tween
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

  /** Recolors the neutral 'marble-base' texture to a given hue and registers the result as
   * its own texture, cached by hue so repeat calls are free. Exists because Image.setTint is
   * a no-op under this project's Phaser.CANVAS renderer (confirmed by direct pixel sampling -
   * marbles rendered plain grey, untinted, with setTint applied) - don't replace this with
   * setTint without re-confirming tint actually paints under Canvas first. 'multiply' then
   * 'destination-in' is the standard canvas recolor recipe: multiply blends the flat tint
   * color across the whole canvas (painting outside the marble's silhouette too, since the
   * fill itself is fully opaque), then destination-in clips back down to wherever the base
   * image actually had pixels - preserving the border/facet shading baked into
   * marble-base.png instead of flattening the marble to one solid tone. */
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

  private redrawBoard() {
    if (!this.boardLayer || !this.state) return;
    const config = this.state.config;
    const trackLength = trackLengthFor(config);
    const players = activePlayerIds(config);
    this.boardLayer.removeAll(true);
    const goalSize = GOAL_TILE_SIZE * this.pieceScale;
    const trackTileScale = this.pieceScale * TRACK_TILE_GAP * Math.min(1, REFERENCE_TRACK_LENGTH / trackLength);

    for (let i = 0; i < trackLength; i++) {
      const { x, y } = trackPoint(i, trackLength, this.geo);
      const isStart = players.some((p) => startIndexFor(config, p) === i);
      // Every 4th square gets a distinct tile (not just the once-per-player start tile) so
      // the ring reads as countable segments instead of one undifferentiated loop of dots.
      const isQuarter = !isStart && i % 4 === 0;
      const key = isStart ? 'tile-start' : isQuarter ? 'tile-quarter' : 'tile-track';
      this.boardLayer.add(this.add.image(x, y, key).setScale(trackTileScale));
    }

    players.forEach((player) => {
      for (let slot = 0; slot < KENNEL_SIZE; slot++) {
        const { x, y } = kennelSlotPoint(config, player, slot, this.geo);
        this.boardLayer!.add(this.add.image(x, y, 'tile-kennel').setScale(this.pieceScale));
      }
      // Goal/home-stretch markers, tinted per player so "where do I need to get to" reads
      // clearly, not just where starts are. Functional now (see GameEngine.ts
      // planMovement), not just a visual placeholder. Fill is deliberately faint (0.55 used
      // to read as near-opaque, close enough to a marble's own full-opacity fill that an
      // occupied slot didn't look meaningfully different from an empty one) - the outline
      // alone is enough to mark "this is a goal slot", leaving the fill free to stay almost
      // invisible so a marble sitting in it actually stands out.
      for (let slot = 0; slot < HOME_STRETCH_LENGTH; slot++) {
        const { x, y } = homeSlotPoint(config, player, slot, this.geo);
        const color = hueToHex(this.colorAssignment[player]);
        this.boardLayer!.add(
          this.add.rectangle(x, y, goalSize, goalSize, color, 0.16).setStrokeStyle(2, color, 0.85),
        );
      }
    });
  }

  /** Starts a crossfade to whoever's turn it now is, called from renderPieces on every
   * render - a no-op unless the current player actually changed since last time (setGameState
   * fires on every move, not just ones that hand the turn to someone else). The outgoing
   * reveal tweens out and removes itself; the incoming one tweens in - "fade out for one
   * player, fade in for the next", not the instant reposition/recolor this used to do. */
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

  /** Redraws the turn-glow canvas texture every frame (see update()) with the same
   * Bayer-dithered noise pattern and vivid-mode alpha banding PixelDither.tsx uses for the
   * hand-panel background (TURN_GLOW_BAYER/turnGlowNoise/turnGlowBand above) - one shared
   * grid and clock spanning the whole board, not a separate differently-sized canvas
   * recomputed per player. Each active reveal (see glowReveals/syncTurnGlow) just windows
   * into that same grid at its own kennel position, tinted to its own player's color, with a
   * soft-edged circular falloff (TURN_GLOW_CORE_RATIO keeps the inner disc at full strength,
   * fading only the outer band - "faded borders", not a gradient from the center).
   *
   * distFromBoardCenter <= trackRadius is a hard cutoff, independent of the reveal's own
   * radius: kennels sit *outside* the ring (kennelRadius > trackRadius - see
   * boardLayout.ts's KENNEL_RATIO) and every goal/home-stretch tile sits *inside* it
   * (homeRadiusOuter < trackRadius), so excluding anything at or inside the ring itself
   * guarantees the glow never bleeds under either the track or the goal tiles, regardless of
   * how generous TURN_GLOW_RADIUS_RATIO is - a clean cut at the board's own boundary, not a
   * softer radius tuned to just barely avoid it.
   *
   * Only clears/redraws the small bounding box around each active reveal, not the whole
   * texture - reveals are static for as long as it's still that player's turn (kennelSlotPoint
   * only moves on a resize or a local-hotseat rotation snap), so there's nothing stale left
   * behind by re-clearing just this frame's own draw area every time. */
  private drawTurnGlow() {
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

    for (const reveal of this.glowReveals) {
      const center = kennelSlotPoint(config, reveal.player, (KENNEL_SIZE - 1) / 2, this.geo);
      ctx.clearRect(center.x - pad, center.y - pad, pad * 2, pad * 2);
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
    this.glowTexture.refresh();
  }

  /** Phaser calls this every frame automatically (it's a reserved Scene method name) - the
   * one exception to this file's usual "pure renderer driven by setGameState()" shape (see
   * the class doc comment above), needed here because a live dither pattern is continuous
   * motion, not a state transition Phaser's tween system can animate between two values. */
  update(_time: number, delta: number) {
    this.glowTime += delta / 1000;
    this.drawTurnGlow();
  }

  private renderPieces(animate: boolean) {
    if (!this.state || !this.marbleLayer) return;
    const { width, height } = this.scale;
    if (width === 0 || height === 0) return; // nothing sensible to draw against yet
    // Geometry depends on state.config (trackLength), so it's recomputed here rather than
    // once in create()/layout() - config isn't known until the first real setGameState
    // call, and doesn't change again after that for a given TableScene instance (each game
    // gets its own), so recomputing every render is just cheap redundancy, not a bug.
    this.geo = computeBoardGeometry(width, height, trackLengthFor(this.state.config), this.viewerSeat, this.state.config.playerCount);
    this.titleText?.setPosition(this.geo.center.x, 36);
    // Cheap enough to redraw every render (a turn-based game, not a twitch one) - simpler
    // than tracking whether state.config actually changed since the last call.
    this.syncTurnGlow();
    this.redrawBoard();
    this.updateMarbles(animate);
    this.updateDecor();
  }

  private updateMarbles(animate: boolean) {
    const marbleSize = MARBLE_SIZE * this.pieceScale;
    const planByMarble = new Map(this.pendingPlan.map((p) => [p.marbleId, p]));
    const capturedIds = new Set(this.pendingCaptures);
    // A captured marble doesn't start its own trip to kennel until whatever captured it has
    // actually arrived - was firing both at once before, which read as the capturing marble
    // and the one it just sent home animating simultaneously rather than one causing the
    // other. Delay by the longest walk/teleport already planned this render. A startMarble
    // capture (an opponent caught sitting on your own start square) has no MarbleAnimation
    // entry at all (planAnimation doesn't plan one for it - the starting marble just pops
    // over via the plain-tween fallback below), so this can't stay 0 by default whenever
    // there's a capture with nothing else planned, or that specific case would still fire
    // both at once.
    let captureDelay = this.pendingCaptures.length > 0 ? MOVE_TWEEN_MS : 0;
    for (const planned of this.pendingPlan) {
      const duration = planned.kind === 'walk'
        ? (planned.trackIndices.length + (planned.entersHomeSlot !== null ? 1 : 0)) * WALK_STEP_MS
        : MOVE_TWEEN_MS;
      captureDelay = Math.max(captureDelay, duration);
    }
    const seen = new Set<string>();
    // A player with an empty hand has laid down for the rest of this round (see
    // GameEngine.ts's passHand) - every one of their marbles reads as dimmed/inactive,
    // wherever it sits (kennel, track, or home), rather than looking identical to everyone
    // else's until the next deal picks them back up. Scoping this to just kennel marbles
    // (the first pass at this) missed the common case: a player who's already got pieces
    // out on the board when their hand finally empties, which is most of them.
    const passedOwners = new Set(activePlayerIds(this.state!.config).filter((p) => this.state!.hands[p].length === 0));
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
      } else {
        // No plan entry (e.g. a marble captured mid-path) or an explicit teleport (a Jack
        // swap - doesn't correspond to a track walk) - a plain tween either way. A captured
        // marble waits for the capturing move's own animation to finish first (see
        // captureDelay above) instead of starting its trip home at the same instant.
        const delay = capturedIds.has(marble.id) ? captureDelay : 0;
        this.tweens.add({ targets: existing, x, y, duration: MOVE_TWEEN_MS, ease: 'Cubic.easeInOut', delay });
      }
    }

    // Marbles never leave state.marbles (fixed set per game, just change zone) - this
    // prune is defensive, not expected to run, in case that ever changes.
    for (const [id, sprite] of this.marbleSprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.marbleSprites.delete(id);
      }
    }
  }

  /** Walks a marble through each track index in sequence, then into its home-stretch slot
   * if the move ends there, rather than tweening straight to the final destination - a
   * chain of short tweens (not Phaser's tweens.chain(), to avoid depending on its exact
   * config shape across versions) so distance and duration scale together instead of a
   * 13-square move taking the same time as a 1-square one. */
  private walkMarble(sprite: Phaser.GameObjects.Image, owner: PlayerId, planned: MarbleAnimation) {
    const config = this.state!.config;
    const trackLength = trackLengthFor(config);
    const points = planned.trackIndices.map((i) => trackPoint(i, trackLength, this.geo));
    if (planned.entersHomeSlot !== null) {
      points.push(homeSlotPoint(config, owner, planned.entersHomeSlot, this.geo));
    }
    const step = (i: number) => {
      if (i >= points.length) return;
      const { x, y } = points[i];
      const arrivingHome = i === points.length - 1 && planned.entersHomeSlot !== null;
      this.tweens.add({
        targets: sprite, x, y, duration: WALK_STEP_MS, ease: 'Linear',
        onComplete: () => {
          if (arrivingHome) this.playHomeArrival(sprite);
          step(i + 1);
        },
      });
    };
    step(0);
  }

  /** A quick scale-pop when a marble's walk ends by entering home - home slots sit small
   * and crowded near the board's center (right next to the goal-tile outlines that are
   * already there regardless of occupancy), so without a distinct arrival beat this is easy
   * to miss entirely and read as "nothing happened" - especially for the custom-4 rule's
   * backward shortcut, where a marble can reach home from a spot far from the visual "lap
   * complete" moment a normal home entry has. A fixed-size flash that fades out, not a
   * shape that grows/shrinks - a brief bright square laid over the marble, gone once it
   * fades, rather than tweening the marble's own scale. */
  private playHomeArrival(sprite: Phaser.GameObjects.Image) {
    const flash = this.add.rectangle(sprite.x, sprite.y, sprite.displayWidth * 1.4, sprite.displayHeight * 1.4, 0xffffff, 0.85);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 380, ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  /** Custom-2 rule: force an opponent to draw, visualized as a card-back sprite flying
   * from the draw pile to that player's kennel - the only board-space landmark for "your
   * stuff" we have, since opponents' hands aren't rendered as card fans like the current
   * player's is (see HandPanel.tsx). Drawn face-down on purpose: a forced draw is hidden
   * information, the animation shouldn't leak what was drawn any more than a real table
   * would just by watching the deck. */
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

  private updateDecor() {
    if (!this.decorLayer) return;
    this.decorLayer.removeAll(true);
    this.drawDeckStack();
    this.drawDiscardStack();
  }

  private drawDeckStack() {
    const { x, y } = drawPileCenter(this.geo);
    const scale = this.pieceScale;
    const cardW = CARD_WIDTH * scale;
    const cardH = CARD_HEIGHT * scale;
    for (let i = 2; i >= 0; i--) {
      this.decorLayer!.add(this.add.image(x - i * 2, y - i * 2, 'card-back').setDisplaySize(cardW, cardH));
    }
  }

  private drawDiscardStack() {
    const { x, y } = discardPileCenter(this.geo);
    const card = this.state!.lastPlayedCard;
    const scale = this.pieceScale;
    const cardW = CARD_WIDTH * scale;
    const cardH = CARD_HEIGHT * scale;

    // Two backs offset behind the top card suggest a pile underneath, regardless of true
    // discard depth - tracking/rendering full discard history isn't worth it for a
    // visual-only stack.
    for (let i = 2; i >= 1; i--) {
      this.decorLayer!.add(this.add.image(x - i * 2, y - i * 2, 'card-back').setDisplaySize(cardW, cardH));
    }
    if (!card) return;

    const isNewCard = card.id !== this.lastDiscardCardId;
    this.lastDiscardCardId = card.id;

    const face = this.add.container(x, y);
    face.add(this.add.image(0, 0, `card-face-${card.rank}`).setDisplaySize(cardW, cardH));
    face.add(
      this.add
        .text(0, 0, card.rank, {
          // 20, not the old 16 - Departure Mono's glyphs sit visibly smaller than Press
          // Start 2P's bitmap letterforms did at the same nominal size.
          fontFamily: FONT_FAMILY, fontSize: `${20 * scale}px`, color: '#ffffff', stroke: '#000000', strokeThickness: 4,
        })
        .setOrigin(0.5),
    );
    this.decorLayer!.add(face);

    if (isNewCard) {
      face.setScale(0.6);
      this.tweens.add({ targets: face, scale: 1, duration: 200, ease: 'Back.easeOut' });
    }
  }
}
