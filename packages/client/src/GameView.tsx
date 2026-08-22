import { useGameState } from './game/useGameState';
import { GameBoard } from './GameBoard';
import type { GameSetup } from './Lobby';

interface Props {
  setup: GameSetup;
}

export function GameView({ setup }: Props) {
  const { state, play, passCurrentHand, restart, lastPlanRef } = useGameState(setup.config);
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      restart={restart}
      lastPlanRef={lastPlanRef}
      mySeat={state.currentPlayer}
      colors={setup.colors}
    />
  );
}
