import { useOnlineGameState } from './game/useOnlineGameState';
import { GameBoard } from './GameBoard';
import type { OnlineSession } from './OnlineLobby';

interface Props {
  session: OnlineSession;
}

export function OnlineGameView({ session }: Props) {
  const { state, play, passCurrentHand, lastPlanRef, turnDeadline } = useOnlineGameState(session.room);
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      lastPlanRef={lastPlanRef}
      mySeat={session.mySeat}
      colors={session.colors}
      turnDeadline={turnDeadline}
    />
  );
}
