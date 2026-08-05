import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createPhaserGame } from './game/PhaserGame';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    gameRef.current = createPhaserGame(containerRef.current);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <h1 className="visually-hidden">CrazyPixel</h1>
      <div
        ref={containerRef}
        role="img"
        aria-label="Game board placeholder preview: board tiles, player marbles, and sample playing cards. Static, not yet interactive."
        style={{ flex: 1, minHeight: 0 }}
      />
    </main>
  );
}
