import { useEffect, useRef } from 'react';

interface Props {
  className?: string;
  /** '#rrggbb' hex, matching hueToCss's output (game/color.ts) - defaults to white (the
   * lobby/menu look). GameBoard.tsx overrides this to the current player's color while a
   * game is active. Ignored when `vivid` is set (that mode is white-only, see below). */
  color?: string;
  /** Denser, brighter, multi-level-white variant - App.tsx sets this for the menu/lobby
   * background only. Still strictly monochrome (this project's chrome always is - see
   * theme.css's opening comment): the difference from the default look is a smaller cell
   * size, a higher ceiling on alpha, and quantizing each cell's brightness into several
   * discrete bands (bandFor below) instead of a plain on/off, so more of the white/black
   * range actually shows instead of just two flat tones. GameBoard's in-game background
   * (`color` set instead) is untouched - this is purely additive. */
  vivid?: boolean;
  /** Defaults to true (lobby/menu, and local hotseat - see GameBoard.tsx's onBackgroundChange).
   * Online play sets this to false whenever it isn't the viewer's own turn. Crossfades via
   * the `.app-background` CSS transition rather than unmounting, so the animation's own
   * phase doesn't reset every time visibility flips. */
  visible?: boolean;
}

const CELL = 12; // CSS px per grid cell - chunky on purpose, this is a pixel-art background
const VIVID_CELL = 8; // denser grid for the menu look - "more density in pixels"
const DEFAULT_COLOR = '#ffffff';
const BASE_ALPHA = 0.04;
const ON_ALPHA = 0.22;
// Dimmest -> brightest white alpha a cell can land on in vivid mode - more headroom than the
// default look's flat two-tone (BASE_ALPHA/ON_ALPHA) on both ends, so quantizing into bands
// (bandFor below) actually reads as "brighter overall, more visible levels," not just denser.
const VIVID_LEVELS = [0.05, 0.14, 0.24, 0.36, 0.52];
const SPEED = 0.35;
const VIVID_SPEED = 0.55;

// 4x4 Bayer matrix, values 0-15 - ordered dithering, same technique the earlier WebGL
// PixelBlast attempt used, just via plain Canvas2D here instead of three.js/postprocessing.
// No external deps, no shader pipeline, no GPU context to lose - "our techstack" already
// has Phaser's own Canvas renderer proving Canvas2D reliably paints in every environment
// this project has been tested in, which the WebGL path never did.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** '#rrggbb' -> 'r, g, b', so draw() below can keep building rgba(${rgb}, alpha) strings
 * unchanged regardless of whether color came from the DEFAULT_COLOR fallback or a real hex
 * value (hueToCss, game/color.ts). */
function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function valueAt(cx: number, cy: number, t: number): number {
  const a = Math.sin(cx * 0.12 + t) * Math.sin(cy * 0.1 - t * 0.7);
  const b = Math.sin((cx + cy) * 0.05 - t * 0.4);
  return (a * 0.6 + b * 0.4 + 1) * 0.5; // -> [0, 1]
}

/** Quantizes valueAt's continuous [0,1) brightness into one of VIVID_LEVELS' discrete alpha
 * bands, using the Bayer matrix as a sub-band dither so the *boundary* between two bands
 * gets ordered-dithered rather than landing on a hard, banded edge - the classic "N-level
 * ordered dither" technique, just applied to alpha bands instead of a binary on/off. Takes
 * the already-computed `v` rather than calling valueAt itself - draw() below needs `v` for
 * both modes, no reason to compute it twice for vivid's cells. */
function bandFor(v: number, cx: number, cy: number): number {
  const scaled = v * VIVID_LEVELS.length;
  const base = Math.floor(scaled);
  const frac = scaled - base;
  const bayerThreshold = BAYER[cy % 4][cx % 4] / 16;
  const level = frac > bayerThreshold ? base + 1 : base;
  return VIVID_LEVELS[Math.max(0, Math.min(VIVID_LEVELS.length - 1, level))];
}

/** A quiet, always-behind pixel-dither background - the react-bits PixelBlast idea, redone
 * on a plain <canvas>/Canvas2D instead of three.js+postprocessing WebGL. Draws its first
 * frame synchronously on mount (not just scheduled via requestAnimationFrame) so there's
 * never a blank moment waiting on an animation frame that a backgrounded/unfocused tab
 * might delay - the exact failure mode the WebGL version turned out to have. */
export function PixelDither({ className, color, vivid = false, visible = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The animation loop (or, under reduced-motion, the one-shot draw) reads color/vivid
  // through these refs rather than closing over the props directly - set up once on mount
  // (empty deps below) so a later prop change needs some way to reach an already-running
  // rAF loop without tearing the whole thing down and restarting the dither's own phase/
  // animation-frame timing from scratch every time a turn (or menu<->game transition) changes it.
  const colorRef = useRef(hexToRgbTriplet(color ?? DEFAULT_COLOR));
  const vividRef = useRef(vivid);
  // Sidesteps the same problem for the reduced-motion path, which never loops - draw() only
  // runs once up front there, so a prop change has no rAF tick to pick it up on its own and
  // needs an explicit redraw call instead. resizeRef too - vivid mode uses a smaller cell
  // size, so toggling it needs the grid re-measured, not just redrawn at the old cell size.
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
          // One shared clock for every cell, both modes - a per-cell independent speed
          // used to drift vivid mode's cells apart, but the extra sin() pair it cost every
          // cell every frame added up, and its phases drifting apart over a long session
          // tended toward visibly symmetric/mirrored moments rather than staying random.
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
