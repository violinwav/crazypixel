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
      // Fixed, not state.currentPlayer - local hotseat's mySeat rotates every turn (it's
      // always whoever's acting), but re-rotating the whole board to match read as
      // disorienting rather than helpful (direct feedback) - seat 0 anchors the same visual
      // orientation for the whole session instead. Online play doesn't pass this at all
      // (GameBoard defaults viewerSeat to mySeat there, which is already fixed all session).
      viewerSeat={0}
      colors={setup.colors}
      onBackgroundChange={onBackgroundChange}
    />
  );
}
