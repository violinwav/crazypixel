// Local hotseat game. Everyone shares one device, so the engine runs in-process
// (useGameState) and the acting seat changes every turn.

import { useGameState } from './game/useGameState';
import { GameBoard } from './GameBoard';
import type { BoardBackground } from './GameBoard';
import type { GameSetup } from './Lobby';

interface Props {
  setup: GameSetup;
  onBackgroundChange?: (background: BoardBackground) => void;
}

export function GameView({ setup, onBackgroundChange }: Props) {
  const { state, play, passCurrentHand, restart, lastPlanRef } = useGameState(setup.config);
  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      restart={restart}
      lastPlanRef={lastPlanRef}
      mySeat={state.currentPlayer}
      // Fixed, unlike mySeat: hotseat's acting seat rotates every turn, and re-rotating the
      // whole board to match read as disorienting rather than helpful, so seat 0 anchors one
      // orientation for the session. Online play omits this prop entirely (GameBoard defaults
      // viewerSeat to mySeat, which is already fixed there).
      viewerSeat={0}
      colors={setup.colors}
      onBackgroundChange={onBackgroundChange}
    />
  );
}
