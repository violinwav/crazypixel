// Local singleplayer game: you control seat 0, every other seat is a bot (see
// useSingleplayerAutopilot.ts). The engine still runs in-process (useGameState) exactly like the
// old hotseat-for-everyone version did - only who's allowed to act through the UI changed.

import { useGameState } from './game/useGameState';
import { useSingleplayerAutopilot } from './game/useSingleplayerAutopilot';
import { GameBoard } from './GameBoard';
import type { BoardBackground } from './GameBoard';
import type { GameSetup } from './Lobby';

const HUMAN_SEAT = 0;

interface Props {
  setup: GameSetup;
  onBackgroundChange?: (background: BoardBackground) => void;
}

export function GameView({ setup, onBackgroundChange }: Props) {
  const {
    state, play, passCurrentHand, restart, lastPlanRef,
  } = useGameState(setup.config);
  const { turnDeadline, onStealIntent } = useSingleplayerAutopilot({
    state,
    humanSeat: HUMAN_SEAT,
    botDifficulties: setup.bots,
    turnTimerEnabled: setup.turnTimerEnabled,
    play,
    passCurrentHand,
  });

  return (
    <GameBoard
      state={state}
      play={play}
      passCurrentHand={passCurrentHand}
      restart={restart}
      lastPlanRef={lastPlanRef}
      // Fixed rather than tracking state.currentPlayer, unlike the old hotseat-for-everyone
      // version: every other seat is a bot now, so the mySeat===state.currentPlayer gating
      // GameBoard already does for online (hand/overlay only render on your own turn, "Waiting
      // for Player N" the rest of the time) is exactly what makes a bot's turn read as a real
      // opponent acting instead of the device just sitting there. viewerSeat defaults to
      // mySeat, which is already the fixed orientation this session wants.
      mySeat={HUMAN_SEAT}
      colors={setup.colors}
      turnDeadline={turnDeadline}
      onStealIntent={onStealIntent}
      onBackgroundChange={onBackgroundChange}
    />
  );
}
