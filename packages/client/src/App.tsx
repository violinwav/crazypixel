// Top-level screen switch: lobby, local hotseat game, or online game. Also owns the single
// app-wide dither background, which the active board tints via onBackgroundChange.

import { useState } from 'react';
import { Lobby } from './Lobby';
import type { GameSetup } from './Lobby';
import type { OnlineSession } from './game/network';
import { GameView } from './GameView';
import { OnlineGameView } from './OnlineGameView';
import { PixelDither } from './PixelDither';
import type { BoardBackground } from './GameBoard';
import { usePlayerIdentity } from './game/playerIdentity';

export default function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);
  // Set by GameBoard once a game is active; null on the lobby screens, where the background
  // keeps its plain default look.
  const [background, setBackground] = useState<BoardBackground | null>(null);
  const [identity, setIdentity] = usePlayerIdentity();

  const inGame = Boolean(onlineSession || setup);

  let content;
  if (onlineSession) {
    content = <OnlineGameView session={onlineSession} onBackgroundChange={setBackground} />;
  } else if (setup) {
    content = <GameView setup={setup} onBackgroundChange={setBackground} />;
  } else {
    content = (
      <Lobby identity={identity} onIdentityChange={setIdentity} onStart={setSetup} onOnlineReady={setOnlineSession} />
    );
  }

  return (
    <>
      <PixelDither
        className="app-background"
        color={background?.color}
        // The vivid (denser, brighter, multi-level white) look is menu-only - GameBoard's
        // single-hue per-player tint takes over the instant a game starts.
        vivid={!inGame}
        visible={background?.visible ?? true}
      />
      <div className="app-content">{content}</div>
    </>
  );
}
