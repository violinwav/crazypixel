// Phaser's numeric-hex copy of the palette. Mirrors styles/theme.css (CSS strings) and
// scripts/generate-sprites.py's PALETTE (RGB tuples), kept in sync by hand (see CLAUDE.md's
// Conventions). NOTE: CLAUDE.md says three copies; there is a fourth - TurnTimerBar.tsx's
// URGENT_COLOR duplicates --player-red as a raw [255, 84, 112] triple.
export const PALETTE = {
  bgDeep: 0x000000,
  bgPanel: 0x181818,
  bgRaised: 0x2c2c2c,
  ink: 0xffffff,
  inkDim: 0x999999,
  accent: 0xffffff,
  /** Six seats: red/blue/yellow/green, plus purple/orange. */
  players: [0xff5470, 0x3fb0ff, 0xffe66d, 0x38e58f, 0xb967ff, 0xff9f40] as const,
  cardRed: 0xd22c50,
};
