import { useState } from 'react';
import { Lobby } from './Lobby';
import type { GameSetup } from './Lobby';
import { GameView } from './GameView';
import { PixelDither } from './PixelDither';

export default function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  return (
    <>
      <PixelDither className="app-background" />
      <div className="app-content">
        {setup ? <GameView setup={setup} /> : <Lobby onStart={setSetup} />}
      </div>
    </>
  );
}
