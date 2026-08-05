import { useEffect, useRef } from 'react';

interface Props {
  className?: string;
}

const CELL = 12; // CSS px per grid cell - chunky on purpose, this is a pixel-art background
const COLOR = '255, 255, 255';
const BASE_ALPHA = 0.04;
const ON_ALPHA = 0.22;
const SPEED = 0.35;

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

function valueAt(cx: number, cy: number, t: number): number {
  const a = Math.sin(cx * 0.12 + t) * Math.sin(cy * 0.1 - t * 0.7);
  const b = Math.sin((cx + cy) * 0.05 - t * 0.4);
  return (a * 0.6 + b * 0.4 + 1) * 0.5; // -> [0, 1]
}

/** A quiet, always-behind pixel-dither background - the react-bits PixelBlast idea, redone
 * on a plain <canvas>/Canvas2D instead of three.js+postprocessing WebGL. Draws its first
 * frame synchronously on mount (not just scheduled via requestAnimationFrame) so there's
 * never a blank moment waiting on an animation frame that a backgrounded/unfocused tab
 * might delay - the exact failure mode the WebGL version turned out to have. */
export function PixelDither({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth;
      canvas.height = clientHeight;
      cols = Math.ceil(clientWidth / CELL) + 1;
      rows = Math.ceil(clientHeight / CELL) + 1;
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(${COLOR}, ${BASE_ALPHA})`;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const v = valueAt(cx, cy, time);
          const threshold = BAYER[cy % 4][cx % 4] / 16;
          const on = v > threshold;
          ctx.fillStyle = `rgba(${COLOR}, ${on ? ON_ALPHA : BASE_ALPHA})`;
          ctx.fillRect(cx * CELL, cy * CELL, CELL - 1, CELL - 1);
        }
      }
    };

    resize();
    draw(); // first frame, synchronous - never waits on rAF

    if (reduceMotion) return undefined;

    let lastTs = 0;
    const animate = (ts: number) => {
      const dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      time += dt * SPEED;
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
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
