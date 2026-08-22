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

function pollForRealSize(game: Phaser.Game, parent: HTMLElement, attemptsLeft: number) {
  const { width, height } = parent.getBoundingClientRect();
  if (width > 0 && height > 0) {
    game.scale.resize(width, height);
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

  // The flex-sized parent div is frequently still 0x0 at construction time (before the
  // browser finishes laying out the flex tree), and TableScene.create() runs against
  // whatever size it finds then - a later resize() call doesn't retroactively fix positions
  // a scene already computed against 0x0, which is why TableScene also listens for the
  // Scale Manager's 'resize' event and redraws everything (see that file). This just needs
  // to guarantee *a* resize actually happens once real dimensions exist.
  //
  // requestAnimationFrame was tried first and was unreliable here - rAF gets throttled in
  // backgrounded/non-focused tabs (which an automated browser pane often is from the
  // browser's own perspective), so a fixed frame count sometimes measured before layout
  // settled and sometimes long after. ResizeObserver's documented "fires once immediately
  // with the current size" behavior was also unreliable in testing, most likely because
  // that first callback can itself land before layout has settled - and since it only
  // fires again on a *change*, if the real size is reached without a further change to
  // report, it never gets a second chance. setTimeout polling doesn't depend on either of
  // those timing assumptions.
  pollForRealSize(game, parent, MAX_SIZE_POLL_ATTEMPTS);

  // Backstop for *later* real resizes (window resize, orientation change).
  const resizeObserver = new ResizeObserver(() => {
    const { width, height } = parent.getBoundingClientRect();
    if (width > 0 && height > 0) game.scale.resize(width, height);
  });
  resizeObserver.observe(parent);
  game.events.once('destroy', () => resizeObserver.disconnect());

  // React only calls setGameState when its state reference actually changes - on mount,
  // that's a single call carrying the initial state. If `game.scene.getScene('TableScene')`
  // doesn't resolve yet at that exact moment (scene registration isn't instant even though
  // the Game constructor above looks synchronous), that one call silently no-ops via the
  // optional chain below and is never retried, since nothing about the game state changes
  // again until a move is actually played - the board would stay empty indefinitely. Keeping
  // the latest state here and re-pushing it once Phaser's own READY event fires closes that
  // gap regardless of exactly when scene registration completes.
  let latestState: GameState | null = null;
  let latestPlan: TurnAnimation = EMPTY_TURN_ANIMATION;
  let latestColors: number[] | null = null;
  let latestViewerSeat: PlayerId | null = null;
  const pushState = () => {
    const scene = game.scene.getScene('TableScene') as TableScene | null;
    if (!scene) return;
    if (latestColors) scene.setColorAssignment(latestColors);
    // Before setGameState, which is what actually triggers the re-layout that reads it.
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
