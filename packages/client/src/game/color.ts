// Player color is a continuous hue (0-359), not a pick from a fixed palette. Saturation and
// lightness are fixed so every possible pick stays in the same soft pastel family - readable
// against the board's monochrome chrome, distinct from suit red - instead of letting a
// player land on something near-black or neon that fights the rest of the UI.

const SATURATION = 70;
const LIGHTNESS = 68;

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/**
 * Hue (0-359) to a 24-bit RGB int at this game's fixed pastel saturation/lightness. Backs
 * both the on-screen swatches and the Phaser marble recolor (TableScene.tintedMarbleKey),
 * so one conversion gives one look everywhere.
 */
export function hueToHex(hue: number): number {
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = SATURATION / 100;
  const l = LIGHTNESS / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return (v << 16) + (v << 8) + v;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, h) * 255);
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  return (r << 16) + (g << 8) + b;
}

export function hueToCss(hue: number): string {
  return `#${hueToHex(hue).toString(16).padStart(6, '0')}`;
}

// A brighter variant of the same hue, for text. The pastel above is not a legible text
// color: at L=68 the worst hue on the wheel (240, where R and G sit at the HSL floor and
// together carry ~93% of relative luminance) measures 4.56:1 on the board's backdrop. That
// clears WCAG AA by 1.3% and leaves nothing for the emote feed's fade-with-age ramp to
// spend - one step down to 0.9 alpha already fails at 3.94:1. At L=82 the same worst hue is
// 8.30:1, which buys the ramp room to reach 0.7 alpha and still measure 4.68:1. Same hue in,
// so a message still reads as unmistakably that player's color.
const TEXT_SATURATION = 85;
const TEXT_LIGHTNESS = 82;

/** The text-legible variant of a player's hue - see the note above for the contrast math. */
export function hueToTextCss(hue: number): string {
  return `hsl(${((hue % 360) + 360) % 360} ${TEXT_SATURATION}% ${TEXT_LIGHTNESS}%)`;
}
