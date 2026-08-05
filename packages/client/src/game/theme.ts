// Mirrors styles/theme.css AND scripts/generate-sprites.py's PALETTE dict. Three copies
// of the same values across CSS/TS/Python, kept in sync by hand for now - Phaser draws on
// canvas and needs numeric hex, CSS needs strings, the sprite generator needs RGB tuples.
export const PALETTE = {
  bgDeep: 0x000000,
  bgPanel: 0x181818,
  bgRaised: 0x2c2c2c,
  ink: 0xffffff,
  inkDim: 0x999999,
  accent: 0xffffff,
  // 6 entries for up to 6 players - red/blue/yellow/green (original 4) + purple/orange.
  players: [0xff5470, 0x3fb0ff, 0xffe66d, 0x38e58f, 0xb967ff, 0xff9f40] as const,
  cardRed: 0xd22c50,
};
