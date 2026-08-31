// A quiet, always-behind pixel-dither background: the react-bits PixelBlast idea redone on a
// plain <canvas>/Canvas2D instead of three.js + postprocessing WebGL. No external deps, no
// shader pipeline, no GPU context to lose - Phaser's own Canvas renderer already proves
// Canvas2D paints reliably in every environment this project has been tested in, which the
// WebGL path never did.

import { useEffect, useRef } from 'react';

interface Props {
  className?: string;
  /** '#rrggbb', matching hueToCss's output. Defaults to white (the lobby look); GameBoard
   * overrides it to the current player's color while a game is active. Ignored when `vivid` is
   * set - that mode is white-only. */
  color?: string;
  /** Denser, brighter, multi-level-white variant, used for the menu background. Still strictly
   * monochrome: the difference is a smaller cell, a higher alpha ceiling, and quantizing each
   * cell into discrete bands instead of plain on/off, so more of the white-to-black range
   * actually shows. */
  vivid?: boolean;
  /** Defaults to true (lobby, and local hotseat). Online sets it false whenever it isn't the
   * viewer's turn. Crossfades via the CSS transition rather than unmounting, so the animation's
   * own phase doesn't reset every time visibility flips. */
  visible?: boolean;
}

const CELL = 12; // CSS px per grid cell - chunky on purpose, this is a pixel-art background
const VIVID_CELL = 8;
const DEFAULT_COLOR = '#ffffff';
const BASE_ALPHA = 0.04;
const ON_ALPHA = 0.22;
// Dimmest to brightest alpha a vivid cell can land on - more headroom than the default look's
// flat two tones at both ends, so banding reads as "brighter, more levels" and not just denser.
const VIVID_LEVELS = [0.05, 0.14, 0.24, 0.36, 0.52];
const SPEED = 0.35;
const VIVID_SPEED = 0.55;

// 4x4 Bayer matrix, values 0-15 - ordered dithering, the same technique the earlier WebGL
// attempt used, via plain Canvas2D here.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** '#rrggbb' to 'r, g, b', so draw() can build rgba(${rgb}, alpha) strings unchanged whether
 * the color came from the default or from a real hue. */
function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/** Continuous cell brightness in [0, 1]. */
function valueAt(cx: number, cy: number, t: number): number {
  const a = Math.sin(cx * 0.12 + t) * Math.sin(cy * 0.1 - t * 0.7);
  const b = Math.sin((cx + cy) * 0.05 - t * 0.4);
  return (a * 0.6 + b * 0.4 + 1) * 0.5;
}

/**
 * Quantizes `v` into one of VIVID_LEVELS' discrete alpha bands, using the Bayer matrix as a
 * sub-band dither so the *boundary* between two bands is ordered-dithered rather than a hard
 * edge - the classic N-level ordered dither, applied to alpha bands instead of on/off. Takes
 * the already-computed `v` because draw() needs it for both modes.
 */
function bandFor(v: number, cx: number, cy: number): number {
  const scaled = v * VIVID_LEVELS.length;
  const base = Math.floor(scaled);
  const frac = scaled - base;
  const bayerThreshold = BAYER[cy % 4][cx % 4] / 16;
  const level = frac > bayerThreshold ? base + 1 : base;
  return VIVID_LEVELS[Math.max(0, Math.min(VIVID_LEVELS.length - 1, level))];
}

/**
 * Draws its first frame synchronously on mount, not scheduled via requestAnimationFrame, so
 * there is never a blank moment waiting on a frame a backgrounded or unfocused tab might delay
 * - the exact failure mode the WebGL version turned out to have.
 */
export function PixelDither({ className, color, vivid = false, visible = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The animation loop (or, under reduced motion, the one-shot draw) reads color and vivid
  // through refs rather than closing over the props. The loop is set up once on mount, so a
  // later prop change needs some way to reach an already-running rAF loop without tearing the
  // whole thing down and restarting the dither's phase from scratch every turn.
  const colorRef = useRef(hexToRgbTriplet(color ?? DEFAULT_COLOR));
  const vividRef = useRef(vivid);
  // The reduced-motion path never loops - draw() runs once up front - so a prop change there has
  // no tick to be picked up on and needs an explicit redraw. resizeRef too: vivid mode uses a
  // smaller cell, so toggling it needs the grid re-measured, not just redrawn at the old size.
  const redrawRef = useRef<() => void>(() => {});
  const resizeRef = useRef<() => void>(() => {});

  useEffect(() => {
    colorRef.current = hexToRgbTriplet(color ?? DEFAULT_COLOR);
    vividRef.current = vivid;
    resizeRef.current();
    redrawRef.current();
  }, [color, vivid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0;
    let rows = 0;
    let raf = 0;
    let time = 0;

    const cellSize = () => (vividRef.current ? VIVID_CELL : CELL);

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth;
      canvas.height = clientHeight;
      const cell = cellSize();
      cols = Math.ceil(clientWidth / cell) + 1;
      rows = Math.ceil(clientHeight / cell) + 1;
    };

    const draw = () => {
      const isVivid = vividRef.current;
      const rgb = colorRef.current;
      const cell = cellSize();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          // One shared clock for every cell in both modes. A per-cell independent speed drifted
          // vivid mode's cells apart, but cost an extra sin() pair per cell per frame, and its
          // phases tended toward visibly symmetric moments over a long session rather than
          // staying random.
          const v = valueAt(cx, cy, time);
          const alpha = isVivid ? bandFor(v, cx, cy) : (v > BAYER[cy % 4][cx % 4] / 16 ? ON_ALPHA : BASE_ALPHA);
          ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
          ctx.fillRect(cx * cell, cy * cell, cell - 1, cell - 1);
        }
      }
    };
    redrawRef.current = draw;
    resizeRef.current = resize;

    resize();
    draw(); // first frame, synchronous - never waits on rAF

    if (reduceMotion) return undefined;

    let lastTs = 0;
    const animate = (ts: number) => {
      const dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      time += dt * (vividRef.current ? VIVID_SPEED : SPEED);
      draw();
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      redrawRef.current = () => {};
      resizeRef.current = () => {};
    };
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ opacity: visible ? 1 : 0 }} aria-hidden="true" />;
}
