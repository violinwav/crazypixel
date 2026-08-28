// Player color is a continuous hue (0-359), not a pick from a fixed palette - fixed
// saturation/lightness keep every possible pick in the same soft pastel family (readable
// against the board's monochrome chrome, distinct from suit red) rather than letting a
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

/** Hue (0-359) -> 24-bit RGB int, at this game's fixed pastel saturation/lightness. Used
 * both for on-screen swatches (ColorSlider, seat lists) and as the Phaser tint applied to
 * the neutral marble sprite (TableScene.ts) - one conversion, one look everywhere. */
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

// The emote feed's text variant of the same hue. Deliberately brighter than the marble/
// swatch pastel above, and it exists because that pastel is not a legible text color: at
// L=68 the worst hue on the wheel (240, where R and G both sit at the HSL floor and only B
// is high - and R+G carry ~93% of relative luminance) lands at 4.56:1 on the board's own
// backdrop. That clears WCAG AA for normal text by 1.3%, leaving nothing at all for the
// feed's fade-with-age ramp to spend - a single step down to 0.9 alpha already fails
// (3.94:1). At L=82 the same worst hue is 8.30:1, which is what buys the ramp room to reach
// 0.7 alpha and still measure 4.68:1. Same hue in, so a message still reads as unmistakably
// that player's color - only the lightness differs, which is the part that was never
// carrying the identity.
const TEXT_SATURATION = 85;
const TEXT_LIGHTNESS = 82;

export function hueToTextCss(hue: number): string {
  return `hsl(${((hue % 360) + 360) % 360} ${TEXT_SATURATION}% ${TEXT_LIGHTNESS}%)`;
}
