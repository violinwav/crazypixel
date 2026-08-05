// Mirrors styles/theme.css. Phaser draws on canvas and needs numeric hex colors, CSS needs
// strings, so the two are kept in sync by hand for now.
export const PALETTE = {
  bgDeep: 0x0d0a1f,
  bgPanel: 0x1a1435,
  bgRaised: 0x241c4a,
  ink: 0xf4f1ff,
  inkDim: 0xb7aee0,
  accent: 0xffd23f,
  players: [0xff5470, 0x3fb0ff, 0xffe66d, 0x38e58f] as const,
};

// Suits are distinguished by glyph shape first, color second - don't rely on color alone.
export const SUIT_GLYPH: Record<string, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

export const SUIT_COLOR: Record<string, number> = {
  spades: 0x0d0a1f,
  clubs: 0x0d0a1f,
  hearts: 0xd22c50, // darker than PALETTE.players[0] - 0xff5470 on a white card face fails AA text contrast
  diamonds: 0xd22c50,
};
