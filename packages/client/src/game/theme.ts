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

/** Phaser text/DOM CSS want a "#rrggbb" string - Phaser.Display.Color exists for this, but a
 * one-line format doesn't need pulling in a whole Color object for it. */
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** PixelDither's rgba() template wants "r, g, b" (see its own COLOR constant) - used to tint
 * it per-player instead of the fixed white it was built with. */
export function hexToRgbString(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}
