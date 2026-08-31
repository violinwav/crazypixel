// Networked game. Same GameBoard as local hotseat, fed by the server-backed hook and given
// the online-only extras: a turn clock, steal warnings and emotes.

import { useOnlineGameState } from './game/useOnlineGameState';
import { GameBoard } from './GameBoard';
import type { BoardBackground } from './GameBoard';
import type { OnlineSession } from './game/network';

interface Props {
  session: OnlineSession;
  onBackgroundChange?: (background: BoardBackground) => void;
}

export function OnlineGameView({ session, onBackgroundChange }: Props) {
  const {
    state, play, passCurrentHand, rematch, lastPlanRef, turnDeadline, stealIntent, announceStealIntent,
    emotes, emote,
  } = useOnlineGameState(session.room);
  // Seat 0 is the host, the same seat that pressed Start Game (see GameRoom.handleRematch) -
  // one player decides for the table instead of six win screens racing each other. Everyone
  // else gets hint text in the button's place, so the win screen isn't a dead end.
  const isHost = session.mySeat === 0;
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      restart={isHost ? rematch : undefined}
      restartLabel="Rematch"
      restartHint={isHost ? undefined : `Waiting for ${session.playerNames[0] || 'the host'} to start a rematch.`}
      lastPlanRef={lastPlanRef}
      mySeat={session.mySeat}
      colors={session.colors}
      playerNames={session.playerNames}
      turnDeadline={turnDeadline}
      onBackgroundChange={onBackgroundChange}
      // Steal warnings and emotes are online-only: both are messages about someone looking at
      // a different screen, which local hotseat (one shared device) has no equivalent of.
      stealIntent={stealIntent}
      onStealIntent={announceStealIntent}
      emotes={emotes}
      onEmote={emote}
    />
  );
}
