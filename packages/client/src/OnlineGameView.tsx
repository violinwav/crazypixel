import { useOnlineGameState } from './game/useOnlineGameState';
import { GameBoard } from './GameBoard';
import type { BoardBackground } from './GameBoard';
import type { OnlineSession } from './OnlineLobby';

interface Props {
  session: OnlineSession;
  onBackgroundChange?: (background: BoardBackground) => void;
}

export function OnlineGameView({ session, onBackgroundChange }: Props) {
  const { state, play, passCurrentHand, lastPlanRef, turnDeadline } = useOnlineGameState(session.room);
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      lastPlanRef={lastPlanRef}
      mySeat={session.mySeat}
      colors={session.colors}
      playerNames={session.playerNames}
      turnDeadline={turnDeadline}
      onBackgroundChange={onBackgroundChange}
    />
  );
}
