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
  // Seat 0 is the host, the same seat that had to press Start Game to begin with (see
  // GameRoom.handleStartGame/handleRematch) - one player decides for the table instead of
  // six win screens racing each other. Everyone else gets the hint text in the button's
  // place so the win screen doesn't read as a dead end.
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
      // Online only - the steal warning tells you something a player on ANOTHER screen is
      // doing, which local hotseat (one shared screen, see GameView) has no equivalent of.
      stealIntent={stealIntent}
      onStealIntent={announceStealIntent}
      // Online only, same as the steal warning above - an emote is a message to someone
      // looking at a different screen, which local hotseat (one shared device, see GameView)
      // has no equivalent of.
      emotes={emotes}
      onEmote={emote}
    />
  );
}
