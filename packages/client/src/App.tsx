import { useState } from 'react';
import { Lobby } from './Lobby';
import type { GameSetup } from './Lobby';
import type { OnlineSession } from './OnlineLobby';
import { GameView } from './GameView';
import { OnlineGameView } from './OnlineGameView';
import { PixelDither } from './PixelDither';

export default function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);

  let content;
  if (onlineSession) {
    content = <OnlineGameView session={onlineSession} />;
  } else if (setup) {
    content = <GameView setup={setup} />;
  } else {
    content = <Lobby onStart={setSetup} onOnlineReady={setOnlineSession} />;
  }

  return (
    <>
      <PixelDither className="app-background" />
      <div className="app-content">{content}</div>
    </>
  );
}
