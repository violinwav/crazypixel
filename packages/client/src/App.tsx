import { useState } from 'react';
import { Lobby } from './Lobby';
import type { GameSetup } from './Lobby';
import type { OnlineSession } from './OnlineLobby';
import { GameView } from './GameView';
import { OnlineGameView } from './OnlineGameView';
import { PixelDither } from './PixelDither';
import type { BoardBackground } from './GameBoard';

export default function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);
  // Set by GameBoard once a game is active (see its onBackgroundChange prop) - null outside
  // a game (lobby/menu screens), where the background just stays its plain default look.
  const [background, setBackground] = useState<BoardBackground | null>(null);

  let content;
  if (onlineSession) {
    content = <OnlineGameView session={onlineSession} onBackgroundChange={setBackground} />;
  } else if (setup) {
    content = <GameView setup={setup} onBackgroundChange={setBackground} />;
  } else {
    content = <Lobby onStart={setSetup} onOnlineReady={setOnlineSession} />;
  }

  return (
    <>
      <PixelDither className="app-background" color={background?.color} visible={background?.visible ?? true} />
      <div className="app-content">{content}</div>
    </>
  );
}
