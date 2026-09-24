// Top-level screen switch: lobby, local hotseat game, or online game. Also owns the single
// app-wide dither background, which the active board tints via onBackgroundChange.

import { useEffect, useState } from 'react';
import type { Room } from 'colyseus.js';
import type { PlayerId } from '@crazypixel/shared';
import { Lobby } from './Lobby';
import type { GameSetup } from './Lobby';
import { forgetRoom, reconnectRoom, savedReconnectionToken } from './game/network';
import type { OnlineSession, RoomState } from './game/network';
import { GameView } from './GameView';
import { OnlineGameView } from './OnlineGameView';
import { PixelDither } from './PixelDither';
import type { BoardBackground } from './GameBoard';
import { usePlayerIdentity } from './game/playerIdentity';
import { primeAudio } from './game/audio';

// Module scope, not an effect: StrictMode double-invokes effects without cleanup in dev, and
// primeAudio is idempotent but there is no reason to make it defend against that. Arming only
// registers listeners - it builds no AudioContext and makes no sound until a real gesture.
primeAudio();

// Module scope for the same reason as primeAudio: a reconnection token is single-use, so
// StrictMode's second effect run would burn it on a doomed second attempt - and could even
// win the race, leaving the first attempt's Room orphaned. Every caller shares one attempt.
let resumeAttempt: Promise<Room<RoomState> | null> | null = null;
function resumeSavedRoom(token: string): Promise<Room<RoomState> | null> {
  resumeAttempt ??= reconnectRoom(token).catch(() => {
    forgetRoom();
    return null;
  });
  return resumeAttempt;
}

export default function App() {
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(null);
  // Set by GameBoard once a game is active; null on the lobby screens, where the background
  // keeps its plain default look.
  const [background, setBackground] = useState<BoardBackground | null>(null);
  const [identity, setIdentity] = usePlayerIdentity();
  // A reload (or the OS discarding and restoring a backgrounded tab) wipes the Room this page
  // held, but the server still has the seat open for a while (GameRoom.onLeave). The token
  // saved on every connect is how this tab walks back into it rather than landing on the menu
  // as a stranger to its own game.
  const [resumeToken] = useState(savedReconnectionToken);
  const [resuming, setResuming] = useState(resumeToken !== null);
  const [resumeLobbyRoom, setResumeLobbyRoom] = useState<Room<RoomState> | null>(null);

  useEffect(() => {
    if (!resumeToken) return;
    void resumeSavedRoom(resumeToken).then((room) => {
      if (room) {
        const seat = Array.from(room.state.seatSessionIds).indexOf(room.sessionId);
        if (room.state.phase === 'playing' && seat !== -1) {
          setOnlineSession({
            room,
            mySeat: seat as PlayerId,
            colors: Array.from(room.state.colors),
            playerNames: Array.from(room.state.playerNames),
          });
        } else {
          setResumeLobbyRoom(room);
        }
      }
      setResuming(false);
    });
  }, [resumeToken]);

  const inGame = Boolean(onlineSession || setup);

  let content;
  if (resuming) {
    // aria-hidden: the always-mounted status region below speaks it.
    content = <p className="lobby__hint app-resuming" aria-hidden="true">Rejoining your game…</p>;
  } else if (onlineSession) {
    content = (
      <OnlineGameView
        session={onlineSession}
        onBackgroundChange={setBackground}
        onExit={() => {
          setOnlineSession(null);
          setBackground(null);
        }}
      />
    );
  } else if (setup) {
    content = <GameView setup={setup} onBackgroundChange={setBackground} />;
  } else {
    content = (
      <Lobby
        identity={identity}
        onIdentityChange={setIdentity}
        onStart={setSetup}
        onOnlineReady={(session) => {
          // Spent: Lobby reads it only as its initial screen, and a later remount (back from
          // this game) must open on the menu, not on this long-gone waiting room.
          setResumeLobbyRoom(null);
          setOnlineSession(session);
        }}
        resumeRoom={resumeLobbyRoom}
      />
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
      {/* Always mounted so the message lands in an existing live region - one that mounts
          already holding its text often isn't announced. */}
      <p role="status" className="visually-hidden">{resuming ? 'Rejoining your game…' : ''}</p>
    </>
  );
}
