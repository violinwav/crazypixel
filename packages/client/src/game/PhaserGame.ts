// Constructs the Phaser game and exposes a small imperative bridge to it. React never talks
// to TableScene directly; it pushes state through here.

import Phaser from 'phaser';
import type { GameState, PlayerId } from '@crazypixel/shared';
import { PALETTE } from './theme';
import { TableScene } from './scenes/TableScene';
import { EMPTY_TURN_ANIMATION } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

export interface PhaserBridge {
  game: Phaser.Game;
  setGameState: (state: GameState, plan?: TurnAnimation) => void;
  setColorAssignment: (colors: number[]) => void;
  setViewerSeat: (seat: PlayerId) => void;
}

const SIZE_POLL_INTERVAL_MS = 50;
const MAX_SIZE_POLL_ATTEMPTS = 60; // 3s worst case - generous for any real layout

/**
 * The flex-sized parent is frequently still 0x0 at construction time, and TableScene.create()
 * runs against whatever size it finds then. This just guarantees *a* resize happens once real
 * dimensions exist; TableScene redraws everything on the Scale Manager's 'resize' event.
 *
 * setTimeout rather than requestAnimationFrame, which is throttled in backgrounded or
 * unfocused tabs - a fixed frame count sometimes measured before layout settled and sometimes
 * long after. ResizeObserver's "fires once immediately" behavior was unreliable too: that
 * first callback can itself land before layout settles, and it only fires again on a change,
 * so if the real size arrives without a further change to report there is no second chance.
 */
function pollForRealSize(game: Phaser.Game, parent: HTMLElement, attemptsLeft: number) {
  const { width, height } = parent.getBoundingClientRect();
  if (width > 0 && height > 0) {
    game.scale.setParentSize(width, height);
    return;
  }
  if (attemptsLeft <= 0) return; // give up - the ResizeObserver below remains as a backstop
  setTimeout(() => pollForRealSize(game, parent, attemptsLeft - 1), SIZE_POLL_INTERVAL_MS);
}

export function createPhaserGame(parent: HTMLElement): PhaserBridge {
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    backgroundColor: PALETTE.bgDeep,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [TableScene],
  });

  pollForRealSize(game, parent, MAX_SIZE_POLL_ATTEMPTS);

  // Backstop for later real resizes (window resize, orientation change). setParentSize, not
  // resize: in RESIZE scale mode, ScaleManager's refresh() cycle - which Phaser's own resize
  // listeners also trigger - re-derives canvas size from its cached parentSize, not from
  // resize()'s arguments. resize() appears to work in the moment, then any later refresh can
  // silently re-derive from the stale cache and undo it. setParentSize updates that cache.
  const resizeObserver = new ResizeObserver(() => {
    const { width, height } = parent.getBoundingClientRect();
    if (width > 0 && height > 0) game.scale.setParentSize(width, height);
  });
  resizeObserver.observe(parent);
  game.events.once('destroy', () => resizeObserver.disconnect());

  // React only calls the setters when its own state reference changes - on mount that's a
  // single call carrying the initial state. If the scene isn't registered at that exact
  // moment (registration isn't instant despite the Game constructor looking synchronous),
  // that one call would no-op and never be retried, since nothing changes again until a move
  // is played, leaving the board empty indefinitely. Holding the latest values here and
  // re-pushing on Phaser's READY event closes that gap.
  let latestState: GameState | null = null;
  let latestPlan: TurnAnimation = EMPTY_TURN_ANIMATION;
  let latestColors: number[] | null = null;
  let latestViewerSeat: PlayerId | null = null;

  const pushState = () => {
    const scene = game.scene.getScene('TableScene') as TableScene | null;
    if (!scene) return;
    if (latestColors) scene.setColorAssignment(latestColors);
    // Before setGameState, which triggers the re-layout that reads it.
    if (latestViewerSeat !== null) scene.setViewerSeat(latestViewerSeat);
    if (latestState) scene.setGameState(latestState, latestPlan);
  };
  game.events.once(Phaser.Core.Events.READY, pushState);

  const setGameState = (state: GameState, plan: TurnAnimation = EMPTY_TURN_ANIMATION) => {
    latestState = state;
    latestPlan = plan;
    pushState();
  };

  const setColorAssignment = (colors: number[]) => {
    latestColors = colors;
    pushState();
  };

  const setViewerSeat = (seat: PlayerId) => {
    latestViewerSeat = seat;
    pushState();
  };

  return { game, setGameState, setColorAssignment, setViewerSeat };
}
