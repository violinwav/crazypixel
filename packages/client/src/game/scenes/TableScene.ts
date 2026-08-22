import Phaser from 'phaser';
import {
  HOME_STRETCH_LENGTH, KENNEL_SIZE, activePlayerIds, startIndexFor, trackLengthFor,
} from '@crazypixel/shared';
import type { GameState, Marble, PlayerId } from '@crazypixel/shared';
import {
  trackPoint, kennelSlotPoint, homeSlotPoint, drawPileCenter, discardPileCenter, computeBoardGeometry,
} from '../boardLayout';
import type { BoardGeometry } from '../boardLayout';
import { PALETTE, hexToCss } from '../theme';
import { CARD_FACE_SPRITE } from '../cardArt';
import { EMPTY_TURN_ANIMATION } from '../animationPlan';
import type { CardDrawAnimation, MarbleAnimation, TurnAnimation } from '../animationPlan';

// Reference sizes at the desktop-tuned 220px track radius - scaled by REFERENCE below so
// pieces/cards shrink proportionally on a narrow phone viewport instead of overlapping.
const REFERENCE_TRACK_RADIUS = 220;
const MARBLE_SIZE = 24;
// Matches the DOM hand card's aspect ratio (150x210, see theme.css's .playing-card) - one
// consistent card shape everywhere it appears, not a separately-tuned board version.
const CARD_WIDTH = 80;
const CARD_HEIGHT = 112;
const GOAL_TILE_SIZE = 14;
const CURRENT_PLAYER_MARKER_PADDING = 24;
const MOVE_TWEEN_MS = 350;
const POP_IN_MS = 250;
const WALK_STEP_MS = 90;
const MAX_PLAYERS = 6;
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
  private boardLayer?: Phaser.GameObjects.Container;
  private currentPlayerMarkers: Phaser.GameObjects.Rectangle[] = [];
  private decorLayer?: Phaser.GameObjects.Container;
  private marbleLayer?: Phaser.GameObjects.Container;
  /** Shows "PLAYER N'S TURN" in that player's own color - was a static "CRAZYPIXEL" title,
   * replaced per feedback (the DOM TurnLabel that used to live over the hand panel is gone
   * too - this is the only turn indicator now). */
  private turnText?: Phaser.GameObjects.Text;
  private geo: BoardGeometry = {
    center: { x: 0, y: 0 }, trackRadius: 0, kennelRadius: 0, homeRadiusOuter: 0, homeRadiusStep: 0, stackOffset: 0, stackCenter: { x: 0, y: 0 }, rotation: 0,
  };
  private marbleSprites = new Map<string, Phaser.GameObjects.Image>();
  private lastDiscardCardId: string | null = null;
  private pendingPlan: MarbleAnimation[] = [];
  private pendingCaptures: string[] = [];
  /** Seat (PlayerId) -> palette/sprite index (0-5), from the lobby's color picker - default
   * identity if never set (each seat gets the palette color matching its own index). */
  private colorAssignment: number[] = [0, 1, 2, 3, 4, 5];
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
    // Loads all 6 regardless of this game's actual player count - config isn't known yet at
    // preload time, and loading a handful of unused small sprites is cheap.
    for (let p = 0; p < MAX_PLAYERS; p++) {
      this.load.image(`marble-p${p}`, `/sprites/marble-p${p}.png`);
    }
  }

  create() {
    this.turnText = this.add
      .text(0, 36, '', { fontFamily: '"Press Start 2P"', fontSize: '14px', color: '#ffffff' })
      .setOrigin(0.5);
    this.boardLayer = this.add.container(0, 0);
    // One small square per kennel slot (not inside decorLayer, which wipes and redraws every
    // render) - stable tween targets that move between bases as turns cycle, not shapes
    // destroyed and recreated each time. Four snug squares tracing the kennel's own arc read
    // as "this base is highlighted" much better than one loose rectangle bounding all of
    // them - square outline to match the board's own tile language, "you are here" from a
    // brightness pulse (not a size change), a separate looping tween on alpha left running
    // for each object's whole lifetime independent of the position tween in
    // updateCurrentPlayerHighlight below (they touch different properties, so both can run
    // on the same object at once without conflict).
    this.currentPlayerMarkers = Array.from({ length: KENNEL_SIZE }, () => {
      const marker = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0.22).setStrokeStyle(3, 0xffffff, 1);
      this.tweens.add({ targets: marker, alpha: 0.4, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      return marker;
    });
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
      // planMovement), not just a visual placeholder.
      for (let slot = 0; slot < HOME_STRETCH_LENGTH; slot++) {
        const { x, y } = homeSlotPoint(config, player, slot, this.geo);
        const color = PALETTE.players[this.colorAssignment[player]];
        this.boardLayer!.add(
          this.add.rectangle(x, y, goalSize, goalSize, color, 0.55).setStrokeStyle(2, color),
        );
      }
    });
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
    this.turnText?.setPosition(this.geo.center.x, 36);
    this.turnText?.setText(`PLAYER ${this.state.currentPlayer + 1}'S TURN`);
    this.turnText?.setColor(hexToCss(PALETTE.players[this.colorAssignment[this.state.currentPlayer]]));
    // Cheap enough to redraw every render (a turn-based game, not a twitch one) - simpler
    // than tracking whether state.config actually changed since the last call.
    this.redrawBoard();
    this.updateMarbles(animate);
    this.updateCurrentPlayerHighlight(animate);
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
      const alpha = passedOwners.has(marble.owner) ? 0.4 : 1;

      if (!existing) {
        const sprite = this.add.image(x, y, `marble-p${this.colorAssignment[marble.owner]}`).setDisplaySize(marbleSize, marbleSize).setAlpha(alpha);
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

  /** Moves the 4 persistent per-slot markers (created once in create()) to snugly ring the
   * active player's own 4 base marbles, tracing the kennel's natural arc instead of one
   * loose rectangle bounding the whole cluster - tweening between bases as turns cycle
   * rather than jumping. A resize/re-layout still snaps (animate=false), same reasoning as
   * marble positions. */
  private updateCurrentPlayerHighlight(animate: boolean) {
    if (this.currentPlayerMarkers.length === 0 || !this.state) return;
    const config = this.state.config;
    const player = this.state.currentPlayer;
    const size = (MARBLE_SIZE + CURRENT_PLAYER_MARKER_PADDING) * this.pieceScale;
    const color = PALETTE.players[this.colorAssignment[player]];

    this.currentPlayerMarkers.forEach((marker, slot) => {
      const { x, y } = kennelSlotPoint(config, player, slot, this.geo);
      marker.setFillStyle(color, 0.22);
      marker.setStrokeStyle(3, color, 1);
      marker.setSize(size, size);

      if (!animate) {
        marker.setPosition(x, y);
        return;
      }
      // Tweening to the same position (player unchanged, e.g. this render was actually
      // triggered by something else) is a harmless no-op - no need to special-case it.
      this.tweens.add({ targets: marker, x, y, duration: MOVE_TWEEN_MS, ease: 'Cubic.easeInOut' });
    });
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
          fontFamily: '"Press Start 2P"', fontSize: `${16 * scale}px`, color: '#ffffff', stroke: '#000000', strokeThickness: 4,
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
