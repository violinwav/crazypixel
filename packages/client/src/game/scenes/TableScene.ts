import Phaser from 'phaser';
import {
  TRACK_LENGTH, START_INDEX, KENNEL_SIZE, PLAYER_IDS, createDeck,
} from '@crazypixel/shared';
import { PALETTE, SUIT_GLYPH, SUIT_COLOR } from '../theme';

const TRACK_RADIUS = 220;
const KENNEL_RADIUS = 300;
const TILE_SIZE = 22;
const MARBLE_RADIUS = 8;

// Placeholder programmer-art board: a ring standing in for the real cross-shaped Brändi Dog
// track until hand-drawn pixel tiles replace it. Keeps arm/start-square math (from
// @crazypixel/shared) visually honest without committing to final art yet.
export class TableScene extends Phaser.Scene {
  constructor() {
    super('TableScene');
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2 - 40;

    this.add
      .text(cx, 36, 'CRAZYPIXEL', {
        fontFamily: '"Press Start 2P"',
        fontSize: '20px',
        color: '#f4f1ff',
      })
      .setOrigin(0.5);

    this.drawTrack(cx, cy);
    this.drawStartMarkers(cx, cy);
    this.drawKennels(cx, cy);
    this.drawSampleHand(cx, height);
  }

  private trackPoint(index: number, cx: number, cy: number) {
    const angle = (index / TRACK_LENGTH) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * TRACK_RADIUS, y: cy + Math.sin(angle) * TRACK_RADIUS };
  }

  private drawTrack(cx: number, cy: number) {
    for (let i = 0; i < TRACK_LENGTH; i++) {
      const { x, y } = this.trackPoint(i, cx, cy);
      const isStart = PLAYER_IDS.some((p) => START_INDEX[p] === i);
      this.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE, isStart ? PALETTE.accent : PALETTE.bgPanel)
        .setStrokeStyle(2, PALETTE.bgRaised);
    }
  }

  private drawStartMarkers(cx: number, cy: number) {
    PLAYER_IDS.forEach((player) => {
      const { x, y } = this.trackPoint(START_INDEX[player], cx, cy);
      this.add.circle(x, y, MARBLE_RADIUS, PALETTE.players[player]).setStrokeStyle(2, PALETTE.bgDeep);
    });
  }

  private drawKennels(cx: number, cy: number) {
    PLAYER_IDS.forEach((player) => {
      const angle = (START_INDEX[player] / TRACK_LENGTH) * Math.PI * 2 - Math.PI / 2;
      for (let slot = 0; slot < KENNEL_SIZE; slot++) {
        const offsetAngle = angle + (slot - 1.5) * 0.18;
        const x = cx + Math.cos(offsetAngle) * KENNEL_RADIUS;
        const y = cy + Math.sin(offsetAngle) * KENNEL_RADIUS;
        this.add.circle(x, y, MARBLE_RADIUS, PALETTE.players[player]).setStrokeStyle(2, PALETTE.bgDeep);
      }
    });
  }

  private drawSampleHand(cx: number, height: number) {
    const sample = createDeck().slice(0, 6);
    const cardWidth = 54;
    const cardHeight = 76;
    const gap = 10;
    const totalWidth = sample.length * (cardWidth + gap) - gap;
    const startX = cx - totalWidth / 2 + cardWidth / 2;
    const y = height - cardHeight / 2 - 24;

    sample.forEach((card, i) => {
      const x = startX + i * (cardWidth + gap);
      this.add.rectangle(x, y, cardWidth, cardHeight, 0xf4f1ff).setStrokeStyle(3, PALETTE.bgDeep);

      this.add
        .text(x, y - 18, card.rank, {
          fontFamily: '"Pixelify Sans"',
          fontSize: '18px',
          color: '#0d0a1f',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      if (card.suit) {
        const suitColor = Phaser.Display.Color.IntegerToColor(SUIT_COLOR[card.suit]).rgba;
        this.add
          .text(x, y + 14, SUIT_GLYPH[card.suit], { fontFamily: '"Pixelify Sans"', fontSize: '22px', color: suitColor })
          .setOrigin(0.5);
      }
    });
  }
}
