import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, Move, PlayerId } from '@crazypixel/shared';
import type { Room } from 'colyseus.js';
import type { RoomState } from './network';
import { EMPTY_TURN_ANIMATION } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

// Server is authoritative here - play/passCurrentHand only ever send the intent over the
// network; the resulting GameState comes back through room.onStateChange, never mutated
// locally. lastPlanRef stays EMPTY_TURN_ANIMATION always: unlike the local engine, this
// hook only sees before/after GameState snapshots for OTHER players' moves, not the Move
// itself, so it has nothing to build a real movement-path animation plan from (see design
// doc's out-of-scope note on server-driven animations).
export function useOnlineGameState(room: Room<RoomState>) {
  const [state, setState] = useState<GameState>(() => JSON.parse(room.state.stateJson) as GameState);
  const lastPlanRef = useRef<TurnAnimation>(EMPTY_TURN_ANIMATION);

  useEffect(() => {
    const applyStateJson = () => {
      if (!room.state.stateJson) return;
      setState(JSON.parse(room.state.stateJson) as GameState);
    };
    room.onStateChange(applyStateJson);
    // No unsubscribe - this hook lives for the whole online game session, same lifecycle
    // convention as GameView's Phaser instance and OnlineLobby's WaitingRoom listener.
  }, [room]);

  const play = useCallback((player: PlayerId, move: Move) => {
    room.send('play', { move });
  }, [room]);

  const passCurrentHand = useCallback(() => {
    room.send('passHand');
  }, [room]);

  return { state, play, passCurrentHand, lastPlanRef };
}
