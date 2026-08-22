import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, GameState, Move, PlayerId } from '@crazypixel/shared';
import type { Room } from 'colyseus.js';
import type { RoomState } from './network';
import { EMPTY_TURN_ANIMATION } from './animationPlan';
import type { TurnAnimation } from './animationPlan';

export interface StealPreview {
  thief: PlayerId;
  targetPlayer: PlayerId;
  card: Card;
  /** null while the thief has only committed to a target, set once they pick a specific
   * hand position - see StealCardOverlay.tsx. */
  cardIndex: number | null;
}

// A preview that never gets superseded (thief abandons the flow without completing it or
// backing out cleanly - closes the card, switches hands, whatever) shouldn't linger on the
// victim's screen forever. 8s comfortably covers real steal-selection time without feeling
// like a stuck UI on the rare abandoned case.
const STEAL_PREVIEW_TIMEOUT_MS = 8000;

// Server is authoritative here - play/passCurrentHand only ever send the intent over the
// network; the resulting GameState comes back through room.onStateChange, never mutated
// locally. lastPlanRef stays EMPTY_TURN_ANIMATION always: unlike the local engine, this
// hook only sees before/after GameState snapshots for OTHER players' moves, not the Move
// itself, so it has nothing to build a real movement-path animation plan from (see design
// doc's out-of-scope note on server-driven animations).
export function useOnlineGameState(room: Room<RoomState>) {
  const [state, setState] = useState<GameState>(() => JSON.parse(room.state.stateJson) as GameState);
  const [turnDeadline, setTurnDeadline] = useState(room.state.turnDeadline);
  const [stealPreview, setStealPreview] = useState<StealPreview | null>(null);
  const lastPlanRef = useRef<TurnAnimation>(EMPTY_TURN_ANIMATION);

  useEffect(() => {
    const applyStateJson = () => {
      if (!room.state.stateJson) return;
      setState(JSON.parse(room.state.stateJson) as GameState);
      setTurnDeadline(room.state.turnDeadline);
      // A real move landing means whatever steal was in progress (if any) has resolved one
      // way or another - never show a preview that might now be stale.
      setStealPreview(null);
    };
    room.onStateChange(applyStateJson);
    room.onMessage('stealPreview', (payload: StealPreview) => setStealPreview(payload));
    // No unsubscribe - this hook lives for the whole online game session, same lifecycle
    // convention as GameView's Phaser instance and OnlineLobby's WaitingRoom listener.
  }, [room]);

  useEffect(() => {
    if (!stealPreview) return undefined;
    const timer = setTimeout(() => setStealPreview(null), STEAL_PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [stealPreview]);

  const play = useCallback((player: PlayerId, move: Move) => {
    room.send('play', { move });
  }, [room]);

  const passCurrentHand = useCallback(() => {
    room.send('passHand');
  }, [room]);

  const sendStealProgress = useCallback((info: { targetPlayer: PlayerId; card: Card; cardIndex: number | null }) => {
    room.send('stealPreview', info);
  }, [room]);

  return { state, play, passCurrentHand, lastPlanRef, turnDeadline, stealPreview, sendStealProgress };
}
