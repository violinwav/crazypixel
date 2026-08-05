import Phaser from 'phaser';
import { PALETTE } from './theme';
import { TableScene } from './scenes/TableScene';

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: PALETTE.bgDeep,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [TableScene],
  });

  // RESIZE mode only re-measures on window resize events, not on the flex-sized parent
  // div's own size changes - and that parent is often still 0x0 at construction time,
  // before the browser finishes laying out the flex tree. Without this, the canvas can
  // permanently lock in at 0x0. A ResizeObserver catches both cases.
  const resizeObserver = new ResizeObserver(() => game.scale.refresh());
  resizeObserver.observe(parent);
  game.events.once('destroy', () => resizeObserver.disconnect());

  return game;
}
